import { describe, expect, it, vi } from "vitest";
import { ForwardRangeSystem } from "../src/tidebound/exploration/ForwardRangeSystem.ts";
import { ReturnPathSystem, ReturnRiskLevel } from "../src/tidebound/exploration/ReturnPathSystem.ts";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData.ts";
import { WorldGrid } from "../src/tidebound/world/WorldGrid.ts";
import { makeConfig, makeShip } from "./helpers.ts";

function countMask(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) count += value;
  return count;
}

function countRisks(risk: Uint8Array) {
  const counts = { comfortable: 0, warning: 0, critical: 0, impossible: 0 };
  for (const level of risk) {
    if (level === ReturnRiskLevel.Comfortable) counts.comfortable++;
    else if (level === ReturnRiskLevel.Warning) counts.warning++;
    else if (level === ReturnRiskLevel.Critical) counts.critical++;
    else if (level === ReturnRiskLevel.Impossible) counts.impossible++;
  }
  return counts;
}

function shipAt(x: number, y: number, provisions = 5, provisionAccumulator = 0) {
  const ship = makeShip(provisions, provisionAccumulator);
  ship.currentTileX = x;
  ship.currentTileY = y;
  return ship;
}

describe("ForwardRangeSystem", () => {
it("displays only reachable Unknown cells and shrinks after provision use", () => {
  const config = makeConfig({ provisions: { unknownCost: 1 } });
  const world = new WorldGrid(6, 1, 3);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setMovementBlocked(2, 0, true); // Hidden: it must not leak into the estimate.
  const ship = makeShip(2, 0);
  const system = new ForwardRangeSystem(world, config);

  const before = system.calculate(ship);
  expect(before.budget).toBe(2);
  expect(before.mask[world.index(0, 0)]).toBe(0);
  expect(before.mask[world.index(1, 0)]).toBe(1);
  expect(before.mask[world.index(2, 0)]).toBe(1);
  expect(before.mask[world.index(3, 0)]).toBe(0);

  ship.provisions = 1;
  const after = system.calculate(ship);
  expect(after.mask[world.index(2, 0)]).toBe(0);
  expect(after.mask[world.index(3, 0)]).toBe(0);

  ship.provisions = 2;
  const live = system.calculate(ship);
  ship.provisionAccumulator = 0.6;
  expect(system.updateBudget(live, ship)).toBe(true);
  expect(live.budget).toBe(1.4);
  expect(live.mask[world.index(2, 0)]).toBe(0);
  expect(live.reachableCount).toBe(countMask(live.mask));
});

it("matches fresh masks across incremental budget decreases and increases", () => {
  const config = makeConfig({ provisions: { personalCost: 0.5, unknownCost: 1 } });
  const world = new WorldGrid(10, 1, 5);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setKnowledge(1, 0, KnowledgeState.Personal, 1);
  const ship = makeShip(4, 0);
  const system = new ForwardRangeSystem(world, config);
  const live = system.calculate(ship);
  const pointSpy = vi.spyOn(world, "pointFromIndex");
  const knowledgeSpy = vi.spyOn(world, "getKnowledge");
  const budgets = [
    { provisions: 3, accumulator: 0.25 },
    { provisions: 1, accumulator: 0.75 },
    { provisions: 2, accumulator: 0.25 },
    { provisions: 4, accumulator: 0.5 },
    // Increasing beyond the original horizon performs one fresh search.
    { provisions: 6, accumulator: 0 },
  ];

  for (const [step, next] of budgets.entries()) {
    const previousMask = live.mask.slice();
    ship.provisions = next.provisions;
    ship.provisionAccumulator = next.accumulator;
    pointSpy.mockClear();
    knowledgeSpy.mockClear();
    const changed = system.updateBudget(live, ship);
    if (step < budgets.length - 1) {
      expect(pointSpy).not.toHaveBeenCalled();
      expect(knowledgeSpy).not.toHaveBeenCalled();
    }

    const fresh = system.calculate(ship);
    expect(live.budget).toBe(fresh.budget);
    expect(live.mask).toEqual(fresh.mask);
    expect(live.presentationMask).toEqual(fresh.presentationMask);
    expect(live.reachableCount).toBe(fresh.reachableCount);
    expect(live.focusCount).toBe(fresh.focusCount);
    expect(live.reachableCount).toBe(countMask(live.mask));
    expect(changed).toBe(previousMask.some((value, index) => value !== live.mask[index]));
  }
});

it("stops at known blockers without leaking hidden terrain into Unknown cost", () => {
  const config = makeConfig({ provisions: { personalCost: 0.5, unknownCost: 1 } });
  const world = new WorldGrid(5, 1, 3);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setMovementBlocked(2, 0, true);
  const ship = makeShip(3, 0);
  const system = new ForwardRangeSystem(world, config);

  expect(system.calculate(ship).costs[world.index(2, 0)]).toBe(2);
  world.setVisibleNow(2, 0, true);
  const visiblyBlocked = system.calculate(ship);
  expect(visiblyBlocked.costs[world.index(3, 0)]).toBe(Number.POSITIVE_INFINITY);
  world.clearVisibility();
  world.setKnowledge(2, 0, KnowledgeState.Personal, 1);
  const known = system.calculate(ship);
  expect(known.mask[world.index(3, 0)]).toBe(0);
  expect(known.costs[world.index(3, 0)]).toBe(Number.POSITIVE_INFINITY);
});

it("post-processes only settled forward candidates instead of scanning the world", () => {
  const world = new WorldGrid(40, 40, 8);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const system = new ForwardRangeSystem(world, makeConfig({ provisions: { unknownCost: 1 } }));
  const ship = makeShip(2, 0);
  ship.currentTileX = 20;
  ship.currentTileY = 20;
  const pointSpy = vi.spyOn(world, "pointFromIndex");
  const tileScanSpy = vi.spyOn(world, "forEachTile");

  const result = system.calculate(ship);

  expect(result.candidateIndices).toHaveLength(13);
  expect(result.candidateIndices.every((index) => result.mask[index] === 1)).toBe(true);
  expect(result.reachableCount).toBe(result.candidateIndices.length);
  expect(pointSpy).not.toHaveBeenCalled();
  expect(tileScanSpy).not.toHaveBeenCalled();
});

it("presents forward reach only inside a ship-local sight-plus-padding focus", () => {
  const config = makeConfig({
    navigation: { sightRadius: 2 },
    overlays: { forwardFocusPadding: 2 },
    provisions: { unknownCost: 1 },
  });
  const world = new WorldGrid(40, 40, 8);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const ship = shipAt(20, 20, 20);
  const result = new ForwardRangeSystem(world, config).calculate(ship);

  expect(result.focusRadius).toBe(4);
  expect(result.mask[world.index(30, 20)]).toBe(1);
  expect(result.presentationMask[world.index(30, 20)]).toBe(0);
  expect(result.presentationMask[world.index(24, 20)]).toBe(1);
  expect(result.presentationMask[world.index(25, 20)]).toBe(0);
  expect(result.presentationCandidateIndices.every((index) => {
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    return (x - 20) ** 2 + (y - 20) ** 2 <= 16;
  })).toBe(true);
  expect(result.presentationCandidateIndices.length).toBeLessThan(result.candidateIndices.length);
  expect(result.focusCount).toBe(result.presentationCandidateIndices.length);
});
});

