import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
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

  it("selects a stable preparable set or one explicit recipe/family", () => {
    expect(selectProductionRecipes(manifest, []).map((recipe) => recipe.id)).toEqual([
      "production.island.colossal-wilderness",
      "production.island.large-fortified-port",
      "production.island.medium-abandoned-atoll",
      "production.island.small-fishing-cay",
      "production.island.tiny-volcanic-stack",
      "production.island.volcano",
    ]);
    expect(selectProductionRecipes(manifest, ["--id", "production.island.small-fishing-cay"]))
      .toHaveLength(1);
    expect(selectProductionRecipes(manifest, ["--family=island"])).toHaveLength(7);
    expect(() => selectProductionRecipes(manifest, ["--id", "missing.asset"]))
      .toThrow(/No production recipes matched/);
  });

  it("creates generated, blank, and explicitly passable editable drafts", async () => {
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

  it("keeps every generated island candidate pending with a seeded editable mask", async () => {
    const index = JSON.parse(await readFile(
      new URL("../assets-src/gr3/generated/production-index.json", import.meta.url),
      "utf8",
    ));
    expect(index).toMatchObject({ formatVersion: 1, pipelineVersion: 2 });
    expect(index.entries).toHaveLength(6);
    for (const entry of index.entries) {
      expect(entry.lifecycle).toBe("candidate");
      expect(entry.layers).toHaveLength(1);
      const draft = JSON.parse(await readFile(new URL(`../${entry.collisionDraftFile}`, import.meta.url), "utf8"));
      expect(draft).toMatchObject({
        recipeId: entry.id,
        candidateFingerprint: entry.jobKey,
        kind: "hybrid-grid-draft",
        tileSize: 32,
        subcellSize: 8,
        method: "prepared-alpha-connected-shoreline-v1",
      });
      expect(draft.solidSubcells.length, entry.id).toBeGreaterThan(0);
      expect(Array.isArray(draft.warnings)).toBe(true);
    }
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
