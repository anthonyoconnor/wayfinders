import type Phaser from "phaser";
import packageInput from "./packages/cloud-atmosphere.json";

export interface CloudAssetPackage {
  readonly contractVersion: 1;
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
    driftAmplitudePixels: Readonly<{ minimum: number; maximum: number }>;
    driftPeriodSeconds: Readonly<{ minimum: number; maximum: number }>;
    clearPaddingTiles: number;
    playerClearRadiusPixels: number;
  }>;
  readonly variants: readonly string[];
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be between zero and one`);
  return value;
}

export function validateCloudAssetPackage(input: typeof packageInput): Readonly<CloudAssetPackage> {
  if (input.contractVersion !== 1 || input.assetId !== "presentation.clouds.primary" || input.kind !== "cloud-atmosphere") {
    throw new RangeError("Cloud package identity or contract version is invalid");
  }
  const { image, presentation } = input;
  positiveInteger(image.pixelSize.width, "image.pixelSize.width");
  positiveInteger(image.pixelSize.height, "image.pixelSize.height");
  positiveInteger(image.frameSize.width, "image.frameSize.width");
  positiveInteger(image.frameSize.height, "image.frameSize.height");
  positiveInteger(image.frameCount, "image.frameCount");
  if (image.pixelSize.width % image.frameSize.width !== 0 || image.pixelSize.height % image.frameSize.height !== 0) {
    throw new RangeError("Cloud sheet dimensions must be divisible by its frame dimensions");
  }
  if ((image.pixelSize.width / image.frameSize.width) * (image.pixelSize.height / image.frameSize.height) !== image.frameCount) {
    throw new RangeError("Cloud sheet frame grid must equal image.frameCount");
  }
  if (input.variants.length !== image.frameCount || new Set(input.variants).size !== image.frameCount) {
    throw new RangeError("Cloud package must name every frame with a unique variant");
  }
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
  unitInterval(presentation.opacity.minimum, "presentation.opacity.minimum");
  unitInterval(presentation.opacity.maximum, "presentation.opacity.maximum");
  if (presentation.opacity.minimum > presentation.opacity.maximum || presentation.opacity.maximum > 0.35) {
    throw new RangeError("Cloud opacity must be ordered and preserve the 0.35 acceptance cap");
  }
  if (presentation.scale.minimum <= 0 || presentation.scale.minimum > presentation.scale.maximum) {
    throw new RangeError("Cloud scale range must be positive and ordered");
  }
  if (presentation.driftAmplitudePixels.minimum < 0
    || presentation.driftAmplitudePixels.minimum > presentation.driftAmplitudePixels.maximum) {
    throw new RangeError("Cloud drift amplitude range must be non-negative and ordered");
  }
  if (presentation.driftPeriodSeconds.minimum <= 0
    || presentation.driftPeriodSeconds.minimum > presentation.driftPeriodSeconds.maximum) {
    throw new RangeError("Cloud drift period range must be positive and ordered");
  }
  if (!Number.isInteger(presentation.clearPaddingTiles) || presentation.clearPaddingTiles < 0) {
    throw new RangeError("Cloud clear padding must be a non-negative integer");
  }
  if (presentation.playerClearRadiusPixels < 0) throw new RangeError("Cloud player clear radius must be non-negative");
  return input as Readonly<CloudAssetPackage>;
}

export const CLOUD_ASSET_PACKAGE = validateCloudAssetPackage(packageInput);

export function preloadCloudAsset(scene: Phaser.Scene): void {
  const { image } = CLOUD_ASSET_PACKAGE;
  scene.load.spritesheet(image.textureKey, image.url, {
    frameWidth: image.frameSize.width,
    frameHeight: image.frameSize.height,
  });
}
