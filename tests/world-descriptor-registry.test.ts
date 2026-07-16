import { describe, expect, it } from "vitest";
import {
  WorldDescriptorRegistry,
  boundsForWorldIndices,
  createBoundsDescriptor,
  createPointDescriptor,
} from "../src/wayfinders/app/WorldDescriptorRegistry";

describe("WorldDescriptorRegistry", () => {
  it("groups one bounded heterogeneous query by public domain identity", () => {
    const registry = new WorldDescriptorRegistry(16);
    registry.replace([
      createPointDescriptor("fishing-shoal", "fish-1", { x: 4, y: 4 }),
      createPointDescriptor("survey-site", "site-1", { x: 5, y: 4 }),
      createBoundsDescriptor("island-dossier", 7, { minX: 3, minY: 3, maxX: 6, maxY: 6 }),
      createPointDescriptor("wreck", 2, { x: 80, y: 80 }),
    ]);

    const result = registry.queryNear({ x: 4, y: 4 }, 1.5);
    expect(result.candidates).toEqual({
      fishingShoalIds: ["fish-1"],
      surveySiteIds: ["site-1"],
      islandDossierIds: [7],
      wreckIds: [],
    });
    expect(result.query.counters.bucketsExamined).toBeLessThanOrEqual(4);
    expect(result.query.counters.entitiesExamined).toBe(3);
  });

  it("tracks dynamic wreck membership and derives descriptor bounds", () => {
    const registry = new WorldDescriptorRegistry(8);
    registry.replace([]);
    const added = registry.upsert(createPointDescriptor("wreck", 3, { x: 9, y: 9 }));
    expect(added.changedEntityIds).toEqual(["wreck:3"]);
    expect(added.changedChunks).toEqual([{ x: 1, y: 1 }]);
    expect(registry.queryNear({ x: 9, y: 9 }, 0).candidates.wreckIds).toEqual([3]);

    expect(boundsForWorldIndices([0, 5, 17], 8)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 5,
      maxY: 2,
    });
  });
});
