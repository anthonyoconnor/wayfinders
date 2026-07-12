import { describe, expect, it } from "vitest";
import { ProvisionSystem, availableProvisionUnits } from "../src/tidebound/exploration/ProvisionSystem.ts";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData.ts";
import { WorldGrid } from "../src/tidebound/world/WorldGrid.ts";
import { makeConfig, makeSegment, makeShip } from "./helpers.ts";

function createWorld(state: KnowledgeState): WorldGrid {
  const world = new WorldGrid(4, 2, 2);
  world.fill(TerrainType.DeepOcean, state);
  return world;
}

describe("ProvisionSystem", () => {
it("keeps overlay reach equal to the remaining physical bundle capacity", () => {
  expect(availableProvisionUnits(makeShip(12, 0))).toBe(12);
  expect(availableProvisionUnits(makeShip(12, 0.25))).toBe(11.75);
  expect(availableProvisionUnits(makeShip(0, 0.5))).toBe(0);
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
  const config = makeConfig({ navigation: { tileSize: 32 } });
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
