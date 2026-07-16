export type SpatialEntityId = string | number;

export interface SpatialPoint {
  readonly x: number;
  readonly y: number;
}

/** Closed axis-aligned bounds in logical world coordinates. */
export interface SpatialBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SpatialChunk {
  readonly x: number;
  readonly y: number;
}

/** Minimal contract required to place an immutable descriptor in the index. */
export interface SpatialEntityDescriptor<TId extends SpatialEntityId = SpatialEntityId> {
  readonly id: TId;
  readonly bounds: Readonly<SpatialBounds>;
}

export interface SpatialEntityMembership<TId extends SpatialEntityId = SpatialEntityId> {
  readonly entityId: TId;
  /** The chunk containing the centre of the descriptor bounds. */
  readonly homeChunk: Readonly<SpatialChunk>;
  /** Every chunk intersected by the descriptor bounds, in row-major order. */
  readonly chunks: readonly Readonly<SpatialChunk>[];
}

export interface SpatialQueryCounters {
  /** Chunk buckets looked up, including empty buckets. */
  readonly bucketsExamined: number;
  /** Bucket entries visited before duplicate entity IDs are removed. */
  readonly bucketEntriesExamined: number;
  /** Unique descriptor bounds tested by the query. */
  readonly entitiesExamined: number;
  readonly entitiesMatched: number;
}

export interface SpatialQueryTotals extends SpatialQueryCounters {
  readonly queryCount: number;
}

export interface SpatialQueryResult<TDescriptor extends SpatialEntityDescriptor> {
  readonly entities: readonly TDescriptor[];
  readonly counters: Readonly<SpatialQueryCounters>;
}

export type SpatialIndexMutationKind = "none" | "built" | "added" | "updated" | "removed" | "cleared";

/** Narrow invalidation output returned by every index mutation. */
export interface SpatialIndexMutation<TId extends SpatialEntityId = SpatialEntityId> {
  readonly kind: SpatialIndexMutationKind;
  readonly previousRevision: number;
  readonly revision: number;
  readonly changedEntityIds: readonly TId[];
  readonly changedChunks: readonly Readonly<SpatialChunk>[];
}

export interface WorldSpatialIndexOptions {
  /** Logical coordinate width/height of one square bucket. */
  readonly chunkSize: number;
  /** Guards accidental indexing of world-spanning descriptors. */
  readonly maxChunksPerEntity?: number;
}
