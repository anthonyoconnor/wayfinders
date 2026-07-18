import { describe, expect, it } from "vitest";

import { makeConfig, drainForwardGuidance } from "./helpers";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import { SimulationClock } from "../src/wayfinders/core/SimulationClock";
import type { GameEventMap, GameEventName } from "../src/wayfinders/core/GameEvents";
import type { GridPoint } from "../src/wayfinders/core/types";
import {
  ISLAND_DOSSIER_CONTRACT_VERSION,
} from "../src/wayfinders/exploration/IslandDossierContracts";
import type { IdolLocationDefinition } from "../src/wayfinders/exploration/IdolLocationContracts";
import {
  SURVEY_SITE_CONTRACT_VERSION,
} from "../src/wayfinders/exploration/SurveySiteContracts";
import { TerrainType } from "../src/wayfinders/world/TileData";
import { serializeWorldManifestV2 } from "../src/wayfinders/world/manifest";

const FIXED_STEP_MS = 50;
const CARDINAL_SPEED_TILES_PER_SECOND = 5;

const CAPTURED_EVENTS = [
  "shipEnteredTile",
  "knowledgeChanged",
  "provisionConsumed",
  "provisionsChanged",
  "shipReplenished",
  "returnStateChanged",
  "expeditionStarted",
  "navigatorTenureCompleted",
  "expeditionReturned",
  "shipWrecked",
  "generationAdvanced",
  "wreckDiscovered",
  "wreckSurveyed",
  "wreckSurveysReturned",
  "wreckSurveysLost",
  "islandSighted",
  "islandDossierSurveyed",
  "islandDossiersReturned",
  "islandDossiersLost",
  "idolLocationDiscovered",
  "idolLocationsReturned",
  "idolLocationsLost",
  "surveySiteSighted",
  "surveySiteSurveyed",
  "surveySitesReturned",
  "surveySitesLost",
  "fishingShoalSighted",
  "fishingShoalSurveyed",
  "fishingShoalsReturned",
  "fishingShoalsLost",
  "expeditionFailed",
  "gameCompleted",
  "completedWorldContinued",
  "worldRegenerated",
  "shipTeleported",
] as const satisfies readonly GameEventName[];

interface CapturedEvent {
  readonly name: GameEventName;
  readonly payload: GameEventMap[GameEventName];
}

interface JourneySpec {
  readonly label: string;
  readonly heading: number;
  readonly start: Readonly<GridPoint>;
  readonly diagonal: boolean;
  readonly expectedLiftedImages: Readonly<GridPoint>;
}

const JOURNEYS = [
  { label: "east", heading: 0, start: { x: 1, y: 2 }, diagonal: false, expectedLiftedImages: { x: 1, y: 0 } },
  { label: "west", heading: 180, start: { x: 1, y: 2 }, diagonal: false, expectedLiftedImages: { x: -1, y: 0 } },
  { label: "south", heading: 90, start: { x: 2, y: 1 }, diagonal: false, expectedLiftedImages: { x: 0, y: 1 } },
  { label: "north", heading: 270, start: { x: 2, y: 1 }, diagonal: false, expectedLiftedImages: { x: 0, y: -1 } },
  { label: "south-east", heading: 45, start: { x: 1, y: 2 }, diagonal: true, expectedLiftedImages: { x: 1, y: 1 } },
  { label: "south-west", heading: 135, start: { x: 1, y: 2 }, diagonal: true, expectedLiftedImages: { x: -1, y: 1 } },
  { label: "north-west", heading: 225, start: { x: 1, y: 2 }, diagonal: true, expectedLiftedImages: { x: -1, y: -1 } },
  { label: "north-east", heading: 315, start: { x: 1, y: 2 }, diagonal: true, expectedLiftedImages: { x: 1, y: -1 } },
] as const satisfies readonly JourneySpec[];

function journeyConfig(diagonal: boolean) {
  return makeConfig({
    navigation: { chunkSize: 8 },
    world: {
      width: 32,
      height: 32,
      supportedWaterRadius: 7,
      supportedBoundaryNoise: 0,
      shallowWaterRadius: 7,
      hiddenObstacleDistance: 8,
      idolCount: 1,
    },
    islands: {
      count: 1,
      minRadius: 2,
      maxRadius: 2,
      minimumChannelWidth: 3,
      homeClearance: 1,
      placementAttempts: 16,
      archipelagoClusters: 0,
      archipelagoRadius: 8,
      archipelagoBias: 0,
      safeCorridorHalfWidth: 1,
    },
    movement: {
      shipSpeed: CARDINAL_SPEED_TILES_PER_SECOND * (diagonal ? Math.SQRT2 : 1),
    },
    provisions: {
      startingBundles: 128,
      personalCost: 0.125,
      unknownCost: 0.25,
    },
    simulation: {
      fixedStepMs: FIXED_STEP_MS,
      maxFrameDeltaMs: FIXED_STEP_MS * 2,
    },
  });
}

