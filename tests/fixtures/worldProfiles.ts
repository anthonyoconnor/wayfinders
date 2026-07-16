import type { PrototypeConfig } from "../../src/wayfinders/config/prototypeConfig";
import {
  WORLD_GENERATION_PROFILES,
  createWorldGenerationProfileConfig,
  type WorldGenerationProfile,
} from "../../src/wayfinders/world/WorldGenerationProfiles";

export type WorldProfileName = "P0" | "P1" | "P2";
export type WorldProfile = WorldGenerationProfile;

/** Test and benchmark fixtures use the same named settings as production. */
export const WORLD_PROFILES: Readonly<Record<WorldProfileName, WorldProfile>> = Object.freeze({
  P0: WORLD_GENERATION_PROFILES.P0,
  P1: WORLD_GENERATION_PROFILES.P1,
  P2: WORLD_GENERATION_PROFILES.P2,
});

export function createWorldProfileConfig(name: WorldProfileName): PrototypeConfig {
  return createWorldGenerationProfileConfig(name);
}
