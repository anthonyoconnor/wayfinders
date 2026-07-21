export interface MapEditorTilePoint {
  readonly x: number;
  readonly y: number;
}

export interface MapEditorTileBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface MapEditorPreviewRecord {
  readonly id: string;
  readonly bounds: Readonly<MapEditorTileBounds>;
}

export interface MapEditorPreviewView<T extends MapEditorPreviewRecord> {
  readonly key: string;
  readonly record: Readonly<T>;
  readonly offset: Readonly<MapEditorTilePoint>;
  readonly bounds: Readonly<MapEditorTileBounds>;
}

export interface MapEditorIslandPreviewAsset {
  readonly revision: string;
  readonly gridWidth: number;
  readonly gridHeight: number;
}

export interface MapEditorIslandPreviewFootprint {
  readonly exactRevision: boolean;
  readonly bounds: Readonly<MapEditorTileBounds>;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function positiveModulo(value: number, span: number): number {
  const remainder = value % span;
  return Object.is(remainder, -0) || remainder === 0 ? 0 : remainder < 0 ? remainder + span : remainder;
}

/** Snaps an arbitrary preview point to one canonical wrapping tile. */
export function snapMapEditorTile(
  x: number,
  y: number,
  worldWidth: number,
  worldHeight: number,
): Readonly<MapEditorTilePoint> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("Map editor pointer coordinates must be finite");
  return Object.freeze({
    x: positiveModulo(Math.floor(x), positiveInteger(worldWidth, "worldWidth")),
    y: positiveModulo(Math.floor(y), positiveInteger(worldHeight, "worldHeight")),
  });
}

/** Preserves the object's grab offset while a canonical pointer crosses a world seam. */
export function mapEditorDragTile(
  objectStart: Readonly<MapEditorTilePoint>,
  pointerStart: Readonly<MapEditorTilePoint>,
  pointerCurrent: Readonly<MapEditorTilePoint>,
  worldWidth: number,
  worldHeight: number,
): Readonly<MapEditorTilePoint> {
  return snapMapEditorTile(
    objectStart.x + pointerCurrent.x - pointerStart.x,
    objectStart.y + pointerCurrent.y - pointerStart.y,
    worldWidth,
    worldHeight,
  );
}

/** Never projects current catalog geometry onto a definition that still names an older revision. */
export function mapEditorIslandPreviewFootprint(
  center: Readonly<MapEditorTilePoint>,
  assetRevision: string,
  available?: Readonly<MapEditorIslandPreviewAsset>,
): Readonly<MapEditorIslandPreviewFootprint> {
  if (!available || available.revision !== assetRevision) {
    return Object.freeze({
      exactRevision: false,
      bounds: Object.freeze({ minX: center.x, minY: center.y, maxX: center.x, maxY: center.y }),
    });
  }
  const width = positiveInteger(available.gridWidth, "available island gridWidth");
  const height = positiveInteger(available.gridHeight, "available island gridHeight");
  const minX = center.x - Math.floor(width / 2);
  const minY = center.y - Math.floor(height / 2);
  return Object.freeze({
    exactRevision: true,
    bounds: Object.freeze({
      minX,
      minY,
      maxX: minX + width - 1,
      maxY: minY + height - 1,
    }),
  });
}

/** Enumerates only the lifted images that intersect the canonical editor canvas. */
export function mapEditorPeriodicAliases(
  bounds: Readonly<MapEditorTileBounds>,
  worldWidth: number,
  worldHeight: number,
): readonly Readonly<MapEditorTilePoint>[] {
  const width = positiveInteger(worldWidth, "worldWidth");
  const height = positiveInteger(worldHeight, "worldHeight");
  validateBounds(bounds);
  if (bounds.maxX - bounds.minX + 1 >= width || bounds.maxY - bounds.minY + 1 >= height) {
    throw new RangeError("Map editor object footprints must be strictly smaller than the world");
  }
  const offsets: MapEditorTilePoint[] = [];
  for (const y of [-height, 0, height]) {
    for (const x of [-width, 0, width]) {
      if (!intersects(translateBounds(bounds, x, y), canonicalBounds(width, height))) continue;
      offsets.push(Object.freeze({ x, y }));
    }
  }
  return Object.freeze(offsets.sort((left, right) => left.y - right.y || left.x - right.x));
}

