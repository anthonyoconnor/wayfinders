import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { ShipwreckState } from "../core/types";
import type { WorldGrid } from "../world/WorldGrid";
import type { ActiveChunkEntry } from "./activation";
import {
  ChunkActivatedViewPool,
  type ChunkActivatedViewTelemetry,
  type PresentationChunkImage,
} from "./lifetime";

interface WreckView {
  container: Phaser.GameObjects.Container;
  hull: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

interface WreckPresentationRecord {
  readonly wreck: Readonly<ShipwreckState>;
  readonly visibleNow: boolean;
}

/** Developer-art shipwreck markers retained across later generations. */
export class WreckRenderer {
  private readonly views: ChunkActivatedViewPool<number, WreckPresentationRecord, WreckView>;

  constructor(private readonly scene: Phaser.Scene) {
    this.views = new ChunkActivatedViewPool({
      idOf: ({ wreck }) => wreck.id,
      chunkOf: ({ wreck }) => ({
        x: Math.floor(wreck.tileX / prototypeConfig.navigation.chunkSize),
        y: Math.floor(wreck.tileY / prototypeConfig.navigation.chunkSize),
      }),
      create: ({ wreck }) => this.create(wreck),
      update: (view, record, image) => this.updateView(view, record, image),
      activate: (view, { wreck }, image) => {
        view.container.setActive(true).setVisible(true).setName(`wreck:${wreck.id}@${image.viewKey}`);
      },
      deactivate: (view) => {
        view.container.setActive(false).setVisible(false).setName("wreck:pooled");
      },
      destroy: (view) => view.container.destroy(true),
      maxPooledViews: 16,
    });
  }

  sync(wrecks: readonly Readonly<ShipwreckState>[], world: WorldGrid): void {
    this.views.sync(wrecks.flatMap((wreck): WreckPresentationRecord[] => {
      const visibleNow = world.isVisibleNow(wreck.tileX, wreck.tileY);
      return visibleNow || wreck.discovered ? [{ wreck, visibleNow }] : [];
    }));
  }

  applyActiveChunks(
    chunks: readonly Readonly<ActiveChunkEntry>[],
  ): void {
    this.views.setActiveChunkImages(chunks);
  }

  getLifetimeTelemetry(): Readonly<ChunkActivatedViewTelemetry> {
    return this.views.getTelemetry();
  }

  destroy(): void {
    this.views.destroy();
  }

  private updateView(
    view: WreckView,
    record: Readonly<WreckPresentationRecord>,
    image: Readonly<PresentationChunkImage>,
  ): void {
    const { wreck } = record;
    view.container.setPosition(
      wreck.worldX + image.imageOffset.x,
      wreck.worldY + image.imageOffset.y,
    ).setAlpha(record.visibleNow ? 1 : 0.72);
    view.hull.setRotation(Phaser.Math.DegToRad(wreck.heading));
    view.label.setText(wreck.survey.state === "unexamined"
      ? "UNIDENTIFIED WRECK"
      : `WRECK · GENERATION ${wreck.generation} NAVIGATOR`);
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

    const label = this.scene.add.text(0, size * 0.42, wreck.survey.state === "unexamined"
      ? "UNIDENTIFIED WRECK"
      : `WRECK · GENERATION ${wreck.generation} NAVIGATOR`, {
      align: "center",
      color: "#d8c9a2",
      fontFamily: "ui-monospace, monospace",
      fontSize: "10px",
      fontStyle: "bold",
      stroke: "#06171d",
      strokeThickness: 3,
    }).setOrigin(0.5, 0);
    const container = this.scene.add.container(wreck.worldX, wreck.worldY, [hull, label]).setDepth(36);
    return { container, hull, label };
  }
}
