import type { GridPoint, WorldPoint } from "../../core/types";
import type { PeriodicChunkImage, WorldTopology } from "../../world/WorldTopology";
import type {
  ActiveChunkDelta,
  ActiveChunkEntry,
  ActiveChunkSetOptions,
  ActiveChunkTelemetry,
  DeactivatedChunkEntry,
  LiftedTileBounds,
} from "./ActiveChunkContracts";

/**
 * Selects a deterministic, capacity-bounded set of periodic presentation images.
 * It owns no renderer objects and never reads or creates authoritative world chunks.
 */
export class ActiveChunkSet {
  private readonly topology: WorldTopology;
  private readonly prefetchRing: number;
  private readonly maxActiveChunks: number;

  private visibleTileBounds: Readonly<LiftedTileBounds> | null = null;
  private active: readonly Readonly<ActiveChunkEntry>[] = Object.freeze([]);
  private deferred: readonly Readonly<ActiveChunkEntry>[] = Object.freeze([]);
  private revision = 0;
  private membershipRevision = 0;
  private updateCount = 0;
  private totalActivations = 0;
  private totalDeactivations = 0;
  private totalBudgetEvictions = 0;
  private totalViewportDeactivations = 0;
  private peakActiveChunks = 0;
  private peakBudgetDeferredChunks = 0;

  constructor(options: Readonly<ActiveChunkSetOptions>) {
    assertNonNegativeInteger(options.prefetchRing, "prefetchRing");
    assertPositiveInteger(options.maxActiveChunks, "maxActiveChunks");

    this.topology = options.topology;
    this.prefetchRing = options.prefetchRing;
    this.maxActiveChunks = options.maxActiveChunks;
  }

  /**
   * Applies closed, inclusive visible bounds in lifted tile coordinates. Pass
   * null when no world viewport is active. Repeating an equivalent target is a
   * no-op apart from the update counter.
   */
  update(visibleTileBounds: Readonly<LiftedTileBounds> | null): Readonly<ActiveChunkDelta> {
    this.updateCount++;
    if (visibleTileBounds !== null) assertBounds(visibleTileBounds, "visible tile bounds");

    const ranked = visibleTileBounds === null
      ? []
      : rankCandidates(visibleTileBounds, this.topology, this.prefetchRing);
    const nextActive = freezeEntries(ranked.slice(0, this.maxActiveChunks));
    const nextDeferred = freezeEntries(ranked.slice(this.maxActiveChunks));
    const targetChanged = !boundsEqual(this.visibleTileBounds, visibleTileBounds)
      || !entryListsEqual(this.active, nextActive)
      || !entryListsEqual(this.deferred, nextDeferred);

    const previousByKey = new Map(this.active.map((entry) => [entry.viewKey, entry]));
    const nextByKey = new Map(nextActive.map((entry) => [entry.viewKey, entry]));
    const desiredKeys = new Set(ranked.map(({ viewKey }) => viewKey));

    const activated = Object.freeze(nextActive.filter(({ viewKey }) => !previousByKey.has(viewKey)));
    const updated = Object.freeze(nextActive.filter((entry) => {
      const previous = previousByKey.get(entry.viewKey);
      return previous !== undefined && !entriesEqual(previous, entry);
    }));
    const deactivated = Object.freeze(this.active
      .filter(({ viewKey }) => !nextByKey.has(viewKey))
      .map((entry): Readonly<DeactivatedChunkEntry> => Object.freeze({
        ...entry,
        reason: desiredKeys.has(entry.viewKey) ? "budget" : "outside-prefetch",
      }))
      .sort(compareDeactivation));

    if (targetChanged) this.revision++;
    if (activated.length > 0 || deactivated.length > 0) this.membershipRevision++;

    this.visibleTileBounds = visibleTileBounds === null ? null : freezeBounds(visibleTileBounds);
    this.active = nextActive;
    this.deferred = nextDeferred;
    this.totalActivations += activated.length;
    this.totalDeactivations += deactivated.length;
    this.totalBudgetEvictions += deactivated.filter(({ reason }) => reason === "budget").length;
    this.totalViewportDeactivations += deactivated.filter(({ reason }) => reason === "outside-prefetch").length;
    this.peakActiveChunks = Math.max(this.peakActiveChunks, nextActive.length);
    this.peakBudgetDeferredChunks = Math.max(this.peakBudgetDeferredChunks, nextDeferred.length);

    return Object.freeze({
      revision: this.revision,
      membershipRevision: this.membershipRevision,
      visibleTileBounds: this.visibleTileBounds,
      activated,
      deactivated,
      updated,
      active: this.active,
      deferred: this.deferred,
      telemetry: this.getTelemetry(),
    });
  }

