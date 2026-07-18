import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import { ForwardRangeSystem } from "../src/wayfinders/exploration/ForwardRangeSystem.ts";
import { knowledgeTravelCost } from "../src/wayfinders/exploration/ProvisionSystem.ts";
import { dijkstra } from "../src/wayfinders/navigation/Dijkstra.ts";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { BOUNDED_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology.ts";
import { drainForwardGuidance, makeConfig, makeShip } from "./helpers.ts";

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
    const simulation = new GameSimulation();
    const [first, second] = passableDestinations(simulation, 2);

    expect(simulation.teleport(first)).toBe(true);
    const firstRequest = simulation.forwardGuidanceStatus.requestedId;
    expect(simulation.teleport(second)).toBe(true);
    expect(simulation.forwardGuidanceStatus).toMatchObject({
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

    expect(drainForwardGuidance(simulation)).toBeGreaterThan(1);
    expect(simulation.forwardGuidanceStatus).toMatchObject({
      pending: false,
      requestedId: simulation.forwardGuidanceStatus.appliedId,
    });
    expect(simulation.forwardRange.costs[sourceIndex]).toBe(0);
    expect(simulation.advanceForwardGuidance()).toBe(false);
  });

  it("invalidates visibility-only work and publishes the newest revision", () => {
    const simulation = new GameSimulation(undefined, undefined, {
      forwardGuidanceWorkUnitsPerSlice: 64,
      forwardGuidanceNow: () => 0,
    });
    const [destination] = passableDestinations(simulation, 1);
    expect(simulation.teleport(destination)).toBe(true);
    expect(simulation.advanceForwardGuidance()).toBe(false);
    const activeId = simulation.forwardGuidanceStatus.activeId;
    const requestedId = simulation.forwardGuidanceStatus.requestedId;
    const visibilityIndex = simulation.world.index(0, 0);
    simulation.world.setVisibleNowAtIndex(
      visibilityIndex,
      !simulation.world.isVisibleNowAtIndex(visibilityIndex),
    );

    expect(simulation.advanceForwardGuidance()).toBe(false);
    expect(simulation.forwardGuidanceStatus).toMatchObject({
      pending: true,
      requestedId: requestedId + 1,
      activeId: undefined,
      telemetry: {
        jobsStarted: 1,
        jobsCancelled: 1,
      },
    });
    expect(activeId).toBe(requestedId);
    drainForwardGuidance(simulation);
    expect(simulation.forwardGuidanceStatus.source.visibilityRevision).toBe(
      simulation.world.visibilityVersion,
    );
  });

  it("does not let steering starve a task and clips the result to the latest heading", () => {
    const simulation = new GameSimulation(undefined, undefined, {
      forwardGuidanceWorkUnitsPerSlice: 64,
      forwardGuidanceNow: () => 0,
    });
    const [destination] = passableDestinations(simulation, 1);
    expect(simulation.teleport(destination)).toBe(true);
    expect(simulation.advanceForwardGuidance()).toBe(false);
    const requestId = simulation.forwardGuidanceStatus.requestedId;

    simulation.update({ turn: 1, throttle: 0 }, 0.25);
    const latestHeading = simulation.ship.heading;
    expect(simulation.forwardGuidanceStatus.requestedId).toBe(requestId);
    drainForwardGuidance(simulation);

    expect(simulation.forwardRange.presentationHeading).toBe(latestHeading);
    expect(simulation.forwardGuidanceStatus.telemetry.jobsCancelled).toBe(0);
  });

  it("uses a monotonic world epoch across same-seed regeneration", () => {
    const simulation = new GameSimulation(undefined, undefined, {
      forwardGuidanceWorkUnitsPerSlice: 64,
      forwardGuidanceNow: () => 0,
    });
    const [destination] = passableDestinations(simulation, 1);
    expect(simulation.teleport(destination)).toBe(true);
    expect(simulation.advanceForwardGuidance()).toBe(false);
    const previousEpoch = simulation.forwardGuidanceStatus.source.worldEpoch;
    const seed = simulation.generated.seed;

    simulation.regenerate(seed);

    expect(simulation.forwardGuidanceStatus).toMatchObject({
      pending: false,
      requestedId: 0,
      appliedId: 0,
      telemetry: { jobsCancelled: 1 },
    });
    expect(simulation.forwardGuidanceStatus.source.worldEpoch).toBe(previousEpoch + 1);
  });

  it("refreshes cached travel-cost units after live tuning", () => {
    const config = makeConfig({
      provisions: { supportedCost: 0, personalCost: 0.5, unknownCost: 1 },
    });
    const simulation = new GameSimulation(config, undefined, {
      forwardGuidanceWorkUnitsPerSlice: 64,
      forwardGuidanceNow: () => 0,
    });
    const [destination] = passableDestinations(simulation, 1);
    expect(simulation.teleport(destination)).toBe(true);
    drainForwardGuidance(simulation);

    config.provisions.personalCost = 0.75;
    config.provisions.unknownCost = 1.25;
    simulation.refreshRiskOverlays();
    drainForwardGuidance(simulation);

    const expected = new ForwardRangeSystem(simulation.world, config).calculate(simulation.ship);
    expect(simulation.forwardRange.mask).toEqual(expected.mask);
    expect(simulation.forwardRange.costs).toEqual(expected.costs);
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
      const world = new WorldGrid(9, 7, 4, BOUNDED_WORLD_TOPOLOGY);
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
          graph.forEachKnownTraversableCardinalEdge(node, (neighbor) => {
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
