import {
  validateAuthoredAssetMetadata,
  type AuthoredAssetId,
  type AuthoredAssetMetadata,
  type PixelSize,
} from "./AuthoredAssetContracts.ts";
import type { AuthoredAssetRuntime } from "./PilotAssetRuntime.ts";

export const ASSET_CANDIDATE_BUNDLE_VERSION = 1 as const;
export const MAX_AUTHORED_TEXTURE_SIZE = 4_096;

export interface CandidateImageRequirement {
  imageId: string;
  role: "image" | "spritesheet";
  size: Readonly<PixelSize>;
  frameSize?: Readonly<PixelSize>;
  frameCount: number;
}

export interface CandidateImage {
  imageId: string;
  filename: string;
  mimeType: "image/png";
  width: number;
  height: number;
  dataUrl: string;
}

export interface AssetCandidateBundle {
  bundleVersion: typeof ASSET_CANDIDATE_BUNDLE_VERSION;
  metadata: Readonly<AuthoredAssetMetadata>;
  images: readonly Readonly<CandidateImage>[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function pngHeader(dataUrl: string, label: string): { width: number; height: number } {
  let binary: string;
  try {
    binary = atob(dataUrl.slice("data:image/png;base64,".length));
  } catch {
    throw new RangeError(`${label} contains invalid base64 PNG data`);
  }
  if (binary.length < 29) throw new RangeError(`${label} contains an incomplete PNG header`);
  const bytes = Uint8Array.from(binary.slice(0, 29), (character) => character.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new RangeError(`${label} is not a PNG file`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[28] !== 0) {
    throw new RangeError(`${label} must be a non-interlaced 8-bit RGB or RGBA PNG`);
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function candidateImageRequirements(
  metadata: Readonly<AuthoredAssetMetadata>,
): readonly Readonly<CandidateImageRequirement>[] {
  switch (metadata.kind) {
    case "home-island": {
      const seen = new Set<string>();
      return metadata.render.slices.map((slice) => {
        if (seen.has(slice.imageId)) {
          throw new RangeError(`home-island slices must use unique image IDs; duplicate ${slice.imageId}`);
        }
        seen.add(slice.imageId);
        return {
          imageId: slice.imageId,
          role: "image" as const,
          size: slice.pixelSize,
          frameCount: 1,
        };
      });
    }
    case "player-boat": return [
      {
        imageId: metadata.visual.imageId,
        role: "spritesheet",
        size: {
          width: metadata.visual.frameSize.width * metadata.visual.motionFramesPerDirection,
          height: metadata.visual.frameSize.height * metadata.visual.directionCount,
        },
        frameSize: metadata.visual.frameSize,
        frameCount: metadata.visual.motionFramesPerDirection * metadata.visual.directionCount,
      },
      {
        imageId: metadata.wake.imageId,
        role: "spritesheet",
        size: {
          width: metadata.wake.frameSize.width * metadata.wake.frameCount,
          height: metadata.wake.frameSize.height,
        },
        frameSize: metadata.wake.frameSize,
        frameCount: metadata.wake.frameCount,
      },
    ];
    case "fishing-shoal": return [{
      imageId: metadata.visual.imageId,
      role: "image",
      size: metadata.visual.pixelSize,
      frameCount: 1,
    }];
  }
}

export function validateAssetCandidateBundle(value: unknown): Readonly<AssetCandidateBundle> {
  const parsed = record(value, "asset candidate bundle");
  if (parsed.bundleVersion !== ASSET_CANDIDATE_BUNDLE_VERSION) {
    throw new RangeError(`Unsupported asset candidate bundle version ${String(parsed.bundleVersion)}`);
  }
  const metadata = validateAuthoredAssetMetadata(parsed.metadata);
  const requirements = candidateImageRequirements(metadata);
  if (!Array.isArray(parsed.images)) throw new TypeError("asset candidate bundle.images must be an array");
  const imagesById = new Map<string, Readonly<CandidateImage>>();
  for (let index = 0; index < parsed.images.length; index++) {
    const input = record(parsed.images[index], `images[${index}]`);
    const imageId = nonEmptyString(input.imageId, `images[${index}].imageId`);
    if (imagesById.has(imageId)) throw new RangeError(`images contains duplicate image ID ${imageId}`);
    const filename = nonEmptyString(input.filename, `images[${index}].filename`);
    if (!/^[a-z0-9][a-z0-9._-]*\.png$/u.test(filename)) {
      throw new RangeError(`images[${index}].filename must be a lowercase PNG basename`);
    }
    if (input.mimeType !== "image/png") throw new RangeError(`images[${index}].mimeType must be image/png`);
    const width = positiveInteger(input.width, `images[${index}].width`);
    const height = positiveInteger(input.height, `images[${index}].height`);
    if (width > MAX_AUTHORED_TEXTURE_SIZE || height > MAX_AUTHORED_TEXTURE_SIZE) {
      throw new RangeError(`images[${index}] exceeds the ${MAX_AUTHORED_TEXTURE_SIZE} x ${MAX_AUTHORED_TEXTURE_SIZE} texture limit`);
    }
    const dataUrl = nonEmptyString(input.dataUrl, `images[${index}].dataUrl`);
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      throw new RangeError(`images[${index}].dataUrl must contain base64 PNG data`);
    }
    const header = pngHeader(dataUrl, `images[${index}].dataUrl`);
    if (header.width !== width || header.height !== height) {
      throw new RangeError(`images[${index}] PNG header disagrees with its declared dimensions`);
    }
    imagesById.set(imageId, { imageId, filename, mimeType: "image/png", width, height, dataUrl });
  }
  for (const requirement of requirements) {
    const image = imagesById.get(requirement.imageId);
    if (!image) throw new RangeError(`candidate is missing image ${requirement.imageId}`);
    if (image.width !== requirement.size.width || image.height !== requirement.size.height) {
      throw new RangeError(
        `${requirement.imageId} must be ${requirement.size.width}x${requirement.size.height}; received ${image.width}x${image.height}`,
      );
    }
  }
  const expectedIds = new Set(requirements.map(({ imageId }) => imageId));
  for (const imageId of imagesById.keys()) {
    if (!expectedIds.has(imageId)) throw new RangeError(`candidate includes unreferenced image ${imageId}`);
  }
  return Object.freeze({
    bundleVersion: ASSET_CANDIDATE_BUNDLE_VERSION,
    metadata,
    images: Object.freeze([...imagesById.values()].map(
      (image): Readonly<CandidateImage> => Object.freeze({ ...image }),
    )),
  });
}

export class CandidateAssetRuntime implements AuthoredAssetRuntime {
  private readonly textureKeysByImageId: ReadonlyMap<string, string>;

  constructor(
    private readonly asset: Readonly<AuthoredAssetMetadata>,
    textureKeysByImageId: ReadonlyMap<string, string>,
  ) {
    this.textureKeysByImageId = new Map(textureKeysByImageId);
  }

  metadata(assetId: AuthoredAssetId): Readonly<AuthoredAssetMetadata> | undefined {
    return assetId === this.asset.assetId ? this.asset : undefined;
  }

  textureKey(imageId: string): string | undefined {
    return this.textureKeysByImageId.get(imageId);
  }
}
