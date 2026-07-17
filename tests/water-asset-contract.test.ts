import { describe, expect, it } from "vitest";

import waterPackage from "../src/wayfinders/assets/packages/water.json";
import { validateWaterAssetPackage } from "../src/wayfinders/assets/water";

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
});
