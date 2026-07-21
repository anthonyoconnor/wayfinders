import { describe, expect, it } from "vitest";

import {
  IslandGenerator,
  IslandKind,
  IslandSize,
  intersectsPeriodicStarterLane,
  type GeneratedIsland,
} from "../src/wayfinders/world/IslandGenerator";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY, WorldTopology } from "../src/wayfinders/world/WorldTopology";
import { authoredStarterLaneBounds } from "../src/wayfinders/world/authored";
import { makeConfig } from "./helpers";

function proceduralIsland(
  id: number,
  kind: IslandKind,
  center: Readonly<{ x: number; y: number }>,
): GeneratedIsland {
  return {
    id,
    kind,
    size: IslandSize.Small,
    center: { ...center },
    radiusX: 2,
    radiusY: 1.75,
    outerRadius: 3,
    rotation: id * 0.17,
    shapeSeed: 1_000 + id,
    bounds: {
      minX: center.x - 3,
      minY: center.y - 3,
      maxX: center.x + 3,
      maxY: center.y + 3,
    },
    sourceKind: "procedural",
  };
}

function wrappingWorld(): WorldGrid {
  const world = new WorldGrid(32, 24, 8, WRAPPING_WORLD_TOPOLOGY, 32);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  return world;
}

describe("periodic island generation", () => {
  it("rasterizes every procedural kind coherently across axes and a corner", () => {
    const config = makeConfig({ world: { width: 32, height: 24 } });
    const world = wrappingWorld();
    const islands = [
      proceduralIsland(1, IslandKind.HighIsland, { x: 0, y: 6 }),
      proceduralIsland(2, IslandKind.LowCay, { x: 31, y: 18 }),
      proceduralIsland(3, IslandKind.Atoll, { x: 16, y: 0 }),
      proceduralIsland(4, IslandKind.RockySkerry, { x: 0, y: 0 }),
    ];

    new IslandGenerator(config).rasterize(world, 84_221, islands, { x: 16, y: 12 });

    for (const island of islands) {
      const indices = new Set<number>();
      world.forEachTile((x, y, index) => {
        if (world.getIslandId(x, y) === island.id) indices.add(index);
      });
      expect(indices.size).toBeGreaterThan(0);
    }
    expect([0, world.width - 1].every((x) => (
      Array.from({ length: world.height }, (_, y) => world.getIslandId(x, y)).some((id) => id > 0)
    ))).toBe(true);
    expect([0, world.height - 1].every((y) => (
      Array.from({ length: world.width }, (_, x) => world.getIslandId(x, y)).some((id) => id > 0)
    ))).toBe(true);
    expect(world.getIslandId(0, 0)).toBeGreaterThan(0);
    expect(world.getIslandId(world.width - 1, world.height - 1)).toBeGreaterThan(0);
  });

  it("keeps one authored collision identity when its saved mask crosses a seam", () => {
    const config = makeConfig({ world: { width: 32, height: 24 } });
    const world = wrappingWorld();
    const island: GeneratedIsland = {
      id: 9,
      kind: IslandKind.LowCay,
      size: IslandSize.Small,
      center: { x: 0, y: 12 },
      radiusX: 2,
      radiusY: 1.5,
      outerRadius: 3,
      rotation: 0,
      shapeSeed: 9_001,
      bounds: { minX: -2, minY: 11, maxX: 1, maxY: 13 },
      sourceKind: "authored",
      authoredAssetId: "seam-authored",
      authoredCollision: {
        gridWidth: 4,
        gridHeight: 3,
        solidSubcells: [
          { x: 0, y: 4 },
          { x: 15, y: 4 },
        ],
      },
    };

    new IslandGenerator(config).rasterize(world, 13_371, [island], { x: 16, y: 12 });

    expect(world.getIslandId(30, 12)).toBe(9);
    expect(world.getIslandId(1, 12)).toBe(9);
    expect(world.getFineCollisionMask(30, 12)).toBeDefined();
    expect(world.getFineCollisionMask(1, 12)).toBeDefined();
    expect([...new Set(
      Array.from({ length: world.tileCount }, (_, index) => world.getIslandIdAtIndex(index))
        .filter((id) => id > 0),
    )]).toEqual([9]);
  });

  it("ends the starter exclusion at the lifted half-world endpoint", () => {
    const topology = new WorldTopology(32, 24, 32, 8, WRAPPING_WORLD_TOPOLOGY);
    const dock = { x: 16, y: 12 };

    expect(intersectsPeriodicStarterLane(topology, dock, { x: 0, y: 12 }, 1, 2)).toBe(true);
    expect(intersectsPeriodicStarterLane(topology, dock, { x: 2, y: 12 }, 1, 2)).toBe(false);
    expect(intersectsPeriodicStarterLane(topology, dock, { x: 8, y: 12 }, 1, 2)).toBe(false);
    expect(authoredStarterLaneBounds(topology, dock, 2)).toEqual({
      minX: 16,
      minY: 10,
      maxX: 32,
      maxY: 14,
    });
  });

  it("requires a real non-contractible cycle rather than merely reaching a seam", () => {
    const config = makeConfig({ world: { width: 32, height: 24 } });
    const world = wrappingWorld();
    for (let y = 0; y < world.height; y++) world.setTerrain(0, y, TerrainType.Rock);

    expect(() => new IslandGenerator(config).rasterize(world, 1, [], { x: 16, y: 12 }))
      .toThrow("lacks independent horizontal and vertical circumnavigation cycles");
  });
});
