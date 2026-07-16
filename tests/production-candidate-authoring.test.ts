import { describe, expect, it } from "vitest";
import {
  applyProductionCandidateAuthoringRequest,
  productionCandidateAuthoringRequestsEqual,
  productionCandidateDraftToEditorProfile,
  productionCandidateMaskFile,
  productionCandidateMaskPixels,
  validateProductionCandidateAuthoringRequest,
} from "../src/wayfinders/assets/ProductionCandidateAuthoring";
import type { ProductionAssetRecipe } from "../src/wayfinders/assets/ProductionAssetRecipe";

const fingerprint = "a".repeat(64);

function recipe(): ProductionAssetRecipe {
  return {
    id: "production.island.test-cay",
    name: "Test Cay",
    family: "island",
    lifecycle: "source",
    collection: "Island production sources",
    sortOrder: 10,
    tags: ["island", "test-cay", "source"],
    provenance: {
      kind: "selected-source",
      sourceFile: "assets-src/gr3/intake/production-island-test-cay-base-source.png",
    },
    layers: [
      {
        id: "base",
        name: "Base",
        role: "base",
        sourceFile: "assets-src/gr3/intake/production-island-test-cay-base-source.png",
        defaultVisible: true,
        opacity: 1,
        blendMode: "normal",
        preparation: { mode: "preserve", targetWidth: 64, targetHeight: 64, thumbnailMaximum: 192 },
      },
      {
        id: "mist",
        name: "Mist",
        role: "overlay",
        sourceFile: "assets-src/gr3/intake/production-island-test-cay-mist-source.png",
        defaultVisible: true,
        opacity: 0.8,
        blendMode: "screen",
        preparation: { mode: "preserve", targetWidth: 64, targetHeight: 64, thumbnailMaximum: 192 },
      },
    ],
    animations: [],
    collision: { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
    runtimeBinding: { assetId: "home.island.primary", collisionIntent: "preserve" },
  };
}

function request() {
  return {
    formatVersion: 1,
    recipeId: "production.island.test-cay",
    candidateFingerprint: fingerprint,
    settings: {
      name: "Storm Cay",
      family: "world-feature",
      targetWidth: 96,
      targetHeight: 64,
      layers: [
        { id: "mist", defaultVisible: false, opacity: 0.35 },
        { id: "base", defaultVisible: true, opacity: 0.9 },
      ],
      runtimeBindingAssetId: "player.boat.primary",
      availableInGame: false,
    },
    collision: {
      kind: "hybrid-grid-draft",
      tileSize: 32,
      subcellSize: 8,
      grid: { width: 3, height: 2, subcellColumns: 12, subcellRows: 8 },
      solidSubcells: [{ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 3 }],
    },
  };
}

describe("GR-3.7 production candidate authoring contract", () => {
  it("normalizes an exact structured request and canonicalizes mask coordinates", () => {
    const validated = validateProductionCandidateAuthoringRequest(request());
    if (validated.collision.kind !== "hybrid-grid-draft") {
      throw new Error("Expected an authored hybrid collision draft");
    }
    expect(validated.collision.solidSubcells).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
    ]);
    expect(validated.settings.layers.map(({ id }) => id)).toEqual(["mist", "base"]);
    expect(Object.isFrozen(validated.collision.solidSubcells)).toBe(true);
  });

  it("detects true structured edits while treating canonical collision ordering as unchanged", () => {
    expect(productionCandidateAuthoringRequestsEqual(request(), {
      ...request(),
      collision: {
        ...request().collision,
        solidSubcells: [...request().collision.solidSubcells].reverse(),
      },
    })).toBe(true);
    expect(productionCandidateAuthoringRequestsEqual(request(), {
      ...request(),
      settings: { ...request().settings, name: "Changed name" },
    })).toBe(false);
  });

  it("updates only structured recipe settings and binds collision to a server-owned mask path", () => {
    const updated = applyProductionCandidateAuthoringRequest(recipe(), request());
    expect(updated).toMatchObject({
      id: "production.island.test-cay",
      name: "Storm Cay",
      family: "world-feature",
      lifecycle: "source",
      provenance: recipe().provenance,
      collision: {
        mode: "mask-file",
        maskFile: "assets-src/gr3/candidate-masks/production-island-test-cay-mask.png",
        tileSize: 32,
        subcellSize: 8,
      },
      runtimeBinding: { assetId: "player.boat.primary", collisionIntent: "preserve" },
    });
    expect(updated.layers.map((layer) => [
      layer.id,
      layer.defaultVisible,
      layer.opacity,
      layer.preparation.targetWidth,
      layer.preparation.targetHeight,
    ])).toEqual([
      ["mist", false, 0.35, 96, 64],
      ["base", true, 0.9, 96, 64],
    ]);
    expect(updated.tags).toEqual(["world-feature", "test-cay", "source"]);
    expect(productionCandidateMaskFile(updated.id)).toBe(updated.collision.mode === "mask-file"
      ? updated.collision.maskFile
      : "");
  });

  it("renders the authored subcells as an exact semantic mask PNG input", () => {
    const mask = productionCandidateMaskPixels(request());
    const alpha = (x: number, y: number) => mask.pixels[(y * mask.width + x) * 4 + 3];
    expect(mask).toMatchObject({ width: 96, height: 64 });
    expect(alpha(0, 0)).toBe(255);
    expect(alpha(39, 31)).toBe(255);
    expect(alpha(40, 31)).toBe(255);
    expect(alpha(48, 31)).toBe(0);
  });

  it("adapts global production subcells to the collision editor's sparse cell profile", () => {
    expect(productionCandidateDraftToEditorProfile({
      formatVersion: 1,
      recipeId: "production.island.test-cay",
      candidateFingerprint: fingerprint,
      ...request().collision,
    })).toEqual({
      kind: "hybrid-grid",
      subcellSize: 8,
      mixedCells: [
        { x: 0, y: 0, solidRows: ["1000", "0000", "0000", "0000"] },
        { x: 1, y: 0, solidRows: ["0000", "0000", "0000", "1100"] },
      ],
    });
  });

  it("persists explicitly passable semantics without imposing navigation-grid dimensions", () => {
    const passable = {
      ...request(),
      settings: {
        ...request().settings,
        family: "shoal",
        targetWidth: 95,
        targetHeight: 61,
      },
      collision: {
        kind: "empty",
        passable: true,
        reason: "Interaction visual remains passable",
      },
    };
    const validated = validateProductionCandidateAuthoringRequest(passable);
    expect(validated.collision).toEqual({
      kind: "empty",
      passable: true,
      reason: "Interaction visual remains passable",
    });
    expect(applyProductionCandidateAuthoringRequest(recipe(), passable).collision).toEqual({
      mode: "empty",
      reason: "Interaction visual remains passable",
    });
    expect(productionCandidateDraftToEditorProfile(validated.collision)).toEqual({ kind: "empty" });
    expect(() => productionCandidateMaskPixels(passable)).toThrow(/do not have a semantic mask/u);
  });

  it("rejects stale-shaped, misaligned, duplicate, and family-incompatible inputs", () => {
    expect(() => validateProductionCandidateAuthoringRequest({ ...request(), debugPath: "C:/tmp" }))
      .toThrow(/contain only/u);
    expect(() => validateProductionCandidateAuthoringRequest({
      ...request(),
      settings: { ...request().settings, targetWidth: 95 },
    })).toThrow(/32 px/u);
    expect(() => validateProductionCandidateAuthoringRequest({
      ...request(),
      collision: {
        ...request().collision,
        solidSubcells: [{ x: 1, y: 1 }, { x: 1, y: 1 }],
      },
    })).toThrow(/repeats/u);
    expect(() => validateProductionCandidateAuthoringRequest({
      ...request(),
      settings: { ...request().settings, family: "shoal" },
    })).toThrow(/cannot use/u);
    expect(() => validateProductionCandidateAuthoringRequest({
      ...request(),
      settings: { ...request().settings, family: "island" },
      collision: { kind: "empty", passable: true, reason: "No obstruction" },
    })).toThrow(/island candidates cannot/u);
    expect(() => validateProductionCandidateAuthoringRequest({
      ...request(),
      settings: { ...request().settings, family: "environment" },
    })).toThrow(/cannot use/u);
  });
});
