import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type {
  SurveySiteReadModel,
  SurveySiteType,
} from "../exploration/SurveySiteContracts";
import { gridToChunk, gridToWorld } from "../world/CoordinateSystem";
import type { ActiveChunkEntry } from "./activation";
import {
  ChunkActivatedViewPool,
  type ChunkActivatedViewTelemetry,
  type PresentationChunkImage,
} from "./lifetime";

type SurveySiteState = SurveySiteReadModel<string>["state"];

interface SurveySiteView {
  readonly container: Phaser.GameObjects.Container;
  readonly halo: Phaser.GameObjects.Graphics;
  readonly marker: Phaser.GameObjects.Graphics;
  readonly badge: Phaser.GameObjects.Text;
  readonly label: Phaser.GameObjects.Text;
  renderedState?: SurveySiteState;
  renderedType?: string;
  renderedPresentationId?: string;
  renderedColor?: number;
}

interface StateStyle {
  readonly accent: number;
  readonly labelColor: string;
  readonly alpha: number;
}

const STATE_STYLES: Readonly<Record<SurveySiteState, Readonly<StateStyle>>> = {
  clue: {
    accent: 0x78d9df,
    labelColor: "#b8edf0",
    alpha: 0.68,
  },
  sighted: {
    accent: 0x8ffff2,
    labelColor: "#d0fff9",
    alpha: 0.88,
  },
  "returned-lead": {
    accent: 0xe3c96f,
    labelColor: "#f5e8ad",
    alpha: 0.82,
  },
  surveyed: {
    accent: 0xffad62,
    labelColor: "#ffe1bc",
    alpha: 0.94,
  },
  "returned-report": {
    accent: 0xa9e789,
    labelColor: "#d9ffc4",
    alpha: 1,
  },
};

/**
 * Developer-art presentation for fog-filtered survey-site read models.
 *
 * This adapter deliberately has no catalog or world access. Hidden read-model
 * variants cannot expose a result, so rendering cannot leak unsurveyed content.
 */
export class SurveySiteRenderer {
  private readonly views: ChunkActivatedViewPool<
    string,
    SurveySiteReadModel<string>,
    SurveySiteView
  >;

  constructor(private readonly scene: Phaser.Scene) {
    this.views = new ChunkActivatedViewPool({
      idOf: ({ id }) => id,
      chunkOf: ({ tile }) => gridToChunk(tile),
      create: () => this.createView(),
      update: (view, record, image) => this.updateView(view, record, image),
      activate: (view, { id }, image) => {
        view.container.setActive(true).setVisible(true).setName(`${id}@${image.viewKey}`);
        view.renderedState = undefined;
        view.renderedType = undefined;
        view.renderedPresentationId = undefined;
        view.renderedColor = undefined;
      },
      deactivate: (view) => {
        view.container.setActive(false).setVisible(false).setName("survey-site:pooled");
      },
      destroy: (view) => view.container.destroy(true),
      maxPooledViews: 32,
    });
  }

  sync(records: readonly Readonly<SurveySiteReadModel<string>>[]): void {
    this.views.sync(records);
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
    view: SurveySiteView,
    record: Readonly<SurveySiteReadModel<string>>,
    image: Readonly<PresentationChunkImage>,
  ): void {
    const position = gridToWorld(record.tile, prototypeConfig.navigation.tileSize);
    view.container.setPosition(
      position.x + image.imageOffset.x,
      position.y + image.imageOffset.y,
    );
    if (
      view.renderedState !== record.state
      || view.renderedType !== record.type
      || view.renderedPresentationId !== record.presentation.id
      || view.renderedColor !== record.presentation.color
    ) this.redraw(view, record);
    view.badge.setText(record.presentation.badge);
    view.label.setText(surveySiteLabelFor(record));
  }

  private createView(): SurveySiteView {
    const size = prototypeConfig.navigation.tileSize;
    const halo = this.scene.add.graphics();
    const marker = this.scene.add.graphics();
    const badge = this.scene.add.text(size * 0.42, -size * 0.54, "?", {
      align: "center",
      backgroundColor: "#06191d",
      color: "#f5f0dc",
      fontFamily: "ui-monospace, monospace",
      fontSize: "8px",
      fontStyle: "bold",
      padding: { x: 2, y: 1 },
    }).setOrigin(0.5);
    const label = this.scene.add.text(0, size * 0.68, "", {
      align: "center",
      color: "#d0fff9",
      fontFamily: "ui-monospace, monospace",
      fontSize: "8px",
      fontStyle: "bold",
      stroke: "#041419",
      strokeThickness: 4,
      wordWrap: { width: size * 8, useAdvancedWrap: true },
    }).setOrigin(0.5, 0);
    const container = this.scene.add.container(0, 0, [halo, marker, badge, label]).setDepth(44);
    return { container, halo, marker, badge, label };
  }

