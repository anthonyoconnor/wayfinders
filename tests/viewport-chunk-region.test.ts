import { describe, expect, it } from "vitest";

import { viewportChunkRegion } from "../src/wayfinders/rendering/activation";

const layout = {
  worldWidthTiles: 96,
  worldHeightTiles: 96,
  chunkSizeTiles: 32,
  tileSizePixels: 32,
} as const;

describe("viewport chunk region", () => {
  it("treats exact camera seams as exclusive and activates after crossing", () => {
    expect(viewportChunkRegion({ x: 0, y: 0, width: 1_024, height: 1_024 }, layout)).toEqual({
      minX: 0, minY: 0, maxX: 0, maxY: 0,
    });
    expect(viewportChunkRegion({ x: 1, y: 0, width: 1_024, height: 1_024 }, layout)).toEqual({
      minX: 0, minY: 0, maxX: 1, maxY: 0,
    });
  });

  it("clips partial cameras and returns null when the camera misses the world", () => {
    expect(viewportChunkRegion({ x: -200, y: -100, width: 400, height: 300 }, layout)).toEqual({
      minX: 0, minY: 0, maxX: 0, maxY: 0,
    });
    expect(viewportChunkRegion({ x: 4_000, y: 0, width: 100, height: 100 }, layout)).toBeNull();
  });
});
