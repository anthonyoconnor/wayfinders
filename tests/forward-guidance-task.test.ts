import { describe, expect, it } from "vitest";
import type { ShipState } from "../src/wayfinders/core/types";
import {
  ForwardRangeSystem,
  type ForwardRangeResult,
} from "../src/wayfinders/exploration/ForwardRangeSystem";
import type { ForwardGuidanceTask } from "../src/wayfinders/exploration/ForwardGuidance";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { makeConfig, makeShip } from "./helpers";

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function makeWorld(seed: number): WorldGrid {
  const random = deterministicRandom(seed);
  const world = new WorldGrid(11, 9, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  for (let index = 0; index < world.tileCount; index++) {
    const point = world.pointFromIndex(index);
    if (random() < 0.14) world.setTerrain(point.x, point.y, TerrainType.Land);
    const roll = random();
    const knowledge = roll < 0.2
      ? KnowledgeState.Supported
      : roll < 0.48
        ? KnowledgeState.Personal
        : KnowledgeState.Unknown;
    world.setKnowledge(
      point.x,
      point.y,
      knowledge,
      knowledge === KnowledgeState.Personal ? 1 : 0,
    );
    if (random() < 0.08) world.setVisibleNow(point.x, point.y, true);
  }
  for (const point of [{ x: 1, y: 1 }, { x: 7, y: 5 }]) {
    world.setTerrain(point.x, point.y, TerrainType.DeepOcean);
    world.setKnowledge(point.x, point.y, KnowledgeState.Personal, 1);
  }
  return world;
}

function shipAt(x: number, y: number, heading = 73): ShipState {
  const ship = makeShip(4, 0.35);
  ship.currentTileX = x;
  ship.currentTileY = y;
  ship.heading = heading;
  return ship;
}

function drainTask(task: ForwardGuidanceTask, sliceSize: number): ForwardRangeResult {
  for (let slice = 0; slice < 10_000; slice++) {
    const step = task.step({ maxWorkUnits: sliceSize });
    expect(step.workUnits).toBeLessThanOrEqual(sliceSize);
    if (step.status === "complete") return step.result;
    expect(step.status).toBe("pending");
  }
  throw new Error(`Guidance task did not complete with slice size ${sliceSize}`);
}

function expectEquivalent(actual: ForwardRangeResult, expected: ForwardRangeResult): void {
  expect([...actual.mask]).toEqual([...expected.mask]);
  expect([...actual.presentationMask]).toEqual([...expected.presentationMask]);
  expect([...actual.costs]).toEqual([...expected.costs]);
  expect(actual.candidateIndices).toEqual(expected.candidateIndices);
  expect(actual.presentationCandidateIndices).toEqual(expected.presentationCandidateIndices);
  expect(actual).toMatchObject({
    budget: expected.budget,
    reachableCount: expected.reachableCount,
    frontierCount: expected.frontierCount,
    presentationHeading: expected.presentationHeading,
    coneHalfAngleDegrees: expected.coneHalfAngleDegrees,
  });
}

describe("cooperative ForwardGuidance task", () => {
  it("is exactly equivalent at different slice boundaries across fixed worlds", () => {
    const config = makeConfig({
      movement: { shipCollisionHalfExtent: 1 },
      provisions: { supportedCost: 0, personalCost: 0.1, unknownCost: 0.2 },
    });
    const sliceSizes = [1, 7, 64, 257];

    for (let seed = 1; seed <= 64; seed++) {
      const world = makeWorld(seed);
      const system = new ForwardRangeSystem(world, config);
      const published = system.calculate(shipAt(1, 1, 0));
      const ship = shipAt(7, 5, seed * 29);
      const expected = new ForwardRangeSystem(world, config).calculate(ship);
      const actual = drainTask(
        system.beginTask(published, ship),
        sliceSizes[(seed - 1) % sliceSizes.length],
      );

      expectEquivalent(actual, expected);
      const logicalChanged = published.candidateIndices.some((index) => actual.mask[index] === 0)
        || actual.candidateIndices.some((index) => published.mask[index] === 0);
      expect(actual.logicalRevision, `seed ${seed}`).toBe(
        published.logicalRevision + (logicalChanged ? 1 : 0),
      );
    }
  });

  it("keeps the published arrays atomic and cancels obsolete partial work", () => {
    const world = makeWorld(41);
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const system = new ForwardRangeSystem(world, config);
    const published = system.calculate(shipAt(1, 1));
    const maskBefore = published.mask.slice();
    const costsBefore = published.costs.slice();
    const obsolete = system.beginTask(published, shipAt(7, 5));

    expect(obsolete.step({ maxWorkUnits: 5 }).status).toBe("pending");
    expect([...published.mask]).toEqual([...maskBefore]);
    expect([...published.costs]).toEqual([...costsBefore]);

    const newestShip = shipAt(5, 7, 210);
    world.setTerrain(5, 7, TerrainType.DeepOcean);
    const newest = system.beginTask(published, newestShip);
    expect(obsolete.step({ maxWorkUnits: 5 }).status).toBe("cancelled");
    const actual = drainTask(newest, 11);
    const expected = new ForwardRangeSystem(world, config).calculate(newestShip);
    expectEquivalent(actual, expected);
  });

  it("retains an exact deterministic fallback for arbitrary non-integer costs", () => {
    const world = makeWorld(99);
    const config = makeConfig({
      movement: { shipCollisionHalfExtent: 1 },
      provisions: { supportedCost: 0, personalCost: 0.1, unknownCost: Math.PI },
    });
    const system = new ForwardRangeSystem(world, config);
    const published = system.calculate(shipAt(1, 1));
    const ship = shipAt(7, 5);
    const expected = new ForwardRangeSystem(world, config).calculate(ship);
    const step = system.beginTask(published, ship).step({ maxWorkUnits: 1 });

    expect(step.status).toBe("complete");
    if (step.status === "complete") expectEquivalent(step.result, expected);
  });

  it("reuses two inactive result buffers across sustained request churn", () => {
    const world = makeWorld(123);
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const system = new ForwardRangeSystem(world, config);
    const ship = shipAt(7, 5);
    let published = system.calculate(shipAt(1, 1));

    for (let request = 0; request < 200; request++) {
      ship.heading = request * 17;
      const completed = drainTask(system.beginTask(published, ship), 257);
      system.releaseResult(published);
      published = completed;
    }

    expect(system.incrementalResourceStats()).toEqual({
      buffersAllocated: 2,
      pooledBuffers: 1,
      taskActive: false,
    });
  });
});