describe("ReturnPathSystem", () => {
it("chooses one cheapest known route and leaves other Personal branches uncoloured", () => {
  const config = makeConfig({ provisions: { personalCost: 0.5 } });
  const world = new WorldGrid(7, 3, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 1, KnowledgeState.Supported);
  world.setKnowledge(6, 1, KnowledgeState.Supported);
  for (let x = 1; x <= 5; x++) world.setKnowledge(x, 1, KnowledgeState.Personal, 2);
  world.setMovementBlocked(4, 1, true);
  const system = new ReturnPathSystem(world, config);

  const first = system.calculate(shipAt(3, 1, 4));
  expect(first.returnCost).toBe(1.5);
  expect(system.pathToSupported(first, { x: 3, y: 1 })).toEqual([
    { x: 3, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  expect(system.pathToSupported(first, { x: 2, y: 1 })).toEqual([]);
  expect(first.corridorIndices).toEqual([
    world.index(1, 1),
    world.index(2, 1),
    world.index(3, 1),
  ]);
  expect(first.risk[world.index(5, 1)]).toBe(ReturnRiskLevel.Hidden);

  world.setKnowledge(2, 1, KnowledgeState.Supported);
  const shorter = system.calculate(shipAt(3, 1, 4));
  expect(shorter.returnCost).toBe(0.5);
  expect(shorter.pathIndices).toEqual([world.index(3, 1), world.index(2, 1)]);
});

it("connects the ship through currently visible Unknown without opening unseen shortcuts", () => {
  const world = new WorldGrid(8, 5, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 2, KnowledgeState.Supported);
  for (let x = 1; x <= 3; x++) world.setKnowledge(x, 2, KnowledgeState.Personal, 1);
  world.setKnowledge(2, 1, KnowledgeState.Personal, 1);
  world.setVisibleNow(4, 2, true);
  world.setVisibleNow(5, 2, true);
  const system = new ReturnPathSystem(world, makeConfig());
  const result = system.calculate(shipAt(5, 2, 8));

  expect(result.pathIndices).toEqual([5, 4, 3, 2, 1, 0].map((x) => world.index(x, 2)));
  expect(result.returnCost).toBe(3.5);
  expect(result.corridorIndices).toContain(world.index(5, 2));
  expect(result.corridorIndices).toContain(world.index(2, 1));
  expect(result.risk[world.index(5, 2)]).toBe(result.riskLevel);
  expect(result.visited[world.index(4, 1)]).toBe(0);
  expect(result.risk[world.index(6, 2)]).toBe(ReturnRiskLevel.Hidden);
});

it("pads only through adjacent passable Personal water and supports a zero-width route", () => {
  const world = new WorldGrid(7, 5, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 2, KnowledgeState.Supported);
  for (let x = 1; x <= 5; x++) world.setKnowledge(x, 2, KnowledgeState.Personal, 1);
  world.setKnowledge(2, 1, KnowledgeState.Personal, 1);
  world.setKnowledge(2, 0, KnowledgeState.Personal, 1);
  world.setKnowledge(3, 0, KnowledgeState.Personal, 1);
  world.setKnowledge(3, 1, KnowledgeState.Personal, 1);
  world.setTerrain(3, 1, TerrainType.Land);

  const padded = new ReturnPathSystem(
    world,
    makeConfig({ overlays: { returnPathPadding: 2 } }),
  ).calculate(shipAt(5, 2, 8));
  expect(padded.corridorIndices).toContain(world.index(2, 1));
  expect(padded.corridorIndices).toContain(world.index(2, 0));
  expect(padded.corridorIndices).not.toContain(world.index(3, 1));
  expect(padded.corridorIndices).not.toContain(world.index(3, 0));
  expect(padded.risk[world.index(3, 1)]).toBe(ReturnRiskLevel.Hidden);

  const centreline = new ReturnPathSystem(
    world,
    makeConfig({ overlays: { returnPathPadding: 0 } }),
  ).calculate(shipAt(5, 2, 8));
  expect(centreline.corridorIndices).toEqual([1, 2, 3, 4, 5].map((x) => world.index(x, 2)));
});

it("reclassifies every corridor tile together as provisions cross risk thresholds", () => {
  const world = new WorldGrid(8, 1, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  for (let x = 1; x <= 6; x++) world.setKnowledge(x, 0, KnowledgeState.Personal, 1);
  const ship = shipAt(6, 0, 7);
  const system = new ReturnPathSystem(world, makeConfig());
  const result = system.calculate(ship);
  const corridor = [...result.corridorIndices];
  const pointSpy = vi.spyOn(world, "pointFromIndex");
  const knowledgeSpy = vi.spyOn(world, "getKnowledge");
  const states = [
    { provisions: 4, level: ReturnRiskLevel.Warning },
    { provisions: 3, level: ReturnRiskLevel.Critical },
    { provisions: 2, level: ReturnRiskLevel.Impossible },
    { provisions: 7, level: ReturnRiskLevel.Comfortable },
  ];

  expect(result.returnCost).toBe(3);
  expect(result.riskLevel).toBe(ReturnRiskLevel.Comfortable);
  for (const state of states) {
    ship.provisions = state.provisions;
    pointSpy.mockClear();
    knowledgeSpy.mockClear();
    expect(system.updateBudget(result, ship)).toBe(true);
    expect(result.riskLevel).toBe(state.level);
    expect(result.corridorIndices).toEqual(corridor);
    expect(corridor.every((index) => result.risk[index] === state.level)).toBe(true);
    expect(result.riskCounts).toEqual(countRisks(result.risk));
    expect(pointSpy).not.toHaveBeenCalled();
    expect(knowledgeSpy).not.toHaveBeenCalled();
  }
});

it("returns no coloured corridor when already safe or when no known route exists", () => {
  const world = new WorldGrid(5, 1, 3);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setKnowledge(3, 0, KnowledgeState.Personal, 1);
  const system = new ReturnPathSystem(world, makeConfig());

  const safe = system.calculate(shipAt(0, 0));
  expect(safe.pathIndices).toEqual([world.index(0, 0)]);
  expect(safe.returnCost).toBe(0);
  expect(safe.riskLevel).toBe(ReturnRiskLevel.Hidden);
  expect(safe.corridorIndices).toEqual([]);

  const disconnected = system.calculate(shipAt(3, 0));
  expect(disconnected.pathIndices).toEqual([]);
  expect(disconnected.returnCost).toBe(Number.POSITIVE_INFINITY);
  expect(disconnected.returnMargin).toBe(Number.NEGATIVE_INFINITY);
  expect(disconnected.riskLevel).toBe(ReturnRiskLevel.Impossible);
  expect(disconnected.corridorIndices).toEqual([]);
  expect(countRisks(disconnected.risk)).toEqual({ comfortable: 0, warning: 0, critical: 0, impossible: 0 });
});

it("uses sparse knowledge candidates and stops once the ship's shortest path is settled", () => {
  const world = new WorldGrid(40, 40, 8);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  for (let x = 1; x <= 10; x++) world.setKnowledge(x, 0, KnowledgeState.Personal, 1);
  world.setKnowledge(39, 39, KnowledgeState.Personal, 1);
  const pointSpy = vi.spyOn(world, "pointFromIndex");
  const tileScanSpy = vi.spyOn(world, "forEachTile");

  const result = new ReturnPathSystem(world, makeConfig()).calculate(shipAt(2, 0, 4));

  expect(result.supportedBoundaryIndices).toEqual([world.index(0, 0)]);
  expect(result.pathIndices).toEqual([world.index(2, 0), world.index(1, 0), world.index(0, 0)]);
  expect(result.corridorIndices).toEqual([
    world.index(1, 0),
    world.index(2, 0),
    world.index(3, 0),
  ]);
  expect(result.risk[world.index(39, 39)]).toBe(ReturnRiskLevel.Hidden);
  expect(result.visited[world.index(3, 0)]).toBe(0);
  expect(pointSpy).not.toHaveBeenCalled();
  expect(tileScanSpy).not.toHaveBeenCalled();
});
});
