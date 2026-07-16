import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applicationModeHref,
  resolveWayfindersApplicationMode,
} from "../src/wayfinders/assets/AssetAppMode";

describe("GR-2.1 asset application mode", () => {
  it("opens only for the explicit assets mode and keeps unrelated queries in the game", () => {
    expect(resolveWayfindersApplicationMode("?mode=assets")).toBe("assets");
    expect(resolveWayfindersApplicationMode("?mode=game")).toBe("game");
    expect(resolveWayfindersApplicationMode("?seed=42")).toBe("game");
  });

  it("provides reversible viewer and game links", () => {
    expect(applicationModeHref("game")).toBe("?mode=assets");
    expect(applicationModeHref("assets")).toBe("./");
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
  });
});
