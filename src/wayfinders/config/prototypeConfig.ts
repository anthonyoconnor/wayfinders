import {
  DEFAULT_GAME_SETTINGS,
  prototypeConfigFromGameSettings,
  type DeepReadonly,
} from "./gameSettings";

export type { DeepReadonly } from "./gameSettings";

export interface PrototypeConfig {
  navigation: {
    tileSize: number;
    artTileSize: number;
    sightRadius: number;
    chunkSize: number;
  };
  world: {
    width: number;
    height: number;
    seed: number;
    homeIslandRadius: number;
    supportedWaterRadius: number;
    supportedBoundaryNoise: number;
    supportedNoiseScale: number;
    shallowWaterRadius: number;
    hiddenObstacleRadius: number;
    hiddenObstacleDistance: number;
    /** Maximum eight-connected Unknown pocket filled after a successful return. */
    maxEnclosedUnknownTiles: number;
    /** Lost idol locations hidden among the world's eligible survey locations. */
    idolCount: number;
  };
  islands: {
    count: number;
    minRadius: number;
    maxRadius: number;
    apronWidth: number;
    minimumChannelWidth: number;
    homeClearance: number;
    placementAttempts: number;
    /** Number of deterministic scatter centres; zero selects fully dispersed placement. */
    archipelagoClusters: number;
    /** Maximum tile radius used when sampling around an archipelago centre. */
    archipelagoRadius: number;
    /** Fraction of bounded placement attempts that prefer an archipelago centre. */
    archipelagoBias: number;
    edgeNoise: number;
    safeCorridorHalfWidth: number;
    highIslandWeight: number;
    lowCayWeight: number;
    atollWeight: number;
    rockySkerryWeight: number;
  };
  provisions: {
    startingBundles: number;
    surveyCost: number;
    supportedCost: number;
    personalCost: number;
    unknownCost: number;
  };
  returnRisk: {
    comfortable: number;
    warning: number;
    critical: number;
  };
  overlays: {
    fogNoise: number;
    fogBlend: number;
    forwardOverlayOpacity: number;
    returnOverlayOpacity: number;
    /** Voyage Sense thread width in world pixels. */
    returnThreadWidth: number;
    /** Maximum world-pixel radius used to round each return-path turn. */
    returnThreadCurveRadius: number;
    /** Half-angle of the heading-centred forward presentation cone. */
    forwardConeHalfAngleDegrees: number;
    /** Cardinal passable-water padding around the minimum-cost return path. */
    returnPathPadding: number;
  };
  movement: {
    shipSpeed: number;
    turnRate: number;
    /** Axis-aligned half-size of the ship's square gameplay collision footprint, in world pixels. */
    shipCollisionHalfExtent: number;
    collisionEpsilon: number;
  };
  simulation: {
    fixedStepMs: number;
    maxFrameDeltaMs: number;
    wreckPresentationSeconds: number;
  };
}

