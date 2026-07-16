export interface PresentationChunkCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface ChunkActivatedViewPoolOptions<
  TId extends string | number,
  TRecord,
  TView,
> {
  readonly idOf: (record: Readonly<TRecord>) => TId;
  readonly chunkOf: (record: Readonly<TRecord>) => Readonly<PresentationChunkCoordinate>;
  readonly create: (record: Readonly<TRecord>) => TView;
  readonly update: (view: TView, record: Readonly<TRecord>) => void;
  readonly activate: (view: TView, record: Readonly<TRecord>) => void;
  readonly deactivate: (view: TView) => void;
  readonly destroy: (view: TView) => void;
  /** Cheap inactive views retained for reuse. Defaults to 32. */
  readonly maxPooledViews?: number;
}

export interface ChunkActivatedViewTelemetry {
  readonly records: number;
  readonly activeChunks: number;
  readonly activeViews: number;
  readonly pooledViews: number;
  readonly retainedViews: number;
  readonly peakActiveViews: number;
  readonly peakRetainedViews: number;
  readonly createdViews: number;
  readonly reusedViews: number;
  readonly activations: number;
  readonly deactivations: number;
  readonly destroyedViews: number;
  readonly poolEvictions: number;
}

/**
 * Keeps renderer-owned views proportional to a caller-selected chunk set.
 *
 * The controller is intentionally unaware of Phaser and authoritative world
 * storage. Records may cover the whole known world while only records in the
 * active presentation chunks own views. Identity is exact, so activation churn
 * cannot create duplicate views for one record.
 */
export class ChunkActivatedViewPool<
  TId extends string | number,
  TRecord,
  TView,
