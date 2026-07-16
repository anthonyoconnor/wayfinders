import type {
  SpatialBounds,
  SpatialChunk,
  SpatialEntityDescriptor,
  SpatialEntityId,
  SpatialEntityMembership,
  SpatialIndexMutation,
  SpatialPoint,
  SpatialQueryCounters,
  SpatialQueryResult,
  SpatialQueryTotals,
  WorldSpatialIndexOptions,
} from "./SpatialIndexContracts";

interface IndexedEntity<TDescriptor extends SpatialEntityDescriptor> {
  readonly descriptor: TDescriptor;
  readonly bounds: Readonly<SpatialBounds>;
  readonly membership: SpatialEntityMembership<TDescriptor["id"]>;
  readonly chunkKeys: readonly string[];
}

interface CandidateCollection<TDescriptor extends SpatialEntityDescriptor> {
  readonly records: readonly IndexedEntity<TDescriptor>[];
  readonly bucketsExamined: number;
  readonly bucketEntriesExamined: number;
}

const DEFAULT_MAX_CHUNKS_PER_ENTITY = 65_536;

/**
 * Deterministic chunk-bucket index for durable world descriptors.
 *
 * Descriptor objects and IDs are treated as immutable. Bounds are copied into
 * private records so an accidental external bounds mutation cannot corrupt
 * bucket membership or query correctness.
 */
export class WorldSpatialIndex<TDescriptor extends SpatialEntityDescriptor> {
  private records = new Map<TDescriptor["id"], IndexedEntity<TDescriptor>>();
  private buckets = new Map<string, Set<TDescriptor["id"]>>();
  private revisionValue = 0;
  private queryCount = 0;
  private totalBucketsExamined = 0;
  private totalBucketEntriesExamined = 0;
  private totalEntitiesExamined = 0;
  private totalEntitiesMatched = 0;

  readonly chunkSize: number;
  readonly maxChunksPerEntity: number;

  constructor(options: Readonly<WorldSpatialIndexOptions>) {
    assertPositiveFinite(options.chunkSize, "chunkSize");
    this.chunkSize = options.chunkSize;
    this.maxChunksPerEntity = options.maxChunksPerEntity ?? DEFAULT_MAX_CHUNKS_PER_ENTITY;
    if (!Number.isSafeInteger(this.maxChunksPerEntity) || this.maxChunksPerEntity <= 0) {
      throw new RangeError("maxChunksPerEntity must be a positive safe integer");
    }
  }

  get size(): number {
    return this.records.size;
  }

  /** Advances exactly once for each successful logical mutation. */
  get revision(): number {
    return this.revisionValue;
  }

  /**
   * Transactionally replaces all entries. Validation and record construction
   * complete before live buckets or the revision are changed.
   */
  build(descriptors: readonly TDescriptor[]): SpatialIndexMutation<TDescriptor["id"]> {
    const nextRecords = new Map<TDescriptor["id"], IndexedEntity<TDescriptor>>();
    const nextBuckets = new Map<string, Set<TDescriptor["id"]>>();

    for (const descriptor of descriptors) {
      const id = descriptor.id;
      assertEntityId(id);
      if (nextRecords.has(id)) throw new RangeError(`Duplicate spatial entity ID ${String(id)}`);
      const record = this.createRecord(descriptor);
      nextRecords.set(id, record);
      addRecordToBuckets(nextBuckets, record);
    }

    const changedEntityIds = sortedIds(new Set([...this.records.keys(), ...nextRecords.keys()]));
    const changedChunks = sortedChunksFromRecords([...this.records.values(), ...nextRecords.values()]);
    const previousRevision = this.revisionValue;
    this.records = nextRecords;
    this.buckets = nextBuckets;
    this.revisionValue++;
    return mutation("built", previousRevision, this.revisionValue, changedEntityIds, changedChunks);
  }

  add(descriptor: TDescriptor): SpatialIndexMutation<TDescriptor["id"]> {
    const id = descriptor.id;
    assertEntityId(id);
    if (this.records.has(id)) throw new RangeError(`Duplicate spatial entity ID ${String(id)}`);
    const record = this.createRecord(descriptor);
    this.records.set(id, record);
    addRecordToBuckets(this.buckets, record);
    return this.changedMutation("added", [id], record.membership.chunks);
  }

