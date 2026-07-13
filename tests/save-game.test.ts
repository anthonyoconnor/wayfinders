import { describe, expect, it } from "vitest";
import { makeConfig } from "./helpers.ts";
import { IndexedDbSaveStore } from "../src/tidebound/persistence/IndexedDbSaveStore.ts";
import {
  SAVE_SCHEMA_VERSION,
  WORLD_GENERATOR_VERSION,
  SaveValidationError,
  UnsupportedSaveSchemaVersionError,
  UnsupportedWorldGeneratorVersionError,
  applyGenerationConfig,
  captureGenerationConfig,
  decodeKnowledgeRuns,
  encodeKnowledgeRuns,
  isSaveGame,
  parseSaveGame,
  validateKnowledgeRuns,
  type SaveGameV1,
} from "../src/tidebound/persistence/SaveGame.ts";
import { KnowledgeState } from "../src/tidebound/world/TileData.ts";

function makeValidSave(): SaveGameV1 {
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
});

describe("save-game validation", () => {
  it("accepts a complete version-one save and reconstructs its generation config", () => {
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

  it("distinguishes unsupported schema and generator versions from corrupt data", () => {
    const futureSchema = makeValidSave() as SaveGameV1 & { schemaVersion: number };
    futureSchema.schemaVersion = 2;
    expect(() => parseSaveGame(futureSchema)).toThrow(UnsupportedSaveSchemaVersionError);

    const futureGenerator = makeValidSave() as SaveGameV1 & { world: { generatorVersion: number } };
    futureGenerator.world.generatorVersion = 2;
    expect(() => parseSaveGame(futureGenerator)).toThrow(UnsupportedWorldGeneratorVersionError);

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

    const terrainMutation = makeValidSave() as SaveGameV1 & { terrainPatches: unknown[] };
    terrainMutation.terrainPatches.push({ tileX: 1 });
    expect(() => parseSaveGame(terrainMutation)).toThrow(/empty array/);

    const incompleteDiscovery = structuredClone(makeValidSave()) as SaveGameV1 & {
      discoveries: { returned: Array<Record<string, unknown>> };
    };
    delete incompleteDiscovery.discoveries.returned[0].expeditionId;
    expect(() => parseSaveGame(incompleteDiscovery)).toThrow(/expeditionId/);
  });
});

describe("IndexedDbSaveStore", () => {
  it("reports unavailable browser storage without failing synchronously", async () => {
    const store = new IndexedDbSaveStore({ indexedDB: undefined });
    await expect(store.load()).rejects.toThrow(/IndexedDB is unavailable/);
  });
});