> {
  private readonly options: ChunkActivatedViewPoolOptions<TId, TRecord, TView>;
  private readonly maxPooledViews: number;

  private recordsById = new Map<TId, Readonly<TRecord>>();
  private recordIdsByChunk = new Map<string, TId[]>();
  private activeChunkKeys: readonly string[] = Object.freeze([]);
  private activeChunkKeySet = new Set<string>();
  private readonly viewsById = new Map<TId, TView>();
  private readonly pooledViews: TView[] = [];

  private peakActiveViews = 0;
  private peakRetainedViews = 0;
  private createdViews = 0;
  private reusedViews = 0;
  private activations = 0;
  private deactivations = 0;
  private destroyedViews = 0;
  private poolEvictions = 0;

  constructor(options: ChunkActivatedViewPoolOptions<TId, TRecord, TView>) {
    const maxPooledViews = options.maxPooledViews ?? 32;
    if (!Number.isSafeInteger(maxPooledViews) || maxPooledViews < 0) {
      throw new RangeError("maxPooledViews must be a non-negative safe integer");
    }
    this.options = options;
    this.maxPooledViews = maxPooledViews;
  }

  /** Replaces the record snapshot without changing active chunk membership. */
  sync(records: readonly Readonly<TRecord>[]): void {
    const nextRecordsById = new Map<TId, Readonly<TRecord>>();
    const nextRecordIdsByChunk = new Map<string, TId[]>();

    for (const record of records) {
      const id = this.options.idOf(record);
      if (nextRecordsById.has(id)) throw new RangeError(`Duplicate presentation record ID: ${String(id)}`);
      const coordinate = this.options.chunkOf(record);
      assertChunkCoordinate(coordinate);
      const chunkKey = presentationChunkKey(coordinate.x, coordinate.y);
      nextRecordsById.set(id, record);
      const ids = nextRecordIdsByChunk.get(chunkKey) ?? [];
      ids.push(id);
      nextRecordIdsByChunk.set(chunkKey, ids);
    }

    this.recordsById = nextRecordsById;
    this.recordIdsByChunk = nextRecordIdsByChunk;

    for (const [id] of this.viewsById) {
      const record = nextRecordsById.get(id);
      if (!record || !this.recordIsActive(record)) this.releaseView(id);
    }

    this.materializeActiveRecords();
    this.updatePeaks();
  }

  /**
   * Applies exact active presentation chunks. Input order is the deterministic
   * materialization priority (normally ActiveChunkSet load priority).
   */
  setActiveChunks(chunks: Iterable<Readonly<PresentationChunkCoordinate>>): void {
    const nextKeys: string[] = [];
    const nextKeySet = new Set<string>();
    for (const coordinate of chunks) {
      assertChunkCoordinate(coordinate);
      const key = presentationChunkKey(coordinate.x, coordinate.y);
      if (nextKeySet.has(key)) continue;
      nextKeySet.add(key);
      nextKeys.push(key);
    }

    if (sameOrderedKeys(this.activeChunkKeys, nextKeys)) return;
    this.activeChunkKeys = Object.freeze(nextKeys);
    this.activeChunkKeySet = nextKeySet;

    for (const [id] of this.viewsById) {
      const record = this.recordsById.get(id);
      if (!record || !this.recordIsActive(record)) this.releaseView(id);
    }
    this.materializeActiveRecords();
    this.updatePeaks();
  }

  clearActiveChunks(): void {
    this.setActiveChunks([]);
  }

  getTelemetry(): Readonly<ChunkActivatedViewTelemetry> {
    return Object.freeze({
      records: this.recordsById.size,
      activeChunks: this.activeChunkKeys.length,
      activeViews: this.viewsById.size,
      pooledViews: this.pooledViews.length,
      retainedViews: this.viewsById.size + this.pooledViews.length,
      peakActiveViews: this.peakActiveViews,
      peakRetainedViews: this.peakRetainedViews,
      createdViews: this.createdViews,
      reusedViews: this.reusedViews,
      activations: this.activations,
      deactivations: this.deactivations,
      destroyedViews: this.destroyedViews,
      poolEvictions: this.poolEvictions,
    });
  }

  destroy(): void {
    for (const view of this.viewsById.values()) {
      this.options.destroy(view);
      this.destroyedViews++;
    }
    for (const view of this.pooledViews) {
      this.options.destroy(view);
      this.destroyedViews++;
    }
    this.viewsById.clear();
    this.pooledViews.length = 0;
    this.recordsById.clear();
    this.recordIdsByChunk.clear();
    this.activeChunkKeys = Object.freeze([]);
    this.activeChunkKeySet.clear();
  }

  private materializeActiveRecords(): void {
    for (const chunkKey of this.activeChunkKeys) {
      for (const id of this.recordIdsByChunk.get(chunkKey) ?? []) {
        const record = this.recordsById.get(id);
        if (!record) continue;
        const existing = this.viewsById.get(id);
        if (existing) {
          this.options.update(existing, record);
          continue;
        }

        const reused = this.pooledViews.length > 0;
        const view = reused ? this.pooledViews.pop() as TView : this.createView(record);
        if (reused) this.reusedViews++;
        this.options.activate(view, record);
        this.options.update(view, record);
        this.viewsById.set(id, view);
        this.activations++;
      }
    }
  }

  private createView(record: Readonly<TRecord>): TView {
    const view = this.options.create(record);
    this.createdViews++;
    return view;
  }

  private releaseView(id: TId): void {
    const view = this.viewsById.get(id);
    if (!view) return;
    this.viewsById.delete(id);
    this.options.deactivate(view);
    this.deactivations++;
    if (this.pooledViews.length < this.maxPooledViews) {
      this.pooledViews.push(view);
    } else {
      this.options.destroy(view);
      this.destroyedViews++;
      this.poolEvictions++;
    }
  }

  private recordIsActive(record: Readonly<TRecord>): boolean {
    const coordinate = this.options.chunkOf(record);
    return this.activeChunkKeySet.has(presentationChunkKey(coordinate.x, coordinate.y));
  }

  private updatePeaks(): void {
    this.peakActiveViews = Math.max(this.peakActiveViews, this.viewsById.size);
    this.peakRetainedViews = Math.max(
      this.peakRetainedViews,
      this.viewsById.size + this.pooledViews.length,
    );
  }
}

export function presentationChunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX},${chunkY}`;
}

/** Inclusive chunk coordinates intersecting pixel-space bounds. */
export function presentationChunksForWorldBounds(
  bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
  chunkPixelSize: number,
): readonly Readonly<PresentationChunkCoordinate>[] {
  if (!Number.isFinite(chunkPixelSize) || chunkPixelSize <= 0) {
    throw new RangeError("chunkPixelSize must be positive and finite");
  }
  for (const [label, value] of Object.entries(bounds)) {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new RangeError("world bounds minimums cannot exceed maximums");
  }

  const minChunkX = Math.floor(bounds.minX / chunkPixelSize);
  const minChunkY = Math.floor(bounds.minY / chunkPixelSize);
  const maxChunkX = Math.floor(bounds.maxX / chunkPixelSize);
  const maxChunkY = Math.floor(bounds.maxY / chunkPixelSize);
  const chunks: PresentationChunkCoordinate[] = [];
  for (let y = minChunkY; y <= maxChunkY; y++) {
    for (let x = minChunkX; x <= maxChunkX; x++) chunks.push(Object.freeze({ x, y }));
  }
  return Object.freeze(chunks);
}

function assertChunkCoordinate(coordinate: Readonly<PresentationChunkCoordinate>): void {
  if (!Number.isSafeInteger(coordinate.x) || !Number.isSafeInteger(coordinate.y)) {
    throw new RangeError("presentation chunk coordinates must be safe integers");
  }
}

function sameOrderedKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}
