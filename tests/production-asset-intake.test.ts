import { describe, expect, it } from "vitest";
import {
  PRODUCTION_ASSET_FAMILY_DEFAULTS,
  ProductionAssetIntakeValidationError,
  aspectLockedProductionAssetDimensions,
  gridPaddedProductionAssetDimensions,
  productionAssetPngDimensions,
  productionAssetNameFromFileName,
  suggestedProductionAssetId,
  validateProductionAssetIntakeRequest,
} from "../src/wayfinders/assets/ProductionAssetIntake";

const valid = {
  formatVersion: 1,
  source: {
    kind: "reference",
    repositoryPath: "assets-src/gr1/island-examples/island-01-crescent-cay-uninhabited.png",
  },
  name: "Crescent Cay",
  id: "production.island.crescent-cay",
  family: "island",
  targetWidth: 480,
  targetHeight: 480,
  canvasSizing: "native",
  layerRole: "base",
  collisionSemantics: "solid",
  runtimeCategory: "home-island",
} as const;

describe("GR-3.5 guided production asset intake", () => {
  it("reads PNG dimensions from IHDR and offers the smallest collision-grid canvas", () => {
    const pngHeader = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 1, 225, 0, 0, 1, 201,
    ]);
    const dimensions = productionAssetPngDimensions(pngHeader);

    expect(dimensions).toEqual({ width: 481, height: 457 });
    expect(gridPaddedProductionAssetDimensions(dimensions)).toEqual({ width: 512, height: 480 });
    expect(() => productionAssetPngDimensions(new Uint8Array(24))).toThrow(/not a PNG/u);
  });

  it("exposes visible family defaults and derives stable identity suggestions", () => {
    expect(PRODUCTION_ASSET_FAMILY_DEFAULTS.island).toMatchObject({
      targetWidth: 480,
      targetHeight: 480,
      collisionSemantics: "solid",
      runtimeCategory: "home-island",
    });
    expect(PRODUCTION_ASSET_FAMILY_DEFAULTS.shoal).toMatchObject({
      collisionSemantics: "passable",
      runtimeCategory: "fishing-shoal",
    });
    expect(suggestedProductionAssetId("  Shell Masons!  ", "island"))
      .toBe("production.island.shell-masons");
  });

  it("derives upload names and preserves the source aspect ratio from either dimension", () => {
    expect(productionAssetNameFromFileName("river.delta.inhabited.png")).toBe("river.delta.inhabited");
    expect(productionAssetNameFromFileName("C:\\art\\Atoll.PNG")).toBe("Atoll");
    expect(aspectLockedProductionAssetDimensions({ width: 1_280, height: 720 }, "width", 640))
      .toEqual({ width: 640, height: 360 });
    expect(aspectLockedProductionAssetDimensions({ width: 1_280, height: 720 }, "height", 180))
      .toEqual({ width: 320, height: 180 });
  });

  it("normalizes a reference recipe request without a manual identity confirmation", () => {
    expect(validateProductionAssetIntakeRequest(valid)).toEqual(valid);
  });

  it("returns recoverable field errors for identity, geometry, family semantics, and source", () => {
    expect(() => validateProductionAssetIntakeRequest({
      ...valid,
      id: "Bad ID",
      targetWidth: 481,
      collisionSemantics: "solid",
      family: "shoal",
      runtimeCategory: "player-boat",
      source: { kind: "reference", repositoryPath: "../../private.png" },
    })).toThrow(ProductionAssetIntakeValidationError);
    try {
      validateProductionAssetIntakeRequest({
        ...valid,
        id: "Bad ID",
        targetWidth: 481,
        family: "shoal",
        collisionSemantics: "solid",
        runtimeCategory: "player-boat",
        source: { kind: "reference", repositoryPath: "../../private.png" },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionAssetIntakeValidationError);
      expect((error as ProductionAssetIntakeValidationError).fieldErrors).toMatchObject({
        id: expect.any(String),
        targetWidth: expect.any(String),
        collisionSemantics: expect.any(String),
        runtimeCategory: expect.any(String),
        source: expect.any(String),
      });
    }
  });

  it("accepts a bounded uploaded PNG envelope without treating it as a repository path", () => {
    const request = validateProductionAssetIntakeRequest({
      ...valid,
      source: { kind: "upload", fileName: "new-cay.png", pngBase64: "iVBORw0KGgo=" },
    });
    expect(request.source).toEqual({ kind: "upload", fileName: "new-cay.png", pngBase64: "iVBORw0KGgo=" });
  });
});
