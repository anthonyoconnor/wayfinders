import { describe, expect, it, vi } from "vitest";
import { makeConfig } from "./helpers.ts";
import { IndexedDbSaveStore } from "../src/wayfinders/persistence/IndexedDbSaveStore.ts";
import { createFishingShoalId } from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import {
  NavigatorLineageSystem,
  type NavigatorVoyageAchievementInputV1,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";
import {
  SAVE_SCHEMA_VERSION,
  WORLD_GENERATOR_VERSION,
  SaveValidationError,
  UnsupportedFishingShoalContentVersionError,
  UnsupportedSaveSchemaVersionError,
  UnsupportedWorldGeneratorVersionError,
  applyGenerationConfig,
  captureGenerationConfig,
  decodeKnowledgeRuns,
  encodeKnowledgeRuns,
  encodeWorldKnowledgeRuns,
  isSaveGame,
  loadExactSaveSlot,
  parseSaveGame,
  validateKnowledgeRuns,
  type SaveGame,
} from "../src/wayfinders/persistence/SaveGame.ts";
import { KnowledgeState } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";

function makeLineage(generation: number, pendingWreckId?: number) {
  const lineage = new NavigatorLineageSystem();
  for (let currentGeneration = 1; currentGeneration < generation; currentGeneration++) {
    const wreck = lineage.beginSuccession("wreck", currentGeneration);
    lineage.completeSuccession(wreck.transition.key);
  }
  if (pendingWreckId !== undefined) lineage.beginSuccession("wreck", pendingWreckId);
  return lineage.snapshot();
}

function makeVoyage(
  expeditionId: number,
  overrides: Partial<NavigatorVoyageAchievementInputV1> = {},
): NavigatorVoyageAchievementInputV1 {
  return {
    expeditionId,
    supportedTileCount: 0,
    closedUnknownTileCount: 0,
    discoveryIds: [],
    fishingLeadIds: [],
    fishingSurveyIds: [],
    wreckIds: [],
    ...overrides,
  };
}

function makeValidLineage() {
  const lineage = new NavigatorLineageSystem();
  lineage.completeSuccessfulVoyage(makeVoyage(1));
  lineage.completeSuccessfulVoyage(makeVoyage(2, { discoveryIds: [1] }));
  const wreck = lineage.beginSuccession("wreck", 1);
  lineage.completeSuccession(wreck.transition.key);
  return lineage.snapshot();
}

function makePendingValidLineage(wreckId: number) {
  const lineage = new NavigatorLineageSystem();
  lineage.completeSuccessfulVoyage(makeVoyage(1));
  lineage.completeSuccessfulVoyage(makeVoyage(2, { discoveryIds: [1] }));
  lineage.beginSuccession("wreck", wreckId);
  return lineage.snapshot();
}

function addSuccessfulVoyage(
  save: SaveGame,
  overrides: Partial<NavigatorVoyageAchievementInputV1> = {},
): number {
  const expeditionId = save.expedition.id;
  const lineage = NavigatorLineageSystem.fromSnapshot(save.navigatorLineage);
  lineage.completeSuccessfulVoyage(makeVoyage(expeditionId, overrides));
  save.navigatorLineage = lineage.snapshot();
  save.expedition.id = expeditionId === 0xffff_ffff ? 1 : expeditionId + 1;
  return expeditionId;
}

function makeValidSave(): SaveGame {
  const config = makeConfig();
  const tileX = 53;
  const tileY = 48;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: 123_456,
    world: {
      seed: config.world.seed,
      generatorVersion: WORLD_GENERATOR_VERSION,
      generationConfig: captureGenerationConfig(config),
      contentVersions: { fishingShoals: 1 },
    },
    generation: 2,
    expedition: {
      id: 4,
      active: false,
      pendingRespawn: null,
      pendingGenerationHandover: null,
    },
    ship: {
      worldX: (tileX + 0.5) * config.navigation.tileSize,
      worldY: (tileY + 0.5) * config.navigation.tileSize,
      heading: 90,
      speed: 0,
      currentTileX: tileX,
      currentTileY: tileY,
      provisions: 8,
      provisionAccumulator: 0.375,
    },
    knowledge: {
      encoding: "non-unknown-runs-v1",
      runs: [[0, 3, KnowledgeState.Supported, 0]],
    },
    wrecks: [{
      id: 1,
      generation: 1,
      expeditionId: 3,
      worldX: 10.5 * config.navigation.tileSize,
      worldY: 20.5 * config.navigation.tileSize,
      tileX: 10,
      tileY: 20,
      heading: 180,
      discovered: true,
      survey: { state: "unexamined" },
    }],
    discoveries: {
      provisional: [],
      returned: [{
        id: 1,
        type: 0,
        tileX: 20,
        tileY: 20,
        islandId: 1,
        expeditionId: 2,
        generation: 1,
        returned: true,
        name: "Windward Isle",
        rewardId: "island-chart",
        rewardLabel: "new island chart",
        detail: "A newly named island.",
      }],
    },
    fishingShoals: { provisional: [], returned: [] },
    navigatorLineage: makeValidLineage(),
    terrainPatches: [],
  };
}

