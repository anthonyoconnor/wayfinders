import type Phaser from "phaser";
import {
  type AuthoredAssetId,
} from "./AuthoredAssetContracts";
import { GENERATED_ASSET_CATALOG } from "./generated/AssetCatalog.generated";

export interface PilotImageCatalogEntry {
  imageId: string;
  textureKey: string;
  url: string;
  frameConfig?: Readonly<{
    frameWidth: number;
    frameHeight: number;
  }>;
}

export interface PilotPackageCatalogEntry {
  assetId: AuthoredAssetId;
  metadataKey: string;
  metadataUrl: string;
  images: readonly Readonly<PilotImageCatalogEntry>[];
}

export const PILOT_ASSET_CATALOG: readonly Readonly<PilotPackageCatalogEntry>[] = GENERATED_ASSET_CATALOG;

export interface PilotAssetLoader {
  json(key: string, url: string): unknown;
  image(key: string, url: string): unknown;
  spritesheet(
    key: string,
    url: string,
    config: Readonly<{ frameWidth: number; frameHeight: number }>,
  ): unknown;
}

export function queuePilotAssetPackages(loader: PilotAssetLoader): void {
  for (const entry of PILOT_ASSET_CATALOG) {
    loader.json(entry.metadataKey, entry.metadataUrl);
    for (const image of entry.images) {
      if (image.frameConfig) loader.spritesheet(image.textureKey, image.url, image.frameConfig);
      else loader.image(image.textureKey, image.url);
    }
  }
}

export function preloadPilotAssetPackages(scene: Phaser.Scene): void {
  queuePilotAssetPackages(scene.load);
}
