import { describe, expect, it } from "vitest";
import {
  PRODUCTION_CENTER_CIRCLE_SEED_METHOD,
  PRODUCTION_SHORELINE_SEED_METHOD,
  seedPreparedCenterCircleCollision,
  seedPreparedShorelineCollision,
} from "../scripts/production-collision-seeding.mjs";

function image(width: number, height: number) {
  return { width, height, pixels: Buffer.alloc(width * height * 4) };
}

function fillAlpha(
  target: ReturnType<typeof image>,
  left: number,
  top: number,
  width: number,
  height: number,
  alpha = 255,
): void {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      target.pixels[(y * target.width + x) * 4 + 3] = alpha;
    }
  }
}

describe("GR-3.6 prepared shoreline collision seeding", () => {
  it("seeds an art-independent conservative circle for imported islands", () => {
    const blank = image(64, 64);
    const opaque = image(64, 64);
    fillAlpha(opaque, 0, 0, 64, 64);

    const settings = { tileSize: 32, subcellSize: 8 };
    const blankResult = seedPreparedCenterCircleCollision(blank, settings);
    const opaqueResult = seedPreparedCenterCircleCollision(opaque, settings);

    expect(blankResult).toEqual(opaqueResult);
    expect(blankResult).toMatchObject({
      method: PRODUCTION_CENTER_CIRCLE_SEED_METHOD,
      grid: { width: 2, height: 2, subcellColumns: 8, subcellRows: 8 },
      warnings: [
        "Centered-circle collision is a conservative import default; refine the saved mask in the asset tool.",
      ],
    });
    expect(blankResult.solidSubcells).toEqual([
      { x: 3, y: 2 }, { x: 4, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 },
      { x: 3, y: 5 }, { x: 4, y: 5 },
    ]);
  });

  it("does not overflow pixel counts for the largest supported opaque subcell", () => {
    const prepared = image(512, 512);
    fillAlpha(prepared, 0, 0, 512, 512);

    const result = seedPreparedShorelineCollision(prepared, { tileSize: 512, subcellSize: 512 });

    expect(result.solidSubcells).toEqual([{ x: 0, y: 0 }]);
    expect(result.warnings).not.toContain(
      "No connected opaque shoreline met the seed threshold; author collision manually.",
    );
  });

  it("retains concave shoreline water and connected fine-grid projections deterministically", () => {
    const prepared = image(64, 64);
    fillAlpha(prepared, 16, 16, 32, 32);
    fillAlpha(prepared, 24, 16, 8, 16, 0);
    fillAlpha(prepared, 48, 34, 8, 1);

    const settings = { tileSize: 32, subcellSize: 8 };
    const first = seedPreparedShorelineCollision(prepared, settings);
    const second = seedPreparedShorelineCollision(prepared, settings);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      method: PRODUCTION_SHORELINE_SEED_METHOD,
      warnings: [],
      grid: { width: 2, height: 2, subcellColumns: 8, subcellRows: 8 },
    });
    expect(first.solidSubcells).toContainEqual({ x: 6, y: 4 });
    expect(first.solidSubcells).not.toContainEqual({ x: 3, y: 2 });
    expect(first.solidSubcells).not.toContainEqual({ x: 3, y: 3 });
    expect(first.solidSubcells).not.toContainEqual({ x: 0, y: 0 });
    expect(first.solidSubcells).toEqual([...first.solidSubcells].sort(
      (left, right) => left.y - right.y || left.x - right.x,
    ));
  });

  it("drops isolated alpha noise and emits stable review warnings for uncertain geometry", () => {
    const prepared = image(64, 64);
    fillAlpha(prepared, 0, 0, 8, 8);
    fillAlpha(prepared, 48, 48, 8, 8);
    fillAlpha(prepared, 30, 30, 1, 1);

    const result = seedPreparedShorelineCollision(prepared, { tileSize: 32, subcellSize: 8 });

    expect(result.solidSubcells).toEqual([{ x: 0, y: 0 }, { x: 6, y: 6 }]);
    expect(result.warnings).toEqual([
      "Ignored 1 disconnected low-coverage alpha region; review detached details.",
      "Detected 2 disconnected shoreline regions; review separate land or structures.",
      "Visible shoreline touches the prepared canvas edge; review possible cropping.",
    ]);
  });

  it("keeps an empty result editable and rejects canvases outside the hybrid grid", () => {
    const blank = seedPreparedShorelineCollision(image(32, 32), { tileSize: 32, subcellSize: 8 });
    expect(blank.solidSubcells).toEqual([]);
    expect(blank.warnings).toEqual([
      "No connected opaque shoreline met the seed threshold; author collision manually.",
    ]);
    expect(() => seedPreparedShorelineCollision(
      image(40, 32),
      { tileSize: 32, subcellSize: 8 },
    )).toThrow(/must align/u);
  });
});
