import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import type { GridPoint } from "../src/wayfinders/core/types.ts";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  type FishingShoalDefinition,
} from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import {
  ISLAND_DOSSIER_CONTRACT_VERSION,
  type IslandDossierDefinitionV1,
} from "../src/wayfinders/exploration/IslandDossierContracts.ts";
import type { IdolLocationDefinition } from "../src/wayfinders/exploration/IdolLocationContracts.ts";
import {
  SURVEY_SITE_CONTRACT_VERSION,
  type SurveySiteDefinition,
} from "../src/wayfinders/exploration/SurveySiteContracts.ts";
import { WRECK_SURVEY_CONTRACT_VERSION } from "../src/wayfinders/exploration/WreckSurveyContracts.ts";
import { PROSPERITY_SCORE_SCHEDULE_V1 } from "../src/wayfinders/features/prosperity/index.ts";
import { IslandSize } from "../src/wayfinders/world/IslandGenerator.ts";
import { KnowledgeState } from "../src/wayfinders/world/TileData.ts";
import { makeConfig } from "./helpers.ts";

function featureFreeUnknownWater(simulation: GameSimulation): GridPoint {
  const featurePoints = [
    ...simulation.islandDossierDefinitions.flatMap(({ footprintIndices }) => (
      footprintIndices.map((index) => simulation.world.pointFromIndex(index))
    )),
    ...simulation.surveySiteDefinitions.map(({ tile }) => tile),
    ...simulation.fishingShoalDefinitions.map(({ tile }) => tile),
  ];
  const minimumDistance = simulation.config.navigation.sightRadius + 2;
  let selected: GridPoint | undefined;
  simulation.world.forEachTile((x, y, index) => {
    if (selected !== undefined) return;
    if (simulation.world.isMovementBlockedAtIndex(index)) return;
    if (simulation.world.getKnowledgeAtIndex(index) !== KnowledgeState.Unknown) return;
    const candidate = { x, y };
    if (featurePoints.some((feature) => (
      simulation.world.topology.minimumImageTileDistanceSquared(candidate, feature)
      < minimumDistance * minimumDistance
    ))) return;
    selected = candidate;
  });
  if (!selected) throw new Error("Expected feature-free navigable Unknown water");
  return selected;
}

function surveyFishingShoal(
  simulation: GameSimulation,
  target: Readonly<FishingShoalDefinition>,
): void {
  expect(simulation.interactWithFishingShoal({
    contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
    type: "survey",
    id: target.id,
  })).toMatchObject({ status: "surveyed", id: target.id, quality: target.quality });
}

function surveyIslandDossier(
  simulation: GameSimulation,
  target: Readonly<IslandDossierDefinitionV1>,
): void {
  expect(simulation.teleport(target.canonicalApproach)).toBe(true);
  expect(simulation.interactWithIslandDossier({
    contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
    type: "survey",
    islandId: target.islandId,
  })).toMatchObject({ status: "surveyed", islandId: target.islandId });
}

function surveySurveySite(
  simulation: GameSimulation,
  target: Readonly<SurveySiteDefinition>,
): void {
  expect(simulation.teleport(target.serviceAnchor)).toBe(true);
  expect(simulation.interactWithSurveySite({
    contractVersion: SURVEY_SITE_CONTRACT_VERSION,
    type: "survey",
    id: target.id,
  })).toMatchObject({ status: "surveyed", id: target.id });
}

function surveyIdolHost(
  simulation: GameSimulation,
  location: Readonly<IdolLocationDefinition>,
): void {
  const host = location.host;
  if (host.kind === "island-dossier") {
    const target = simulation.islandDossierDefinitions.find(({ islandId }) => (
      islandId === host.islandId
    ));
    if (!target) throw new Error(`Missing idol island host ${host.islandId}`);
    surveyIslandDossier(simulation, target);
    return;
  }
  const target = simulation.surveySiteDefinitions.find(({ id }) => (
    id === host.surveySiteId
  ));
  if (!target) throw new Error(`Missing idol survey-site host ${host.surveySiteId}`);
  surveySurveySite(simulation, target);
}

