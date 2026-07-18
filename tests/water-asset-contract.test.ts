import { describe, expect, it, vi } from "vitest";

import waterPackage from "../src/wayfinders/assets/packages/water.json";
import {
  preloadWaterAssetPackage,
  validateWaterAssetPackage,
  WATER_ASSET_URLS,
  WATER_HOME_FRAME_SIZE,
  WATER_HOME_HANDOFF_FRAME_SIZE,
  WATER_HOME_HANDOFF_MARGIN,
  WATER_SHEET_MARGIN,
  WATER_SHEET_SPACING,
  WATER_TEXTURE_KEYS,
} from "../src/wayfinders/assets/water";

describe("production water asset contract", () => {
  it("validates the runtime profile join", () => {
    const validated = validateWaterAssetPackage(waterPackage);
    expect(validated.assetId).toBe("world.water.primary");
    expect(validated.profiles).toHaveLength(8);
    expect(new Set(validated.profiles.map(({ id }) => id)).size).toBe(8);
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

  it("preloads the aligned home handoff and shore sheets", () => {
    const spritesheet = vi.fn();
    const scene = {
      load: {
        json: vi.fn(),
        spritesheet,
        image: vi.fn(),
      },
    };

    preloadWaterAssetPackage(scene as never);

    expect(WATER_HOME_FRAME_SIZE).toBe(480);
    expect(WATER_HOME_HANDOFF_FRAME_SIZE).toBe(800);
    expect(WATER_HOME_HANDOFF_MARGIN).toBe(160);
    expect(spritesheet).toHaveBeenCalledWith(
      WATER_TEXTURE_KEYS.homeDepthHandoff,
      WATER_ASSET_URLS.homeDepthHandoff,
      {
        frameWidth: 800,
        frameHeight: 800,
        margin: WATER_SHEET_MARGIN,
        spacing: WATER_SHEET_SPACING,
      },
    );
    expect(spritesheet).toHaveBeenCalledWith(
      WATER_TEXTURE_KEYS.homeShore,
      WATER_ASSET_URLS.homeShore,
      {
        frameWidth: 480,
        frameHeight: 480,
        margin: WATER_SHEET_MARGIN,
        spacing: WATER_SHEET_SPACING,
      },
    );
  });
});