function makeValidatedSlotStore(value: unknown, removalError?: unknown) {
  const remove = vi.fn(async () => {
    if (removalError !== undefined) throw removalError;
  });
  return {
    remove,
    store: {
      async loadAndDeleteRejected<TResult>(validate: (stored: unknown) => TResult) {
        if (value === undefined) return { status: "empty" as const };
        try {
          return { status: "loaded" as const, value: validate(value) };
        } catch (error) {
          try {
            await remove();
            return { status: "discarded" as const, error, removed: true };
          } catch (caughtRemovalError) {
            return {
              status: "discarded" as const,
              error,
              removed: false,
              removalError: caughtRemovalError,
            };
          }
        }
      },
    },
  };
}

describe("knowledge save encoding", () => {
  it("round-trips canonical non-Unknown runs and expedition stamps", () => {
    const states = new Uint8Array([
      KnowledgeState.Unknown,
      KnowledgeState.Supported,
      KnowledgeState.Supported,
      KnowledgeState.Unknown,
      KnowledgeState.Personal,
      KnowledgeState.Personal,
      KnowledgeState.Personal,
      KnowledgeState.Supported,
    ]);
    const stamps = new Uint32Array([0, 0, 0, 0, 7, 7, 8, 0]);

    const runs = encodeKnowledgeRuns(states.length, (index) => ({
      state: states[index] as KnowledgeState,
      expeditionStamp: stamps[index],
    }));

    expect(runs).toEqual([
      [1, 2, KnowledgeState.Supported, 0],
      [4, 2, KnowledgeState.Personal, 7],
      [6, 1, KnowledgeState.Personal, 8],
      [7, 1, KnowledgeState.Supported, 0],
    ]);
    const decoded = decodeKnowledgeRuns(states.length, runs);
    expect([...decoded.knowledge]).toEqual([...states]);
    expect([...decoded.expeditionStamps]).toEqual([...stamps]);
  });

  it("rejects invalid stamps, overlaps, out-of-bounds runs, and non-canonical adjacency", () => {
    expect(() => encodeKnowledgeRuns(1, () => ({
      state: KnowledgeState.Personal,
      expeditionStamp: 0,
    }))).toThrow(SaveValidationError);
    expect(() => validateKnowledgeRuns(8, [
      [1, 3, KnowledgeState.Supported, 0],
      [3, 1, KnowledgeState.Personal, 2],
    ])).toThrow(/overlaps/);
    expect(() => validateKnowledgeRuns(8, [[7, 2, KnowledgeState.Supported, 0]])).toThrow(/beyond/);
    expect(() => validateKnowledgeRuns(8, [
      [1, 1, KnowledgeState.Supported, 0],
      [2, 1, KnowledgeState.Supported, 0],
    ])).toThrow(/merged/);
  });

  it("bulk-replaces validated knowledge with one invalidation per affected chunk", () => {
    const world = new WorldGrid(5, 3, 2);
    world.fill(0, KnowledgeState.Unknown);
    const knowledge = new Uint8Array(world.tileCount);
    const stamps = new Uint32Array(world.tileCount);
    knowledge[0] = KnowledgeState.Supported;
    knowledge[4] = KnowledgeState.Personal;
    stamps[4] = 7;
    const beforeVersion = world.knowledgeVersion;
    const beforeChunkRevisions = world.getLoadedChunks().map((chunk) => chunk.revision);

    expect(world.replaceKnowledge(knowledge, stamps)).toBe(true);
    expect(world.knowledgeVersion).toBe(beforeVersion + 1);
    expect(world.getKnowledgeAtIndex(0)).toBe(KnowledgeState.Supported);
    expect(world.getKnowledgeAtIndex(4)).toBe(KnowledgeState.Personal);
    expect(world.getExpeditionStampAtIndex(4)).toBe(7);
    expect(world.getKnowledgeCount(KnowledgeState.Unknown)).toBe(world.tileCount - 2);
    world.getLoadedChunks().forEach((chunk, index) => {
      expect(chunk.revision - beforeChunkRevisions[index]).toBeLessThanOrEqual(1);
    });

    expect(world.replaceKnowledge(knowledge, stamps)).toBe(false);
    expect(world.knowledgeVersion).toBe(beforeVersion + 1);

    const invalid = knowledge.slice();
    const invalidStamps = stamps.slice();
    invalidStamps[0] = 2;
    expect(() => world.replaceKnowledge(invalid, invalidStamps)).toThrow(/Invalid expedition stamp/);
    expect(world.getKnowledgeAtIndex(0)).toBe(KnowledgeState.Supported);
  });

  it("encodes sparse chunks in canonical world-index order", () => {
    const world = new WorldGrid(5, 3, 2);
    expect(encodeWorldKnowledgeRuns(world)).toEqual([]);
    world.setKnowledge(4, 2, KnowledgeState.Personal, 9);
    world.setKnowledge(0, 0, KnowledgeState.Supported, 0);
    world.setKnowledge(1, 0, KnowledgeState.Supported, 0);
    expect(encodeWorldKnowledgeRuns(world)).toEqual([
      [0, 2, KnowledgeState.Supported, 0],
      [14, 1, KnowledgeState.Personal, 9],
    ]);
  });
});

