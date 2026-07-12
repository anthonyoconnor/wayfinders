import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { patchPrototypeConfig, resetPrototypeConfig } from "../src/tidebound/config/prototypeConfig";
import { GameSimulation } from "../src/tidebound/core/GameSimulation";
import type { GridPoint } from "../src/tidebound/core/types";
import { KnowledgeSystem } from "../src/tidebound/exploration/KnowledgeSystem";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData";
import { WorldGrid } from "../src/tidebound/world/WorldGrid";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

function findUnknownWater(simulation: GameSimulation, farFrom: readonly GridPoint[] = []): GridPoint {
  let result: GridPoint | undefined;
  simulation.world.forEachTile((x, y) => {
    if (result || simulation.world.isMovementBlocked(x, y)) return;
    if (simulation.world.getKnowledge(x, y) !== KnowledgeState.Unknown) return;
    if (farFrom.some((point) => Math.hypot(x - point.x, y - point.y) < 16)) return;
    result = { x, y };
  });
  if (!result) throw new Error("Expected a navigable Unknown tile");
  return result;
}

function findRemoteSupportedWater(simulation: GameSimulation): GridPoint {
  const dock = simulation.generated.landmarks.homeReturnTile;
  let result: GridPoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  simulation.world.forEachTile((x, y) => {
    if (simulation.world.isMovementBlocked(x, y)) return;
    if (simulation.world.getKnowledge(x, y) !== KnowledgeState.Supported) return;
    if (x === dock.x && y === dock.y) return;
    const distance = (x - dock.x) ** 2 + (y - dock.y) ** 2;
    if (distance >= bestDistance) return;
    bestDistance = distance;
    result = { x, y };
  });
  if (!result) throw new Error("Expected a non-dock Supported tile");
  return result;
}

function completeWreckPresentation(simulation: GameSimulation): void {
  simulation.update(
    { turn: 0, throttle: 0 },
    simulation.config.simulation.wreckPresentationSeconds,
  );
}

describe("KnowledgeSystem expedition resolution", () => {
  it("commits or reverts only Personal tiles stamped by the resolved expedition", () => {
    const world = new WorldGrid(5, 1, 5);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setKnowledge(0, 0, KnowledgeState.Supported, 0);
    world.setKnowledge(1, 0, KnowledgeState.Personal, 7);
    world.setKnowledge(2, 0, KnowledgeState.Personal, 8);
    const knowledge = new KnowledgeSystem(world);

    expect(knowledge.commitExpedition(7).changedCount).toBe(1);
    expect(world.getKnowledge(1, 0)).toBe(KnowledgeState.Supported);
    expect(world.getExpeditionStamp(1, 0)).toBe(0);
    expect(world.getKnowledge(2, 0)).toBe(KnowledgeState.Personal);
    expect(world.getExpeditionStamp(2, 0)).toBe(8);

    expect(knowledge.revertExpedition(8).changedCount).toBe(1);
    expect(world.getKnowledge(2, 0)).toBe(KnowledgeState.Unknown);
    expect(world.getExpeditionStamp(2, 0)).toBe(0);
    expect(world.getKnowledge(0, 0)).toBe(KnowledgeState.Supported);
  });
});

