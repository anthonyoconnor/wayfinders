import { describe, expect, it } from "vitest";

import { GridGraph } from "../src/wayfinders/navigation/GridGraph.ts";
import { createShipStateAtGrid, MovementSystem } from "../src/wayfinders/navigation/MovementSystem.ts";
import { collisionSubcellBit } from "../src/wayfinders/world/CollisionMask.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { BOUNDED_WORLD_TOPOLOGY, WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology.ts";
import { makeConfig } from "./helpers.ts";

const DIRECTIONS = [
  { dx: -1, dy: 0, headingToCenter: 0, headingFromCenter: 180 },
  { dx: 1, dy: 0, headingToCenter: 180, headingFromCenter: 0 },
  { dx: 0, dy: -1, headingToCenter: 90, headingFromCenter: 270 },
  { dx: 0, dy: 1, headingToCenter: 270, headingFromCenter: 90 },
] as const;

describe("GR-2.4 navigation collision edges", () => {
  it("keeps every cardinal edge symmetric and equal to an actual center-to-center ship replay", () => {
    const config = makeConfig({
      movement: {
        shipCollisionHalfExtent: 1,
        shipSpeed: 1,
      },
    });
    const world = new WorldGrid(5, 5, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const graph = new GridGraph(world, config);
    const center = { x: 2, y: 2 };
    const centerIndex = world.index(center.x, center.y);

    const replay = (from: { x: number; y: number }, heading: number, destinationIndex: number): boolean => {
      const ship = createShipStateAtGrid(from, 5, heading, config);
      const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: 1 }, 1);
      return !result.collided && world.index(ship.currentTileX, ship.currentTileY) === destinationIndex;
    };

    for (let subY = 0; subY < 4; subY++) {
      for (let subX = 0; subX < 4; subX++) {
        world.setFineCollisionMask(center.x, center.y, collisionSubcellBit(subX, subY));

        for (const direction of DIRECTIONS) {
          const neighbor = { x: center.x + direction.dx, y: center.y + direction.dy };
          const neighborIndex = world.index(neighbor.x, neighbor.y);
          const forwardEdge = graph.canTraverseCardinalEdge(neighborIndex, centerIndex);
          const reverseEdge = graph.canTraverseCardinalEdge(centerIndex, neighborIndex);

          expect(reverseEdge).toBe(forwardEdge);
          expect(forwardEdge).toBe(replay(neighbor, direction.headingToCenter, centerIndex));
          expect(reverseEdge).toBe(replay(center, direction.headingFromCenter, neighborIndex));
        }
      }
    }
  });

  it("invalidates cached topology on a changed mask but not an idempotent replacement", () => {
    const config = makeConfig({
      movement: {
        shipCollisionHalfExtent: 1,
        shipSpeed: 1,
      },
    });
    const world = new WorldGrid(5, 3, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const graph = new GridGraph(world, config);
    const left = world.index(1, 1);
    const right = world.index(2, 1);
    const verticalBarrier = [0, 4, 8, 12].reduce((mask, bit) => mask | (1 << bit), 0);

    expect(graph.canTraverseCardinalEdge(left, right)).toBe(true);
    const collisionVersion = world.collisionVersion;
    const topologyVersion = world.supportedTopologyVersion;

    expect(world.setFineCollisionMask(2, 1, verticalBarrier)).toBe(true);
    expect(world.collisionVersion).toBe(collisionVersion + 1);
    expect(world.supportedTopologyVersion).toBe(topologyVersion + 1);
    expect(graph.canTraverseCardinalEdge(left, right)).toBe(false);

    expect(world.setFineCollisionMask(2, 1, verticalBarrier)).toBe(false);
    expect(world.collisionVersion).toBe(collisionVersion + 1);
    expect(world.supportedTopologyVersion).toBe(topologyVersion + 1);
    expect(graph.canTraverseCardinalEdge(left, right)).toBe(false);

    expect(world.clearFineCollisionMask(2, 1)).toBe(true);
    expect(graph.canTraverseCardinalEdge(left, right)).toBe(true);
  });

  it("retains legacy coarse navigation when a cell has no fine override", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const world = new WorldGrid(5, 3, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    world.setTerrain(2, 1, TerrainType.Land);
    const graph = new GridGraph(world, config);
    const left = world.index(1, 1);
    const blocked = world.index(2, 1);

    expect(world.getFineCollisionMask(2, 1)).toBeUndefined();
    expect(graph.isNavigationNodePassable(blocked)).toBe(false);
    expect(graph.canTraverseCardinalEdge(left, blocked)).toBe(false);

    world.setTerrain(2, 1, TerrainType.DeepOcean);
    expect(graph.isNavigationNodePassable(blocked)).toBe(true);
    expect(graph.canTraverseCardinalEdge(left, blocked)).toBe(true);
  });
});

