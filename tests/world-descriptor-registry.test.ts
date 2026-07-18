import { describe, expect, it } from "vitest";
import {
  WorldDescriptorRegistry,
  boundsForWorldIndices,
  boundsForWorldPoints,
  createBoundsDescriptor,
  createPointDescriptor,
} from "../src/wayfinders/app/WorldDescriptorRegistry";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  WorldTopology,
} from "../src/wayfinders/world/WorldTopology";

function boundedTopology(chunkSize: number, width = 128, height = 128): WorldTopology {
  return new WorldTopology(width, height, 1, chunkSize, BOUNDED_WORLD_TOPOLOGY);
}

describe("WorldDescriptorRegistry", () => {
  it("groups one bounded heterogeneous query by public domain identity", () => {
    const registry = new WorldDescriptorRegistry(boundedTopology(16));
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
    const topology = boundedTopology(8, 16, 16);
    const registry = new WorldDescriptorRegistry(topology);
    registry.replace([]);
    const added = registry.upsert(createPointDescriptor("wreck", 3, { x: 9, y: 9 }));
    expect(added.changedEntityIds).toEqual(["wreck:3"]);
    expect(added.changedChunks).toEqual([{ x: 1, y: 1 }]);
    expect(registry.queryNear({ x: 9, y: 9 }, 0).candidates.wreckIds).toEqual([3]);

    expect(boundsForWorldIndices([0, 5, 17], boundedTopology(8, 8, 8))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 5,
      maxY: 2,
    });
  });

  it("derives local lifted seam bounds and groups each descriptor identity once", () => {
    const topology = new WorldTopology(8, 8, 1, 4, WRAPPING_WORLD_TOPOLOGY);
    const registry = new WorldDescriptorRegistry(topology);
    const cornerBounds = boundsForWorldIndices([0, 7, 56, 63], topology);
    expect(cornerBounds).toEqual({ minX: 7, minY: 7, maxX: 8, maxY: 8 });
    expect(boundsForWorldPoints([{ x: 0, y: 2 }, { x: 4, y: 2 }], topology))
      .toEqual({ minX: 0, minY: 2, maxX: 4, maxY: 2 });

    registry.replace([
      createBoundsDescriptor("island-dossier", 9, cornerBounds),
      createPointDescriptor("fishing-shoal", "seam-fish", { x: 7, y: 0 }),
    ]);

    const result = registry.queryBounds({ minX: -1, minY: -1, maxX: 0, maxY: 0 });
    expect(result.candidates).toEqual({
      fishingShoalIds: ["seam-fish"],
      surveySiteIds: [],
      islandDossierIds: [9],
      wreckIds: [],
    });
    expect(result.query.counters.bucketsExamined).toBe(4);
    expect(result.query.counters.entitiesExamined).toBe(2);
  });
});
