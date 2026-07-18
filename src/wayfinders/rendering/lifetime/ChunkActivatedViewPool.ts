export interface PresentationChunkCoordinate {
  readonly x: number;
  readonly y: number;
}

/** One lifted presentation image of a canonical chunk. */
export interface PresentationChunkImage {
  readonly viewKey: string;
  readonly canonicalChunk: Readonly<PresentationChunkCoordinate>;
  readonly imageOffset: Readonly<PresentationChunkCoordinate>;
}

export interface ChunkActivatedViewPoolOptions<
  TId extends string | number,
  TRecord,
  TView,
> {
  readonly idOf: (record: Readonly<TRecord>) => TId;
  readonly chunkOf: (record: Readonly<TRecord>) => Readonly<PresentationChunkCoordinate>;
  readonly create: (
    record: Readonly<TRecord>,
    image: Readonly<PresentationChunkImage>,
  ) => TView;
  readonly update: (
    view: TView,
    record: Readonly<TRecord>,
    image: Readonly<PresentationChunkImage>,
  ) => void;
  readonly activate: (
    view: TView,
    record: Readonly<TRecord>,
    image: Readonly<PresentationChunkImage>,
  ) => void;
  readonly deactivate: (view: TView) => void;
  readonly destroy: (view: TView) => void;
  /** Cheap inactive views retained for reuse. Defaults to 32. */
  readonly maxPooledViews?: number;
}

