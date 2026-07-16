import type { ChunkRegion } from "./ActiveChunkContracts";

export interface WorldPixelViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldChunkLayout {
  readonly worldWidthTiles: number;
  readonly worldHeightTiles: number;
  readonly chunkSizeTiles: number;
  readonly tileSizePixels: number;
}

export const DEFAULT_ACTIVE_CHUNK_PREFETCH_RING = 1;
/** A 3x3 visible region plus one prefetch ring fits inside this 5x5 cap. */
export const DEFAULT_ACTIVE_CHUNK_BUDGET = 25;

/** Converts the current camera rectangle into clipped inclusive chunk bounds. */
export function viewportChunkRegion(
  viewport: Readonly<WorldPixelViewport>,
  layout: Readonly<WorldChunkLayout>,
): Readonly<ChunkRegion> | null {
  assertPositiveFinite(viewport.width, "viewport.width");
  assertPositiveFinite(viewport.height, "viewport.height");
  assertPositiveInteger(layout.worldWidthTiles, "worldWidthTiles");
  assertPositiveInteger(layout.worldHeightTiles, "worldHeightTiles");
  assertPositiveInteger(layout.chunkSizeTiles, "chunkSizeTiles");
  assertPositiveFinite(layout.tileSizePixels, "tileSizePixels");
  if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)) {
    throw new RangeError("viewport origin must be finite");
  }

  const worldWidthPixels = layout.worldWidthTiles * layout.tileSizePixels;
  const worldHeightPixels = layout.worldHeightTiles * layout.tileSizePixels;
  const left = Math.max(0, viewport.x);
  const top = Math.max(0, viewport.y);
  const right = Math.min(worldWidthPixels, viewport.x + viewport.width);
  const bottom = Math.min(worldHeightPixels, viewport.y + viewport.height);
  if (left >= right || top >= bottom) return null;

  const chunkPixels = layout.chunkSizeTiles * layout.tileSizePixels;
  const lastChunkX = Math.ceil(layout.worldWidthTiles / layout.chunkSizeTiles) - 1;
  const lastChunkY = Math.ceil(layout.worldHeightTiles / layout.chunkSizeTiles) - 1;
  return Object.freeze({
    minX: Math.max(0, Math.floor(left / chunkPixels)),
    minY: Math.max(0, Math.floor(top / chunkPixels)),
    // Camera right/bottom edges are exclusive. A scaled epsilon prevents an
    // exact seam from activating the next chunk early.
    maxX: Math.min(lastChunkX, Math.floor((right - Number.EPSILON * Math.max(1, right)) / chunkPixels)),
    maxY: Math.min(lastChunkY, Math.floor((bottom - Number.EPSILON * Math.max(1, bottom)) / chunkPixels)),
  });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite`);
}
