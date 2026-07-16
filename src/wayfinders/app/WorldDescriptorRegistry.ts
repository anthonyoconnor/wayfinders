import {
  WorldSpatialIndex,
  type SpatialBounds,
  type SpatialIndexMutation,
  type SpatialPoint,
  type SpatialQueryResult,
  type SpatialQueryTotals,
} from "../world/spatial";

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

  constructor(chunkSize: number) {
    this.index = new WorldSpatialIndex({ chunkSize });
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

  remove(kind: WorldDescriptorKind, domainId: string | number): SpatialIndexMutation<string> {
    return this.index.remove(worldDescriptorKey(kind, domainId));
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
  worldWidth: number,
): Readonly<SpatialBounds> {
  if (indices.length === 0) throw new RangeError("Descriptor bounds require at least one world index");
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError(`Invalid world index ${index}`);
    const x = index % worldWidth;
    const y = Math.floor(index / worldWidth);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
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
