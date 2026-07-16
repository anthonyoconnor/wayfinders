import { describe, expect, it } from "vitest";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WorldAnalysisIndex } from "../src/wayfinders/world/analysis";

function splitWorld(): WorldGrid {
  const world = new WorldGrid(6, 5, 4);
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
    expect(analysis.getComponentFacts(left!)).toMatchObject({
      id: 1,
      tileCount: 15,
      touchesNorthEdge: true,
      touchesSouthEdge: true,
      touchesWestEdge: true,
      touchesEastEdge: false,
    });
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
