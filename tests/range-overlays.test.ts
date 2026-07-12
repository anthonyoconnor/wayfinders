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
    expect(live.reachableCount).toBe(fresh.reachableCount);
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
});

describe("ReturnPathSystem", () => {
it("chooses a cheapest known route, excludes Unknown, and updates for shorter support", () => {
  const config = makeConfig({ provisions: { personalCost: 0.5 } });
  const world = new WorldGrid(7, 3, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 1, KnowledgeState.Supported);
  world.setKnowledge(6, 1, KnowledgeState.Supported);
  for (let x = 1; x <= 5; x++) world.setKnowledge(x, 1, KnowledgeState.Personal, 2);
  world.setMovementBlocked(4, 1, true);

  const system = new ReturnPathSystem(world, config);
  const ship = makeShip(4, 0);
  const first = system.calculate(ship);
  const origin = world.index(3, 1);
  expect(first.costs[origin]).toBe(1.5);
  expect(system.pathToSupported(first, { x: 3, y: 1 })).toEqual([
    { x: 3, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  expect(first.visited[world.index(3, 0)]).toBe(0);
  expect(first.risk[world.index(3, 0)]).toBe(ReturnRiskLevel.Hidden);

  world.setKnowledge(2, 1, KnowledgeState.Supported);
  const shorter = system.calculate(ship);
  expect(shorter.costs[origin]).toBe(0.5);
  expect(system.pathToSupported(shorter, { x: 3, y: 1 })).toEqual([
    { x: 3, y: 1 },
    { x: 2, y: 1 },
  ]);
});

it("classifies Personal cells with negative return margin as impossible", () => {
  const world = new WorldGrid(4, 1, 2);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setKnowledge(1, 0, KnowledgeState.Personal, 1);
  world.setKnowledge(2, 0, KnowledgeState.Personal, 1);
  const result = new ReturnPathSystem(world, makeConfig()).calculate(makeShip(0, 1));

  expect(result.budget).toBe(0);
  expect(result.costs[world.index(2, 0)]).toBe(1);
  expect(result.margins[world.index(2, 0)]).toBe(-1);
  expect(result.risk[world.index(2, 0)]).toBe(ReturnRiskLevel.Impossible);
  expect(result.risk[world.index(0, 0)]).toBe(ReturnRiskLevel.Hidden);
  expect(result.riskCounts).toEqual(countRisks(result.risk));
});

it("does not paint return-risk colours onto blocked Personal terrain", () => {
  const world = new WorldGrid(3, 1, 2);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setKnowledge(1, 0, KnowledgeState.Personal, 1);
  world.setTerrain(1, 0, TerrainType.Land);

  const result = new ReturnPathSystem(world, makeConfig()).calculate(makeShip(3, 0));
  expect(result.risk[world.index(1, 0)]).toBe(ReturnRiskLevel.Hidden);
});

it("reclassifies return risk immediately as a fractional bundle is spent", () => {
  const world = new WorldGrid(4, 1, 2);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setKnowledge(1, 0, KnowledgeState.Personal, 1);
  world.setKnowledge(2, 0, KnowledgeState.Personal, 1);
  const ship = makeShip(4, 0);
  const system = new ReturnPathSystem(world, makeConfig());
  const result = system.calculate(ship);
  const before = result.risk[world.index(2, 0)];

  ship.provisions = 1;
  ship.provisionAccumulator = 0.6;
  expect(system.updateBudget(result, ship)).toBe(true);
  expect(result.budget).toBeCloseTo(0.4);
  expect(result.risk[world.index(2, 0)]).toBe(ReturnRiskLevel.Impossible);
  expect(result.risk[world.index(2, 0)]).not.toBe(before);
  expect(result.riskCounts).toEqual(countRisks(result.risk));
});

it("matches fresh margins, classifications, and counts across budget changes", () => {
  const world = new WorldGrid(8, 1, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  for (let x = 1; x <= 6; x++) world.setKnowledge(x, 0, KnowledgeState.Personal, 1);
  world.setTerrain(6, 0, TerrainType.Land);
  const ship = makeShip(5, 0);
  const system = new ReturnPathSystem(world, makeConfig());
  const live = system.calculate(ship);
  const pointSpy = vi.spyOn(world, "pointFromIndex");
  const knowledgeSpy = vi.spyOn(world, "getKnowledge");
  const budgets = [
    { provisions: 3, accumulator: 0.75 },
    { provisions: 1, accumulator: 0.75 },
    { provisions: 4, accumulator: 0.5 },
    { provisions: 6, accumulator: 0 },
  ];

  for (const next of budgets) {
    const previousRisk = live.risk.slice();
    ship.provisions = next.provisions;
    ship.provisionAccumulator = next.accumulator;
    pointSpy.mockClear();
    knowledgeSpy.mockClear();
    const changed = system.updateBudget(live, ship);
    expect(pointSpy).not.toHaveBeenCalled();
    expect(knowledgeSpy).not.toHaveBeenCalled();

    const fresh = system.calculate(ship);
    expect(live.budget).toBe(fresh.budget);
    expect(live.margins).toEqual(fresh.margins);
    expect(live.risk).toEqual(fresh.risk);
    expect(live.riskCounts).toEqual(fresh.riskCounts);
    expect(live.riskCounts).toEqual(countRisks(live.risk));
    expect(changed).toBe(previousRisk.some((value, index) => value !== live.risk[index]));
  }
});

it("derives return starts and risk candidates from sparse knowledge indices", () => {
  const world = new WorldGrid(40, 40, 8);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setKnowledge(1, 0, KnowledgeState.Personal, 1);
  world.setKnowledge(2, 0, KnowledgeState.Personal, 1);
  world.setKnowledge(39, 39, KnowledgeState.Personal, 1);
  const pointSpy = vi.spyOn(world, "pointFromIndex");
  const tileScanSpy = vi.spyOn(world, "forEachTile");

  const result = new ReturnPathSystem(world, makeConfig()).calculate(makeShip(4, 0));

  expect(result.supportedBoundaryIndices).toEqual([world.index(0, 0)]);
  expect(result.personalIndices).toEqual([
    world.index(1, 0),
    world.index(2, 0),
    world.index(39, 39),
  ]);
  expect(result.risk[world.index(39, 39)]).toBe(ReturnRiskLevel.Impossible);
  expect(world.getPersonalKnowledgeIndices()).toEqual(new Set(result.personalIndices));
  expect(world.getSupportedKnowledgeIndices()).toEqual(new Set(result.supportedBoundaryIndices));
  expect(pointSpy).not.toHaveBeenCalled();
  expect(tileScanSpy).not.toHaveBeenCalled();
});
});
