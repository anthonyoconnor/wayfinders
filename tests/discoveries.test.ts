import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import type { GridPoint } from "../src/wayfinders/core/types";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import {
  ISLAND_DOSSIER_CONTRACT_VERSION,
  type IslandDossierDefinitionV1,
} from "../src/wayfinders/exploration/IslandDossierContracts";
import { buildGreatHallChronicle } from "../src/wayfinders/lineage/GreatHallChronicle";
import { KnowledgeState } from "../src/wayfinders/world/TileData";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

function remoteDossiers(
  simulation: GameSimulation,
  count = 1,
): readonly Readonly<IslandDossierDefinitionV1>[] {
  const dock = simulation.generated.landmarks.homeReturnTile;
  return [...simulation.islandDossierDefinitions]
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        left.canonicalApproach.x - dock.x,
        left.canonicalApproach.y - dock.y,
      );
      const rightDistance = Math.hypot(
        right.canonicalApproach.x - dock.x,
        right.canonicalApproach.y - dock.y,
      );
      return rightDistance - leftDistance || left.islandId - right.islandId;
    })
    .slice(0, count);
}

function alternateApproach(
  simulation: GameSimulation,
  definition: Readonly<IslandDossierDefinitionV1>,
): GridPoint {
  const canonicalIndex = simulation.world.index(
    definition.canonicalApproach.x,
    definition.canonicalApproach.y,
  );
  const alternate = definition.approachIndices.reduce<number | undefined>((selected, candidate) => {
    if (candidate === canonicalIndex) return selected;
    if (selected === undefined) return candidate;
    const selectedPoint = simulation.world.pointFromIndex(selected);
    const candidatePoint = simulation.world.pointFromIndex(candidate);
    const selectedDistance = Math.hypot(
      selectedPoint.x - definition.canonicalApproach.x,
      selectedPoint.y - definition.canonicalApproach.y,
    );
    const candidateDistance = Math.hypot(
      candidatePoint.x - definition.canonicalApproach.x,
      candidatePoint.y - definition.canonicalApproach.y,
    );
    return candidateDistance > selectedDistance ? candidate : selected;
  }, undefined);
  if (alternate === undefined) throw new Error(`Island ${definition.islandId} has no alternate approach`);
  return simulation.world.pointFromIndex(alternate);
}