  update(descriptor: TDescriptor): SpatialIndexMutation<TDescriptor["id"]>;
  update(id: TDescriptor["id"], descriptor: TDescriptor): SpatialIndexMutation<TDescriptor["id"]>;
  update(
    idOrDescriptor: TDescriptor["id"] | TDescriptor,
    replacement?: TDescriptor,
  ): SpatialIndexMutation<TDescriptor["id"]> {
    const descriptor = replacement ?? idOrDescriptor as TDescriptor;
    const id = replacement ? idOrDescriptor as TDescriptor["id"] : descriptor.id;
    assertEntityId(id);
    if (descriptor.id !== id) throw new RangeError("A spatial entity ID cannot change during update");

    const previous = this.records.get(id);
    if (!previous) throw new RangeError(`Unknown spatial entity ID ${String(id)}`);
    if (previous.descriptor === descriptor && sameBounds(previous.bounds, descriptor.bounds)) {
      return this.unchangedMutation();
    }

    const next = this.createRecord(descriptor);
    removeRecordFromBuckets(this.buckets, previous);
    addRecordToBuckets(this.buckets, next);
    this.records.set(id, next);
    return this.changedMutation(
      "updated",
      [id],
      sortedChunkUnion(previous.membership.chunks, next.membership.chunks),
    );
  }

  remove(id: TDescriptor["id"]): SpatialIndexMutation<TDescriptor["id"]> {
    assertEntityId(id);
    const record = this.records.get(id);
    if (!record) return this.unchangedMutation();
    removeRecordFromBuckets(this.buckets, record);
    this.records.delete(id);
    return this.changedMutation("removed", [id], record.membership.chunks);
  }

  clear(): SpatialIndexMutation<TDescriptor["id"]> {
    if (this.records.size === 0) return this.unchangedMutation();
    const changedEntityIds = sortedIds(this.records.keys());
    const changedChunks = sortedChunksFromRecords(this.records.values());
    this.records.clear();
    this.buckets.clear();
    return this.changedMutation("cleared", changedEntityIds, changedChunks);
  }

  has(id: TDescriptor["id"]): boolean {
    return this.records.has(id);
  }

  get(id: TDescriptor["id"]): TDescriptor | undefined {
    return this.records.get(id)?.descriptor;
  }

  getMembership(id: TDescriptor["id"]): SpatialEntityMembership<TDescriptor["id"]> | undefined {
    return this.records.get(id)?.membership;
  }

  /** Returns every descriptor in stable entity-ID order. */
  getAll(): readonly TDescriptor[] {
    return Object.freeze([...this.records.values()]
      .sort(compareRecordsById)
      .map((record) => record.descriptor));
  }

  /** Finds descriptors whose closed bounds contain the point. */
  queryPoint(point: Readonly<SpatialPoint>): SpatialQueryResult<TDescriptor> {
    assertPoint(point);
    const candidates = this.collectCandidates({
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    });
    const matched = candidates.records
      .filter((record) => containsPoint(record.bounds, point))
      .sort(compareRecordsById);
    return this.completeQuery(candidates, matched);
  }

  /** Finds descriptors whose bounds intersect the closed query bounds. */
  queryBounds(bounds: Readonly<SpatialBounds>): SpatialQueryResult<TDescriptor> {
    const normalized = copyAndValidateBounds(bounds);
    const candidates = this.collectCandidates(normalized);
    const matched = candidates.records
      .filter((record) => intersectsBounds(record.bounds, normalized))
      .sort(compareRecordsById);
    return this.completeQuery(candidates, matched);
  }

  /** Finds descriptors whose bounds are at most radius units from the centre. */
  queryRadius(centre: Readonly<SpatialPoint>, radius: number): SpatialQueryResult<TDescriptor> {
    assertPoint(centre);
    assertNonNegativeFinite(radius, "radius");
    const candidates = this.collectRadiusCandidates(centre, radius);
    const radiusSquared = radius * radius;
    const matched = candidates.records
      .filter((record) => distanceToBoundsSquared(centre, record.bounds) <= radiusSquared)
      .sort(compareRecordsById);
    return this.completeQuery(candidates, matched);
  }

