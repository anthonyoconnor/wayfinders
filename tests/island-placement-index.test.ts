import { describe, expect, it } from "vitest";

import {
  IslandPlacementIndex,
  type IslandPlacementCircle,
} from "../src/wayfinders/world/IslandPlacementIndex.ts";

describe("island placement spatial hash", () => {
  it("matches an exact all-islands check while examining only local neighbours", () => {
    const islands: IslandPlacementCircle[] = [];
    const index = new IslandPlacementIndex(2, 2);
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
});