describe("GameSimulation expedition lifecycle", () => {
  it("replenishes fractional and whole supplies only at the designated dock", () => {
    const simulation = new GameSimulation();
    const remoteSupported = findRemoteSupportedWater(simulation);
    expect(simulation.teleport(remoteSupported)).toBe(true);
    simulation.setProvisions(4);
    simulation.ship.provisionAccumulator = 0.6;

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);

    expect(simulation.atDock).toBe(true);
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);
    expect(simulation.ship.provisionAccumulator).toBe(0);
    expect(simulation.successfulReturns).toBe(0);
    expect(simulation.generation).toBe(1);
  });

  it("does not resolve or replenish an active expedition at remote Supported water", () => {
    const simulation = new GameSimulation();
    const target = findUnknownWater(simulation);
    const remoteSupported = findRemoteSupportedWater(simulation);
    expect(simulation.teleport(target)).toBe(true);
    simulation.setProvisions(3);

    expect(simulation.teleport(remoteSupported)).toBe(true);

    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.successfulReturns).toBe(0);
    expect(simulation.ship.provisions).toBe(3);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.successfulReturns).toBe(1);
  });

  it("converts the current Personal route to Supported and resupplies on safe dock return", () => {
    const simulation = new GameSimulation();
    const startingSupported = simulation.snapshot().knowledge.supported;
    const target = findUnknownWater(simulation);
    const voyageShip = simulation.ship;
    expect(simulation.teleport(target)).toBe(true);
    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.world.getKnowledge(target.x, target.y)).toBe(KnowledgeState.Personal);
    simulation.setProvisions(3);
    simulation.ship.provisionAccumulator = 0.25;

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);

    expect(simulation.ship).toBe(voyageShip);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.currentExpeditionId).toBe(2);
    expect(simulation.successfulReturns).toBe(1);
    expect(simulation.generation).toBe(1);
    expect(simulation.wrecks).toHaveLength(0);
    expect(simulation.world.getKnowledge(target.x, target.y)).toBe(KnowledgeState.Supported);
    expect(simulation.world.getExpeditionStamp(target.x, target.y)).toBe(0);
    expect(simulation.snapshot().knowledge.supported).toBeGreaterThan(startingSupported);
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);
    expect(simulation.ship.provisionAccumulator).toBe(0);
  });

  it("keeps earlier Supported routes while a failed expedition becomes Unknown and leaves a wreck", () => {
    const simulation = new GameSimulation();
    const firstTarget = findUnknownWater(simulation);
    expect(simulation.teleport(firstTarget)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.world.getKnowledge(firstTarget.x, firstTarget.y)).toBe(KnowledgeState.Supported);

    const secondTarget = findUnknownWater(simulation, [firstTarget]);
    expect(simulation.teleport(secondTarget)).toBe(true);
    const world = simulation.world;
    const lostShip = simulation.ship;
    const lostWorldPosition = { x: lostShip.worldX, y: lostShip.worldY };
    simulation.setProvisions(0);
    expect(simulation.stranded).toBe(true);
    expect(simulation.forceWreck()).toBe(true);

    expect(simulation.world).toBe(world);
    expect(simulation.ship).toBe(lostShip);
    expect(simulation.wreckPresentationActive).toBe(true);
    expect(simulation.atDock).toBe(false);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.generation).toBe(1);
    expect(simulation.failedExpeditions).toBe(1);
    expect(simulation.currentExpeditionId).toBe(2);
    expect(simulation.ship.provisions).toBe(0);
    expect(simulation.ship.provisionAccumulator).toBe(0);
    expect(simulation.world.getKnowledge(firstTarget.x, firstTarget.y)).toBe(KnowledgeState.Supported);
    expect(simulation.world.getKnowledge(secondTarget.x, secondTarget.y)).toBe(KnowledgeState.Unknown);
    expect(simulation.world.getExpeditionStamp(secondTarget.x, secondTarget.y)).toBe(0);
    expect(simulation.wrecks).toHaveLength(1);
    expect(simulation.wrecks[0]).toMatchObject({
      generation: 1,
      expeditionId: 2,
      worldX: lostWorldPosition.x,
      worldY: lostWorldPosition.y,
      tileX: secondTarget.x,
      tileY: secondTarget.y,
      discovered: false,
    });

    completeWreckPresentation(simulation);

    expect(simulation.ship).not.toBe(lostShip);
    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.atDock).toBe(true);
    expect(simulation.generation).toBe(2);
    expect(simulation.currentExpeditionId).toBe(3);
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);

    expect(simulation.teleport(secondTarget)).toBe(true);
    expect(simulation.wrecks[0].discovered).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.wrecks).toHaveLength(2);
    expect(simulation.wrecks[0].discovered).toBe(true);
    expect(simulation.world.getKnowledge(firstTarget.x, firstTarget.y)).toBe(KnowledgeState.Supported);
  });

  it("allows an empty ship to reach the dock through zero-cost Supported water", () => {
    const simulation = new GameSimulation();
    const remoteSupported = findRemoteSupportedWater(simulation);
    expect(simulation.teleport(remoteSupported)).toBe(true);

    simulation.setProvisions(0);

    expect(simulation.generation).toBe(1);
    expect(simulation.failedExpeditions).toBe(0);
    expect(simulation.wrecks).toHaveLength(0);
    expect(simulation.ship.provisions).toBe(0);
  });

  it("completes a natural out-and-back voyage only when the ship reaches the dock", () => {
    const simulation = new GameSimulation();
    const startingSupported = simulation.snapshot().knowledge.supported;

    for (let step = 0; step < 700 && simulation.ship.currentTileX < 68; step++) {
      simulation.update({ turn: 0, throttle: 1 }, 1 / 30);
    }
    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.snapshot().knowledge.personal).toBeGreaterThan(0);

    simulation.ship.heading = 180;
    for (let step = 0; step < 900 && simulation.expeditionActive; step++) {
      simulation.update({ turn: 0, throttle: 1 }, 1 / 30);
    }

    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.atDock).toBe(true);
    expect(simulation.successfulReturns).toBe(1);
    expect(simulation.snapshot().knowledge.supported).toBeGreaterThan(startingSupported);
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);
  });

  it("resolves natural final-bundle consumption as one ordered wreck transition", () => {
    patchPrototypeConfig({ provisions: { startingBundles: 1 } });
    const simulation = new GameSimulation();
    const eventOrder: string[] = [];
    simulation.events.on("shipWrecked", () => eventOrder.push("wreck"));
    simulation.events.on("generationAdvanced", () => eventOrder.push("generation"));
    simulation.events.on("shipReplenished", ({ reason }) => {
      if (reason === "respawn") eventOrder.push("replenished");
    });
    simulation.events.on("expeditionFailed", () => eventOrder.push("failed"));

    for (let step = 0; step < 700 && !simulation.wreckPresentationActive; step++) {
      simulation.update({ turn: 0, throttle: 1 }, 1 / 30);
    }

    expect(simulation.wreckPresentationActive).toBe(true);
    expect(simulation.generation).toBe(1);
    expect(simulation.failedExpeditions).toBe(1);
    expect(simulation.wrecks).toHaveLength(1);
    expect(simulation.atDock).toBe(false);
    expect(simulation.ship.provisions).toBe(0);
    expect(eventOrder).toEqual(["wreck"]);

    simulation.update({ turn: 0, throttle: 1 }, 3.999);
    expect(simulation.wreckPresentationActive).toBe(true);
    expect(simulation.generation).toBe(1);
    expect(eventOrder).toEqual(["wreck"]);

    simulation.update({ turn: 0, throttle: 1 }, 0.001);

    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.generation).toBe(2);
    expect(simulation.atDock).toBe(true);
    expect(simulation.ship.provisions).toBe(1);
    expect(eventOrder).toEqual(["wreck", "generation", "replenished", "failed"]);
  });

  it("gives exact-dock success precedence when the final bundle is consumed on that step", () => {
    const simulation = new GameSimulation();
    const dock = simulation.generated.landmarks.homeReturnTile;
    const departure = { x: 68, y: dock.y };
    expect(simulation.teleport(departure)).toBe(true);
    simulation.setProvisions(1);
    simulation.ship.provisionAccumulator = 0.9;
    simulation.ship.heading = 180;
    const wreckEvents: number[] = [];
    simulation.events.on("shipWrecked", ({ wreckId }) => wreckEvents.push(wreckId));

    simulation.update({ turn: 0, throttle: 1 }, (departure.x - dock.x) / simulation.config.movement.shipSpeed);

    expect(simulation.atDock).toBe(true);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.successfulReturns).toBe(1);
    expect(simulation.failedExpeditions).toBe(0);
    expect(simulation.wrecks).toHaveLength(0);
    expect(simulation.wreckPresentationActive).toBe(false);
    expect(wreckEvents).toHaveLength(0);
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);
    expect(simulation.ship.provisionAccumulator).toBe(0);
  });

  it("discards wreck-timer overshoot without moving the newly respawned ship", () => {
    const simulation = new GameSimulation();
    expect(simulation.teleport(findUnknownWater(simulation))).toBe(true);
    expect(simulation.forceWreck()).toBe(true);

    simulation.update(
      { turn: 1, throttle: 1 },
      simulation.config.simulation.wreckPresentationSeconds + 1,
    );

    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.generation).toBe(2);
    expect(simulation.atDock).toBe(true);
    expect(simulation.ship.heading).toBe(0);
    expect(simulation.ship.speed).toBe(0);
    expect(simulation.lastMovement.movedDistancePixels).toBe(0);
  });

  it("treats regeneration as an explicit reset of routes, wrecks, and generation history", () => {
    const simulation = new GameSimulation();
    const canceledCompletionEvents: string[] = [];
    simulation.events.on("generationAdvanced", () => canceledCompletionEvents.push("generation"));
    simulation.events.on("shipReplenished", ({ reason }) => {
      if (reason === "respawn") canceledCompletionEvents.push("replenished");
    });
    simulation.events.on("expeditionFailed", () => canceledCompletionEvents.push("failed"));
    expect(simulation.teleport(findUnknownWater(simulation))).toBe(true);
    simulation.setProvisions(0);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.wreckPresentationActive).toBe(true);
    expect(simulation.generation).toBe(1);
    expect(simulation.wrecks).toHaveLength(1);

    simulation.regenerate(simulation.generated.seed);

    expect(simulation.generation).toBe(1);
    expect(simulation.currentExpeditionId).toBe(1);
    expect(simulation.successfulReturns).toBe(0);
    expect(simulation.failedExpeditions).toBe(0);
    expect(simulation.wrecks).toHaveLength(0);
    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.atDock).toBe(true);

    simulation.update({ turn: 0, throttle: 0 }, simulation.config.simulation.wreckPresentationSeconds + 1);
    expect(canceledCompletionEvents).toEqual([]);
    expect(simulation.generation).toBe(1);
  });
});
