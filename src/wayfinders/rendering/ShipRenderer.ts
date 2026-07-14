import Phaser from "phaser";
import { AUTHORED_ASSET_IDS } from "../assets/AuthoredAssetContracts";
import type { PilotAssetRuntime } from "../assets/PilotAssetRuntime";
import { prototypeConfig } from "../config/prototypeConfig";
import { interpolateShipPose, type ShipRenderPose } from "./ShipPose";

/** Functional developer-art vessel with a readable heading and lightweight wake. */
export class ShipRenderer {
  readonly container: Phaser.GameObjects.Container;

  private readonly wake: Phaser.GameObjects.Graphics;
  private readonly hull: Phaser.GameObjects.Graphics;
  private readonly authoredBoat?: Phaser.GameObjects.Image;
  private readonly sourceHeadingDegrees: number;

  constructor(
    private readonly scene: Phaser.Scene,
    pilotAssets?: Readonly<PilotAssetRuntime>,
  ) {
    const size = prototypeConfig.navigation.tileSize;
    this.wake = scene.add.graphics();
    this.hull = scene.add.graphics();

    this.wake.lineStyle(2, 0xb9eeee, 0.55);
    this.wake.beginPath();
    this.wake.moveTo(-size * 0.28, -size * 0.14);
    this.wake.lineTo(-size * 0.88, -size * 0.34);
    this.wake.moveTo(-size * 0.28, size * 0.14);
    this.wake.lineTo(-size * 0.88, size * 0.34);
    this.wake.strokePath();

    this.hull.fillStyle(0x4a2d20, 1);
    this.hull.fillTriangle(size * 0.46, 0, -size * 0.38, -size * 0.25, -size * 0.38, size * 0.25);
    this.hull.lineStyle(2, 0xd2a95e, 1);
    this.hull.strokeTriangle(size * 0.46, 0, -size * 0.38, -size * 0.25, -size * 0.38, size * 0.25);
    this.hull.fillStyle(0xefe0b5, 1);
    this.hull.fillTriangle(-size * 0.08, -size * 0.08, -size * 0.08, -size * 0.68, size * 0.22, -size * 0.08);
    this.hull.lineStyle(2, 0xd2a95e, 1);
    this.hull.lineBetween(-size * 0.08, -size * 0.68, -size * 0.08, size * 0.23);

    const metadata = pilotAssets?.metadata(AUTHORED_ASSET_IDS.playerBoat);
    if (metadata?.kind === "player-boat") {
      const textureKey = pilotAssets?.textureKey(metadata.visual.imageId);
      if (textureKey) {
        this.authoredBoat = scene.add.image(0, 0, textureKey)
          .setOrigin(metadata.visual.origin.x, metadata.visual.origin.y)
          .setScale(metadata.visual.scale);
        this.hull.setVisible(false);
      }
    }
    this.sourceHeadingDegrees = metadata?.kind === "player-boat"
      ? metadata.visual.sourceHeadingDegrees
      : 0;
    const children: Phaser.GameObjects.GameObject[] = [this.wake, this.hull];
    if (this.authoredBoat) children.push(this.authoredBoat);
    this.container = scene.add.container(0, 0, children)
      .setDepth(metadata?.kind === "player-boat" ? metadata.visual.depth : 50);
  }

  sync(state: Readonly<ShipRenderPose>, visible = true): void {
    this.applyPose(state.worldX, state.worldY, state.heading, state.speed, visible);
  }

  syncInterpolated(
    previous: Readonly<ShipRenderPose>,
    current: Readonly<ShipRenderPose>,
    alpha: number,
    visible = true,
  ): void {
    const pose = interpolateShipPose(previous, current, alpha);
    this.applyPose(
      pose.worldX,
      pose.worldY,
      pose.heading,
      pose.speed,
      visible,
    );
  }

  private applyPose(worldX: number, worldY: number, heading: number, speed: number, visible: boolean): void {
    this.container
      .setVisible(visible)
      .setPosition(worldX, worldY)
      .setRotation(Phaser.Math.DegToRad(heading - this.sourceHeadingDegrees));
    const moving = Math.abs(speed) > prototypeConfig.navigation.tileSize * 0.05;
    this.wake.setVisible(moving);
    if (moving) {
      const pulse = 0.58 + Math.sin(this.scene.time.now * 0.008) * 0.16;
      this.wake.setAlpha(pulse);
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