  private redraw(view: SurveySiteView, record: Readonly<SurveySiteReadModel<string>>): void {
    const style = STATE_STYLES[record.state];
    const size = prototypeConfig.navigation.tileSize;
    view.halo.clear();
    drawLifecycleHalo(view.halo, record.state, style.accent, size);
    view.marker.clear();
    drawSiteMarker(view.marker, record.type, record.presentation.color, style.accent, size);
    view.label.setColor(style.labelColor);
    view.container.setAlpha(style.alpha);
    view.renderedState = record.state;
    view.renderedType = record.type;
    view.renderedPresentationId = record.presentation.id;
    view.renderedColor = record.presentation.color;
  }
}

/** Pure label formatter kept independent of catalog definitions. */
export function surveySiteLabelFor(record: Readonly<SurveySiteReadModel<string>>): string {
  const heading = typeHeading(record.type, record.typeLabel);
  switch (record.state) {
    case "clue":
      return `${heading} CLUE\n${record.clue.label}`;
    case "sighted":
      return `${heading} SIGHTED\n${record.clue.label}`;
    case "returned-lead":
      return `RETURNED ${heading} LEAD\n${record.clue.label}`;
    case "surveyed":
      return `${heading} SURVEYED\n${record.result.label}`;
    case "returned-report":
      return `RETURNED ${heading} REPORT\n${record.result.label}`;
  }
}

function typeHeading(type: string, typeLabel: string): string {
  // Runtime navigator wrecks use "UNIDENTIFIED WRECK" and generation labels.
  // This explicit old/historic wording prevents the developer markers from
  // implying that a generated site belongs to a lost player navigator.
  if (type === "historic-wreck") return "HISTORIC / OLD WRECK";
  return typeLabel.toUpperCase();
}

function drawLifecycleHalo(
  graphics: Phaser.GameObjects.Graphics,
  state: SurveySiteState,
  accent: number,
  size: number,
): void {
  const radius = size * 0.58;
  graphics.lineStyle(state === "returned-report" ? 3 : 2, accent, state === "clue" ? 0.48 : 0.8);

  if (state === "clue") {
    const inner = radius * 0.72;
    const outer = radius;
    graphics.lineBetween(-outer, 0, -inner, 0);
    graphics.lineBetween(outer, 0, inner, 0);
    graphics.lineBetween(0, -outer, 0, -inner);
    graphics.lineBetween(0, outer, 0, inner);
    return;
  }

  graphics.strokeCircle(0, 0, radius);
  if (state === "returned-lead" || state === "returned-report") {
    const diamond = radius * 1.18;
    graphics.beginPath();
    graphics.moveTo(0, -diamond);
    graphics.lineTo(diamond, 0);
    graphics.lineTo(0, diamond);
    graphics.lineTo(-diamond, 0);
    graphics.closePath();
    graphics.strokePath();
  }
  if (state === "surveyed" || state === "returned-report") {
    graphics.lineStyle(1, accent, 0.55);
    graphics.strokeCircle(0, 0, radius * 1.3);
  }
}

function drawSiteMarker(
  graphics: Phaser.GameObjects.Graphics,
  type: string,
  typeColor: number,
  accent: number,
  size: number,
): void {
  switch (type as SurveySiteType) {
    case "historic-wreck":
      drawHistoricWreck(graphics, typeColor, accent, size);
      return;
    case "coastal-ruin":
      drawCoastalRuin(graphics, typeColor, accent, size);
      return;
    case "tidal-cave":
      drawTidalCave(graphics, typeColor, accent, size);
      return;
    default:
      drawGenericSite(graphics, typeColor, accent, size);
  }
}

