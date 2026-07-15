import type Phaser from "phaser";
import { describe, expect, it } from "vitest";
import productionIndex from "../assets-src/gr3/generated/production-index.json";
import productionRecipes from "../assets-src/gr3/production-recipes.json";
import {
  preloadProductionAssetTestOverride,
  resolveProductionAssetTestOverride,
} from "../src/wayfinders/assets/ProductionAssetTesting";

const candidate = productionIndex.entries.find((entry) => entry.id === "production.island.small-fishing-cay");
if (!candidate) throw new Error("Small fishing cay production fixture is missing");
const imageKey = `../../../${candidate.layers[0].file}`;

describe("production asset game testing", () => {
  it("ignores absent, pending, rejected and stale candidate requests", () => {
    expect(resolveProductionAssetTestOverride("", productionRecipes, productionIndex, {
      formatVersion: 1,
      decisions: [],
    }, { [imageKey]: "/candidate.png" })).toBeUndefined();

    for (const decision of ["rejected", "approved"] as const) {
      const fingerprint = decision === "approved" ? "0".repeat(64) : candidate.jobKey;
      expect(resolveProductionAssetTestOverride(
        "?testAsset=production.island.small-fishing-cay",
        productionRecipes,
        productionIndex,
        {
          formatVersion: 1,
          decisions: [{
            recipeId: candidate.id,
            candidateFingerprint: fingerprint,
            decision,
          }],
        },
        { [imageKey]: "/candidate.png" },
      )).toBeUndefined();
    }
  });

  it("resolves an exact approved visual while preserving the home runtime slot", () => {
    const override = resolveProductionAssetTestOverride(
      "?mode=game&testAsset=production.island.small-fishing-cay",
      productionRecipes,
      productionIndex,
      {
        formatVersion: 1,
        decisions: [{
          recipeId: candidate.id,
          candidateFingerprint: candidate.jobKey,
          decision: "approved",
        }],
      },
      { [imageKey]: "/candidate.png" },
    );

    expect(override).toMatchObject({
      recipeId: candidate.id,
      candidateFingerprint: candidate.jobKey,
      assetId: "home.island.primary",
      imageId: "home.island.primary.complete",
      url: "/candidate.png",
    });
    expect(override?.collisionNotice).toMatch(/keeps its accepted collision and gameplay metadata/);
  });

  it("preloads only a resolved test texture", () => {
    const queued: string[] = [];
    const scene = {
      load: { image: (key: string, url: string) => queued.push(`${key}:${url}`) },
    } as unknown as Phaser.Scene;
    preloadProductionAssetTestOverride(scene, undefined);
    preloadProductionAssetTestOverride(scene, {
      recipeId: candidate.id,
      recipeName: "Small Fishing Cay",
      candidateFingerprint: candidate.jobKey,
      assetId: "home.island.primary",
      imageId: "home.island.primary.complete",
      textureKey: "wayfinders:production-test:small-cay",
      url: "/candidate.png",
      collisionNotice: "Visual test only",
    });
    expect(queued).toEqual(["wayfinders:production-test:small-cay:/candidate.png"]);
  });
});
