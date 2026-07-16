import { describe, expect, it } from "vitest";
import { DEFAULT_PROTOTYPE_CONFIG, prototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import {
  createWorldProfileConfig,
  WORLD_PROFILES,
  type WorldProfileName,
} from "./fixtures/worldProfiles";

describe("architecture world profiles", () => {
  it.each([
    ["P0", 96, 96, 8, 1],
    ["P1", 192, 192, 32, 4],
    ["P2", 384, 384, 300, 16],
  ] as const)(
    "%s names its dimensions, island target, and area tier",
    (name, width, height, islandCount, areaMultiplier) => {
      const profile = WORLD_PROFILES[name];
      expect(profile.config.world.width).toBe(width);
      expect(profile.config.world.height).toBe(height);
      expect(profile.config.islands.count).toBe(islandCount);
      expect(profile.targetIslandCount).toBe(islandCount);
      expect(profile.areaMultiplier).toBe(areaMultiplier);
    },
  );

  it.each(["P0", "P1", "P2"] as const)(
    "%s returns detached configuration instances",
    (name: WorldProfileName) => {
      const first = createWorldProfileConfig(name);
      const second = createWorldProfileConfig(name);
      first.world.seed += 1;
      first.islands.count += 1;

      expect(second).toEqual(WORLD_PROFILES[name].config);
      expect(prototypeConfig.world.seed).toBe(DEFAULT_PROTOTYPE_CONFIG.world.seed);
      expect(prototypeConfig.islands.count).toBe(DEFAULT_PROTOTYPE_CONFIG.islands.count);
    },
  );

  it("records every P2 non-default setting explicitly", () => {
    expect(WORLD_PROFILES.P2.nonDefaultSettings).toEqual({
      world: {
        width: 384,
        height: 384,
      },
      islands: {
        count: 300,
        minRadius: 1,
        maxRadius: 3,
        minimumChannelWidth: 4,
        homeClearance: 1,
        edgeMargin: 3,
        placementAttempts: 48,
        archipelagoClusters: 24,
        archipelagoRadius: 24,
        archipelagoBias: 0.6,
      },
    });
  });

  it("keeps density, island-size, archipelago, and channel policies explicit", () => {
    const profile = WORLD_PROFILES.P2;
    expect(profile.density.islandCount).toBe(300);
    expect(profile.islandSize).toEqual({ minRadius: 1, maxRadius: 3 });
    expect(profile.archipelago).toEqual({ clusters: 24, radius: 24, bias: 0.6 });
    expect(profile.minimumChannel).toEqual({ width: 4, edgeMargin: 3, homeClearance: 1 });
    expect(profile.placementAttemptLimit).toBe(48);
  });
});
