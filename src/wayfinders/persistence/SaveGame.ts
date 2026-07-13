import {
  DEFAULT_PROTOTYPE_CONFIG,
  validatePrototypeConfig,
  type DeepReadonly,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import type { ShipState, ShipwreckState } from "../core/types";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  isCurrentFishingShoalId,
  type FishingShoalSightedSaveRecordV1,
} from "../exploration/FishingShoalContracts";
import { KnowledgeState } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";

export const ACCEPTED_BASELINE_SAVE_SCHEMA_VERSION = 1 as const;
export const SAVE_SCHEMA_VERSION = 2 as const;
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

export interface SaveGameV1<TDiscovery extends DiscoverySaveRecord = DiscoverySaveRecord> {
  /** Historical discriminator: never tie a frozen schema type to the latest version constant. */
  schemaVersion: 1;
  savedAt: number;
  world: {
    seed: number;
    generatorVersion: 1;
    generationConfig: GenerationConfigV1;
  };
  generation: number;
  expedition: {
    id: number;
    active: boolean;
    successfulReturns: number;
    failedExpeditions: number;
    pendingRespawn: PendingRespawnSaveState | null;
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
  /**
   * Reserved for a later schema; the accepted baseline has no runtime terrain
   * edits.
   */
  terrainPatches: [];
}

export type SaveGameV2<TDiscovery extends DiscoverySaveRecord = DiscoverySaveRecord> =
  Omit<SaveGameV1<TDiscovery>, "schemaVersion" | "world"> & {
    schemaVersion: 2;
    world: SaveGameV1<TDiscovery>["world"] & {
      contentVersions: {
        fishingShoals: typeof FISHING_SHOAL_CONTENT_VERSION;
      };
    };
    fishingShoals: {
      provisional: FishingShoalSightedSaveRecordV1[];
    };
  };

export type SaveGame<TDiscovery extends DiscoverySaveRecord = DiscoverySaveRecord> = SaveGameV2<TDiscovery>;

type SaveMigration = (value: unknown) => unknown;

/**
 * Adjacent schema migrations keyed by their source version. New authoritative
 * state adds one real step here; missing steps fail closed instead of guessing.
 */
const SAVE_MIGRATIONS: ReadonlyMap<number, SaveMigration> = new Map([
  [1, migrateSaveGameV1ToV2],
]);

export interface KnowledgeCell {
  state: KnowledgeState;
  expeditionStamp: number;
}

export interface DecodedKnowledge {
  knowledge: Uint8Array;
  expeditionStamps: Uint32Array;
}

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

/**
 * Loads any supported historical schema through explicit adjacent migrations,
 * then validates the canonical current schema. Migration steps must be pure;
 * callers may retain the original record when preserving browser storage.
 */
export function migrateSaveGame(value: unknown): SaveGame {
  let current = value;
  let schemaVersion = readSaveSchemaVersion(current);
  if (
    schemaVersion < ACCEPTED_BASELINE_SAVE_SCHEMA_VERSION
    || schemaVersion > SAVE_SCHEMA_VERSION
  ) throw new UnsupportedSaveSchemaVersionError(schemaVersion);

  while (schemaVersion < SAVE_SCHEMA_VERSION) {
    const migration = SAVE_MIGRATIONS.get(schemaVersion);
    if (!migration) throw new UnsupportedSaveSchemaVersionError(schemaVersion);
    const migrated = migration(current);
    const migratedVersion = readSaveSchemaVersion(migrated);
    if (migratedVersion !== schemaVersion + 1) {
      fail(
        `migration from version ${schemaVersion} must produce version ${schemaVersion + 1}`,
        "save.schemaVersion",
      );
    }
    current = migrated;
    schemaVersion = migratedVersion;
  }

  return parseSaveGameV2(current);
}

/** Main load entrypoint; retained under the established API name. */
export function parseSaveGame(value: unknown): SaveGame {
  return migrateSaveGame(value);
}

/** Validates the immutable accepted-baseline schema without migrating it. */
export function parseSaveGameV1(value: unknown): SaveGameV1 {
  const root = record(value, "save");
  const schemaVersion = integer(root.schemaVersion, "save.schemaVersion");
  if (schemaVersion !== 1) throw new UnsupportedSaveSchemaVersionError(schemaVersion);

  nonNegativeFinite(root.savedAt, "save.savedAt");
  const world = record(root.world, "save.world");
  const seed = safeInteger(world.seed, "save.world.seed");
  const generatorVersion = integer(world.generatorVersion, "save.world.generatorVersion");
  if (generatorVersion !== 1) {
    throw new UnsupportedWorldGeneratorVersionError(generatorVersion);
  }
  const generationConfig = validateGenerationConfig(world.generationConfig, seed);
  const tileCount = generationConfig.world.width * generationConfig.world.height;

  const generation = positiveSafeInteger(root.generation, "save.generation");
  const expedition = record(root.expedition, "save.expedition");
  const expeditionId = unsigned32(expedition.id, "save.expedition.id", false);
  const expeditionActive = boolean(expedition.active, "save.expedition.active");
  nonNegativeSafeInteger(expedition.successfulReturns, "save.expedition.successfulReturns");
  nonNegativeSafeInteger(expedition.failedExpeditions, "save.expedition.failedExpeditions");
  const pendingRespawn = validatePendingRespawn(expedition.pendingRespawn, expeditionId, generation, expeditionActive);

  const ship = validateShip(root.ship, generationConfig);
  if (pendingRespawn && ship.provisions !== 0) fail("must have zero provisions during a wreck hold", "save.ship.provisions");

  const knowledge = record(root.knowledge, "save.knowledge");
  if (knowledge.encoding !== "non-unknown-runs-v1") fail("has an unsupported encoding", "save.knowledge.encoding");
  validateKnowledgeRuns(tileCount, knowledge.runs);
  validateExpeditionKnowledge(knowledge.runs, expeditionId, expeditionActive);

  const wrecks = validateWrecks(root.wrecks, generationConfig);
  for (let index = 0; index < wrecks.length; index++) {
    if (wrecks[index].generation > generation) {
      fail("cannot be later than the current generation", `save.wrecks[${index}].generation`);
    }
  }
  if (pendingRespawn) validatePendingWreck(pendingRespawn, wrecks, ship);

  const discoveries = record(root.discoveries, "save.discoveries");
  const provisional = validateDiscoveries(
    discoveries.provisional,
    false,
    generationConfig,
    expeditionId,
    generation,
    "save.discoveries.provisional",
  );
  const returned = validateDiscoveries(
    discoveries.returned,
    true,
    generationConfig,
    expeditionId,
    generation,
    "save.discoveries.returned",
  );
  if (provisional.length > 0 && !expeditionActive) {
    fail("requires an active expedition", "save.discoveries.provisional");
  }
  const discoveryIds = new Set<number>();
  for (const discovery of [...provisional, ...returned]) {
    if (discoveryIds.has(discovery.id)) fail(`contains duplicate discovery id ${discovery.id}`, "save.discoveries");
    discoveryIds.add(discovery.id);
  }

  if (!Array.isArray(root.terrainPatches) || root.terrainPatches.length !== 0) {
    fail("must be an empty array in schema version 1", "save.terrainPatches");
  }

  return value as SaveGameV1;
}

/** Validates the GP-1.1 schema after the migration chain reaches version two. */
export function parseSaveGameV2(value: unknown): SaveGameV2 {
  const root = record(value, "save");
  const schemaVersion = integer(root.schemaVersion, "save.schemaVersion");
  if (schemaVersion !== 2) throw new UnsupportedSaveSchemaVersionError(schemaVersion);

  const world = record(root.world, "save.world");
  const contentVersions = record(world.contentVersions, "save.world.contentVersions");
  const fishingShoalContentVersion = integer(
    contentVersions.fishingShoals,
    "save.world.contentVersions.fishingShoals",
  );
  if (fishingShoalContentVersion !== FISHING_SHOAL_CONTENT_VERSION) {
    throw new UnsupportedFishingShoalContentVersionError(fishingShoalContentVersion);
  }

  const { contentVersions: _contentVersions, ...baselineWorld } = world;
  parseSaveGameV1({ ...root, schemaVersion: 1, world: baselineWorld });

  const generation = positiveSafeInteger(root.generation, "save.generation");
  const expedition = record(root.expedition, "save.expedition");
  const expeditionId = unsigned32(expedition.id, "save.expedition.id", false);
  const expeditionActive = boolean(expedition.active, "save.expedition.active");
  const fishingShoals = record(root.fishingShoals, "save.fishingShoals");
  validateFishingShoalSightings(
    fishingShoals.provisional,
    expeditionId,
    generation,
    expeditionActive,
  );

  return value as SaveGameV2;
}

export function isSaveGame(value: unknown): boolean {
  try {
    parseSaveGame(value);
    return true;
  } catch {
    return false;
  }
}

export type SaveGameCompatibility = "loadable" | "unsupported-newer" | "invalid";

/** Classifies a stored slot without mutating or replacing it. */
export function classifySaveGame(value: unknown): SaveGameCompatibility {
  try {
    migrateSaveGame(value);
    return "loadable";
  } catch (error) {
    if (
      error instanceof UnsupportedSaveSchemaVersionError
      && error.version > SAVE_SCHEMA_VERSION
    ) return "unsupported-newer";
    if (
      error instanceof UnsupportedFishingShoalContentVersionError
      && error.version > FISHING_SHOAL_CONTENT_VERSION
    ) return "unsupported-newer";
    return "invalid";
  }
}

function migrateSaveGameV1ToV2(value: unknown): SaveGameV2 {
  const baseline = structuredClone(parseSaveGameV1(value));
  return {
    ...baseline,
    schemaVersion: 2,
    world: {
      ...baseline.world,
      contentVersions: { fishingShoals: FISHING_SHOAL_CONTENT_VERSION },
    },
    fishingShoals: { provisional: [] },
  };
}

function validateFishingShoalSightings(
  value: unknown,
  expeditionId: number,
  generation: number,
  expeditionActive: boolean,
): asserts value is FishingShoalSightedSaveRecordV1[] {
  if (!Array.isArray(value)) fail("must be an array", "save.fishingShoals.provisional");
  let previousId = "";
  for (let index = 0; index < value.length; index++) {
    const path = `save.fishingShoals.provisional[${index}]`;
    const item = record(value[index], path);
    const id = requiredString(item.id, `${path}.id`);
    if (!isCurrentFishingShoalId(id)) fail("has an invalid or unsupported fishing-shoal ID", `${path}.id`);
    if (id <= previousId) fail("must be uniquely sorted by fishing-shoal ID", `${path}.id`);
    previousId = id;
    if (item.state !== "sighted") fail("must be sighted in schema version 2", `${path}.state`);
    const recordExpeditionId = unsigned32(item.expeditionId, `${path}.expeditionId`, false);
    const recordGeneration = positiveSafeInteger(item.generation, `${path}.generation`);
    if (!expeditionActive) fail("requires an active expedition", path);
    if (recordExpeditionId !== expeditionId) fail("must belong to the active expedition", `${path}.expeditionId`);
    if (recordGeneration !== generation) fail("must belong to the current generation", `${path}.generation`);
  }
}

function readSaveSchemaVersion(value: unknown): number {
  return integer(record(value, "save").schemaVersion, "save.schemaVersion");
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

function validateWrecks(value: unknown, config: GenerationConfigV1): ShipwreckState[] {
  if (!Array.isArray(value)) fail("must be an array", "save.wrecks");
  const ids = new Set<number>();
  return value.map((raw, index) => {
    const path = `save.wrecks[${index}]`;
    const wreck = record(raw, path);
    const result: ShipwreckState = {
      id: positiveSafeInteger(wreck.id, `${path}.id`),
      generation: positiveSafeInteger(wreck.generation, `${path}.generation`),
      expeditionId: unsigned32(wreck.expeditionId, `${path}.expeditionId`, false),
      worldX: finite(wreck.worldX, `${path}.worldX`),
      worldY: finite(wreck.worldY, `${path}.worldY`),
      tileX: integer(wreck.tileX, `${path}.tileX`),
      tileY: integer(wreck.tileY, `${path}.tileY`),
      heading: finite(wreck.heading, `${path}.heading`),
      discovered: boolean(wreck.discovered, `${path}.discovered`),
    };
    if (ids.has(result.id)) fail(`duplicates wreck id ${result.id}`, `${path}.id`);
    ids.add(result.id);
    if (result.heading < 0 || result.heading >= 360) fail("must be in the range 0..<360", `${path}.heading`);
    assertTileInBounds(result.tileX, result.tileY, config, path);
    assertWorldPointMatchesTile(result.worldX, result.worldY, result.tileX, result.tileY, config, path);
    return result;
  });
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
