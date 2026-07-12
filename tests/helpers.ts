import {
  DEFAULT_PROTOTYPE_CONFIG,
  type DeepPartial,
  type PrototypeConfig,
  type PrototypeConfigSection,
} from "../src/tidebound/config/prototypeConfig.ts";
import type { ShipState, TravelSegment } from "../src/tidebound/core/types.ts";

export function makeConfig(patch: DeepPartial<PrototypeConfig> = {}): PrototypeConfig {
  const config: PrototypeConfig = {
    navigation: { ...DEFAULT_PROTOTYPE_CONFIG.navigation },
    world: { ...DEFAULT_PROTOTYPE_CONFIG.world },
    islands: { ...DEFAULT_PROTOTYPE_CONFIG.islands },
    provisions: { ...DEFAULT_PROTOTYPE_CONFIG.provisions },
    returnRisk: { ...DEFAULT_PROTOTYPE_CONFIG.returnRisk },
    overlays: { ...DEFAULT_PROTOTYPE_CONFIG.overlays },
    movement: { ...DEFAULT_PROTOTYPE_CONFIG.movement },
    simulation: { ...DEFAULT_PROTOTYPE_CONFIG.simulation },
  };

  for (const section of Object.keys(patch) as PrototypeConfigSection[]) {
    const sectionPatch = patch[section];
    if (sectionPatch !== undefined) Object.assign(config[section], sectionPatch);
  }
  return config;
}

export function makeShip(provisions = 5, provisionAccumulator = 0): ShipState {
  return {
    worldX: 16,
    worldY: 16,
    heading: 0,
    speed: 0,
    currentTileX: 0,
    currentTileY: 0,
    provisions,
    provisionAccumulator,
  };
}

export function makeSegment(
  tileX: number,
  tileY: number,
  distancePixels: number,
  tileSize = DEFAULT_PROTOTYPE_CONFIG.navigation.tileSize,
): TravelSegment {
  const fromWorldX = tileX * tileSize;
  const fromWorldY = tileY * tileSize + tileSize / 2;
  return {
    fromWorldX,
    fromWorldY,
    toWorldX: fromWorldX + distancePixels,
    toWorldY: fromWorldY,
    distancePixels,
    tileX,
    tileY,
  };
}
