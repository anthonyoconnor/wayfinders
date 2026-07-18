import type { GridPoint, WorldPoint } from "../core/types";

export type WorldAxisTopology = "bounded" | "wrap";

export interface WorldTopologyDefinition {
  readonly x: WorldAxisTopology;
  readonly y: WorldAxisTopology;
}

export const BOUNDED_WORLD_TOPOLOGY: Readonly<WorldTopologyDefinition> = Object.freeze({
  x: "bounded",
  y: "bounded",
});

export const WRAPPING_WORLD_TOPOLOGY: Readonly<WorldTopologyDefinition> = Object.freeze({
  x: "wrap",
  y: "wrap",
});

export type CardinalDirection = 0 | 1 | 2 | 3;

export const CARDINAL_DIRECTIONS = Object.freeze([
  Object.freeze({ direction: 0 as const, reverseDirection: 1 as const, x: -1, y: 0, name: "west" as const }),
  Object.freeze({ direction: 1 as const, reverseDirection: 0 as const, x: 1, y: 0, name: "east" as const }),
  Object.freeze({ direction: 2 as const, reverseDirection: 3 as const, x: 0, y: -1, name: "north" as const }),
  Object.freeze({ direction: 3 as const, reverseDirection: 2 as const, x: 0, y: 1, name: "south" as const }),
] as const);

export interface DirectionalTileStep {
  readonly direction: CardinalDirection;
  readonly reverseDirection: CardinalDirection;
  readonly point: Readonly<GridPoint>;
  /** Whole canonical tile spans applied to the destination image. */
  readonly imageOffset: Readonly<GridPoint>;
}

export interface CanonicalIntervalPiece {
  readonly minimum: number;
  readonly maximumExclusive: number;
}

export interface CanonicalTileBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface PeriodicChunkImage {
  readonly canonicalChunk: Readonly<GridPoint>;
  /** Whole-world pixel offset used to place this image in lifted view space. */
  readonly imageOffset: Readonly<WorldPoint>;
}

function positiveModulo(value: number, span: number): number {
  const remainder = value % span;
  if (Object.is(remainder, -0)) return 0;
  const normalized = remainder < 0 ? remainder + span : remainder;
  // Adding a sub-ulp negative remainder to a large span can round back to the
  // span itself. Canonical coordinates are half-open, so preserve [0, span).
  return normalized === span ? 0 : normalized;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
}

/**
 * Renderer-neutral topology and coordinate authority for one finite world.
 * Stored coordinates stay canonical; callers use this seam to cross a wrapped
 * gameplay boundary or to request the nearest lifted image.
 */
export class WorldTopology {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly chunkColumns: number;
  readonly chunkRows: number;

  constructor(
    widthTiles: number,
    heightTiles: number,
    readonly tileSize: number,
    readonly chunkSize: number,
    readonly definition: Readonly<WorldTopologyDefinition>,
  ) {
    assertInteger(widthTiles, "World width");
    assertInteger(heightTiles, "World height");
    assertInteger(tileSize, "Tile size");
    assertInteger(chunkSize, "Chunk size");
    if (widthTiles <= 0 || heightTiles <= 0 || tileSize <= 0 || chunkSize <= 0) {
      throw new RangeError("World, tile, and chunk dimensions must be positive");
    }
    if (
      (definition.x !== "bounded" && definition.x !== "wrap")
      || (definition.y !== "bounded" && definition.y !== "wrap")
    ) throw new RangeError("World topology axes must be bounded or wrap");
    this.tileWidth = widthTiles;
    this.tileHeight = heightTiles;
    this.pixelWidth = widthTiles * tileSize;
    this.pixelHeight = heightTiles * tileSize;
    this.chunkColumns = Math.ceil(widthTiles / chunkSize);
    this.chunkRows = Math.ceil(heightTiles / chunkSize);
  }

  get wrapsX(): boolean {
    return this.definition.x === "wrap";
  }

  get wrapsY(): boolean {
    return this.definition.y === "wrap";
  }

  isCanonicalTile(x: number, y: number): boolean {
    return Number.isInteger(x)
      && Number.isInteger(y)
      && x >= 0
      && y >= 0
      && x < this.tileWidth
      && y < this.tileHeight;
  }

  isCanonicalWorld(x: number, y: number): boolean {
    return Number.isFinite(x)
      && Number.isFinite(y)
      && x >= 0
      && y >= 0
      && x < this.pixelWidth
      && y < this.pixelHeight;
  }

  canonicalizeTile(x: number, y: number): GridPoint | undefined {
    assertInteger(x, "Tile x");
    assertInteger(y, "Tile y");
    const canonicalX = this.canonicalizeAxis(x, this.tileWidth, this.wrapsX);
    const canonicalY = this.canonicalizeAxis(y, this.tileHeight, this.wrapsY);
    if (canonicalX === undefined || canonicalY === undefined) return undefined;
    return { x: canonicalX, y: canonicalY };
  }

  normalizeTile(x: number, y: number): GridPoint {
    const point = this.canonicalizeTile(x, y);
    if (!point) throw new RangeError(`Tile (${x}, ${y}) is outside the bounded world`);
    return point;
  }

