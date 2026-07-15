import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import { ForwardRangeSystem } from "../src/wayfinders/exploration/ForwardRangeSystem.ts";
import { knowledgeTravelCost } from "../src/wayfinders/exploration/ProvisionSystem.ts";
import { dijkstra } from "../src/wayfinders/navigation/Dijkstra.ts";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { makeConfig, makeShip } from "./helpers.ts";

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function passableDestinations(simulation: GameSimulation, count: number) {
  const graph = new GridGraph(simulation.world, simulation.config);
  const destinations: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < simulation.world.tileCount && destinations.length < count; index++) {
    const point = simulation.world.pointFromIndex(index);
    if (
      point.x === simulation.ship.currentTileX
      && point.y === simulation.ship.currentTileY
    ) continue;
    if (graph.isNavigationNodePassable(index)) destinations.push(point);
  }
  if (destinations.length < count) throw new Error("Generated world has too few passable destinations");
  return destinations;
}

describe("ForwardGuidance boundary", () => {
  it("coalesces requests, rejects stale sources, and applies only the newest origin", () => {
    const simulation = new GameSimulation(undefined, undefined, {
      deferredForwardGuidance: true,
    });
    const [first, second] = passableDestinations(simulation, 2);

    expect(simulation.teleport(first)).toBe(true);
    const firstRequest = simulation.forwardGuidanceStatus.requestedId;
    expect(simulation.teleport(second)).toBe(true);
    expect(simulation.forwardGuidanceStatus).toMatchObject({
      deferred: true,
      pending: true,
      appliedId: 0,
      source: { originX: second.x, originY: second.y },
    });
    expect(simulation.forwardGuidanceStatus.requestedId).toBeGreaterThan(firstRequest);

    // A source revision changed outside the request boundary. The stale job is
    // discarded and replaced with a request carrying the current revision.
    const sourceIndex = simulation.world.index(second.x, second.y);
    const currentKnowledge = simulation.world.getKnowledgeAtIndex(sourceIndex);
    simulation.world.setKnowledgeAtIndex(
      sourceIndex,
      currentKnowledge === KnowledgeState.Personal
        ? KnowledgeState.Supported
        : KnowledgeState.Personal,
      currentKnowledge === KnowledgeState.Personal ? 0 : 1,
    );
    const staleRequest = simulation.forwardGuidanceStatus.requestedId;
    expect(simulation.advanceForwardGuidance()).toBe(false);
    expect(simulation.forwardGuidanceStatus.requestedId).toBe(staleRequest + 1);

    expect(simulation.advanceForwardGuidance()).toBe(true);
    expect(simulation.forwardGuidanceStatus).toMatchObject({
      pending: false,
      requestedId: simulation.forwardGuidanceStatus.appliedId,
    });
    expect(simulation.forwardRange.costs[sourceIndex]).toBe(0);
    expect(simulation.advanceForwardGuidance()).toBe(false);
  });

  it("keeps synchronous guidance as the compatibility default", () => {
    const simulation = new GameSimulation();
    const [destination] = passableDestinations(simulation, 1);

    expect(simulation.teleport(destination)).toBe(true);
    expect(simulation.forwardGuidanceStatus.pending).toBe(false);
    expect(simulation.forwardRange.costs[
      simulation.world.index(destination.x, destination.y)
    ]).toBe(0);
  });
});

describe("bucketed forward-guidance equivalence", () => {
  it("matches heap Dijkstra over randomized small worlds", () => {
    const config = makeConfig({
      movement: { shipCollisionHalfExtent: 1 },
      provisions: { supportedCost: 0, personalCost: 0.1, unknownCost: 0.2 },
    });

    for (let seed = 1; seed <= 24; seed++) {
      const random = deterministicRandom(seed);
      const world = new WorldGrid(9, 7, 4);
      world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          const terrain = random() < 0.18 ? TerrainType.Land : TerrainType.DeepOcean;
          world.setTerrain(x, y, terrain);
          const roll = random();
          const knowledge = roll < 0.2
            ? KnowledgeState.Supported
            : roll < 0.5
              ? KnowledgeState.Personal
              : KnowledgeState.Unknown;
          world.setKnowledge(
            x,
            y,
            knowledge,
            knowledge === KnowledgeState.Personal ? 1 : 0,
          );
        }
      }
      world.setTerrain(4, 3, TerrainType.DeepOcean);
      world.setKnowledge(4, 3, KnowledgeState.Personal, 1);

      const ship = makeShip(2, 0.7);
      ship.currentTileX = 4;
      ship.currentTileY = 3;
      const budget = ship.provisions - ship.provisionAccumulator;
      const graph = new GridGraph(world, config);
      const actual = new ForwardRangeSystem(world, config).calculate(ship);
      const expected = dijkstra({
        nodeCount: world.tileCount,
        starts: [world.index(4, 3)],
        maxCost: budget,
        forEachNeighbor: (node, visit) => {
          graph.forEachKnownTraversableCardinalNeighbor(node, (neighbor) => {
            visit(neighbor, knowledgeTravelCost(world.getKnowledgeAtIndex(neighbor), config));
          });
        },
      });

      for (let index = 0; index < world.tileCount; index++) {
        const expectedReachable = expected.visited[index] === 1
          && world.getKnowledgeAtIndex(index) === KnowledgeState.Unknown;
        expect(actual.mask[index], `seed ${seed}, tile ${index}`).toBe(expectedReachable ? 1 : 0);
        if (expected.visited[index]) {
          expect(actual.costs[index], `seed ${seed}, tile ${index}`).toBeCloseTo(
            expected.costs[index],
            10,
          );
        } else {
          expect(actual.costs[index], `seed ${seed}, tile ${index}`).toBe(Number.POSITIVE_INFINITY);
        }
      }
    }
  });
});
