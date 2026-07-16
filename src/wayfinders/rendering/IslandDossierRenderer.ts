import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { IslandDossierReadModelV1 } from "../exploration/IslandDossierContracts";
import { gridToChunk, gridToWorld } from "../world/CoordinateSystem";
import {
  ChunkActivatedViewPool,
  presentationChunksForWorldBounds,
  type ChunkActivatedViewTelemetry,
  type PresentationChunkCoordinate,
} from "./lifetime";

type IslandDossierState = IslandDossierReadModelV1["state"];

interface IslandDossierView {
  readonly container: Phaser.GameObjects.Container;
  readonly marker: Phaser.GameObjects.Graphics;
  readonly badge: Phaser.GameObjects.Text;
  readonly label: Phaser.GameObjects.Text;
  renderedState?: IslandDossierState;
}

interface MarkerStyle {
  readonly badge: string;
  readonly color: number;
  readonly labelColor: string;
  readonly alpha: number;
}

const MARKER_STYLES: Readonly<Record<IslandDossierState, Readonly<MarkerStyle>>> = {
  sighted: { badge: "I?", color: 0x72e6f0, labelColor: "#bffaff", alpha: 0.78 },
  "returned-lead": { badge: "IL", color: 0xe4c66c, labelColor: "#f4e4aa", alpha: 0.72 },
  surveyed: { badge: "ID", color: 0xffad55, labelColor: "#ffddb0", alpha: 0.86 },
  "returned-dossier": { badge: "IR", color: 0xa9ec81, labelColor: "#d9ffc1", alpha: 0.96 },
};

/** Developer-art coastal chart mark for one dossier owned by one exact island ID. */
export class IslandDossierRenderer {
  private readonly views: ChunkActivatedViewPool<
    number,
    IslandDossierReadModelV1,
    IslandDossierView
  >;

  constructor(private readonly scene: Phaser.Scene) {
    this.views = new ChunkActivatedViewPool({
      idOf: ({ islandId }) => islandId,
      chunkOf: ({ canonicalApproach }) => gridToChunk(canonicalApproach),
      create: () => this.createView(),
      update: (view, record) => this.updateView(view, record),
      activate: (view, { islandId }) => {
        view.container.setActive(true).setVisible(true).setName(`island-dossier:${islandId}`);
        view.renderedState = undefined;
      },
      deactivate: (view) => {
        view.container.setActive(false).setVisible(false).setName("island-dossier:pooled");
      },
      destroy: (view) => view.container.destroy(true),
      maxPooledViews: 32,
    });
  }

  sync(records: readonly Readonly<IslandDossierReadModelV1>[]): void {
    this.views.sync(records);
  }

  /** Uses the shared ActiveChunkSet ordering without importing its owner. */
  applyActiveChunks(
    chunks: readonly Readonly<{ coordinate: Readonly<PresentationChunkCoordinate> }>[],
  ): void {
    this.views.setActiveChunks(chunks.map(({ coordinate }) => coordinate));
  }

  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    const margin = prototypeConfig.navigation.tileSize * 4;
    const viewport = camera.worldView;
    this.views.setActiveChunks(presentationChunksForWorldBounds({
      minX: viewport.left - margin,
      minY: viewport.top - margin,
      maxX: viewport.right + margin,
      maxY: viewport.bottom + margin,
    }, prototypeConfig.navigation.tileSize * prototypeConfig.navigation.chunkSize));
  }

  getLifetimeTelemetry(): Readonly<ChunkActivatedViewTelemetry> {
    return this.views.getTelemetry();
  }

  destroy(): void {
    this.views.destroy();
  }

  private updateView(
    view: IslandDossierView,
    record: Readonly<IslandDossierReadModelV1>,
  ): void {
    const position = gridToWorld(record.canonicalApproach, prototypeConfig.navigation.tileSize);
    view.container.setPosition(position.x, position.y);
    if (view.renderedState !== record.state) this.redraw(view, record.state);
    view.label.setText(this.labelFor(record));
  }

  private createView(): IslandDossierView {
    const marker = this.scene.add.graphics();
    const badge = this.scene.add.text(0, 0, "I?", {
      align: "center",
      color: "#07191d",
      fontFamily: "ui-monospace, monospace",
      fontSize: "8px",
      fontStyle: "bold",
    }).setOrigin(0.5);
    const label = this.scene.add.text(0, prototypeConfig.navigation.tileSize * 0.67, "", {
      align: "center",
      color: "#bffaff",
      fontFamily: "ui-monospace, monospace",
      fontSize: "8px",
      fontStyle: "bold",
      stroke: "#041419",
      strokeThickness: 4,
    }).setOrigin(0.5, 0);
    const container = this.scene.add.container(0, 0, [marker, badge, label]).setDepth(44);
    return { container, marker, badge, label };
  }

  private redraw(view: IslandDossierView, state: IslandDossierState): void {
    const size = prototypeConfig.navigation.tileSize;
    const style = MARKER_STYLES[state];
    const radius = size * 0.31;
    view.marker.clear();

    // A small coastline-and-island chart glyph keeps this developer mark
    // distinct from point sites, shoals and navigator wrecks.
    view.marker.fillStyle(0x061a20, 0.9);
    view.marker.fillCircle(0, 0, radius * 1.2);
    view.marker.lineStyle(2, style.color, 1);
    view.marker.beginPath();
    view.marker.moveTo(-radius * 0.72, radius * 0.18);
    view.marker.lineTo(-radius * 0.36, -radius * 0.48);
    view.marker.lineTo(radius * 0.2, -radius * 0.62);
    view.marker.lineTo(radius * 0.72, -radius * 0.05);
    view.marker.lineTo(radius * 0.42, radius * 0.52);
    view.marker.lineTo(-radius * 0.42, radius * 0.58);
    view.marker.closePath();
    view.marker.strokePath();
    view.marker.lineStyle(1, style.color, 0.7);
    view.marker.lineBetween(-radius * 1.45, radius * 0.83, radius * 1.45, radius * 0.83);
    if (state === "surveyed" || state === "returned-dossier") {
      view.marker.lineStyle(2, style.color, 0.78);
      view.marker.strokeCircle(0, 0, radius * 1.46);
    }

    view.badge.setText(style.badge);
    view.label.setColor(style.labelColor);
    view.container.setAlpha(style.alpha);
    view.renderedState = state;
  }

  private labelFor(record: Readonly<IslandDossierReadModelV1>): string {
    switch (record.state) {
      case "sighted": return `${record.name.toUpperCase()}\nISLAND SIGHTED`;
      case "returned-lead": return `${record.name.toUpperCase()}\nRETURNED ISLAND LEAD`;
      case "surveyed": return `${record.name.toUpperCase()}\nDOSSIER: ${record.dossier.findingLabel.toUpperCase()}`;
      case "returned-dossier": return `${record.name.toUpperCase()}\nRETURNED DOSSIER: ${record.dossier.findingLabel.toUpperCase()}`;
    }
  }
}