  getTelemetry(): Readonly<ActiveChunkTelemetry> {
    const visibleActiveChunks = this.active.filter(({ band }) => band === "visible").length;
    const visibleBudgetDeferredChunks = this.deferred.filter(({ band }) => band === "visible").length;
    return Object.freeze({
      updateCount: this.updateCount,
      revision: this.revision,
      membershipRevision: this.membershipRevision,
      capacity: this.maxActiveChunks,
      activeChunks: this.active.length,
      visibleActiveChunks,
      prefetchedActiveChunks: this.active.length - visibleActiveChunks,
      desiredChunks: this.active.length + this.deferred.length,
      budgetDeferredChunks: this.deferred.length,
      visibleBudgetDeferredChunks,
      budgetSaturated: this.deferred.length > 0,
      totalActivations: this.totalActivations,
      totalDeactivations: this.totalDeactivations,
      totalBudgetEvictions: this.totalBudgetEvictions,
      totalViewportDeactivations: this.totalViewportDeactivations,
      peakActiveChunks: this.peakActiveChunks,
      peakBudgetDeferredChunks: this.peakBudgetDeferredChunks,
    });
  }
}

export function activeChunkViewKey(
  canonicalChunkX: number,
  canonicalChunkY: number,
  imageOffsetX: number,
  imageOffsetY: number,
): string {
  return `${canonicalChunkX},${canonicalChunkY}@${imageOffsetX},${imageOffsetY}`;
}

function rankCandidates(
  visible: Readonly<LiftedTileBounds>,
  topology: WorldTopology,
  prefetchRing: number,
): ActiveChunkEntry[] {
  const padding = prefetchRing * topology.chunkSize;
  if (!Number.isSafeInteger(padding)) throw new RangeError("prefetch tile padding must be a safe integer");
  const desired = expandedBounds(visible, padding);
  const candidates = topology.periodicChunkImagesForBounds(desired).map((image) => (
    candidateForImage(image, topology, visible)
  ));

  candidates.sort(compareCandidate);
  return candidates.map((candidate, loadPriority) => Object.freeze({
    viewKey: activeChunkViewKey(
      candidate.canonicalChunk.x,
      candidate.canonicalChunk.y,
      candidate.imageOffset.x,
      candidate.imageOffset.y,
    ),
    canonicalChunk: Object.freeze({ ...candidate.canonicalChunk }),
    imageOffset: Object.freeze({ ...candidate.imageOffset }),
    band: candidate.ringDistance === 0 ? "visible" : "prefetch",
    ringDistance: candidate.ringDistance,
    loadPriority,
  }));
}

interface Candidate {
  readonly canonicalChunk: Readonly<GridPoint>;
  readonly imageOffset: Readonly<WorldPoint>;
  readonly liftedBounds: Readonly<LiftedTileBounds>;
  readonly ringDistance: number;
  readonly centreDistanceSquared4: number;
}

