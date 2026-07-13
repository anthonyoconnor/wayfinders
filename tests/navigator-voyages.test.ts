import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import type { GridPoint } from "../src/wayfinders/core/types.ts";
import { NAVIGATOR_VOYAGE_LIMIT } from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";
import { SAVE_SCHEMA_VERSION, parseSaveGame } from "../src/wayfinders/persistence/SaveGame.ts";
import { KnowledgeState } from "../src/wayfinders/world/TileData.ts";

function findUnknownWater(simulation: GameSimulation): GridPoint {
  let result: GridPoint | undefined;
  simulation.world.forEachTile((x, y) => {
    if (result || simulation.world.isMovementBlocked(x, y)) return;
    if (simulation.world.getKnowledge(x, y) !== KnowledgeState.Unknown) return;
    result = { x, y };
  });
  if (!result) throw new Error("Expected navigable Unknown water");
  return result;
}

function returnOneExpedition(simulation: GameSimulation): void {
  expect(simulation.teleport(findUnknownWater(simulation))).toBe(true);
  expect(simulation.expeditionActive).toBe(true);
  expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
  expect(simulation.expeditionActive).toBe(false);
}

describe("four-journey navigator tenure", () => {
  it("counts exact-dock returns and automatically nominates a successor after journey four", () => {
    const simulation = new GameSimulation();
    const returns: Array<{
      voyageNumber: number;
      voyagesRemaining: number;
      tenureCompleted: boolean;
      generation: number;
    }> = [];
    const generations: Array<{ previousGeneration: number; generation: number; reason: string }> = [];
    const tenures: Array<{ generation: number; completedVoyages: number; nextGeneration: number }> = [];
    simulation.events.on("expeditionReturned", (event) => returns.push(event));
    simulation.events.on("generationAdvanced", (event) => generations.push(event));
    simulation.events.on("navigatorTenureCompleted", (event) => tenures.push(event));

    for (let voyage = 1; voyage <= NAVIGATOR_VOYAGE_LIMIT; voyage++) {
      returnOneExpedition(simulation);
      if (voyage < NAVIGATOR_VOYAGE_LIMIT) {
        expect(simulation.generation).toBe(1);
        expect(simulation.currentNavigator).toMatchObject({
          generation: 1,
          state: "active",
          completedVoyages: voyage,
        });
        expect(simulation.navigatorVoyageNumber).toBe(voyage + 1);
        expect(simulation.navigatorVoyagesRemaining).toBe(NAVIGATOR_VOYAGE_LIMIT - voyage);
      }
    }

    expect(returns.map(({ voyageNumber, voyagesRemaining, tenureCompleted, generation }) => ({
      voyageNumber,
      voyagesRemaining,
      tenureCompleted,
      generation,
    }))).toEqual([
      { voyageNumber: 1, voyagesRemaining: 3, tenureCompleted: false, generation: 1 },
      { voyageNumber: 2, voyagesRemaining: 2, tenureCompleted: false, generation: 1 },
      { voyageNumber: 3, voyagesRemaining: 1, tenureCompleted: false, generation: 1 },
      { voyageNumber: 4, voyagesRemaining: 0, tenureCompleted: true, generation: 1 },
    ]);
    expect(generations).toEqual([expect.objectContaining({
      previousGeneration: 1,
      generation: 2,
      reason: "tenure",
    })]);
    expect(tenures).toEqual([expect.objectContaining({
      generation: 1,
      completedVoyages: 4,
      nextGeneration: 2,
    })]);
    expect(simulation.navigatorLineage).toHaveLength(2);
    expect(simulation.navigatorLineage[0]).toMatchObject({
      generation: 1,
      state: "completed",
      successionReason: "tenure",
      completedVoyages: 4,
    });
    expect(simulation.currentNavigator).toMatchObject({
      generation: 2,
      state: "active",
      completedVoyages: 0,
    });
    expect(simulation.pendingGenerationHandover).toMatchObject({
      fromGeneration: 1,
      nextGeneration: 2,
      reason: "tenure",
    });
    expect(simulation.successfulReturns).toBe(4);
    expect(simulation.navigatorVoyageNumber).toBe(1);
    expect(simulation.navigatorVoyagesRemaining).toBe(4);
  });

  it("assigns the next journey to the successor instead of extending the first tenure", () => {
    const simulation = new GameSimulation();
    for (let voyage = 0; voyage < NAVIGATOR_VOYAGE_LIMIT; voyage++) returnOneExpedition(simulation);

    expect(simulation.acknowledgeGenerationHandover()).toBe(true);
    returnOneExpedition(simulation);

    expect(simulation.successfulReturns).toBe(5);
    expect(simulation.navigatorLineage[0]).toMatchObject({
      generation: 1,
      state: "completed",
      completedVoyages: 4,
    });
    expect(simulation.currentNavigator).toMatchObject({
      generation: 2,
      state: "active",
      completedVoyages: 1,
    });
  });

  it("installs the fourth-return handover gate before lifecycle subscribers run", () => {
    const simulation = new GameSimulation();
    for (let voyage = 0; voyage < NAVIGATOR_VOYAGE_LIMIT - 1; voyage++) returnOneExpedition(simulation);
    const attemptedTarget = findUnknownWater(simulation);
    let callbackTeleport: boolean | undefined;
    let callbackSave: ReturnType<GameSimulation["createSave"]> | undefined;
    simulation.events.on("expeditionReturned", ({ tenureCompleted }) => {
      if (!tenureCompleted) return;
      callbackSave = simulation.createSave();
      callbackTeleport = simulation.teleport(attemptedTarget);
    });

    returnOneExpedition(simulation);

    expect(callbackTeleport).toBe(false);
    expect(simulation.atDock).toBe(true);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.generationHandoverActive).toBe(true);
    expect(callbackSave).toBeDefined();
    expect(() => parseSaveGame(callbackSave)).not.toThrow();
  });

  it("does not count idle time, reloads, or inactive dock arrivals as journeys", () => {
    const simulation = new GameSimulation();
    simulation.update({ turn: 0, throttle: 0 }, 10_000);
    expect(simulation.navigatorVoyagesCompleted).toBe(0);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.navigatorVoyagesCompleted).toBe(0);

    returnOneExpedition(simulation);
    const restored = new GameSimulation(simulation.config);
    restored.restoreSave(simulation.createSave());
    restored.update({ turn: 0, throttle: 0 }, 10_000);
    expect(restored.teleport(restored.generated.landmarks.homeReturnTile)).toBe(true);

    expect(restored.navigatorVoyagesCompleted).toBe(1);
    expect(restored.navigatorVoyagesRemaining).toBe(3);
    expect(restored.successfulReturns).toBe(1);
  });

  it("completes the fourth-journey transition exactly once across save and reload", () => {
    const simulation = new GameSimulation();
    for (let voyage = 0; voyage < 3; voyage++) returnOneExpedition(simulation);
    const beforeFourth = simulation.createSave();
    expect(beforeFourth.schemaVersion).toBe(SAVE_SCHEMA_VERSION);

    const restored = new GameSimulation(simulation.config);
    restored.restoreSave(beforeFourth);
    returnOneExpedition(restored);
    const afterFourth = restored.createSave();

    const underSuppliedHandover = structuredClone(afterFourth);
    underSuppliedHandover.ship.provisions--;
    expect(() => new GameSimulation(simulation.config).restoreSave(underSuppliedHandover))
      .toThrow(/fully supplied ship/);

    const reloaded = new GameSimulation(simulation.config);
    reloaded.restoreSave(afterFourth);
    const blockedTarget = findUnknownWater(reloaded);
    const blockedShip = { ...reloaded.ship };
    reloaded.update({ turn: 0, throttle: 0 }, 10_000);
    expect(reloaded.ship).toEqual(blockedShip);
    expect(reloaded.teleport(blockedTarget)).toBe(false);
    expect(reloaded.pendingGenerationHandover).toMatchObject({
      fromGeneration: 1,
      nextGeneration: 2,
      reason: "tenure",
    });
    expect(parseSaveGame(reloaded.createSave()).expedition.pendingGenerationHandover).not.toBeNull();
    expect(reloaded.acknowledgeGenerationHandover()).toBe(true);
    expect(reloaded.acknowledgeGenerationHandover()).toBe(false);
    expect(reloaded.teleport(blockedTarget)).toBe(true);

    expect(reloaded.generation).toBe(2);
    expect(reloaded.navigatorLineage).toHaveLength(2);
    expect(reloaded.successfulReturns).toBe(4);
    expect(reloaded.navigatorLineage[0]).toMatchObject({ state: "completed", completedVoyages: 4 });
    expect(reloaded.currentNavigator).toMatchObject({ state: "active", completedVoyages: 0 });
  });

  it("kills a wrecked navigator early, preserves their completed journeys, and resumes once", () => {
    const simulation = new GameSimulation();
    returnOneExpedition(simulation);
    returnOneExpedition(simulation);
    expect(simulation.teleport(findUnknownWater(simulation))).toBe(true);
    expect(simulation.forceWreck()).toBe(true);

    expect(simulation.wreckPresentationActive).toBe(true);
    expect(simulation.currentNavigator).toMatchObject({
      generation: 1,
      state: "lost",
      successionReason: "wreck",
      completedVoyages: 2,
      endedBySuccessionKey: "navigator-succession:v2:wreck:1",
    });
    expect(simulation.successfulReturns).toBe(2);
    expect(simulation.failedExpeditions).toBe(1);

    simulation.update({ turn: 0, throttle: 0 }, 1);
    const restored = new GameSimulation(simulation.config);
    restored.restoreSave(simulation.createSave());
    restored.update({ turn: 0, throttle: 0 }, restored.respawnSecondsRemaining);
    restored.update({ turn: 0, throttle: 0 }, 10);

    expect(restored.wreckPresentationActive).toBe(false);
    expect(restored.generation).toBe(2);
    expect(restored.navigatorLineage).toHaveLength(2);
    expect(restored.navigatorLineage[0]).toMatchObject({ state: "lost", completedVoyages: 2 });
    expect(restored.currentNavigator).toMatchObject({ state: "active", completedVoyages: 0 });
    expect(restored.pendingGenerationHandover).toMatchObject({
      fromGeneration: 1,
      nextGeneration: 2,
      reason: "wreck",
    });
    const afterSuccession = new GameSimulation(simulation.config);
    afterSuccession.restoreSave(restored.createSave());
    expect(afterSuccession.teleport(findUnknownWater(afterSuccession))).toBe(false);
    expect(afterSuccession.acknowledgeGenerationHandover()).toBe(true);
    expect(afterSuccession.teleport(findUnknownWater(afterSuccession))).toBe(true);
    expect(restored.successfulReturns).toBe(2);
    expect(restored.failedExpeditions).toBe(1);
  });

  it("rejects impossible persisted voyage counts and orphaned wreck history", () => {
    const active = new GameSimulation();
    const activeSave = structuredClone(active.createSave());
    (activeSave.navigatorLineage.navigators[0] as { completedVoyages: number }).completedVoyages = 4;
    expect(() => parseSaveGame(activeSave)).toThrow(/less than 4/);

    const completed = new GameSimulation();
    for (let voyage = 0; voyage < 4; voyage++) returnOneExpedition(completed);
    const completedSave = structuredClone(completed.createSave());
    (completedSave.navigatorLineage.navigators[0] as { completedVoyages: number }).completedVoyages = 3;
    expect(() => parseSaveGame(completedSave)).toThrow(/completed tenure/);

    const wrecked = new GameSimulation();
    expect(wrecked.teleport(findUnknownWater(wrecked))).toBe(true);
    expect(wrecked.forceWreck()).toBe(true);
    const orphanedWreck = structuredClone(wrecked.createSave());
    orphanedWreck.wrecks[0].id = 99;
    expect(() => parseSaveGame(orphanedWreck)).toThrow(/saved wreck|lost navigator/);
  });
});
