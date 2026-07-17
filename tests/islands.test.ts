import { describe, expect, it } from "vitest";

import { ForwardRangeSystem } from "../src/wayfinders/exploration/ForwardRangeSystem.ts";
import { createShipStateAtGrid } from "../src/wayfinders/navigation/MovementSystem.ts";
import {
  IslandGenerator,
  IslandKind,
  IslandSize,
} from "../src/wayfinders/world/IslandGenerator.ts";
import {
  KnowledgeState,
  TerrainType,
  terrainBlocksMovement,
  terrainBlocksSight,
} from "../src/wayfinders/world/TileData.ts";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { makeConfig } from "./helpers.ts";

function islandTiles(world: ReturnType<WorldGenerator["generate"]>, islandId: number) {
  const tiles: Array<{ x: number; y: number; terrain: TerrainType }> = [];
  world.grid.forEachTile((x, y) => {
    const tile = world.grid.getTile(x, y);
    if (tile.islandId === islandId) tiles.push({ x, y, terrain: tile.terrain });
  });
  return tiles;
}

function reachableWater(world: ReturnType<WorldGenerator["generate"]>): Uint8Array {
  const { grid, landmarks } = world;
  const visited = new Uint8Array(grid.tileCount);
  const queue = new Int32Array(grid.tileCount);
  let head = 0;
  let tail = 0;
  const start = grid.index(landmarks.dock.x, landmarks.dock.y);
  visited[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const point = grid.pointFromIndex(queue[head++]);
    const neighbors = [
      [point.x - 1, point.y],
      [point.x + 1, point.y],
      [point.x, point.y - 1],
      [point.x, point.y + 1],
    ] as const;
    for (const [x, y] of neighbors) {
      if (!grid.inBounds(x, y) || grid.isMovementBlocked(x, y)) continue;
      const index = grid.index(x, y);
      if (visited[index]) continue;
      visited[index] = 1;
      queue[tail++] = index;
    }
  }
  return visited;
}

