import { describe, expect, it, vi } from "vitest";

import waterPackage from "../src/wayfinders/assets/packages/water.json";
import {
  preloadWaterAssetPackage,
  validateWaterAssetPackage,
  WATER_TEXTURE_KEYS,
} from "../src/wayfinders/assets/water";

describe("production water asset contract", () => {
  it("validates the runtime profile join", () => {
    const validated = validateWaterAssetPackage(waterPackage);
    expect(validated.assetId).toBe("world.water.primary");
    expect(validated.profiles).toHaveLength(8);
    expect(new Set(validated.profiles.map(({ id }) => id)).size).toBe(8);
    expect(waterPackage.images.map(({ imageId }) => imageId).sort()).toEqual([
      "world.water.depth-transitions",
      "world.water.surface-overlays",
      "world.water.tiles.animated",
      "world.water.tiles.static",
    ]);
  });

  it("rejects missing and duplicate presentation mappings", () => {
    expect(() => validateWaterAssetPackage({
      ...waterPackage,
      profiles: waterPackage.profiles.slice(1),
    })).toThrow(/missing profile abyss/u);
    expect(() => validateWaterAssetPackage({
      ...waterPackage,
      profiles: [...waterPackage.profiles, waterPackage.profiles[0]],
    })).toThrow(/Duplicate water profile abyss/u);
  });

  it("rejects incompatible sheet geometry", () => {
    expect(() => validateWaterAssetPackage({ ...waterPackage, tileSize: 16 }))
      .toThrow(/tile geometry/u);
  });

  it("preloads generic water sheets without standalone authored-home sprites", () => {
    const spritesheet = vi.fn();
    const scene = {
      load: {
        json: vi.fn(),
        spritesheet,
        image: vi.fn(),
      },
    };

    preloadWaterAssetPackage(scene as never);

    expect(spritesheet).toHaveBeenCalledTimes(4);
    expect(spritesheet.mock.calls.map(([key]) => key)).toEqual([
      WATER_TEXTURE_KEYS.animated,
      WATER_TEXTURE_KEYS.static,
      WATER_TEXTURE_KEYS.transitions,
      WATER_TEXTURE_KEYS.overlays,
    ]);
  });
});
