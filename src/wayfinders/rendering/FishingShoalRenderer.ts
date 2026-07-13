import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { FishingShoalReadModel } from "../exploration/FishingShoalContracts";
import { gridToWorld } from "../world/CoordinateSystem";

type FishingShoalState = FishingShoalReadModel["state"];

interface FishingShoalView {
  container: Phaser.GameObjects.Container;
  marker: Phaser.GameObjects.Graphics;
  badge: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  renderedState?: FishingShoalState;
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
    alpha: 1,
  },
  "returned-lead": {
    badge: "FL",
    color: 0xe8cb72,
    labelColor: "#f7e7ad",
    alpha: 0.9,
  },
  surveyed: {
    badge: "FS",
    color: 0xffb45f,
    labelColor: "#ffe1b6",
    alpha: 1,
  },
  "returned-survey": {
    badge: "FR",
    color: 0xb3ef86,
    labelColor: "#d9ffc0",
    alpha: 0.92,
  },
};

/**
 * Developer-art presentation for the fog-filtered fishing-shoal read model.
 *
 * The renderer deliberately has no catalog or world access: hidden definitions
 * cannot become markers, and hidden-quality states cannot expose a quality.
 */
export class FishingShoalRenderer {
  private readonly viewsById = new Map<string, FishingShoalView>();
  private readonly viewPool: FishingShoalView[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

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

      if (view.renderedState !== record.state) this.redraw(view, record.state);
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
    view.renderedState = undefined;
    this.viewsById.set(id, view);
    return view;
  }

  private createView(): FishingShoalView {
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
    const container = this.scene.add.container(0, 0, [marker, badge, label]).setDepth(43);
    return { container, marker, badge, label };
  }

  private redraw(view: FishingShoalView, state: FishingShoalState): void {
    const size = prototypeConfig.navigation.tileSize;
    const style = MARKER_STYLES[state];
    const radius = size * 0.28;

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
        return `${record.homeConnected ? "HOME-LINKED" : "UNCONNECTED"} - ${record.quality.toUpperCase()}\n${record.clue.label}`;
    }
  }
}