  /**
   * Radius query ordered nearest-first, with entity ID as a stable tie-breaker.
   * The limit is applied after exact distance filtering and deterministic sort.
   */
  queryNearby(
    centre: Readonly<SpatialPoint>,
    radius: number,
    limit = Number.MAX_SAFE_INTEGER,
  ): SpatialQueryResult<TDescriptor> {
    assertPoint(centre);
    assertNonNegativeFinite(radius, "radius");
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("limit must be a non-negative safe integer");
    const candidates = this.collectRadiusCandidates(centre, radius);
    const radiusSquared = radius * radius;
    const matched = candidates.records
      .filter((record) => distanceToBoundsSquared(centre, record.bounds) <= radiusSquared)
      .sort((left, right) => {
        const distanceDifference = distanceToBoundsSquared(centre, left.bounds)
          - distanceToBoundsSquared(centre, right.bounds);
        return distanceDifference || compareEntityIds(left.descriptor.id, right.descriptor.id);
      })
      .slice(0, limit);
    return this.completeQuery(candidates, matched);
  }

  /** Returns descriptors intersecting one explicit bucket. */
  queryChunk(chunk: Readonly<SpatialChunk>): SpatialQueryResult<TDescriptor> {
    assertChunk(chunk);
    const key = chunkKey(chunk.x, chunk.y);
    const ids = this.buckets.get(key);
    const records = ids
      ? [...ids].map((id) => this.records.get(id)).filter(isDefined)
      : [];
    records.sort(compareRecordsById);
    const counters: SpatialQueryCounters = Object.freeze({
      bucketsExamined: 1,
      bucketEntriesExamined: ids?.size ?? 0,
      entitiesExamined: records.length,
      entitiesMatched: records.length,
    });
    this.addQueryCounters(counters);
    return Object.freeze({
      entities: Object.freeze(records.map((record) => record.descriptor)),
      counters,
    });
  }

  getQueryTotals(): Readonly<SpatialQueryTotals> {
    return Object.freeze({
      queryCount: this.queryCount,
      bucketsExamined: this.totalBucketsExamined,
      bucketEntriesExamined: this.totalBucketEntriesExamined,
      entitiesExamined: this.totalEntitiesExamined,
      entitiesMatched: this.totalEntitiesMatched,
    });
  }

  resetQueryTotals(): void {
    this.queryCount = 0;
    this.totalBucketsExamined = 0;
    this.totalBucketEntriesExamined = 0;
    this.totalEntitiesExamined = 0;
    this.totalEntitiesMatched = 0;
  }

  private collectRadiusCandidates(
    centre: Readonly<SpatialPoint>,
    radius: number,
  ): CandidateCollection<TDescriptor> {
    return this.collectCandidates({
      minX: centre.x - radius,
      minY: centre.y - radius,
      maxX: centre.x + radius,
      maxY: centre.y + radius,
    });
  }