/** Ochre hull ribs with no mast or sail: deliberately unlike navigator wreck art. */
function drawHistoricWreck(
  graphics: Phaser.GameObjects.Graphics,
  color: number,
  accent: number,
  size: number,
): void {
  const half = size * 0.46;
  graphics.fillStyle(0x241b17, 0.9);
  graphics.fillEllipse(0, size * 0.06, size * 0.92, size * 0.34);
  graphics.lineStyle(3, color, 1);
  graphics.beginPath();
  graphics.moveTo(-half, -size * 0.05);
  graphics.lineTo(-size * 0.28, size * 0.2);
  graphics.lineTo(size * 0.22, size * 0.24);
  graphics.lineTo(half, 0);
  graphics.strokePath();
  graphics.lineStyle(2, accent, 0.88);
  graphics.lineBetween(-size * 0.27, -size * 0.22, -size * 0.2, size * 0.17);
  graphics.lineBetween(-size * 0.05, -size * 0.28, 0, size * 0.21);
  graphics.lineBetween(size * 0.2, -size * 0.18, size * 0.16, size * 0.18);
  graphics.fillStyle(color, 0.75);
  graphics.fillCircle(-size * 0.45, size * 0.3, size * 0.055);
  graphics.fillCircle(size * 0.36, size * 0.32, size * 0.04);
}

/** Broken stone uprights, lintel, and a visible shoreline foundation. */
function drawCoastalRuin(
  graphics: Phaser.GameObjects.Graphics,
  color: number,
  accent: number,
  size: number,
): void {
  graphics.fillStyle(0x202524, 0.88);
  graphics.fillRoundedRect(-size * 0.45, size * 0.24, size * 0.9, size * 0.18, 2);
  graphics.fillStyle(color, 0.94);
  graphics.fillRect(-size * 0.34, -size * 0.32, size * 0.17, size * 0.58);
  graphics.fillRect(size * 0.16, -size * 0.19, size * 0.16, size * 0.45);
  graphics.fillRect(-size * 0.37, -size * 0.38, size * 0.43, size * 0.12);
  graphics.lineStyle(2, accent, 0.9);
  graphics.strokeRect(-size * 0.34, -size * 0.32, size * 0.17, size * 0.58);
  graphics.strokeRect(size * 0.16, -size * 0.19, size * 0.16, size * 0.45);
  graphics.lineBetween(-size * 0.45, size * 0.25, size * 0.45, size * 0.25);
  graphics.lineStyle(1, 0x5b625e, 0.9);
  graphics.lineBetween(-size * 0.12, size * 0.13, size * 0.06, size * 0.02);
  graphics.lineBetween(size * 0.03, size * 0.2, size * 0.13, size * 0.13);
}

/** Dark arched opening with a bright surf line at its tidal threshold. */
function drawTidalCave(
  graphics: Phaser.GameObjects.Graphics,
  color: number,
  accent: number,
  size: number,
): void {
  graphics.fillStyle(color, 0.82);
  graphics.fillRoundedRect(-size * 0.48, -size * 0.42, size * 0.96, size * 0.78, size * 0.22);
  graphics.lineStyle(2, accent, 0.9);
  graphics.strokeRoundedRect(-size * 0.48, -size * 0.42, size * 0.96, size * 0.78, size * 0.22);
  graphics.fillStyle(0x071014, 1);
  graphics.fillCircle(0, -size * 0.03, size * 0.29);
  graphics.fillRect(-size * 0.29, -size * 0.03, size * 0.58, size * 0.35);
  graphics.lineStyle(2, 0x9cecf1, 0.95);
  graphics.lineBetween(-size * 0.34, size * 0.17, size * 0.34, size * 0.17);
  graphics.lineStyle(1, 0xd5ffff, 0.75);
  graphics.lineBetween(-size * 0.23, size * 0.24, size * 0.06, size * 0.24);
  graphics.lineBetween(size * 0.13, size * 0.27, size * 0.3, size * 0.27);
}

/** Safe developer fallback for a later descriptor awaiting bespoke art. */
function drawGenericSite(
  graphics: Phaser.GameObjects.Graphics,
  color: number,
  accent: number,
  size: number,
): void {
  const radius = size * 0.34;
  graphics.fillStyle(0x07181c, 0.9);
  graphics.fillCircle(0, 0, radius);
  graphics.lineStyle(2, color, 1);
  graphics.beginPath();
  graphics.moveTo(0, -radius);
  graphics.lineTo(radius, 0);
  graphics.lineTo(0, radius);
  graphics.lineTo(-radius, 0);
  graphics.closePath();
  graphics.strokePath();
  graphics.fillStyle(accent, 0.9);
  graphics.fillCircle(0, 0, size * 0.06);
}
