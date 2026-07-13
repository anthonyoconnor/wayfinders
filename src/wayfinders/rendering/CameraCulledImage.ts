import Phaser from "phaser";

export interface WorldCullBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Creates a static world image that opts out before WebGL submission when its chunk is off-camera. */
export function createCameraCulledImage(
  scene: Phaser.Scene,
  x: number,
  y: number,
  texture: string | Phaser.Textures.Texture,
  frame: string | number | undefined,
  worldBounds: WorldCullBounds,
): Phaser.GameObjects.Image {
  const image = scene.add.image(x, y, texture, frame);
  const defaultWillRender = typeof image.willRender === "function"
    ? image.willRender.bind(image)
    : () => true;
  image.willRender = (camera: Phaser.Cameras.Scene2D.Camera): boolean => {
    if (!defaultWillRender(camera)) return false;
    const view = camera.worldView;
    return worldBounds.right >= view.left
      && worldBounds.left <= view.right
      && worldBounds.bottom >= view.top
      && worldBounds.top <= view.bottom;
  };
  return image;
}
