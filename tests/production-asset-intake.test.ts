import { describe, expect, it } from "vitest";
import {
  PRODUCTION_ASSET_FAMILY_DEFAULTS,
  ProductionAssetIntakeValidationError,
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
  idConfirmed: true,
  family: "island",
  targetWidth: 480,
  targetHeight: 480,
  layerRole: "base",
  collisionSemantics: "solid",
  runtimeCategory: "home-island",
} as const;

describe("GR-3.5 guided production asset intake", () => {
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

  it("normalizes a confirmed reference recipe request", () => {
    expect(validateProductionAssetIntakeRequest(valid)).toEqual(valid);
  });

  it("returns recoverable field errors for identity, geometry, family semantics, and source", () => {
    expect(() => validateProductionAssetIntakeRequest({
      ...valid,
      id: "Bad ID",
      idConfirmed: false,
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
        idConfirmed: false,
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
        idConfirmed: expect.any(String),
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
