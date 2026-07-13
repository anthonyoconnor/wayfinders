import { describe, expect, it, vi } from "vitest";
import { makeConfig } from "./helpers.ts";
import { IndexedDbSaveStore } from "../src/wayfinders/persistence/IndexedDbSaveStore.ts";
import { createFishingShoalId } from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import {
  SAVE_SCHEMA_VERSION,
  WORLD_GENERATOR_VERSION,
  SaveValidationError,
  UnsupportedFishingShoalContentVersionError,
  UnsupportedSaveSchemaVersionError,
  UnsupportedWorldGeneratorVersionError,
  applyGenerationConfig,
  captureGenerationConfig,
  classifySaveGame,
  decodeKnowledgeRuns,
  encodeKnowledgeRuns,
  encodeWorldKnowledgeRuns,
  isSaveGame,
  parseSaveGame,
  validateKnowledgeRuns,
  type SaveGame,
} from "../src/wayfinders/persistence/SaveGame.ts";
import { KnowledgeState } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";

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
      successfulReturns: 2,
      failedExpeditions: 1,
      pendingRespawn: null,
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
    terrainPatches: [],
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
    save.expedition.id = 7;
    save.expedition.active = true;
    save.knowledge.runs.push([10, 2, KnowledgeState.Personal, 7]);
    save.discoveries.provisional.push({
      id: 2,
      type: 6,
      tileX: 30,
      tileY: 31,
      islandId: 2,
      expeditionId: 7,
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

  it("permits only the returned-lead plus provisional-survey upgrade overlap", () => {
    const returned = makeValidSave();
    returned.fishingShoals.returned.push({
      id: createFishingShoalId(0),
      state: "lead",
      expeditionId: 2,
      generation: 1,
    });
    expect(parseSaveGame(returned)).toBe(returned);
    const terminal = structuredClone(returned);
    terminal.fishingShoals.returned[0].state = "survey";
    expect(parseSaveGame(terminal)).toBe(terminal);

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

  it("distinguishes unsupported schema and generator versions from corrupt data", () => {
    const futureSchema = makeValidSave() as SaveGame & { schemaVersion: number };
    futureSchema.schemaVersion = SAVE_SCHEMA_VERSION + 1;
    expect(() => parseSaveGame(futureSchema)).toThrow(UnsupportedSaveSchemaVersionError);

    const futureGenerator = makeValidSave() as SaveGame & { world: { generatorVersion: number } };
    futureGenerator.world.generatorVersion = 2;
    expect(() => parseSaveGame(futureGenerator)).toThrow(UnsupportedWorldGeneratorVersionError);

    const futureContent = makeValidSave() as unknown as {
      world: { contentVersions: { fishingShoals: number } };
    };
    futureContent.world.contentVersions.fishingShoals = 2;
    expect(() => parseSaveGame(futureContent)).toThrow(UnsupportedFishingShoalContentVersionError);
    expect(classifySaveGame(futureContent)).toBe("unsupported-newer");

    const corrupt = makeValidSave();
    corrupt.ship.currentTileX = -1;
    expect(() => parseSaveGame(corrupt)).toThrow(SaveValidationError);
    expect(isSaveGame(corrupt)).toBe(false);
  });

  it("rejects lifecycle, discovery, and terrain-patch inconsistencies", () => {
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