describe("scattered island generation", () => {
  it("creates the configured inventory with every morphology and size band", () => {
    const config = makeConfig();
    const generated = new WorldGenerator(config).generate(config.world.seed);

    expect(generated.islands).toHaveLength(config.islands.count);
    expect(generated.islands.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(generated.islands.map(({ kind }) => kind))).toEqual(new Set(Object.values(IslandKind)));
    expect(new Set(generated.islands.map(({ size }) => size))).toEqual(new Set(Object.values(IslandSize)));

    for (const island of generated.islands) {
      const tiles = islandTiles(generated, island.id);
      expect(tiles.length, `island ${island.id} should paint terrain`).toBeGreaterThan(0);
      expect(tiles.every(({ x, y }) => (
        generated.grid.getKnowledge(x, y) === KnowledgeState.Unknown
        && generated.grid.getExpeditionStamp(x, y) === 0
        && Math.hypot(x - island.center.x, y - island.center.y) <= island.outerRadius
      ))).toBe(true);
    }
  });

  it("changes the scatter between seeds but reproduces descriptors exactly for one seed", () => {
    const generator = new WorldGenerator(makeConfig());
    const first = generator.generate(84_221);
    const replay = generator.generate(84_221);
    const alternate = generator.generate(84_222);

    expect(replay.islands).toEqual(first.islands);
    expect(alternate.islands).not.toEqual(first.islands);
  });

  it("can plan descriptors without mutating the logical grid", () => {
    const config = makeConfig();
    const generated = new WorldGenerator(config).generate(84_221);
    const blank = new WorldGrid(config.world.width, config.world.height, config.navigation.chunkSize);
    blank.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const versionsBefore = {
      terrain: blank.terrainVersion,
      collision: blank.collisionVersion,
      knowledge: blank.knowledgeVersion,
      topology: blank.supportedTopologyVersion,
    };

    const planned = new IslandGenerator(config).plan(
      blank,
      generated.seed,
      generated.landmarks.homeCenter,
      generated.landmarks.dock,
    );

    expect(planned).toEqual(generated.islands);
    expect({
      terrain: blank.terrainVersion,
      collision: blank.collisionVersion,
      knowledge: blank.knowledgeVersion,
      topology: blank.supportedTopologyVersion,
    }).toEqual(versionsBefore);
  });

  it("preserves margins, home clearance, wide channels, and the eastbound starter lane", () => {
    const config = makeConfig();
    const generated = new WorldGenerator(config).generate(config.world.seed);
    const { dock, homeCenter } = generated.landmarks;

    for (const island of generated.islands) {
      expect(island.center.x - island.outerRadius).toBeGreaterThanOrEqual(config.islands.edgeMargin);
      expect(island.center.y - island.outerRadius).toBeGreaterThanOrEqual(config.islands.edgeMargin);
      expect(island.center.x + island.outerRadius).toBeLessThanOrEqual(
        generated.grid.width - 1 - config.islands.edgeMargin,
      );
      expect(island.center.y + island.outerRadius).toBeLessThanOrEqual(
        generated.grid.height - 1 - config.islands.edgeMargin,
      );
      expect(Math.hypot(island.center.x - homeCenter.x, island.center.y - homeCenter.y)).toBeGreaterThanOrEqual(
        config.world.supportedWaterRadius
          + config.world.supportedBoundaryNoise
          + config.islands.homeClearance
          + island.outerRadius,
      );
    }

    for (let left = 0; left < generated.islands.length; left++) {
      for (let right = left + 1; right < generated.islands.length; right++) {
        const a = generated.islands[left];
        const b = generated.islands[right];
        expect(Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)).toBeGreaterThanOrEqual(
          a.outerRadius + b.outerRadius + config.islands.minimumChannelWidth,
        );
      }
    }

    for (let x = dock.x; x < generated.grid.width; x++) {
      for (
        let y = dock.y - config.islands.safeCorridorHalfWidth;
        y <= dock.y + config.islands.safeCorridorHalfWidth;
        y++
      ) {
        expect(generated.grid.getTile(x, y).islandId).toBeLessThan(1);
        expect(generated.grid.isMovementBlocked(x, y)).toBe(false);
      }
    }
  });

  it("retains authoritative collision and sight behavior on generated terrain", () => {
    const generated = new WorldGenerator(makeConfig()).generate(13_371);
    const terrainSeen = new Set<TerrainType>();

    generated.grid.forEachTile((x, y) => {
      const tile = generated.grid.getTile(x, y);
      if (tile.islandId <= 0) return;
      terrainSeen.add(tile.terrain);
      expect(tile.movementBlocked).toBe(terrainBlocksMovement(tile.terrain));
      expect(tile.sightBlocked).toBe(terrainBlocksSight(tile.terrain));
    });

    expect(terrainSeen).toEqual(new Set([
      TerrainType.ShallowOcean,
      TerrainType.Reef,
      TerrainType.Rock,
      TerrainType.Land,
    ]));
  });

  it.each([20, 30, 13_371])("keeps every atoll lagoon navigable for seed %i", (seed) => {
    const generated = new WorldGenerator(makeConfig()).generate(seed);
    const reachable = reachableWater(generated);
    const atolls = generated.islands.filter(({ kind }) => kind === IslandKind.Atoll);
    expect(atolls.length).toBeGreaterThan(0);
    for (const atoll of atolls) {
      expect(reachable[generated.grid.index(atoll.center.x, atoll.center.y)]).toBe(1);
    }
  });

  it("does not let Unknown island blockers alter the forward-range estimate", () => {
    const config = makeConfig({ provisions: { startingBundles: 100 } });
    const generated = new WorldGenerator(config).generate(13_371);
    const hiddenIslands = new WorldGrid(generated.grid.width, generated.grid.height, config.navigation.chunkSize);
    const clearOcean = new WorldGrid(generated.grid.width, generated.grid.height, config.navigation.chunkSize);
    hiddenIslands.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    clearOcean.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);

    generated.grid.forEachTile((x, y) => {
      if (generated.grid.getTile(x, y).islandId > 0) {
        hiddenIslands.setTerrain(x, y, generated.grid.getTerrain(x, y));
      }
    });
    const { dock } = generated.landmarks;
    hiddenIslands.setKnowledge(dock.x, dock.y, KnowledgeState.Supported);
    clearOcean.setKnowledge(dock.x, dock.y, KnowledgeState.Supported);
    const ship = createShipStateAtGrid(dock, 100, 0, config);

    const hiddenEstimate = new ForwardRangeSystem(hiddenIslands, config).calculate(ship);
    const clearEstimate = new ForwardRangeSystem(clearOcean, config).calculate(ship);
    expect([...hiddenEstimate.mask]).toEqual([...clearEstimate.mask]);
    expect([...hiddenEstimate.costs]).toEqual([...clearEstimate.costs]);
  });

  it.each([1, 2, 3, 20, 30, 42, 13_371, 99_999, 2_147_483_647])(
    "places every island and protects the complete starter lane for seed %i",
    (seed) => {
      const config = makeConfig();
      const generated = new WorldGenerator(config).generate(seed);
      expect(generated.islands).toHaveLength(config.islands.count);
      const { dock } = generated.landmarks;
      for (let x = dock.x; x < generated.grid.width; x++) {
        for (
          let y = dock.y - config.islands.safeCorridorHalfWidth;
          y <= dock.y + config.islands.safeCorridorHalfWidth;
          y++
        ) {
          expect(generated.grid.isMovementBlocked(x, y)).toBe(false);
        }
      }
    },
  );

  it("returns a deterministic partial plan when the configured placement constraints are impossible", () => {
    const config = makeConfig({ islands: { minimumChannelWidth: 100 } });
    const generator = new WorldGenerator(config);
    const first = generator.generate(31_415);
    const replay = generator.generate(31_415);

    expect(first.islands.length).toBeLessThan(config.islands.count);
    expect(first.islands.length).toBeGreaterThan(0);
    expect(replay.manifest).toEqual(first.manifest);
  });
});
