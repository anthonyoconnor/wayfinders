import type { PrototypeConfig } from "./prototypeConfig";

export interface OverlayVisibilitySettings {
  navigationGrid: boolean;
  collisionBoxes: boolean;
  currentSight: boolean;
  forwardRange: boolean;
  returnViability: boolean;
}

export interface GameSettings {
  world: {
    width: number;
    height: number;
    seed: number;
    chunkSize: number;
    homeIslandRadius: number;
    supportedWaterRadius: number;
    supportedBoundaryNoise: number;
    supportedNoiseScale: number;
    shallowWaterRadius: number;
    hiddenObstacleRadius: number;
    hiddenObstacleDistance: number;
    maxEnclosedUnknownTiles: number;
    idolCount: number;
    islands: PrototypeConfig["islands"];
  };
  audio: {
    enabled: boolean;
    muted: boolean;
    masterVolume: number;
    categoryVolumes: {
      music: number;
      ambience: number;
      sfx: number;
      ui: number;
    };
  };
  overlays: OverlayVisibilitySettings;
  gameplay: {
    sightRadius: number;
    provisions: PrototypeConfig["provisions"];
    returnRisk: PrototypeConfig["returnRisk"];
    movement: PrototypeConfig["movement"];
    fixedStepMs: number;
    maxFrameDeltaMs: number;
  };
  presentation: {
    navigationTileSize: number;
    artTileSize: number;
    wreckPresentationSeconds: number;
    fogNoise: number;
    fogBlend: number;
    forwardOverlayOpacity: number;
    returnOverlayOpacity: number;
    returnThreadWidth: number;
    returnThreadCurveRadius: number;
    forwardConeHalfAngleDegrees: number;
    returnPathPadding: number;
  };
}

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