  canonicalizeWorld(x: number, y: number): WorldPoint | undefined {
    assertFinite(x, "World x");
    assertFinite(y, "World y");
    const canonicalX = this.canonicalizeAxis(x, this.pixelWidth, this.wrapsX);
    const canonicalY = this.canonicalizeAxis(y, this.pixelHeight, this.wrapsY);
    if (canonicalX === undefined || canonicalY === undefined) return undefined;
    return { x: canonicalX, y: canonicalY };
  }

  normalizeWorld(x: number, y: number): WorldPoint {
    const point = this.canonicalizeWorld(x, y);
    if (!point) throw new RangeError(`World point (${x}, ${y}) is outside the bounded world`);
    return point;
  }

  minimumImageTileDisplacement(from: Readonly<GridPoint>, to: Readonly<GridPoint>): GridPoint {
    return {
      x: this.minimumImageAxis(to.x - from.x, this.tileWidth, this.wrapsX),
      y: this.minimumImageAxis(to.y - from.y, this.tileHeight, this.wrapsY),
    };
  }

  minimumImageWorldDisplacement(from: Readonly<WorldPoint>, to: Readonly<WorldPoint>): WorldPoint {
    return {
      x: this.minimumImageAxis(to.x - from.x, this.pixelWidth, this.wrapsX),
      y: this.minimumImageAxis(to.y - from.y, this.pixelHeight, this.wrapsY),
    };
  }

  minimumImageTileDistanceSquared(from: Readonly<GridPoint>, to: Readonly<GridPoint>): number {
    const displacement = this.minimumImageTileDisplacement(from, to);
    return displacement.x * displacement.x + displacement.y * displacement.y;
  }

  minimumImageWorldDistanceSquared(from: Readonly<WorldPoint>, to: Readonly<WorldPoint>): number {
    const displacement = this.minimumImageWorldDisplacement(from, to);
    return displacement.x * displacement.x + displacement.y * displacement.y;
  }

  nearestWorldImageOffset(from: Readonly<WorldPoint>, target: Readonly<WorldPoint>): WorldPoint {
    const displacement = this.minimumImageWorldDisplacement(from, target);
    return {
      x: from.x + displacement.x - target.x,
      y: from.y + displacement.y - target.y,
    };
  }

  stepCardinal(point: Readonly<GridPoint>, direction: CardinalDirection): DirectionalTileStep | undefined {
    const vector = CARDINAL_DIRECTIONS[direction];
    if (!vector) throw new RangeError(`Invalid cardinal direction ${direction}`);
    const rawX = point.x + vector.x;
    const rawY = point.y + vector.y;
    const canonical = this.canonicalizeTile(rawX, rawY);
    if (!canonical) return undefined;
    if (canonical.x === point.x && canonical.y === point.y) return undefined;
    return {
      direction,
      reverseDirection: vector.reverseDirection,
      point: canonical,
      imageOffset: {
        x: rawX - canonical.x,
        y: rawY - canonical.y,
      },
    };
  }

  cardinalSteps(point: Readonly<GridPoint>): DirectionalTileStep[] {
    const result: DirectionalTileStep[] = [];
    for (const vector of CARDINAL_DIRECTIONS) {
      const step = this.stepCardinal(point, vector.direction);
      if (step) result.push(step);
    }
    return result;
  }

  uniqueCardinalNeighbors(point: Readonly<GridPoint>): GridPoint[] {
    const seen = new Set<number>();
    const result: GridPoint[] = [];
    for (const step of this.cardinalSteps(point)) {
      const index = step.point.y * this.tileWidth + step.point.x;
      if (seen.has(index)) continue;
      seen.add(index);
      result.push({ ...step.point });
    }
    return result;
  }

