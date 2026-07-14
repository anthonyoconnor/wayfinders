import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import type { GridPoint } from "../src/wayfinders/core/types.ts";
import {
  WRECK_SURVEY_CONTRACT_VERSION,
} from "../src/wayfinders/exploration/WreckSurveyContracts.ts";
import { KnowledgeState } from "../src/wayfinders/world/TileData.ts";

function findUnknownWater(simulation: GameSimulation, excluded: readonly GridPoint[] = []): GridPoint {
  let result: GridPoint | undefined;
  simulation.world.forEachTile((x, y) => {
    if (result || simulation.world.isMovementBlocked(x, y)) return;
    if (simulation.world.getKnowledge(x, y) !== KnowledgeState.Unknown) return;
    if (excluded.some((tile) => tile.x === x && tile.y === y)) return;
    result = { x, y };
  });
  if (!result) throw new Error("Expected navigable Unknown water");
  return result;
}

function loseFirstNavigator(simulation: GameSimulation): GridPoint {
  const tile = findUnknownWater(simulation);
  expect(simulation.teleport(tile)).toBe(true);
  expect(simulation.forceWreck()).toBe(true);
  simulation.update({ turn: 0, throttle: 0 }, simulation.config.simulation.wreckPresentationSeconds);
  expect(simulation.generation).toBe(2);
  expect(simulation.acknowledgeGenerationHandover()).toBe(true);
  return tile;
}

function surveyCurrentWreck(simulation: GameSimulation) {
  const interaction = simulation.wreckSurveyInteraction;
  if (!interaction) throw new Error("Expected a wreck-survey interaction");
  return simulation.interactWithWreck({
    contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
    type: "survey",
    wreckId: interaction.wreckId,
  });
}

