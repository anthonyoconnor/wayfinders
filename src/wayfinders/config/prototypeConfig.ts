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
    edgeMargin: number;
    placementAttempts: number;
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

export const DEFAULT_PROTOTYPE_CONFIG: DeepReadonly<PrototypeConfig> = deepFreeze<PrototypeConfig>({
  navigation: {
    tileSize: 32,
    artTileSize: 16,
    sightRadius: 5,
    chunkSize: 32,
  },
  world: {
    width: 96,
    height: 96,
    seed: 13_371,
    homeIslandRadius: 4,
    supportedWaterRadius: 14,
    supportedBoundaryNoise: 2.5,
    supportedNoiseScale: 7,
    shallowWaterRadius: 7,
    hiddenObstacleRadius: 2,
    hiddenObstacleDistance: 24,
    maxEnclosedUnknownTiles: 2,
    idolCount: 3,
  },
  islands: {
    count: 8,
    minRadius: 2,
    maxRadius: 6,
    apronWidth: 1.25,
    minimumChannelWidth: 11,
    homeClearance: 2,
    edgeMargin: 6,
    placementAttempts: 64,
    edgeNoise: 0.24,
    safeCorridorHalfWidth: 2,
    highIslandWeight: 1,
    lowCayWeight: 1,
    atollWeight: 1,
    rockySkerryWeight: 1,
  },
  provisions: {
    startingBundles: 12,
    surveyCost: 2,
    supportedCost: 0,
    // Zero disables provision consumption in Personal water, which is useful for testing.
    personalCost: 0.1,
    // Zero likewise makes Unknown travel free; range overlays then have no finite outer frontier.
    unknownCost: 0.2,
  },
  returnRisk: {
    comfortable: 3,
    warning: 1,
    critical: 0,
  },
  overlays: {
    fogNoise: 0.18,
    fogBlend: 0.12,
    forwardOverlayOpacity: 0.55,
    returnOverlayOpacity: 0.35,
    forwardConeHalfAngleDegrees: 60,
    returnPathPadding: 1,
  },
  movement: {
    shipSpeed: 2.5,
    turnRate: 180,
    shipCollisionHalfExtent: 14,
    collisionEpsilon: 0.001,
  },
  simulation: {
    fixedStepMs: 1000 / 30,
    maxFrameDeltaMs: 100,
    wreckPresentationSeconds: 4,
  },
});

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
  return cloneConfig(DEFAULT_PROTOTYPE_CONFIG);
}

/**
 * The live, mutable tuning object shared by the simulation and developer tools.
 * Callers may mutate leaf values directly; `patchPrototypeConfig` is preferred
 * when a consumer needs invalidation notifications.
 */
export const prototypeConfig: PrototypeConfig = cloneDefaults();

export type ConfigChangeListener = (sections: ReadonlySet<PrototypeConfigSection>) => void;

const listeners = new Set<ConfigChangeListener>();
const configSections = Object.keys(DEFAULT_PROTOTYPE_CONFIG) as PrototypeConfigSection[];
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
    const defaultSection = DEFAULT_PROTOTYPE_CONFIG[section] as unknown as Readonly<Record<string, number>>;
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
  nonNegative(config.islands.edgeMargin, "islands.edgeMargin");
  positiveInteger(config.islands.placementAttempts, "islands.placementAttempts");
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
  const islandCenterMargin = Math.ceil(
    Math.max(legacyIslandEnvelope, configuredIslandEnvelope) + config.islands.edgeMargin,
  );
  const scatteredIslandMinimumDimension = islandCenterMargin * 2 + 1;
  if (config.world.width < scatteredIslandMinimumDimension || config.world.height < scatteredIslandMinimumDimension) {
    throw new RangeError("world dimensions are too small for the configured scattered islands");
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
