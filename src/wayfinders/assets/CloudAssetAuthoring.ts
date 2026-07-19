import {
  CLOUD_PACKAGE_CANDIDATES_MAXIMUM,
  CLOUD_PACKAGE_CANDIDATES_MINIMUM,
  type CloudAssetPackage,
} from "./CloudAssetCatalog";

export const CLOUD_ASSET_AUTHORING_FORMAT_VERSION = 3 as const;
export const CLOUD_ASSET_AUTHORING_ASSET_ID = "presentation.clouds.primary" as const;

const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

function frozenBounds(minimum: number, maximum: number) {
  return Object.freeze({ minimum, maximum });
}

export const CLOUD_ASSET_AUTHORING_SETTINGS_BOUNDS = Object.freeze({
  candidatesPerChunk: frozenBounds(
    CLOUD_PACKAGE_CANDIDATES_MINIMUM,
    CLOUD_PACKAGE_CANDIDATES_MAXIMUM,
  ),
  chunkDensity: frozenBounds(0, 1),
  opacity: frozenBounds(0, 1),
  scale: frozenBounds(0.05, 2),
  driftAmplitudePixels: frozenBounds(0, 512),
  driftPeriodSeconds: frozenBounds(1, 600),
  fadeInSeconds: frozenBounds(0, 30),
  routeFadeFraction: frozenBounds(0, 0.49),
  shadow: Object.freeze({
    offsetPixels: frozenBounds(-1_024, 1_024),
    opacityMultiplier: frozenBounds(0, 1),
    scale: frozenBounds(0.05, 3),
  }),
});

export interface CloudAssetAuthoringRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface CloudAssetAuthoringPoint {
  readonly x: number;
  readonly y: number;
}

export interface CloudAssetAuthoringSettings {
  readonly candidatesPerChunk: number;
  readonly chunkDensity: number;
  readonly opacity: Readonly<CloudAssetAuthoringRange>;
  readonly scale: Readonly<CloudAssetAuthoringRange>;
  readonly driftAmplitudePixels: Readonly<CloudAssetAuthoringRange>;
  readonly driftPeriodSeconds: Readonly<CloudAssetAuthoringRange>;
  readonly fadeInSeconds: number;
  readonly routeFadeFraction: number;
  readonly shadow: Readonly<{
    readonly offsetPixels: Readonly<CloudAssetAuthoringPoint>;
    readonly opacityMultiplier: number;
    readonly scale: Readonly<CloudAssetAuthoringPoint>;
  }>;
}

export interface CloudAssetIdentityRequest {
  readonly formatVersion: typeof CLOUD_ASSET_AUTHORING_FORMAT_VERSION;
  readonly assetId: typeof CLOUD_ASSET_AUTHORING_ASSET_ID;
  readonly runtimeRevision: number;
  readonly variantId: string;
}

export interface CloudAssetSaveRequest extends CloudAssetIdentityRequest {
  readonly activeInGame: boolean;
  readonly settings: Readonly<CloudAssetAuthoringSettings>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} must contain only ${sortedExpected.join(", ")}`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value as number;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be finite and between ${minimum} and ${maximum}`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value as number;
}

function boundedRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): Readonly<CloudAssetAuthoringRange> {
  const parsed = record(value, label);
  exactKeys(parsed, ["minimum", "maximum"], label);
  const normalizedMinimum = boundedNumber(parsed.minimum, minimum, maximum, `${label}.minimum`);
  const normalizedMaximum = boundedNumber(parsed.maximum, minimum, maximum, `${label}.maximum`);
  if (normalizedMinimum > normalizedMaximum) {
    throw new RangeError(`${label} must be ordered from minimum to maximum`);
  }
  return Object.freeze({ minimum: normalizedMinimum, maximum: normalizedMaximum });
}

function boundedPoint(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): Readonly<CloudAssetAuthoringPoint> {
  const parsed = record(value, label);
  exactKeys(parsed, ["x", "y"], label);
  return Object.freeze({
    x: boundedNumber(parsed.x, minimum, maximum, `${label}.x`),
    y: boundedNumber(parsed.y, minimum, maximum, `${label}.y`),
  });
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== "string" || !STABLE_ID.test(value)) {
    throw new RangeError(`${label} must be a stable lowercase ID`);
  }
  return value;
}

