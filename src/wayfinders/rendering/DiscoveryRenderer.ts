import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import { DiscoveryType, type DiscoveryRecord } from "../exploration/DiscoverySystem";
import { gridToWorld } from "../world/CoordinateSystem";

interface DiscoveryView {
  container: Phaser.GameObjects.Container;
  marker: Phaser.GameObjects.Graphics;
  badge: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  returned: boolean;
}

const TYPE_BADGES: Readonly<Record<DiscoveryType, string>> = {
  [DiscoveryType.Island]: "I",
  [DiscoveryType.Settlement]: "S",
  [DiscoveryType.FishingGround]: "F",
  [DiscoveryType.Anchorage]: "A",
  [DiscoveryType.ReefPassage]: "P",
  [DiscoveryType.HistoricWreck]: "H",
  [DiscoveryType.Resource]: "R",
};

/** Functional chart pins for provisional and safely returned discoveries. */
export class DiscoveryRenderer {
  private readonly views = new Map<number, DiscoveryView>();

  constructor(private readonly scene: Phaser.Scene) {}

  sync(records: readonly Readonly<DiscoveryRecord>[]): void {
    const liveIds = new Set(records.map(({ id }) => id));
    for (const [id, view] of this.views) {
      if (liveIds.has(id)) continue;
      view.container.destroy(true);
      this.views.delete(id);
    }

    for (const record of records) {
      const view = this.views.get(record.id) ?? this.create(record);
      const position = gridToWorld(
        { x: record.tileX, y: record.tileY },
        prototypeConfig.navigation.tileSize,
      );
      view.container.setPosition(position.x, position.y);
      if (view.returned !== record.returned) this.redraw(view, record.returned);
      view.badge.setText(TYPE_BADGES[record.type]);
      view.label.setText(`${record.name}\n${record.returned ? "RETURNED" : "PROVISIONAL"} · ${record.rewardLabel}`);
      view.container.setAlpha(record.returned ? 0.9 : 1);
    }
  }

  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    const margin = prototypeConfig.navigation.tileSize * 3;
    const view = camera.worldView;
    for (const { container } of this.views.values()) {
      container.setVisible(
        container.x >= view.left - margin
        && container.x <= view.right + margin
        && container.y >= view.top - margin
        && container.y <= view.bottom + margin,
      );
    }
  }

  destroy(): void {
    for (const view of this.views.values()) view.container.destroy(true);
    this.views.clear();
  }

  private create(record: Readonly<DiscoveryRecord>): DiscoveryView {
    const marker = this.scene.add.graphics();
    const badge = this.scene.add.text(0, 0, TYPE_BADGES[record.type], {
      align: "center",
      color: "#071a20",
      fontFamily: "ui-monospace, monospace",
      fontSize: "9px",
      fontStyle: "bold",
    }).setOrigin(0.5);
    const label = this.scene.add.text(0, prototypeConfig.navigation.tileSize * 0.5, "", {
      align: "center",
      color: "#d9fff5",
      fontFamily: "ui-monospace, monospace",
      fontSize: "9px",
      fontStyle: "bold",
      stroke: "#041419",
      strokeThickness: 4,
    }).setOrigin(0.5, 0);
    const container = this.scene.add.container(0, 0, [marker, badge, label]).setDepth(42);
    const view = { container, marker, badge, label, returned: !record.returned };
    this.views.set(record.id, view);
    this.redraw(view, record.returned);
    return view;
  }

  private redraw(view: DiscoveryView, returned: boolean): void {
    const size = prototypeConfig.navigation.tileSize;
    const color = returned ? 0xd7bf6a : 0x77e7dc;
    view.marker.clear();
    view.marker.fillStyle(0x061923, 0.88);
    view.marker.fillCircle(0, 0, size * 0.29);
    view.marker.lineStyle(2, color, 1);
    view.marker.strokeCircle(0, 0, size * 0.29);
    view.marker.lineBetween(0, size * 0.29, 0, size * 0.48);
    if (!returned) {
      view.marker.lineStyle(1, color, 0.65);
      view.marker.strokeCircle(0, 0, size * 0.38);
    }
    view.label.setColor(returned ? "#eadb9f" : "#b9fff5");
    view.returned = returned;
  }
}
