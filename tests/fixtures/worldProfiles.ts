import {
  DEFAULT_PROTOTYPE_CONFIG,
  type DeepPartial,
  type PrototypeConfig,
  type PrototypeConfigSection,
} from "../../src/wayfinders/config/prototypeConfig";

export type WorldProfileName = "P0" | "P1" | "P2";

export interface WorldProfile {
  readonly name: WorldProfileName;
  readonly purpose: string;
  readonly areaMultiplier: number;
  readonly targetIslandCount: number;
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
  name: WorldProfileName,
  purpose: string,
  areaMultiplier: number,
  targetIslandCount: number,
  nonDefaultSettings: DeepPartial<PrototypeConfig>,
): WorldProfile {
  const config = cloneDefaults();
  for (const section of Object.keys(nonDefaultSettings) as PrototypeConfigSection[]) {
    const sectionPatch = nonDefaultSettings[section];
    if (sectionPatch !== undefined) Object.assign(config[section], sectionPatch);
  }
  return Object.freeze({
    name,
    purpose,
    areaMultiplier,
    targetIslandCount,
    config,
    nonDefaultSettings,
  });
}

export const WORLD_PROFILES: Readonly<Record<WorldProfileName, WorldProfile>> = Object.freeze({
  P0: createProfile(
    "P0",
    "Current 96 by 96 prototype baseline.",
    1,
    8,
    {},
  ),
  P1: createProfile(
    "P1",
    "Four-times-area 192 by 192 integration profile.",
    4,
    32,
    {
      world: {
        width: 192,
        height: 192,
      },
      islands: {
        count: 32,
      },
    },
  ),
  P2: createProfile(
    "P2",
    "Four-times-width-and-height 384 by 384 large-world profile.",
    16,
    300,
    {
      world: {
        width: 384,
        height: 384,
      },
      islands: {
        count: 300,
        minRadius: 1,
        maxRadius: 3,
        minimumChannelWidth: 4,
        homeClearance: 1,
        edgeMargin: 3,
        placementAttempts: 48,
      },
    },
  ),
});

export function createWorldProfileConfig(name: WorldProfileName): PrototypeConfig {
  const source = WORLD_PROFILES[name].config;
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