  private collectCandidates(bounds: Readonly<SpatialBounds>): CandidateCollection<TDescriptor> {
    const minChunkX = Math.floor(bounds.minX / this.chunkSize);
    const maxChunkX = Math.floor(bounds.maxX / this.chunkSize);
    const minChunkY = Math.floor(bounds.minY / this.chunkSize);
    const maxChunkY = Math.floor(bounds.maxY / this.chunkSize);
    const candidateIds = new Set<TDescriptor["id"]>();
    let bucketsExamined = 0;
    let bucketEntriesExamined = 0;

    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
        bucketsExamined++;
        const bucket = this.buckets.get(chunkKey(chunkX, chunkY));
        if (!bucket) continue;
        bucketEntriesExamined += bucket.size;
        for (const id of bucket) candidateIds.add(id);
      }
    }

    const records = [...candidateIds]
      .map((id) => this.records.get(id))
      .filter(isDefined);
    return { records, bucketsExamined, bucketEntriesExamined };
  }

  private completeQuery(
    candidates: CandidateCollection<TDescriptor>,
    matched: readonly IndexedEntity<TDescriptor>[],
  ): SpatialQueryResult<TDescriptor> {
    const counters: SpatialQueryCounters = Object.freeze({
      bucketsExamined: candidates.bucketsExamined,
      bucketEntriesExamined: candidates.bucketEntriesExamined,
      entitiesExamined: candidates.records.length,
      entitiesMatched: matched.length,
    });
    this.addQueryCounters(counters);
    return Object.freeze({
      entities: Object.freeze(matched.map((record) => record.descriptor)),
      counters,
    });
  }

  private addQueryCounters(counters: Readonly<SpatialQueryCounters>): void {
    this.queryCount++;
    this.totalBucketsExamined += counters.bucketsExamined;
    this.totalBucketEntriesExamined += counters.bucketEntriesExamined;
    this.totalEntitiesExamined += counters.entitiesExamined;
    this.totalEntitiesMatched += counters.entitiesMatched;
  }

  private createRecord(descriptor: TDescriptor): IndexedEntity<TDescriptor> {
    assertEntityId(descriptor.id);
    const bounds = Object.freeze(copyAndValidateBounds(descriptor.bounds));
    const minChunkX = Math.floor(bounds.minX / this.chunkSize);
    const maxChunkX = Math.floor(bounds.maxX / this.chunkSize);
    const minChunkY = Math.floor(bounds.minY / this.chunkSize);
    const maxChunkY = Math.floor(bounds.maxY / this.chunkSize);
    const columnCount = maxChunkX - minChunkX + 1;
    const rowCount = maxChunkY - minChunkY + 1;
    const chunkCount = columnCount * rowCount;
    if (!Number.isSafeInteger(chunkCount) || chunkCount > this.maxChunksPerEntity) {
      throw new RangeError(
        `Spatial entity ${String(descriptor.id)} intersects ${String(chunkCount)} chunks; maximum is ${this.maxChunksPerEntity}`,
      );
    }

    const chunks: SpatialChunk[] = [];
    const chunkKeys: string[] = [];
    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
        chunks.push(Object.freeze({ x: chunkX, y: chunkY }));
        chunkKeys.push(chunkKey(chunkX, chunkY));
      }
    }
    const centreX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
    const centreY = bounds.minY + (bounds.maxY - bounds.minY) / 2;
    const homeChunk = Object.freeze({
      x: Math.floor(centreX / this.chunkSize),
      y: Math.floor(centreY / this.chunkSize),
    });
    const membership: SpatialEntityMembership<TDescriptor["id"]> = Object.freeze({
      entityId: descriptor.id,
      homeChunk,
      chunks: Object.freeze(chunks),
    });
    return Object.freeze({
      descriptor,
      bounds,
      membership,
      chunkKeys: Object.freeze(chunkKeys),
    });
  }

  private changedMutation(
    kind: Exclude<SpatialIndexMutation<TDescriptor["id"]>["kind"], "none" | "built">,
    changedEntityIds: readonly TDescriptor["id"][],
    changedChunks: readonly Readonly<SpatialChunk>[],
  ): SpatialIndexMutation<TDescriptor["id"]> {
    const previousRevision = this.revisionValue;
    this.revisionValue++;
    return mutation(
      kind,
      previousRevision,
      this.revisionValue,
      sortedIds(changedEntityIds),
      sortedChunkUnion(changedChunks),
    );
  }

  private unchangedMutation(): SpatialIndexMutation<TDescriptor["id"]> {
    return mutation("none", this.revisionValue, this.revisionValue, [], []);
  }
}

function addRecordToBuckets<TDescriptor extends SpatialEntityDescriptor>(
  buckets: Map<string, Set<TDescriptor["id"]>>,
  record: IndexedEntity<TDescriptor>,
): void {
  for (const key of record.chunkKeys) {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = new Set<TDescriptor["id"]>();
      buckets.set(key, bucket);
    }
    bucket.add(record.descriptor.id);
  }
}

function removeRecordFromBuckets<TDescriptor extends SpatialEntityDescriptor>(
  buckets: Map<string, Set<TDescriptor["id"]>>,
  record: IndexedEntity<TDescriptor>,
): void {
  for (const key of record.chunkKeys) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.delete(record.descriptor.id);
    if (bucket.size === 0) buckets.delete(key);
  }
}

function mutation<TId extends SpatialEntityId>(
  kind: SpatialIndexMutation<TId>["kind"],
  previousRevision: number,
  revision: number,
  changedEntityIds: readonly TId[],
  changedChunks: readonly Readonly<SpatialChunk>[],
): SpatialIndexMutation<TId> {
  return Object.freeze({
    kind,
    previousRevision,
    revision,
    changedEntityIds: Object.freeze([...changedEntityIds]),
    changedChunks: Object.freeze([...changedChunks]),
  });
}