function deepFreeze<T extends object>(value: T): DeepReadonly<T> {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

/** Canonical normal-new-game defaults. Benchmarks and session overrides do not own these values. */
export const DEFAULT_GAME_SETTINGS: DeepReadonly<GameSettings> = deepFreeze<GameSettings>({
  world: {
    width: 192,
    height: 192,
    seed: 13_371,
    chunkSize: 32,
    homeIslandRadius: 4,
    supportedWaterRadius: 14,
    supportedBoundaryNoise: 2.5,
    supportedNoiseScale: 7,
    shallowWaterRadius: 7,
    hiddenObstacleRadius: 2,
    hiddenObstacleDistance: 24,
    maxEnclosedUnknownTiles: 2,
    idolCount: 3,
    islands: {
      count: 8,
      minRadius: 2,
      maxRadius: 6,
      apronWidth: 1.25,
      minimumChannelWidth: 11,
      homeClearance: 2,
      placementAttempts: 64,
      archipelagoClusters: 0,
      archipelagoRadius: 24,
      archipelagoBias: 0,
      edgeNoise: 0.24,
      safeCorridorHalfWidth: 2,
      highIslandWeight: 1,
      lowCayWeight: 1,
      atollWeight: 1,
      rockySkerryWeight: 1,
    },
  },
  audio: {
    enabled: true,
    muted: false,
    masterVolume: 0.8,
    categoryVolumes: {
      music: 0.42,
      ambience: 0.275,
      sfx: 0.1,
      ui: 0.6,
    },
  },
  overlays: {
    navigationGrid: false,
    collisionBoxes: false,
    currentSight: false,
    forwardRange: false,
    returnViability: true,
  },
  gameplay: {
    sightRadius: 5,
    provisions: {
      startingBundles: 12,
      surveyCost: 2,
      supportedCost: 0,
      personalCost: 0.1,
      unknownCost: 0.2,
    },
    returnRisk: {
      comfortable: 3,
      warning: 1,
      critical: 0,
    },
    movement: {
      shipSpeed: 2.5,
      turnRate: 180,
      shipCollisionHalfExtent: 14,
      collisionEpsilon: 0.001,
    },
    fixedStepMs: 1000 / 30,
    maxFrameDeltaMs: 100,
  },
  presentation: {
    navigationTileSize: 32,
    artTileSize: 16,
    wreckPresentationSeconds: 4,
    fogNoise: 0.18,
    fogBlend: 0.12,
    forwardOverlayOpacity: 0.55,
    returnOverlayOpacity: 0.35,
    returnThreadWidth: 5,
    returnThreadCurveRadius: 10,
    forwardConeHalfAngleDegrees: 60,
    returnPathPadding: 1,
  },
});

/** Converts player defaults into the mutable session-tuning shape consumed by simulation. */
export function prototypeConfigFromGameSettings(
  settings: DeepReadonly<GameSettings>,
): PrototypeConfig {
  return {
    navigation: {
      tileSize: settings.presentation.navigationTileSize,
      artTileSize: settings.presentation.artTileSize,
      sightRadius: settings.gameplay.sightRadius,
      chunkSize: settings.world.chunkSize,
    },
    world: {
      width: settings.world.width,
      height: settings.world.height,
      seed: settings.world.seed,
      homeIslandRadius: settings.world.homeIslandRadius,
      supportedWaterRadius: settings.world.supportedWaterRadius,
      supportedBoundaryNoise: settings.world.supportedBoundaryNoise,
      supportedNoiseScale: settings.world.supportedNoiseScale,
      shallowWaterRadius: settings.world.shallowWaterRadius,
      hiddenObstacleRadius: settings.world.hiddenObstacleRadius,
      hiddenObstacleDistance: settings.world.hiddenObstacleDistance,
      maxEnclosedUnknownTiles: settings.world.maxEnclosedUnknownTiles,
      idolCount: settings.world.idolCount,
    },
    islands: { ...settings.world.islands },
    provisions: { ...settings.gameplay.provisions },
    returnRisk: { ...settings.gameplay.returnRisk },
    overlays: {
      fogNoise: settings.presentation.fogNoise,
      fogBlend: settings.presentation.fogBlend,
      forwardOverlayOpacity: settings.presentation.forwardOverlayOpacity,
      returnOverlayOpacity: settings.presentation.returnOverlayOpacity,
      returnThreadWidth: settings.presentation.returnThreadWidth,
      returnThreadCurveRadius: settings.presentation.returnThreadCurveRadius,
      forwardConeHalfAngleDegrees: settings.presentation.forwardConeHalfAngleDegrees,
      returnPathPadding: settings.presentation.returnPathPadding,
    },
    movement: { ...settings.gameplay.movement },
    simulation: {
      fixedStepMs: settings.gameplay.fixedStepMs,
      maxFrameDeltaMs: settings.gameplay.maxFrameDeltaMs,
      wreckPresentationSeconds: settings.presentation.wreckPresentationSeconds,
    },
  };
}

export function validateGameSettings(settings: DeepReadonly<GameSettings>): void {
  const positive = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  };
  const nonNegative = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
  };
  const positiveInteger = (value: number, label: string): void => {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  };
  const nonNegativeInteger = (value: number, label: string): void => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} must be a non-negative integer`);
    }
  };
  const unitInterval = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${label} must be between 0 and 1`);
    }
  };

  positiveInteger(settings.world.width, "world.width");
  positiveInteger(settings.world.height, "world.height");
  positiveInteger(settings.world.chunkSize, "world.chunkSize");
  if (!Number.isSafeInteger(settings.world.seed)) throw new RangeError("world.seed must be a safe integer");
  positiveInteger(settings.world.homeIslandRadius, "world.homeIslandRadius");
  nonNegative(settings.world.supportedWaterRadius, "world.supportedWaterRadius");
  nonNegative(settings.world.supportedBoundaryNoise, "world.supportedBoundaryNoise");
  positive(settings.world.supportedNoiseScale, "world.supportedNoiseScale");
  positiveInteger(settings.world.shallowWaterRadius, "world.shallowWaterRadius");
  positiveInteger(settings.world.hiddenObstacleRadius, "world.hiddenObstacleRadius");
  nonNegative(settings.world.hiddenObstacleDistance, "world.hiddenObstacleDistance");
  nonNegativeInteger(settings.world.maxEnclosedUnknownTiles, "world.maxEnclosedUnknownTiles");
  positiveInteger(settings.world.idolCount, "world.idolCount");
  const islands = settings.world.islands;
  positiveInteger(islands.count, "world.islands.count");
  positive(islands.minRadius, "world.islands.minRadius");
  positive(islands.maxRadius, "world.islands.maxRadius");
  positive(islands.apronWidth, "world.islands.apronWidth");
  nonNegative(islands.minimumChannelWidth, "world.islands.minimumChannelWidth");
  nonNegative(islands.homeClearance, "world.islands.homeClearance");
  positiveInteger(islands.placementAttempts, "world.islands.placementAttempts");
  nonNegativeInteger(islands.archipelagoClusters, "world.islands.archipelagoClusters");
  positive(islands.archipelagoRadius, "world.islands.archipelagoRadius");
  unitInterval(islands.archipelagoBias, "world.islands.archipelagoBias");
  unitInterval(islands.edgeNoise, "world.islands.edgeNoise");
  nonNegative(islands.safeCorridorHalfWidth, "world.islands.safeCorridorHalfWidth");
  for (const [name, weight] of Object.entries({
    highIslandWeight: islands.highIslandWeight,
    lowCayWeight: islands.lowCayWeight,
    atollWeight: islands.atollWeight,
    rockySkerryWeight: islands.rockySkerryWeight,
  })) nonNegative(weight, `world.islands.${name}`);
  if (islands.maxRadius < islands.minRadius) {
    throw new RangeError("world.islands.maxRadius must be at least world.islands.minRadius");
  }
  if (
    islands.highIslandWeight + islands.lowCayWeight
    + islands.atollWeight + islands.rockySkerryWeight <= 0
  ) throw new RangeError("at least one world island weight must be positive");

  if (typeof settings.audio.enabled !== "boolean") throw new TypeError("audio.enabled must be a boolean");
  if (typeof settings.audio.muted !== "boolean") throw new TypeError("audio.muted must be a boolean");
  unitInterval(settings.audio.masterVolume, "audio.masterVolume");
  for (const category of ["music", "ambience", "sfx", "ui"] as const) {
    unitInterval(settings.audio.categoryVolumes[category], `audio.categoryVolumes.${category}`);
  }
  for (const name of [
    "navigationGrid",
    "collisionBoxes",
    "currentSight",
    "forwardRange",
    "returnViability",
  ] as const) if (typeof settings.overlays[name] !== "boolean") {
    throw new TypeError(`overlays.${name} must be a boolean`);
  }

  nonNegativeInteger(settings.gameplay.sightRadius, "gameplay.sightRadius");
  const provisions = settings.gameplay.provisions;
  nonNegativeInteger(provisions.startingBundles, "gameplay.provisions.startingBundles");
  positiveInteger(provisions.surveyCost, "gameplay.provisions.surveyCost");
  nonNegative(provisions.supportedCost, "gameplay.provisions.supportedCost");
  nonNegative(provisions.personalCost, "gameplay.provisions.personalCost");
  nonNegative(provisions.unknownCost, "gameplay.provisions.unknownCost");
  const exactCostScale = [1, 10, 100, 1_000, 10_000].some((scale) => (
    [provisions.supportedCost, provisions.personalCost, provisions.unknownCost]
      .every((cost) => Math.abs(cost * scale - Math.round(cost * scale)) <= 1e-9)
  ));
  if (!exactCostScale) throw new RangeError("gameplay travel costs must use at most four decimal places");
  const risk = settings.gameplay.returnRisk;
  nonNegative(risk.comfortable, "gameplay.returnRisk.comfortable");
  nonNegative(risk.warning, "gameplay.returnRisk.warning");
  nonNegative(risk.critical, "gameplay.returnRisk.critical");
  if (risk.comfortable < risk.warning || risk.warning < risk.critical) {
    throw new RangeError("gameplay return-risk thresholds must be ordered comfortable >= warning >= critical");
  }
  const movement = settings.gameplay.movement;
  nonNegative(movement.shipSpeed, "gameplay.movement.shipSpeed");
  nonNegative(movement.turnRate, "gameplay.movement.turnRate");
  positive(movement.shipCollisionHalfExtent, "gameplay.movement.shipCollisionHalfExtent");
  positive(movement.collisionEpsilon, "gameplay.movement.collisionEpsilon");
  positive(settings.presentation.navigationTileSize, "presentation.navigationTileSize");
  positive(settings.presentation.artTileSize, "presentation.artTileSize");
  positive(settings.gameplay.fixedStepMs, "gameplay.fixedStepMs");
  positive(settings.gameplay.maxFrameDeltaMs, "gameplay.maxFrameDeltaMs");
  positive(settings.presentation.wreckPresentationSeconds, "presentation.wreckPresentationSeconds");
  unitInterval(settings.presentation.fogNoise, "presentation.fogNoise");
  unitInterval(settings.presentation.fogBlend, "presentation.fogBlend");
  unitInterval(settings.presentation.forwardOverlayOpacity, "presentation.forwardOverlayOpacity");
  unitInterval(settings.presentation.returnOverlayOpacity, "presentation.returnOverlayOpacity");
  positive(settings.presentation.returnThreadWidth, "presentation.returnThreadWidth");
  nonNegative(settings.presentation.returnThreadCurveRadius, "presentation.returnThreadCurveRadius");
  positive(settings.presentation.forwardConeHalfAngleDegrees, "presentation.forwardConeHalfAngleDegrees");
  if (settings.presentation.forwardConeHalfAngleDegrees > 180) {
    throw new RangeError("presentation.forwardConeHalfAngleDegrees must be at most 180");
  }
  nonNegativeInteger(settings.presentation.returnPathPadding, "presentation.returnPathPadding");

  if (settings.world.shallowWaterRadius < settings.world.homeIslandRadius) {
    throw new RangeError("world.shallowWaterRadius must be at least world.homeIslandRadius");
  }
  if (settings.world.supportedWaterRadius < settings.world.shallowWaterRadius) {
    throw new RangeError("world.supportedWaterRadius must be at least world.shallowWaterRadius");
  }
  const startingRegionDiameter = settings.world.shallowWaterRadius * 2 + 1;
  if (settings.world.width < startingRegionDiameter || settings.world.height < startingRegionDiameter) {
    throw new RangeError("world dimensions must contain the complete shallow-water starting region");
  }
  if (movement.collisionEpsilon >= settings.presentation.navigationTileSize) {
    throw new RangeError("gameplay.movement.collisionEpsilon must be smaller than the navigation tile");
  }
  if (movement.shipCollisionHalfExtent >= settings.presentation.navigationTileSize / 2) {
    throw new RangeError("gameplay.movement.shipCollisionHalfExtent must be smaller than half a navigation tile");
  }
  if (settings.gameplay.maxFrameDeltaMs < settings.gameplay.fixedStepMs) {
    throw new RangeError("gameplay.maxFrameDeltaMs must be at least gameplay.fixedStepMs");
  }
}

validateGameSettings(DEFAULT_GAME_SETTINGS);
