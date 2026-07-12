import { describe, expect, it } from "vitest";
import { ForwardRangeSystem } from "../src/tidebound/exploration/ForwardRangeSystem.ts";
import { ReturnPathSystem, ReturnRiskLevel } from "../src/tidebound/exploration/ReturnPathSystem.ts";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData.ts";
import { WorldGrid } from "../src/tidebound/world/WorldGrid.ts";
import { makeConfig, makeShip } from "./helpers.ts";

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
});
});
