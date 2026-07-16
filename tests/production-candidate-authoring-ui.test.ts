import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/wayfinders/assets/AssetViewerScene.ts", import.meta.url),
  "utf8",
);

describe("GR-3.7 pending candidate authoring UI", () => {
  it("uses structured persisted settings and keeps preview controls explicitly separate", () => {
    expect(source).toContain('data-production-authoring="name"');
    expect(source).toContain('data-production-authoring="family"');
    expect(source).toContain('data-production-authoring="width"');
    expect(source).toContain('data-production-authoring="height"');
    expect(source).toContain('data-production-authoring="collision-semantics"');
    expect(source).toContain('data-production-authoring="runtime-binding"');
    expect(source).toContain("Persisted layer order, visibility and opacity");
    expect(source).toContain("Display controls (not saved)");
  });

  it("serializes the live collision model and saves through the narrow authoring route", () => {
    expect(source).toContain("productionHybridCollisionFromModel");
    expect(source).toContain("snapshot.masks");
    expect(source).toContain("isCollisionSubcellSolid(mask, subX, subY)");
    expect(source).toContain("validateProductionCandidateAuthoringRequest");
    expect(source).toContain('"/__wayfinders/assets/candidate/save"');
    expect(source).toContain("PRODUCTION_ASSET_LIBRARY_SELECTION_KEY");
    expect(source).toContain("window.location.reload()");
  });

  it("invalidates validation on collision edits and gates review and promotion", () => {
    expect(source).toMatch(
      /afterCollisionMutation[\s\S]*?markProductionCandidateStale\("Collision changed;/u,
    );
    expect(source).toContain("validation.state === \"current\" && !locallyDirty");
    expect(source).toContain("reviewState !== \"approved\"");
    expect(source).toContain('entry.recipe.runtimeBinding?.collisionIntent !== "preserve"');
    expect(source).toContain('entry.recipe.collision.mode !== "mask-file"');
    expect(source).toContain('"/__wayfinders/assets/candidate/validate"');
    expect(source).toContain('"/__wayfinders/assets/candidate/promote"');
  });

  it("preserves exact saved state, recognizes reverted edits, and guards selection changes", () => {
    expect(source).toContain("productionAuthoringBaselines");
    expect(source).toContain("productionCandidateAuthoringRequestsEqual");
    expect(source).toContain("productionEmptyReasons.get(entry.id)");
    expect(source).toContain("Discard unsaved settings and collision edits");
    expect(source).toContain("Selection unchanged; save or discard");
  });

  it("offers a fingerprinted isolated trial while pending and has no full-game override", () => {
    expect(source).toContain("assetTrialApplicationHref({");
    expect(source).toContain('data-production="trial-link"');
    expect(source).toContain("Trial candidate");
    expect(source).toContain('entry.recipe.family === "island"');
    expect(source).toContain('entry.collisionDraft.kind === "hybrid-grid-draft"');
    expect(source).toContain("Save before trial");
    expect(source).not.toContain("testAsset");
    expect(source).not.toContain("data-production=test-link");
    expect(source).not.toContain("productionGameTestUrl");
  });
});
