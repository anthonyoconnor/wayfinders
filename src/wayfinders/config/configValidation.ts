import type { PrototypeConfig } from "./configContracts";

type IntegerAssertion = (value: number, label: string) => void;

export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

export function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
}

export function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
}

export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}

export function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

export function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
}

export function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

export function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

export function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
}

export function validateWorldTuning(
  world: Readonly<PrototypeConfig["world"]>,
  positiveInteger: IntegerAssertion,
  nonNegativeInteger: IntegerAssertion,
): void {
  assertSafeInteger(world.seed, "world.seed");
  positiveInteger(world.homeIslandRadius, "world.homeIslandRadius");
  assertNonNegative(world.supportedWaterRadius, "world.supportedWaterRadius");
  assertNonNegative(world.supportedBoundaryNoise, "world.supportedBoundaryNoise");
  assertPositive(world.supportedNoiseScale, "world.supportedNoiseScale");
  positiveInteger(world.shallowWaterRadius, "world.shallowWaterRadius");
  positiveInteger(world.hiddenObstacleRadius, "world.hiddenObstacleRadius");
  assertNonNegative(world.hiddenObstacleDistance, "world.hiddenObstacleDistance");
  nonNegativeInteger(world.maxEnclosedUnknownTiles, "world.maxEnclosedUnknownTiles");
  positiveInteger(world.idolCount, "world.idolCount");
  nonNegativeInteger(world.fishingShoalCount, "world.fishingShoalCount");
}

interface IslandValidationOptions {
  readonly prefix: string;
  readonly radiusOrderMessage: string;
  readonly positiveWeightMessage: string;
  readonly positiveInteger: IntegerAssertion;
  readonly nonNegativeInteger: IntegerAssertion;
}

export function validateIslandTuning(
  islands: Readonly<PrototypeConfig["islands"]>,
  options: Readonly<IslandValidationOptions>,
): void {
  const { prefix, positiveInteger, nonNegativeInteger } = options;
  positiveInteger(islands.count, `${prefix}.count`);
  assertPositive(islands.minRadius, `${prefix}.minRadius`);
  assertPositive(islands.maxRadius, `${prefix}.maxRadius`);
  assertPositive(islands.apronWidth, `${prefix}.apronWidth`);
  assertNonNegative(islands.minimumChannelWidth, `${prefix}.minimumChannelWidth`);
  assertNonNegative(islands.homeClearance, `${prefix}.homeClearance`);
  positiveInteger(islands.placementAttempts, `${prefix}.placementAttempts`);
  nonNegativeInteger(islands.archipelagoClusters, `${prefix}.archipelagoClusters`);
  assertPositive(islands.archipelagoRadius, `${prefix}.archipelagoRadius`);
  assertUnitInterval(islands.archipelagoBias, `${prefix}.archipelagoBias`);
  assertUnitInterval(islands.edgeNoise, `${prefix}.edgeNoise`);
  assertNonNegative(islands.safeCorridorHalfWidth, `${prefix}.safeCorridorHalfWidth`);
  for (const [name, weight] of Object.entries({
    highIslandWeight: islands.highIslandWeight,
    lowCayWeight: islands.lowCayWeight,
    atollWeight: islands.atollWeight,
    rockySkerryWeight: islands.rockySkerryWeight,
  })) assertNonNegative(weight, `${prefix}.${name}`);
  if (islands.maxRadius < islands.minRadius) throw new RangeError(options.radiusOrderMessage);
  if (
    islands.highIslandWeight + islands.lowCayWeight
    + islands.atollWeight + islands.rockySkerryWeight <= 0
  ) throw new RangeError(options.positiveWeightMessage);
}

interface ProvisionValidationOptions {
  readonly prefix: string;
  readonly exactScaleMessage: string;
  readonly positiveInteger: IntegerAssertion;
  readonly nonNegativeInteger: IntegerAssertion;
}

export function validateProvisionTuning(
  provisions: Readonly<PrototypeConfig["provisions"]>,
  options: Readonly<ProvisionValidationOptions>,
): void {
  const { prefix, positiveInteger, nonNegativeInteger } = options;
  nonNegativeInteger(provisions.startingBundles, `${prefix}.startingBundles`);
  positiveInteger(provisions.surveyCost, `${prefix}.surveyCost`);
  assertNonNegative(provisions.supportedCost, `${prefix}.supportedCost`);
  assertNonNegative(provisions.personalCost, `${prefix}.personalCost`);
  assertNonNegative(provisions.unknownCost, `${prefix}.unknownCost`);
  const travelCosts = [
    provisions.supportedCost,
    provisions.personalCost,
    provisions.unknownCost,
  ];
  const hasExactScale = [1, 10, 100, 1_000, 10_000].some((scale) => (
    travelCosts.every((cost) => Math.abs(cost * scale - Math.round(cost * scale)) <= 1e-9)
  ));
  if (!hasExactScale) throw new RangeError(options.exactScaleMessage);
}

export function validateReturnRiskTuning(
  risk: Readonly<PrototypeConfig["returnRisk"]>,
  prefix: string,
  orderMessage: string,
): void {
  assertNonNegative(risk.comfortable, `${prefix}.comfortable`);
  assertNonNegative(risk.warning, `${prefix}.warning`);
  assertNonNegative(risk.critical, `${prefix}.critical`);
  if (risk.comfortable < risk.warning || risk.warning < risk.critical) {
    throw new RangeError(orderMessage);
  }
}

export function validateMovementTuning(
  movement: Readonly<PrototypeConfig["movement"]>,
  prefix: string,
): void {
  assertNonNegative(movement.shipSpeed, `${prefix}.shipSpeed`);
  assertNonNegative(movement.turnRate, `${prefix}.turnRate`);
  assertPositive(movement.shipCollisionHalfExtent, `${prefix}.shipCollisionHalfExtent`);
  assertPositive(movement.collisionEpsilon, `${prefix}.collisionEpsilon`);
}
