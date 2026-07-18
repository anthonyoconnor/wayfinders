import { describe, expect, it } from "vitest";
import { ProvisionSystem, availableProvisionUnits } from "../src/wayfinders/exploration/ProvisionSystem.ts";
import { createSurveyBudget } from "../src/wayfinders/exploration/SurveyContracts.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { BOUNDED_WORLD_TOPOLOGY, WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology.ts";
import { makeConfig, makeSegment, makeShip } from "./helpers.ts";

function createWorld(state: KnowledgeState): WorldGrid {
  const world = new WorldGrid(4, 2, 2, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, state);
  return world;
}

describe("ProvisionSystem", () => {
it("keeps overlay reach equal to the remaining physical bundle capacity", () => {
  expect(availableProvisionUnits(makeShip(12, 0))).toBe(12);
  expect(availableProvisionUnits(makeShip(12, 0.25))).toBe(11.75);
  expect(availableProvisionUnits(makeShip(0, 0.5))).toBe(0);
});

describe("survey provision budget", () => {
it("quotes the fixed cost against fractional availability and the known return route", () => {
  expect(createSurveyBudget(2, 11.625, 3.5)).toEqual({
    surveyCost: 2,
    availableProvisionUnits: 11.625,
    remainingProvisionUnits: 9.625,
    returnCost: 3.5,
    projectedReturnMargin: 6.125,
    canAfford: true,
  });
});

it("reports unaffordable and unknown-return projections without negative remaining supply", () => {
  expect(createSurveyBudget(2, 1, Number.POSITIVE_INFINITY)).toEqual({
    surveyCost: 2,
    availableProvisionUnits: 1,
    remainingProvisionUnits: 0,
    returnCost: null,
    projectedReturnMargin: null,
    canAfford: false,
  });
});

it("rejects invalid costs and availability", () => {
  expect(() => createSurveyBudget(0, 12, 0)).toThrow(/positive safe integer/);
  expect(() => createSurveyBudget(1.5, 12, 0)).toThrow(/positive safe integer/);
  expect(() => createSurveyBudget(2, Number.NaN, 0)).toThrow(/finite and non-negative/);
});
});

it("uses config-driven costs for Supported, Personal, and Unknown water", () => {
  const config = makeConfig({
    navigation: { tileSize: 32 },
    provisions: { supportedCost: 0, personalCost: 0.5, unknownCost: 1 },
  });
  const cases = [
    { state: KnowledgeState.Supported, expectedCost: 0, expectedBundles: 5, expectedAccumulator: 0 },
    { state: KnowledgeState.Personal, expectedCost: 0.5, expectedBundles: 5, expectedAccumulator: 0.5 },
    { state: KnowledgeState.Unknown, expectedCost: 1, expectedBundles: 4, expectedAccumulator: 0 },
  ];

  for (const current of cases) {
    const ship = makeShip();
    const result = new ProvisionSystem(createWorld(current.state), config).chargeMovement(ship, [makeSegment(0, 0, 32)]);
    expect(result.cost).toBe(current.expectedCost);
    expect(ship.provisions).toBe(current.expectedBundles);
    expect(ship.provisionAccumulator).toBe(current.expectedAccumulator);
  }
});

it("keeps visible Unknown water at Unknown travel cost", () => {
  const config = makeConfig({ navigation: { tileSize: 32 }, provisions: { unknownCost: 1 } });
  const world = createWorld(KnowledgeState.Unknown);
  world.setVisibleNow(0, 0, true);
  const ship = makeShip();

  const result = new ProvisionSystem(world, config).chargeMovement(ship, [makeSegment(0, 0, 32)]);

  expect(world.getKnowledge(0, 0)).toBe(KnowledgeState.Unknown);
  expect(result.cost).toBe(1);
  expect(ship.provisions).toBe(4);
});

it("charges a lifted seam segment against its canonical tile", () => {
  const config = makeConfig({ navigation: { tileSize: 32 }, provisions: { supportedCost: 0, unknownCost: 1 } });
  const world = new WorldGrid(4, 2, 2, WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  const ship = makeShip();

  const result = new ProvisionSystem(world, config).chargeMovement(ship, [{
    fromWorldX: 128,
    fromWorldY: 16,
    toWorldX: 144,
    toWorldY: 16,
    distancePixels: 16,
    tileX: 0,
    tileY: 0,
  }]);

  expect(result.cost).toBe(0);
  expect(ship.provisions).toBe(5);
});

it("keeps lifted seam charges partition-equivalent and fixed to pre-observation canonical knowledge", () => {
  const config = makeConfig({
    navigation: { tileSize: 32 },
    provisions: { supportedCost: 0.25, unknownCost: 1 },
  });
  const world = new WorldGrid(4, 2, 2, WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  const system = new ProvisionSystem(world, config);
  const whole = system.prepareMovement([
    { fromWorldX: 112, fromWorldY: 16, toWorldX: 128, toWorldY: 16, distancePixels: 16, tileX: 3, tileY: 0 },
    { fromWorldX: 128, fromWorldY: 16, toWorldX: 144, toWorldY: 16, distancePixels: 16, tileX: 0, tileY: 0 },
  ]);
  const split = system.prepareMovement([
    { fromWorldX: 112, fromWorldY: 16, toWorldX: 120, toWorldY: 16, distancePixels: 8, tileX: 3, tileY: 0 },
    { fromWorldX: 120, fromWorldY: 16, toWorldX: 128, toWorldY: 16, distancePixels: 8, tileX: 3, tileY: 0 },
    { fromWorldX: 128, fromWorldY: 16, toWorldX: 136, toWorldY: 16, distancePixels: 8, tileX: 0, tileY: 0 },
    { fromWorldX: 136, fromWorldY: 16, toWorldX: 144, toWorldY: 16, distancePixels: 8, tileX: 0, tileY: 0 },
  ]);

  world.setKnowledge(3, 0, KnowledgeState.Personal, 4);
  const wholeShip = makeShip();
  const splitShip = makeShip();
  const wholeResult = system.applyPreparedMovement(wholeShip, whole);
  const splitResult = system.applyPreparedMovement(splitShip, split);

  expect(whole.segmentKnowledge).toEqual(Uint8Array.of(KnowledgeState.Unknown, KnowledgeState.Supported));
  expect(splitResult.cost).toBeCloseTo(wholeResult.cost, 12);
  expect(splitShip.provisions).toBe(wholeShip.provisions);
  expect(splitShip.provisionAccumulator).toBeCloseTo(wholeShip.provisionAccumulator, 12);
});

it("makes partial movement accumulation frame-rate independent", () => {
  const config = makeConfig({ navigation: { tileSize: 32 } });
  const world = createWorld(KnowledgeState.Unknown);
  const system = new ProvisionSystem(world, config);
  const singleStepShip = makeShip();
  const splitStepShip = makeShip();

  system.chargeMovement(singleStepShip, [makeSegment(0, 0, 32)]);
  for (let index = 0; index < 10; index++) {
    system.chargeMovement(splitStepShip, [makeSegment(0, 0, 3.2)]);
  }

  expect(splitStepShip.provisions).toBe(singleStepShip.provisions);
  expect(Math.abs(splitStepShip.provisionAccumulator - singleStepShip.provisionAccumulator)).toBeLessThan(1e-9);
});

it("preserves pre-observation Unknown cost in a prepared charge", () => {
  const config = makeConfig({ navigation: { tileSize: 32 }, provisions: { unknownCost: 1 } });
  const world = createWorld(KnowledgeState.Unknown);
  const system = new ProvisionSystem(world, config);
  const ship = makeShip();
  const prepared = system.prepareMovement([makeSegment(0, 0, 32)]);

  world.setKnowledge(0, 0, KnowledgeState.Personal, 4);
  const result = system.applyPreparedMovement(ship, prepared);

  expect(prepared.segmentKnowledge[0]).toBe(KnowledgeState.Unknown);
  expect(result.cost).toBe(config.provisions.unknownCost);
  expect(ship.provisions).toBe(4);
  expect(ship.provisionAccumulator).toBe(0);
});

it("uses runtime cost changes for the next prepared movement", () => {
  const config = makeConfig({ navigation: { tileSize: 32 }, provisions: { unknownCost: 2 } });
  const ship = makeShip();
  const result = new ProvisionSystem(createWorld(KnowledgeState.Unknown), config).chargeMovement(
    ship,
    [makeSegment(0, 0, 32)],
  );
  expect(result.cost).toBe(2);
  expect(result.consumedBundles).toBe(2);
  expect(ship.provisions).toBe(3);
});
});
