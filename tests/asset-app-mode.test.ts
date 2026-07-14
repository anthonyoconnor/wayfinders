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
});
