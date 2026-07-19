import type Phaser from "phaser";
import packageInput from "./packages/cloud-atmosphere.json";

const CLOUD_VARIANT_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
export const CLOUD_PACKAGE_CANDIDATES_MINIMUM = 3;
export const CLOUD_PACKAGE_CANDIDATES_MAXIMUM = 12;

export interface CloudAssetVariant {
  readonly id: string;
  readonly name: string;
  readonly activeInGame: boolean;
}

export interface CloudAssetVariantEntry extends CloudAssetVariant {
  readonly frame: number;
}

export interface CloudAssetPackage {
  readonly contractVersion: 3;
  readonly assetId: "presentation.clouds.primary";
  readonly kind: "cloud-atmosphere";
  readonly sourceAssetId: string;
  readonly runtimeRevision: number;
  readonly image: Readonly<{
    imageId: string;
    textureKey: string;
    url: string;
    pixelSize: Readonly<{ width: number; height: number }>;
    frameSize: Readonly<{ width: number; height: number }>;
    frameCount: number;
    opaqueBounds: readonly Readonly<{ x: number; y: number; width: number; height: number }>[];
  }>;
  readonly presentation: Readonly<{
    depth: number;
    candidatesPerChunk: number;
    chunkDensity: number;
    opacity: Readonly<{ minimum: number; maximum: number }>;
    scale: Readonly<{ minimum: number; maximum: number }>;
    cloudTintsRgb: readonly Readonly<{ red: number; green: number; blue: number }>[];
    driftAmplitudePixels: Readonly<{ minimum: number; maximum: number }>;
    driftPeriodSeconds: Readonly<{ minimum: number; maximum: number }>;
    fadeInSeconds: number;
    routeFadeFraction: number;
    clearPaddingTiles: number;
    shadow: Readonly<{
      depth: number;
      offsetPixels: Readonly<{ x: number; y: number }>;
      opacityMultiplier: number;
      scale: Readonly<{ x: number; y: number }>;
      tintRgb: Readonly<{ red: number; green: number; blue: number }>;
    }>;
  }>;
  /** Fixed frame slots. A null slot is a permanently deleted catalog entry. */
  readonly variants: readonly (Readonly<CloudAssetVariant> | null)[];
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be between zero and one`);
  return value;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function colorChannel(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${label} must be an integer from zero through 255`);
  }
  return value;
}

