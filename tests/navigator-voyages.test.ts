import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import type { GridPoint } from "../src/wayfinders/core/types.ts";
import {
  NAVIGATOR_VOYAGE_LIMIT,
  type NavigatorVoyageAchievementRecordV1,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";
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
      achievements: Readonly<NavigatorVoyageAchievementRecordV1>;
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
    expect(simulation.navigatorLineage[0].successfulVoyages).toHaveLength(4);
    expect(simulation.navigatorLineage[0].successfulVoyages.map((voyage) => ({
      voyageNumber: voyage.voyageNumber,
      expeditionId: voyage.expeditionId,
    }))).toEqual([
      { voyageNumber: 1, expeditionId: 1 },
      { voyageNumber: 2, expeditionId: 2 },
      { voyageNumber: 3, expeditionId: 3 },
      { voyageNumber: 4, expeditionId: 4 },
    ]);
    expect(returns.every(({ achievements }, index) => (
      achievements === simulation.navigatorLineage[0].successfulVoyages[index]
    ))).toBe(true);
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
    let callbackHandoverActive: boolean | undefined;
    simulation.events.on("expeditionReturned", ({ tenureCompleted }) => {
      if (!tenureCompleted) return;
      callbackHandoverActive = simulation.generationHandoverActive;
      callbackTeleport = simulation.teleport(attemptedTarget);
    });

    returnOneExpedition(simulation);

    expect(callbackTeleport).toBe(false);
    expect(simulation.atDock).toBe(true);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.generationHandoverActive).toBe(true);
    expect(callbackHandoverActive).toBe(true);
  });

  it("does not count idle time or inactive dock arrivals as journeys", () => {
    const simulation = new GameSimulation();
    simulation.update({ turn: 0, throttle: 0 }, 10_000);
    expect(simulation.navigatorVoyagesCompleted).toBe(0);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.navigatorVoyagesCompleted).toBe(0);

    returnOneExpedition(simulation);
    simulation.update({ turn: 0, throttle: 0 }, 10_000);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);

    expect(simulation.navigatorVoyagesCompleted).toBe(1);
    expect(simulation.navigatorVoyagesRemaining).toBe(3);
    expect(simulation.successfulReturns).toBe(1);
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

    simulation.update({ turn: 0, throttle: 0 }, simulation.respawnSecondsRemaining);
    simulation.update({ turn: 0, throttle: 0 }, 10);

    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.generation).toBe(2);
    expect(simulation.navigatorLineage).toHaveLength(2);
    expect(simulation.navigatorLineage[0]).toMatchObject({ state: "lost", completedVoyages: 2 });
    expect(simulation.currentNavigator).toMatchObject({ state: "active", completedVoyages: 0 });
    expect(simulation.pendingGenerationHandover).toMatchObject({
      fromGeneration: 1,
      nextGeneration: 2,
      reason: "wreck",
    });
    expect(simulation.teleport(findUnknownWater(simulation))).toBe(false);
    expect(simulation.acknowledgeGenerationHandover()).toBe(true);
    expect(simulation.teleport(findUnknownWater(simulation))).toBe(true);
    expect(simulation.successfulReturns).toBe(2);
    expect(simulation.failedExpeditions).toBe(1);
  });

});