/** Bucketed preview index used by picking and viewport refreshes. */
export class MapEditorPreviewSpatialIndex<T extends MapEditorPreviewRecord> {
  private readonly buckets = new Map<string, Array<Readonly<MapEditorPreviewView<T>>>>();
  private readonly views = new Map<string, Readonly<MapEditorPreviewView<T>>>();
  private readonly bucketSize: number;

  constructor(
    private readonly worldWidth: number,
    private readonly worldHeight: number,
    bucketSize = 16,
  ) {
    positiveInteger(worldWidth, "worldWidth");
    positiveInteger(worldHeight, "worldHeight");
    this.bucketSize = positiveInteger(bucketSize, "bucketSize");
  }

  rebuild(records: readonly Readonly<T>[]): void {
    this.buckets.clear();
    this.views.clear();
    const ids = new Set<string>();
    for (const record of records) {
      if (!record.id || ids.has(record.id)) throw new RangeError(`Map editor preview record ID must be unique: ${record.id}`);
      ids.add(record.id);
      for (const offset of mapEditorPeriodicAliases(record.bounds, this.worldWidth, this.worldHeight)) {
        const bounds = translateBounds(record.bounds, offset.x, offset.y);
        const key = `${record.id}@${offset.x},${offset.y}`;
        const view = Object.freeze({ key, record, offset, bounds });
        this.views.set(key, view);
        this.addToBuckets(view);
      }
    }
  }

  query(bounds: Readonly<MapEditorTileBounds>): readonly Readonly<MapEditorPreviewView<T>>[] {
    validateBounds(bounds);
    const found = new Map<string, Readonly<MapEditorPreviewView<T>>>();
    for (const key of this.bucketKeys(bounds)) {
      for (const view of this.buckets.get(key) ?? []) {
        if (intersects(view.bounds, bounds)) found.set(view.key, view);
      }
    }
    return Object.freeze([...found.values()].sort((left, right) => left.key.localeCompare(right.key, "en")));
  }

  allViews(): readonly Readonly<MapEditorPreviewView<T>>[] {
    return Object.freeze([...this.views.values()].sort((left, right) => left.key.localeCompare(right.key, "en")));
  }

  clear(): void {
    this.buckets.clear();
    this.views.clear();
  }

  private addToBuckets(view: Readonly<MapEditorPreviewView<T>>): void {
    for (const key of this.bucketKeys(view.bounds)) {
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(view);
      this.buckets.set(key, bucket);
    }
  }

  private bucketKeys(bounds: Readonly<MapEditorTileBounds>): readonly string[] {
    const keys: string[] = [];
    const minimumX = Math.floor(bounds.minX / this.bucketSize);
    const maximumX = Math.floor(bounds.maxX / this.bucketSize);
    const minimumY = Math.floor(bounds.minY / this.bucketSize);
    const maximumY = Math.floor(bounds.maxY / this.bucketSize);
    for (let y = minimumY; y <= maximumY; y++) {
      for (let x = minimumX; x <= maximumX; x++) keys.push(`${x},${y}`);
    }
    return keys;
  }
}

function canonicalBounds(width: number, height: number): Readonly<MapEditorTileBounds> {
  return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
}

function translateBounds(
  bounds: Readonly<MapEditorTileBounds>,
  x: number,
  y: number,
): Readonly<MapEditorTileBounds> {
  return Object.freeze({
    minX: bounds.minX + x,
    minY: bounds.minY + y,
    maxX: bounds.maxX + x,
    maxY: bounds.maxY + y,
  });
}

function validateBounds(bounds: Readonly<MapEditorTileBounds>): void {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isSafeInteger)) {
    throw new RangeError("Map editor bounds must use integer tile coordinates");
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new RangeError("Map editor bounds must not be empty");
  }
}

function intersects(left: Readonly<MapEditorTileBounds>, right: Readonly<MapEditorTileBounds>): boolean {
  return left.maxX >= right.minX
    && left.minX <= right.maxX
    && left.maxY >= right.minY
    && left.minY <= right.maxY;
}