  uniqueEightNeighbors(point: Readonly<GridPoint>): GridPoint[] {
    const seen = new Set<number>();
    const result: GridPoint[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const canonical = this.canonicalizeTile(point.x + dx, point.y + dy);
        if (!canonical || (canonical.x === point.x && canonical.y === point.y)) continue;
        const index = canonical.y * this.tileWidth + canonical.x;
        if (seen.has(index)) continue;
        seen.add(index);
        result.push(canonical);
      }
    }
    return result;
  }

  decomposeTileBounds(bounds: Readonly<CanonicalTileBounds>): CanonicalTileBounds[] {
    for (const [value, name] of [
      [bounds.minX, "minX"],
      [bounds.minY, "minY"],
      [bounds.maxX, "maxX"],
      [bounds.maxY, "maxY"],
    ] as const) assertInteger(value, name);
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return [];
    const xPieces = this.decomposeIntegerInterval(bounds.minX, bounds.maxX + 1, this.tileWidth, this.wrapsX);
    const yPieces = this.decomposeIntegerInterval(bounds.minY, bounds.maxY + 1, this.tileHeight, this.wrapsY);
    const result: CanonicalTileBounds[] = [];
    for (const y of yPieces) {
      for (const x of xPieces) {
        result.push({
          minX: x.minimum,
          minY: y.minimum,
          maxX: x.maximumExclusive - 1,
          maxY: y.maximumExclusive - 1,
        });
      }
    }
    return result;
  }

  periodicChunkImagesForBounds(bounds: Readonly<CanonicalTileBounds>): PeriodicChunkImage[] {
    for (const [value, name] of [
      [bounds.minX, "minX"],
      [bounds.minY, "minY"],
      [bounds.maxX, "maxX"],
      [bounds.maxY, "maxY"],
    ] as const) assertInteger(value, name);
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return [];

    const xImages = this.chunkImagesAlongAxis(
      bounds.minX,
      bounds.maxX,
      this.tileWidth,
      this.pixelWidth,
      this.chunkColumns,
      this.wrapsX,
    );
    const yImages = this.chunkImagesAlongAxis(
      bounds.minY,
      bounds.maxY,
      this.tileHeight,
      this.pixelHeight,
      this.chunkRows,
      this.wrapsY,
    );
    const images: PeriodicChunkImage[] = [];
    for (const y of yImages) {
      for (const x of xImages) {
        images.push({
          canonicalChunk: { x: x.canonicalChunk, y: y.canonicalChunk },
          imageOffset: { x: x.imageOffsetPixels, y: y.imageOffsetPixels },
        });
      }
    }
    return images.sort((left, right) => (
      left.imageOffset.y - right.imageOffset.y
      || left.imageOffset.x - right.imageOffset.x
      || left.canonicalChunk.y - right.canonicalChunk.y
      || left.canonicalChunk.x - right.canonicalChunk.x
    ));
  }

  private canonicalizeAxis(value: number, span: number, wraps: boolean): number | undefined {
    if (value >= 0 && value < span) return Object.is(value, -0) ? 0 : value;
    return wraps ? positiveModulo(value, span) : undefined;
  }

  private minimumImageAxis(delta: number, span: number, wraps: boolean): number {
    assertFinite(delta, "Displacement");
    if (!wraps) return delta;
    let result = delta % span;
    const halfSpan = span / 2;
    if (Math.abs(result) > halfSpan) result += result > 0 ? -span : span;
    return Object.is(result, -0) ? 0 : result;
  }

  private decomposeIntegerInterval(
    minimum: number,
    maximumExclusive: number,
    span: number,
    wraps: boolean,
  ): CanonicalIntervalPiece[] {
    if (maximumExclusive <= minimum) return [];
    if (!wraps) {
      const clippedMinimum = Math.max(0, minimum);
      const clippedMaximum = Math.min(span, maximumExclusive);
      return clippedMinimum < clippedMaximum
        ? [{ minimum: clippedMinimum, maximumExclusive: clippedMaximum }]
        : [];
    }
    const length = maximumExclusive - minimum;
    if (length >= span) return [{ minimum: 0, maximumExclusive: span }];
    const start = positiveModulo(minimum, span);
    const end = start + length;
    if (end <= span) return [{ minimum: start, maximumExclusive: end }];
    return [
      { minimum: start, maximumExclusive: span },
      { minimum: 0, maximumExclusive: end - span },
    ];
  }

  /** Enumerates intersecting lifted images directly, without scanning canonical chunks. */
  private chunkImagesAlongAxis(
    queryMinimum: number,
    queryMaximum: number,
    span: number,
    pixelSpan: number,
    chunkCount: number,
    wraps: boolean,
  ): AxisChunkImage[] {
    if (!wraps) {
      const clippedMinimum = Math.max(0, queryMinimum);
      const clippedMaximum = Math.min(span - 1, queryMaximum);
      if (clippedMinimum > clippedMaximum) return [];
      const result: AxisChunkImage[] = [];
      const firstChunk = Math.floor(clippedMinimum / this.chunkSize);
      const lastChunk = Math.floor(clippedMaximum / this.chunkSize);
      for (let canonicalChunk = firstChunk; canonicalChunk <= lastChunk; canonicalChunk++) {
        result.push({ canonicalChunk, imageOffsetPixels: 0 });
      }
      return result;
    }

    const canonicalMinimum = positiveModulo(queryMinimum, span);
    let imageNumber = (queryMinimum - canonicalMinimum) / span;
    if (Object.is(imageNumber, -0)) imageNumber = 0;
    let canonicalChunk = Math.floor(canonicalMinimum / this.chunkSize);
    const result: AxisChunkImage[] = [];
    while (true) {
      const canonicalStart = canonicalChunk * this.chunkSize;
      const liftedStart = imageNumber * span + canonicalStart;
      if (liftedStart > queryMaximum) break;
      const imageOffsetPixels = imageNumber * pixelSpan;
      if (!Number.isSafeInteger(imageOffsetPixels)) {
        throw new RangeError("Periodic chunk image offset must be a safe integer");
      }
      result.push({ canonicalChunk, imageOffsetPixels });
      canonicalChunk++;
      if (canonicalChunk === chunkCount) {
        canonicalChunk = 0;
        imageNumber++;
      }
    }
    return result;
  }
}

interface AxisChunkImage {
  readonly canonicalChunk: number;
  readonly imageOffsetPixels: number;
}
