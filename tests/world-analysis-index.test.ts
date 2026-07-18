import { describe, expect, it } from "vitest";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
} from "../src/wayfinders/world/WorldTopology";
import { WorldAnalysisIndex } from "../src/wayfinders/world/analysis";

function splitWorld(): WorldGrid {
  const world = new WorldGrid(6, 5, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  for (let y = 0; y < world.height; y++) {
    world.setTerrain(3, y, TerrainType.Land);
    world.setIslandId(3, y, 7);
  }
  return world;
}

describe("WorldAnalysisIndex", () => {
  it("builds passability, coastline, island, and connectivity facts in one source scan", () => {
    const world = splitWorld();
    const analysis = WorldAnalysisIndex.build(world, {
      sourceId: "test-manifest",
      sourceRevision: "v1:seed-42",
    });

    expect(analysis.buildDiagnostics).toMatchObject({
      sourceGridScans: 1,
      sourceCellsRead: 30,
      passableTileCount: 25,
      blockedTileCount: 5,
      coastalWaterTileCount: 10,
      islandShoreTileCount: 5,
      connectedComponentCount: 2,
    });
    expect(analysis.provenance).toMatchObject({
      sourceId: "test-manifest",
      sourceRevision: "v1:seed-42",
      width: 6,
      height: 5,
    });
    expect(analysis.getIslandIds()).toEqual([7]);
    expect(analysis.getIslandIndices(7)).toEqual([3, 9, 15, 21, 27]);
    expect(analysis.getCoastlineIndices("coastal-water")).toEqual([
      2, 4, 8, 10, 14, 16, 20, 22, 26, 28,
    ]);
    expect(analysis.getCoastlineRuns("island-shore")).toEqual([
      { kind: "island-shore", y: 0, startX: 3, endX: 3 },
      { kind: "island-shore", y: 1, startX: 3, endX: 3 },
      { kind: "island-shore", y: 2, startX: 3, endX: 3 },
      { kind: "island-shore", y: 3, startX: 3, endX: 3 },
      { kind: "island-shore", y: 4, startX: 3, endX: 3 },
    ]);

    const left = analysis.componentIdAt({ x: 0, y: 0 });
    const right = analysis.componentIdAt({ x: 5, y: 4 });
    expect(left).toBe(1);
    expect(right).toBe(2);
    expect(analysis.areConnected({ x: 0, y: 0 }, { x: 2, y: 4 })).toBe(true);
    expect(analysis.areConnected({ x: 0, y: 0 }, { x: 5, y: 4 })).toBe(false);
    expect(analysis.getComponentFacts(left!)).toEqual({
      id: 1,
      tileCount: 15,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 4 },
    });
  });

  it("joins water components across a seam without coordinate-edge facts", () => {
    const world = new WorldGrid(6, 5, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    for (let y = 0; y < world.height; y++) {
      world.setTerrain(3, y, TerrainType.Land);
      world.setIslandId(3, y, 7);
    }

    const analysis = WorldAnalysisIndex.build(world);
    const componentId = analysis.componentIdAt({ x: 0, y: 0 });

    expect(analysis.areConnected({ x: 0, y: 0 }, { x: 5, y: 4 })).toBe(true);
    expect(analysis.getAllComponentFacts()).toEqual([{
      id: componentId,
      tileCount: 25,
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 4 },
    }]);
    expect(analysis.getCoastlineIndices("coastal-water")).toEqual([
      2, 4, 8, 10, 14, 16, 20, 22, 26, 28,
    ]);
    expect(analysis.buildDiagnostics.connectedComponentCount).toBe(1);
  });

  it("derives corner-seam coastline from periodic cardinal neighbors", () => {
    const world = new WorldGrid(5, 5, 3, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    for (const [x, y] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const) {
      world.setTerrain(x, y, TerrainType.Land);
      world.setIslandId(x, y, 9);
    }

    const analysis = WorldAnalysisIndex.build(world);

    expect(analysis.getIslandIndices(9)).toEqual([0, 4, 20, 24]);
    expect(analysis.getCoastlineIndices("island-shore")).toEqual([0, 4, 20, 24]);
    expect(analysis.getCoastlineIndices("coastal-water")).toEqual([
      1, 3, 5, 9, 15, 19, 21, 23,
    ]);
    expect(analysis.getAllComponentFacts()).toEqual([{
      id: 1,
      tileCount: 21,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    }]);
  });

  it("reuses narrow indexed candidate sets for feature placement queries", () => {
    const analysis = WorldAnalysisIndex.build(splitWorld());

    const local = analysis.queryTiles({
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      terrain: TerrainType.DeepOcean,
      passable: true,
    });
    expect(local.indices).toEqual([0, 1, 6, 7]);
    expect(local.counters).toEqual({ source: "bounds", tilesExamined: 4, tilesMatched: 4 });

    const shore = analysis.queryTiles({ islandId: 7, coastline: "island-shore" });
    expect(shore.indices).toEqual([3, 9, 15, 21, 27]);
    expect(shore.counters.tilesExamined).toBe(5);
    expect(analysis.getQueryTotals()).toEqual({
      queryCount: 2,
      tilesExamined: 9,
      tilesMatched: 9,
    });
    expect(analysis.buildDiagnostics.sourceGridScans).toBe(1);
  });

  it("provides deterministic reachable service anchors and stable top-k selection", () => {
    const analysis = WorldAnalysisIndex.build(splitWorld());
    const leftComponent = analysis.componentIdAt({ x: 0, y: 0 });
    const rightComponent = analysis.componentIdAt({ x: 5, y: 0 });

    expect(analysis.findServiceAnchor({ x: 3, y: 2 }, leftComponent)).toEqual({ x: 2, y: 2 });
    expect(analysis.findServiceAnchor({ x: 3, y: 2 }, rightComponent)).toEqual({ x: 4, y: 2 });

    const selected = analysis.selectTopTiles(
      { terrain: TerrainType.DeepOcean, passable: true },
      4,
      (index) => index % 5,
    );
    expect(selected.indices).toEqual([0, 5, 10, 20]);
    expect(Object.isFrozen(selected.indices)).toBe(true);
  });

  it("wraps service-anchor search across a corner", () => {
    const world = new WorldGrid(4, 4, 2, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.Land, KnowledgeState.Unknown);
    world.setTerrain(3, 3, TerrainType.DeepOcean);
    const analysis = WorldAnalysisIndex.build(world);

    expect(analysis.findServiceAnchor({ x: 0, y: 0 })).toEqual({ x: 3, y: 3 });
    expect(analysis.findServiceAnchor({ x: 0, y: 0 }, 1)).toEqual({ x: 3, y: 3 });
  });

  it("splits lifted seam bounds and returns unique canonical indices in row-major order", () => {
    const world = new WorldGrid(5, 5, 3, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const analysis = WorldAnalysisIndex.build(world);

    const seam = analysis.queryTiles({
      bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    });
    expect(seam.indices).toEqual([0, 1, 4, 5, 6, 9, 20, 21, 24]);
    expect(seam.counters).toEqual({ source: "bounds", tilesExamined: 9, tilesMatched: 9 });

    const corner = analysis.queryTiles({
      bounds: { minX: 4, minY: 4, maxX: 5, maxY: 5 },
    });
    expect(corner.indices).toEqual([0, 4, 20, 24]);
    expect(corner.counters).toEqual({ source: "bounds", tilesExamined: 4, tilesMatched: 4 });
  });

  it("deduplicates collapsed periodic neighbors and bounds in one- and two-tile worlds", () => {
    const widthOne = new WorldGrid(1, 1, 1, WRAPPING_WORLD_TOPOLOGY);
    widthOne.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const one = WorldAnalysisIndex.build(widthOne);
    expect(one.getAllComponentFacts()).toEqual([{
      id: 1,
      tileCount: 1,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    }]);
    expect(one.buildDiagnostics.cardinalNeighborChecks).toBe(0);
    expect(one.queryTiles({ bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 } }).indices).toEqual([0]);

    const widthTwo = new WorldGrid(2, 2, 1, WRAPPING_WORLD_TOPOLOGY);
    widthTwo.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const two = WorldAnalysisIndex.build(widthTwo);
    expect(two.getAllComponentFacts()).toEqual([{
      id: 1,
      tileCount: 4,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    }]);
    expect(two.buildDiagnostics.cardinalNeighborChecks).toBe(16);
    expect(two.queryTiles({ bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 } }).indices)
      .toEqual([0, 1, 2, 3]);
  });

  it("matches public cardinal-neighbor semantics across bounded, wrapped, and collapsed axes", () => {
    const cases = [
      { width: 1, height: 1, topology: BOUNDED_WORLD_TOPOLOGY },
      { width: 1, height: 1, topology: WRAPPING_WORLD_TOPOLOGY },
      { width: 1, height: 2, topology: BOUNDED_WORLD_TOPOLOGY },
      { width: 1, height: 2, topology: WRAPPING_WORLD_TOPOLOGY },
      { width: 2, height: 1, topology: BOUNDED_WORLD_TOPOLOGY },
      { width: 2, height: 1, topology: WRAPPING_WORLD_TOPOLOGY },
      { width: 2, height: 2, topology: BOUNDED_WORLD_TOPOLOGY },
      { width: 2, height: 2, topology: WRAPPING_WORLD_TOPOLOGY },
      { width: 3, height: 2, topology: { x: "wrap", y: "bounded" } as const },
      { width: 3, height: 2, topology: { x: "bounded", y: "wrap" } as const },
    ];

    for (const { width, height, topology } of cases) {
      const world = new WorldGrid(width, height, 1, topology);
      world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
      for (let index = 0; index < world.tileCount; index++) {
        if (world.tileCount === 1 || (index !== world.tileCount - 1 && index % 5 !== 2)) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        world.setTerrain(x, y, TerrainType.Land);
        world.setIslandId(x, y, 9);
      }

      const expectedCoastalWater: number[] = [];
      const expectedIslandShore: number[] = [];
      let expectedNeighborChecks = 0;
      for (let index = 0; index < world.tileCount; index++) {
        const point = { x: index % width, y: Math.floor(index / width) };
        const neighbors = world.topology.uniqueCardinalNeighbors(point);
        expectedNeighborChecks += neighbors.length;
        const islandId = world.getIslandIdAtIndex(index);
        const passable = !world.isMovementBlockedAtIndex(index);
        const bordersIsland = neighbors.some((neighbor) => (
          world.getIslandIdAtIndex(neighbor.y * width + neighbor.x) >= 0
        ));
        const bordersPassable = neighbors.some((neighbor) => (
          !world.isMovementBlockedAtIndex(neighbor.y * width + neighbor.x)
        ));
        if (passable && islandId < 0 && bordersIsland) expectedCoastalWater.push(index);
        if (islandId >= 0 && bordersPassable) expectedIslandShore.push(index);
      }

      const expectedComponents: number[][] = [];
      const assigned = new Uint8Array(world.tileCount);
      for (let start = 0; start < world.tileCount; start++) {
        if (assigned[start] !== 0 || world.isMovementBlockedAtIndex(start)) continue;
        const members: number[] = [];
        const queue = [start];
        assigned[start] = 1;
        for (let head = 0; head < queue.length; head++) {
          const index = queue[head];
          members.push(index);
          const neighbors = world.topology.uniqueCardinalNeighbors({
            x: index % width,
            y: Math.floor(index / width),
          });
          expectedNeighborChecks += neighbors.length;
          for (const neighbor of neighbors) {
            const neighborIndex = neighbor.y * width + neighbor.x;
            if (assigned[neighborIndex] !== 0 || world.isMovementBlockedAtIndex(neighborIndex)) continue;
            assigned[neighborIndex] = 1;
            queue.push(neighborIndex);
          }
        }
        expectedComponents.push(members);
      }

      const analysis = WorldAnalysisIndex.build(world);
      expect(analysis.getCoastlineIndices("coastal-water")).toEqual(expectedCoastalWater);
      expect(analysis.getCoastlineIndices("island-shore")).toEqual(expectedIslandShore);
      expect(analysis.buildDiagnostics.cardinalNeighborChecks).toBe(expectedNeighborChecks);
      expect(analysis.getAllComponentFacts().map(({ id }) => analysis.getComponentIndices(id)))
        .toEqual(expectedComponents);
    }
  });

  it("captures a snapshot and reports when source topology becomes stale", () => {
    const world = splitWorld();
    const analysis = WorldAnalysisIndex.build(world);
    expect(analysis.isCurrentFor(world)).toBe(true);

    world.setTerrain(0, 0, TerrainType.Land);
    expect(analysis.isCurrentFor(world)).toBe(false);
    expect(analysis.terrainAt(0)).toBe(TerrainType.DeepOcean);
    expect(analysis.isPassable(0)).toBe(true);
  });
});