function returnFishingSurvey(simulation: GameSimulation): {
  readonly target: Readonly<FishingShoalDefinition>;
  readonly finalValue: number;
} {
  const target = simulation.fishingShoalDefinitions[0];
  expect(simulation.teleport(target.tile)).toBe(true);
  surveyFishingShoal(simulation, target);
  expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
  return {
    target,
    finalValue: PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.surveyByQuality[target.quality],
  };
}

describe("GameSimulation hidden Prosperity settlement", () => {
  it("starts at zero and gives route/tile-only returns and idle docking no score", () => {
    const simulation = new GameSimulation(makeConfig());
    const initial = simulation.prosperityScoreSnapshot;
    expect(initial).toMatchObject({ score: 0, revision: 0, ledger: [] });

    expect(simulation.teleport(featureFreeUnknownWater(simulation))).toBe(true);
    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.currentVoyageSupportedTileCount).toBeGreaterThan(0);
    expect(simulation.currentVoyageAchievements).toMatchObject({
      islandLeadIds: [],
      islandDossierIds: [],
      surveySiteLeadIds: [],
      surveySiteReportIds: [],
      fishingLeadIds: [],
      fishingSurveyIds: [],
      wreckIds: [],
    });
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.prosperityScoreSnapshot).toBe(initial);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.prosperityScoreSnapshot).toBe(initial);
  });

  it("keeps a fishing finding provisional until exact return and settles before return subscribers", () => {
    const simulation = new GameSimulation(makeConfig());
    const target = simulation.fishingShoalDefinitions[0];
    const finalValue = PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.surveyByQuality[target.quality];
    let scoreObservedDuringReturn: number | undefined;
    simulation.events.on("expeditionReturned", () => {
      scoreObservedDuringReturn = simulation.prosperityScoreSnapshot.score;
    });

    expect(simulation.teleport(target.tile)).toBe(true);
    expect(simulation.provisionalFishingShoals).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "sighted",
    }));
    expect(simulation.prosperityScoreSnapshot).toMatchObject({ score: 0, revision: 0 });

    surveyFishingShoal(simulation, target);
    expect(simulation.provisionalFishingShoals).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "surveyed",
    }));
    expect(simulation.prosperityScoreSnapshot).toMatchObject({ score: 0, revision: 0 });

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const settled = simulation.prosperityScoreSnapshot;
    expect(settled).toMatchObject({
      revision: 1,
      ledger: expect.arrayContaining([expect.objectContaining({
        kind: "fishing-shoal",
        sourceId: target.id,
        value: finalValue,
      })]),
    });
    expect(settled.score).toBe(settled.ledger.reduce((sum, entry) => sum + entry.value, 0));
    expect(scoreObservedDuringReturn).toBe(settled.score);
  });

  it("makes a direct fishing survey equal a returned lead followed by a later survey", () => {
    const direct = new GameSimulation(makeConfig());
    const { target: directTarget, finalValue: directFinalValue } = returnFishingSurvey(direct);
    expect(direct.prosperityScoreSnapshot.ledger).toContainEqual(expect.objectContaining({
      kind: "fishing-shoal",
      sourceId: directTarget.id,
      value: directFinalValue,
    }));

    const staged = new GameSimulation(makeConfig());
    const target = staged.fishingShoalDefinitions[0];
    expect(staged.teleport(target.tile)).toBe(true);
    expect(staged.teleport(staged.generated.landmarks.homeReturnTile)).toBe(true);
    const afterLead = staged.prosperityScoreSnapshot;
    expect(afterLead).toMatchObject({
      revision: 1,
      ledger: expect.arrayContaining([expect.objectContaining({
        kind: "fishing-shoal",
        sourceId: target.id,
        value: PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.lead,
      })]),
    });

    expect(staged.teleport(target.tile)).toBe(true);
    surveyFishingShoal(staged, target);
    expect(staged.prosperityScoreSnapshot).toBe(afterLead);
    expect(staged.teleport(staged.generated.landmarks.homeReturnTile)).toBe(true);

    expect(staged.prosperityScoreSnapshot).toMatchObject({
      score: direct.prosperityScoreSnapshot.score,
      revision: 2,
      ledger: expect.arrayContaining([expect.objectContaining({
        kind: "fishing-shoal",
        sourceId: target.id,
        value: directFinalValue,
      })]),
    });
    expect(staged.prosperityScoreSnapshot.ledger).toEqual(direct.prosperityScoreSnapshot.ledger);
  });

  it("settles island dossiers by generated size and a returned survey-site report", () => {
    const simulation = new GameSimulation(makeConfig());
    const islandTargets = [IslandSize.Small, IslandSize.Medium, IslandSize.Large].map((size) => {
      const target = simulation.islandDossierDefinitions.find((definition) => definition.size === size);
      if (!target) throw new Error(`Expected a generated ${size} island dossier`);
      return target;
    });
    const siteTarget = simulation.surveySiteDefinitions[0];
    if (!siteTarget) throw new Error("Expected a generated survey site");

    for (const target of islandTargets) surveyIslandDossier(simulation, target);
    surveySurveySite(simulation, siteTarget);
    expect(simulation.prosperityScoreSnapshot).toMatchObject({ score: 0, revision: 0, ledger: [] });

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const settled = simulation.prosperityScoreSnapshot;
    for (const target of islandTargets) {
      expect(settled.ledger).toContainEqual(expect.objectContaining({
        kind: "island",
        sourceId: target.islandId,
        value: PROSPERITY_SCORE_SCHEDULE_V1.island.dossierBySize[target.size],
      }));
    }
    expect(settled.ledger).toContainEqual(expect.objectContaining({
      kind: "survey-site",
      sourceId: siteTarget.id,
      value: PROSPERITY_SCORE_SCHEDULE_V1.surveySite.report,
    }));
    expect(settled).toMatchObject({ revision: 1 });
    expect(settled.score).toBe(settled.ledger.reduce((sum, entry) => sum + entry.value, 0));
  });

  it("adds an idol to its returned host value and Start New Game resets Prosperity", () => {
    const simulation = new GameSimulation(makeConfig({ world: { idolCount: 1 } }));
    const location = simulation.idolLocationDefinitions[0];
    if (!location) throw new Error("Expected one configured idol location");
    surveyIdolHost(simulation, location);
    expect(simulation.provisionalIdolLocations.map(({ id }) => id)).toEqual([location.id]);
    expect(simulation.prosperityScoreSnapshot).toMatchObject({ score: 0, revision: 0, ledger: [] });

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const settled = simulation.prosperityScoreSnapshot;
    expect(settled.ledger).toContainEqual(expect.objectContaining({
      kind: "idol-location",
      sourceId: location.id,
      value: PROSPERITY_SCORE_SCHEDULE_V1.idolLocation.returned,
    }));
    const host = location.host;
    if (host.kind === "island-dossier") {
      const hostDefinition = simulation.islandDossierDefinitions.find(({ islandId }) => (
        islandId === host.islandId
      ));
      if (!hostDefinition) throw new Error(`Missing returned idol island host ${host.islandId}`);
      expect(settled.ledger).toContainEqual(expect.objectContaining({
        kind: "island",
        sourceId: hostDefinition.islandId,
        value: PROSPERITY_SCORE_SCHEDULE_V1.island.dossierBySize[hostDefinition.size],
      }));
    } else {
      expect(settled.ledger).toContainEqual(expect.objectContaining({
        kind: "survey-site",
        sourceId: host.surveySiteId,
        value: PROSPERITY_SCORE_SCHEDULE_V1.surveySite.report,
      }));
    }
    expect(simulation.completionChoiceActive).toBe(true);
    expect(settled.score).toBe(settled.ledger.reduce((sum, entry) => sum + entry.value, 0));

    const completedSeed = simulation.generated.seed;
    const newSeed = simulation.startNewGame();
    expect(newSeed).toBeDefined();
    expect(newSeed).not.toBe(completedSeed);
    expect(simulation.generated.seed).toBe(newSeed);
    expect(simulation.prosperityScoreSnapshot).toEqual({
      contractVersion: 1,
      scheduleVersion: 1,
      score: 0,
      revision: 0,
      ledger: [],
    });
  });

  it("rolls a failed provisional survey back without changing Prosperity", () => {
    const simulation = new GameSimulation(makeConfig());
    const target = simulation.fishingShoalDefinitions[0];
    expect(simulation.teleport(target.tile)).toBe(true);
    surveyFishingShoal(simulation, target);
    expect(simulation.prosperityScoreSnapshot.score).toBe(0);

    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.provisionalFishingShoals).toEqual([]);
    expect(simulation.returnedFishingShoals).toEqual([]);
    expect(simulation.prosperityScoreSnapshot).toMatchObject({ score: 0, revision: 0, ledger: [] });
    simulation.update(
      { turn: 0, throttle: 0 },
      simulation.config.simulation.wreckPresentationSeconds,
    );
    expect(simulation.generation).toBe(2);
    expect(simulation.prosperityScoreSnapshot).toMatchObject({ score: 0, revision: 0, ledger: [] });
  });

  it("preserves score through succession and adds four only when a prior wreck report returns", () => {
    const simulation = new GameSimulation(makeConfig());
    const fishingTarget = simulation.fishingShoalDefinitions[0];
    expect(simulation.teleport(fishingTarget.tile)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const beforeWreck = simulation.prosperityScoreSnapshot;
    expect(beforeWreck).toMatchObject({
      revision: 1,
      ledger: expect.arrayContaining([expect.objectContaining({
        kind: "fishing-shoal",
        sourceId: fishingTarget.id,
        value: PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.lead,
      })]),
    });

    const wreckTile = featureFreeUnknownWater(simulation);
    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.prosperityScoreSnapshot).toBe(beforeWreck);
    simulation.update(
      { turn: 0, throttle: 0 },
      simulation.config.simulation.wreckPresentationSeconds,
    );
    expect(simulation.generation).toBe(2);
    expect(simulation.prosperityScoreSnapshot).toBe(beforeWreck);
    expect(simulation.acknowledgeGenerationHandover()).toBe(true);

    expect(simulation.teleport(wreckTile)).toBe(true);
    expect(simulation.wreckSurveyInteraction).toMatchObject({ wreckId: 1, tile: wreckTile });
    expect(simulation.interactWithWreck({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      type: "survey",
      wreckId: 1,
    })).toMatchObject({ status: "surveyed", wreckId: 1, lostGeneration: 1 });
    expect(simulation.prosperityScoreSnapshot).toBe(beforeWreck);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const afterReport = simulation.prosperityScoreSnapshot;
    expect(afterReport).toMatchObject({
      score: beforeWreck.score + PROSPERITY_SCORE_SCHEDULE_V1.navigatorWreck.confirmedReport,
      revision: beforeWreck.revision + 1,
      ledger: expect.arrayContaining([
        expect.objectContaining({
          kind: "navigator-wreck",
          sourceId: 1,
          value: PROSPERITY_SCORE_SCHEDULE_V1.navigatorWreck.confirmedReport,
        }),
      ]),
    });
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.prosperityScoreSnapshot).toBe(afterReport);
  });

  it("resets score and revision when the world regenerates", () => {
    const simulation = new GameSimulation(makeConfig());
    const previousSeed = simulation.generated.seed;
    const { target, finalValue } = returnFishingSurvey(simulation);
    expect(simulation.prosperityScoreSnapshot).toMatchObject({
      revision: 1,
      ledger: expect.arrayContaining([expect.objectContaining({
        kind: "fishing-shoal",
        sourceId: target.id,
        value: finalValue,
      })]),
    });

    simulation.regenerate(previousSeed + 1);

    expect(simulation.generated.seed).toBe(previousSeed + 1);
    expect(simulation.prosperityScoreSnapshot).toEqual({
      contractVersion: 1,
      scheduleVersion: 1,
      score: 0,
      revision: 0,
      ledger: [],
    });
    expect(simulation.generation).toBe(1);
    expect(simulation.currentExpeditionId).toBe(1);
  });
});
