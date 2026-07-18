import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import type { GridPoint } from "../src/wayfinders/core/types.ts";
import {
  WRECK_SURVEY_CONTRACT_VERSION,
} from "../src/wayfinders/exploration/WreckSurveyContracts.ts";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph.ts";
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

function findOpenHorizontalSeam(simulation: GameSimulation): {
  readonly west: GridPoint;
  readonly east: GridPoint;
  readonly interior: GridPoint;
} {
  const graph = new GridGraph(simulation.world, simulation.config);
  const westX = 0;
  const eastX = simulation.world.width - 1;
  const interiorX = Math.floor(simulation.world.width / 2);
  for (let y = 0; y < simulation.world.height; y++) {
    const points = [
      { x: westX, y },
      { x: eastX, y },
      { x: interiorX, y },
    ];
    if (points.some(({ x, y: pointY }) => (
      simulation.world.getKnowledge(x, pointY) !== KnowledgeState.Unknown
    ))) continue;
    if (!points.slice(0, 2).every(({ x, y: pointY }) => (
      graph.isNavigationNodePassable(simulation.world.index(x, pointY))
    ))) continue;
    return { west: points[0], east: points[1], interior: points[2] };
  }
  throw new Error("Expected an open Unknown-water horizontal seam");
}

describe("lost navigator wreck surveys", () => {
  it("discovers, surveys, and returns one canonical wreck through the opposite seam image", () => {
    const simulation = new GameSimulation();
    const seam = findOpenHorizontalSeam(simulation);
    const discovered: number[] = [];
    const surveyed: number[] = [];
    const returned: number[][] = [];
    simulation.events.on("wreckDiscovered", ({ wreckId }) => discovered.push(wreckId));
    simulation.events.on("wreckSurveyed", ({ wreckId }) => surveyed.push(wreckId));
    simulation.events.on("wreckSurveysReturned", ({ reports }) => {
      returned.push(reports.map(({ wreckId }) => wreckId));
    });

    expect(simulation.teleport(seam.west)).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.wrecks[0]).toMatchObject({
      tileX: seam.west.x,
      tileY: seam.west.y,
      worldX: simulation.config.navigation.tileSize / 2,
      discovered: false,
    });
    expect(simulation.wrecks[0].worldX).toBeGreaterThanOrEqual(0);
    expect(simulation.wrecks[0].worldX).toBeLessThan(simulation.world.topology.pixelWidth);
    simulation.update(
      { turn: 0, throttle: 0 },
      simulation.config.simulation.wreckPresentationSeconds,
    );
    expect(simulation.acknowledgeGenerationHandover()).toBe(true);

    expect(simulation.teleport(seam.east)).toBe(true);
    expect(simulation.world.getKnowledge(seam.interior.x, seam.interior.y)).toBe(KnowledgeState.Unknown);
    expect(discovered).toEqual([1]);
    expect(simulation.wreckSurveyInteraction).toMatchObject({ wreckId: 1, tile: seam.west });

    expect(surveyCurrentWreck(simulation)).toMatchObject({ status: "surveyed", wreckId: 1 });
    expect(simulation.interactWithWreck({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      type: "survey",
      wreckId: 1,
    })).toMatchObject({ status: "rejected", reason: "already-surveyed" });
    expect(surveyed).toEqual([1]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(returned).toEqual([[1]]);
    expect(simulation.wrecks[0].survey.state).toBe("returned");
    expect(simulation.currentNavigator.successfulVoyages.at(-1)?.wreckIds).toEqual([1]);
  });

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

  it("commits the identity report only on exact-dock return", () => {
    const original = new GameSimulation();
    const wreckTile = loseFirstNavigator(original);
    expect(original.teleport(wreckTile)).toBe(true);
    expect(surveyCurrentWreck(original).status).toBe("surveyed");

    const returned: unknown[] = [];
    original.events.on("wreckSurveysReturned", (event) => returned.push(event));
    expect(original.wrecks[0].survey.state).toBe("provisional");

    expect(original.teleport(original.generated.landmarks.homeReturnTile)).toBe(true);
    expect(original.wrecks[0].survey).toEqual({
      state: "returned",
      expeditionId: 2,
      generation: 2,
    });
    expect(original.returnedWreckSurveys).toHaveLength(1);
    expect(original.currentNavigator.successfulVoyages[0].wreckIds).toEqual([1]);
    expect(returned).toEqual([expect.objectContaining({
      expeditionId: 2,
      generation: 2,
      reports: [expect.objectContaining({
        wreckId: 1,
        navigatorId: "navigator:v1:g1",
        lostGeneration: 1,
      })],
    })]);

    expect(original.wrecks[0].survey.state).toBe("returned");
    expect(original.wreckSurveyInteraction).toBeUndefined();
    expect(original.teleport(wreckTile)).toBe(true);
    expect(original.interactWithWreck({
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
  });

  it("rejects a wreck survey without enough provisions and changes nothing", () => {
    const simulation = new GameSimulation();
    const wreckTile = loseFirstNavigator(simulation);
    expect(simulation.teleport(wreckTile)).toBe(true);
    simulation.setProvisions(1);
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
