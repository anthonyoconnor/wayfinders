import {
  WorldSpatialIndex,
  type SpatialBounds,
  type SpatialIndexMutation,
  type SpatialPoint,
  type SpatialQueryResult,
  type SpatialQueryTotals,
} from "../world/spatial";
import type { WorldTopology } from "../world/WorldTopology";

export type WorldDescriptorKind =
  | "fishing-shoal"
  | "survey-site"
  | "island-dossier"
  | "wreck";

export interface WorldDescriptorEntry {
  readonly id: string;
  readonly kind: WorldDescriptorKind;
  readonly domainId: string | number;
  readonly bounds: Readonly<SpatialBounds>;
}

export interface WorldDescriptorCandidates {
  readonly fishingShoalIds: readonly string[];
  readonly surveySiteIds: readonly string[];
  readonly islandDossierIds: readonly number[];
  readonly wreckIds: readonly number[];
}

const EMPTY_CANDIDATES: WorldDescriptorCandidates = Object.freeze({
  fishingShoalIds: Object.freeze([]),
  surveySiteIds: Object.freeze([]),
  islandDossierIds: Object.freeze([]),
  wreckIds: Object.freeze([]),
});

/**
 * Composition-owned heterogeneous descriptor registry. WorldSpatialIndex owns
 * geometry; feature systems retain all authoritative state and exact checks.
 */
export class WorldDescriptorRegistry {
  private readonly index: WorldSpatialIndex<WorldDescriptorEntry>;

  constructor(topology: WorldTopology) {
    this.index = new WorldSpatialIndex({ topology });
  }

  get revision(): number {
    return this.index.revision;
  }

  replace(entries: readonly WorldDescriptorEntry[]): SpatialIndexMutation<string> {
    return this.index.build(entries);
  }

  upsert(entry: WorldDescriptorEntry): SpatialIndexMutation<string> {
    return this.index.has(entry.id) ? this.index.update(entry) : this.index.add(entry);
  }

  queryNear(point: Readonly<SpatialPoint>, radius: number): {
    readonly candidates: WorldDescriptorCandidates;
    readonly query: SpatialQueryResult<WorldDescriptorEntry>;
  } {
    const query = this.index.queryRadius(point, radius);
    return Object.freeze({ candidates: groupWorldDescriptorCandidates(query.entities), query });
  }

  queryBounds(bounds: Readonly<SpatialBounds>): {
    readonly candidates: WorldDescriptorCandidates;
    readonly query: SpatialQueryResult<WorldDescriptorEntry>;
  } {
    const query = this.index.queryBounds(bounds);
    return Object.freeze({ candidates: groupWorldDescriptorCandidates(query.entities), query });
  }

  queryTotals(): Readonly<SpatialQueryTotals> {
    return this.index.getQueryTotals();
  }
}

export function worldDescriptorKey(
  kind: WorldDescriptorKind,
  domainId: string | number,
): string {
  return `${kind}:${String(domainId)}`;
}

export function createPointDescriptor(
  kind: WorldDescriptorKind,
  domainId: string | number,
  point: Readonly<SpatialPoint>,
): WorldDescriptorEntry {
  return createBoundsDescriptor(kind, domainId, {
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y,
  });
}

export function createBoundsDescriptor(
  kind: WorldDescriptorKind,
  domainId: string | number,
  bounds: Readonly<SpatialBounds>,
): WorldDescriptorEntry {
  return Object.freeze({
    id: worldDescriptorKey(kind, domainId),
    kind,
    domainId,
    bounds: Object.freeze({ ...bounds }),
  });
}

export function boundsForWorldIndices(
  indices: readonly number[],
  topology: WorldTopology,
): Readonly<SpatialBounds> {
  if (indices.length === 0) throw new RangeError("Descriptor bounds require at least one world index");
  const points: SpatialPoint[] = [];
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= topology.tileWidth * topology.tileHeight) {
      throw new RangeError(`Invalid world index ${index}`);
    }
    points.push({
      x: index % topology.tileWidth,
      y: Math.floor(index / topology.tileWidth),
    });
  }
  return boundsForWorldPoints(points, topology);
}

/**
 * Returns the deterministic minimum lifted rectangle covering canonical tile
 * points. Wrapped axes remove the largest circular gap, preventing a local
 * seam set from becoming an almost-world-sized planar query.
 */
export function boundsForWorldPoints(
  points: readonly Readonly<SpatialPoint>[],
  topology: WorldTopology,
): Readonly<SpatialBounds> {
  if (points.length === 0) throw new RangeError("Descriptor bounds require at least one world point");
  const xValues: number[] = [];
  const yValues: number[] = [];
  for (const point of points) {
    if (!topology.isCanonicalTile(point.x, point.y)) {
      throw new RangeError(`World point (${point.x}, ${point.y}) must be a canonical tile`);
    }
    xValues.push(point.x);
    yValues.push(point.y);
  }
  const xBounds = minimumLiftedAxisBounds(xValues, topology.tileWidth, topology.wrapsX);
  const yBounds = minimumLiftedAxisBounds(yValues, topology.tileHeight, topology.wrapsY);
  return Object.freeze({
    minX: xBounds.minimum,
    minY: yBounds.minimum,
    maxX: xBounds.maximum,
    maxY: yBounds.maximum,
  });
}

export function groupWorldDescriptorCandidates(
  entries: readonly WorldDescriptorEntry[],
): WorldDescriptorCandidates {
  if (entries.length === 0) return EMPTY_CANDIDATES;
  const fishingShoalIds: string[] = [];
  const surveySiteIds: string[] = [];
  const islandDossierIds: number[] = [];
  const wreckIds: number[] = [];
  for (const entry of entries) {
    if (entry.kind === "fishing-shoal" && typeof entry.domainId === "string") {
      fishingShoalIds.push(entry.domainId);
    } else if (entry.kind === "survey-site" && typeof entry.domainId === "string") {
      surveySiteIds.push(entry.domainId);
    } else if (entry.kind === "island-dossier" && typeof entry.domainId === "number") {
      islandDossierIds.push(entry.domainId);
    } else if (entry.kind === "wreck" && typeof entry.domainId === "number") {
      wreckIds.push(entry.domainId);
    }
  }
  fishingShoalIds.sort((left, right) => left.localeCompare(right));
  surveySiteIds.sort((left, right) => left.localeCompare(right));
  islandDossierIds.sort((left, right) => left - right);
  wreckIds.sort((left, right) => left - right);
  return Object.freeze({
    fishingShoalIds: Object.freeze(fishingShoalIds),
    surveySiteIds: Object.freeze(surveySiteIds),
    islandDossierIds: Object.freeze(islandDossierIds),
    wreckIds: Object.freeze(wreckIds),
  });
}

function minimumLiftedAxisBounds(
  values: readonly number[],
  span: number,
  wraps: boolean,
): { readonly minimum: number; readonly maximum: number } {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (!wraps) return { minimum: sorted[0], maximum: sorted[sorted.length - 1] };

  let bestGap = -1;
  let bestMinimum = 0;
  let bestMaximum = 0;
  for (let index = 0; index < sorted.length; index++) {
    const current = sorted[index];
    const next = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + span;
    const gap = next - current;
    const minimum = next % span;
    const maximum = current < minimum ? current + span : current;
    if (
      gap > bestGap
      || (gap === bestGap && (minimum < bestMinimum || (minimum === bestMinimum && maximum < bestMaximum)))
    ) {
      bestGap = gap;
      bestMinimum = minimum;
      bestMaximum = maximum;
    }
  }
  return { minimum: bestMinimum, maximum: bestMaximum };
}
