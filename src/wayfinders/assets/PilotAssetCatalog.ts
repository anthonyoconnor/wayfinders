import type Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredAssetId,
} from "./AuthoredAssetContracts";

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

const imageUrl = (filename: string): string => `./assets/gr1/images/${filename}`;

export const PILOT_ASSET_CATALOG: readonly Readonly<PilotPackageCatalogEntry>[] = Object.freeze([
  Object.freeze({
    assetId: AUTHORED_ASSET_IDS.homeIsland,
    metadataKey: "wayfinders:metadata:home-island",
    metadataUrl: new URL("./packages/home-island.json", import.meta.url).href,
    images: Object.freeze([
      Object.freeze({
        imageId: "home.island.primary.complete",
        textureKey: "wayfinders:image:home-island",
        url: imageUrl("home-island.png"),
      }),
    ]),
  }),
  Object.freeze({
    assetId: AUTHORED_ASSET_IDS.playerBoat,
    metadataKey: "wayfinders:metadata:player-boat",
    metadataUrl: new URL("./packages/player-boat.json", import.meta.url).href,
    images: Object.freeze([
      Object.freeze({
        imageId: "player.boat.primary.frames",
        textureKey: "wayfinders:image:player-boat",
        url: imageUrl("player-boat.png"),
        frameConfig: Object.freeze({ frameWidth: 64, frameHeight: 64 }),
      }),
      Object.freeze({
        imageId: "player.boat.primary.wake",
        textureKey: "wayfinders:image:player-wake",
        url: imageUrl("player-wake.png"),
        frameConfig: Object.freeze({ frameWidth: 96, frameHeight: 64 }),
      }),
    ]),
  }),
  Object.freeze({
    assetId: AUTHORED_ASSET_IDS.fishingShoal,
    metadataKey: "wayfinders:metadata:fishing-shoal",
    metadataUrl: new URL("./packages/fishing-shoal.json", import.meta.url).href,
    images: Object.freeze([
      Object.freeze({
        imageId: "shoal.fishing.primary.complete",
        textureKey: "wayfinders:image:fishing-shoal",
        url: imageUrl("fishing-shoal.png"),
      }),
    ]),
  }),
]);

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
