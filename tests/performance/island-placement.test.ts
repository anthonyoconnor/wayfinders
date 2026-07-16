import { describe, expect, it } from "vitest";

import { resolveAuthoredHomeIslandPlacement } from "../../src/wayfinders/assets/AuthoredHomeIsland.ts";
import { IslandGenerator } from "../../src/wayfinders/world/IslandGenerator.ts";
import { WorldGrid } from "../../src/wayfinders/world/WorldGrid.ts";
import { createWorldProfileConfig } from "../fixtures/worldProfiles.ts";

describe("large-world island placement", () => {
  it.each([1, 20, 13_371, 84_221, 99_999])(
    "places and replays all 300 P2 islands for seed %i",
    (seed) => {
      const config = createWorldProfileConfig("P2");
      const grid = new WorldGrid(config.world.width, config.world.height, config.navigation.chunkSize);
      const homePlacement = {
        x: Math.floor(grid.width / 2),
        y: Math.floor(grid.height / 2),
      };
      const landmarks = resolveAuthoredHomeIslandPlacement(homePlacement).landmarks;
      const generator = new IslandGenerator(config);

      const islands = generator.plan(grid, seed, landmarks.homeCenter, landmarks.dock);
      const replay = generator.plan(grid, seed, landmarks.homeCenter, landmarks.dock);

      expect(islands).toHaveLength(300);
      expect(replay).toEqual(islands);
      let narrowestChannelSurplus = Number.POSITIVE_INFINITY;
      for (let left = 0; left < islands.length; left++) {
        for (let right = left + 1; right < islands.length; right++) {
          const a = islands[left];
          const b = islands[right];
          narrowestChannelSurplus = Math.min(
            narrowestChannelSurplus,
            Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)
              - a.outerRadius
              - b.outerRadius
              - config.islands.minimumChannelWidth,
          );
        }
      }
      expect(narrowestChannelSurplus).toBeGreaterThanOrEqual(0);
    },
  );
});
