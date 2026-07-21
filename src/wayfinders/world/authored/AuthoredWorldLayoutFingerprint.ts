import type { PrototypeConfig } from "../../config/prototypeConfig";
import { PILOT_HOME_ISLAND_METADATA } from "../../assets/AuthoredHomeIsland";
import { DEFAULT_WATER_TYPE_CATALOG, WATER_LAYOUT_VERSION } from "../water";
import { WRAPPING_WORLD_TOPOLOGY } from "../WorldTopology";
import { AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID } from "./AuthoredWorldLayoutContracts";

export const AUTHORED_WORLD_LAYOUT_SETTINGS_VERSION = "wayfinders-authored-layout-settings-v1";

function settingsJson(config: PrototypeConfig): string {
  return JSON.stringify({
    version: AUTHORED_WORLD_LAYOUT_SETTINGS_VERSION,
    dimensions: {
      width: config.world.width,
      height: config.world.height,
      chunkSize: config.navigation.chunkSize,
      tileSize: config.navigation.tileSize,
      artTileSize: config.navigation.artTileSize,
    },
    topology: WRAPPING_WORLD_TOPOLOGY,
    home: {
      assetId: PILOT_HOME_ISLAND_METADATA.assetId,
      contractVersion: PILOT_HOME_ISLAND_METADATA.contractVersion,
      runtimeRevision: PILOT_HOME_ISLAND_METADATA.runtimeRevision,
      tileSize: PILOT_HOME_ISLAND_METADATA.tileSize,
    },
    supportedWater: {
      radius: config.world.supportedWaterRadius,
      boundaryNoise: config.world.supportedBoundaryNoise,
      noiseScale: config.world.supportedNoiseScale,
    },
    navigation: {
      shipCollisionHalfExtent: config.movement.shipCollisionHalfExtent,
      collisionEpsilon: config.movement.collisionEpsilon,
    },
    islands: {
      minRadius: config.islands.minRadius,
      maxRadius: config.islands.maxRadius,
      apronWidth: config.islands.apronWidth,
      minimumChannelWidth: config.islands.minimumChannelWidth,
      homeClearance: config.islands.homeClearance,
      safeCorridorHalfWidth: config.islands.safeCorridorHalfWidth,
    },
    completion: { idolCount: config.world.idolCount },
    water: {
      layoutVersion: WATER_LAYOUT_VERSION,
      catalogVersion: DEFAULT_WATER_TYPE_CATALOG.version,
      catalogFingerprint: DEFAULT_WATER_TYPE_CATALOG.fingerprint,
    },
  });
}

export function currentAuthoredWorldLayoutSettingsFingerprint(
  config: PrototypeConfig,
): string {
  const bytes = new TextEncoder().encode(settingsJson(config));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `authored-layout-fnv1a32-${hash.toString(16).padStart(8, "0")}`;
}

export interface AuthoredIslandCapacityProofV1 {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly minimumOuterRadius: number;
  readonly minimumCenterSeparation: number;
  readonly proofCellSpan: number;
  readonly maximumIslandCount: number;
  readonly availableSourceIdCount: number;
}

/** Conservative proof only; placement remains capacity-by-fit. */
export function authoredIslandCapacityProofV1(
  config: PrototypeConfig,
): Readonly<AuthoredIslandCapacityProofV1> {
  const minimumOuterRadius = Math.hypot(1, 1) + config.islands.apronWidth;
  const minimumCenterSeparation = minimumOuterRadius * 2 + config.islands.minimumChannelWidth;
  let proofCellSpan = 1;
  while (Math.hypot(proofCellSpan, proofCellSpan) < minimumCenterSeparation) proofCellSpan++;
  return Object.freeze({
    worldWidth: config.world.width,
    worldHeight: config.world.height,
    minimumOuterRadius,
    minimumCenterSeparation,
    proofCellSpan,
    maximumIslandCount: Math.ceil(config.world.width / proofCellSpan)
      * Math.ceil(config.world.height / proofCellSpan),
    availableSourceIdCount: AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
  });
}
