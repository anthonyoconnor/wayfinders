import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("audio application composition", () => {
  it("loads one shared catalog for game and asset modes but leaves trial mode audio-free", () => {
    const main = source("../src/main.ts");
    const trial = source("../src/wayfinders/assets/AssetTrialScene.ts");

    expect(main.match(/await tryLoadAudioCatalog\(\)/gu)).toHaveLength(1);
    expect(main).toMatch(
      /applicationMode === "asset-trial"[\s\S]*?\? undefined[\s\S]*?: await tryLoadAudioCatalog\(\)/u,
    );
    expect(main).toContain("createAssetWorkspaceScene(initialAssetWorkspace, audioCatalogResult)");
    expect(main).toContain("createAssetWorkspaceScene(workspace, audioCatalogResult)");
    expect(main).toMatch(/new WayfindersScene\([\s\S]*?audioCatalogResult,[\s\S]*?\)\]/u);
    expect(trial).not.toContain("audioCatalog");
    expect(trial).not.toContain("GameAudio");
  });

  it("preloads and owns game audio only when validation succeeded", () => {
    const scene = source("../src/wayfinders/rendering/WayfindersScene.ts");

    expect(scene).toContain("if (this.audioCatalogResult?.ok)");
    expect(scene).toContain("preloadGameAudioCatalog(this, this.audioCatalogResult.catalog)");
    expect(scene).toContain("new GameAudioController({");
    expect(scene).toContain("const audioSettings = this.gameSettings.audio");
    expect(scene).toContain("masterVolume: audioSettings.masterVolume");
    expect(scene).toContain("categoryVolumes: audioSettings.categoryVolumes");
    expect(scene).toContain("enabledByDefault: audioSettings.enabled");
    expect(scene).toContain("new GameAudioCueController(");
    expect(scene).toContain("new GameMusicController(");
    expect(scene).toContain("this.simulation.events");
    expect(scene).toContain("(action) => this.audioCueController?.enqueueUiAction(action)");
    expect(scene).toContain("new SailingAmbienceController(this.audioController)");
    expect(scene).toContain("this.updateSailingAmbience(delta / 1000)");
    expect(scene).toContain("this.updateGameMusic(delta / 1000)");
    expect(scene).toContain("this.sailingAmbienceInput.speed = this.currentShipPose.speed");
    expect(scene).toContain("this.simulation.wreckPresentationActive");
    expect(scene).toContain("this.simulation.generationHandoverActive");
    expect(scene).toContain("mountUnavailableGameAudioControls(root, message)");
    expect(scene).toContain("this.audioControls?.destroy()");
    expect(scene).toContain("this.audioCueController?.destroy()");
    expect(scene).toContain("this.gameMusicController?.destroy()");
    expect(scene).toContain("this.sailingAmbienceController?.destroy()");
    expect(scene).toContain("this.audioController?.destroy()");
    expect(scene.indexOf("this.audioCueController?.destroy()"))
      .toBeLessThan(scene.indexOf("this.audioController?.destroy()"));
    expect(scene.indexOf("this.gameMusicController?.destroy()"))
      .toBeLessThan(scene.indexOf("this.audioController?.destroy()"));
    expect(scene.indexOf("this.sailingAmbienceController?.destroy()"))
      .toBeLessThan(scene.indexOf("this.audioController?.destroy()"));
  });

  it("adapts the catalog only in the Audio workspace scene branch", () => {
    const factory = source("../src/wayfinders/assets/AssetWorkspaceSceneFactory.ts");

    expect(factory).toContain('case "audio-preview"');
    expect(factory).toContain("audioWorkspaceCatalogSource(audioCatalogResult)");
    expect(factory).toContain('case "great-hall-preview": return new GreatHallPreviewScene(workspace)');
    expect(factory).toContain('case "library": return new AssetViewerScene(workspace)');
  });
});
