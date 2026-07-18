import {
  DEFAULT_PROTOTYPE_CONFIG,
  type DeepPartial,
  type PrototypeConfig,
  type PrototypeConfigSection,
} from "../config/prototypeConfig";
import {
  WRAPPING_WORLD_TOPOLOGY,
  type WorldTopologyDefinition,
} from "./WorldTopology";

export type WorldGenerationProfileId = "P0" | "P1" | "P2" | "P2-500";

export interface WorldGenerationProfile {
  readonly id: WorldGenerationProfileId;
  readonly purpose: string;
  readonly areaMultiplier: number;
  readonly dimensions: Readonly<{ width: number; height: number }>;
  readonly topology: Readonly<WorldTopologyDefinition>;
  readonly density: Readonly<{ islandCount: number; islandsPerTenThousandTiles: number }>;
  readonly islandSize: Readonly<{ minRadius: number; maxRadius: number }>;
  readonly archipelago: Readonly<{ clusters: number; radius: number; bias: number }>;
  readonly minimumChannel: Readonly<{ width: number; homeClearance: number }>;
  readonly placementAttemptLimit: number;
  readonly config: PrototypeConfig;
  readonly nonDefaultSettings: DeepPartial<PrototypeConfig>;
}

function cloneDefaults(): PrototypeConfig {
  return {
    navigation: { ...DEFAULT_PROTOTYPE_CONFIG.navigation },
    world: { ...DEFAULT_PROTOTYPE_CONFIG.world },
    islands: { ...DEFAULT_PROTOTYPE_CONFIG.islands },
    provisions: { ...DEFAULT_PROTOTYPE_CONFIG.provisions },
    returnRisk: { ...DEFAULT_PROTOTYPE_CONFIG.returnRisk },
    overlays: { ...DEFAULT_PROTOTYPE_CONFIG.overlays },
    movement: { ...DEFAULT_PROTOTYPE_CONFIG.movement },
    simulation: { ...DEFAULT_PROTOTYPE_CONFIG.simulation },
  };
}

function createProfile(
  id: WorldGenerationProfileId,
  purpose: string,
  areaMultiplier: number,
  nonDefaultSettings: DeepPartial<PrototypeConfig>,
): WorldGenerationProfile {
  const config = cloneDefaults();
  for (const section of Object.keys(nonDefaultSettings) as PrototypeConfigSection[]) {
    const patch = nonDefaultSettings[section];
    if (patch !== undefined) Object.assign(config[section], patch);
  }
  const tileCount = config.world.width * config.world.height;
  return Object.freeze({
    id,
    purpose,
    areaMultiplier,
    dimensions: Object.freeze({ width: config.world.width, height: config.world.height }),
    topology: WRAPPING_WORLD_TOPOLOGY,
    density: Object.freeze({
      islandCount: config.islands.count,
      islandsPerTenThousandTiles: config.islands.count * 10_000 / tileCount,
    }),
    islandSize: Object.freeze({
      minRadius: config.islands.minRadius,
      maxRadius: config.islands.maxRadius,
    }),
    archipelago: Object.freeze({
      clusters: config.islands.archipelagoClusters,
      radius: config.islands.archipelagoRadius,
      bias: config.islands.archipelagoBias,
    }),
    minimumChannel: Object.freeze({
      width: config.islands.minimumChannelWidth,
      homeClearance: config.islands.homeClearance,
    }),
    placementAttemptLimit: config.islands.placementAttempts,
    config,
    nonDefaultSettings,
  });
}

export const WORLD_GENERATION_PROFILES: Readonly<Record<WorldGenerationProfileId, WorldGenerationProfile>> = Object.freeze({
  P0: createProfile("P0", "Current 96 by 96 prototype baseline.", 1, {}),
  P1: createProfile("P1", "Four-times-area integration profile.", 4, {
    world: { width: 192, height: 192 },
    islands: {
      count: 32,
      archipelagoClusters: 4,
      archipelagoRadius: 28,
      archipelagoBias: 0.35,
    },
  }),
  P2: createProfile("P2", "Four-times-width-and-height large-world profile.", 16, {
    world: { width: 384, height: 384 },
    islands: {
      count: 300,
      minRadius: 1,
      maxRadius: 3,
      minimumChannelWidth: 4,
      homeClearance: 1,
      placementAttempts: 48,
      archipelagoClusters: 24,
      archipelagoRadius: 24,
      archipelagoBias: 0.6,
    },
  }),
  "P2-500": createProfile("P2-500", "Bounded 500-island capacity stress profile.", 16, {
    world: { width: 384, height: 384 },
    islands: {
      count: 500,
      minRadius: 1,
      maxRadius: 2.25,
      minimumChannelWidth: 3,
      homeClearance: 1,
      placementAttempts: 48,
      archipelagoClusters: 32,
      archipelagoRadius: 24,
      archipelagoBias: 0.5,
    },
  }),
});

export function createWorldGenerationProfileConfig(id: WorldGenerationProfileId): PrototypeConfig {
  const source = WORLD_GENERATION_PROFILES[id].config;
  return {
    navigation: { ...source.navigation },
    world: { ...source.world },
    islands: { ...source.islands },
    provisions: { ...source.provisions },
    returnRisk: { ...source.returnRisk },
    overlays: { ...source.overlays },
    movement: { ...source.movement },
    simulation: { ...source.simulation },
  };
}

function generationSettingsJson(
  config: PrototypeConfig,
  topology: Readonly<WorldTopologyDefinition>,
): string {
  return JSON.stringify({
    chunkSize: config.navigation.chunkSize,
    topology: { x: topology.x, y: topology.y },
    world: {
      width: config.world.width,
      height: config.world.height,
      homeIslandRadius: config.world.homeIslandRadius,
      supportedWaterRadius: config.world.supportedWaterRadius,
      supportedBoundaryNoise: config.world.supportedBoundaryNoise,
      supportedNoiseScale: config.world.supportedNoiseScale,
      shallowWaterRadius: config.world.shallowWaterRadius,
      hiddenObstacleRadius: config.world.hiddenObstacleRadius,
      hiddenObstacleDistance: config.world.hiddenObstacleDistance,
    },
    islands: { ...config.islands },
  });
}

/** Returns a stable label for manifests while preserving arbitrary developer configs. */
export function worldGenerationProfileIdForConfig(
  config: PrototypeConfig,
  topology: Readonly<WorldTopologyDefinition> = WRAPPING_WORLD_TOPOLOGY,
): string {
  const settings = generationSettingsJson(config, topology);
  for (const profile of Object.values(WORLD_GENERATION_PROFILES)) {
    if (generationSettingsJson(profile.config, profile.topology) === settings) return profile.id;
  }
  return "custom";
}

/** Small deterministic FNV-1a fingerprint; this is an identity aid, not cryptography. */
export function worldGenerationSettingsFingerprint(
  config: PrototypeConfig,
  topology: Readonly<WorldTopologyDefinition> = WRAPPING_WORLD_TOPOLOGY,
): string {
  const bytes = new TextEncoder().encode(generationSettingsJson(config, topology));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32-${hash.toString(16).padStart(8, "0")}`;
}
