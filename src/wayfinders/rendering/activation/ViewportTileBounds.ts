import type { LiftedTileBounds } from "./ActiveChunkContracts";

export interface WorldPixelViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_ACTIVE_CHUNK_PREFETCH_RING = 1;
/** A 3x3 visible region plus one prefetch ring fits inside this 5x5 cap. */
export const DEFAULT_ACTIVE_CHUNK_BUDGET = 25;

/**
 * Converts a lifted camera rectangle to closed, inclusive lifted tile bounds.
 * The camera's right and bottom edges are exact and exclusive, including when
 * they fall exactly on a negative or over-range tile seam.
 */
export function viewportTileBounds(
  viewport: Readonly<WorldPixelViewport>,
  tileSizePixels: number,
): Readonly<LiftedTileBounds> {
  assertPositiveFinite(viewport.width, "viewport.width");
  assertPositiveFinite(viewport.height, "viewport.height");
  assertPositiveFinite(tileSizePixels, "tileSizePixels");
  if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)) {
    throw new RangeError("viewport origin must be finite");
  }

  const rightExclusive = viewport.x + viewport.width;
  const bottomExclusive = viewport.y + viewport.height;
  if (!Number.isFinite(rightExclusive) || !Number.isFinite(bottomExclusive)) {
    throw new RangeError("viewport bounds must be finite");
  }
  const bounds = {
    minX: normalizeZero(Math.floor(viewport.x / tileSizePixels)),
    minY: normalizeZero(Math.floor(viewport.y / tileSizePixels)),
    maxX: normalizeZero(Math.ceil(rightExclusive / tileSizePixels) - 1),
    maxY: normalizeZero(Math.ceil(bottomExclusive / tileSizePixels) - 1),
  };
  for (const [value, name] of [
    [bounds.minX, "viewport min tile x"],
    [bounds.minY, "viewport min tile y"],
    [bounds.maxX, "viewport max tile x"],
    [bounds.maxY, "viewport max tile y"],
  ] as const) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new RangeError("viewport is too small to resolve at this coordinate magnitude");
  }
  return Object.freeze(bounds);
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite`);
}
