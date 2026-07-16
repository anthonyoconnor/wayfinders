import { describe, expect, it } from "vitest";
import productionRecipes from "../assets-src/gr3/production-recipes.json";
import { AUTHORED_ASSET_IDS } from "../src/wayfinders/assets/AuthoredAssetContracts";
import {
  validateProductionAssetRecipeManifest,
} from "../src/wayfinders/assets/ProductionAssetRecipe";

function validIslandRecipe() {
  return {
    id: "production.island.small-fishing-cay",
    name: "Small Fishing Cay",
    family: "island",
    lifecycle: "source",
    collection: "Island production sources",
    sortOrder: 10,
    tags: ["island", "small", "source"],
    provenance: {
      kind: "selected-source",
      sourceFile: "assets-src/gr1/island-small-fishing-cay-source.png",
    },
    layers: [{
      id: "base",
      name: "Base island",
      role: "base",
      sourceFile: "assets-src/gr1/island-small-fishing-cay-source.png",
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
      preparation: {
        mode: "connected-border",
        targetWidth: 480,
        targetHeight: 480,
        thumbnailMaximum: 192,
        matteColor: [255, 0, 255],
        innerTolerance: 48,
        outerTolerance: 96,
        trimAlphaThreshold: 8,
        padding: 8,
      },
    }],
    animations: [],
    collision: { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
  };
}

describe("production asset recipe manifest", () => {
  it("tracks the three pilot bindings and current prepared island sources", () => {
    const manifest = validateProductionAssetRecipeManifest(productionRecipes);
    expect(manifest.recipes).toHaveLength(9);
    expect(manifest.recipes.filter((recipe) => recipe.lifecycle === "runtime").map((recipe) => recipe.id))
      .toEqual([
        AUTHORED_ASSET_IDS.homeIsland,
        AUTHORED_ASSET_IDS.playerBoat,
        AUTHORED_ASSET_IDS.fishingShoal,
      ]);
    const sources = manifest.recipes.filter((recipe) => recipe.lifecycle === "source");
    expect(sources.map((recipe) => recipe.id)).toEqual([
      "production.island.colossal-wilderness",
      "production.island.large-fortified-port",
      "production.island.medium-abandoned-atoll",
      "production.island.small-fishing-cay",
      "production.island.tiny-volcanic-stack",
      "production.island.volcano",
    ]);
    expect(sources.every((recipe) => recipe.collision.mode === "shoreline-seed")).toBe(true);
  });

  it("validates and freezes a lightweight island source recipe", () => {
    const manifest = validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [validIslandRecipe()],
    });

    expect(manifest.recipes[0]).toMatchObject({
      id: "production.island.small-fishing-cay",
      lifecycle: "source",
      collision: { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.recipes[0].layers[0].preparation)).toBe(true);
  });

  it("accepts an explicit prepared shoreline seed as an editable island draft", () => {
    const manifest = validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...validIslandRecipe(),
        collision: { mode: "shoreline-seed", tileSize: 32, subcellSize: 8 },
      }],
    });

    expect(manifest.recipes[0].collision).toEqual({
      mode: "shoreline-seed",
      tileSize: 32,
      subcellSize: 8,
    });
  });

  it("accepts the closed pilot runtime IDs only when visual work preserves collision", () => {
    const recipe = validIslandRecipe();
    const manifest = validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...recipe,
        id: AUTHORED_ASSET_IDS.homeIsland,
        lifecycle: "runtime",
        provenance: {
          kind: "runtime-package",
          sourceFile: "public/assets/gr1/images/home-island.png",
        },
        layers: [{
          ...recipe.layers[0],
          sourceFile: "public/assets/gr1/images/home-island.png",
          preparation: {
            mode: "preserve",
            targetWidth: 480,
            targetHeight: 480,
            thumbnailMaximum: 192,
          },
        }],
        collision: { mode: "preserve" },
        runtimeBinding: {
          assetId: AUTHORED_ASSET_IDS.homeIsland,
          collisionIntent: "preserve",
        },
      }],
    });

    expect(manifest.recipes[0].runtimeBinding).toEqual({
      assetId: AUTHORED_ASSET_IDS.homeIsland,
      collisionIntent: "preserve",
    });

    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...recipe,
        id: AUTHORED_ASSET_IDS.homeIsland,
        lifecycle: "runtime",
        provenance: {
          kind: "runtime-package",
          sourceFile: "public/assets/gr1/images/home-island.png",
        },
        collision: { mode: "preserve" },
      }],
    })).toThrow(/runtime lifecycle requires a runtimeBinding/);
  });

  it("rejects unsafe paths, duplicate identities and duplicate layer IDs", () => {
    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...validIslandRecipe(),
        provenance: { kind: "selected-source", sourceFile: "../outside.png" },
      }],
    })).toThrow(/repository-relative/);

    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...validIslandRecipe(),
        provenance: { kind: "selected-source", sourceFile: "assets-src/gr1/island.png" },
        layers: [{ ...validIslandRecipe().layers[0], sourceFile: "assets-src/gr1/island.png" }],
      }],
    })).toThrow(/assets-src\/\*-source\.png/);

    const recipe = validIslandRecipe();
    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [recipe, structuredClone(recipe)],
    })).toThrow(/Duplicate production asset recipe ID/);

    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{ ...recipe, layers: [recipe.layers[0], structuredClone(recipe.layers[0])] }],
    })).toThrow(/duplicate layer ID/);
  });

  it("requires explicit semantic intent for alpha and passable shoal collision", () => {
    const island = validIslandRecipe();
    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...island,
        collision: { mode: "alpha", tileSize: 32, subcellSize: 8 },
      }],
    })).toThrow(/alphaMeansSolid/);

    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...island,
        id: "production.shoal.rich",
        family: "shoal",
        collision: { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
      }],
    })).toThrow(/shoals must remain explicitly empty/);
  });

  it("rejects collision grids that do not align and animations targeting missing layers", () => {
    const recipe = validIslandRecipe();
    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{ ...recipe, collision: { mode: "blank-draft", tileSize: 32, subcellSize: 7 } }],
    })).toThrow(/divide tileSize/);

    expect(() => validateProductionAssetRecipeManifest({
      formatVersion: 1,
      recipes: [{
        ...recipe,
        animations: [{
          id: "idle",
          name: "Idle",
          kind: "sprite-sheet",
          layerId: "missing",
          frameWidth: 32,
          frameHeight: 32,
          frameCount: 4,
          framesPerSecond: 4,
          directionCount: 1,
        }],
      }],
    })).toThrow(/does not name a recipe layer/);
  });
});
