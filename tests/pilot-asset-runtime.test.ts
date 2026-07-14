import { describe, expect, it } from "vitest";
import homeIsland from "../src/wayfinders/assets/packages/home-island.json";
import playerBoat from "../src/wayfinders/assets/packages/player-boat.json";
import fishingShoal from "../src/wayfinders/assets/packages/fishing-shoal.json";
import { AUTHORED_ASSET_IDS } from "../src/wayfinders/assets/AuthoredAssetContracts";
import {
  PILOT_ASSET_CATALOG,
  queuePilotAssetPackages,
} from "../src/wayfinders/assets/PilotAssetCatalog";
import { PilotAssetRuntime } from "../src/wayfinders/assets/PilotAssetRuntime";

const metadataByKey = new Map([
  [PILOT_ASSET_CATALOG[0].metadataKey, homeIsland],
  [PILOT_ASSET_CATALOG[1].metadataKey, playerBoat],
  [PILOT_ASSET_CATALOG[2].metadataKey, fishingShoal],
]);

describe("GR-1.2 pilot asset loading", () => {
  it("queues all package metadata and images before scene creation", () => {
    const queued: string[] = [];
    queuePilotAssetPackages({
      json: (key, url) => queued.push(`json:${key}:${url}`),
      image: (key, url) => queued.push(`image:${key}:${url}`),
    });
    expect(queued).toHaveLength(7);
    expect(queued[0]).toContain("metadata:home-island");
    expect(queued.some((entry) => entry.includes("image:player-wake"))).toBe(true);
  });

  it("validates and resolves all three complete packages by semantic ID", () => {
    const textureKeys = new Set(PILOT_ASSET_CATALOG.flatMap(({ images }) => images.map(({ textureKey }) => textureKey)));
    const runtime = new PilotAssetRuntime({
      metadata: (key) => metadataByKey.get(key),
      hasTexture: (key) => textureKeys.has(key),
    });
    expect(runtime.diagnostics).toEqual([]);
    expect(runtime.isAvailable(AUTHORED_ASSET_IDS.homeIsland)).toBe(true);
    expect(runtime.isAvailable(AUTHORED_ASSET_IDS.playerBoat)).toBe(true);
    expect(runtime.isAvailable(AUTHORED_ASSET_IDS.fishingShoal)).toBe(true);
    expect(runtime.textureKey("player.boat.primary.frames")).toBe("wayfinders:image:player-boat");
  });

  it("keeps a failed package unavailable while preserving the others", () => {
    const missingTexture = PILOT_ASSET_CATALOG[1].images[0].textureKey;
    const runtime = new PilotAssetRuntime({
      metadata: (key) => metadataByKey.get(key),
      hasTexture: (key) => key !== missingTexture,
    });
    expect(runtime.isAvailable(AUTHORED_ASSET_IDS.homeIsland)).toBe(true);
    expect(runtime.isAvailable(AUTHORED_ASSET_IDS.playerBoat)).toBe(false);
    expect(runtime.isAvailable(AUTHORED_ASSET_IDS.fishingShoal)).toBe(true);
    expect(runtime.diagnostics).toEqual([{
      assetId: AUTHORED_ASSET_IDS.playerBoat,
      message: `texture ${missingTexture} did not load`,
    }]);
  });

  it("rejects malformed metadata without registering its texture IDs", () => {
    const runtime = new PilotAssetRuntime({
      metadata: (key) => key === PILOT_ASSET_CATALOG[0].metadataKey
        ? { ...homeIsland, contractVersion: 99 }
        : metadataByKey.get(key),
      hasTexture: () => true,
    });
    expect(runtime.isAvailable(AUTHORED_ASSET_IDS.homeIsland)).toBe(false);
    expect(runtime.textureKey("home.island.primary.complete")).toBeUndefined();
    expect(runtime.diagnostics[0]?.message).toMatch(/Unsupported authored asset contract version/);
  });
});
