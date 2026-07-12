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
  };
  provisions: {
    startingBundles: number;
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
  };
  movement: {
    shipSpeed: number;
    turnRate: number;
    collisionEpsilon: number;
  };
  simulation: {
    fixedStepMs: number;
    maxFrameDeltaMs: number;
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
  },
  provisions: {
    startingBundles: 12,
    supportedCost: 0,
    personalCost: 0.5,
    unknownCost: 1,
  },
  returnRisk: {
    comfortable: 3,
    warning: 1,
    critical: 0,
  },
  overlays: {
    fogNoise: 0.18,
    fogBlend: 0.12,
    forwardOverlayOpacity: 0.18,
    returnOverlayOpacity: 0.35,
  },
  movement: {
    shipSpeed: 2.5,
    turnRate: 180,
    collisionEpsilon: 0.001,
  },
  simulation: {
    fixedStepMs: 1000 / 30,
    maxFrameDeltaMs: 100,
  },
});

function cloneConfig(config: DeepReadonly<PrototypeConfig>): PrototypeConfig {
  return {
    navigation: { ...config.navigation },
    world: { ...config.world },
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

  nonNegativeInteger(config.provisions.startingBundles, "provisions.startingBundles");
  nonNegative(config.provisions.supportedCost, "provisions.supportedCost");
  nonNegative(config.provisions.personalCost, "provisions.personalCost");
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

  nonNegative(config.movement.shipSpeed, "movement.shipSpeed");
  nonNegative(config.movement.turnRate, "movement.turnRate");
  positive(config.movement.collisionEpsilon, "movement.collisionEpsilon");

  positive(config.simulation.fixedStepMs, "simulation.fixedStepMs");
  positive(config.simulation.maxFrameDeltaMs, "simulation.maxFrameDeltaMs");

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
  const obstacleMinimumDimension = (config.world.hiddenObstacleRadius + 2) * 2 + 1;
  if (config.world.width < obstacleMinimumDimension || config.world.height < obstacleMinimumDimension) {
    throw new RangeError("world dimensions are too small for the configured hidden obstacle");
  }
  if (config.movement.collisionEpsilon >= config.navigation.tileSize) {
    throw new RangeError("movement.collisionEpsilon must be smaller than navigation.tileSize");
  }
  if (config.simulation.maxFrameDeltaMs < config.simulation.fixedStepMs) {
    throw new RangeError("simulation.maxFrameDeltaMs must be at least simulation.fixedStepMs");
  }
}
