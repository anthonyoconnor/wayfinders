import { describe, expect, it } from "vitest";

import { firstShipCollisionTime, type CollisionQueryStats } from "../src/wayfinders/navigation/CollisionGeometry.ts";
import { createShipStateAtGrid, MovementSystem } from "../src/wayfinders/navigation/MovementSystem.ts";
import {
  collisionMaskToSolidRows,
  collisionSubcellBit,
  EMPTY_COLLISION_MASK,
  FULL_COLLISION_MASK,
  isCollisionSubcellSolid,
  solidRowsToCollisionMask,
} from "../src/wayfinders/world/CollisionMask.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { BOUNDED_WORLD_TOPOLOGY, WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology.ts";
import { makeConfig } from "./helpers.ts";

const DIAGONAL_ROWS = ["1000", "0100", "0010", "0001"] as const;

function openWorld(width = 10, height = 5, knowledge = KnowledgeState.Unknown): WorldGrid {
  const world = new WorldGrid(width, height, Math.min(width, 8), BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, knowledge);
  return world;
}

describe("GR-2.4 sparse hybrid collision", () => {
  it("round-trips row-major masks without rotating or transposing subcells", () => {
    const mask = solidRowsToCollisionMask(DIAGONAL_ROWS);

    expect(collisionMaskToSolidRows(mask)).toEqual(DIAGONAL_ROWS);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(isCollisionSubcellSolid(mask, x, y)).toBe(x === y);
        expect((mask & collisionSubcellBit(x, y)) !== 0).toBe(x === y);
      }
    }
  });

  it("stores sparse mixed or uniform overrides and restores coarse fallback on clear", () => {
    const world = openWorld(6, 5, KnowledgeState.Supported);
    world.setTerrain(2, 2, TerrainType.Land);
    const firstMask = solidRowsToCollisionMask(DIAGONAL_ROWS);
    const replacementMask = solidRowsToCollisionMask(["0001", "0010", "0100", "1000"]);
    const baselineCollisionVersion = world.collisionVersion;
    const baselineTopologyVersion = world.supportedTopologyVersion;

    expect(world.setFineCollisionMask(2, 2, firstMask)).toBe(true);
    expect(world.fineCollisionCellCount).toBe(1);
    expect(world.getFineCollisionMask(2, 2)).toBe(firstMask);
    expect(world.collisionVersion).toBe(baselineCollisionVersion + 1);
    expect(world.supportedTopologyVersion).toBe(baselineTopologyVersion + 1);

    expect(world.setFineCollisionMask(2, 2, firstMask)).toBe(false);
    expect(world.fineCollisionCellCount).toBe(1);
    expect(world.collisionVersion).toBe(baselineCollisionVersion + 1);
    expect(world.supportedTopologyVersion).toBe(baselineTopologyVersion + 1);

    expect(world.setFineCollisionMask(2, 2, replacementMask)).toBe(true);
    expect(world.fineCollisionCellCount).toBe(1);
    expect(world.getFineCollisionMaskAtIndex(world.index(2, 2))).toBe(replacementMask);
    expect(world.collisionVersion).toBe(baselineCollisionVersion + 2);
    expect(world.supportedTopologyVersion).toBe(baselineTopologyVersion + 2);

    expect(world.setFineCollisionMask(1, 1, EMPTY_COLLISION_MASK)).toBe(true);
    expect(world.setFineCollisionMask(3, 1, FULL_COLLISION_MASK)).toBe(true);
    expect(world.getFineCollisionMask(1, 1)).toBe(EMPTY_COLLISION_MASK);
    expect(world.getFineCollisionMask(3, 1)).toBe(FULL_COLLISION_MASK);
    expect(world.fineCollisionCellCount).toBe(3);

    expect(world.clearFineCollisionMask(2, 2)).toBe(true);
    expect(world.clearFineCollisionMask(2, 2)).toBe(false);
    expect(world.fineCollisionCellCount).toBe(2);
    expect(world.getFineCollisionMask(2, 2)).toBeUndefined();
    expect(world.isMovementBlocked(2, 2)).toBe(true);
    expect(world.collisionVersion).toBe(baselineCollisionVersion + 5);
    expect(world.supportedTopologyVersion).toBe(baselineTopologyVersion + 5);
  });

  it("uses fine rows as a replacement for coarse collision in their exact world-space quadrant", () => {
    const world = openWorld(6, 5);
    world.setTerrain(2, 2, TerrainType.Land);
    world.setFineCollisionMask(2, 2, solidRowsToCollisionMask(DIAGONAL_ROWS));
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const cellLeft = 2 * config.navigation.tileSize;
    const cellTop = 2 * config.navigation.tileSize;
    const query = (subX: number, subY: number) => firstShipCollisionTime(
      world,
      cellLeft + subX * 8 + 4,
      cellTop + subY * 8 + 4,
      cellLeft + subX * 8 + 4,
      cellTop + subY * 8 + 4,
      config,
    );

    expect(query(0, 0)).toBe(0);
    expect(query(3, 0)).toBeUndefined();
    expect(query(0, 3)).toBeUndefined();
    expect(query(3, 3)).toBe(0);

    world.setFineCollisionMask(2, 2, EMPTY_COLLISION_MASK);
    expect(query(0, 0)).toBeUndefined();
    expect(query(3, 3)).toBeUndefined();

    world.clearFineCollisionMask(2, 2);
    expect(query(3, 0)).toBe(0);
    expect(query(0, 3)).toBe(0);

    world.setTerrain(2, 2, TerrainType.DeepOcean);
    world.setFineCollisionMask(2, 2, FULL_COLLISION_MASK);
    expect(query(0, 0)).toBe(0);
    expect(query(3, 3)).toBe(0);
  });

  it("prevents high-speed tunnelling through one 8 px solid and bounds work to the swept coarse area", () => {
    const config = makeConfig({
      movement: {
        shipCollisionHalfExtent: 1,
        shipSpeed: 7,
      },
    });
    const mask = solidRowsToCollisionMask(["0000", "0010", "0000", "0000"]);

    const runStats = (width: number): CollisionQueryStats => {
      const world = openWorld(width, 5);
      world.setFineCollisionMask(4, 2, mask);
      const stats = { broadPhaseCells: 0, narrowPhasePrimitives: 0 };
      const collision = firstShipCollisionTime(world, 48, 80, 272, 80, config, { stats });
      expect(collision).toBeCloseTo((143 - 48) / (272 - 48), 12);
      return stats;
    };

    expect(runStats(10)).toEqual({ broadPhaseCells: 8, narrowPhasePrimitives: 1 });
    expect(runStats(96)).toEqual({ broadPhaseCells: 8, narrowPhasePrimitives: 1 });

    const world = openWorld(10, 5);
    world.setFineCollisionMask(4, 2, mask);
    const ship = createShipStateAtGrid({ x: 1, y: 2 }, 5, 0, config);
    const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(true);
    expect(ship.worldX).toBeCloseTo(143 - config.movement.collisionEpsilon, 6);
    expect(ship.worldX).toBeLessThan(4 * config.navigation.tileSize + 2 * 8);
    expect(ship.speed).toBe(0);
  });

  it("maps lifted seam cells to opposite-edge coarse and fine collision geometry", () => {
    const config = makeConfig({
      movement: {
        collisionEpsilon: 0.25,
        shipCollisionHalfExtent: 1,
        shipSpeed: 2,
      },
    });

    const coarseWorld = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    coarseWorld.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    coarseWorld.setTerrain(0, 1, TerrainType.Land);
    const coarseShip = createShipStateAtGrid({ x: 3, y: 1 }, 5, 0, config);
    const coarse = new MovementSystem(coarseWorld, config).update(coarseShip, { turn: 0, throttle: 1 }, 1);

    expect(coarse.collided).toBe(true);
    expect(coarseShip.worldX).toBeCloseTo(127 - config.movement.collisionEpsilon, 10);
    expect(coarseShip.currentTileX).toBe(3);
    expect(coarse.enteredTiles).toEqual([]);

    const fineWorld = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    fineWorld.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    fineWorld.setFineCollisionMask(0, 1, collisionSubcellBit(2, 2));
    const fineShip = createShipStateAtGrid({ x: 3, y: 1 }, 5, 0, config);
    const collisionTiles: Array<number | undefined> = [];
    expect(firstShipCollisionTime(fineWorld, 112, 48, 176, 48, config, {
      onCollisionTile: (index) => collisionTiles.push(index),
    })).toBeCloseTo((143 - 112) / 64, 12);

    const fine = new MovementSystem(fineWorld, config).update(fineShip, { turn: 0, throttle: 1 }, 1);
    expect(collisionTiles).toEqual([fineWorld.index(0, 1)]);
    expect(fine.collided).toBe(true);
    expect(fine.worldImageOffset).toEqual({ x: 128, y: 0 });
    expect(fine.enteredTiles).toEqual([{ x: 0, y: 1 }]);
    expect(fineShip.worldX).toBeCloseTo(15 - config.movement.collisionEpsilon, 10);
    expect(fineShip.currentTileX).toBe(0);
    expect(fineShip.speed).toBe(0);
  });

  it("slides along a wrapped shoreline while keeping the canonical endpoint", () => {
    const config = makeConfig({
      movement: {
        collisionEpsilon: 0.001,
        shipCollisionHalfExtent: 1,
        shipSpeed: Math.SQRT2,
      },
    });
    const world = new WorldGrid(4, 4, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    world.setTerrain(0, 1, TerrainType.Land);
    const ship = createShipStateAtGrid({ x: 3, y: 0 }, 5, 45, config);

    const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(true);
    expect(result.worldImageOffset).toEqual({ x: 128, y: 0 });
    expect(result.enteredTiles).toEqual([{ x: 0, y: 0 }]);
    expect(ship.currentTileX).toBe(0);
    expect(ship.currentTileY).toBe(0);
    expect(ship.worldX).toBeCloseTo(16, 10);
    expect(ship.worldY).toBeLessThan(32 - config.movement.shipCollisionHalfExtent);
    expect(ship.speed).toBeGreaterThan(0);
  });

  it("keeps synthetic collision outside bounded asset worlds", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const bounded = new WorldGrid(4, 3, 4, BOUNDED_WORLD_TOPOLOGY);
    const wrapping = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    bounded.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    wrapping.fill(TerrainType.DeepOcean, KnowledgeState.Supported);

    expect(firstShipCollisionTime(bounded, 112, 48, 144, 48, config)).toBeCloseTo(15 / 32, 12);
    expect(firstShipCollisionTime(wrapping, 112, 48, 144, 48, config)).toBeUndefined();
  });
});
