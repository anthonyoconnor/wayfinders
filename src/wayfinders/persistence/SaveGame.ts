import {
  DEFAULT_PROTOTYPE_CONFIG,
  validatePrototypeConfig,
  type DeepReadonly,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import type { ShipState, ShipwreckState, ShipwreckSurveyState } from "../core/types";
import type { ValidatedSlotStore } from "./IndexedDbSaveStore";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  isCurrentFishingShoalId,
  type FishingShoalProvisionalRecordV1,
  type FishingShoalReturnedRecordV1,
} from "../exploration/FishingShoalContracts";
import {
  NAVIGATOR_GENERATION_HANDOVER_VERSION,
  NavigatorLineageValidationError,
  createNavigatorId,
  isCurrentNavigatorId,
  parseNavigatorSuccessionKey,
  parseNavigatorLineageSnapshot,
  type NavigatorGenerationHandoverV1,
  type NavigatorLineageSnapshotV4,
} from "../lineage/NavigatorLineageSystem";
import { KnowledgeState } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";

export const SAVE_SCHEMA_VERSION = 10 as const;
export const WORLD_GENERATOR_VERSION = 1 as const;

export type KnowledgeRun = readonly [
  start: number,
  length: number,
  state: KnowledgeState.Personal | KnowledgeState.Supported,
  expeditionStamp: number,
];

/**
 * Stable, generation-affecting configuration saved with the seed. Presentation
 * and live gameplay tuning remain outside the deterministic base-world key.
 */
export interface GenerationConfigV1 {
  navigation: Pick<PrototypeConfig["navigation"], "tileSize" | "chunkSize">;
  world: Omit<PrototypeConfig["world"], "seed" | "maxEnclosedUnknownTiles">;
  islands: PrototypeConfig["islands"];
}

/**
 * Structural persistence shape for accepted-baseline discoveries. The
 * simulation can later use its canonical DiscoveryRecord as the SaveGame
 * generic argument.
 */
export interface DiscoverySaveRecord {
  id: number;
  type: number;
  tileX: number;
  tileY: number;
  returned: boolean;
  islandId: number;
  expeditionId: number;
  generation: number;
  name: string;
  rewardId: string;
  rewardLabel: string;
  detail: string;
  settlementId?: string;
  resourceId?: number;
}

export interface PendingRespawnSaveState {
  expeditionId: number;
  generation: number;
  forgottenTiles: number;
  wreckId: number;
  remainingSeconds: number;
}

export interface SaveGame<TDiscovery extends DiscoverySaveRecord = DiscoverySaveRecord> {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  savedAt: number;
  world: {
    seed: number;
    generatorVersion: typeof WORLD_GENERATOR_VERSION;
    generationConfig: GenerationConfigV1;
    contentVersions: {
      fishingShoals: typeof FISHING_SHOAL_CONTENT_VERSION;
    };
  };
  generation: number;
  expedition: {
    id: number;
    active: boolean;
    pendingRespawn: PendingRespawnSaveState | null;
    pendingGenerationHandover: NavigatorGenerationHandoverV1 | null;
  };
  ship: ShipState;
  knowledge: {
    encoding: "non-unknown-runs-v1";
    runs: KnowledgeRun[];
  };
  wrecks: ShipwreckState[];
  discoveries: {
    provisional: TDiscovery[];
    returned: TDiscovery[];
  };
  fishingShoals: {
    provisional: FishingShoalProvisionalRecordV1[];
    returned: FishingShoalReturnedRecordV1[];
  };
  navigatorLineage: NavigatorLineageSnapshotV4;
  terrainPatches: [];
}

export interface KnowledgeCell {
  state: KnowledgeState;
  expeditionStamp: number;
}

export interface DecodedKnowledge {
  knowledge: Uint8Array;
  expeditionStamps: Uint32Array;
}

export type ExactSaveSlotLoadResult =
  | { status: "empty" }
  | { status: "loaded"; save: SaveGame }
  | { status: "discarded"; error: unknown; removed: boolean; removalError?: unknown };

export class SaveValidationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "SaveValidationError";
  }
}

export class UnsupportedSaveSchemaVersionError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported save schema version ${version}`);
    this.name = "UnsupportedSaveSchemaVersionError";
  }
}

export class UnsupportedWorldGeneratorVersionError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported world generator version ${version}`);
    this.name = "UnsupportedWorldGeneratorVersionError";
  }
}

