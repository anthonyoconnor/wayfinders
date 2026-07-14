import Phaser from "phaser";
import { AUTHORED_ASSET_IDS, type AuthoredFishingShoalMetadata } from "../assets/AuthoredAssetContracts";
import type { PilotAssetRuntime } from "../assets/PilotAssetRuntime";
import { prototypeConfig } from "../config/prototypeConfig";
import { createFishingShoalId, type FishingShoalReadModel } from "../exploration/FishingShoalContracts";
import { gridToWorld } from "../world/CoordinateSystem";

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

const PILOT_SHOAL_ID = createFishingShoalId(0);

/**
 * Developer-art presentation for the fog-filtered fishing-shoal read model.
 *
 * The renderer deliberately has no catalog or world access: hidden definitions
 * cannot become markers, and hidden-quality states cannot expose a quality.
 */
export class FishingShoalRenderer {
  private readonly viewsById = new Map<string, FishingShoalView>();
  private readonly viewPool: FishingShoalView[] = [];

  private readonly authoredMetadata?: Readonly<AuthoredFishingShoalMetadata>;
  private readonly authoredTextureKey?: string;

  constructor(
    private readonly scene: Phaser.Scene,
    pilotAssets?: Readonly<PilotAssetRuntime>,
  ) {
    const metadata = pilotAssets?.metadata(AUTHORED_ASSET_IDS.fishingShoal);
    if (metadata?.kind === "fishing-shoal") {
      this.authoredMetadata = metadata;
      this.authoredTextureKey = pilotAssets?.textureKey(metadata.visual.imageId);
    }
  }

  sync(records: readonly Readonly<FishingShoalReadModel>[]): void {
    const liveIds = new Set<string>();
    for (const record of records) liveIds.add(record.id);

    for (const [id, view] of this.viewsById) {
      if (liveIds.has(id)) continue;
      this.viewsById.delete(id);
      view.container.setActive(false).setVisible(false).setName("fishing-shoal:pooled");
      this.viewPool.push(view);
    }

    for (const record of records) {
      const view = this.viewsById.get(record.id) ?? this.acquire(record.id);
      const position = gridToWorld(record.tile, prototypeConfig.navigation.tileSize);
      view.container.setPosition(position.x, position.y);

      const homeConnected = record.state === "returned-survey" && record.homeConnected;
      if (
        view.renderedState !== record.state
        || view.renderedHomeConnected !== homeConnected
      ) {
        this.redraw(view, record.state, homeConnected);
      }
      view.label.setText(this.labelFor(record));
    }
  }

  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    const margin = prototypeConfig.navigation.tileSize * 3;
    const viewport = camera.worldView;
    for (const { container } of this.viewsById.values()) {
      container.setVisible(
        container.x >= viewport.left - margin
        && container.x <= viewport.right + margin
        && container.y >= viewport.top - margin
        && container.y <= viewport.bottom + margin,
      );
    }
  }

  destroy(): void {
    for (const view of this.viewsById.values()) view.container.destroy(true);
    for (const view of this.viewPool) view.container.destroy(true);
    this.viewsById.clear();
    this.viewPool.length = 0;
  }

  private acquire(id: string): FishingShoalView {
    const view = this.viewPool.pop() ?? this.createView();
    view.container.setActive(true).setVisible(true).setName(id);
    const usesAuthoredVisual = id === PILOT_SHOAL_ID && view.authoredVisual !== undefined;
    view.authoredVisual?.setVisible(usesAuthoredVisual);
    view.marker.setVisible(!usesAuthoredVisual);
    view.badge.setVisible(!usesAuthoredVisual);
    view.renderedState = undefined;
    view.renderedHomeConnected = undefined;
    this.viewsById.set(id, view);
    return view;
  }

  private createView(): FishingShoalView {
    const authoredVisual = this.authoredMetadata && this.authoredTextureKey
      ? this.scene.add.image(0, 0, this.authoredTextureKey)
        .setOrigin(this.authoredMetadata.visual.origin.x, this.authoredMetadata.visual.origin.y)
        .setScale(this.authoredMetadata.visual.scale)
      : undefined;
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
    if (authoredVisual) children.push(authoredVisual);
    children.push(connectivityCue, marker, badge, label);
    const container = this.scene.add.container(0, 0, children)
      .setDepth(this.authoredMetadata?.visual.depth ?? 43);
    return { container, authoredVisual, connectivityCue, marker, badge, label };
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
}