describe("GP-6.2 periodic physical movement", () => {
  it.each([
    { name: "southeast", start: { x: 3, y: 2 }, heading: 45, tile: { x: 0, y: 0 }, offset: { x: 128, y: 96 } },
    { name: "southwest", start: { x: 0, y: 2 }, heading: 135, tile: { x: 3, y: 0 }, offset: { x: -128, y: 96 } },
    { name: "northwest", start: { x: 0, y: 0 }, heading: 225, tile: { x: 3, y: 2 }, offset: { x: -128, y: -96 } },
    { name: "northeast", start: { x: 3, y: 0 }, heading: 315, tile: { x: 0, y: 2 }, offset: { x: 128, y: -96 } },
  ])("crosses the $name corner without losing physical travel", ({ start, heading, tile, offset }) => {
    const config = makeConfig({
      movement: { shipCollisionHalfExtent: 1, shipSpeed: Math.SQRT2 },
    });
    const world = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const ship = createShipStateAtGrid(start, 5, heading, config);

    const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(false);
    expect(result.movedDistancePixels).toBeCloseTo(Math.SQRT2 * 32, 10);
    expect(result.liftedDisplacement.x).toBeCloseTo(Math.sign(offset.x) * 32, 10);
    expect(result.liftedDisplacement.y).toBeCloseTo(Math.sign(offset.y) * 32, 10);
    expect(result.worldImageOffset).toEqual(offset);
    expect(result.enteredTiles).toEqual([tile]);
    expect(ship.currentTileX).toBe(tile.x);
    expect(ship.currentTileY).toBe(tile.y);
    expect(ship.worldX).toBeCloseTo(tile.x * 32 + 16, 10);
    expect(ship.worldY).toBeCloseTo(tile.y * 32 + 16, 10);
    expect(ship.heading).toBe(heading);
    expect(ship.speed).toBeCloseTo(Math.SQRT2 * 32, 10);
  });

  it("preserves heading and signed reverse speed through a seam", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1, shipSpeed: 1 } });
    const world = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const ship = createShipStateAtGrid({ x: 0, y: 1 }, 5, 0, config);

    const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: -1 }, 1);

    expect(result.collided).toBe(false);
    expect(result.movedDistancePixels).toBe(32);
    expect(result.liftedDisplacement).toEqual({ x: -32, y: 0 });
    expect(result.worldImageOffset).toEqual({ x: -128, y: 0 });
    expect(result.enteredTiles).toEqual([{ x: 3, y: 1 }]);
    expect(ship.worldX).toBe(112);
    expect(ship.currentTileX).toBe(3);
    expect(ship.heading).toBe(0);
    expect(ship.speed).toBe(-32);
  });

  it("publishes every canonical tile entry in physical order across multiple wraps", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1, shipSpeed: 9 } });
    const world = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const ship = createShipStateAtGrid({ x: 3, y: 1 }, 5, 0, config);

    const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(false);
    expect(result.movedDistancePixels).toBe(288);
    expect(result.liftedDisplacement).toEqual({ x: 288, y: 0 });
    expect(result.worldImageOffset).toEqual({ x: 384, y: 0 });
    expect(result.enteredTiles).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(ship.worldX).toBe(16);
    expect(ship.worldY).toBe(48);
    expect(ship.currentTileX).toBe(0);
    expect(ship.currentTileY).toBe(1);
    expect(result.segments.reduce((total, segment) => total + segment.distancePixels, 0)).toBeCloseTo(288, 10);
    expect(result.segments.every((segment) => world.inBounds(segment.tileX, segment.tileY))).toBe(true);
    for (let index = 1; index < result.segments.length; index++) {
      expect(result.segments[index].fromWorldX).toBeCloseTo(result.segments[index - 1].toWorldX, 10);
      expect(result.segments[index].fromWorldY).toBeCloseTo(result.segments[index - 1].toWorldY, 10);
    }
    expect(result.segments.some((segment) => segment.fromWorldX >= world.topology.pixelWidth * 2)).toBe(true);
  });

  it("is fixed-step equivalent for canonical pose, distance, displacement, and tile-entry order", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1, shipSpeed: 9 } });
    const world = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const singleShip = createShipStateAtGrid({ x: 3, y: 1 }, 5, 0, config);
    const splitShip = createShipStateAtGrid({ x: 3, y: 1 }, 5, 0, config);
    const movement = new MovementSystem(world, config);

    const single = movement.update(singleShip, { turn: 0, throttle: 1 }, 1);
    const split = [1 / 3, 1 / 3, 1 / 3].map((delta) => (
      movement.update(splitShip, { turn: 0, throttle: 1 }, delta)
    ));

    expect(splitShip).toEqual(singleShip);
    expect(split.reduce((total, result) => total + result.movedDistancePixels, 0)).toBeCloseTo(single.movedDistancePixels, 10);
    expect(split.reduce((total, result) => total + result.liftedDisplacement.x, 0)).toBeCloseTo(single.liftedDisplacement.x, 10);
    expect(split.reduce((total, result) => total + result.liftedDisplacement.y, 0)).toBeCloseTo(single.liftedDisplacement.y, 10);
    expect(split.flatMap((result) => result.enteredTiles)).toEqual(single.enteredTiles);
  });
});
