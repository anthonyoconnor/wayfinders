import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { ShipwreckState } from "../core/types";
import type { WorldGrid } from "../world/WorldGrid";

interface WreckView {
  container: Phaser.GameObjects.Container;
  hull: Phaser.GameObjects.Graphics;
  known: boolean;
}

/** Developer-art shipwreck markers retained across later generations. */
export class WreckRenderer {
  private readonly views = new Map<number, WreckView>();

  constructor(private readonly scene: Phaser.Scene) {}

  sync(wrecks: readonly Readonly<ShipwreckState>[], world: WorldGrid): void {
    const liveIds = new Set(wrecks.map((wreck) => wreck.id));
    for (const [id, view] of this.views) {
      if (liveIds.has(id)) continue;
      view.container.destroy(true);
      this.views.delete(id);
    }

    for (const wreck of wrecks) {
      const view = this.views.get(wreck.id) ?? this.create(wreck);
      view.container.setPosition(wreck.worldX, wreck.worldY);
      view.hull.setRotation(Phaser.Math.DegToRad(wreck.heading));
      const visibleNow = world.isVisibleNow(wreck.tileX, wreck.tileY);
      const known = visibleNow || wreck.discovered;
      view.known = known;
      view.container.setVisible(known).setAlpha(visibleNow ? 1 : 0.72);
    }
  }

  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    const margin = prototypeConfig.navigation.tileSize * 3;
    const cameraView = camera.worldView;
    for (const view of this.views.values()) {
      const { container } = view;
      container.setVisible(
        view.known
        && container.x >= cameraView.left - margin
        && container.x <= cameraView.right + margin
        && container.y >= cameraView.top - margin
        && container.y <= cameraView.bottom + margin,
      );
    }
  }

  destroy(): void {
    for (const view of this.views.values()) view.container.destroy(true);
    this.views.clear();
  }

  private create(wreck: Readonly<ShipwreckState>): WreckView {
    const size = prototypeConfig.navigation.tileSize;
    const hull = this.scene.add.graphics();
    hull.lineStyle(3, 0x34271f, 1);
    hull.beginPath();
    hull.moveTo(-size * 0.42, -size * 0.2);
    hull.lineTo(-size * 0.08, -size * 0.28);
    hull.lineTo(size * 0.12, -size * 0.08);
    hull.moveTo(size * 0.2, size * 0.02);
    hull.lineTo(size * 0.38, size * 0.2);
    hull.lineTo(-size * 0.3, size * 0.25);
    hull.strokePath();
    hull.lineStyle(2, 0x8f795c, 0.9);
    hull.lineBetween(-size * 0.02, -size * 0.16, size * 0.18, -size * 0.62);
    hull.fillStyle(0xc7b47d, 0.7);
    hull.fillTriangle(size * 0.15, -size * 0.55, size * 0.34, -size * 0.34, size * 0.2, -size * 0.28);

    const label = this.scene.add.text(0, size * 0.42, `WRECK · GENERATION ${wreck.generation}`, {
      align: "center",
      color: "#d8c9a2",
      fontFamily: "ui-monospace, monospace",
      fontSize: "10px",
      fontStyle: "bold",
      stroke: "#06171d",
      strokeThickness: 3,
    }).setOrigin(0.5, 0);
    const container = this.scene.add.container(wreck.worldX, wreck.worldY, [hull, label]).setDepth(36);
    const view = { container, hull, known: false };
    this.views.set(wreck.id, view);
    return view;
  }
}
