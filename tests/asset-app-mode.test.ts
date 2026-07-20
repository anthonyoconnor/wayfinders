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
});
