import type { WorldTopology } from "../WorldTopology";
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
  readonly sourceBounds: Readonly<SpatialBounds>;
  readonly footprint: readonly Readonly<SpatialBounds>[];
  readonly membership: SpatialEntityMembership<TDescriptor["id"]>;
  readonly chunkKeys: readonly string[];
}

interface CandidateCollection<TDescriptor extends SpatialEntityDescriptor> {
  readonly records: readonly IndexedEntity<TDescriptor>[];
  readonly bucketsExamined: number;
  readonly bucketEntriesExamined: number;
}

interface AxisInterval {
  readonly minimum: number;
  readonly maximum: number;
}

const DEFAULT_MAX_CHUNKS_PER_ENTITY = 65_536;

/**
 * Deterministic canonical chunk-bucket index for durable world descriptors.
 *
 * A descriptor supplies one lifted, closed integer bounds rectangle. The index
 * validates it against the explicit world topology and privately decomposes it
 * into one to four canonical pieces. Descriptor IDs and objects remain single
 * authoritative identities even when several pieces or query images touch the
 * same buckets.
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

  readonly topology: WorldTopology;
  readonly chunkSize: number;
  readonly maxChunksPerEntity: number;

  constructor(options: Readonly<WorldSpatialIndexOptions>) {
    this.topology = options.topology;
    this.chunkSize = options.topology.chunkSize;
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
    if (previous.descriptor === descriptor && sameBounds(previous.sourceBounds, descriptor.bounds)) {
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

  /** Finds descriptors whose canonical periodic footprint contains the point. */
  queryPoint(point: Readonly<SpatialPoint>): SpatialQueryResult<TDescriptor> {
    assertPoint(point);
    const normalized = this.normalizeQueryPoint(point);
    const pieces = this.decomposeQueryBounds({
      minX: normalized.x,
      minY: normalized.y,
      maxX: normalized.x,
      maxY: normalized.y,
    });
    const candidates = this.collectCandidates(pieces);
    const matched = candidates.records
      .filter((record) => record.footprint.some((piece) => containsPoint(piece, normalized)))
      .sort(compareRecordsById);
    return this.completeQuery(candidates, matched);
  }

  /** Finds descriptors whose footprint intersects the closed periodic region. */
  queryBounds(bounds: Readonly<SpatialBounds>): SpatialQueryResult<TDescriptor> {
    const normalized = copyAndValidateQueryBounds(bounds);
    const pieces = this.decomposeQueryBounds(normalized);
    const candidates = this.collectCandidates(pieces);
    const matched = candidates.records
      .filter((record) => footprintsIntersect(record.footprint, pieces))
      .sort(compareRecordsById);
    return this.completeQuery(candidates, matched);
  }

  /** Finds descriptors whose footprint is at most radius units from the centre. */
  queryRadius(centre: Readonly<SpatialPoint>, radius: number): SpatialQueryResult<TDescriptor> {
    assertPoint(centre);
    assertNonNegativeFinite(radius, "radius");
    const normalizedCentre = this.normalizeQueryPoint(centre);
    const candidates = this.collectRadiusCandidates(normalizedCentre, radius);
    const radiusSquared = radius * radius;
    const matched = candidates.records
      .filter((record) => this.distanceToFootprintSquared(normalizedCentre, record.footprint) <= radiusSquared)
      .sort(compareRecordsById);
    return this.completeQuery(candidates, matched);
  }

  /**
   * Radius query ordered nearest-first, with entity ID as a stable tie-breaker.
   * The limit is applied after ID deduplication, exact periodic filtering, and
   * deterministic sorting.
   */
  queryNearby(
    centre: Readonly<SpatialPoint>,
    radius: number,
    limit = Number.MAX_SAFE_INTEGER,
  ): SpatialQueryResult<TDescriptor> {
    assertPoint(centre);
    assertNonNegativeFinite(radius, "radius");
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("limit must be a non-negative safe integer");
    const normalizedCentre = this.normalizeQueryPoint(centre);
    const candidates = this.collectRadiusCandidates(normalizedCentre, radius);
    const radiusSquared = radius * radius;
    const matched = candidates.records
      .map((record) => Object.freeze({
        record,
        distanceSquared: this.distanceToFootprintSquared(normalizedCentre, record.footprint),
      }))
      .filter(({ distanceSquared }) => distanceSquared <= radiusSquared)
      .sort((left, right) => (
        left.distanceSquared - right.distanceSquared
        || compareEntityIds(left.record.descriptor.id, right.record.descriptor.id)
      ))
      .slice(0, limit)
      .map(({ record }) => record);
    return this.completeQuery(candidates, matched);
  }

  /** Returns descriptors intersecting one canonical bucket or periodic alias. */
  queryChunk(chunk: Readonly<SpatialChunk>): SpatialQueryResult<TDescriptor> {
    assertChunk(chunk);
    const canonicalX = canonicalizeDiscreteAxis(
      chunk.x,
      this.topology.chunkColumns,
      this.topology.wrapsX,
    );
    const canonicalY = canonicalizeDiscreteAxis(
      chunk.y,
      this.topology.chunkRows,
      this.topology.wrapsY,
    );
    if (canonicalX === undefined || canonicalY === undefined) {
      return this.completeQuery({ records: [], bucketsExamined: 0, bucketEntriesExamined: 0 }, []);
    }

    const ids = this.buckets.get(chunkKey(canonicalX, canonicalY));
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
    return this.collectCandidates(this.decomposeQueryBounds({
      minX: centre.x - radius,
      minY: centre.y - radius,
      maxX: centre.x + radius,
      maxY: centre.y + radius,
    }));
  }

  private collectCandidates(
    pieces: readonly Readonly<SpatialBounds>[],
  ): CandidateCollection<TDescriptor> {
    const chunks = this.canonicalChunksForPieces(pieces);
    const candidateIds = new Set<TDescriptor["id"]>();
    let bucketEntriesExamined = 0;

    for (const chunk of chunks) {
      const bucket = this.buckets.get(chunkKey(chunk.x, chunk.y));
      if (!bucket) continue;
      bucketEntriesExamined += bucket.size;
      for (const id of bucket) candidateIds.add(id);
    }

    const records = [...candidateIds]
      .map((id) => this.records.get(id))
      .filter(isDefined);
    return {
      records,
      bucketsExamined: chunks.length,
      bucketEntriesExamined,
    };
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
    const sourceBounds = Object.freeze(copyAndValidateDescriptorBounds(descriptor.bounds));
    this.assertDescriptorAxis(sourceBounds.minX, sourceBounds.maxX, this.topology.tileWidth, this.topology.wrapsX, "x");
    this.assertDescriptorAxis(sourceBounds.minY, sourceBounds.maxY, this.topology.tileHeight, this.topology.wrapsY, "y");

    const footprint = Object.freeze(this.topology.decomposeTileBounds(sourceBounds)
      .map((piece) => Object.freeze({ ...piece }))
      .sort(compareBoundsRowMajor));
    if (footprint.length < 1 || footprint.length > 4) {
      throw new RangeError(`Spatial entity ${String(descriptor.id)} must have one to four canonical footprint pieces`);
    }

    const chunks = this.canonicalChunksForPieces(footprint);
    if (chunks.length > this.maxChunksPerEntity) {
      throw new RangeError(
        `Spatial entity ${String(descriptor.id)} intersects ${String(chunks.length)} chunks; maximum is ${this.maxChunksPerEntity}`,
      );
    }

    const centre = this.normalizeQueryPoint({
      x: sourceBounds.minX + (sourceBounds.maxX - sourceBounds.minX) / 2,
      y: sourceBounds.minY + (sourceBounds.maxY - sourceBounds.minY) / 2,
    });
    const canonicalCentre = Object.freeze({ ...centre });
    const homeChunk = Object.freeze({
      x: Math.floor(canonicalCentre.x / this.chunkSize),
      y: Math.floor(canonicalCentre.y / this.chunkSize),
    });
    const membership: SpatialEntityMembership<TDescriptor["id"]> = Object.freeze({
      entityId: descriptor.id,
      canonicalCentre,
      footprint,
      homeChunk,
      chunks,
    });
    return Object.freeze({
      descriptor,
      sourceBounds,
      footprint,
      membership,
      chunkKeys: Object.freeze(chunks.map((chunk) => chunkKey(chunk.x, chunk.y))),
    });
  }

  private assertDescriptorAxis(
    minimum: number,
    maximum: number,
    span: number,
    wraps: boolean,
    axis: "x" | "y",
  ): void {
    if (wraps) {
      if (maximum - minimum >= span) {
        throw new RangeError(`Spatial descriptor ${axis}-footprint must be strictly smaller than world span ${span}`);
      }
      return;
    }
    if (minimum < 0 || maximum >= span) {
      throw new RangeError(`Spatial descriptor ${axis}-bounds must stay inside bounded world span 0..${span - 1}`);
    }
  }

  private normalizeQueryPoint(point: Readonly<SpatialPoint>): SpatialPoint {
    return {
      x: this.topology.wrapsX ? positiveModulo(point.x, this.topology.tileWidth) : point.x,
      y: this.topology.wrapsY ? positiveModulo(point.y, this.topology.tileHeight) : point.y,
    };
  }

  private decomposeQueryBounds(bounds: Readonly<SpatialBounds>): readonly Readonly<SpatialBounds>[] {
    const xPieces = decomposeClosedInterval(
      bounds.minX,
      bounds.maxX,
      this.topology.tileWidth,
      this.topology.wrapsX,
    );
    const yPieces = decomposeClosedInterval(
      bounds.minY,
      bounds.maxY,
      this.topology.tileHeight,
      this.topology.wrapsY,
    );
    const pieces: SpatialBounds[] = [];
    for (const yPiece of yPieces) {
      for (const xPiece of xPieces) {
        pieces.push(Object.freeze({
          minX: xPiece.minimum,
          minY: yPiece.minimum,
          maxX: xPiece.maximum,
          maxY: yPiece.maximum,
        }));
      }
    }
    return Object.freeze(pieces.sort(compareBoundsRowMajor));
  }

  private canonicalChunksForPieces(
    pieces: readonly Readonly<SpatialBounds>[],
  ): readonly Readonly<SpatialChunk>[] {
    const chunksByKey = new Map<string, Readonly<SpatialChunk>>();
    for (const piece of pieces) {
      const minChunkX = clamp(Math.floor(piece.minX / this.chunkSize), 0, this.topology.chunkColumns - 1);
      const maxChunkX = clamp(Math.floor(piece.maxX / this.chunkSize), 0, this.topology.chunkColumns - 1);
      const minChunkY = clamp(Math.floor(piece.minY / this.chunkSize), 0, this.topology.chunkRows - 1);
      const maxChunkY = clamp(Math.floor(piece.maxY / this.chunkSize), 0, this.topology.chunkRows - 1);
      if (minChunkX > maxChunkX || minChunkY > maxChunkY) continue;
      for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
        for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
          const key = chunkKey(chunkX, chunkY);
          if (!chunksByKey.has(key)) chunksByKey.set(key, Object.freeze({ x: chunkX, y: chunkY }));
        }
      }
    }
    return Object.freeze([...chunksByKey.values()].sort(compareChunks));
  }

  private distanceToFootprintSquared(
    point: Readonly<SpatialPoint>,
    footprint: readonly Readonly<SpatialBounds>[],
  ): number {
    let minimum = Number.POSITIVE_INFINITY;
    for (const bounds of footprint) {
      const dx = distanceToInterval(
        point.x,
        bounds.minX,
        bounds.maxX,
        this.topology.tileWidth,
        this.topology.wrapsX,
      );
      const dy = distanceToInterval(
        point.y,
        bounds.minY,
        bounds.maxY,
        this.topology.tileHeight,
        this.topology.wrapsY,
      );
      minimum = Math.min(minimum, dx * dx + dy * dy);
    }
    return minimum;
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

function compareBoundsRowMajor(left: Readonly<SpatialBounds>, right: Readonly<SpatialBounds>): number {
  return left.minY - right.minY
    || left.minX - right.minX
    || left.maxY - right.maxY
    || left.maxX - right.maxX;
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

function footprintsIntersect(
  left: readonly Readonly<SpatialBounds>[],
  right: readonly Readonly<SpatialBounds>[],
): boolean {
  return left.some((leftPiece) => right.some((rightPiece) => intersectsBounds(leftPiece, rightPiece)));
}

function intersectsBounds(left: Readonly<SpatialBounds>, right: Readonly<SpatialBounds>): boolean {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minY <= right.maxY
    && left.maxY >= right.minY;
}

function distanceToInterval(
  value: number,
  minimum: number,
  maximum: number,
  span: number,
  wraps: boolean,
): number {
  let result = planarDistanceToInterval(value, minimum, maximum);
  if (!wraps) return result;
  result = Math.min(result, planarDistanceToInterval(value, minimum - span, maximum - span));
  return Math.min(result, planarDistanceToInterval(value, minimum + span, maximum + span));
}

function planarDistanceToInterval(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
}

function sameBounds(left: Readonly<SpatialBounds>, right: Readonly<SpatialBounds>): boolean {
  return left.minX === right.minX
    && left.minY === right.minY
    && left.maxX === right.maxX
    && left.maxY === right.maxY;
}

function copyAndValidateDescriptorBounds(bounds: Readonly<SpatialBounds>): SpatialBounds {
  const copy = copyAndValidateQueryBounds(bounds);
  for (const [name, value] of Object.entries(copy)) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`bounds.${name} must be a safe integer`);
  }
  return copy;
}

