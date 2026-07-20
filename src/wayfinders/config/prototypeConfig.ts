import {
  DEFAULT_GAME_SETTINGS,
  prototypeConfigFromGameSettings,
} from "./gameSettings";
import type {
  DeepPartial,
  DeepReadonly,
  PrototypeConfig,
  PrototypeConfigSection,
} from "./configContracts";
import {
  assertFinite,
  assertNonNegative,
  assertNonNegativeInteger,
  assertPositive,
  assertPositiveInteger,
  assertUnitInterval,
  validateIslandTuning,
  validateMovementTuning,
  validateProvisionTuning,
  validateReturnRiskTuning,
  validateWorldTuning,
} from "./configValidation";

export type {
  DeepPartial,
  DeepReadonly,
  PrototypeConfig,
  PrototypeConfigSection,
} from "./configContracts";

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
  assertPositive(config.navigation.tileSize, "navigation.tileSize");
  assertPositive(config.navigation.artTileSize, "navigation.artTileSize");
  assertNonNegativeInteger(config.navigation.sightRadius, "navigation.sightRadius");
  assertPositiveInteger(config.navigation.chunkSize, "navigation.chunkSize");

  assertPositiveInteger(config.world.width, "world.width");
  assertPositiveInteger(config.world.height, "world.height");
  validateWorldTuning(config.world, assertPositiveInteger, assertNonNegativeInteger);
  validateIslandTuning(config.islands, {
    prefix: "islands",
    radiusOrderMessage: "islands.maxRadius must be at least islands.minRadius",
    positiveWeightMessage: "at least one island archetype weight must be positive",
    positiveInteger: assertPositiveInteger,
    nonNegativeInteger: assertNonNegativeInteger,
  });

  // All travel costs may be zero for developer testing sessions.
  validateProvisionTuning(config.provisions, {
    prefix: "provisions",
    exactScaleMessage: "provision travel costs must use at most four decimal places",
    positiveInteger: assertPositiveInteger,
    nonNegativeInteger: assertNonNegativeInteger,
  });

  validateReturnRiskTuning(
    config.returnRisk,
    "returnRisk",
    "return-risk thresholds must be ordered comfortable >= warning >= critical",
  );

  assertUnitInterval(config.overlays.fogNoise, "overlays.fogNoise");
  assertUnitInterval(config.overlays.fogBlend, "overlays.fogBlend");
  assertUnitInterval(config.overlays.forwardOverlayOpacity, "overlays.forwardOverlayOpacity");
  assertUnitInterval(config.overlays.returnOverlayOpacity, "overlays.returnOverlayOpacity");
  assertPositive(config.overlays.returnThreadWidth, "overlays.returnThreadWidth");
  assertNonNegative(config.overlays.returnThreadCurveRadius, "overlays.returnThreadCurveRadius");
  assertPositive(config.overlays.forwardConeHalfAngleDegrees, "overlays.forwardConeHalfAngleDegrees");
  if (config.overlays.forwardConeHalfAngleDegrees > 180) {
    throw new RangeError("overlays.forwardConeHalfAngleDegrees must be at most 180");
  }
  assertNonNegativeInteger(config.overlays.returnPathPadding, "overlays.returnPathPadding");

  validateMovementTuning(config.movement, "movement");

  assertPositive(config.simulation.fixedStepMs, "simulation.fixedStepMs");
  assertPositive(config.simulation.maxFrameDeltaMs, "simulation.maxFrameDeltaMs");
  assertPositive(config.simulation.wreckPresentationSeconds, "simulation.wreckPresentationSeconds");

  assertFinite(config.world.seed, "world.seed");

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
