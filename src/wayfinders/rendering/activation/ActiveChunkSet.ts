import type {
  ActiveChunkDelta,
  ActiveChunkEntry,
  ActiveChunkSetOptions,
  ActiveChunkTelemetry,
  ChunkRegion,
  DeactivatedChunkEntry,
} from "./ActiveChunkContracts";

/**
 * Selects a bounded, deterministic set of presentation chunks around the viewport.
 * It owns no renderer objects and never reads or creates authoritative world chunks.
 */
export class ActiveChunkSet {
  private readonly worldBounds: Readonly<ChunkRegion>;
  private readonly prefetchRing: number;
  private readonly maxActiveChunks: number;

  private visibleRegion: Readonly<ChunkRegion> | null = null;
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
    assertRegion(options.worldBounds, "world bounds");
    assertNonNegativeInteger(options.prefetchRing, "prefetchRing");
    assertPositiveInteger(options.maxActiveChunks, "maxActiveChunks");

    this.worldBounds = freezeRegion(options.worldBounds);
    this.prefetchRing = options.prefetchRing;
    this.maxActiveChunks = options.maxActiveChunks;
  }

  /**
   * Applies a closed visible chunk region. Pass null when no world viewport is active.
   * Repeating an equivalent target is a no-op apart from the update counter.
   */
  update(visibleRegion: Readonly<ChunkRegion> | null): Readonly<ActiveChunkDelta> {
    this.updateCount++;
    if (visibleRegion !== null) assertRegion(visibleRegion, "visible region");

    const clippedRegion = visibleRegion === null
      ? null
      : intersectRegions(visibleRegion, this.worldBounds);
    const ranked = clippedRegion === null
      ? []
      : rankCandidates(clippedRegion, this.worldBounds, this.prefetchRing);
    const nextActive = freezeEntries(ranked.slice(0, this.maxActiveChunks));
    const nextDeferred = freezeEntries(ranked.slice(this.maxActiveChunks));
    const targetChanged = !regionsEqual(this.visibleRegion, clippedRegion)
      || !entryListsEqual(this.active, nextActive)
      || !entryListsEqual(this.deferred, nextDeferred);

    const previousByKey = new Map(this.active.map((entry) => [entry.key, entry]));
    const nextByKey = new Map(nextActive.map((entry) => [entry.key, entry]));
    const desiredKeys = new Set(ranked.map(({ key }) => key));

    const activated = Object.freeze(nextActive.filter(({ key }) => !previousByKey.has(key)));
    const updated = Object.freeze(nextActive.filter((entry) => {
      const previous = previousByKey.get(entry.key);
      return previous !== undefined && !entriesEqual(previous, entry);
    }));
    const deactivated = Object.freeze(this.active
      .filter(({ key }) => !nextByKey.has(key))
      .map((entry): Readonly<DeactivatedChunkEntry> => Object.freeze({
        ...entry,
        reason: desiredKeys.has(entry.key) ? "budget" : "outside-prefetch",
      }))
      .sort(compareDeactivation));

    if (targetChanged) this.revision++;
    if (activated.length > 0 || deactivated.length > 0) this.membershipRevision++;

    this.visibleRegion = clippedRegion === null ? null : freezeRegion(clippedRegion);
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
      visibleRegion: this.visibleRegion,
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

export function activeChunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX},${chunkY}`;
}

function rankCandidates(
  visible: Readonly<ChunkRegion>,
  worldBounds: Readonly<ChunkRegion>,
  prefetchRing: number,
): ActiveChunkEntry[] {
  const desired = intersectRegions({
    minX: visible.minX - prefetchRing,
    minY: visible.minY - prefetchRing,
    maxX: visible.maxX + prefetchRing,
    maxY: visible.maxY + prefetchRing,
  }, worldBounds);
  if (desired === null) return [];

  const candidates: Candidate[] = [];
  const centreX2 = visible.minX + visible.maxX;
  const centreY2 = visible.minY + visible.maxY;
  for (let y = desired.minY; y <= desired.maxY; y++) {
    for (let x = desired.minX; x <= desired.maxX; x++) {
      const ringDistance = distanceFromRegion(x, y, visible);
      const centreDx2 = Math.abs(x * 2 - centreX2);
      const centreDy2 = Math.abs(y * 2 - centreY2);
      candidates.push({
        x,
        y,
        ringDistance,
        centreDistanceSquared4: centreDx2 * centreDx2 + centreDy2 * centreDy2,
      });
    }
  }

  candidates.sort(compareCandidate);
  return candidates.map((candidate, loadPriority) => Object.freeze({
    key: activeChunkKey(candidate.x, candidate.y),
    coordinate: Object.freeze({ x: candidate.x, y: candidate.y }),
    band: candidate.ringDistance === 0 ? "visible" : "prefetch",
    ringDistance: candidate.ringDistance,
    loadPriority,
  }));
}

interface Candidate {
  readonly x: number;
  readonly y: number;
  readonly ringDistance: number;
  readonly centreDistanceSquared4: number;
}

function compareCandidate(left: Candidate, right: Candidate): number {
  return left.ringDistance - right.ringDistance
    || left.centreDistanceSquared4 - right.centreDistanceSquared4
    || left.y - right.y
    || left.x - right.x;
}

function compareDeactivation(
  left: Readonly<DeactivatedChunkEntry>,
  right: Readonly<DeactivatedChunkEntry>,
): number {
  return right.loadPriority - left.loadPriority
    || left.coordinate.y - right.coordinate.y
    || left.coordinate.x - right.coordinate.x;
}

function distanceFromRegion(x: number, y: number, region: Readonly<ChunkRegion>): number {
  const dx = x < region.minX ? region.minX - x : x > region.maxX ? x - region.maxX : 0;
  const dy = y < region.minY ? region.minY - y : y > region.maxY ? y - region.maxY : 0;
  return Math.max(dx, dy);
}

function intersectRegions(
  left: Readonly<ChunkRegion>,
  right: Readonly<ChunkRegion>,
): ChunkRegion | null {
  const minX = Math.max(left.minX, right.minX);
  const minY = Math.max(left.minY, right.minY);
  const maxX = Math.min(left.maxX, right.maxX);
  const maxY = Math.min(left.maxY, right.maxY);
  return minX > maxX || minY > maxY ? null : { minX, minY, maxX, maxY };
}

function regionsEqual(
  left: Readonly<ChunkRegion> | null,
  right: Readonly<ChunkRegion> | null,
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
  return left.key === right.key
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

function freezeRegion(region: Readonly<ChunkRegion>): Readonly<ChunkRegion> {
  return Object.freeze({ ...region });
}

function assertRegion(region: Readonly<ChunkRegion>, label: string): void {
  assertSafeInteger(region.minX, `${label}.minX`);
  assertSafeInteger(region.minY, `${label}.minY`);
  assertSafeInteger(region.maxX, `${label}.maxX`);
  assertSafeInteger(region.maxY, `${label}.maxY`);
  if (region.minX > region.maxX || region.minY > region.maxY) {
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
