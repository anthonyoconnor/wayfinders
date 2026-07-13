import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import type { GridPoint } from "../src/wayfinders/core/types.ts";
import { parseSaveGame } from "../src/wayfinders/persistence/SaveGame.ts";
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

function reachRetirementChoice(simulation: GameSimulation): void {
  for (let voyage = 0; voyage < 4; voyage++) returnOneExpedition(simulation);
  expect(simulation.navigatorAgeYears).toBe(50);
  expect(simulation.retirementDecisionRequired).toBe(true);
}

describe("navigator aging and safe retirement", () => {
  it("ages only on four exact-dock returns, then retires after one declared final voyage", () => {
    const simulation = new GameSimulation();
    reachRetirementChoice(simulation);
    const inheritedSupported = simulation.snapshot().knowledge.supported;

    expect(simulation.teleport(findUnknownWater(simulation))).toBe(false);
    expect(simulation.declareFinalVoyage()).toBe(true);
    expect(simulation.declareFinalVoyage()).toBe(false);
    expect(simulation.finalVoyageDeclared).toBe(true);

    const restored = new GameSimulation(simulation.config);
    restored.restoreSave(simulation.createSave());
    expect(restored.currentNavigator).toMatchObject({ ageYears: 50, finalVoyageDeclared: true });
    returnOneExpedition(restored);

    expect(restored.generation).toBe(2);
    expect(restored.successfulReturns).toBe(5);
    expect(restored.navigatorLineage).toHaveLength(2);
    expect(restored.navigatorLineage[0]).toMatchObject({
      generation: 1,
      state: "retired",
      ageYears: 55,
      finalVoyageDeclared: true,
      successionReason: "retirement",
    });
    expect(restored.currentNavigator).toMatchObject({
      generation: 2,
      state: "active",
      ageYears: 30,
      finalVoyageDeclared: false,
    });
    expect(restored.snapshot().knowledge.supported).toBeGreaterThan(inheritedSupported);
  });

  it("does not age while idle, reloading, or docking without an active expedition", () => {
    const simulation = new GameSimulation();
    simulation.update({ turn: 0, throttle: 0 }, 10_000);
    expect(simulation.navigatorAgeYears).toBe(30);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.navigatorAgeYears).toBe(30);

    returnOneExpedition(simulation);
    const save = simulation.createSave();
    const restored = new GameSimulation(simulation.config);
    restored.restoreSave(save);
    restored.update({ turn: 0, throttle: 0 }, 10_000);
    expect(restored.navigatorAgeYears).toBe(35);
    expect(restored.successfulReturns).toBe(1);
  });

  it("retires immediately at the safe choice and creates exactly one successor", () => {
    const simulation = new GameSimulation();
    reachRetirementChoice(simulation);
    const inheritedSupported = simulation.snapshot().knowledge.supported;

    expect(simulation.retireNavigator()).toBe(true);
    expect(simulation.retireNavigator()).toBe(false);
    expect(simulation.generation).toBe(2);
    expect(simulation.navigatorLineage).toHaveLength(2);
    expect(simulation.navigatorLineage[0]).toMatchObject({
      state: "retired",
      ageYears: 50,
      finalVoyageDeclared: false,
    });
    expect(simulation.currentNavigator).toMatchObject({ state: "active", ageYears: 30 });
    expect(simulation.snapshot().knowledge.supported).toBe(inheritedSupported);
  });

  it("lets a wreck win during the declared final voyage and resumes one succession after reload", () => {
    const simulation = new GameSimulation();
    reachRetirementChoice(simulation);
    expect(simulation.declareFinalVoyage()).toBe(true);
    expect(simulation.teleport(findUnknownWater(simulation))).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.currentNavigator).toMatchObject({
      state: "lost",
      ageYears: 50,
      finalVoyageDeclared: true,
    });

    simulation.update({ turn: 0, throttle: 0 }, 1);
    const restored = new GameSimulation(simulation.config);
    restored.restoreSave(simulation.createSave());
    restored.update({ turn: 0, throttle: 0 }, restored.respawnSecondsRemaining);
    restored.update({ turn: 0, throttle: 0 }, 10);

    expect(restored.generation).toBe(2);
    expect(restored.navigatorLineage).toHaveLength(2);
    expect(restored.navigatorLineage[0]).toMatchObject({ state: "lost", ageYears: 50 });
    expect(restored.currentNavigator).toMatchObject({ state: "active", ageYears: 30 });
  });

  it("rejects an impossible persisted active navigator at the age-55 retirement boundary", () => {
    const simulation = new GameSimulation();
    reachRetirementChoice(simulation);
    expect(simulation.declareFinalVoyage()).toBe(true);
    const save = structuredClone(simulation.createSave());
    const navigator = save.navigatorLineage.navigators[0] as {
      ageYears: number;
      finalVoyageDeclared: boolean;
    };
    navigator.ageYears = 55;
    navigator.finalVoyageDeclared = true;

    expect(() => parseSaveGame(save)).toThrow(/inconsistent with navigator age/);
  });

  it("rejects an unresolved retirement choice away from an inactive exact-dock state", () => {
    const simulation = new GameSimulation();
    reachRetirementChoice(simulation);
    const dock = simulation.generated.landmarks.homeReturnTile;
    let supportedAwayFromDock: GridPoint | undefined;
    simulation.world.forEachTile((x, y) => {
      if (supportedAwayFromDock || (x === dock.x && y === dock.y)) return;
      if (simulation.world.isMovementBlocked(x, y)) return;
      if (simulation.world.getKnowledge(x, y) !== KnowledgeState.Supported) return;
      supportedAwayFromDock = { x, y };
    });
    if (!supportedAwayFromDock) throw new Error("Expected Supported water away from the dock");

    const offDock = structuredClone(simulation.createSave());
    Object.assign(offDock.ship, {
      currentTileX: supportedAwayFromDock.x,
      currentTileY: supportedAwayFromDock.y,
      worldX: (supportedAwayFromDock.x + 0.5) * simulation.config.navigation.tileSize,
      worldY: (supportedAwayFromDock.y + 0.5) * simulation.config.navigation.tileSize,
    });
    expect(() => parseSaveGame(offDock)).toThrow(/exact home dock/);

    const activeExpedition = structuredClone(simulation.createSave());
    activeExpedition.expedition.active = true;
    expect(() => parseSaveGame(activeExpedition)).toThrow(/inactive while a retirement choice/);
  });
});