export function validateCloudAssetPackage(
  input: typeof packageInput | Readonly<CloudAssetPackage>,
): Readonly<CloudAssetPackage> {
  if (input.contractVersion !== 3 || input.assetId !== "presentation.clouds.primary" || input.kind !== "cloud-atmosphere") {
    throw new RangeError("Cloud package identity or contract version is invalid");
  }
  const { image, presentation } = input;
  positiveInteger(image.pixelSize.width, "image.pixelSize.width");
  positiveInteger(image.pixelSize.height, "image.pixelSize.height");
  positiveInteger(image.frameSize.width, "image.frameSize.width");
  positiveInteger(image.frameSize.height, "image.frameSize.height");
  positiveInteger(image.frameCount, "image.frameCount");
  positiveInteger(input.runtimeRevision, "runtimeRevision");
  if (image.pixelSize.width % image.frameSize.width !== 0 || image.pixelSize.height % image.frameSize.height !== 0) {
    throw new RangeError("Cloud sheet dimensions must be divisible by its frame dimensions");
  }
  if ((image.pixelSize.width / image.frameSize.width) * (image.pixelSize.height / image.frameSize.height) !== image.frameCount) {
    throw new RangeError("Cloud sheet frame grid must equal image.frameCount");
  }
  if (!Array.isArray(input.variants) || input.variants.length !== image.frameCount) {
    throw new RangeError("Cloud package must declare one variant slot for every frame");
  }
  const variantIds = new Set<string>();
  const variantNames = new Set<string>();
  input.variants.forEach((variant, index) => {
    if (variant === null) return;
    if (!CLOUD_VARIANT_ID.test(variant.id)) {
      throw new RangeError(`variants[${index}].id must be a stable lowercase ID`);
    }
    if (variantIds.has(variant.id)) {
      throw new RangeError(`Cloud package repeats variant ${variant.id}`);
    }
    variantIds.add(variant.id);
    if (variant.name.trim() !== variant.name || variant.name.length === 0 || variant.name.length > 80) {
      throw new RangeError(`variants[${index}].name must be trimmed and at most 80 characters`);
    }
    const normalizedName = variant.name.toLocaleLowerCase("en-US");
    if (variantNames.has(normalizedName)) {
      throw new RangeError(`Cloud package repeats variant name ${variant.name}`);
    }
    variantNames.add(normalizedName);
    if (typeof variant.activeInGame !== "boolean") {
      throw new TypeError(`variants[${index}].activeInGame must be a boolean`);
    }
  });
  if (image.opaqueBounds.length !== image.frameCount) {
    throw new RangeError("Cloud package must declare opaque bounds for every frame");
  }
  image.opaqueBounds.forEach((bounds, index) => {
    if (!Number.isInteger(bounds.x) || !Number.isInteger(bounds.y) || bounds.x < 0 || bounds.y < 0) {
      throw new RangeError(`image.opaqueBounds[${index}] origin must use non-negative integers`);
    }
    positiveInteger(bounds.width, `image.opaqueBounds[${index}].width`);
    positiveInteger(bounds.height, `image.opaqueBounds[${index}].height`);
    if (bounds.x + bounds.width > image.frameSize.width || bounds.y + bounds.height > image.frameSize.height) {
      throw new RangeError(`image.opaqueBounds[${index}] must stay within its frame`);
    }
  });
  unitInterval(presentation.chunkDensity, "presentation.chunkDensity");
  positiveInteger(presentation.candidatesPerChunk, "presentation.candidatesPerChunk");
  if (presentation.candidatesPerChunk < CLOUD_PACKAGE_CANDIDATES_MINIMUM
    || presentation.candidatesPerChunk > CLOUD_PACKAGE_CANDIDATES_MAXIMUM) {
    throw new RangeError(
      `Cloud candidates per chunk must be from ${CLOUD_PACKAGE_CANDIDATES_MINIMUM} through ${CLOUD_PACKAGE_CANDIDATES_MAXIMUM}`,
    );
  }
  finite(presentation.depth, "presentation.depth");
  unitInterval(presentation.opacity.minimum, "presentation.opacity.minimum");
  unitInterval(presentation.opacity.maximum, "presentation.opacity.maximum");
  if (presentation.opacity.minimum > presentation.opacity.maximum) {
    throw new RangeError("Cloud opacity must be ordered");
  }
  if (presentation.scale.minimum <= 0 || presentation.scale.minimum > presentation.scale.maximum) {
    throw new RangeError("Cloud scale range must be positive and ordered");
  }
  if (presentation.cloudTintsRgb.length < 3) {
    throw new RangeError("Cloud presentation must provide at least three colour tints");
  }
  const cloudTints = new Set<number>();
  for (const [index, tint] of presentation.cloudTintsRgb.entries()) {
    colorChannel(tint.red, `presentation.cloudTintsRgb[${index}].red`);
    colorChannel(tint.green, `presentation.cloudTintsRgb[${index}].green`);
    colorChannel(tint.blue, `presentation.cloudTintsRgb[${index}].blue`);
    cloudTints.add((tint.red << 16) | (tint.green << 8) | tint.blue);
  }
  if (cloudTints.size !== presentation.cloudTintsRgb.length) {
    throw new RangeError("Cloud colour tints must be unique");
  }
  if (presentation.driftAmplitudePixels.minimum < 0
    || presentation.driftAmplitudePixels.minimum > presentation.driftAmplitudePixels.maximum) {
    throw new RangeError("Cloud drift amplitude range must be non-negative and ordered");
  }
  if (presentation.driftPeriodSeconds.minimum <= 0
    || presentation.driftPeriodSeconds.minimum > presentation.driftPeriodSeconds.maximum) {
    throw new RangeError("Cloud drift period range must be positive and ordered");
  }
  if (!Number.isFinite(presentation.fadeInSeconds) || presentation.fadeInSeconds < 0) {
    throw new RangeError("Cloud fade-in duration must be finite and non-negative");
  }
  if (!Number.isFinite(presentation.routeFadeFraction)
    || presentation.routeFadeFraction < 0
    || presentation.routeFadeFraction >= 0.5) {
    throw new RangeError("Cloud route fade fraction must be from zero up to, but not including, one half");
  }
  if (!Number.isInteger(presentation.clearPaddingTiles) || presentation.clearPaddingTiles < 0) {
    throw new RangeError("Cloud clear padding must be a non-negative integer");
  }
  const { shadow } = presentation;
  finite(shadow.depth, "presentation.shadow.depth");
  if (shadow.depth >= presentation.depth) throw new RangeError("Cloud shadow depth must be below cloud depth");
  finite(shadow.offsetPixels.x, "presentation.shadow.offsetPixels.x");
  finite(shadow.offsetPixels.y, "presentation.shadow.offsetPixels.y");
  unitInterval(shadow.opacityMultiplier, "presentation.shadow.opacityMultiplier");
  if (!Number.isFinite(shadow.scale.x) || !Number.isFinite(shadow.scale.y)
    || shadow.scale.x <= 0 || shadow.scale.y <= 0) {
    throw new RangeError("Cloud shadow scale must be finite and positive");
  }
  colorChannel(shadow.tintRgb.red, "presentation.shadow.tintRgb.red");
  colorChannel(shadow.tintRgb.green, "presentation.shadow.tintRgb.green");
  colorChannel(shadow.tintRgb.blue, "presentation.shadow.tintRgb.blue");
  return input as Readonly<CloudAssetPackage>;
}

export const CLOUD_ASSET_PACKAGE = validateCloudAssetPackage(packageInput);

export function cloudAssetVariantEntries(
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): readonly Readonly<CloudAssetVariantEntry>[] {
  return Object.freeze(cloudPackage.variants.flatMap((variant, frame) => (
    variant === null ? [] : [Object.freeze({ ...variant, frame })]
  )));
}

export function activeCloudAssetFrames(
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): readonly number[] {
  return Object.freeze(cloudAssetVariantEntries(cloudPackage)
    .filter(({ activeInGame }) => activeInGame)
    .map(({ frame }) => frame));
}

/** Keeps the preferred seeded frame when active, otherwise scans stable slots forward. */
export function resolveActiveCloudAssetFrame(
  preferredFrame: number,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): number | undefined {
  if (!Number.isInteger(preferredFrame)
    || preferredFrame < 0
    || preferredFrame >= cloudPackage.image.frameCount) {
    throw new RangeError("Preferred cloud frame is outside the package frame grid");
  }
  for (let offset = 0; offset < cloudPackage.image.frameCount; offset++) {
    const frame = (preferredFrame + offset) % cloudPackage.image.frameCount;
    if (cloudPackage.variants[frame]?.activeInGame) return frame;
  }
  return undefined;
}

export function preloadCloudAsset(scene: Phaser.Scene): void {
  const { image } = CLOUD_ASSET_PACKAGE;
  scene.load.spritesheet(image.textureKey, image.url, {
    frameWidth: image.frameSize.width,
    frameHeight: image.frameSize.height,
  });
}
