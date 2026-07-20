import {
  patchPrototypeConfig,
  resetPrototypeConfig,
  type DeepPartial,
  type PrototypeConfig,
  type PrototypeConfigSection,
} from "../src/wayfinders/config/prototypeConfig.ts";
import type { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import type { ShipState, TravelSegment } from "../src/wayfinders/core/types.ts";
import {
  createWorldGenerationProfileConfig,
  type WorldGenerationProfileId,
} from "../src/wayfinders/world/WorldGenerationProfiles.ts";

const P0_TEST_CONFIG = createWorldGenerationProfileConfig("P0");

export function makeConfig(patch: DeepPartial<PrototypeConfig> = {}): PrototypeConfig {
  const config = createWorldGenerationProfileConfig("P0");

  for (const section of Object.keys(patch) as PrototypeConfigSection[]) {
    const sectionPatch = patch[section];
    if (sectionPatch !== undefined) Object.assign(config[section], sectionPatch);
  }
  return config;
}

/** Applies a stable profile as a temporary test-session override. */
export function configurePrototypeForTestProfile(
  id: WorldGenerationProfileId = "P0",
): void {
  resetPrototypeConfig();
  patchPrototypeConfig(id === "P0" ? P0_TEST_CONFIG : createWorldGenerationProfileConfig(id));
}

/** Advances derived guidance to a published result for tests that assert it directly. */
export function drainForwardGuidance(
  simulation: GameSimulation,
  maximumSlices = 2_000,
): number {
  for (let slice = 1; slice <= maximumSlices; slice++) {
    if (simulation.advanceForwardGuidance()) return slice;
    if (!simulation.forwardGuidanceStatus.pending) break;
  }
  throw new Error(
    `Forward guidance did not publish within ${maximumSlices} slices: `
      + JSON.stringify(simulation.forwardGuidanceStatus),
  );
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
  tileSize = P0_TEST_CONFIG.navigation.tileSize,
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
