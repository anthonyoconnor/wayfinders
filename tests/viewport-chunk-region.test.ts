import { describe, expect, it } from "vitest";

import { viewportTileBounds } from "../src/wayfinders/rendering/activation";

describe("viewport tile bounds", () => {
  it("treats exact right and bottom camera seams as exclusive", () => {
    expect(viewportTileBounds({ x: 0, y: 0, width: 1_024, height: 1_024 }, 32)).toEqual({
      minX: 0, minY: 0, maxX: 31, maxY: 31,
    });
    expect(viewportTileBounds({ x: 1, y: 1, width: 1_024, height: 1_024 }, 32)).toEqual({
      minX: 0, minY: 0, maxX: 32, maxY: 32,
    });
    expect(viewportTileBounds({ x: 32, y: 64, width: 32, height: 64 }, 32)).toEqual({
      minX: 1, minY: 2, maxX: 1, maxY: 3,
    });
  });

  it("preserves negative and over-range lifted coordinates", () => {
    expect(viewportTileBounds({ x: -200, y: -100, width: 400, height: 300 }, 32)).toEqual({
      minX: -7, minY: -4, maxX: 6, maxY: 6,
    });
    expect(viewportTileBounds({ x: 4_000, y: 6_144, width: 100, height: 64 }, 32)).toEqual({
      minX: 125, minY: 192, maxX: 128, maxY: 193,
    });
  });

  it("handles exact negative seams without pulling in the excluded tile", () => {
    expect(viewportTileBounds({ x: -64, y: -32, width: 32, height: 32 }, 32)).toEqual({
      minX: -2, minY: -1, maxX: -2, maxY: -1,
    });
    expect(viewportTileBounds({ x: -63, y: -31, width: 32, height: 32 }, 32)).toEqual({
      minX: -2, minY: -1, maxX: -1, maxY: 0,
    });
  });

  it("validates finite, resolvable rectangles", () => {
    expect(() => viewportTileBounds({ x: 0, y: 0, width: 0, height: 1 }, 32)).toThrow(/positive/);
    expect(() => viewportTileBounds({ x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 }, 32)).toThrow(/origin/);
    expect(() => viewportTileBounds({ x: Number.MAX_VALUE, y: 0, width: 1, height: 1 }, 32)).toThrow(/bounds|safe integer/);
    expect(() => viewportTileBounds({ x: 0, y: 0, width: 1, height: 1 }, Number.NaN)).toThrow(/positive/);
  });
});