export class UnsupportedFishingShoalContentVersionError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported fishing-shoal content version ${version}`);
    this.name = "UnsupportedFishingShoalContentVersionError";
  }
}

export function captureGenerationConfig(config: PrototypeConfig): GenerationConfigV1 {
  const { seed: _seed, maxEnclosedUnknownTiles: _cleanupLimit, ...world } = config.world;
  return {
    navigation: {
      tileSize: config.navigation.tileSize,
      chunkSize: config.navigation.chunkSize,
    },
    world: { ...world },
    islands: { ...config.islands },
  };
}

/** Creates a complete runtime config without mutating the shared live config. */
export function applyGenerationConfig(
  generation: GenerationConfigV1,
  seed: number,
  base: DeepReadonly<PrototypeConfig> = DEFAULT_PROTOTYPE_CONFIG,
): PrototypeConfig {
  const config: PrototypeConfig = {
    navigation: { ...base.navigation, ...generation.navigation },
    world: { ...base.world, ...generation.world, seed },
    islands: { ...base.islands, ...generation.islands },
    provisions: { ...base.provisions },
    returnRisk: { ...base.returnRisk },
    overlays: { ...base.overlays },
    movement: { ...base.movement },
    simulation: { ...base.simulation },
  };
  validatePrototypeConfig(config);
  return config;
}

/**
 * Encodes every non-Unknown cell as canonical sorted runs. Unknown cells must
 * have a zero stamp, Supported cells a zero stamp, and Personal cells a
 * non-zero unsigned 32-bit expedition stamp.
 */
export function encodeKnowledgeRuns(
  tileCount: number,
  readCell: (index: number) => KnowledgeCell,
): KnowledgeRun[] {
  let cachedIndex = -1;
  let cachedCell: KnowledgeCell | undefined;
  return encodeKnowledgeRunsFromReaders(
    tileCount,
    (index) => {
      cachedIndex = index;
      cachedCell = readCell(index);
      return cachedCell.state;
    },
    (index) => {
      if (cachedIndex !== index || !cachedCell) cachedCell = readCell(index);
      return cachedCell.expeditionStamp;
    },
  );
}

/**
 * Encodes a WorldGrid without allocating a temporary KnowledgeCell object for
 * every tile. GameSimulation caches this canonical result by world identity and
 * knowledgeVersion, so ordinary ship movement does not rescan the world.
 */
export function encodeWorldKnowledgeRuns(world: WorldGrid): KnowledgeRun[] {
  const runs: KnowledgeRun[] = [];
  let active: KnowledgeRun | undefined;
  const chunkColumns = Math.ceil(world.width / world.chunkSize);

  for (let y = 0; y < world.height; y++) {
    const chunkY = Math.floor(y / world.chunkSize);
    const localY = y % world.chunkSize;
    for (let chunkX = 0; chunkX < chunkColumns; chunkX++) {
      const chunk = world.getChunk(chunkX, chunkY);
      const worldX = chunkX * world.chunkSize;
      const cellsInChunkRow = Math.min(world.chunkSize, world.width - worldX);
      if (!chunk) {
        active = undefined;
        continue;
      }
      const localOffset = localY * world.chunkSize;
      const worldOffset = y * world.width + worldX;
      for (let localX = 0; localX < cellsInChunkRow; localX++) {
        const index = worldOffset + localX;
        const state = chunk.knowledge[localOffset + localX] as KnowledgeState;
        const expeditionStamp = chunk.expeditionStamp[localOffset + localX];
        if (
          state > KnowledgeState.Supported
          || (state === KnowledgeState.Personal ? expeditionStamp === 0 : expeditionStamp !== 0)
        ) assertKnowledgeCell(state, expeditionStamp, `knowledge[${index}]`);
        if (state === KnowledgeState.Unknown) {
          active = undefined;
          continue;
        }
        if (
          active
          && active[0] + active[1] === index
          && active[2] === state
          && active[3] === expeditionStamp
        ) {
          const extended: KnowledgeRun = [active[0], active[1] + 1, active[2], active[3]];
          runs[runs.length - 1] = extended;
          active = extended;
        } else {
          active = [index, 1, state, expeditionStamp];
          runs.push(active);
        }
      }
    }
  }
  return runs;
}

function encodeKnowledgeRunsFromReaders(
  tileCount: number,
  readState: (index: number) => KnowledgeState,
  readExpeditionStamp: (index: number) => number,
): KnowledgeRun[] {
  assertPositiveInteger(tileCount, "tileCount");
  const runs: KnowledgeRun[] = [];
  let active: KnowledgeRun | undefined;

  for (let index = 0; index < tileCount; index++) {
    const state = readState(index);
    const expeditionStamp = readExpeditionStamp(index);
    assertKnowledgeCell(state, expeditionStamp, `knowledge[${index}]`);
    if (state === KnowledgeState.Unknown) {
      active = undefined;
      continue;
    }

    if (
      active
      && active[0] + active[1] === index
      && active[2] === state
      && active[3] === expeditionStamp
    ) {
      const extended: KnowledgeRun = [active[0], active[1] + 1, active[2], active[3]];
      runs[runs.length - 1] = extended;
      active = extended;
    } else {
      active = [index, 1, state as KnowledgeState.Personal | KnowledgeState.Supported, expeditionStamp];
      runs.push(active);
    }
  }
  return runs;
}

export function decodeKnowledgeRuns(tileCount: number, runs: readonly KnowledgeRun[]): DecodedKnowledge {
  validateKnowledgeRuns(tileCount, runs);
  const knowledge = new Uint8Array(tileCount);
  const expeditionStamps = new Uint32Array(tileCount);
  for (const [start, length, state, expeditionStamp] of runs) {
    knowledge.fill(state, start, start + length);
    expeditionStamps.fill(expeditionStamp, start, start + length);
  }
  return { knowledge, expeditionStamps };
}

export function validateKnowledgeRuns(tileCount: number, value: unknown): asserts value is KnowledgeRun[] {
  assertPositiveInteger(tileCount, "tileCount");
  if (!Array.isArray(value)) fail("must be an array", "knowledge.runs");

  let previousEnd = 0;
  let previous: KnowledgeRun | undefined;
  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    const path = `knowledge.runs[${index}]`;
    if (!Array.isArray(raw) || raw.length !== 4) fail("must be a four-number tuple", path);
    const [start, length, state, expeditionStamp] = raw as unknown[];
    assertNonNegativeInteger(start, `${path}[0]`);
    assertPositiveInteger(length, `${path}[1]`);
    assertKnowledgeCell(state, expeditionStamp, path);
    if (state === KnowledgeState.Unknown) fail("must not encode Unknown cells", `${path}[2]`);
    if (start < previousEnd) fail("overlaps or is not sorted after the preceding run", `${path}[0]`);
    if (start + length > tileCount) fail("extends beyond the world tile count", path);
    if (
      previous
      && previous[0] + previous[1] === start
      && previous[2] === state
      && previous[3] === expeditionStamp
    ) fail("must be merged with the identical adjacent run", path);
    previousEnd = start + length;
    previous = raw as unknown as KnowledgeRun;
  }
}

/** Validates only the exact schema and format versions supported by this build. */
export function parseSaveGame(value: unknown): SaveGame {
  const root = record(value, "save");
  const schemaVersion = integer(root.schemaVersion, "save.schemaVersion");
  if (schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new UnsupportedSaveSchemaVersionError(schemaVersion);
  }

  nonNegativeFinite(root.savedAt, "save.savedAt");
  const world = record(root.world, "save.world");
  const seed = safeInteger(world.seed, "save.world.seed");
  const generatorVersion = integer(world.generatorVersion, "save.world.generatorVersion");
  if (generatorVersion !== WORLD_GENERATOR_VERSION) {
    throw new UnsupportedWorldGeneratorVersionError(generatorVersion);
  }
  const contentVersions = record(world.contentVersions, "save.world.contentVersions");
  const fishingShoalContentVersion = integer(
    contentVersions.fishingShoals,
    "save.world.contentVersions.fishingShoals",
  );
  if (fishingShoalContentVersion !== FISHING_SHOAL_CONTENT_VERSION) {
    throw new UnsupportedFishingShoalContentVersionError(fishingShoalContentVersion);
  }
  const generationConfig = validateGenerationConfig(world.generationConfig, seed);
  const tileCount = generationConfig.world.width * generationConfig.world.height;

  const generation = positiveSafeInteger(root.generation, "save.generation");
  const expedition = record(root.expedition, "save.expedition");
  const expeditionId = unsigned32(expedition.id, "save.expedition.id", false);
  const expeditionActive = boolean(expedition.active, "save.expedition.active");
  const pendingRespawn = validatePendingRespawn(expedition.pendingRespawn, expeditionId, generation, expeditionActive);
  const pendingGenerationHandover = validatePendingGenerationHandover(
    expedition.pendingGenerationHandover,
    generation,
    expeditionActive,
  );
  if (pendingRespawn && pendingGenerationHandover) {
    fail("cannot coexist with a wreck hold", "save.expedition.pendingGenerationHandover");
  }

  const ship = validateShip(root.ship, generationConfig);
  if (pendingRespawn && ship.provisions !== 0) fail("must have zero provisions during a wreck hold", "save.ship.provisions");
  validateGenerationHandoverShip(pendingGenerationHandover, ship, generationConfig);

  const knowledge = record(root.knowledge, "save.knowledge");
  if (knowledge.encoding !== "non-unknown-runs-v1") fail("has an unsupported encoding", "save.knowledge.encoding");
  validateKnowledgeRuns(tileCount, knowledge.runs);
  validateExpeditionKnowledge(knowledge.runs, expeditionId, expeditionActive);

  const wrecks = validateWrecks(
    root.wrecks,
    generationConfig,
    generation,
    expeditionId,
    expeditionActive,
  );
  for (let index = 0; index < wrecks.length; index++) {
    if (wrecks[index].generation > generation) {
      fail("cannot be later than the current generation", `save.wrecks[${index}].generation`);
    }
  }
  if (pendingRespawn) validatePendingWreck(pendingRespawn, wrecks, ship);

  const discoveries = record(root.discoveries, "save.discoveries");
  const provisionalDiscoveries = validateDiscoveries(
    discoveries.provisional,
    false,
    generationConfig,
    expeditionId,
    generation,
    "save.discoveries.provisional",
  );
  const returnedDiscoveries = validateDiscoveries(
    discoveries.returned,
    true,
    generationConfig,
    expeditionId,
    generation,
    "save.discoveries.returned",
  );
  if (provisionalDiscoveries.length > 0 && !expeditionActive) {
    fail("requires an active expedition", "save.discoveries.provisional");
  }
  const discoveryIds = new Set<number>();
  for (const discovery of [...provisionalDiscoveries, ...returnedDiscoveries]) {
    if (discoveryIds.has(discovery.id)) fail(`contains duplicate discovery id ${discovery.id}`, "save.discoveries");
    discoveryIds.add(discovery.id);
  }

  if (!Array.isArray(root.terrainPatches) || root.terrainPatches.length !== 0) {
    fail("must be an empty array in the current schema", "save.terrainPatches");
  }
  const fishingShoals = record(root.fishingShoals, "save.fishingShoals");
  const provisionalFishingShoals = validateFishingShoalProvisional(
    fishingShoals.provisional,
    expeditionId,
    generation,
    expeditionActive,
  );
  const returnedFishingShoals = validateFishingShoalReturned(fishingShoals.returned, generation);
  const returnedById = new Map(returnedFishingShoals.map((item) => [item.id, item]));
  for (let index = 0; index < provisionalFishingShoals.length; index++) {
    const item = provisionalFishingShoals[index];
    const prior = returnedById.get(item.id);
    if (prior && !(prior.state === "lead" && item.state === "surveyed")) {
      fail(
        "may overlap returned state only for a returned lead with a provisional survey upgrade",
        `save.fishingShoals.provisional[${index}].id`,
      );
    }
  }
  let navigatorLineage: NavigatorLineageSnapshotV4;
  try {
    navigatorLineage = parseNavigatorLineageSnapshot(root.navigatorLineage);
  } catch (error) {
    if (error instanceof NavigatorLineageValidationError) {
      fail(error.message, `save.${error.path}`);
    }
    throw error;
  }
  if (navigatorLineage.navigators.at(-1)?.generation !== generation) {
    fail("latest navigator generation must match the saved generation", "save.navigatorLineage.navigators");
  }
  const lineageChronology = validateLineageWrecks(navigatorLineage, wrecks);
  const expectedExpeditionId = pendingRespawn
    ? lineageChronology.latestFatalExpeditionId
    : lineageChronology.nextExpeditionId;
  if (expectedExpeditionId === undefined) {
    fail("requires a fatal voyage in the navigator lineage", "save.expedition.id");
  }
  if (expeditionId !== expectedExpeditionId) {
    fail(
      `must match lineage chronology with expedition ${expectedExpeditionId}`,
      "save.expedition.id",
    );
  }
  validateVoyageAchievements(
    navigatorLineage,
    returnedDiscoveries,
    returnedFishingShoals,
    wrecks,
  );
  validateReturnedSurveyProvenance(navigatorLineage, wrecks, returnedFishingShoals);
  const pendingSuccession = navigatorLineage.pendingSuccession;
  if (pendingRespawn === null && pendingSuccession !== null) {
    fail("cannot be pending without a wreck hold", "save.navigatorLineage.pendingSuccession");
  }
  if (pendingRespawn !== null) {
    if (pendingSuccession?.reason !== "wreck") {
      fail("must contain the pending wreck succession", "save.navigatorLineage.pendingSuccession");
    }
    if (
      pendingSuccession.resolutionId !== pendingRespawn.wreckId
      || pendingSuccession.fromGeneration !== generation
    ) {
      fail("must match the pending wreck hold", "save.navigatorLineage.pendingSuccession");
    }
  }
  validateLineageGenerationHandover(
    pendingGenerationHandover,
    navigatorLineage,
    pendingRespawn,
  );
  return value as SaveGame;
}

export function isSaveGame(value: unknown): boolean {
  try {
    parseSaveGame(value);
    return true;
  } catch {
    return false;
  }
}

/** Loads one exact current-version slot and atomically deletes any rejected record. */
export async function loadExactSaveSlot(
  store: ValidatedSlotStore<unknown>,
  validateRestoration?: (save: SaveGame) => void,
): Promise<ExactSaveSlotLoadResult> {
  const result = await store.loadAndDeleteRejected((value) => {
    const save = parseSaveGame(value);
    validateRestoration?.(save);
    return save;
  });
  if (result.status === "loaded") return { status: "loaded", save: result.value };
  return result;
}

function validateFishingShoalProvisional(
  value: unknown,
  expeditionId: number,
  generation: number,
  expeditionActive: boolean,
): FishingShoalProvisionalRecordV1[] {
  if (!Array.isArray(value)) fail("must be an array", "save.fishingShoals.provisional");
  let previousId = "";
  for (let index = 0; index < value.length; index++) {
    const path = `save.fishingShoals.provisional[${index}]`;
    const item = record(value[index], path);
    const id = requiredString(item.id, `${path}.id`);
    if (!isCurrentFishingShoalId(id)) fail("has an invalid or unsupported fishing-shoal ID", `${path}.id`);
    if (id <= previousId) fail("must be uniquely sorted by fishing-shoal ID", `${path}.id`);
    previousId = id;
    if (item.state !== "sighted" && item.state !== "surveyed") {
      fail("must be sighted or surveyed", `${path}.state`);
    }
    const recordExpeditionId = unsigned32(item.expeditionId, `${path}.expeditionId`, false);
    const recordGeneration = positiveSafeInteger(item.generation, `${path}.generation`);
    if (!expeditionActive) fail("requires an active expedition", path);
    if (recordExpeditionId !== expeditionId) fail("must belong to the active expedition", `${path}.expeditionId`);
    if (recordGeneration !== generation) fail("must belong to the current generation", `${path}.generation`);
  }
  return value as FishingShoalProvisionalRecordV1[];
}

function validateFishingShoalReturned(
  value: unknown,
  generation: number,
): FishingShoalReturnedRecordV1[] {
  if (!Array.isArray(value)) fail("must be an array", "save.fishingShoals.returned");
  let previousId = "";
  for (let index = 0; index < value.length; index++) {
    const path = `save.fishingShoals.returned[${index}]`;
    const item = record(value[index], path);
    const id = requiredString(item.id, `${path}.id`);
    if (!isCurrentFishingShoalId(id)) fail("has an invalid or unsupported fishing-shoal ID", `${path}.id`);
    if (id <= previousId) fail("must be uniquely sorted by fishing-shoal ID", `${path}.id`);
    previousId = id;
    if (item.state !== "lead" && item.state !== "survey") {
      fail("must be a returned lead or survey", `${path}.state`);
    }
    unsigned32(item.expeditionId, `${path}.expeditionId`, false);
    const recordGeneration = positiveSafeInteger(item.generation, `${path}.generation`);
    if (recordGeneration > generation) fail("cannot be later than the current generation", `${path}.generation`);
  }
  return value as FishingShoalReturnedRecordV1[];
}

function validateGenerationConfig(value: unknown, seed: number): GenerationConfigV1 {
  const generation = record(value, "save.world.generationConfig");
  const navigation = record(generation.navigation, "save.world.generationConfig.navigation");
  const world = record(generation.world, "save.world.generationConfig.world");
  const islands = record(generation.islands, "save.world.generationConfig.islands");
  const candidate = {
    navigation: {
      tileSize: finite(navigation.tileSize, "save.world.generationConfig.navigation.tileSize"),
      chunkSize: integer(navigation.chunkSize, "save.world.generationConfig.navigation.chunkSize"),
    },
    world: {
      width: integer(world.width, "save.world.generationConfig.world.width"),
      height: integer(world.height, "save.world.generationConfig.world.height"),
      homeIslandRadius: integer(world.homeIslandRadius, "save.world.generationConfig.world.homeIslandRadius"),
      supportedWaterRadius: finite(world.supportedWaterRadius, "save.world.generationConfig.world.supportedWaterRadius"),
      supportedBoundaryNoise: finite(world.supportedBoundaryNoise, "save.world.generationConfig.world.supportedBoundaryNoise"),
      supportedNoiseScale: finite(world.supportedNoiseScale, "save.world.generationConfig.world.supportedNoiseScale"),
      shallowWaterRadius: integer(world.shallowWaterRadius, "save.world.generationConfig.world.shallowWaterRadius"),
      hiddenObstacleRadius: integer(world.hiddenObstacleRadius, "save.world.generationConfig.world.hiddenObstacleRadius"),
      hiddenObstacleDistance: finite(world.hiddenObstacleDistance, "save.world.generationConfig.world.hiddenObstacleDistance"),
    },
    islands: {
      count: integer(islands.count, "save.world.generationConfig.islands.count"),
      minRadius: finite(islands.minRadius, "save.world.generationConfig.islands.minRadius"),
      maxRadius: finite(islands.maxRadius, "save.world.generationConfig.islands.maxRadius"),
      apronWidth: finite(islands.apronWidth, "save.world.generationConfig.islands.apronWidth"),
      minimumChannelWidth: finite(islands.minimumChannelWidth, "save.world.generationConfig.islands.minimumChannelWidth"),
      homeClearance: finite(islands.homeClearance, "save.world.generationConfig.islands.homeClearance"),
      edgeMargin: finite(islands.edgeMargin, "save.world.generationConfig.islands.edgeMargin"),
      placementAttempts: integer(islands.placementAttempts, "save.world.generationConfig.islands.placementAttempts"),
      edgeNoise: finite(islands.edgeNoise, "save.world.generationConfig.islands.edgeNoise"),
      safeCorridorHalfWidth: finite(islands.safeCorridorHalfWidth, "save.world.generationConfig.islands.safeCorridorHalfWidth"),
      highIslandWeight: finite(islands.highIslandWeight, "save.world.generationConfig.islands.highIslandWeight"),
      lowCayWeight: finite(islands.lowCayWeight, "save.world.generationConfig.islands.lowCayWeight"),
      atollWeight: finite(islands.atollWeight, "save.world.generationConfig.islands.atollWeight"),
      rockySkerryWeight: finite(islands.rockySkerryWeight, "save.world.generationConfig.islands.rockySkerryWeight"),
    },
  } satisfies GenerationConfigV1;

  try {
    applyGenerationConfig(candidate, seed);
  } catch (error) {
    fail(error instanceof Error ? error.message : "is invalid", "save.world.generationConfig");
  }
  return candidate;
}

function validatePendingRespawn(
  value: unknown,
  expeditionId: number,
  generation: number,
  expeditionActive: boolean,
): PendingRespawnSaveState | null {
  if (value === null) return null;
  if (expeditionActive) fail("cannot coexist with an active expedition", "save.expedition.pendingRespawn");
  const pending = record(value, "save.expedition.pendingRespawn");
  const result: PendingRespawnSaveState = {
    expeditionId: unsigned32(pending.expeditionId, "save.expedition.pendingRespawn.expeditionId", false),
    generation: positiveSafeInteger(pending.generation, "save.expedition.pendingRespawn.generation"),
    forgottenTiles: nonNegativeSafeInteger(pending.forgottenTiles, "save.expedition.pendingRespawn.forgottenTiles"),
    wreckId: positiveSafeInteger(pending.wreckId, "save.expedition.pendingRespawn.wreckId"),
    remainingSeconds: nonNegativeFinite(pending.remainingSeconds, "save.expedition.pendingRespawn.remainingSeconds"),
  };
  if (result.expeditionId !== expeditionId) fail("must match the current expedition id", "save.expedition.pendingRespawn.expeditionId");
  if (result.generation !== generation) fail("must match the current generation", "save.expedition.pendingRespawn.generation");
  return result;
}

function validatePendingGenerationHandover(
  value: unknown,
  generation: number,
  expeditionActive: boolean,
): NavigatorGenerationHandoverV1 | null {
  if (value === null) return null;
  if (expeditionActive) {
    fail("cannot coexist with an active expedition", "save.expedition.pendingGenerationHandover");
  }
  const path = "save.expedition.pendingGenerationHandover";
  const handover = record(value, path);
  if (integer(handover.contractVersion, `${path}.contractVersion`) !== NAVIGATOR_GENERATION_HANDOVER_VERSION) {
    fail(`must use contract version ${NAVIGATOR_GENERATION_HANDOVER_VERSION}`, `${path}.contractVersion`);
  }
  const fromGeneration = positiveSafeInteger(handover.fromGeneration, `${path}.fromGeneration`);
  const nextGeneration = positiveSafeInteger(handover.nextGeneration, `${path}.nextGeneration`);
  const fromNavigatorId = handover.fromNavigatorId;
  const nextNavigatorId = handover.nextNavigatorId;
  if (!isCurrentNavigatorId(fromNavigatorId)) {
    fail("has an invalid or unsupported navigator ID", `${path}.fromNavigatorId`);
  }
  if (!isCurrentNavigatorId(nextNavigatorId)) {
    fail("has an invalid or unsupported navigator ID", `${path}.nextNavigatorId`);
  }
  if (fromNavigatorId !== createNavigatorId(fromGeneration)) {
    fail("must match the source generation", `${path}.fromNavigatorId`);
  }
  if (nextNavigatorId !== createNavigatorId(nextGeneration)) {
    fail("must match the next generation", `${path}.nextNavigatorId`);
  }
  if (nextGeneration !== generation || fromGeneration + 1 !== nextGeneration) {
    fail("must describe the transition into the current generation", path);
  }
  if (handover.reason !== "wreck" && handover.reason !== "tenure") {
    fail("must be wreck or tenure", `${path}.reason`);
  }
  return {
    contractVersion: NAVIGATOR_GENERATION_HANDOVER_VERSION,
    fromNavigatorId,
    fromGeneration,
    nextNavigatorId,
    nextGeneration,
    reason: handover.reason,
  };
}

function validateGenerationHandoverShip(
  handover: NavigatorGenerationHandoverV1 | null,
  ship: ShipState,
  config: GenerationConfigV1,
): void {
  if (!handover) return;
  const homeReturnTile = {
    x: Math.floor(config.world.width / 2) + config.world.homeIslandRadius + 1,
    y: Math.floor(config.world.height / 2),
  };
  if (ship.currentTileX !== homeReturnTile.x || ship.currentTileY !== homeReturnTile.y) {
    fail("must remain at the home dock during a generation handover", "save.ship");
  }
  if (ship.speed !== 0) fail("must be stopped during a generation handover", "save.ship.speed");
  if (ship.provisionAccumulator !== 0) {
    fail("must have no fractional provision charge during a generation handover", "save.ship.provisionAccumulator");
  }
}

function validateShip(value: unknown, config: GenerationConfigV1): ShipState {
  const ship = record(value, "save.ship");
  const result: ShipState = {
    worldX: finite(ship.worldX, "save.ship.worldX"),
    worldY: finite(ship.worldY, "save.ship.worldY"),
    heading: finite(ship.heading, "save.ship.heading"),
    speed: finite(ship.speed, "save.ship.speed"),
    currentTileX: integer(ship.currentTileX, "save.ship.currentTileX"),
    currentTileY: integer(ship.currentTileY, "save.ship.currentTileY"),
    provisions: nonNegativeSafeInteger(ship.provisions, "save.ship.provisions"),
    provisionAccumulator: nonNegativeFinite(ship.provisionAccumulator, "save.ship.provisionAccumulator"),
  };
  if (result.heading < 0 || result.heading >= 360) fail("must be in the range 0..<360", "save.ship.heading");
  assertTileInBounds(result.currentTileX, result.currentTileY, config, "save.ship");
  assertWorldPointMatchesTile(result.worldX, result.worldY, result.currentTileX, result.currentTileY, config, "save.ship");
  if (result.provisionAccumulator >= 1) fail("must be less than one bundle", "save.ship.provisionAccumulator");
  return result;
}

function validateWrecks(
  value: unknown,
  config: GenerationConfigV1,
  currentGeneration: number,
  currentExpeditionId: number,
  expeditionActive: boolean,
): ShipwreckState[] {
  if (!Array.isArray(value)) fail("must be an array", "save.wrecks");
  const ids = new Set<number>();
  return value.map((raw, index) => {
    const path = `save.wrecks[${index}]`;
    const wreck = record(raw, path);
    const generation = positiveSafeInteger(wreck.generation, `${path}.generation`);
    const discovered = boolean(wreck.discovered, `${path}.discovered`);
    const survey = validateWreckSurvey(
      wreck.survey,
      `${path}.survey`,
      generation,
      discovered,
      currentGeneration,
      currentExpeditionId,
      expeditionActive,
    );
    const result: ShipwreckState = {
      id: positiveSafeInteger(wreck.id, `${path}.id`),
      generation,
      expeditionId: unsigned32(wreck.expeditionId, `${path}.expeditionId`, false),
      worldX: finite(wreck.worldX, `${path}.worldX`),
      worldY: finite(wreck.worldY, `${path}.worldY`),
      tileX: integer(wreck.tileX, `${path}.tileX`),
      tileY: integer(wreck.tileY, `${path}.tileY`),
      heading: finite(wreck.heading, `${path}.heading`),
      discovered,
      survey,
    };
    if (ids.has(result.id)) fail(`duplicates wreck id ${result.id}`, `${path}.id`);
    ids.add(result.id);
    if (result.heading < 0 || result.heading >= 360) fail("must be in the range 0..<360", `${path}.heading`);
    assertTileInBounds(result.tileX, result.tileY, config, path);
    assertWorldPointMatchesTile(result.worldX, result.worldY, result.tileX, result.tileY, config, path);
    return result;
  });
}

function validateWreckSurvey(
  value: unknown,
  path: string,
  wreckGeneration: number,
  wreckDiscovered: boolean,
  currentGeneration: number,
  currentExpeditionId: number,
  expeditionActive: boolean,
): ShipwreckSurveyState {
  const survey = record(value, path);
  if (survey.state === "unexamined") return { state: "unexamined" };
  if (survey.state !== "provisional" && survey.state !== "returned") {
    fail("must be unexamined, provisional or returned", `${path}.state`);
  }
  if (!wreckDiscovered) fail("requires the wreck to be discovered", path);

  const expeditionId = unsigned32(survey.expeditionId, `${path}.expeditionId`, false);
  const generation = positiveSafeInteger(survey.generation, `${path}.generation`);
  if (generation <= wreckGeneration) {
    fail("must belong to a later generation than the lost navigator", `${path}.generation`);
  }
  if (generation > currentGeneration) {
    fail("cannot be later than the current generation", `${path}.generation`);
  }
  if (survey.state === "provisional") {
    if (!expeditionActive) fail("requires an active expedition", path);
    if (expeditionId !== currentExpeditionId) {
      fail("must belong to the active expedition", `${path}.expeditionId`);
    }
    if (generation !== currentGeneration) {
      fail("must belong to the current generation", `${path}.generation`);
    }
  }
  return { state: survey.state, expeditionId, generation };
}

function validateLineageWrecks(
  lineage: NavigatorLineageSnapshotV4,
  wrecks: readonly ShipwreckState[],
): { nextExpeditionId: number; latestFatalExpeditionId?: number } {
  const lostNavigatorByWreckId = new Map<number, {
    generation: number;
    index: number;
    fatalExpeditionId: number;
  }>();
  let nextChronologicalExpeditionId = 1;
  let latestFatalExpeditionId: number | undefined;
  for (let index = 0; index < lineage.navigators.length; index++) {
    const navigator = lineage.navigators[index];
    for (let voyageIndex = 0; voyageIndex < navigator.successfulVoyages.length; voyageIndex++) {
      nextChronologicalExpeditionId = nextExpeditionId(nextChronologicalExpeditionId);
    }
    if (navigator.state !== "lost") continue;
    const fatalExpeditionId = nextChronologicalExpeditionId;
    nextChronologicalExpeditionId = nextExpeditionId(nextChronologicalExpeditionId);
    latestFatalExpeditionId = fatalExpeditionId;
    const parsedKey = parseNavigatorSuccessionKey(navigator.endedBySuccessionKey);
    if (!parsedKey || parsedKey.reason !== "wreck") {
      fail(
        "must contain a current wreck succession key",
        `save.navigatorLineage.navigators[${index}].endedBySuccessionKey`,
      );
    }
    if (lostNavigatorByWreckId.has(parsedKey.resolutionId)) {
      fail(
        "must reference a unique wreck",
        `save.navigatorLineage.navigators[${index}].endedBySuccessionKey`,
      );
    }
    lostNavigatorByWreckId.set(parsedKey.resolutionId, {
      generation: navigator.generation,
      index,
      fatalExpeditionId,
    });
  }

  const wreckIds = new Set(wrecks.map(({ id }) => id));
  for (const [wreckId, lostNavigator] of lostNavigatorByWreckId) {
    if (!wreckIds.has(wreckId)) {
      fail(
        `does not reference saved wreck ${wreckId}`,
        `save.navigatorLineage.navigators[${lostNavigator.index}].endedBySuccessionKey`,
      );
    }
  }

  for (let index = 0; index < wrecks.length; index++) {
    const wreck = wrecks[index];
    const lostNavigator = lostNavigatorByWreckId.get(wreck.id);
    if (!lostNavigator) {
      fail("must match exactly one lost navigator", `save.wrecks[${index}].id`);
    }
    if (lostNavigator.generation !== wreck.generation) {
      fail(
        "must match its lost navigator generation",
        `save.wrecks[${index}].generation`,
      );
    }
    if (lostNavigator.fatalExpeditionId !== wreck.expeditionId) {
      fail(
        `must match fatal expedition ${lostNavigator.fatalExpeditionId}`,
        `save.wrecks[${index}].expeditionId`,
      );
    }
  }

  return {
    nextExpeditionId: nextChronologicalExpeditionId,
    latestFatalExpeditionId,
  };
}

function validateReturnedSurveyProvenance(
  lineage: NavigatorLineageSnapshotV4,
  wrecks: readonly ShipwreckState[],
  fishingShoals: readonly FishingShoalReturnedRecordV1[],
): void {
  const completedVoyages = new Set<string>();
  let expeditionId = 1;
  for (const navigator of lineage.navigators) {
    for (let voyage = 0; voyage < navigator.completedVoyages; voyage++) {
      completedVoyages.add(`${navigator.generation}:${expeditionId}`);
      expeditionId = nextExpeditionId(expeditionId);
    }
    if (navigator.state === "lost") expeditionId = nextExpeditionId(expeditionId);
  }

  const register = (generation: number, surveyExpeditionId: number, path: string): void => {
    const key = `${generation}:${surveyExpeditionId}`;
    if (!completedVoyages.has(key)) {
      fail("must match a completed voyage for its navigator", path);
    }
  };

  for (let index = 0; index < wrecks.length; index++) {
    const survey = wrecks[index].survey;
    if (survey.state !== "returned") continue;
    register(survey.generation, survey.expeditionId, `save.wrecks[${index}].survey`);
  }
  for (let index = 0; index < fishingShoals.length; index++) {
    const survey = fishingShoals[index];
    if (survey.state !== "survey") continue;
    register(survey.generation, survey.expeditionId, `save.fishingShoals.returned[${index}]`);
  }
}

function validateVoyageAchievements(
  lineage: NavigatorLineageSnapshotV4,
  discoveries: readonly DiscoverySaveRecord[],
  fishingShoals: readonly FishingShoalReturnedRecordV1[],
  wrecks: readonly ShipwreckState[],
): void {
  const discoveryById = new Map(discoveries.map((record) => [record.id, record]));
  const fishingShoalById = new Map(fishingShoals.map((record) => [record.id, record]));
  const wreckById = new Map(wrecks.map((record) => [record.id, record]));
  const creditedDiscoveries = new Set<number>();
  const creditedFishingLeads = new Set<string>();
  const creditedFishingSurveys = new Set<string>();
  const creditedWrecks = new Set<number>();

  for (let navigatorIndex = 0; navigatorIndex < lineage.navigators.length; navigatorIndex++) {
    const navigator = lineage.navigators[navigatorIndex];
    for (let voyageIndex = 0; voyageIndex < navigator.successfulVoyages.length; voyageIndex++) {
      const voyage = navigator.successfulVoyages[voyageIndex];
      const path = `save.navigatorLineage.navigators[${navigatorIndex}].successfulVoyages[${voyageIndex}]`;
      const validateProvenance = (
        record: { generation: number; expeditionId: number },
        sourcePath: string,
      ): void => {
        if (record.generation !== navigator.generation || record.expeditionId !== voyage.expeditionId) {
          fail("must belong to this navigator and voyage", sourcePath);
        }
      };

      for (let index = 0; index < voyage.discoveryIds.length; index++) {
        const id = voyage.discoveryIds[index];
        const sourcePath = `${path}.discoveryIds[${index}]`;
        const discovery = discoveryById.get(id);
        if (!discovery) fail(`does not reference returned discovery ${id}`, sourcePath);
        validateProvenance(discovery, sourcePath);
        if (creditedDiscoveries.has(id)) fail(`duplicates discovery ${id}`, sourcePath);
        creditedDiscoveries.add(id);
      }

      for (let index = 0; index < voyage.fishingLeadIds.length; index++) {
        const id = voyage.fishingLeadIds[index];
        const sourcePath = `${path}.fishingLeadIds[${index}]`;
        const fishingShoal = fishingShoalById.get(id);
        if (!fishingShoal) fail(`does not reference returned fishing shoal ${id}`, sourcePath);
        if (fishingShoal.state === "lead") validateProvenance(fishingShoal, sourcePath);
        if (creditedFishingSurveys.has(id)) {
          fail("must precede the returned fishing survey", sourcePath);
        }
        if (creditedFishingLeads.has(id)) fail(`duplicates fishing lead ${id}`, sourcePath);
        creditedFishingLeads.add(id);
      }

      for (let index = 0; index < voyage.fishingSurveyIds.length; index++) {
        const id = voyage.fishingSurveyIds[index];
        const sourcePath = `${path}.fishingSurveyIds[${index}]`;
        const fishingShoal = fishingShoalById.get(id);
        if (!fishingShoal || fishingShoal.state !== "survey") {
          fail(`does not reference returned fishing survey ${id}`, sourcePath);
        }
        validateProvenance(fishingShoal, sourcePath);
        if (creditedFishingSurveys.has(id)) fail(`duplicates fishing survey ${id}`, sourcePath);
        creditedFishingSurveys.add(id);
      }

      for (let index = 0; index < voyage.wreckIds.length; index++) {
        const id = voyage.wreckIds[index];
        const sourcePath = `${path}.wreckIds[${index}]`;
        const wreck = wreckById.get(id);
        if (!wreck || wreck.survey.state !== "returned") {
          fail(`does not reference returned wreck report ${id}`, sourcePath);
        }
        validateProvenance(wreck.survey, sourcePath);
        if (creditedWrecks.has(id)) fail(`duplicates wreck report ${id}`, sourcePath);
        creditedWrecks.add(id);
      }
    }
  }

  for (let index = 0; index < discoveries.length; index++) {
    if (!creditedDiscoveries.has(discoveries[index].id)) {
      fail("must be credited to its successful voyage", `save.discoveries.returned[${index}]`);
    }
  }
  for (let index = 0; index < fishingShoals.length; index++) {
    const fishingShoal = fishingShoals[index];
    const credited = fishingShoal.state === "survey"
      ? creditedFishingSurveys.has(fishingShoal.id)
      : creditedFishingLeads.has(fishingShoal.id);
    if (!credited) {
      fail("must be credited to its successful voyage", `save.fishingShoals.returned[${index}]`);
    }
  }
  for (let index = 0; index < wrecks.length; index++) {
    if (wrecks[index].survey.state === "returned" && !creditedWrecks.has(wrecks[index].id)) {
      fail("must be credited to its successful voyage", `save.wrecks[${index}].survey`);
    }
  }
}

function nextExpeditionId(expeditionId: number): number {
  return expeditionId === 0xffff_ffff ? 1 : expeditionId + 1;
}

function validateLineageGenerationHandover(
  handover: NavigatorGenerationHandoverV1 | null,
  lineage: NavigatorLineageSnapshotV4,
  pendingRespawn: PendingRespawnSaveState | null,
): void {
  if (!handover) return;
  const path = "save.expedition.pendingGenerationHandover";
  if (pendingRespawn) fail("cannot coexist with a wreck hold", path);
  if (lineage.pendingSuccession) fail("requires succession to be complete", path);

  const sourceIndex = lineage.navigators.findIndex(({ id }) => id === handover.fromNavigatorId);
  const nextIndex = lineage.navigators.findIndex(({ id }) => id === handover.nextNavigatorId);
  if (sourceIndex !== lineage.navigators.length - 2 || nextIndex !== lineage.navigators.length - 1) {
    fail("must reference the latest terminal navigator and active successor", path);
  }
  const source = lineage.navigators[sourceIndex];
  const next = lineage.navigators[nextIndex];
  if (
    !source
    || source.state === "active"
    || source.generation !== handover.fromGeneration
    || source.successionReason !== handover.reason
  ) {
    fail("does not match the terminal navigator", `${path}.fromNavigatorId`);
  }
  if (
    !next
    || next.state !== "active"
    || next.generation !== handover.nextGeneration
    || next.createdBySuccessionKey !== source.endedBySuccessionKey
  ) {
    fail("does not match the active successor", `${path}.nextNavigatorId`);
  }
}

function validatePendingWreck(
  pending: PendingRespawnSaveState,
  wrecks: readonly ShipwreckState[],
  ship: ShipState,
): void {
  const wreck = wrecks.find(({ id }) => id === pending.wreckId);
  if (!wreck) fail("does not reference a saved wreck", "save.expedition.pendingRespawn.wreckId");
  if (wreck.expeditionId !== pending.expeditionId || wreck.generation !== pending.generation) {
    fail("does not match its referenced wreck lifecycle", "save.expedition.pendingRespawn");
  }
  if (ship.currentTileX !== wreck.tileX || ship.currentTileY !== wreck.tileY) {
    fail("must remain at the pending wreck tile", "save.ship");
  }
  if (ship.speed !== 0) fail("must be stopped during a wreck hold", "save.ship.speed");
  if (ship.provisionAccumulator !== 0) {
    fail("must have no fractional provision charge during a wreck hold", "save.ship.provisionAccumulator");
  }
}

function validateDiscoveries(
  value: unknown,
  expectedReturned: boolean,
  config: GenerationConfigV1,
  expeditionId: number,
  generation: number,
  path: string,
): DiscoverySaveRecord[] {
  if (!Array.isArray(value)) fail("must be an array", path);
  return value.map((raw, index) => {
    const itemPath = `${path}[${index}]`;
    const discovery = record(raw, itemPath);
    const result = discovery as unknown as DiscoverySaveRecord;
    positiveSafeInteger(discovery.id, `${itemPath}.id`);
    const type = nonNegativeSafeInteger(discovery.type, `${itemPath}.type`);
    if (type > 6) fail("must be a known discovery type", `${itemPath}.type`);
    const tileX = integer(discovery.tileX, `${itemPath}.tileX`);
    const tileY = integer(discovery.tileY, `${itemPath}.tileY`);
    assertTileInBounds(tileX, tileY, config, itemPath);
    if (boolean(discovery.returned, `${itemPath}.returned`) !== expectedReturned) {
      fail(`must have returned=${String(expectedReturned)}`, `${itemPath}.returned`);
    }
    const islandId = positiveSafeInteger(discovery.islandId, `${itemPath}.islandId`);
    if (islandId > config.islands.count) fail("does not reference a generated island", `${itemPath}.islandId`);
    const foundExpedition = unsigned32(discovery.expeditionId, `${itemPath}.expeditionId`, false);
    if (!expectedReturned && foundExpedition !== expeditionId) {
      fail("must belong to the active expedition", `${itemPath}.expeditionId`);
    }
    const foundGeneration = positiveSafeInteger(discovery.generation, `${itemPath}.generation`);
    if (foundGeneration > generation) fail("cannot be later than the current generation", `${itemPath}.generation`);
    requiredString(discovery.name, `${itemPath}.name`);
    requiredString(discovery.rewardId, `${itemPath}.rewardId`);
    requiredString(discovery.rewardLabel, `${itemPath}.rewardLabel`);
    requiredString(discovery.detail, `${itemPath}.detail`);
    optionalString(discovery.settlementId, `${itemPath}.settlementId`);
    if (discovery.resourceId !== undefined) nonNegativeSafeInteger(discovery.resourceId, `${itemPath}.resourceId`);
    return result;
  });
}

function validateExpeditionKnowledge(value: unknown, expeditionId: number, active: boolean): void {
  const runs = value as KnowledgeRun[];
  for (let index = 0; index < runs.length; index++) {
    const [, , state, stamp] = runs[index];
    if (state !== KnowledgeState.Personal) continue;
    if (!active) fail("contains Personal knowledge without an active expedition", `save.knowledge.runs[${index}]`);
    if (stamp !== expeditionId) fail("Personal stamp must match the active expedition id", `save.knowledge.runs[${index}][3]`);
  }
}

function assertKnowledgeCell(stateValue: unknown, stampValue: unknown, path: string): void {
  const state = integer(stateValue, `${path}.state`);
  const stamp = unsigned32(stampValue, `${path}.expeditionStamp`, true);
  if (state !== KnowledgeState.Unknown && state !== KnowledgeState.Personal && state !== KnowledgeState.Supported) {
    fail("has an invalid knowledge state", `${path}.state`);
  }
  if (state === KnowledgeState.Personal && stamp === 0) fail("Personal knowledge requires a non-zero stamp", path);
  if (state !== KnowledgeState.Personal && stamp !== 0) fail("only Personal knowledge may have a stamp", path);
}

function assertTileInBounds(x: number, y: number, config: GenerationConfigV1, path: string): void {
  if (x < 0 || y < 0 || x >= config.world.width || y >= config.world.height) {
    fail("tile is outside the saved world", path);
  }
}

function assertWorldPointMatchesTile(
  worldX: number,
  worldY: number,
  tileX: number,
  tileY: number,
  config: GenerationConfigV1,
  path: string,
): void {
  const size = config.navigation.tileSize;
  if (worldX < 0 || worldY < 0 || Math.floor(worldX / size) !== tileX || Math.floor(worldY / size) !== tileY) {
    fail("world position does not lie inside its saved tile", path);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("must be an object", path);
  return value as Record<string, unknown>;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("must be a boolean", path);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("must be a finite number", path);
  return value;
}

function nonNegativeFinite(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) fail("must be non-negative", path);
  return result;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) fail("must be an integer", path);
  return value;
}

function safeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("must be a safe integer", path);
  return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  const result = safeInteger(value, path);
  if (result <= 0) fail("must be positive", path);
  return result;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  const result = safeInteger(value, path);
  if (result < 0) fail("must be non-negative", path);
  return result;
}

function unsigned32(value: unknown, path: string, allowZero: boolean): number {
  const result = integer(value, path);
  if (result < (allowZero ? 0 : 1) || result > 0xffff_ffff) {
    fail(`must be ${allowZero ? "an" : "a non-zero"} unsigned 32-bit integer`, path);
  }
  return result;
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    fail("must be a non-empty string when present", path);
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail("must be a non-empty string", path);
  return value;
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) fail("must be a positive integer", path);
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail("must be a non-negative integer", path);
}

function fail(message: string, path: string): never {
  throw new SaveValidationError(message, path);
}
