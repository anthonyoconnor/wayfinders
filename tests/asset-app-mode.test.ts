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
});
