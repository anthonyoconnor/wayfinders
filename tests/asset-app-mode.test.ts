import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applicationModeHref,
  assetTrialApplicationHref,
  resolveAssetTrialApplicationRequest,
  resolveWayfindersApplicationMode,
} from "../src/wayfinders/assets/AssetAppMode";

describe("GR-2.1 asset application mode", () => {
  it("opens only for the explicit assets mode and keeps unrelated queries in the game", () => {
    expect(resolveWayfindersApplicationMode("?mode=assets")).toBe("assets");
    expect(resolveWayfindersApplicationMode("?mode=asset-trial")).toBe("asset-trial");
    expect(resolveWayfindersApplicationMode("?mode=game")).toBe("game");
    expect(resolveWayfindersApplicationMode("?seed=42")).toBe("game");
  });

  it("provides reversible viewer and game links", () => {
    expect(applicationModeHref("game")).toBe("?mode=assets");
    expect(applicationModeHref("assets")).toBe("./");
    expect(applicationModeHref("asset-trial")).toBe("?mode=assets");
  });

  it("round-trips only a stable candidate and its exact fingerprint through the sea-trial route", () => {
    const request = {
      candidateId: "production.island.test-cay",
      candidateFingerprint: "a".repeat(64),
    };
    const href = assetTrialApplicationHref(request);

    expect(href).toBe(
      `?mode=asset-trial&candidate=production.island.test-cay&fingerprint=${"a".repeat(64)}`,
    );
    expect(resolveAssetTrialApplicationRequest(href)).toEqual(request);
    expect(resolveAssetTrialApplicationRequest("?mode=assets")).toBeUndefined();
    expect(() => resolveAssetTrialApplicationRequest(
      `?mode=asset-trial&candidate=Production.Island&fingerprint=${"a".repeat(64)}`,
    )).toThrow("stable candidate ID");
    expect(() => resolveAssetTrialApplicationRequest(
      "?mode=asset-trial&candidate=production.island.test-cay&fingerprint=stale",
    )).toThrow("current candidate fingerprint");
  });

  it("keeps the GR-3.8 scene candidate-only and returns to the same library record", () => {
    const source = readFileSync(
      new URL("../src/wayfinders/assets/AssetTrialScene.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "this.trial = createProductionAssetTrial(entry, request.candidateFingerprint)",
    );
    expect(source.indexOf("this.trial = createProductionAssetTrial"))
      .toBeLessThan(source.indexOf("create(): void"));
    expect(source).toContain("this.candidate.candidateLayers.entries()");
    expect(source).not.toContain('from "../core/GameSimulation"');
    expect(source).toContain("data-trial-grid");
    expect(source).toContain("data-trial-collision");
    expect(source).toContain("this.trial.resetPositions[this.resetIndex]");
    expect(source).toContain("PRODUCTION_ASSET_LIBRARY_SELECTION_KEY");
    expect(source).toContain('document.querySelector<HTMLAnchorElement>("#asset-mode-link")');
    expect(source).toMatch(/addKeys\(\{[\s\S]*?alternateReverse:[\s\S]*?\}, false\)/u);
  });

  it("wires every collision authoring mode to its matching control panel", () => {
    const source = readFileSync(
      new URL("../src/wayfinders/assets/AssetViewerScene.ts", import.meta.url),
      "utf8",
    );
    const panelModes = [...source.matchAll(/data-collision-panel="([^"]+)"/gu)]
      .map((match) => match[1]);

    expect(panelModes).toEqual([
      "hybrid-grid",
      "box",
      "explicit-empty",
      "read-only",
    ]);
  });

  it("keeps direct save, whole-cell painting, draft retention, and lazy references in the library workspace", () => {
    const source = readFileSync(
      new URL("../src/wayfinders/assets/AssetViewerScene.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('data-collision-brush="1"');
    expect(source).toContain('data-collision-brush="4"');
    expect(source).toContain("Save to library");
    expect(source).toContain("/__wayfinders/collision/save");
    expect(source).toContain("collisionDraftsByAssetId");
    expect(source).toContain("prepared-alpha-connected-shoreline-v1");
    expect(source).toContain("Collision warning");
    expect(source).toContain("acceptedMetadataByAssetId");
    expect(source).toContain("data-library-thumb-src");
    expect(source).not.toContain("this.load.image(this.libraryTextureKey(entry.id)");
  });

  it("leaves asset-form letters and navigation keys available to focused DOM controls", () => {
    const source = readFileSync(
      new URL("../src/wayfinders/assets/AssetViewerScene.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Phaser.Input.Keyboard.KeyCodes.E, false");
    expect(source).toContain("Phaser.Input.Keyboard.KeyCodes.Q, false");
    expect(source).toMatch(/addKeys\(\{[\s\S]*?KeyCodes\.RIGHT,[\s\S]*?\}, false\)/u);
    expect(source).toContain("#asset-library-browser, .production-intake-dialog");
  });

  it("defaults guided PNG intake to native dimensions and offers transparent grid padding", () => {
    const source = readFileSync(
      new URL("../src/wayfinders/assets/ProductionAssetIntakeUi.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('name="keepOriginalDimensions" type="checkbox" checked');
    expect(source).toContain("productionAssetPngDimensions");
    expect(source).toContain("Pad transparently to");
  });

  it("keeps asset-library sidebars permanent and reserves the center column for Phaser", () => {
    const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

    expect(styles).toContain('html[data-application-mode="assets"] .app-shell');
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) var(--asset-inspector-width)");
    expect(styles).toMatch(/data-application-mode="assets"\] \.game-host[\s\S]*?grid-column: 2/u);
    expect(styles).toMatch(/data-application-mode="assets"\] \.asset-library-browser[\s\S]*?position: relative/u);
    expect(styles).toMatch(/data-application-mode="assets"\] \.developer-tools[\s\S]*?position: relative/u);
    expect(main).toContain('const permanentAssetTools = applicationMode === "assets"');
    expect(main).toContain("const effectiveOpen = permanentAssetTools || open");
    expect(main).toContain("gameHost.clientWidth || window.innerWidth");
  });

  it("checks intake name and stable-ID availability without a confirmation checkbox", () => {
    const source = readFileSync(
      new URL("../src/wayfinders/assets/ProductionAssetIntakeUi.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("existingNames");
    expect(source).toContain("existingIds");
    expect(source).toContain("updateIdentityAvailability");
    expect(source).not.toContain("idConfirmed");
  });
});
