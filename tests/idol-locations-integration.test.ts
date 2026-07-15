import { describe, expect, it } from "vitest";

import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import type { GridPoint } from "../src/wayfinders/core/types";
import {
  ISLAND_DOSSIER_CONTRACT_VERSION,
} from "../src/wayfinders/exploration/IslandDossierContracts";
import type {
  IdolLocationDefinition,
} from "../src/wayfinders/exploration/IdolLocationContracts";
import {
  SURVEY_SITE_CONTRACT_VERSION,
} from "../src/wayfinders/exploration/SurveySiteContracts";
import { KnowledgeState } from "../src/wayfinders/world/TileData";
import { makeConfig } from "./helpers";

function surveyIdolLocation(
  simulation: GameSimulation,
  location: Readonly<IdolLocationDefinition>,
) {
  const host = location.host;
  if (host.kind === "island-dossier") {
    const definition = simulation.islandDossierDefinitions.find(({ islandId }) => (
      islandId === host.islandId
    ));
    if (!definition) throw new Error(`Missing idol island host ${host.islandId}`);
    expect(simulation.teleport(definition.canonicalApproach)).toBe(true);
    return simulation.interactWithIslandDossier({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: definition.islandId,
    });
  }

  const definition = simulation.surveySiteDefinitions.find(({ id }) => (
    id === host.surveySiteId
  ));
  if (!definition) throw new Error(`Missing idol survey-site host ${host.surveySiteId}`);
  expect(simulation.teleport(definition.serviceAnchor)).toBe(true);
  return simulation.interactWithSurveySite({
    contractVersion: SURVEY_SITE_CONTRACT_VERSION,
    type: "survey",
    id: definition.id,
  });
}

function unknownWater(simulation: GameSimulation): GridPoint {
  const dock = simulation.generated.landmarks.homeReturnTile;
  let selected: GridPoint | undefined;
  let selectedDistance = -1;
  simulation.world.forEachTile((x, y, index) => {
    if (
      simulation.world.isMovementBlockedAtIndex(index)
      || simulation.world.getKnowledgeAtIndex(index) !== KnowledgeState.Unknown
    ) return;
    const distance = Math.hypot(x - dock.x, y - dock.y);
    if (distance <= selectedDistance) return;
    selected = { x, y };
    selectedDistance = distance;
  });
  if (!selected) throw new Error("Expected navigable Unknown water for an idol wreck test");
  return selected;
}

function completeSingleIdolWorld(simulation: GameSimulation): Readonly<IdolLocationDefinition> {
  const location = simulation.idolLocationDefinitions[0];
  if (!location) throw new Error("Expected one configured idol location");
  expect(surveyIdolLocation(simulation, location).status).toBe("surveyed");
  expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
  expect(simulation.completionChoiceActive).toBe(true);
  return location;
}