describe("save-game validation", () => {
  it("accepts a complete current-schema save and reconstructs its generation config", () => {
    const save = makeValidSave();
    expect(parseSaveGame(save)).toBe(save);
    expect(isSaveGame(save)).toBe(true);

    const config = applyGenerationConfig(save.world.generationConfig, save.world.seed);
    expect(config.world.seed).toBe(save.world.seed);
    expect(config.world.width).toBe(save.world.generationConfig.world.width);
    expect(config.islands).toEqual(save.world.generationConfig.islands);
  });

  it("accepts active-expedition Personal knowledge and provisional discoveries", () => {
    const save = makeValidSave();
    save.expedition.active = true;
    save.knowledge.runs.push([10, 2, KnowledgeState.Personal, save.expedition.id]);
    save.discoveries.provisional.push({
      id: 2,
      type: 6,
      tileX: 30,
      tileY: 31,
      islandId: 2,
      expeditionId: save.expedition.id,
      generation: 2,
      returned: false,
      name: "Salt Reach",
      rewardId: "resource-salt",
      rewardLabel: "salt source",
      detail: "A dependable source of salt.",
    });
    expect(parseSaveGame(save)).toBe(save);
  });

  it("validates current fishing-shoal records against the one-case active expedition", () => {
    const save = makeValidSave();
    save.expedition.active = true;
    save.fishingShoals.provisional.push({
      id: createFishingShoalId(0),
      state: "sighted",
      expeditionId: save.expedition.id,
      generation: save.generation,
    });
    expect(parseSaveGame(save)).toBe(save);

    const inactive = structuredClone(save);
    inactive.expedition.active = false;
    expect(() => parseSaveGame(inactive)).toThrow(/requires an active expedition/);

    const stale = structuredClone(save);
    stale.fishingShoals.provisional[0].expeditionId++;
    expect(() => parseSaveGame(stale)).toThrow(/active expedition/);

    const surveyed = structuredClone(save);
    surveyed.fishingShoals.provisional[0].state = "surveyed";
    expect(parseSaveGame(surveyed)).toBe(surveyed);

    const duplicateCaseUse = structuredClone(surveyed);
    duplicateCaseUse.fishingShoals.provisional.push({
      ...duplicateCaseUse.fishingShoals.provisional[0],
      id: createFishingShoalId(1),
    });
    expect(() => parseSaveGame(duplicateCaseUse)).toThrow(/one-case allocation/);

    const wrongState = structuredClone(save) as unknown as {
      fishingShoals: { provisional: Array<{ state: string }> };
    };
    wrongState.fishingShoals.provisional[0].state = "returned";
    expect(() => parseSaveGame(wrongState)).toThrow(/sighted or surveyed/);
  });

  it("validates provisional and returned wreck-survey provenance", () => {
    const provisional = makeValidSave();
    provisional.expedition.active = true;
    provisional.wrecks[0].survey = {
      state: "provisional",
      expeditionId: provisional.expedition.id,
      generation: provisional.generation,
    };
    expect(parseSaveGame(provisional)).toBe(provisional);

    const returned = makeValidSave();
    const returnExpeditionId = addSuccessfulVoyage(returned, { wreckIds: [1] });
    returned.wrecks[0].survey = {
      state: "returned",
      expeditionId: returnExpeditionId,
      generation: returned.generation,
    };
    expect(parseSaveGame(returned)).toBe(returned);

    const noCompletedSurveyVoyage = structuredClone(returned);
    const current = noCompletedSurveyVoyage.navigatorLineage.navigators[1] as {
      completedVoyages: number;
      successfulVoyages: unknown[];
    };
    current.completedVoyages = 0;
    current.successfulVoyages = [];
    noCompletedSurveyVoyage.expedition.id = returnExpeditionId;
    expect(() => parseSaveGame(noCompletedSurveyVoyage)).toThrow(/credited|completed voyage/);

    const undiscovered = structuredClone(provisional);
    undiscovered.wrecks[0].discovered = false;
    expect(() => parseSaveGame(undiscovered)).toThrow(/wreck to be discovered/);

    const inactive = structuredClone(provisional);
    inactive.expedition.active = false;
    expect(() => parseSaveGame(inactive)).toThrow(/requires an active expedition/);

    const staleExpedition = structuredClone(provisional);
    if (staleExpedition.wrecks[0].survey.state !== "provisional") throw new Error("Expected provisional survey");
    staleExpedition.wrecks[0].survey.expeditionId++;
    expect(() => parseSaveGame(staleExpedition)).toThrow(/active expedition/);

    const lostNavigatorGeneration = structuredClone(provisional);
    if (lostNavigatorGeneration.wrecks[0].survey.state !== "provisional") {
      throw new Error("Expected provisional survey");
    }
    lostNavigatorGeneration.wrecks[0].survey.generation = lostNavigatorGeneration.wrecks[0].generation;
    expect(() => parseSaveGame(lostNavigatorGeneration)).toThrow(/later generation/);

    const futureReturn = structuredClone(returned);
    if (futureReturn.wrecks[0].survey.state !== "returned") throw new Error("Expected returned survey");
    futureReturn.wrecks[0].survey.generation = futureReturn.generation + 1;
    expect(() => parseSaveGame(futureReturn)).toThrow(/later than the current generation/);

    const unsupportedState = structuredClone(returned) as unknown as {
      wrecks: Array<{ survey: { state: string } }>;
    };
    unsupportedState.wrecks[0].survey.state = "surveyed";
    expect(() => parseSaveGame(unsupportedState)).toThrow(/unexamined, provisional or returned/);

    const missingSurvey = structuredClone(returned) as unknown as {
      wrecks: Array<{ survey?: unknown }>;
    };
    delete missingSurvey.wrecks[0].survey;
    expect(() => parseSaveGame(missingSurvey)).toThrow(/save\.wrecks\[0\]\.survey/);
  });

  it("validates the persisted generation-handover gate against lineage authority", () => {
    const save = makeValidSave();
    save.ship.provisions = 12;
    save.ship.provisionAccumulator = 0;
    const source = save.navigatorLineage.navigators[0];
    const successor = save.navigatorLineage.navigators[1];
    save.expedition.pendingGenerationHandover = {
      contractVersion: 1,
      fromNavigatorId: source.id,
      fromGeneration: source.generation,
      nextNavigatorId: successor.id,
      nextGeneration: successor.generation,
      reason: "wreck",
    };
    expect(parseSaveGame(save)).toBe(save);

    const wrongReason = structuredClone(save);
    if (!wrongReason.expedition.pendingGenerationHandover) throw new Error("Expected a generation handover");
    wrongReason.expedition.pendingGenerationHandover.reason = "tenure";
    expect(() => parseSaveGame(wrongReason)).toThrow(/terminal navigator/);

    const activeExpedition = structuredClone(save);
    activeExpedition.expedition.active = true;
    expect(() => parseSaveGame(activeExpedition)).toThrow(/active expedition/);

    const wrongSuccessor = structuredClone(save);
    if (!wrongSuccessor.expedition.pendingGenerationHandover) throw new Error("Expected a generation handover");
    wrongSuccessor.expedition.pendingGenerationHandover.nextNavigatorId = source.id;
    expect(() => parseSaveGame(wrongSuccessor)).toThrow(/next generation|active successor/);

    const remoteShip = structuredClone(save);
    remoteShip.ship.currentTileX--;
    remoteShip.ship.worldX -= remoteShip.world.generationConfig.navigation.tileSize;
    expect(() => parseSaveGame(remoteShip)).toThrow(/home dock/);

    const movingShip = structuredClone(save);
    movingShip.ship.speed = 1;
    expect(() => parseSaveGame(movingShip)).toThrow(/stopped/);

    const chargedShip = structuredClone(save);
    chargedShip.ship.provisionAccumulator = 0.25;
    expect(() => parseSaveGame(chargedShip)).toThrow(/fractional provision/);
  });

  it("enforces one provisional wreck survey and one shared survey-case allocation", () => {
    const duplicateWreckSurvey = makeValidSave();
    duplicateWreckSurvey.generation = 3;
    duplicateWreckSurvey.expedition.active = true;
    duplicateWreckSurvey.navigatorLineage = makeLineage(3);
    duplicateWreckSurvey.wrecks[0].survey = {
      state: "provisional",
      expeditionId: duplicateWreckSurvey.expedition.id,
      generation: duplicateWreckSurvey.generation,
    };
    duplicateWreckSurvey.wrecks.push({
      ...duplicateWreckSurvey.wrecks[0],
      id: 2,
      generation: 2,
      survey: {
        state: "provisional",
        expeditionId: duplicateWreckSurvey.expedition.id,
        generation: duplicateWreckSurvey.generation,
      },
    });
    expect(() => parseSaveGame(duplicateWreckSurvey)).toThrow(/one-case allocation/);

    const sharedCase = makeValidSave();
    sharedCase.expedition.active = true;
    sharedCase.wrecks[0].survey = {
      state: "provisional",
      expeditionId: sharedCase.expedition.id,
      generation: sharedCase.generation,
    };
    sharedCase.fishingShoals.provisional.push({
      id: createFishingShoalId(0),
      state: "surveyed",
      expeditionId: sharedCase.expedition.id,
      generation: sharedCase.generation,
    });
    expect(() => parseSaveGame(sharedCase)).toThrow(/one-case allocation/);

    const duplicateReturnedCase = makeValidSave();
    const duplicateCaseExpeditionId = addSuccessfulVoyage(duplicateReturnedCase, {
      fishingSurveyIds: [createFishingShoalId(0)],
    });
    duplicateReturnedCase.navigatorLineage = structuredClone(duplicateReturnedCase.navigatorLineage);
    const duplicateVoyage = duplicateReturnedCase.navigatorLineage.navigators[1]
      .successfulVoyages[0] as { wreckIds: number[] };
    duplicateVoyage.wreckIds = [1];
    duplicateReturnedCase.wrecks[0].survey = {
      state: "returned",
      expeditionId: duplicateCaseExpeditionId,
      generation: 2,
    };
    duplicateReturnedCase.fishingShoals.returned.push({
      id: createFishingShoalId(0),
      state: "survey",
      expeditionId: duplicateCaseExpeditionId,
      generation: 2,
    });
    expect(() => parseSaveGame(duplicateReturnedCase)).toThrow(/one survey case/);

    const futureReturnedCase = makeValidSave();
    const wreckReportExpeditionId = addSuccessfulVoyage(futureReturnedCase, { wreckIds: [1] });
    futureReturnedCase.wrecks[0].survey = {
      state: "returned",
      expeditionId: wreckReportExpeditionId + 1,
      generation: 2,
    };
    expect(() => parseSaveGame(futureReturnedCase)).toThrow(/this navigator and voyage|completed voyage/);
  });

  it("permits only the returned-lead plus provisional-survey upgrade overlap", () => {
    const returned = makeValidSave();
    const fishingShoalId = createFishingShoalId(0);
    returned.navigatorLineage = structuredClone(returned.navigatorLineage);
    const leadVoyage = returned.navigatorLineage.navigators[0]
      .successfulVoyages[1] as { fishingLeadIds: string[] };
    leadVoyage.fishingLeadIds = [fishingShoalId];
    returned.fishingShoals.returned.push({
      id: fishingShoalId,
      state: "lead",
      expeditionId: 2,
      generation: 1,
    });
    expect(parseSaveGame(returned)).toBe(returned);
    const terminal = structuredClone(returned);
    terminal.fishingShoals.returned[0].state = "survey";
    terminal.fishingShoals.returned[0].generation = 2;
    const terminalExpeditionId = addSuccessfulVoyage(terminal, {
      fishingSurveyIds: [terminal.fishingShoals.returned[0].id],
    });
    terminal.fishingShoals.returned[0].expeditionId = terminalExpeditionId;
    expect(parseSaveGame(terminal)).toBe(terminal);

    const leadAfterSurvey = structuredClone(terminal);
    const priorLead = leadAfterSurvey.navigatorLineage.navigators[0]
      .successfulVoyages[1] as { fishingLeadIds: string[] };
    priorLead.fishingLeadIds = [];
    addSuccessfulVoyage(leadAfterSurvey, { fishingLeadIds: [fishingShoalId] });
    expect(() => parseSaveGame(leadAfterSurvey)).toThrow(/precede the returned fishing survey/);

    const upgrade = structuredClone(returned);
    upgrade.expedition.active = true;
    upgrade.fishingShoals.provisional.push({
      id: createFishingShoalId(0),
      state: "surveyed",
      expeditionId: upgrade.expedition.id,
      generation: upgrade.generation,
    });
    expect(parseSaveGame(upgrade)).toBe(upgrade);

    const terminalOverlap = structuredClone(upgrade);
    terminalOverlap.fishingShoals.returned[0].state = "survey";
    expect(() => parseSaveGame(terminalOverlap)).toThrow(/returned lead with a provisional survey/);

    const sightedOverlap = structuredClone(upgrade);
    sightedOverlap.fishingShoals.provisional[0].state = "sighted";
    expect(() => parseSaveGame(sightedOverlap)).toThrow(/returned lead with a provisional survey/);

    const futureReturn = structuredClone(returned);
    futureReturn.fishingShoals.returned[0].generation = futureReturn.generation + 1;
    expect(() => parseSaveGame(futureReturn)).toThrow(/later than the current generation/);

    const duplicateReturn = structuredClone(returned);
    duplicateReturn.fishingShoals.returned.push({ ...duplicateReturn.fishingShoals.returned[0] });
    expect(() => parseSaveGame(duplicateReturn)).toThrow(/uniquely sorted/);
  });

  it("accepts a coherent pending-wreck hold", () => {
    const save = makeValidSave();
    const wreck = save.wrecks[0];
    save.generation = wreck.generation;
    save.expedition.id = wreck.expeditionId;
    save.expedition.pendingRespawn = {
      expeditionId: wreck.expeditionId,
      generation: wreck.generation,
      forgottenTiles: 12,
      wreckId: wreck.id,
      remainingSeconds: 3.999,
    };
    save.navigatorLineage = makePendingValidLineage(wreck.id);
    Object.assign(save.ship, {
      worldX: wreck.worldX,
      worldY: wreck.worldY,
      currentTileX: wreck.tileX,
      currentTileY: wreck.tileY,
      provisions: 0,
      provisionAccumulator: 0,
    });
    expect(parseSaveGame(save)).toBe(save);
  });

  it("rejects moving or partially charged ships during a wreck hold", () => {
    const makePendingSave = (): SaveGame => {
      const save = makeValidSave();
      const wreck = save.wrecks[0];
      save.generation = wreck.generation;
      save.expedition.id = wreck.expeditionId;
      save.expedition.pendingRespawn = {
        expeditionId: wreck.expeditionId,
        generation: wreck.generation,
        forgottenTiles: 12,
        wreckId: wreck.id,
        remainingSeconds: 2,
      };
      save.navigatorLineage = makePendingValidLineage(wreck.id);
      Object.assign(save.ship, {
        worldX: wreck.worldX,
        worldY: wreck.worldY,
        currentTileX: wreck.tileX,
        currentTileY: wreck.tileY,
        provisions: 0,
        provisionAccumulator: 0,
        speed: 0,
      });
      return save;
    };

    const moving = makePendingSave();
    moving.ship.speed = 1;
    expect(() => parseSaveGame(moving)).toThrow(/stopped/);

    const partiallyCharged = makePendingSave();
    partiallyCharged.ship.provisionAccumulator = 0.5;
    expect(() => parseSaveGame(partiallyCharged)).toThrow(/fractional provision/);
  });

  it("requires exact schema and format versions and rejects corrupt current data", () => {
    for (const version of [SAVE_SCHEMA_VERSION - 1, SAVE_SCHEMA_VERSION + 1]) {
      const mismatchedSchema = makeValidSave() as SaveGame & { schemaVersion: number };
      mismatchedSchema.schemaVersion = version;
      expect(() => parseSaveGame(mismatchedSchema)).toThrow(UnsupportedSaveSchemaVersionError);
      expect(isSaveGame(mismatchedSchema)).toBe(false);
    }

    const futureGenerator = makeValidSave() as SaveGame & { world: { generatorVersion: number } };
    futureGenerator.world.generatorVersion = 2;
    expect(() => parseSaveGame(futureGenerator)).toThrow(UnsupportedWorldGeneratorVersionError);

    const futureContent = makeValidSave() as unknown as {
      world: { contentVersions: { fishingShoals: number } };
    };
    futureContent.world.contentVersions.fishingShoals = 2;
    expect(() => parseSaveGame(futureContent)).toThrow(UnsupportedFishingShoalContentVersionError);

    const oldLineageContract = structuredClone(makeValidSave()) as unknown as {
      navigatorLineage: { contractVersion: number };
    };
    oldLineageContract.navigatorLineage.contractVersion = 1;
    expect(() => parseSaveGame(oldLineageContract)).toThrow(SaveValidationError);

    const corrupt = makeValidSave();
    corrupt.ship.currentTileX = -1;
    expect(() => parseSaveGame(corrupt)).toThrow(SaveValidationError);
    expect(isSaveGame(corrupt)).toBe(false);
  });

  it("loads only an exact current save and deletes every rejected slot", async () => {
    const currentSave = makeValidSave();
    const currentSlot = makeValidatedSlotStore(currentSave);
    await expect(loadExactSaveSlot(currentSlot.store)).resolves.toEqual({
      status: "loaded",
      save: currentSave,
    });
    expect(currentSlot.remove).not.toHaveBeenCalled();

    const oldSave = makeValidSave() as SaveGame & { schemaVersion: number };
    oldSave.schemaVersion = SAVE_SCHEMA_VERSION - 1;
    const oldSlot = makeValidatedSlotStore(oldSave);
    const result = await loadExactSaveSlot(oldSlot.store);
    expect(result).toMatchObject({ status: "discarded", removed: true });
    expect(oldSlot.remove).toHaveBeenCalledOnce();
  });

  it("reports when a rejected slot cannot be removed", async () => {
    const corrupt = makeValidSave();
    corrupt.ship.currentTileX = -1;
    const removalError = new Error("storage failed");
    const slot = makeValidatedSlotStore(corrupt, removalError);

    const result = await loadExactSaveSlot(slot.store);
    expect(result).toMatchObject({
      status: "discarded",
      removed: false,
      removalError,
    });
    expect(slot.remove).toHaveBeenCalledOnce();
  });

  it("rejects lifecycle, discovery, and terrain-patch inconsistencies", () => {
    const wrongCurrentExpedition = makeValidSave();
    wrongCurrentExpedition.expedition.id = 5;
    expect(() => parseSaveGame(wrongCurrentExpedition)).toThrow(
      /lineage chronology with expedition 4/,
    );

    const wrongFatalExpedition = makeValidSave();
    wrongFatalExpedition.wrecks[0].expeditionId = 2;
    expect(() => parseSaveGame(wrongFatalExpedition)).toThrow(/fatal expedition 3/);

    const inactivePersonal = makeValidSave();
    inactivePersonal.knowledge.runs.push([10, 1, KnowledgeState.Personal, 4]);
    expect(() => parseSaveGame(inactivePersonal)).toThrow(/without an active expedition/);

    const duplicateDiscovery = makeValidSave();
    duplicateDiscovery.discoveries.provisional.push({
      ...duplicateDiscovery.discoveries.returned[0],
      expeditionId: duplicateDiscovery.expedition.id,
      generation: duplicateDiscovery.generation,
      returned: false,
    });
    duplicateDiscovery.expedition.active = true;
    expect(() => parseSaveGame(duplicateDiscovery)).toThrow(/duplicate discovery id/);

    const terrainMutation = makeValidSave() as SaveGame & { terrainPatches: unknown[] };
    terrainMutation.terrainPatches.push({ tileX: 1 });
    expect(() => parseSaveGame(terrainMutation)).toThrow(/empty array/);

    const incompleteDiscovery = structuredClone(makeValidSave()) as SaveGame & {
      discoveries: { returned: Array<Record<string, unknown>> };
    };
    delete incompleteDiscovery.discoveries.returned[0].expeditionId;
    expect(() => parseSaveGame(incompleteDiscovery)).toThrow(/expeditionId/);

    const futureWreck = makeValidSave();
    futureWreck.wrecks[0].generation = futureWreck.generation + 1;
    expect(() => parseSaveGame(futureWreck)).toThrow(/later than the current generation/);
  });
});

