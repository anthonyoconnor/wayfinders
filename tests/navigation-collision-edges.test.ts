import { describe, expect, it } from "vitest";

import { GridGraph } from "../src/wayfinders/navigation/GridGraph.ts";
import { createShipStateAtGrid, MovementSystem } from "../src/wayfinders/navigation/MovementSystem.ts";
import { collisionSubcellBit } from "../src/wayfinders/world/CollisionMask.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
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
    const world = new WorldGrid(5, 5, 5);
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
    const world = new WorldGrid(5, 3, 5);
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
    const world = new WorldGrid(5, 3, 5);
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
