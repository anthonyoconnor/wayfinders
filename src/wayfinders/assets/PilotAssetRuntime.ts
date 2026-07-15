import type Phaser from "phaser";
import {
  validateAuthoredAssetMetadata,
  type AuthoredAssetId,
  type AuthoredAssetMetadata,
} from "./AuthoredAssetContracts";
import {
  PILOT_ASSET_CATALOG,
  type PilotPackageCatalogEntry,
} from "./PilotAssetCatalog";

export interface PilotAssetRuntimeSource {
  metadata(key: string): unknown;
  hasTexture(key: string): boolean;
}

export interface PilotAssetDiagnostic {
  assetId: AuthoredAssetId;
  message: string;
}

/** Development-only visual substitution; metadata and collision remain unchanged. */
export interface PilotAssetTextureOverride {
  readonly assetId: AuthoredAssetId;
  readonly imageId: string;
  readonly textureKey: string;
}

/** Minimal presentation contract shared by the game, asset viewer and candidate preview. */
export interface AuthoredAssetRuntime {
  metadata(assetId: AuthoredAssetId): Readonly<AuthoredAssetMetadata> | undefined;
  textureKey(imageId: string): string | undefined;
}

function referencedImageIds(metadata: Readonly<AuthoredAssetMetadata>): readonly string[] {
  switch (metadata.kind) {
    case "home-island": return metadata.render.slices.map(({ imageId }) => imageId);
    case "player-boat": return [metadata.visual.imageId, metadata.wake.imageId];
    case "fishing-shoal": return [metadata.visual.imageId];
  }
}

export class PilotAssetRuntime {
  readonly diagnostics: readonly Readonly<PilotAssetDiagnostic>[];

  private readonly metadataById: ReadonlyMap<AuthoredAssetId, Readonly<AuthoredAssetMetadata>>;
  private readonly textureKeysByImageId: ReadonlyMap<string, string>;

  constructor(
    source: Readonly<PilotAssetRuntimeSource>,
    catalog = PILOT_ASSET_CATALOG,
    textureOverrides: readonly Readonly<PilotAssetTextureOverride>[] = [],
  ) {
    const diagnostics: PilotAssetDiagnostic[] = [];
    const metadataById = new Map<AuthoredAssetId, Readonly<AuthoredAssetMetadata>>();
    const textureKeysByImageId = new Map<string, string>();

    for (const entry of catalog) {
      this.loadEntry(source, entry, metadataById, textureKeysByImageId, diagnostics);
    }
    for (const override of textureOverrides) {
      const metadata = metadataById.get(override.assetId);
      if (!metadata) {
        diagnostics.push({ assetId: override.assetId, message: "visual test override target is unavailable" });
      } else if (!referencedImageIds(metadata).includes(override.imageId)) {
        diagnostics.push({ assetId: override.assetId, message: `visual test override cannot replace ${override.imageId}` });
      } else if (!source.hasTexture(override.textureKey)) {
        diagnostics.push({ assetId: override.assetId, message: `visual test texture ${override.textureKey} did not load` });
      } else {
        textureKeysByImageId.set(override.imageId, override.textureKey);
      }
    }

    this.diagnostics = Object.freeze(diagnostics);
    this.metadataById = metadataById;
    this.textureKeysByImageId = textureKeysByImageId;
  }

  isAvailable(assetId: AuthoredAssetId): boolean {
    return this.metadataById.has(assetId);
  }

  metadata(assetId: AuthoredAssetId): Readonly<AuthoredAssetMetadata> | undefined {
    return this.metadataById.get(assetId);
  }

  textureKey(imageId: string): string | undefined {
    return this.textureKeysByImageId.get(imageId);
  }

  private loadEntry(
    source: Readonly<PilotAssetRuntimeSource>,
    entry: Readonly<PilotPackageCatalogEntry>,
    metadataById: Map<AuthoredAssetId, Readonly<AuthoredAssetMetadata>>,
    textureKeysByImageId: Map<string, string>,
    diagnostics: PilotAssetDiagnostic[],
  ): void {
    try {
      const metadata = validateAuthoredAssetMetadata(source.metadata(entry.metadataKey));
      if (metadata.assetId !== entry.assetId) {
        throw new RangeError(`metadata resolved ${metadata.assetId} instead of ${entry.assetId}`);
      }
      const catalogImages = new Map(entry.images.map((image) => [image.imageId, image]));
      for (const imageId of referencedImageIds(metadata)) {
        const image = catalogImages.get(imageId);
        if (!image) throw new RangeError(`metadata references uncatalogued image ${imageId}`);
        if (!source.hasTexture(image.textureKey)) throw new RangeError(`texture ${image.textureKey} did not load`);
      }
      metadataById.set(entry.assetId, metadata);
      for (const image of entry.images) textureKeysByImageId.set(image.imageId, image.textureKey);
    } catch (error) {
      diagnostics.push({
        assetId: entry.assetId,
        message: error instanceof Error ? error.message : "Unknown authored asset loading failure",
      });
    }
  }
}

export function createPilotAssetRuntime(
  scene: Phaser.Scene,
  textureOverrides: readonly Readonly<PilotAssetTextureOverride>[] = [],
): PilotAssetRuntime {
  return new PilotAssetRuntime({
    metadata: (key) => scene.cache.json.get(key),
    hasTexture: (key) => scene.textures.exists(key),
  }, PILOT_ASSET_CATALOG, textureOverrides);
}
