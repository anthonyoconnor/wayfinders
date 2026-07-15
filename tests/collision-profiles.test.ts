import { describe, expect, it } from "vitest";

import fishingShoalPackage from "../src/wayfinders/assets/packages/fishing-shoal.json";
import homeIslandPackage from "../src/wayfinders/assets/packages/home-island.json";
import playerBoatPackage from "../src/wayfinders/assets/packages/player-boat.json";
import { validateAuthoredAssetMetadata } from "../src/wayfinders/assets/AuthoredAssetContracts.ts";
import {
  PILOT_COLLISION_PROFILE_REGISTRY,
  RUNTIME_COLLISION_OBJECT_KINDS,
  RuntimeCollisionProfileRegistry,
  type RuntimeCollisionObjectKind,
} from "../src/wayfinders/assets/CollisionProfileRegistry.ts";
import { makeConfig } from "./helpers.ts";

function legacyPackages() {
  const homeInput = structuredClone(homeIslandPackage) as Record<string, unknown>;
  const boatInput = structuredClone(playerBoatPackage) as Record<string, unknown>;
  const shoalInput = structuredClone(fishingShoalPackage) as Record<string, unknown>;
  delete homeInput.collision;
  delete boatInput.collision;
  delete shoalInput.collision;
  const homeIsland = validateAuthoredAssetMetadata(homeInput);
  const playerBoat = validateAuthoredAssetMetadata(boatInput);
  const fishingShoal = validateAuthoredAssetMetadata(shoalInput);
  if (homeIsland.kind !== "home-island") throw new Error("Expected home package");
  if (playerBoat.kind !== "player-boat") throw new Error("Expected boat package");
  if (fishingShoal.kind !== "fishing-shoal") throw new Error("Expected shoal package");
  return { homeIsland, playerBoat, fishingShoal };
}

describe("GR-2.4 runtime collision profile registry", () => {
  it("registers every runtime object kind exactly once with immutable explicit profiles", () => {
    expect(PILOT_COLLISION_PROFILE_REGISTRY.entries.map(({ objectKind }) => objectKind))
      .toEqual(RUNTIME_COLLISION_OBJECT_KINDS);
    expect(new Set(PILOT_COLLISION_PROFILE_REGISTRY.entries.map(({ objectKind }) => objectKind)).size)
      .toBe(RUNTIME_COLLISION_OBJECT_KINDS.length);

    for (const kind of RUNTIME_COLLISION_OBJECT_KINDS) {
      const value = PILOT_COLLISION_PROFILE_REGISTRY.get(kind);
      expect(value.objectKind).toBe(kind);
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.profile)).toBe(true);
    }
    expect(() => PILOT_COLLISION_PROFILE_REGISTRY.get("buoy" as RuntimeCollisionObjectKind))
      .toThrow(/Unknown runtime collision object kind/);
  });

  it("distinguishes authored blockers and hulls from deliberately empty passable items", () => {
    expect(PILOT_COLLISION_PROFILE_REGISTRY.get("home-island")).toMatchObject({
      source: "authored-package",
      profile: { kind: "hybrid-grid", subcellSize: 8 },
    });
    expect(PILOT_COLLISION_PROFILE_REGISTRY.get("player-ship")).toMatchObject({
      source: "authored-package",
      profile: { kind: "box", offset: { x: 0, y: 0 }, halfSize: { width: 14, height: 14 } },
    });
    expect(PILOT_COLLISION_PROFILE_REGISTRY.get("generated-island").profile).toEqual({ kind: "coarse-grid" });

    for (const kind of [
      "wreck",
      "fishing-shoal",
      "survey-site",
      "survey-service",
      "island-approach",
      "home-dock",
    ] as const) {
      expect(PILOT_COLLISION_PROFILE_REGISTRY.get(kind).profile).toEqual({ kind: "empty" });
    }
    expect(PILOT_COLLISION_PROFILE_REGISTRY.get("fishing-shoal").source).toBe("authored-package");
  });

  it("preserves unambiguous legacy fallbacks when optional collision metadata is absent", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 3 } });
    const registry = new RuntimeCollisionProfileRegistry(legacyPackages(), config);

    expect(registry.get("home-island")).toEqual({
      objectKind: "home-island",
      source: "legacy-fallback",
      profile: { kind: "coarse-grid" },
    });
    expect(registry.get("player-ship")).toEqual({
      objectKind: "player-ship",
      source: "legacy-fallback",
      profile: {
        kind: "box",
        offset: { x: 0, y: 0 },
        halfSize: { width: 3, height: 3 },
      },
    });
    expect(registry.get("fishing-shoal")).toEqual({
      objectKind: "fishing-shoal",
      source: "legacy-fallback",
      profile: { kind: "empty" },
    });
  });
});