export type PrototypeConfigSection = keyof PrototypeConfig;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepFreeze<T extends object>(value: T): DeepReadonly<T> {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

/** Internal derived template; DEFAULT_GAME_SETTINGS is the only exported default owner. */
const normalGameConfigTemplate: DeepReadonly<PrototypeConfig> = deepFreeze(
  prototypeConfigFromGameSettings(DEFAULT_GAME_SETTINGS),
);

function cloneConfig(config: DeepReadonly<PrototypeConfig>): PrototypeConfig {
  return {
    navigation: { ...config.navigation },
    world: { ...config.world },
    islands: { ...config.islands },
    provisions: { ...config.provisions },
    returnRisk: { ...config.returnRisk },
    overlays: { ...config.overlays },
    movement: { ...config.movement },
    simulation: { ...config.simulation },
  };
}

function cloneDefaults(): PrototypeConfig {
  return cloneConfig(normalGameConfigTemplate);
}

/**
 * The live, mutable tuning object shared by the simulation and developer tools.
 * Callers may mutate leaf values directly; `patchPrototypeConfig` is preferred
 * when a consumer needs invalidation notifications.
 */
export const prototypeConfig: PrototypeConfig = cloneDefaults();

export type ConfigChangeListener = (sections: ReadonlySet<PrototypeConfigSection>) => void;

const listeners = new Set<ConfigChangeListener>();
const configSections = Object.keys(normalGameConfigTemplate) as PrototypeConfigSection[];
const configSectionSet = new Set<PrototypeConfigSection>(configSections);

export function onPrototypeConfigChanged(listener: ConfigChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function patchPrototypeConfig(patch: DeepPartial<PrototypeConfig>): ReadonlySet<PrototypeConfigSection> {
  const candidate = cloneConfig(prototypeConfig);
  const changed = new Set<PrototypeConfigSection>();

  for (const [rawSection, sectionPatch] of Object.entries(patch as Record<string, unknown>)) {
    if (sectionPatch === undefined) continue;
    if (!configSectionSet.has(rawSection as PrototypeConfigSection)) {
      throw new RangeError(`Unknown prototype config section: ${rawSection}`);
    }
    if (sectionPatch === null || typeof sectionPatch !== "object" || Array.isArray(sectionPatch)) {
      throw new TypeError(`Prototype config section ${rawSection} must be an object`);
    }

    const section = rawSection as PrototypeConfigSection;
    const candidateSection = candidate[section] as unknown as Record<string, number>;
    const currentSection = prototypeConfig[section] as unknown as Record<string, number>;
    const defaultSection = normalGameConfigTemplate[section] as unknown as Readonly<Record<string, number>>;
    let sectionChanged = false;

    for (const [key, value] of Object.entries(sectionPatch)) {
      if (!Object.prototype.hasOwnProperty.call(defaultSection, key)) {
        throw new RangeError(`Unknown prototype config value: ${rawSection}.${key}`);
      }
      candidateSection[key] = value as number;
      sectionChanged ||= !Object.is(currentSection[key], value);
    }

    if (sectionChanged) changed.add(section);
  }

  // Validate the complete prospective configuration before mutating the shared
  // live object, so a bad multi-section patch cannot be partially applied.
  validatePrototypeConfig(candidate);

  if (changed.size > 0) {
    for (const section of changed) Object.assign(prototypeConfig[section], candidate[section]);
    for (const listener of listeners) listener(changed);
  }

  return changed;
}

export function resetPrototypeConfig(): void {
  const defaults = cloneDefaults();
  const changed = new Set<PrototypeConfigSection>();

  for (const section of configSections) {
    const currentSection = prototypeConfig[section] as unknown as Record<string, number>;
    const defaultSection = defaults[section] as unknown as Record<string, number>;
    let sectionChanged = false;

    for (const key of Object.keys(currentSection)) {
      if (!Object.prototype.hasOwnProperty.call(defaultSection, key)) {
        delete currentSection[key];
        sectionChanged = true;
      }
    }
    for (const [key, value] of Object.entries(defaultSection)) {
      sectionChanged ||= !Object.is(currentSection[key], value);
      currentSection[key] = value;
    }
    if (sectionChanged) changed.add(section);
  }

  if (changed.size > 0) {
    for (const listener of listeners) listener(changed);
  }
}

export function validatePrototypeConfig(config: PrototypeConfig = prototypeConfig): void {
  const finite = (value: number, label: string): void => {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  };
  const positive = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  };
  const nonNegative = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
  };
  const positiveInteger = (value: number, label: string): void => {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  };
  const nonNegativeInteger = (value: number, label: string): void => {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
  };
  const unitInterval = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1`);
  };

  positive(config.navigation.tileSize, "navigation.tileSize");
  positive(config.navigation.artTileSize, "navigation.artTileSize");
  nonNegativeInteger(config.navigation.sightRadius, "navigation.sightRadius");
  positiveInteger(config.navigation.chunkSize, "navigation.chunkSize");

  positiveInteger(config.world.width, "world.width");
  positiveInteger(config.world.height, "world.height");
  if (!Number.isSafeInteger(config.world.seed)) throw new RangeError("world.seed must be a safe integer");
  positiveInteger(config.world.homeIslandRadius, "world.homeIslandRadius");
  nonNegative(config.world.supportedWaterRadius, "world.supportedWaterRadius");
  nonNegative(config.world.supportedBoundaryNoise, "world.supportedBoundaryNoise");
  positive(config.world.supportedNoiseScale, "world.supportedNoiseScale");
  positiveInteger(config.world.shallowWaterRadius, "world.shallowWaterRadius");
  positiveInteger(config.world.hiddenObstacleRadius, "world.hiddenObstacleRadius");
  nonNegative(config.world.hiddenObstacleDistance, "world.hiddenObstacleDistance");
  nonNegativeInteger(config.world.maxEnclosedUnknownTiles, "world.maxEnclosedUnknownTiles");
  positiveInteger(config.world.idolCount, "world.idolCount");
  positiveInteger(config.islands.count, "islands.count");
  positive(config.islands.minRadius, "islands.minRadius");
  positive(config.islands.maxRadius, "islands.maxRadius");
  positive(config.islands.apronWidth, "islands.apronWidth");
  nonNegative(config.islands.minimumChannelWidth, "islands.minimumChannelWidth");
  nonNegative(config.islands.homeClearance, "islands.homeClearance");
  positiveInteger(config.islands.placementAttempts, "islands.placementAttempts");
  nonNegativeInteger(config.islands.archipelagoClusters, "islands.archipelagoClusters");
  positive(config.islands.archipelagoRadius, "islands.archipelagoRadius");
  unitInterval(config.islands.archipelagoBias, "islands.archipelagoBias");
  unitInterval(config.islands.edgeNoise, "islands.edgeNoise");
  nonNegative(config.islands.safeCorridorHalfWidth, "islands.safeCorridorHalfWidth");
  nonNegative(config.islands.highIslandWeight, "islands.highIslandWeight");
  nonNegative(config.islands.lowCayWeight, "islands.lowCayWeight");
  nonNegative(config.islands.atollWeight, "islands.atollWeight");
  nonNegative(config.islands.rockySkerryWeight, "islands.rockySkerryWeight");
  if (config.islands.maxRadius < config.islands.minRadius) {
    throw new RangeError("islands.maxRadius must be at least islands.minRadius");
  }
  if (
    config.islands.highIslandWeight
    + config.islands.lowCayWeight
    + config.islands.atollWeight
    + config.islands.rockySkerryWeight <= 0
  ) {
    throw new RangeError("at least one island archetype weight must be positive");
  }

  nonNegativeInteger(config.provisions.startingBundles, "provisions.startingBundles");
  positiveInteger(config.provisions.surveyCost, "provisions.surveyCost");
  nonNegative(config.provisions.supportedCost, "provisions.supportedCost");
  nonNegative(config.provisions.personalCost, "provisions.personalCost");
  // All travel costs may be zero for developer testing sessions.
  nonNegative(config.provisions.unknownCost, "provisions.unknownCost");
  const travelCosts = [
    config.provisions.supportedCost,
    config.provisions.personalCost,
    config.provisions.unknownCost,
  ];
  const hasExactGuidanceScale = [1, 10, 100, 1_000, 10_000].some((scale) => (
    travelCosts.every((cost) => Math.abs(cost * scale - Math.round(cost * scale)) <= 1e-9)
  ));
  if (!hasExactGuidanceScale) {
    throw new RangeError("provision travel costs must use at most four decimal places");
  }

  nonNegative(config.returnRisk.comfortable, "returnRisk.comfortable");
  nonNegative(config.returnRisk.warning, "returnRisk.warning");
  nonNegative(config.returnRisk.critical, "returnRisk.critical");
  if (config.returnRisk.comfortable < config.returnRisk.warning || config.returnRisk.warning < config.returnRisk.critical) {
    throw new RangeError("return-risk thresholds must be ordered comfortable >= warning >= critical");
  }

  unitInterval(config.overlays.fogNoise, "overlays.fogNoise");
  unitInterval(config.overlays.fogBlend, "overlays.fogBlend");
  unitInterval(config.overlays.forwardOverlayOpacity, "overlays.forwardOverlayOpacity");
  unitInterval(config.overlays.returnOverlayOpacity, "overlays.returnOverlayOpacity");
  positive(config.overlays.returnThreadWidth, "overlays.returnThreadWidth");
  nonNegative(config.overlays.returnThreadCurveRadius, "overlays.returnThreadCurveRadius");
  positive(config.overlays.forwardConeHalfAngleDegrees, "overlays.forwardConeHalfAngleDegrees");
  if (config.overlays.forwardConeHalfAngleDegrees > 180) {
    throw new RangeError("overlays.forwardConeHalfAngleDegrees must be at most 180");
  }
  nonNegativeInteger(config.overlays.returnPathPadding, "overlays.returnPathPadding");

  nonNegative(config.movement.shipSpeed, "movement.shipSpeed");
  nonNegative(config.movement.turnRate, "movement.turnRate");
  positive(config.movement.shipCollisionHalfExtent, "movement.shipCollisionHalfExtent");
  positive(config.movement.collisionEpsilon, "movement.collisionEpsilon");

  positive(config.simulation.fixedStepMs, "simulation.fixedStepMs");
  positive(config.simulation.maxFrameDeltaMs, "simulation.maxFrameDeltaMs");
  positive(config.simulation.wreckPresentationSeconds, "simulation.wreckPresentationSeconds");

  finite(config.world.seed, "world.seed");

  if (config.world.shallowWaterRadius < config.world.homeIslandRadius) {
    throw new RangeError("world.shallowWaterRadius must be at least world.homeIslandRadius");
  }
  if (config.world.supportedWaterRadius < config.world.shallowWaterRadius) {
    throw new RangeError("world.supportedWaterRadius must be at least world.shallowWaterRadius");
  }
  const startingRegionDiameter = config.world.shallowWaterRadius * 2 + 1;
  if (config.world.width < startingRegionDiameter || config.world.height < startingRegionDiameter) {
    throw new RangeError("world dimensions must contain the complete shallow-water starting region");
  }
  const maximumPaintScale = 1.12 + config.islands.edgeNoise / 2;
  const legacyIslandEnvelope = Math.max(
    config.world.hiddenObstacleRadius + config.islands.apronWidth,
    config.world.hiddenObstacleRadius * maximumPaintScale,
  );
  const configuredIslandEnvelope = Math.max(
    config.islands.maxRadius + config.islands.apronWidth,
    config.islands.maxRadius * maximumPaintScale,
  );
  const islandExtent = Math.ceil(Math.max(legacyIslandEnvelope, configuredIslandEnvelope));
  // A periodic footprint must be strictly smaller than one canonical span so
  // it cannot collide with another image of itself.
  const scatteredIslandMinimumDimension = islandExtent * 2 + 2;
  if (config.world.width < scatteredIslandMinimumDimension || config.world.height < scatteredIslandMinimumDimension) {
    throw new RangeError("world dimensions must exceed the largest configured island footprint");
  }
  if (config.movement.collisionEpsilon >= config.navigation.tileSize) {
    throw new RangeError("movement.collisionEpsilon must be smaller than navigation.tileSize");
  }
  if (config.movement.shipCollisionHalfExtent >= config.navigation.tileSize / 2) {
    throw new RangeError("movement.shipCollisionHalfExtent must be smaller than half navigation.tileSize");
  }
  if (config.simulation.maxFrameDeltaMs < config.simulation.fixedStepMs) {
    throw new RangeError("simulation.maxFrameDeltaMs must be at least simulation.fixedStepMs");
  }
}
