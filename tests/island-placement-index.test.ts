import { describe, expect, it } from "vitest";

import {
  IslandPlacementIndex,
  type IslandPlacementCircle,
} from "../src/wayfinders/world/IslandPlacementIndex.ts";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  WorldTopology,
} from "../src/wayfinders/world/WorldTopology.ts";

describe("island placement spatial hash", () => {
  it("matches an exact all-islands check while examining only local neighbours", () => {
    const islands: IslandPlacementCircle[] = [];
    const topology = new WorldTopology(208, 168, 32, 16, BOUNDED_WORLD_TOPOLOGY);
    const index = new IslandPlacementIndex(topology, 2, 2);
    for (let row = 0; row < 20; row++) {
      for (let column = 0; column < 25; column++) {
        const island = {
          id: islands.length + 1,
          center: { x: column * 8, y: row * 8 },
          outerRadius: 2,
        };
        islands.push(island);
        index.add(island);
      }
    }

    for (let sample = 0; sample < 100; sample++) {
      const center = {
        x: (sample * 47) % 204,
        y: (sample * 83) % 164,
      };
      const expectedConflict = islands.some((island) => (
        Math.hypot(center.x - island.center.x, center.y - island.center.y) < 6
      ));
      expect(index.findConflict(center, 2) !== undefined).toBe(expectedConflict);
    }

    const diagnostics = index.diagnostics();
    expect(diagnostics.islandCount).toBe(500);
    expect(diagnostics.queryCount).toBe(100);
    expect(diagnostics.candidateChecks).toBeLessThan(500);
    expect(diagnostics.maximumCandidatesPerQuery).toBeLessThanOrEqual(4);
  });

  it("finds opposite-edge conflicts without duplicating periodic candidates", () => {
    const topology = new WorldTopology(20, 10, 32, 4, WRAPPING_WORLD_TOPOLOGY);
    const index = new IslandPlacementIndex(topology, 2, 2);
    index.add({ id: 1, center: { x: 19, y: 5 }, outerRadius: 2 });

    expect(index.findConflict({ x: 0, y: 5 }, 2)?.id).toBe(1);
    expect(index.findConflict({ x: 10, y: 5 }, 2)).toBeUndefined();
    expect(index.diagnostics()).toMatchObject({
      islandCount: 1,
      queryCount: 2,
      candidateChecks: 2,
      maximumCandidatesPerQuery: 1,
    });
  });
});
