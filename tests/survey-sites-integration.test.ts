import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import type { GridPoint } from "../src/wayfinders/core/types";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import {
  SURVEY_SITE_CONTRACT_VERSION,
  SURVEY_SITE_TYPES,
  type SurveySiteDefinition,
  type SurveySiteType,
} from "../src/wayfinders/exploration/SurveySiteContracts";
import { KnowledgeState } from "../src/wayfinders/world/TileData";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

function siteOfType(
  simulation: GameSimulation,
  type: SurveySiteType,
): Readonly<SurveySiteDefinition> {
  const definition = simulation.surveySiteDefinitions.find((candidate) => candidate.type === type);
  if (!definition) throw new Error(`Missing survey-site type ${type}`);
  return definition;
}

function survey(simulation: GameSimulation, definition: Readonly<SurveySiteDefinition>) {
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
  if (!selected) throw new Error("No unknown passable water remains for a wreck test");
  return selected;
}

describe("GameSimulation survey-site integration", () => {
  it("generates one of each type, sights for free, and charges an atomic survey exactly once", () => {
    const simulation = new GameSimulation();
    expect(simulation.surveySiteDefinitions.map(({ type }) => type).sort())
      .toEqual([...SURVEY_SITE_TYPES].sort());
    const target = siteOfType(simulation, "historic-wreck");
    const sighted: string[] = [];
    const surveyed: string[] = [];
    simulation.events.on("surveySiteSighted", ({ id }) => sighted.push(id));
    simulation.events.on("surveySiteSurveyed", ({ id }) => surveyed.push(id));
    const provisionsBeforeSighting = simulation.ship.provisions;

    expect(simulation.teleport(target.serviceAnchor)).toBe(true);
    expect(sighted).toContain(target.id);
    expect(simulation.ship.provisions).toBe(provisionsBeforeSighting);
    expect(simulation.provisionalSurveySites).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "sighted",
    }));
    expect(simulation.surveySiteReadModels.find(({ id }) => id === target.id))
      .not.toHaveProperty("result");
    expect(simulation.surveySiteInteraction).toMatchObject({
      id: target.id,
      type: target.type,
      state: "sighted",
      serviceAnchor: target.serviceAnchor,
      surveyCost: simulation.config.provisions.surveyCost,
    });

    const knowledgeVersion = simulation.world.knowledgeVersion;
    const supportedTopologyVersion = simulation.world.supportedTopologyVersion;
    const terrainVersion = simulation.world.terrainVersion;
    const returnCost = simulation.returnPaths.returnCost;
    const recordsRevision = simulation.surveySiteRecordsRevision;
    let reentrantResult: ReturnType<typeof survey> | undefined;
    let reentrantTeleport: boolean | undefined;
    simulation.events.on("provisionConsumed", () => {
      reentrantResult ??= survey(simulation, target);
      reentrantTeleport ??= simulation.teleport(simulation.generated.landmarks.homeReturnTile);
    });

    expect(survey(simulation, target)).toMatchObject({
      status: "surveyed",
      id: target.id,
      type: target.type,
      result: target.result,
      provisionsSpent: simulation.config.provisions.surveyCost,
    });
    expect(reentrantResult).toMatchObject({ status: "rejected", reason: "interaction-busy" });
    expect(reentrantTeleport).toBe(false);
    expect(surveyed).toEqual([target.id]);
    expect(simulation.ship.provisions).toBe(
      provisionsBeforeSighting - simulation.config.provisions.surveyCost,
    );
    expect(simulation.surveySiteRecordsRevision).toBe(recordsRevision + 1);
    expect(simulation.world.knowledgeVersion).toBe(knowledgeVersion);
    expect(simulation.world.supportedTopologyVersion).toBe(supportedTopologyVersion);
    expect(simulation.world.terrainVersion).toBe(terrainVersion);
    expect(simulation.returnPaths.returnCost).toBe(returnCost);

    const provisionsAfterSurvey = simulation.ship.provisions;
    const revisionAfterSurvey = simulation.surveySiteRecordsRevision;
    expect(survey(simulation, target)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(simulation.ship.provisions).toBe(provisionsAfterSurvey);
    expect(simulation.surveySiteRecordsRevision).toBe(revisionAfterSurvey);
  });

  it("commits an unsurveyed sighting as a lead only at the exact home dock", () => {
    const simulation = new GameSimulation();
    const target = siteOfType(simulation, "coastal-ruin");
    const returnedEvents: Array<{ leads: readonly string[]; reports: readonly string[] }> = [];
    simulation.events.on("surveySitesReturned", ({ leads, reports }) => {
      returnedEvents.push({
        leads: leads.map(({ id }) => id),
        reports: reports.map(({ id }) => id),
      });
    });

    expect(simulation.teleport(target.serviceAnchor)).toBe(true);
    expect(simulation.returnedSurveySites).toEqual([]);
    expect(simulation.currentNavigator.successfulVoyages).toEqual([]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.provisionalSurveySites.some(({ id }) => id === target.id)).toBe(false);
    expect(simulation.returnedSurveySites).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "lead",
    }));
    expect(simulation.currentNavigator.successfulVoyages[0].surveySiteLeadIds).toContain(target.id);
    expect(simulation.currentNavigator.successfulVoyages[0].surveySiteReportIds).not.toContain(target.id);
    expect(returnedEvents).toContainEqual(expect.objectContaining({
      leads: expect.arrayContaining([target.id]),
    }));
  });

  it("commits a surveyed result as one report only at the exact home dock", () => {
    const simulation = new GameSimulation();
    const target = siteOfType(simulation, "tidal-cave");

    expect(simulation.teleport(target.serviceAnchor)).toBe(true);
    expect(survey(simulation, target).status).toBe("surveyed");
    expect(simulation.returnedSurveySites).toEqual([]);
    expect(simulation.currentNavigator.successfulVoyages).toEqual([]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.returnedSurveySites).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "report",
    }));
    expect(simulation.currentNavigator.successfulVoyages[0].surveySiteLeadIds).not.toContain(target.id);
    expect(simulation.currentNavigator.successfulVoyages[0].surveySiteReportIds).toContain(target.id);

    const returnedBefore = structuredClone(simulation.returnedSurveySites);
    expect(simulation.teleport(target.serviceAnchor)).toBe(true);
    expect(simulation.surveySiteInteraction).toBeUndefined();
    expect(survey(simulation, target)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(simulation.returnedSurveySites).toEqual(returnedBefore);
    expect(simulation.currentNavigator.successfulVoyages).toHaveLength(1);
  });

  it("rolls back a wrecked lead upgrade while preserving the earlier returned lead", () => {
    const simulation = new GameSimulation();
    const target = siteOfType(simulation, "historic-wreck");
    const lostEvents: string[][] = [];
    simulation.events.on("surveySitesLost", ({ records }) => {
      lostEvents.push(records.map(({ id }) => id));
    });

    expect(simulation.teleport(target.serviceAnchor)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const returnedLead = structuredClone(
      simulation.returnedSurveySites.find(({ id }) => id === target.id),
    );
    expect(returnedLead).toMatchObject({ id: target.id, state: "lead" });

    expect(simulation.teleport(target.serviceAnchor)).toBe(true);
    expect(simulation.surveySiteInteraction).toMatchObject({
      id: target.id,
      state: "returned-lead",
    });
    expect(survey(simulation, target).status).toBe("surveyed");
    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.provisionalSurveySites).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "surveyed",
    }));

    expect(simulation.teleport(unknownWater(simulation))).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.provisionalSurveySites.some(({ id }) => id === target.id)).toBe(false);
    expect(simulation.returnedSurveySites).toContainEqual(returnedLead);
    expect(simulation.surveySiteReadModels.find(({ id }) => id === target.id))
      .toMatchObject({ state: "returned-lead" });
    expect(simulation.surveySiteReadModels.find(({ id }) => id === target.id))
      .not.toHaveProperty("result");
    expect(lostEvents.some((ids) => ids.includes(target.id))).toBe(true);
    expect(simulation.navigatorLineage.flatMap(({ successfulVoyages }) => successfulVoyages)
      .flatMap(({ surveySiteReportIds }) => surveySiteReportIds)).not.toContain(target.id);
  });

  it("round-trips provisional and returned reports without rerolling or duplicate credit", () => {
    const original = new GameSimulation();
    const target = siteOfType(original, "coastal-ruin");
    expect(original.teleport(target.serviceAnchor)).toBe(true);
    expect(survey(original, target).status).toBe("surveyed");

    const activeSave = original.createSave();
    const activeRestored = new GameSimulation();
    activeRestored.restoreSave(activeSave);
    expect(activeRestored.surveySiteDefinitions).toEqual(original.surveySiteDefinitions);
    expect(activeRestored.provisionalSurveySites).toEqual(original.provisionalSurveySites);
    expect(activeRestored.returnedSurveySites).toEqual([]);
    expect(activeRestored.surveySiteReadModels.find(({ id }) => id === target.id))
      .toMatchObject({ state: "surveyed", result: target.result });
    const provisionsBeforeRepeat = activeRestored.ship.provisions;
    expect(survey(activeRestored, target)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(activeRestored.ship.provisions).toBe(provisionsBeforeRepeat);

    expect(activeRestored.teleport(activeRestored.generated.landmarks.homeReturnTile)).toBe(true);
    expect(activeRestored.currentNavigator.successfulVoyages[0].surveySiteReportIds)
      .toContain(target.id);
    const returnedSave = activeRestored.createSave();
    const returnedRestored = new GameSimulation();
    returnedRestored.restoreSave(returnedSave);
    expect(returnedRestored.returnedSurveySites).toEqual(activeRestored.returnedSurveySites);
    expect(returnedRestored.currentNavigator.successfulVoyages).toHaveLength(1);
    expect(returnedRestored.currentNavigator.successfulVoyages[0].surveySiteReportIds)
      .toContain(target.id);
    expect(returnedRestored.createSave().surveySites).toEqual(returnedSave.surveySites);

    expect(returnedRestored.teleport(target.serviceAnchor)).toBe(true);
    const provisionsBeforeReturnedRepeat = returnedRestored.ship.provisions;
    expect(survey(returnedRestored, target)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(returnedRestored.ship.provisions).toBe(provisionsBeforeReturnedRepeat);
    expect(returnedRestored.currentNavigator.successfulVoyages).toHaveLength(1);
  });
});
