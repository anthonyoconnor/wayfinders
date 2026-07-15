import { describe, expect, it } from "vitest";

import {
  authoredAssetIdForCollisionObject,
  createCollisionAuthoringTarget,
  createCollisionAuthoringTargets,
  type CollisionAuthoringMetadataOverrides,
} from "../src/wayfinders/assets/CollisionAuthoringTargets.ts";
import {
  validateAuthoredAssetMetadata,
} from "../src/wayfinders/assets/AuthoredAssetContracts.ts";
import {
  RUNTIME_COLLISION_OBJECT_KINDS,
} from "../src/wayfinders/assets/CollisionProfileRegistry.ts";
import { FULL_COLLISION_MASK } from "../src/wayfinders/world/CollisionMask.ts";
import fishingShoalPackage from "../src/wayfinders/assets/packages/fishing-shoal.json";
import homeIslandPackage from "../src/wayfinders/assets/packages/home-island.json";
import playerBoatPackage from "../src/wayfinders/assets/packages/player-boat.json";
import { makeConfig } from "./helpers.ts";

function validatedOverrides(
  homeInput: unknown = homeIslandPackage,
  playerInput: unknown = playerBoatPackage,
  shoalInput: unknown = fishingShoalPackage,
): Required<CollisionAuthoringMetadataOverrides> {
  const homeIsland = validateAuthoredAssetMetadata(homeInput);
  const playerBoat = validateAuthoredAssetMetadata(playerInput);
  const fishingShoal = validateAuthoredAssetMetadata(shoalInput);
  if (homeIsland.kind !== "home-island") throw new TypeError("Expected home-island metadata");
  if (playerBoat.kind !== "player-boat") throw new TypeError("Expected player-boat metadata");
  if (fishingShoal.kind !== "fishing-shoal") throw new TypeError("Expected fishing-shoal metadata");
  return { homeIsland, playerBoat, fishingShoal };
}