function survey(
  simulation: GameSimulation,
  definition: Readonly<IslandDossierDefinitionV1>,
) {
  return simulation.interactWithIslandDossier({
    contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
    type: "survey",
    islandId: definition.islandId,
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

function chronicleFor(simulation: GameSimulation) {
  return buildGreatHallChronicle(simulation.navigatorLineage, {
    islandDossiers: simulation.islandDossierDefinitions,
    surveySites: simulation.surveySiteDefinitions,
    fishingShoals: simulation.fishingShoalDefinitions,
    wrecks: simulation.wrecks,
  });
}

describe("GameSimulation island-dossier integration", () => {
  it("records a free sighting without exposing the dossier result", () => {
    const simulation = new GameSimulation();
    const [target] = remoteDossiers(simulation);
    const provisionsBefore = simulation.ship.provisions;

    expect(simulation.teleport(target.canonicalApproach)).toBe(true);

    expect(simulation.ship.provisions).toBe(provisionsBefore);
    expect(simulation.provisionalIslandDossiers).toContainEqual(expect.objectContaining({
      islandId: target.islandId,
      state: "sighted",
    }));
    expect(simulation.returnedIslandDossiers).toEqual([]);
    const lead = simulation.islandDossierReadModels.find(({ islandId }) => islandId === target.islandId);
    expect(lead).toMatchObject({
      islandId: target.islandId,
      name: target.name,
      state: "sighted",
    });
    expect(lead).not.toHaveProperty("dossier");
    expect(simulation.revealedIslandIds).not.toContain(target.islandId);
    expect(simulation.islandDossierInteraction).toMatchObject({
      islandId: target.islandId,
      state: "sighted",
      surveyCost: simulation.config.provisions.surveyCost,
      approachTile: target.canonicalApproach,
    });
    expect(simulation.islandDossierInteraction).not.toHaveProperty("dossier");
  });

  it("surveys from both canonical and alternate coastal approaches and charges provisions once", () => {
    for (const approachKind of ["canonical", "alternate"] as const) {
      const simulation = new GameSimulation();
      const [target] = remoteDossiers(simulation);
      const approach = approachKind === "canonical"
        ? target.canonicalApproach
        : alternateApproach(simulation, target);
      const provisionsBefore = simulation.ship.provisions;

      expect(simulation.teleport(approach)).toBe(true);
      expect(simulation.islandDossierInteraction).toMatchObject({
        islandId: target.islandId,
        approachTile: approach,
      });
      expect(survey(simulation, target)).toMatchObject({
        status: "surveyed",
        islandId: target.islandId,
        dossier: target.dossier,
        provisionsSpent: simulation.config.provisions.surveyCost,
      });
      expect(simulation.ship.provisions).toBe(
        provisionsBefore - simulation.config.provisions.surveyCost,
      );
      expect(simulation.revealedIslandIds).toContain(target.islandId);

      const provisionsAfterSurvey = simulation.ship.provisions;
      expect(survey(simulation, target)).toMatchObject({
        status: "rejected",
        reason: "already-surveyed",
      });
      expect(simulation.ship.provisions).toBe(provisionsAfterSurvey);
    }
  });

  it("permits multiple dossier surveys while supplies last and credits them only at the exact dock", () => {
    const simulation = new GameSimulation();
    const targets = remoteDossiers(simulation, 2);
    const expectedIds = targets.map(({ islandId }) => islandId).sort((left, right) => left - right);
    const provisionsBefore = simulation.ship.provisions;

    for (const target of targets) {
      expect(simulation.teleport(target.canonicalApproach)).toBe(true);
      expect(survey(simulation, target).status).toBe("surveyed");
    }

    expect(simulation.ship.provisions).toBe(
      provisionsBefore - targets.length * simulation.config.provisions.surveyCost,
    );
    expect(simulation.returnedIslandDossiers).toEqual([]);
    expect(simulation.currentNavigator.successfulVoyages).toEqual([]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.provisionalIslandDossiers).toEqual([]);
    expect(simulation.returnedIslandDossiers
      .filter(({ state }) => state === "dossier")
      .map(({ islandId }) => islandId)).toEqual(expectedIds);
    expect(simulation.currentNavigator.successfulVoyages[0].islandLeadIds).toEqual([]);
    expect(simulation.currentNavigator.successfulVoyages[0].islandDossierIds).toEqual(expectedIds);

    const voyage = chronicleFor(simulation).navigators[0].voyages[0];
    expect(voyage.outcome).toBe("returned");
    expect(voyage.achievements
      .filter(({ kind }) => kind === "island-dossier")
      .map(({ islandId }) => islandId)
      .sort((left, right) => left - right)).toEqual(expectedIds);
  });

  it("commits an unsurveyed lead only on exact-dock return and records it in the Great Hall", () => {
    const simulation = new GameSimulation();
    const [target] = remoteDossiers(simulation);
    expect(simulation.teleport(target.canonicalApproach)).toBe(true);

    const dockIndex = simulation.world.index(
      simulation.generated.landmarks.homeReturnTile.x,
      simulation.generated.landmarks.homeReturnTile.y,
    );
    const supportedAwayFromDock = [...simulation.world.getSupportedKnowledgeIndices()]
      .find((index) => index !== dockIndex && !simulation.world.isMovementBlockedAtIndex(index));
    if (supportedAwayFromDock === undefined) throw new Error("No supported non-dock water tile");
    expect(simulation.teleport(simulation.world.pointFromIndex(supportedAwayFromDock))).toBe(true);
    expect(simulation.returnedIslandDossiers).toEqual([]);
    expect(simulation.currentNavigator.successfulVoyages).toEqual([]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.returnedIslandDossiers).toContainEqual(expect.objectContaining({
      islandId: target.islandId,
      state: "lead",
    }));
    expect(simulation.currentNavigator.successfulVoyages[0].islandLeadIds).toEqual([target.islandId]);
    expect(simulation.currentNavigator.successfulVoyages[0].islandDossierIds).toEqual([]);

    const voyage = chronicleFor(simulation).navigators[0].voyages[0];
    expect(voyage.outcome).toBe("returned");
    expect(voyage.achievements
      .filter(({ kind }) => kind === "island-lead")
      .map(({ islandId }) => islandId)).toEqual([target.islandId]);
  });

  it("rolls a wrecked survey back while preserving the previously returned lead", () => {
    const simulation = new GameSimulation();
    const [target] = remoteDossiers(simulation);

    expect(simulation.teleport(target.canonicalApproach)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const returnedLead = structuredClone(
      simulation.returnedIslandDossiers.find(({ islandId }) => islandId === target.islandId),
    );
    expect(returnedLead).toMatchObject({ islandId: target.islandId, state: "lead" });

    expect(simulation.teleport(target.canonicalApproach)).toBe(true);
    expect(simulation.islandDossierInteraction).toMatchObject({
      islandId: target.islandId,
      state: "returned-lead",
    });
    expect(survey(simulation, target).status).toBe("surveyed");
    expect(simulation.provisionalIslandDossiers).toContainEqual(expect.objectContaining({
      islandId: target.islandId,
      state: "surveyed",
    }));
    expect(simulation.revealedIslandIds).toContain(target.islandId);

    expect(simulation.teleport(unknownWater(simulation))).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.provisionalIslandDossiers).toEqual([]);
    expect(simulation.returnedIslandDossiers).toContainEqual(returnedLead);
    expect(simulation.revealedIslandIds).not.toContain(target.islandId);
    const restoredLead = simulation.islandDossierReadModels.find(
      ({ islandId }) => islandId === target.islandId,
    );
    expect(restoredLead).toMatchObject({ state: "returned-lead" });
    expect(restoredLead).not.toHaveProperty("dossier");
  });

  it("reveals the island footprint without mutating knowledge state, counts, or travel costs", () => {
    const simulation = new GameSimulation();
    const [target] = remoteDossiers(simulation);
    expect(simulation.teleport(target.canonicalApproach)).toBe(true);

    const knowledgeBefore = Array.from({ length: simulation.world.tileCount }, (_, index) => ({
      state: simulation.world.getKnowledgeAtIndex(index),
      expeditionStamp: simulation.world.getExpeditionStampAtIndex(index),
    }));
    const countsBefore = [
      simulation.world.getKnowledgeCount(KnowledgeState.Unknown),
      simulation.world.getKnowledgeCount(KnowledgeState.Personal),
      simulation.world.getKnowledgeCount(KnowledgeState.Supported),
    ];
    const footprintKnowledgeBefore = target.footprintIndices.map((index) => (
      simulation.world.getKnowledgeAtIndex(index)
    ));
    const knowledgeVersionBefore = simulation.world.knowledgeVersion;
    const supportedTopologyVersionBefore = simulation.world.supportedTopologyVersion;
    const terrainVersionBefore = simulation.world.terrainVersion;
    const returnCostBefore = simulation.returnPaths.returnCost;
    const returnPathBefore = [...simulation.returnPaths.pathIndices];
    const revealRevisionBefore = simulation.islandFogRevealRevision;

    expect(survey(simulation, target).status).toBe("surveyed");

    expect(simulation.revealedIslandIds).toContain(target.islandId);
    expect(simulation.islandFogRevealRevision).toBe(revealRevisionBefore + 1);
    expect(target.footprintIndices.map((index) => simulation.world.getKnowledgeAtIndex(index)))
      .toEqual(footprintKnowledgeBefore);
    expect(Array.from({ length: simulation.world.tileCount }, (_, index) => ({
      state: simulation.world.getKnowledgeAtIndex(index),
      expeditionStamp: simulation.world.getExpeditionStampAtIndex(index),
    }))).toEqual(knowledgeBefore);
    expect([
      simulation.world.getKnowledgeCount(KnowledgeState.Unknown),
      simulation.world.getKnowledgeCount(KnowledgeState.Personal),
      simulation.world.getKnowledgeCount(KnowledgeState.Supported),
    ]).toEqual(countsBefore);
    expect(simulation.world.knowledgeVersion).toBe(knowledgeVersionBefore);
    expect(simulation.world.supportedTopologyVersion).toBe(supportedTopologyVersionBefore);
    expect(simulation.world.terrainVersion).toBe(terrainVersionBefore);
    expect(simulation.returnPaths.returnCost).toBe(returnCostBefore);
    expect(simulation.returnPaths.pathIndices).toEqual(returnPathBefore);
  });
});
