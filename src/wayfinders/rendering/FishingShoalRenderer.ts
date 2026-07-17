import Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredFishingShoalMetadata,
} from "../assets/AuthoredAssetContracts";
import { createAuthoredFishingShoalVisual } from "../assets/AuthoredAssetPresentation";
import type { AuthoredAssetRuntime } from "../assets/PilotAssetRuntime";
import { WATER_TEXTURE_KEYS } from "../assets/water";
import { prototypeConfig } from "../config/prototypeConfig";
import type { FishingShoalReadModel } from "../exploration/FishingShoalContracts";
import { gridToChunk, gridToWorld } from "../world/CoordinateSystem";
import {
  ChunkActivatedViewPool,
  type ChunkActivatedViewTelemetry,
  type PresentationChunkCoordinate,
} from "./lifetime";

type FishingShoalState = FishingShoalReadModel["state"];

interface FishingShoalView {
  container: Phaser.GameObjects.Container;
  authoredVisual?: Phaser.GameObjects.Image;
  connectivityCue: Phaser.GameObjects.Graphics;
  marker: Phaser.GameObjects.Graphics;
  badge: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  renderedState?: FishingShoalState;
  renderedHomeConnected?: boolean;
  phase: number;
}

interface MarkerStyle {
  badge: string;
  color: number;
  labelColor: string;
  alpha: number;
}

const MARKER_STYLES: Readonly<Record<FishingShoalState, Readonly<MarkerStyle>>> = {
  clue: {
    badge: "F?",
    color: 0x69dfe8,
    labelColor: "#a9f7fb",
    alpha: 0.82,
  },
  sighted: {
    badge: "F!",
    color: 0x83fff0,
    labelColor: "#c5fff8",
    alpha: 0.72,
  },
  "returned-lead": {
    badge: "FL",
    color: 0xe8cb72,
    labelColor: "#f7e7ad",
    alpha: 0.65,
  },
  surveyed: {
    badge: "FS",
    color: 0xffb45f,
    labelColor: "#ffe1b6",
    alpha: 0.78,
  },
  "returned-survey": {
    badge: "FR",
    color: 0xb3ef86,
    labelColor: "#d9ffc0",
    alpha: 0.95,
  },
};

/**
 * Developer-art presentation for the fog-filtered fishing-shoal read model.
 *
 * The renderer deliberately has no catalog or world access: hidden definitions
 * cannot become markers, and hidden-quality states cannot expose a quality.
 */
export class FishingShoalRenderer {
  private readonly views: ChunkActivatedViewPool<
    string,
    FishingShoalReadModel,
    FishingShoalView
  >;

  private readonly authoredMetadata?: Readonly<AuthoredFishingShoalMetadata>;
  private readonly authoredAssets?: Readonly<AuthoredAssetRuntime>;

  constructor(
    private readonly scene: Phaser.Scene,
    pilotAssets?: Readonly<AuthoredAssetRuntime>,
  ) {
    this.authoredAssets = pilotAssets;
    const metadata = pilotAssets?.metadata(AUTHORED_ASSET_IDS.fishingShoal);
    this.authoredMetadata = metadata?.kind === "fishing-shoal" ? metadata : undefined;
    this.views = new ChunkActivatedViewPool({
      idOf: ({ id }) => id,
      chunkOf: ({ tile }) => gridToChunk(tile),
      create: () => this.createView(),
      update: (view, record) => this.updateView(view, record),
      activate: (view, { id }) => {
        view.container.setActive(true).setVisible(true).setName(id);
        view.renderedState = undefined;
        view.renderedHomeConnected = undefined;
      },
      deactivate: (view) => {
        view.container.setActive(false).setVisible(false).setName("fishing-shoal:pooled");
        // The texture is shared by the scene asset runtime, but its Phaser image
        // is unique presentation state and should not survive off-window churn.
        view.authoredVisual?.destroy();
        view.authoredVisual = undefined;
      },
      destroy: (view) => view.container.destroy(true),
      maxPooledViews: 32,
    });
  }

  sync(records: readonly Readonly<FishingShoalReadModel>[]): void {
    this.views.sync(records);
  }