describe("GameSimulation idol-location lifecycle", () => {
  it("discovers an idol through its normal host survey for exactly one survey cost", () => {
    const simulation = new GameSimulation(makeConfig({ world: { idolCount: 1 } }));
    const location = simulation.idolLocationDefinitions[0];
    const discoveries: Array<{ id: string; provisionsSpent: number }> = [];
    simulation.events.on("idolLocationDiscovered", ({ location: discovered, provisionsSpent }) => {
      discoveries.push({ id: discovered.id, provisionsSpent });
    });
    const provisionsBefore = simulation.ship.provisions;

    const result = surveyIdolLocation(simulation, location);

    expect(result.status).toBe("surveyed");
    expect(simulation.ship.provisions).toBe(
      provisionsBefore - simulation.config.provisions.surveyCost,
    );
    expect(discoveries).toEqual([{
      id: location.id,
      provisionsSpent: simulation.config.provisions.surveyCost,
    }]);
    expect(simulation.provisionalIdolLocations.map(({ id }) => id)).toEqual([location.id]);
    expect(simulation.returnedIdolLocations).toEqual([]);

    const provisionsAfterSurvey = simulation.ship.provisions;
    expect(surveyIdolLocation(simulation, location)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(simulation.ship.provisions).toBe(provisionsAfterSurvey);
    expect(discoveries).toHaveLength(1);
  });

  it("loses a provisionally discovered idol on wreck without awarding finder credit", () => {
    const simulation = new GameSimulation(makeConfig({ world: { idolCount: 1 } }));
    const location = simulation.idolLocationDefinitions[0];
    const losses: string[][] = [];
    const completions: unknown[] = [];
    simulation.events.on("idolLocationsLost", ({ locations }) => {
      losses.push(locations.map(({ id }) => id));
    });
    simulation.events.on("gameCompleted", (event) => completions.push(event));

    expect(surveyIdolLocation(simulation, location).status).toBe("surveyed");
    expect(simulation.provisionalIdolLocations.map(({ id }) => id)).toEqual([location.id]);
    expect(simulation.teleport(unknownWater(simulation))).toBe(true);
    expect(simulation.forceWreck()).toBe(true);

    expect(losses).toEqual([[location.id]]);
    expect(simulation.provisionalIdolLocations).toEqual([]);
    expect(simulation.returnedIdolLocations).toEqual([]);
    expect(simulation.idolLocationProgress).toMatchObject({
      total: 1,
      provisional: 0,
      returned: 0,
      complete: false,
      completionState: "in-progress",
    });
    expect(simulation.currentNavigator).toMatchObject({ state: "lost", successfulVoyages: [] });
    expect(completions).toEqual([]);
  });

  it("commits island and site idols only at the exact dock and credits their existing achievements", () => {
    const simulation = new GameSimulation(makeConfig({ world: { idolCount: 11 } }));
    const islandLocation = simulation.idolLocationDefinitions.find(({ host }) => (
      host.kind === "island-dossier"
    ));
    const siteLocation = simulation.idolLocationDefinitions.find(({ host }) => (
      host.kind === "survey-site"
    ));
    if (!islandLocation || islandLocation.host.kind !== "island-dossier") {
      throw new Error("Expected an island-hosted idol");
    }
    if (!siteLocation || siteLocation.host.kind !== "survey-site") {
      throw new Error("Expected a survey-site-hosted idol");
    }
    const returnedEvents: string[][] = [];
    simulation.events.on("idolLocationsReturned", ({ locations }) => {
      returnedEvents.push(locations.map(({ id }) => id));
    });

    expect(surveyIdolLocation(simulation, islandLocation).status).toBe("surveyed");
    expect(surveyIdolLocation(simulation, siteLocation).status).toBe("surveyed");
    expect(simulation.returnedIdolLocations).toEqual([]);
    expect(simulation.currentNavigator.successfulVoyages).toEqual([]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);

    const expectedReturnedIds = [islandLocation.id, siteLocation.id].sort();
    expect(returnedEvents.map((ids) => [...ids].sort())).toEqual([expectedReturnedIds]);
    expect(simulation.returnedIdolLocations.map(({ id }) => id).sort()).toEqual(expectedReturnedIds);
    expect(simulation.idolLocationProgress).toMatchObject({ returned: 2, complete: false });
    const finderVoyage = simulation.currentNavigator.successfulVoyages[0];
    expect(finderVoyage.islandDossierIds).toContain(islandLocation.host.islandId);
    expect(finderVoyage.surveySiteReportIds).toContain(siteLocation.host.surveySiteId);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(returnedEvents).toHaveLength(1);
    expect(simulation.currentNavigator.successfulVoyages).toHaveLength(1);
  });

  it("completes once and Continue preserves the completed world without retriggering", () => {
    const simulation = new GameSimulation(makeConfig({ world: { idolCount: 1 } }));
    const completions: unknown[] = [];
    const continuedSeeds: number[] = [];
    simulation.events.on("gameCompleted", (event) => completions.push(event));
    simulation.events.on("completedWorldContinued", ({ seed }) => continuedSeeds.push(seed));

    const location = completeSingleIdolWorld(simulation);
    const seed = simulation.generated.seed;
    const definitions = structuredClone(simulation.idolLocationDefinitions);
    const creditedVoyages = simulation.currentNavigator.successfulVoyages.length;

    expect(completions).toHaveLength(1);
    expect(simulation.idolLocationProgress).toEqual({
      total: 1,
      provisional: 0,
      returned: 1,
      complete: true,
      completionState: "awaiting-choice",
    });
    expect(simulation.continueCompletedWorld()).toBe(true);
    expect(simulation.continueCompletedWorld()).toBe(false);
    expect(continuedSeeds).toEqual([seed]);
    expect(simulation.generated.seed).toBe(seed);
    expect(simulation.idolLocationDefinitions).toEqual(definitions);
    expect(simulation.returnedIdolLocations.map(({ id }) => id)).toEqual([location.id]);
    expect(simulation.currentNavigator.successfulVoyages).toHaveLength(creditedVoyages);
    expect(simulation.idolLocationProgress.completionState).toBe("continued");

    expect(simulation.teleport(unknownWater(simulation))).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(completions).toHaveLength(1);
    expect(simulation.completionChoiceActive).toBe(false);
    expect(simulation.idolLocationProgress).toMatchObject({
      returned: 1,
      complete: true,
      completionState: "continued",
    });
  });

  it("Start New Game chooses a distinct seed and resets all idol and lineage progress", () => {
    const simulation = new GameSimulation(makeConfig({ world: { idolCount: 1 } }));
    const regeneratedSeeds: number[] = [];
    simulation.events.on("worldRegenerated", ({ seed }) => regeneratedSeeds.push(seed));
    completeSingleIdolWorld(simulation);
    const completedSeed = simulation.generated.seed;

    const newSeed = simulation.startNewGame();

    expect(newSeed).toBeDefined();
    expect(newSeed).not.toBe(completedSeed);
    expect(simulation.generated.seed).toBe(newSeed);
    expect(regeneratedSeeds).toEqual([newSeed]);
    expect(simulation.idolLocationProgress).toEqual({
      total: 1,
      provisional: 0,
      returned: 0,
      complete: false,
      completionState: "in-progress",
    });
    expect(simulation.provisionalIdolLocations).toEqual([]);
    expect(simulation.returnedIdolLocations).toEqual([]);
    expect(simulation.generation).toBe(1);
    expect(simulation.currentNavigator.successfulVoyages).toEqual([]);
    expect(simulation.currentExpeditionId).toBe(1);
    expect(simulation.atDock).toBe(true);
    expect(simulation.startNewGame()).toBeUndefined();
  });

  it("keeps a fourth-voyage handover queued behind the final completion choice", () => {
    const simulation = new GameSimulation(makeConfig({ world: { idolCount: 1 } }));
    for (let voyage = 1; voyage <= 3; voyage++) {
      expect(simulation.teleport(unknownWater(simulation))).toBe(true);
      expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    }
    const finderId = simulation.currentNavigator.id;
    expect(simulation.currentNavigator.completedVoyages).toBe(3);

    completeSingleIdolWorld(simulation);

    expect(simulation.completionChoiceActive).toBe(true);
    expect(simulation.pendingGenerationHandover).toMatchObject({
      fromNavigatorId: finderId,
      reason: "tenure",
    });
    expect(simulation.acknowledgeGenerationHandover()).toBe(false);
    expect(simulation.continueCompletedWorld()).toBe(true);
    expect(simulation.pendingGenerationHandover).toMatchObject({ fromNavigatorId: finderId });
    expect(simulation.acknowledgeGenerationHandover()).toBe(true);
    expect(simulation.pendingGenerationHandover).toBeUndefined();
    expect(simulation.completionState).toBe("continued");
  });
});