function copyAndValidateQueryBounds(bounds: Readonly<SpatialBounds>): SpatialBounds {
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

function decomposeClosedInterval(
  minimum: number,
  maximum: number,
  span: number,
  wraps: boolean,
): readonly AxisInterval[] {
  if (!wraps) {
    const clippedMinimum = Math.max(0, minimum);
    const clippedMaximum = Math.min(span - 1, maximum);
    return clippedMinimum <= clippedMaximum
      ? [Object.freeze({ minimum: clippedMinimum, maximum: clippedMaximum })]
      : [];
  }

  const extent = maximum - minimum;
  if (extent >= span) return [Object.freeze({ minimum: 0, maximum: span - 1 })];
  const start = positiveModulo(minimum, span);
  const end = start + extent;
  if (end < span) return [Object.freeze({ minimum: start, maximum: end })];
  return [
    Object.freeze({ minimum: start, maximum: span }),
    Object.freeze({ minimum: 0, maximum: end - span }),
  ];
}

function canonicalizeDiscreteAxis(value: number, span: number, wraps: boolean): number | undefined {
  if (value >= 0 && value < span) return value;
  return wraps ? positiveModulo(value, span) : undefined;
}

function positiveModulo(value: number, span: number): number {
  const remainder = value % span;
  if (Object.is(remainder, -0)) return 0;
  const normalized = remainder < 0 ? remainder + span : remainder;
  // Adding a negative sub-ulp remainder can round back to the span. Preserve
  // the topology's half-open canonical interval instead of leaking its edge.
  return normalized === span ? 0 : normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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

function assertNonNegativeFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) throw new RangeError(`${name} cannot be negative`);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