  applyActiveChunks(
    chunks: readonly Readonly<{ coordinate: Readonly<PresentationChunkCoordinate> }>[],
  ): void {
    this.views.setActiveChunks(chunks.map(({ coordinate }) => coordinate));
  }

  getLifetimeTelemetry(): Readonly<ChunkActivatedViewTelemetry> {
    return this.views.getTelemetry();
  }

  updatePresentation(timeMilliseconds: number, reducedMotion = false): void {
    this.views.forEachActive((view) => {
      if (!view.authoredVisual) return;
      if (reducedMotion) {
        view.authoredVisual.setAlpha(0.9).setScale(1);
        return;
      }
      const phase = timeMilliseconds * 0.0014 + view.phase;
      view.authoredVisual
        .setAlpha(0.84 + Math.sin(phase * 1.7) * 0.08)
        .setScale(1 + Math.sin(phase) * 0.018);
    });
  }

  destroy(): void {
    this.views.destroy();
  }

  private updateView(
    view: FishingShoalView,
    record: Readonly<FishingShoalReadModel>,
  ): void {
    const position = gridToWorld(record.tile, prototypeConfig.navigation.tileSize);
    view.container.setPosition(position.x, position.y);
    view.phase = [...record.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) * 0.19;
    if (!view.authoredVisual) {
      const authored = this.authoredAssets
        ? createAuthoredFishingShoalVisual(this.scene, this.authoredAssets)
        : undefined;
      view.authoredVisual = authored?.image
        ?? this.scene.add.image(0, 0, WATER_TEXTURE_KEYS.shoalSteady).setOrigin(0.5);
      view.container.addAt(view.authoredVisual, 0);
    }
    view.authoredVisual.setTexture(this.textureFor(record));
    const usesAuthoredVisual = view.authoredVisual !== undefined;
    view.authoredVisual?.setVisible(usesAuthoredVisual);
    view.marker.setVisible(!usesAuthoredVisual);
    view.badge.setVisible(!usesAuthoredVisual);

    const homeConnected = record.state === "returned-survey" && record.homeConnected;
    if (
      view.renderedState !== record.state
      || view.renderedHomeConnected !== homeConnected
    ) {
      this.redraw(view, record.state, homeConnected);
    }
    view.label.setText(this.labelFor(record));
  }

  private createView(): FishingShoalView {
    const connectivityCue = this.scene.add.graphics();
    const marker = this.scene.add.graphics();
    const badge = this.scene.add.text(0, 0, "F?", {
      align: "center",
      color: "#06191d",
      fontFamily: "ui-monospace, monospace",
      fontSize: "8px",
      fontStyle: "bold",
    }).setOrigin(0.5);
    const label = this.scene.add.text(0, prototypeConfig.navigation.tileSize * 0.56, "", {
      align: "center",
      color: "#a9f7fb",
      fontFamily: "ui-monospace, monospace",
      fontSize: "8px",
      fontStyle: "bold",
      stroke: "#041419",
      strokeThickness: 4,
    }).setOrigin(0.5, 0);
    const children: Phaser.GameObjects.GameObject[] = [];
    children.push(connectivityCue, marker, badge, label);
    const container = this.scene.add.container(0, 0, children)
      .setDepth(this.authoredMetadata?.visual.depth ?? 43);
    return { container, connectivityCue, marker, badge, label, phase: 0 };
  }

