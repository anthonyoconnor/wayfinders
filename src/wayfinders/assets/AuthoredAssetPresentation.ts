import Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredFishingShoalMetadata,
  type AuthoredHomeIslandMetadata,
  type AuthoredPlayerBoatMetadata,
} from "./AuthoredAssetContracts";
import type { AuthoredAssetRuntime } from "./PilotAssetRuntime";

export interface AuthoredHomeIslandVisual {
  readonly metadata: Readonly<AuthoredHomeIslandMetadata>;
  setPosition(x: number, y: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface AuthoredPlayerBoatVisual {
  readonly metadata: Readonly<AuthoredPlayerBoatMetadata>;
  readonly boat: Phaser.GameObjects.Image;
  readonly wake: Phaser.GameObjects.Image;
}

export interface AuthoredFishingShoalVisual {
  readonly metadata: Readonly<AuthoredFishingShoalMetadata>;
  readonly image: Phaser.GameObjects.Image;
}

/** Creates the same fixed-slice home presentation used by game and viewer. */
export function createAuthoredHomeIslandVisual(
  scene: Phaser.Scene,
  assets: Readonly<AuthoredAssetRuntime>,
): AuthoredHomeIslandVisual | undefined {
  const metadata = assets.metadata(AUTHORED_ASSET_IDS.homeIsland);
  if (metadata?.kind !== "home-island") return undefined;
  const slices = [...metadata.render.slices].sort((left, right) => left.depth - right.depth);
  const images: Phaser.GameObjects.Image[] = [];
  for (const slice of slices) {
    const textureKey = assets.textureKey(slice.imageId);
    if (!textureKey) {
      for (const image of images) image.destroy();
      return undefined;
    }
    images.push(scene.add.image(slice.pixelOffset.x, slice.pixelOffset.y, textureKey)
      .setOrigin(0)
      .setDisplaySize(slice.pixelSize.width * slice.scale, slice.pixelSize.height * slice.scale)
      .setDepth(slice.depth)
      .setVisible(false));
  }
  let originX = 0;
  let originY = 0;
  return {
    metadata,
    setPosition: (x, y) => {
      const deltaX = x - originX;
      const deltaY = y - originY;
      originX = x;
      originY = y;
      for (const image of images) image.setPosition(image.x + deltaX, image.y + deltaY);
    },
    setVisible: (visible) => { for (const image of images) image.setVisible(visible); },
    destroy: () => { for (const image of images) image.destroy(); },
  };
}

/** Creates boat and wake images; ShipRenderer remains the animation authority. */
export function createAuthoredPlayerBoatVisual(
  scene: Phaser.Scene,
  assets: Readonly<AuthoredAssetRuntime>,
): AuthoredPlayerBoatVisual | undefined {
  const metadata = assets.metadata(AUTHORED_ASSET_IDS.playerBoat);
  if (metadata?.kind !== "player-boat") return undefined;
  const boatTextureKey = assets.textureKey(metadata.visual.imageId);
  const wakeTextureKey = assets.textureKey(metadata.wake.imageId);
  if (!boatTextureKey || !wakeTextureKey) return undefined;
  return {
    metadata,
    boat: scene.add.image(0, 0, boatTextureKey, 0)
      .setOrigin(metadata.visual.origin.x, metadata.visual.origin.y)
      .setScale(metadata.visual.scale),
    wake: scene.add.image(0, 0, wakeTextureKey, 0)
      .setOrigin(metadata.wake.origin.x, metadata.wake.origin.y)
      .setScale(metadata.wake.scale)
      .setDepth(metadata.wake.depth)
      .setVisible(false),
  };
}

/** Creates the authored base cue; read-model labels remain outside this factory. */
export function createAuthoredFishingShoalVisual(
  scene: Phaser.Scene,
  assets: Readonly<AuthoredAssetRuntime>,
): AuthoredFishingShoalVisual | undefined {
  const metadata = assets.metadata(AUTHORED_ASSET_IDS.fishingShoal);
  if (metadata?.kind !== "fishing-shoal") return undefined;
  const textureKey = assets.textureKey(metadata.visual.imageId);
  if (!textureKey) return undefined;
  return {
    metadata,
    image: scene.add.image(0, 0, textureKey)
      .setOrigin(metadata.visual.origin.x, metadata.visual.origin.y)
      .setScale(metadata.visual.scale),
  };
}