function candidateForImage(
  image: Readonly<PeriodicChunkImage>,
  topology: WorldTopology,
  visible: Readonly<LiftedTileBounds>,
): Candidate {
  const canonicalMinX = image.canonicalChunk.x * topology.chunkSize;
  const canonicalMinY = image.canonicalChunk.y * topology.chunkSize;
  const imageTileOffsetX = image.imageOffset.x / topology.tileSize;
  const imageTileOffsetY = image.imageOffset.y / topology.tileSize;
  const liftedBounds = Object.freeze({
    minX: canonicalMinX + imageTileOffsetX,
    minY: canonicalMinY + imageTileOffsetY,
    maxX: Math.min(topology.tileWidth, canonicalMinX + topology.chunkSize) - 1 + imageTileOffsetX,
    maxY: Math.min(topology.tileHeight, canonicalMinY + topology.chunkSize) - 1 + imageTileOffsetY,
  });
  const gapX = axisGap(liftedBounds.minX, liftedBounds.maxX, visible.minX, visible.maxX);
  const gapY = axisGap(liftedBounds.minY, liftedBounds.maxY, visible.minY, visible.maxY);
  const ringDistance = Math.ceil(Math.max(gapX, gapY) / topology.chunkSize);
  const centreDx2 = liftedBounds.minX + liftedBounds.maxX - visible.minX - visible.maxX;
  const centreDy2 = liftedBounds.minY + liftedBounds.maxY - visible.minY - visible.maxY;

  return {
    canonicalChunk: image.canonicalChunk,
    imageOffset: image.imageOffset,
    liftedBounds,
    ringDistance,
    centreDistanceSquared4: centreDx2 * centreDx2 + centreDy2 * centreDy2,
  };
}

function compareCandidate(left: Candidate, right: Candidate): number {
  return left.ringDistance - right.ringDistance
    || left.centreDistanceSquared4 - right.centreDistanceSquared4
    || left.liftedBounds.minY - right.liftedBounds.minY
    || left.liftedBounds.minX - right.liftedBounds.minX
    || left.canonicalChunk.y - right.canonicalChunk.y
    || left.canonicalChunk.x - right.canonicalChunk.x
    || left.imageOffset.y - right.imageOffset.y
    || left.imageOffset.x - right.imageOffset.x;
}

function compareDeactivation(
  left: Readonly<DeactivatedChunkEntry>,
  right: Readonly<DeactivatedChunkEntry>,
): number {
  return right.loadPriority - left.loadPriority
    || left.imageOffset.y - right.imageOffset.y
    || left.imageOffset.x - right.imageOffset.x
    || left.canonicalChunk.y - right.canonicalChunk.y
    || left.canonicalChunk.x - right.canonicalChunk.x;
}

function axisGap(
  leftMinimum: number,
  leftMaximum: number,
  rightMinimum: number,
  rightMaximum: number,
): number {
  if (leftMaximum < rightMinimum) return rightMinimum - leftMaximum;
  if (leftMinimum > rightMaximum) return leftMinimum - rightMaximum;
  return 0;
}

function expandedBounds(bounds: Readonly<LiftedTileBounds>, amount: number): LiftedTileBounds {
  const expanded = {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
  assertBounds(expanded, "expanded tile bounds");
  return expanded;
}

function boundsEqual(
  left: Readonly<LiftedTileBounds> | null,
  right: Readonly<LiftedTileBounds> | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.minX === right.minX
    && left.minY === right.minY
    && left.maxX === right.maxX
    && left.maxY === right.maxY;
}

function entriesEqual(
  left: Readonly<ActiveChunkEntry>,
  right: Readonly<ActiveChunkEntry>,
): boolean {
  return left.viewKey === right.viewKey
    && left.canonicalChunk.x === right.canonicalChunk.x
    && left.canonicalChunk.y === right.canonicalChunk.y
    && left.imageOffset.x === right.imageOffset.x
    && left.imageOffset.y === right.imageOffset.y
    && left.band === right.band
    && left.ringDistance === right.ringDistance
    && left.loadPriority === right.loadPriority;
}

function entryListsEqual(
  left: readonly Readonly<ActiveChunkEntry>[],
  right: readonly Readonly<ActiveChunkEntry>[],
): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined && entriesEqual(entry, other);
  });
}

function freezeEntries(entries: readonly ActiveChunkEntry[]): readonly Readonly<ActiveChunkEntry>[] {
  return Object.freeze(entries);
}

function freezeBounds(bounds: Readonly<LiftedTileBounds>): Readonly<LiftedTileBounds> {
  return Object.freeze({ ...bounds });
}

function assertBounds(bounds: Readonly<LiftedTileBounds>, label: string): void {
  assertSafeInteger(bounds.minX, `${label}.minX`);
  assertSafeInteger(bounds.minY, `${label}.minY`);
  assertSafeInteger(bounds.maxX, `${label}.maxX`);
  assertSafeInteger(bounds.maxY, `${label}.maxY`);
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new RangeError(`${label} minimums cannot exceed maximums`);
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}
