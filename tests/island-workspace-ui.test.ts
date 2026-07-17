import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scene = readFileSync(
  new URL("../src/wayfinders/assets/AssetViewerScene.ts", import.meta.url),
  "utf8",
);
const intake = readFileSync(
  new URL("../src/wayfinders/assets/ProductionAssetIntakeUi.ts", import.meta.url),
  "utf8",
);

describe("GR-4.1 focused island workshop", () => {
  it("mounts a dedicated island workbench before the general asset controls", () => {
    expect(scene).toContain('if (this.workspace.id === "islands")');
    expect(scene).toContain("this.mountIslandControls(slot, signal)");
    expect(scene).toContain('data-island="name"');
    expect(scene).toContain('data-island="available"');
    expect(scene).toContain('data-island-action="trial"');
    expect(scene).toContain('data-island-action="save"');
    expect(scene).toContain('data-island-action="delete"');
    expect(scene).toContain("private async deleteImportedIsland");
    expect(scene).toContain("Permanently delete");
    expect(scene).toContain(">Save changes</button>");
  });

  it("keeps only the required collision editing actions in the island markup", () => {
    const focusedMarkup = scene.slice(
      scene.indexOf("private mountIslandControls"),
      scene.indexOf("private islandCandidateAuthoringRequest"),
    );
    expect(focusedMarkup).toContain('data-collision-tool="paint"');
    expect(focusedMarkup).toContain('data-collision-tool="erase"');
    expect(focusedMarkup).toContain('data-collision-brush="1"');
    expect(focusedMarkup).toContain('data-collision-brush="4"');
    expect(focusedMarkup).toContain('data-collision="undo"');
    expect(focusedMarkup).toContain('data-collision="redo"');
    expect(focusedMarkup).toContain('data-collision="reset"');
    expect(focusedMarkup).not.toContain("Runtime profile");
    expect(focusedMarkup).not.toContain("Approve current");
    expect(focusedMarkup).not.toContain("Promote approved");
    expect(focusedMarkup).not.toContain("Portable candidate file");
  });

  it("saves candidate properties and the live complete mask through one request", () => {
    expect(scene).toContain("private islandCandidateAuthoringRequest");
    expect(scene).toContain("this.productionHybridCollisionFromModel(dimensions.width, dimensions.height)");
    expect(scene).toContain("body: JSON.stringify(request)");
    expect(scene).toContain("availableInGame");
    expect(scene).toContain("available.checked");
    expect(scene).toContain('this.reportIslandStatus("Saving changes…")');
  });

  it("derives the island card badge and filters from saved availability", () => {
    expect(scene).toContain('entry.entryType === "production-candidate" && entry.availableInGame');
    expect(scene).toContain('availableInGame ? "Available" : "Unavailable"');
    expect(scene).toContain('data-library-availability="${availableInGame ? "available" : "unavailable"}"');
  });

  it("focuses island intake without exposing unrelated family controls", () => {
    expect(scene).toContain('focusedFamily: "island"');
    expect(intake).toContain("focusedFamily?: ProductionAssetFamily");
    expect(intake).toContain("Import island PNG");
    expect(intake).toContain("Its canvas size and initial collision mask are read automatically.");
    expect(intake).toContain('name="lockAspectRatio"');
    expect(intake).toContain("productionAssetNameFromFileName(sourceFile.name)");
    expect(intake).toContain('syncAspectRatio("width")');
    expect(intake).toContain('syncAspectRatio("height")');
    expect(intake).toContain("data-intake-advanced");
    expect(intake).toContain('focusedFamily === "island" && job.recipeId');
  });
});
