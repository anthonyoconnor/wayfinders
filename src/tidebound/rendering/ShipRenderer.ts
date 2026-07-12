import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { ShipState } from "../core/types";

/** Functional developer-art vessel with a readable heading and lightweight wake. */
export class ShipRenderer {
  readonly container: Phaser.GameObjects.Container;

  private readonly wake: Phaser.GameObjects.Graphics;
  private readonly hull: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
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

    this.container = scene.add.container(0, 0, [this.wake, this.hull]).setDepth(50);
  }

  sync(state: Readonly<ShipState>): void {
    this.container
      .setPosition(state.worldX, state.worldY)
      .setRotation(Phaser.Math.DegToRad(state.heading));
    const moving = Math.abs(state.speed) > prototypeConfig.navigation.tileSize * 0.05;
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