describe("lost navigator wreck surveys", () => {
  it("keeps a found wreck unidentified until a later navigator surveys it", () => {
    const simulation = new GameSimulation();
    const discovered: unknown[] = [];
    const surveyed: unknown[] = [];
    simulation.events.on("wreckDiscovered", (event) => discovered.push(event));
    simulation.events.on("wreckSurveyed", (event) => surveyed.push(event));
    const wreckTile = loseFirstNavigator(simulation);

    expect(simulation.wrecks[0]).toMatchObject({
      generation: 1,
      discovered: false,
      survey: { state: "unexamined" },
    });
    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(discovered).toEqual([{
      wreckId: 1,
      tileX: wreckTile.x,
      tileY: wreckTile.y,
    }]);
    expect(simulation.wreckSurveyInteraction).toMatchObject({
      wreckId: 1,
      surveyCost: 2,
      availableProvisionUnits: 12,
      remainingProvisionUnits: 10,
      canAfford: true,
    });

    const result = surveyCurrentWreck(simulation);
    expect(result).toMatchObject({
      status: "surveyed",
      wreckId: 1,
      navigatorId: "navigator:v1:g1",
      lostGeneration: 1,
      provisionsSpent: 2,
      availableProvisionUnitsRemaining: 10,
    });
    expect(simulation.wrecks[0].survey).toEqual({
      state: "provisional",
      expeditionId: simulation.currentExpeditionId,
      generation: 2,
    });
    expect(simulation.ship.provisions).toBe(10);
    expect(simulation.wreckSurveyInteraction).toBeUndefined();
    expect(surveyed).toEqual([expect.objectContaining({
      navigatorId: "navigator:v1:g1",
      lostGeneration: 1,
    })]);
  });

  it("commits the identity report only on exact-dock return and restores it from a save", () => {
    const original = new GameSimulation();
    const wreckTile = loseFirstNavigator(original);
    expect(original.teleport(wreckTile)).toBe(true);
    expect(surveyCurrentWreck(original).status).toBe("surveyed");

    const restored = new GameSimulation(original.config);
    restored.restoreSave(original.createSave());
    const returned: unknown[] = [];
    restored.events.on("wreckSurveysReturned", (event) => returned.push(event));
    expect(restored.wrecks[0].survey.state).toBe("provisional");

    expect(restored.teleport(restored.generated.landmarks.homeReturnTile)).toBe(true);
    expect(restored.wrecks[0].survey).toEqual({
      state: "returned",
      expeditionId: 2,
      generation: 2,
    });
    expect(restored.returnedWreckSurveys).toHaveLength(1);
    expect(restored.currentNavigator.successfulVoyages[0].wreckIds).toEqual([1]);
    expect(returned).toEqual([expect.objectContaining({
      expeditionId: 2,
      generation: 2,
      reports: [expect.objectContaining({
        wreckId: 1,
        navigatorId: "navigator:v1:g1",
        lostGeneration: 1,
      })],
    })]);

    const reloaded = new GameSimulation(original.config);
    reloaded.restoreSave(restored.createSave());
    expect(reloaded.wrecks[0].survey.state).toBe("returned");
    expect(reloaded.wreckSurveyInteraction).toBeUndefined();
    expect(reloaded.teleport(wreckTile)).toBe(true);
    expect(reloaded.interactWithWreck({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      type: "survey",
      wreckId: 1,
    })).toMatchObject({ status: "rejected", reason: "already-surveyed" });
  });

  it("loses an unreturned identity report with the surveying navigator and allows a later resurvey", () => {
    const simulation = new GameSimulation();
    const firstWreckTile = loseFirstNavigator(simulation);
    expect(simulation.teleport(firstWreckTile)).toBe(true);
    expect(surveyCurrentWreck(simulation).status).toBe("surveyed");
    const lostReports: unknown[] = [];
    simulation.events.on("wreckSurveysLost", (event) => lostReports.push(event));

    const fatalTile = findUnknownWater(simulation, [firstWreckTile]);
    expect(simulation.teleport(fatalTile)).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.wrecks[0]).toMatchObject({
      discovered: true,
      survey: { state: "unexamined" },
    });
    expect(lostReports).toEqual([expect.objectContaining({
      reports: [expect.objectContaining({ wreckId: 1, navigatorId: "navigator:v1:g1" })],
    })]);

    simulation.update({ turn: 0, throttle: 0 }, simulation.config.simulation.wreckPresentationSeconds);
    expect(simulation.generation).toBe(3);
    expect(simulation.acknowledgeGenerationHandover()).toBe(true);
    expect(simulation.teleport(firstWreckTile)).toBe(true);
    expect(surveyCurrentWreck(simulation)).toMatchObject({
      status: "surveyed",
      navigatorId: "navigator:v1:g1",
    });
  });

  it("allows mixed wreck and fishing surveys while provisions remain", () => {
    const simulation = new GameSimulation();
    const wreckTile = loseFirstNavigator(simulation);
    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(surveyCurrentWreck(simulation).status).toBe("surveyed");
    expect(simulation.ship.provisions).toBe(10);

    const shoal = simulation.fishingShoalDefinitions[0];
    expect(simulation.teleport(shoal.tile)).toBe(true);
    const interaction = simulation.fishingShoalInteraction;
    expect(interaction).toMatchObject({
      id: shoal.id,
      surveyCost: 2,
      availableProvisionUnits: 10,
      remainingProvisionUnits: 8,
      canAfford: true,
    });
    expect(simulation.interactWithFishingShoal({
      contractVersion: 2,
      type: "survey",
      id: shoal.id,
    })).toMatchObject({ status: "surveyed", provisionsSpent: 2 });
    expect(simulation.ship.provisions).toBe(8);
    expect(simulation.provisionalWreckSurveys).toHaveLength(1);
    expect(simulation.provisionalFishingShoals.filter(({ state }) => state === "surveyed")).toHaveLength(1);
  });

  it("starts a journey when a wreck in Supported water is surveyed", () => {
    const simulation = new GameSimulation();
    const wreckTile = loseFirstNavigator(simulation);

    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.world.getKnowledge(wreckTile.x, wreckTile.y)).toBe(KnowledgeState.Supported);
    expect(simulation.navigatorVoyagesCompleted).toBe(1);

    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(simulation.expeditionActive).toBe(false);
    expect(surveyCurrentWreck(simulation).status).toBe("surveyed");
    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.navigatorVoyagesCompleted).toBe(2);
    expect(simulation.wrecks[0].survey.state).toBe("returned");
  });

  it("keeps a Supported-water wreck survey atomic against expedition-start callbacks", () => {
    const simulation = new GameSimulation();
    const wreckTile = loseFirstNavigator(simulation);
    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(simulation.expeditionActive).toBe(false);

    let callbackTeleport: boolean | undefined;
    let callbackSurvey: ReturnType<GameSimulation["interactWithWreck"]> | undefined;
    simulation.events.on("expeditionStarted", () => {
      callbackTeleport = simulation.teleport(simulation.generated.landmarks.homeReturnTile);
      callbackSurvey = simulation.interactWithWreck({
        contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
        type: "survey",
        wreckId: 1,
      });
    });

    expect(surveyCurrentWreck(simulation).status).toBe("surveyed");
    expect(callbackTeleport).toBe(false);
    expect(callbackSurvey).toMatchObject({ status: "rejected", reason: "interaction-busy" });
    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.wrecks[0].survey).toMatchObject({ state: "provisional", generation: 2 });
    expect(simulation.ship.provisions).toBe(10);
    expect(() => new GameSimulation(simulation.config).restoreSave(simulation.createSave())).not.toThrow();
  });

  it("rejects a wreck survey without enough provisions and changes nothing", () => {
    const simulation = new GameSimulation();
    const wreckTile = loseFirstNavigator(simulation);
    expect(simulation.teleport(wreckTile)).toBe(true);
    simulation.setProvisions(1);
    const saveRevisionBefore = simulation.saveRevision;
    expect(simulation.wreckSurveyInteraction).toMatchObject({
      surveyCost: 2,
      availableProvisionUnits: 1,
      remainingProvisionUnits: 0,
      canAfford: false,
    });

    expect(surveyCurrentWreck(simulation)).toMatchObject({
      status: "rejected",
      reason: "insufficient-provisions",
    });
    expect(simulation.wrecks[0].survey).toEqual({ state: "unexamined" });
    expect(simulation.ship.provisions).toBe(1);
    expect(simulation.saveRevision).toBe(saveRevisionBefore);
  });

  it("rejects stale contracts and unknown commands without changing the wreck", () => {
    const simulation = new GameSimulation();
    const wreckTile = loseFirstNavigator(simulation);
    expect(simulation.teleport(wreckTile)).toBe(true);

    expect(simulation.interactWithWreck({
      contractVersion: 1,
      type: "survey",
      wreckId: 1,
    } as never)).toMatchObject({ status: "rejected", reason: "unsupported-contract" });
    expect(simulation.interactWithWreck({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      type: "leave",
      wreckId: 1,
    } as never)).toMatchObject({ status: "rejected", reason: "invalid-command" });
    expect(simulation.wrecks[0].survey).toEqual({ state: "unexamined" });
    expect(simulation.ship.provisions).toBe(12);
  });
});
