import { describe, expect, it } from "vitest";
import productionIndex from "../assets-src/gr3/generated/production-index.json";
import productionRecipes from "../assets-src/gr3/production-recipes.json";
import {
  canonicalJson,
  createCollisionDraft,
  runIsolatedProductionJobs,
  selectProductionRecipes,
} from "../scripts/production-asset-pipeline.mjs";
import {
  validateProductionAssetRecipeManifest,
} from "../src/wayfinders/assets/ProductionAssetRecipe.ts";

const manifest = validateProductionAssetRecipeManifest(productionRecipes);

function image(width, height, alpha = 0) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = alpha;
  return { width, height, pixels };
}

function fillAlpha(target, left, top, width, height, alpha = 255) {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      target.pixels[(y * target.width + x) * 4 + 3] = alpha;
    }
  }
}

describe("GR-3.2 production preparation pipeline", () => {
  it("canonicalizes recipe values independent of object key order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } }))
      .toBe(canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));
  });

  it("selects the current preparable sources and can select a runtime recipe explicitly", () => {
    expect(selectProductionRecipes(manifest, [])).toHaveLength(26);
    expect(selectProductionRecipes(manifest, ["--id", "home.island.primary"]))
      .toHaveLength(1);
    expect(selectProductionRecipes(manifest, ["--family=island"])).toHaveLength(27);
    expect(() => selectProductionRecipes(manifest, ["--id", "missing.asset"]))
      .toThrow(/No production recipes matched/);
  });

  it("creates centered, shoreline, blank, and explicitly passable editable drafts", async () => {
    const preparedLayers = [{ image: image(480, 480, 255) }];
    const blank = await createCollisionDraft({
      id: "production.island.test",
      collision: { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
    }, preparedLayers, "fingerprint");
    expect(blank).toMatchObject({
      kind: "hybrid-grid-draft",
      grid: { width: 15, height: 15, subcellColumns: 60, subcellRows: 60 },
      solidSubcells: [],
    });

    const centered = await createCollisionDraft({
      id: "production.island.centered",
      collision: { mode: "center-circle", tileSize: 32, subcellSize: 8 },
    }, [{ image: image(64, 64, 255) }], "centered-fingerprint");
    expect(centered).toMatchObject({
      kind: "hybrid-grid-draft",
      method: "prepared-canvas-centered-circle-v1",
      grid: { width: 2, height: 2, subcellColumns: 8, subcellRows: 8 },
    });
    expect(centered.solidSubcells).toHaveLength(12);

    const shorelineImage = image(64, 64);
    fillAlpha(shorelineImage, 16, 16, 32, 32);
    const shoreline = await createCollisionDraft({
      id: "production.island.shoreline",
      collision: { mode: "shoreline-seed", tileSize: 32, subcellSize: 8 },
    }, [{ image: shorelineImage }], "shoreline-fingerprint");
    expect(shoreline).toMatchObject({
      kind: "hybrid-grid-draft",
      method: "prepared-alpha-connected-shoreline-v1",
      warnings: [],
      grid: { width: 2, height: 2, subcellColumns: 8, subcellRows: 8 },
    });
    expect(shoreline.solidSubcells).not.toHaveLength(0);

    const empty = await createCollisionDraft({
      id: "production.shoal.test",
      collision: { mode: "empty", reason: "Shoals are passable" },
    }, preparedLayers, "fingerprint");
    expect(empty).toMatchObject({ kind: "empty", passable: true });
  });

  it("records the current generated candidate inventory", () => {
    expect(productionIndex).toMatchObject({
      formatVersion: 1,
      pipelineVersion: 2,
      entries: expect.arrayContaining([
        expect.objectContaining({ id: "production.island.horseshoe", lifecycle: "candidate" }),
      ]),
    });
    expect(productionIndex.entries).toHaveLength(26);
  });

  it("continues a batch after one isolated recipe failure", async () => {
    const recipes = [{ id: "first" }, { id: "broken" }, { id: "last" }];
    const visited = [];
    const batch = await runIsolatedProductionJobs(recipes, async (recipe) => {
      visited.push(recipe.id);
      if (recipe.id === "broken") throw new Error("source is invalid");
      return { status: "prepared", recipeId: recipe.id };
    });
    expect(visited).toEqual(["first", "broken", "last"]);
    expect(batch.results.map(({ recipeId }) => recipeId)).toEqual(["first", "last"]);
    expect(batch.failures).toHaveLength(1);
    expect(batch.failures[0]).toMatchObject({ recipeId: "broken" });
  });
});