function createSimulation(diagonal: boolean): GameSimulation {
  return new GameSimulation(journeyConfig(diagonal), undefined, {
    forwardGuidanceNow: () => 0,
    forwardGuidanceSliceBudgetMs: 1_000,
    forwardGuidanceWorkUnitsPerSlice: 1_000_000,
  });
}

/** Test-only open-ocean fixture; no production injection seam is needed. */
function prepareOpenWorld(simulation: GameSimulation): void {
  const fineCollision: GridPoint[] = [];
  simulation.world.forEachFineCollisionMask((x, y) => fineCollision.push({ x, y }));
  for (const { x, y } of fineCollision) simulation.world.clearFineCollisionMask(x, y);
  simulation.world.forEachTile((x, y) => {
    simulation.world.setTerrain(x, y, TerrainType.DeepOcean);
    simulation.world.setMovementBlocked(x, y, false);
  });
  simulation.world.clearVisibility();
}

function captureEvents(simulation: GameSimulation): {
  readonly events: CapturedEvent[];
  readonly stop: () => void;
} {
  const events: CapturedEvent[] = [];
  const unsubscribes = CAPTURED_EVENTS.map((name) => simulation.events.on(
    name,
    (payload) => events.push({
      name,
      payload: structuredClone(payload) as GameEventMap[GameEventName],
    }),
  ));
  return {
    events,
    stop: () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}

function numericRecordDelta(
  after: Readonly<Record<string, number>>,
  before: Readonly<Record<string, number>>,
): Record<string, number> {
  const cumulative = new Set([
    "requests",
    "jobsStarted",
    "jobsCompleted",
    "jobsCancelled",
    "requestsCoalesced",
    "staleResultsDiscarded",
    "slices",
  ]);
  return Object.fromEntries(Object.keys(after).map((key) => [
    key,
    cumulative.has(key) ? after[key] - before[key] : after[key],
  ]));
}

function captureKnowledge(simulation: GameSimulation): Array<readonly [number, number, number]> {
  const result: Array<readonly [number, number, number]> = [];
  simulation.world.forEachTile((_x, _y, index) => result.push([
    simulation.world.getKnowledgeAtIndex(index),
    simulation.world.getExpeditionStampAtIndex(index),
    simulation.world.isVisibleNowAtIndex(index) ? 1 : 0,
  ]));
  return result;
}

function captureRouteResults(simulation: GameSimulation) {
  return {
    forward: {
      budget: simulation.forwardRange.budget,
      reachableCount: simulation.forwardRange.reachableCount,
      frontierCount: simulation.forwardRange.frontierCount,
      presentationHeading: simulation.forwardRange.presentationHeading,
      mask: [...simulation.forwardRange.mask],
      presentationMask: [...simulation.forwardRange.presentationMask],
      candidateIndices: [...simulation.forwardRange.candidateIndices],
      presentationCandidateIndices: [...simulation.forwardRange.presentationCandidateIndices],
    },
    return: {
      budget: simulation.returnPaths.budget,
      originIndex: simulation.returnPaths.originIndex,
      supportedBoundaryIndices: [...simulation.returnPaths.supportedBoundaryIndices],
      pathIndices: [...simulation.returnPaths.pathIndices],
      pathEdges: structuredClone(simulation.returnPaths.pathEdges),
      corridorIndices: [...simulation.returnPaths.corridorIndices],
      returnCost: simulation.returnPaths.returnCost,
      returnMargin: simulation.returnPaths.returnMargin,
      riskLevel: simulation.returnPaths.riskLevel,
      riskCounts: { ...simulation.returnPaths.riskCounts },
      risk: [...simulation.returnPaths.risk],
    },
  };
}

function surveyIdolHost(
  simulation: GameSimulation,
  location: Readonly<IdolLocationDefinition>,
) {
  const host = location.host;
  if (host.kind === "island-dossier") {
    const definition = simulation.islandDossierDefinitions.find(({ islandId }) => (
      islandId === host.islandId
    ));
    if (!definition) throw new Error(`Missing island host ${host.islandId}`);
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
  if (!definition) throw new Error(`Missing survey-site host ${host.surveySiteId}`);
  expect(simulation.teleport(definition.serviceAnchor)).toBe(true);
  return simulation.interactWithSurveySite({
    contractVersion: SURVEY_SITE_CONTRACT_VERSION,
    type: "survey",
    id: definition.id,
  });
}

function crossEastSeam(simulation: GameSimulation): void {
  const start = { x: simulation.world.width - 1, y: 2 };
  expect(simulation.teleport(start)).toBe(true);
  simulation.ship.heading = 0;
  const movement = simulation.update(
    { turn: 0, throttle: 1 },
    1 / CARDINAL_SPEED_TILES_PER_SECOND,
  );
  expect(movement.collided).toBe(false);
  expect(movement.worldImageOffset).toEqual({ x: simulation.world.topology.pixelWidth, y: 0 });
  expect(simulation.snapshot().tile).toEqual({ x: 0, y: start.y });
}

function sailIntoExactDock(simulation: GameSimulation): void {
  const dock = simulation.generated.landmarks.homeReturnTile;
  const departure = simulation.world.topology.normalizeTile(dock.x + 1, dock.y);
  expect(simulation.teleport(departure)).toBe(true);
  simulation.ship.heading = 180;
  simulation.update(
    { turn: 0, throttle: 1 },
    1 / CARDINAL_SPEED_TILES_PER_SECOND,
  );
  expect(simulation.atDock).toBe(true);
  expect(simulation.snapshot().tile).toEqual(dock);
}

function runJourney(
  simulation: GameSimulation,
  spec: JourneySpec,
  frameDeltaMs: number,
) {
  prepareOpenWorld(simulation);
  const baseline = {
    revision: simulation.revision,
    overlaysRevision: simulation.overlaysRevision,
    lifecycleResolutionRevision: simulation.lifecycleResolutionRevision,
    wrecksRevision: simulation.wrecksRevision,
    knowledgeVersion: simulation.world.knowledgeVersion,
    visibilityVersion: simulation.world.visibilityVersion,
    terrainVersion: simulation.world.terrainVersion,
    collisionVersion: simulation.world.collisionVersion,
    guidance: simulation.forwardGuidanceStatus.telemetry as unknown as Readonly<Record<string, number>>,
  };
  const captured = captureEvents(simulation);
  const lifted = { x: 0, y: 0 };
  try {
    expect(simulation.teleport(spec.start)).toBe(true);
    simulation.ship.heading = spec.heading;
    const clock = new SimulationClock(simulation.config);
    const fixedStepCount = simulation.world.width * 4;
    let completedSteps = 0;
    while (completedSteps < fixedStepCount) {
      completedSteps += clock.advance(frameDeltaMs, (deltaSeconds) => {
        const movement = simulation.update({ turn: 0, throttle: 1 }, deltaSeconds);
        lifted.x += movement.liftedDisplacement.x;
        lifted.y += movement.liftedDisplacement.y;
      });
    }
    expect(completedSteps).toBe(fixedStepCount);
    drainForwardGuidance(simulation);

    const afterGuidance = simulation.forwardGuidanceStatus.telemetry as unknown as Readonly<Record<string, number>>;
    return {
      manifest: serializeWorldManifestV2(simulation.generated.manifest),
      snapshot: simulation.snapshot(),
      knowledge: captureKnowledge(simulation),
      routes: captureRouteResults(simulation),
      events: structuredClone(captured.events),
      diagnostics: {
        revision: simulation.revision - baseline.revision,
        overlaysRevision: simulation.overlaysRevision - baseline.overlaysRevision,
        lifecycleResolutionRevision:
          simulation.lifecycleResolutionRevision - baseline.lifecycleResolutionRevision,
        wrecksRevision: simulation.wrecksRevision - baseline.wrecksRevision,
        knowledgeVersion: simulation.world.knowledgeVersion - baseline.knowledgeVersion,
        visibilityVersion: simulation.world.visibilityVersion - baseline.visibilityVersion,
        terrainVersion: simulation.world.terrainVersion - baseline.terrainVersion,
        collisionVersion: simulation.world.collisionVersion - baseline.collisionVersion,
        guidance: numericRecordDelta(afterGuidance, baseline.guidance),
      },
      lifted,
    };
  } finally {
    captured.stop();
  }
}

describe("GameSimulation periodic journeys", () => {
  it.each(JOURNEYS)(
    "$label circumnavigation is identical across fixed-step frame partitions",
    (spec) => {
      const singleStepFrames = runJourney(createSimulation(spec.diagonal), spec, FIXED_STEP_MS);
      const packedFrames = runJourney(createSimulation(spec.diagonal), spec, FIXED_STEP_MS * 2);

      expect(packedFrames).toEqual(singleStepFrames);
      expect(singleStepFrames.snapshot.tile).toEqual(spec.start);
      expect(singleStepFrames.lifted.x).toBeCloseTo(
        spec.expectedLiftedImages.x * singleStepFrames.snapshot.world.width
          * journeyConfig(spec.diagonal).navigation.tileSize,
        7,
      );
      expect(singleStepFrames.lifted.y).toBeCloseTo(
        spec.expectedLiftedImages.y * singleStepFrames.snapshot.world.height
          * journeyConfig(spec.diagonal).navigation.tileSize,
        7,
      );
      expect(singleStepFrames.events.filter(({ name }) => name === "expeditionStarted")).toHaveLength(1);
      expect(singleStepFrames.snapshot.expedition.active).toBe(true);
    },
    5_000,
  );

  it("replays an identical corner lap after explicit same-seed regeneration", () => {
    const spec = JOURNEYS.find(({ label }) => label === "south-east")!;
    const simulation = createSimulation(true);
    const seed = simulation.generated.seed;
    const first = runJourney(simulation, spec, FIXED_STEP_MS * 2);

    simulation.regenerate(seed);
    const replay = runJourney(simulation, spec, FIXED_STEP_MS * 2);

    expect(replay).toEqual(first);
  }, 5_000);

  it("settles seam discovery, rollback, succession, completion, and Start New Game exactly once", () => {
    const simulation = createSimulation(false);
    prepareOpenWorld(simulation);
    const completedSeed = simulation.generated.seed;
    const idol = simulation.idolLocationDefinitions[0];
    if (!idol) throw new Error("Expected one configured idol location");
    const captured = captureEvents(simulation);

    try {
      crossEastSeam(simulation);
      expect(surveyIdolHost(simulation, idol).status).toBe("surveyed");
      expect(simulation.provisionalIdolLocations.map(({ id }) => id)).toEqual([idol.id]);
      expect(simulation.forceWreck()).toBe(true);
      expect(simulation.provisionalIdolLocations).toEqual([]);
      expect(simulation.returnedIdolLocations).toEqual([]);

      simulation.update(
        { turn: 0, throttle: 0 },
        simulation.config.simulation.wreckPresentationSeconds,
      );
      expect(simulation.generation).toBe(2);
      expect(simulation.pendingGenerationHandover).toMatchObject({ reason: "wreck" });
      expect(simulation.acknowledgeGenerationHandover()).toBe(true);

      crossEastSeam(simulation);
      expect(surveyIdolHost(simulation, idol).status).toBe("surveyed");
      sailIntoExactDock(simulation);

      expect(simulation.completionChoiceActive).toBe(true);
      expect(simulation.returnedIdolLocations.map(({ id }) => id)).toEqual([idol.id]);
      expect(simulation.successfulReturns).toBe(1);
      expect(simulation.navigatorLineage[0]).toMatchObject({
        state: "lost",
        completedVoyages: 0,
      });
      expect(simulation.currentNavigator.successfulVoyages).toHaveLength(1);
      const creditedVoyage = simulation.currentNavigator.successfulVoyages[0];
      if (idol.host.kind === "island-dossier") {
        expect(creditedVoyage.islandDossierIds).toContain(idol.host.islandId);
      } else {
        expect(creditedVoyage.surveySiteReportIds).toContain(idol.host.surveySiteId);
      }

      const newSeed = simulation.startNewGame();
      expect(newSeed).toBeDefined();
      expect(newSeed).not.toBe(completedSeed);
      expect(simulation.generated.seed).toBe(newSeed);
      expect(simulation.generation).toBe(1);
      expect(simulation.successfulReturns).toBe(0);
      expect(simulation.failedExpeditions).toBe(0);
      expect(simulation.wrecks).toEqual([]);
      expect(simulation.returnedIdolLocations).toEqual([]);
      expect(simulation.currentNavigator.successfulVoyages).toEqual([]);
      expect(simulation.atDock).toBe(true);

      const count = (name: GameEventName) => (
        captured.events.filter((event) => event.name === name).length
      );
      expect(count("shipWrecked")).toBe(1);
      expect(count("idolLocationsLost")).toBe(1);
      expect(count("generationAdvanced")).toBe(1);
      expect(count("expeditionFailed")).toBe(1);
      expect(count("expeditionReturned")).toBe(1);
      expect(count("idolLocationsReturned")).toBe(1);
      expect(count("gameCompleted")).toBe(1);
      expect(count("worldRegenerated")).toBe(1);
    } finally {
      captured.stop();
    }
  }, 5_000);
});