  private redraw(view: FishingShoalView, state: FishingShoalState, homeConnected: boolean): void {
    const size = prototypeConfig.navigation.tileSize;
    const style = MARKER_STYLES[state];
    const radius = size * 0.28;

    view.connectivityCue.clear().setVisible(homeConnected);
    if (homeConnected) {
      const beaconRadius = radius * 1.78;
      const rayInner = radius * 1.98;
      const rayOuter = radius * 2.48;
      const rayHalfWidth = Math.max(2, size * 0.055);

      // A double-diamond beacon and four solid rays make the home link
      // recognizable independently of label text or colour perception.
      view.connectivityCue.lineStyle(5, 0x66ff9d, 0.18);
      view.connectivityCue.strokeCircle(0, 0, beaconRadius * 1.05);
      view.connectivityCue.lineStyle(2, 0x66ff9d, 1);
      view.connectivityCue.beginPath();
      view.connectivityCue.moveTo(0, -beaconRadius);
      view.connectivityCue.lineTo(beaconRadius, 0);
      view.connectivityCue.lineTo(0, beaconRadius);
      view.connectivityCue.lineTo(-beaconRadius, 0);
      view.connectivityCue.closePath();
      view.connectivityCue.strokePath();
      view.connectivityCue.lineStyle(1, 0xd5ffe2, 0.86);
      view.connectivityCue.beginPath();
      view.connectivityCue.moveTo(0, -beaconRadius * 0.82);
      view.connectivityCue.lineTo(beaconRadius * 0.82, 0);
      view.connectivityCue.lineTo(0, beaconRadius * 0.82);
      view.connectivityCue.lineTo(-beaconRadius * 0.82, 0);
      view.connectivityCue.closePath();
      view.connectivityCue.strokePath();
      view.connectivityCue.fillStyle(0x66ff9d, 1);
      view.connectivityCue.fillTriangle(
        -rayHalfWidth,
        -rayInner,
        rayHalfWidth,
        -rayInner,
        0,
        -rayOuter,
      );
      view.connectivityCue.fillTriangle(
        rayInner,
        -rayHalfWidth,
        rayOuter,
        0,
        rayInner,
        rayHalfWidth,
      );
      view.connectivityCue.fillTriangle(
        -rayHalfWidth,
        rayInner,
        0,
        rayOuter,
        rayHalfWidth,
        rayInner,
      );
      view.connectivityCue.fillTriangle(
        -rayInner,
        -rayHalfWidth,
        -rayInner,
        rayHalfWidth,
        -rayOuter,
        0,
      );
    }

    view.marker.clear();
    view.marker.fillStyle(0x04191e, 0.88);
    view.marker.fillCircle(0, 0, radius);
    view.marker.lineStyle(2, style.color, 1);
    view.marker.strokeCircle(0, 0, radius);
    view.marker.lineBetween(-radius * 1.45, 0, -radius * 0.88, 0);
    view.marker.lineBetween(radius * 0.88, 0, radius * 1.45, 0);
    view.marker.lineBetween(0, -radius * 1.45, 0, -radius * 0.88);
    view.marker.lineBetween(0, radius * 0.88, 0, radius * 1.45);
    if (state === "sighted" || state === "surveyed") {
      view.marker.lineStyle(1, style.color, 0.55);
      view.marker.strokeCircle(0, 0, radius * 1.35);
    }

    view.badge.setText(style.badge);
    view.label.setColor(style.labelColor);
    view.container.setAlpha(style.alpha);
    view.renderedState = state;
    view.renderedHomeConnected = homeConnected;
  }

  private labelFor(record: Readonly<FishingShoalReadModel>): string {
    switch (record.state) {
      case "clue":
        return `FISHING CLUE\n${record.clue.label}`;
      case "sighted":
        return `SHOAL SIGHTED\n${record.clue.label}`;
      case "returned-lead":
        return `RETURNED LEAD\n${record.clue.label}`;
      case "surveyed":
        return `SURVEYED - ${record.quality.toUpperCase()}\n${record.clue.label}`;
      case "returned-survey":
        return record.homeConnected
          ? `HOME-LINKED FISHING GROUND\n${record.quality.toUpperCase()} - ${record.clue.label}`
          : `RETURNED SURVEY - ${record.quality.toUpperCase()}\n${record.clue.label}`;
    }
  }

  private textureFor(record: Readonly<FishingShoalReadModel>): string {
    if (record.state === "surveyed" || record.state === "returned-survey") {
      if (record.quality === "lean") return WATER_TEXTURE_KEYS.shoalLean;
      if (record.quality === "rich") return WATER_TEXTURE_KEYS.shoalRich;
    }
    return WATER_TEXTURE_KEYS.shoalSteady;
  }
}