describe("IndexedDbSaveStore", () => {
  it("validates and deletes even a stored undefined slot in one readwrite transaction", async () => {
    const countRequest = { result: 1 } as IDBRequest<number>;
    const getRequest = { result: undefined } as IDBRequest<unknown>;
    const objectStore = {
      count: vi.fn(() => countRequest),
      get: vi.fn(() => getRequest),
      delete: vi.fn(() => ({} as IDBRequest<undefined>)),
    } as unknown as IDBObjectStore;
    const transaction = {
      objectStore: vi.fn(() => objectStore),
    } as unknown as IDBTransaction;
    const database = {
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
      transaction: vi.fn(() => transaction),
    } as unknown as IDBDatabase;
    const openRequest = { result: database } as IDBOpenDBRequest;
    const indexedDB = { open: vi.fn(() => openRequest) } as unknown as IDBFactory;
    const store = new IndexedDbSaveStore({ indexedDB });
    const rejection = new Error("wrong version");

    const operation = store.loadAndDeleteRejected(() => {
      throw rejection;
    });
    openRequest.onsuccess?.call(openRequest, {} as Event);
    await Promise.resolve();
    expect(database.transaction).toHaveBeenCalledWith("saveGames", "readwrite");
    countRequest.onsuccess?.call(countRequest, {} as Event);
    await Promise.resolve();
    getRequest.onsuccess?.call(getRequest, {} as Event);
    await Promise.resolve();
    expect(objectStore.delete).toHaveBeenCalledWith("autosave");
    transaction.oncomplete?.call(transaction, {} as Event);

    await expect(operation).resolves.toEqual({
      status: "discarded",
      error: rejection,
      removed: true,
    });
  });

  it("reports unavailable browser storage without failing synchronously", async () => {
    const store = new IndexedDbSaveStore({ indexedDB: undefined });
    await expect(store.load()).rejects.toThrow(/IndexedDB is unavailable/);
  });

  it("closes a late connection after a blocked open has already failed", async () => {
    const database = {
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
    } as unknown as IDBDatabase;
    const request = { result: database } as IDBOpenDBRequest;
    const indexedDB = { open: vi.fn(() => request) } as unknown as IDBFactory;
    const store = new IndexedDbSaveStore({ indexedDB });

    const load = store.load();
    request.onblocked?.call(request, {} as IDBVersionChangeEvent);
    await expect(load).rejects.toThrow(/blocked/);
    request.onsuccess?.call(request, {} as Event);
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("rejects and closes a connection that lacks the configured object store", async () => {
    const database = {
      close: vi.fn(),
      objectStoreNames: { contains: () => false },
    } as unknown as IDBDatabase;
    const request = { result: database } as IDBOpenDBRequest;
    const indexedDB = { open: vi.fn(() => request) } as unknown as IDBFactory;
    const store = new IndexedDbSaveStore({ indexedDB, objectStoreName: "missing" });

    const load = store.load();
    request.onsuccess?.call(request, {} as Event);
    await expect(load).rejects.toThrow(/object store missing is missing/);
    expect(database.close).toHaveBeenCalledOnce();
  });
});
