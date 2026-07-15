import { describe, expect, it } from "vitest";
import {
  PILOT_HOME_ISLAND_METADATA,
  stampAuthoredHomeIsland,
} from "../src/wayfinders/assets/AuthoredHomeIsland.ts";
import {
  authoredCellBlocksMovement,
  authoredCellBlocksSight,
  authoredTerrainToTerrainType,
} from "../src/wayfinders/assets/AuthoredAssetContracts.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";

describe("GR-1.3 authored home-island placement", () => {
  it("stamps the complete fixed layout and translates every gameplay anchor", () => {
    const grid = new WorldGrid(31, 31, 16);
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    grid.setKnowledge(15, 15, KnowledgeState.Supported);

    const placement = stampAuthoredHomeIsland(grid, { x: 15, y: 15 });

    expect(placement.topLeft).toEqual({ x: 8, y: 8 });
    expect(placement.landmarks).toEqual({
      homeCenter: { x: 15, y: 15 },
      harbour: { x: 19, y: 15 },
      dock: { x: 20, y: 15 },
      homeReturnTile: { x: 20, y: 15 },
    });
    expect(placement.service).toEqual({ x: 20, y: 15 });
    expect(grid.getKnowledge(15, 15)).toBe(KnowledgeState.Supported);

    for (const cell of PILOT_HOME_ISLAND_METADATA.grid.cells) {
      const x = placement.topLeft.x + cell.x;
      const y = placement.topLeft.y + cell.y;
      expect(grid.getTerrain(x, y)).toBe(authoredTerrainToTerrainType(cell.terrain));
      expect(grid.isMovementBlocked(x, y)).toBe(authoredCellBlocksMovement(cell));
      expect(grid.isSightBlocked(x, y)).toBe(authoredCellBlocksSight(cell));
      expect(grid.getIslandId(x, y)).toBe(cell.belongsToHomeIsland ? 0 : -1);
    }
  });

  it("keeps the authored footprint identical across procedural world seeds", () => {
    const first = new WorldGenerator().generate(7_001);
    const second = new WorldGenerator().generate(7_002);
    const origin = PILOT_HOME_ISLAND_METADATA.grid.placementOrigin;
    const firstTopLeft = {
      x: first.landmarks.homeCenter.x - origin.x,
      y: first.landmarks.homeCenter.y - origin.y,
    };
    const secondTopLeft = {
      x: second.landmarks.homeCenter.x - origin.x,
      y: second.landmarks.homeCenter.y - origin.y,
    };

    for (const cell of PILOT_HOME_ISLAND_METADATA.grid.cells) {
      const firstTile = first.grid.getTile(firstTopLeft.x + cell.x, firstTopLeft.y + cell.y);
      const secondTile = second.grid.getTile(secondTopLeft.x + cell.x, secondTopLeft.y + cell.y);
      expect(secondTile.terrain).toBe(firstTile.terrain);
      expect(secondTile.movementBlocked).toBe(firstTile.movementBlocked);
      expect(secondTile.sightBlocked).toBe(firstTile.sightBlocked);
      expect(secondTile.islandId).toBe(firstTile.islandId);
    }
  });

  it("blocks the illustrated shoreline while preserving the east harbour lane", () => {
    const grid = new WorldGrid(31, 31, 16);
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const placement = stampAuthoredHomeIsland(grid, { x: 15, y: 15 });

    for (const point of [
      { x: 7, y: 1 },
      { x: 4, y: 2 },
      { x: 10, y: 2 },
      { x: 3, y: 3 },
      { x: 11, y: 3 },
      { x: 4, y: 12 },
      { x: 10, y: 12 },
    ]) {
      expect(grid.isMovementBlocked(
        placement.topLeft.x + point.x,
        placement.topLeft.y + point.y,
      )).toBe(true);
    }

    for (let x = 10; x <= 12; x++) {
      expect(grid.isMovementBlocked(placement.topLeft.x + x, placement.topLeft.y + 7)).toBe(false);
    }
  });

  it("rejects a procedural anchor that cannot contain the authored footprint", () => {
    const grid = new WorldGrid(15, 15, 8);
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    expect(() => stampAuthoredHomeIsland(grid, { x: 2, y: 2 })).toThrow(/does not fit/);
  });
});