export function validateCloudAssetAuthoringSettings(
  input: unknown,
): Readonly<CloudAssetAuthoringSettings> {
  const bounds = CLOUD_ASSET_AUTHORING_SETTINGS_BOUNDS;
  const parsed = record(input, "Cloud asset authoring settings");
  exactKeys(parsed, [
    "candidatesPerChunk",
    "chunkDensity",
    "opacity",
    "scale",
    "driftAmplitudePixels",
    "driftPeriodSeconds",
    "fadeInSeconds",
    "routeFadeFraction",
    "shadow",
  ], "Cloud asset authoring settings");

  const shadowInput = record(parsed.shadow, "settings.shadow");
  exactKeys(shadowInput, ["offsetPixels", "opacityMultiplier", "scale"], "settings.shadow");
  const shadow = Object.freeze({
    offsetPixels: boundedPoint(
      shadowInput.offsetPixels,
      bounds.shadow.offsetPixels.minimum,
      bounds.shadow.offsetPixels.maximum,
      "settings.shadow.offsetPixels",
    ),
    opacityMultiplier: boundedNumber(
      shadowInput.opacityMultiplier,
      bounds.shadow.opacityMultiplier.minimum,
      bounds.shadow.opacityMultiplier.maximum,
      "settings.shadow.opacityMultiplier",
    ),
    scale: boundedPoint(
      shadowInput.scale,
      bounds.shadow.scale.minimum,
      bounds.shadow.scale.maximum,
      "settings.shadow.scale",
    ),
  });

  const routeFadeFraction = boundedNumber(
    parsed.routeFadeFraction,
    bounds.routeFadeFraction.minimum,
    bounds.routeFadeFraction.maximum,
    "settings.routeFadeFraction",
  );

  return Object.freeze({
    candidatesPerChunk: boundedInteger(
      parsed.candidatesPerChunk,
      bounds.candidatesPerChunk.minimum,
      bounds.candidatesPerChunk.maximum,
      "settings.candidatesPerChunk",
    ),
    chunkDensity: boundedNumber(
      parsed.chunkDensity,
      bounds.chunkDensity.minimum,
      bounds.chunkDensity.maximum,
      "settings.chunkDensity",
    ),
    opacity: boundedRange(parsed.opacity, bounds.opacity.minimum, bounds.opacity.maximum, "settings.opacity"),
    scale: boundedRange(parsed.scale, bounds.scale.minimum, bounds.scale.maximum, "settings.scale"),
    driftAmplitudePixels: boundedRange(
      parsed.driftAmplitudePixels,
      bounds.driftAmplitudePixels.minimum,
      bounds.driftAmplitudePixels.maximum,
      "settings.driftAmplitudePixels",
    ),
    driftPeriodSeconds: boundedRange(
      parsed.driftPeriodSeconds,
      bounds.driftPeriodSeconds.minimum,
      bounds.driftPeriodSeconds.maximum,
      "settings.driftPeriodSeconds",
    ),
    fadeInSeconds: boundedNumber(
      parsed.fadeInSeconds,
      bounds.fadeInSeconds.minimum,
      bounds.fadeInSeconds.maximum,
      "settings.fadeInSeconds",
    ),
    routeFadeFraction,
    shadow,
  });
}

export function cloudAssetAuthoringSettingsFromPackage(
  cloudPackage: Readonly<CloudAssetPackage>,
): Readonly<CloudAssetAuthoringSettings> {
  const { presentation } = cloudPackage;
  return validateCloudAssetAuthoringSettings({
    candidatesPerChunk: presentation.candidatesPerChunk,
    chunkDensity: presentation.chunkDensity,
    opacity: presentation.opacity,
    scale: presentation.scale,
    driftAmplitudePixels: presentation.driftAmplitudePixels,
    driftPeriodSeconds: presentation.driftPeriodSeconds,
    fadeInSeconds: presentation.fadeInSeconds,
    routeFadeFraction: presentation.routeFadeFraction,
    shadow: {
      offsetPixels: presentation.shadow.offsetPixels,
      opacityMultiplier: presentation.shadow.opacityMultiplier,
      scale: presentation.shadow.scale,
    },
  });
}

export function applyCloudAssetAuthoringSettings(
  presentation: Readonly<CloudAssetPackage["presentation"]>,
  settings: Readonly<CloudAssetAuthoringSettings>,
): Readonly<CloudAssetPackage["presentation"]> {
  const normalized = validateCloudAssetAuthoringSettings(settings);
  return Object.freeze({
    ...presentation,
    candidatesPerChunk: normalized.candidatesPerChunk,
    chunkDensity: normalized.chunkDensity,
    opacity: normalized.opacity,
    scale: normalized.scale,
    driftAmplitudePixels: normalized.driftAmplitudePixels,
    driftPeriodSeconds: normalized.driftPeriodSeconds,
    fadeInSeconds: normalized.fadeInSeconds,
    routeFadeFraction: normalized.routeFadeFraction,
    shadow: Object.freeze({
      ...presentation.shadow,
      offsetPixels: normalized.shadow.offsetPixels,
      opacityMultiplier: normalized.shadow.opacityMultiplier,
      scale: normalized.shadow.scale,
    }),
  });
}

export function validateCloudAssetIdentityRequest(
  input: unknown,
): Readonly<CloudAssetIdentityRequest> {
  const parsed = record(input, "Cloud asset identity request");
  exactKeys(
    parsed,
    ["formatVersion", "assetId", "runtimeRevision", "variantId"],
    "Cloud asset identity request",
  );
  if (parsed.formatVersion !== CLOUD_ASSET_AUTHORING_FORMAT_VERSION) {
    throw new RangeError(
      `Cloud asset identity request formatVersion must be ${CLOUD_ASSET_AUTHORING_FORMAT_VERSION}`,
    );
  }
  if (parsed.assetId !== CLOUD_ASSET_AUTHORING_ASSET_ID) {
    throw new RangeError(`Cloud asset identity request assetId must be ${CLOUD_ASSET_AUTHORING_ASSET_ID}`);
  }
  return Object.freeze({
    formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
    assetId: CLOUD_ASSET_AUTHORING_ASSET_ID,
    runtimeRevision: positiveInteger(parsed.runtimeRevision, "runtimeRevision"),
    variantId: stableId(parsed.variantId, "variantId"),
  });
}

export function validateCloudAssetSaveRequest(
  input: unknown,
): Readonly<CloudAssetSaveRequest> {
  const parsed = record(input, "Cloud asset save request");
  exactKeys(
    parsed,
    ["formatVersion", "assetId", "runtimeRevision", "variantId", "activeInGame", "settings"],
    "Cloud asset save request",
  );
  const identity = validateCloudAssetIdentityRequest({
    formatVersion: parsed.formatVersion,
    assetId: parsed.assetId,
    runtimeRevision: parsed.runtimeRevision,
    variantId: parsed.variantId,
  });
  if (typeof parsed.activeInGame !== "boolean") {
    throw new TypeError("activeInGame must be a boolean");
  }
  return Object.freeze({
    ...identity,
    activeInGame: parsed.activeInGame,
    settings: validateCloudAssetAuthoringSettings(parsed.settings),
  });
}