function sortedChunksFromRecords<TDescriptor extends SpatialEntityDescriptor>(
  records: Iterable<IndexedEntity<TDescriptor>>,
): readonly Readonly<SpatialChunk>[] {
  const chunks: SpatialChunk[] = [];
  for (const record of records) chunks.push(...record.membership.chunks);
  return sortedChunkUnion(chunks);
}

function sortedChunkUnion(
  ...groups: readonly (readonly Readonly<SpatialChunk>[])[]
): readonly Readonly<SpatialChunk>[] {
  const byKey = new Map<string, Readonly<SpatialChunk>>();
  for (const group of groups) {
    for (const chunk of group) byKey.set(chunkKey(chunk.x, chunk.y), chunk);
  }
  return Object.freeze([...byKey.values()].sort(compareChunks));
}

function sortedIds<TId extends SpatialEntityId>(ids: Iterable<TId>): readonly TId[] {
  return Object.freeze([...ids].sort(compareEntityIds));
}

function compareRecordsById<TDescriptor extends SpatialEntityDescriptor>(
  left: IndexedEntity<TDescriptor>,
  right: IndexedEntity<TDescriptor>,
): number {
  return compareEntityIds(left.descriptor.id, right.descriptor.id);
}

function compareEntityIds(left: SpatialEntityId, right: SpatialEntityId): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "number") return -1;
  if (typeof right === "number") return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareChunks(left: Readonly<SpatialChunk>, right: Readonly<SpatialChunk>): number {
  return left.y - right.y || left.x - right.x;
}

function chunkKey(x: number, y: number): string {
  return `${x},${y}`;
}

function containsPoint(bounds: Readonly<SpatialBounds>, point: Readonly<SpatialPoint>): boolean {
  return point.x >= bounds.minX
    && point.x <= bounds.maxX
    && point.y >= bounds.minY
    && point.y <= bounds.maxY;
}

function intersectsBounds(left: Readonly<SpatialBounds>, right: Readonly<SpatialBounds>): boolean {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minY <= right.maxY
    && left.maxY >= right.minY;
}

function distanceToBoundsSquared(point: Readonly<SpatialPoint>, bounds: Readonly<SpatialBounds>): number {
  const dx = point.x < bounds.minX
    ? bounds.minX - point.x
    : point.x > bounds.maxX ? point.x - bounds.maxX : 0;
  const dy = point.y < bounds.minY
    ? bounds.minY - point.y
    : point.y > bounds.maxY ? point.y - bounds.maxY : 0;
  return dx * dx + dy * dy;
}

function sameBounds(left: Readonly<SpatialBounds>, right: Readonly<SpatialBounds>): boolean {
  return left.minX === right.minX
    && left.minY === right.minY
    && left.maxX === right.maxX
    && left.maxY === right.maxY;
}

function copyAndValidateBounds(bounds: Readonly<SpatialBounds>): SpatialBounds {
  const copy = {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
  for (const [name, value] of Object.entries(copy)) assertFinite(value, `bounds.${name}`);
  if (copy.minX > copy.maxX || copy.minY > copy.maxY) {
    throw new RangeError("Spatial bounds minimums cannot exceed maximums");
  }
  return copy;
}

function assertPoint(point: Readonly<SpatialPoint>): void {
  assertFinite(point.x, "point.x");
  assertFinite(point.y, "point.y");
}

function assertChunk(chunk: Readonly<SpatialChunk>): void {
  if (!Number.isSafeInteger(chunk.x) || !Number.isSafeInteger(chunk.y)) {
    throw new RangeError("Chunk coordinates must be safe integers");
  }
}

function assertEntityId(id: SpatialEntityId): void {
  if (typeof id === "string") {
    if (id.length === 0) throw new RangeError("Spatial entity IDs cannot be empty");
    return;
  }
  if (!Number.isSafeInteger(id) || Object.is(id, -0)) {
    throw new RangeError("Numeric spatial entity IDs must be safe integers other than negative zero");
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertPositiveFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

function assertNonNegativeFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) throw new RangeError(`${name} cannot be negative`);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
