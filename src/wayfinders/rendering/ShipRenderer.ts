import Phaser from "phaser";
import type { AuthoredPlayerBoatMetadata } from "../assets/AuthoredAssetContracts";
import { createAuthoredPlayerBoatVisual } from "../assets/AuthoredAssetPresentation";
import type { AuthoredAssetRuntime } from "../assets/PilotAssetRuntime";
import { prototypeConfig } from "../config/prototypeConfig";
import { interpolateShipPose, type ShipRenderPose } from "./ShipPose";
import { resolveShipAnimationState } from "./ShipAnimation";

/** Authored animated vessel with a functional developer-art fallback. */
export class ShipRenderer {
  readonly container: Phaser.GameObjects.Container;

  private readonly developerWake: Phaser.GameObjects.Graphics;
  private readonly hull: Phaser.GameObjects.Graphics;
  private readonly authoredBoat?: Phaser.GameObjects.Image;
  private readonly authoredWake?: Phaser.GameObjects.Image;
  private readonly authoredMetadata?: Readonly<AuthoredPlayerBoatMetadata>;
  private readonly sourceHeadingDegrees: number;

  constructor(
    private readonly scene: Phaser.Scene,
    pilotAssets?: Readonly<AuthoredAssetRuntime>,
  ) {
    const size = prototypeConfig.navigation.tileSize;
    this.developerWake = scene.add.graphics();
    this.hull = scene.add.graphics();

    this.developerWake.lineStyle(2, 0xb9eeee, 0.55);
    this.developerWake.beginPath();
    this.developerWake.moveTo(-size * 0.28, -size * 0.14);
    this.developerWake.lineTo(-size * 0.88, -size * 0.34);
    this.developerWake.moveTo(-size * 0.28, size * 0.14);
    this.developerWake.lineTo(-size * 0.88, size * 0.34);
    this.developerWake.strokePath();

    this.hull.fillStyle(0x4a2d20, 1);
    this.hull.fillTriangle(size * 0.46, 0, -size * 0.38, -size * 0.25, -size * 0.38, size * 0.25);
    this.hull.lineStyle(2, 0xd2a95e, 1);
    this.hull.strokeTriangle(size * 0.46, 0, -size * 0.38, -size * 0.25, -size * 0.38, size * 0.25);
    this.hull.fillStyle(0xefe0b5, 1);
    this.hull.fillTriangle(-size * 0.08, -size * 0.08, -size * 0.08, -size * 0.68, size * 0.22, -size * 0.08);
    this.hull.lineStyle(2, 0xd2a95e, 1);
    this.hull.lineBetween(-size * 0.08, -size * 0.68, -size * 0.08, size * 0.23);

    const authored = pilotAssets
      ? createAuthoredPlayerBoatVisual(scene, pilotAssets)
      : undefined;
    const metadata = authored?.metadata;
    if (authored) {
      this.authoredMetadata = authored.metadata;
      this.authoredBoat = authored.boat;
      this.authoredWake = authored.wake;
      this.hull.setVisible(false);
      this.developerWake.setVisible(false);
    }
    this.sourceHeadingDegrees = metadata?.kind === "player-boat"
      ? metadata.visual.sourceHeadingDegrees
      : 0;
    const children: Phaser.GameObjects.GameObject[] = [this.developerWake, this.hull];
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
      .setPosition(worldX, worldY);
    if (this.authoredMetadata && this.authoredBoat && this.authoredWake) {
      const animation = resolveShipAnimationState(
        this.authoredMetadata,
        heading,
        speed,
        this.scene.time.now,
      );
      this.container.setRotation(Phaser.Math.DegToRad(animation.boatRotationDegrees));
      this.authoredBoat.setFrame(animation.boatFrame).setScale(animation.boatScale);
      this.authoredWake
        .setFrame(animation.wake.frame)
        .setPosition(worldX + animation.wake.offsetX, worldY + animation.wake.offsetY)
        .setRotation(Phaser.Math.DegToRad(animation.wake.rotationDegrees))
        .setScale(animation.wake.scaleX, animation.wake.scaleY)
        .setAlpha(animation.wake.alpha)
        .setVisible(visible && animation.wake.visible);
      return;
    }

    this.container.setRotation(Phaser.Math.DegToRad(heading - this.sourceHeadingDegrees));
    const moving = Math.abs(speed) > prototypeConfig.navigation.tileSize * 0.05;
    this.developerWake.setVisible(moving);
    if (moving) {
      const pulse = 0.58 + Math.sin(this.scene.time.now * 0.008) * 0.16;
      this.developerWake.setAlpha(pulse);
    }
  }

  destroy(): void {
    this.authoredWake?.destroy();
    this.container.destroy(true);
  }
}
