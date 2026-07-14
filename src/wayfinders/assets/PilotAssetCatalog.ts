import type Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredAssetId,
} from "./AuthoredAssetContracts";

export interface PilotImageCatalogEntry {
  imageId: string;
  textureKey: string;
  url: string;
}

export interface PilotPackageCatalogEntry {
  assetId: AuthoredAssetId;
  metadataKey: string;
  metadataUrl: string;
  images: readonly Readonly<PilotImageCatalogEntry>[];
}

const ROOT = "./assets/gr1";

export const PILOT_ASSET_CATALOG: readonly Readonly<PilotPackageCatalogEntry>[] = Object.freeze([
  Object.freeze({
    assetId: AUTHORED_ASSET_IDS.homeIsland,
    metadataKey: "wayfinders:metadata:home-island",
    metadataUrl: `${ROOT}/packages/home-island.json`,
    images: Object.freeze([
      Object.freeze({
        imageId: "home.island.primary.complete",
        textureKey: "wayfinders:image:home-island",
        url: `${ROOT}/images/home-island.png`,
      }),
    ]),
  }),
  Object.freeze({
    assetId: AUTHORED_ASSET_IDS.playerBoat,
    metadataKey: "wayfinders:metadata:player-boat",
    metadataUrl: `${ROOT}/packages/player-boat.json`,
    images: Object.freeze([
      Object.freeze({
        imageId: "player.boat.primary.frames",
        textureKey: "wayfinders:image:player-boat",
        url: `${ROOT}/images/player-boat.png`,
      }),
      Object.freeze({
        imageId: "player.boat.primary.wake",
        textureKey: "wayfinders:image:player-wake",
        url: `${ROOT}/images/player-wake.png`,
      }),
    ]),
  }),
  Object.freeze({
    assetId: AUTHORED_ASSET_IDS.fishingShoal,
    metadataKey: "wayfinders:metadata:fishing-shoal",
    metadataUrl: `${ROOT}/packages/fishing-shoal.json`,
    images: Object.freeze([
      Object.freeze({
        imageId: "shoal.fishing.primary.complete",
        textureKey: "wayfinders:image:fishing-shoal",
        url: `${ROOT}/images/fishing-shoal.png`,
      }),
    ]),
  }),
]);

export interface PilotAssetLoader {
  json(key: string, url: string): unknown;
  image(key: string, url: string): unknown;
}

export function queuePilotAssetPackages(loader: PilotAssetLoader): void {
  for (const entry of PILOT_ASSET_CATALOG) {
    loader.json(entry.metadataKey, entry.metadataUrl);
    for (const image of entry.images) loader.image(image.textureKey, image.url);
  }
}

export function preloadPilotAssetPackages(scene: Phaser.Scene): void {
  queuePilotAssetPackages(scene.load);
}