describe("GR-2.5 collision authoring targets", () => {
  it("describes every registered runtime category exactly once in registry order", () => {
    const targets = createCollisionAuthoringTargets();

    expect(targets.map(({ objectKind }) => objectKind)).toEqual(RUNTIME_COLLISION_OBJECT_KINDS);
    expect(new Set(targets.map(({ objectKind }) => objectKind)).size).toBe(targets.length);
    for (const target of targets) {
      expect(target.baseMasks).toHaveLength(target.width * target.height);
      expect(target.visualBounds.width).toBeGreaterThan(0);
      expect(target.visualBounds.height).toBeGreaterThan(0);
      expect(target.editingNote.length).toBeGreaterThan(10);
    }
  });

  it("offers truthful profile-specific editing for package-backed finite geometry", () => {
    expect(createCollisionAuthoringTarget("home-island").editing).toBe("hybrid-grid");
    expect(createCollisionAuthoringTarget("player-ship").editing).toBe("box");
    expect(createCollisionAuthoringTarget("fishing-shoal").editing).toBe("explicit-empty");
    expect(authoredAssetIdForCollisionObject("home-island")).toBe("home.island.primary");
    expect(authoredAssetIdForCollisionObject("player-ship")).toBe("player.boat.primary");
    expect(authoredAssetIdForCollisionObject("fishing-shoal")).toBe("shoal.fishing.primary");
  });

  it("keeps procedural and non-authoritative dynamic profiles inspectable but read-only", () => {
    for (const kind of [
      "generated-island",
      "wreck",
      "survey-site",
      "survey-service",
      "island-approach",
      "home-dock",
    ] as const) {
      const target = createCollisionAuthoringTarget(kind);
      expect(target.editing).toBe("read-only");
      expect(authoredAssetIdForCollisionObject(kind)).toBeUndefined();
    }
    expect([...createCollisionAuthoringTarget("generated-island").baseMasks])
      .toContain(FULL_COLLISION_MASK);
  });

  it("derives every package-backed authored profile from the supplied override package", () => {
    const homeInput = structuredClone(homeIslandPackage) as Record<string, unknown>;
    homeInput.collision = {
      kind: "hybrid-grid",
      subcellSize: 8,
      mixedCells: [{ x: 1, y: 1, solidRows: ["1000", "0000", "0000", "0000"] }],
    };
    const playerInput = structuredClone(playerBoatPackage) as Record<string, unknown>;
    playerInput.collision = {
      kind: "box",
      offset: { x: 0, y: 0 },
      halfSize: { width: 12, height: 12 },
    };
    const overrides = validatedOverrides(homeInput, playerInput);

    const home = createCollisionAuthoringTarget("home-island", overrides);
    const player = createCollisionAuthoringTarget("player-ship", overrides);
    const shoal = createCollisionAuthoringTarget("fishing-shoal", overrides);
    expect(home.profile).toEqual(overrides.homeIsland.collision);
    expect(player.profile).toEqual(overrides.playerBoat.collision);
    expect(shoal.profile).toEqual(overrides.fishingShoal.collision);
    expect([home.source, player.source, shoal.source]).toEqual([
      "authored-package",
      "authored-package",
      "authored-package",
    ]);
  });

  it("derives legacy fallbacks from omitted supplied profiles and the current movement config", () => {
    const homeInput = structuredClone(homeIslandPackage) as Record<string, unknown>;
    const playerInput = structuredClone(playerBoatPackage) as Record<string, unknown>;
    const shoalInput = structuredClone(fishingShoalPackage) as Record<string, unknown>;
    delete homeInput.collision;
    delete playerInput.collision;
    delete shoalInput.collision;
    const overrides = validatedOverrides(homeInput, playerInput, shoalInput);
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 11 } });

    const home = createCollisionAuthoringTarget("home-island", overrides, config);
    const player = createCollisionAuthoringTarget("player-ship", overrides, config);
    const shoal = createCollisionAuthoringTarget("fishing-shoal", overrides, config);
    expect(home.profile).toEqual({ kind: "coarse-grid" });
    expect(player.profile).toEqual({
      kind: "box",
      offset: { x: 0, y: 0 },
      halfSize: { width: 11, height: 11 },
    });
    expect(shoal.profile).toEqual({ kind: "empty" });
    expect([home.source, player.source, shoal.source]).toEqual([
      "legacy-fallback",
      "legacy-fallback",
      "legacy-fallback",
    ]);
  });

  it("uses authored tileSize for package targets and navigation tileSize for developer previews", () => {
    const homeInput = structuredClone(homeIslandPackage) as Record<string, unknown>;
    const playerInput = structuredClone(playerBoatPackage) as Record<string, unknown>;
    const shoalInput = structuredClone(fishingShoalPackage) as Record<string, unknown>;
    delete homeInput.collision;
    homeInput.tileSize = 64;
    playerInput.tileSize = 64;
    shoalInput.tileSize = 64;
    const overrides = validatedOverrides(homeInput, playerInput, shoalInput);
    const config = makeConfig({ navigation: { tileSize: 48 } });

    expect(createCollisionAuthoringTarget("home-island", overrides, config).tileSize).toBe(64);
    expect(createCollisionAuthoringTarget("player-ship", overrides, config).tileSize).toBe(64);
    expect(createCollisionAuthoringTarget("fishing-shoal", overrides, config).tileSize).toBe(64);
    const generated = createCollisionAuthoringTarget("generated-island", overrides, config);
    expect(generated.tileSize).toBe(48);
    expect(generated.visualBounds).toEqual({ width: 7 * 48, height: 7 * 48 });
    expect(createCollisionAuthoringTarget("wreck", overrides, config).tileSize).toBe(48);
  });

  it("publishes frozen defensive mask copies", () => {
    const first = createCollisionAuthoringTarget("home-island");
    const second = createCollisionAuthoringTarget("home-island");
    const initial = first.baseMasks[0];

    expect(Object.isFrozen(first.baseMasks)).toBe(true);
    expect(first.baseMasks).not.toBe(second.baseMasks);
    expect(Reflect.set(first.baseMasks, "0", initial === 0 ? FULL_COLLISION_MASK : 0)).toBe(false);
    expect(first.baseMasks[0]).toBe(initial);
    expect(second.baseMasks[0]).toBe(initial);
  });
});