export interface ChunkActivatedViewTelemetry {
  readonly records: number;
  /** Periodic image entries, not distinct canonical chunks. */
  readonly activeChunks: number;
  /** One record may own one view in each active image of its canonical chunk. */
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

interface ActiveView<TView> {
  readonly view: TView;
  readonly image: Readonly<PresentationChunkImage>;
}

/**
 * Keeps renderer-owned views proportional to a caller-selected periodic image
 * set. Records and state remain canonical while each active image receives an
 * independent, offset view. A pooled view never retains record authority.
 */
export class ChunkActivatedViewPool<
  TId extends string | number,
  TRecord,
  TView,
> {
  private readonly options: ChunkActivatedViewPoolOptions<TId, TRecord, TView>;
  private readonly maxPooledViews: number;

  private recordsById = new Map<TId, Readonly<TRecord>>();
  private recordIdsByCanonicalChunk = new Map<string, TId[]>();
  private activeImages: readonly Readonly<PresentationChunkImage>[] = Object.freeze([]);
  private readonly viewsById = new Map<TId, Map<string, ActiveView<TView>>>();
  private readonly pooledViews: TView[] = [];
  private activeViewCount = 0;

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

  /** Replaces the canonical record snapshot without changing image membership. */
  sync(records: readonly Readonly<TRecord>[]): void {
    const nextRecordsById = new Map<TId, Readonly<TRecord>>();
    const nextRecordIdsByCanonicalChunk = new Map<string, TId[]>();

    for (const record of records) {
      const id = this.options.idOf(record);
      if (nextRecordsById.has(id)) throw new RangeError(`Duplicate presentation record ID: ${String(id)}`);
      const coordinate = this.options.chunkOf(record);
      assertChunkCoordinate(coordinate);
      const chunkKey = presentationChunkKey(coordinate.x, coordinate.y);
      nextRecordsById.set(id, record);
      const ids = nextRecordIdsByCanonicalChunk.get(chunkKey) ?? [];
      ids.push(id);
      nextRecordIdsByCanonicalChunk.set(chunkKey, ids);
    }

    this.recordsById = nextRecordsById;
    this.recordIdsByCanonicalChunk = nextRecordIdsByCanonicalChunk;

    for (const [id, views] of [...this.viewsById]) {
      const record = nextRecordsById.get(id);
      for (const [viewKey, activeView] of [...views]) {
        if (!record || !this.recordBelongsToImage(record, activeView.image)) {
          this.releaseView(id, viewKey);
        }
      }
    }

    this.materializeActiveRecords();
    this.updatePeaks();
  }

  /**
   * Applies exact active periodic images. Input order is deterministic
   * materialization priority (normally ActiveChunkSet load priority).
   */
  setActiveChunkImages(images: Iterable<Readonly<PresentationChunkImage>>): void {
    const nextImages: Readonly<PresentationChunkImage>[] = [];
    const nextByKey = new Map<string, Readonly<PresentationChunkImage>>();
    for (const image of images) {
      assertChunkImage(image);
      if (nextByKey.has(image.viewKey)) {
        throw new RangeError(`Duplicate presentation image key: ${image.viewKey}`);
      }
      const frozen = freezeImage(image);
      nextByKey.set(frozen.viewKey, frozen);
      nextImages.push(frozen);
    }

    if (sameOrderedImages(this.activeImages, nextImages)) return;
    this.activeImages = Object.freeze(nextImages);

    for (const [id, views] of [...this.viewsById]) {
      const record = this.recordsById.get(id);
      for (const [viewKey, activeView] of [...views]) {
        const nextImage = nextByKey.get(viewKey);
        if (!record || !nextImage || !this.recordBelongsToImage(record, nextImage)) {
          this.releaseView(id, viewKey);
        } else if (!sameImage(activeView.image, nextImage)) {
          this.releaseView(id, viewKey);
        }
      }
    }
    this.materializeActiveRecords();
    this.updatePeaks();
  }

  getTelemetry(): Readonly<ChunkActivatedViewTelemetry> {
    return Object.freeze({
      records: this.recordsById.size,
      activeChunks: this.activeImages.length,
      activeViews: this.activeViewCount,
      pooledViews: this.pooledViews.length,
      retainedViews: this.activeViewCount + this.pooledViews.length,
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

  /** Visits only materialized image views; never scans inactive world records. */
  forEachActive(
    visitor: (
      view: TView,
      record: Readonly<TRecord>,
      image: Readonly<PresentationChunkImage>,
    ) => void,
  ): void {
    for (const [id, views] of this.viewsById) {
      const record = this.recordsById.get(id);
      if (!record) continue;
      for (const { view, image } of views.values()) visitor(view, record, image);
    }
  }

  destroy(): void {
    for (const views of this.viewsById.values()) {
      for (const { view } of views.values()) {
        this.options.destroy(view);
        this.destroyedViews++;
      }
    }
    for (const view of this.pooledViews) {
      this.options.destroy(view);
      this.destroyedViews++;
    }
    this.viewsById.clear();
    this.activeViewCount = 0;
    this.pooledViews.length = 0;
    this.recordsById.clear();
    this.recordIdsByCanonicalChunk.clear();
    this.activeImages = Object.freeze([]);
  }

  private materializeActiveRecords(): void {
    for (const image of this.activeImages) {
      const chunkKey = presentationChunkKey(image.canonicalChunk.x, image.canonicalChunk.y);
      for (const id of this.recordIdsByCanonicalChunk.get(chunkKey) ?? []) {
        const record = this.recordsById.get(id);
        if (!record) continue;
        const views = this.viewsById.get(id) ?? new Map<string, ActiveView<TView>>();
        const existing = views.get(image.viewKey);
        if (existing) {
          this.options.update(existing.view, record, image);
          continue;
        }

        const reused = this.pooledViews.length > 0;
        const view = reused
          ? this.pooledViews.pop() as TView
          : this.createView(record, image);
        if (reused) this.reusedViews++;
        this.options.activate(view, record, image);
        this.options.update(view, record, image);
        views.set(image.viewKey, { view, image });
        this.viewsById.set(id, views);
        this.activeViewCount++;
        this.activations++;
      }
    }
  }

  private createView(record: Readonly<TRecord>, image: Readonly<PresentationChunkImage>): TView {
    const view = this.options.create(record, image);
    this.createdViews++;
    return view;
  }

  private releaseView(id: TId, viewKey: string): void {
    const views = this.viewsById.get(id);
    const activeView = views?.get(viewKey);
    if (!views || !activeView) return;
    views.delete(viewKey);
    if (views.size === 0) this.viewsById.delete(id);
    this.activeViewCount--;
    this.options.deactivate(activeView.view);
    this.deactivations++;
    if (this.pooledViews.length < this.maxPooledViews) {
      this.pooledViews.push(activeView.view);
    } else {
      this.options.destroy(activeView.view);
      this.destroyedViews++;
      this.poolEvictions++;
    }
  }

  private recordBelongsToImage(
    record: Readonly<TRecord>,
    image: Readonly<PresentationChunkImage>,
  ): boolean {
    const coordinate = this.options.chunkOf(record);
    return coordinate.x === image.canonicalChunk.x && coordinate.y === image.canonicalChunk.y;
  }

  private updatePeaks(): void {
    this.peakActiveViews = Math.max(this.peakActiveViews, this.activeViewCount);
    this.peakRetainedViews = Math.max(
      this.peakRetainedViews,
      this.activeViewCount + this.pooledViews.length,
    );
  }
}

function presentationChunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX},${chunkY}`;
}

function assertChunkCoordinate(coordinate: Readonly<PresentationChunkCoordinate>): void {
  if (!Number.isSafeInteger(coordinate.x) || !Number.isSafeInteger(coordinate.y)) {
    throw new RangeError("presentation chunk coordinates must be safe integers");
  }
}

function assertChunkImage(image: Readonly<PresentationChunkImage>): void {
  if (image.viewKey.length === 0) throw new RangeError("presentation image key cannot be empty");
  assertChunkCoordinate(image.canonicalChunk);
  if (!Number.isFinite(image.imageOffset.x) || !Number.isFinite(image.imageOffset.y)) {
    throw new RangeError("presentation image offsets must be finite");
  }
}

function freezeImage(image: Readonly<PresentationChunkImage>): Readonly<PresentationChunkImage> {
  return Object.freeze({
    viewKey: image.viewKey,
    canonicalChunk: Object.freeze({ ...image.canonicalChunk }),
    imageOffset: Object.freeze({ ...image.imageOffset }),
  });
}

function sameImage(
  left: Readonly<PresentationChunkImage>,
  right: Readonly<PresentationChunkImage>,
): boolean {
  return left.viewKey === right.viewKey
    && left.canonicalChunk.x === right.canonicalChunk.x
    && left.canonicalChunk.y === right.canonicalChunk.y
    && left.imageOffset.x === right.imageOffset.x
    && left.imageOffset.y === right.imageOffset.y;
}

function sameOrderedImages(
  left: readonly Readonly<PresentationChunkImage>[],
  right: readonly Readonly<PresentationChunkImage>[],
): boolean {
  return left.length === right.length && left.every((image, index) => {
    const other = right[index];
    return other !== undefined && sameImage(image, other);
  });
}
