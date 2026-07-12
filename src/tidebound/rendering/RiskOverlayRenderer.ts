import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { DebugVisibilityState } from "../core/GameSimulation";
import type { ForwardRangeResult } from "../exploration/ForwardRangeSystem";
import { ReturnRiskLevel, type ReturnPathResult } from "../exploration/ReturnPathSystem";
import type { WorldGrid } from "../world/WorldGrid";

interface OverlayView {
  forwardTexture: Phaser.Textures.CanvasTexture;
  forwardImage: Phaser.GameObjects.Image;
  returnTexture: Phaser.Textures.CanvasTexture;
  returnImage: Phaser.GameObjects.Image;
  width: number;
  height: number;
}

const OVERLAY_SCALE = 6;

/** Renders the cost-grid results without exposing hidden terrain or numbers. */
export class RiskOverlayRenderer {
  private view?: OverlayView;
  private lastRevision = -1;
  private lastSignature = "";
  private readonly keyPrefix: string;

  constructor(private readonly scene: Phaser.Scene) {
    this.keyPrefix = `${String(scene.sys.settings.key)}-risk`;
  }

  sync(
    world: WorldGrid,
    forward: ForwardRangeResult,
    returning: ReturnPathResult,
    debug: Readonly<DebugVisibilityState>,
    revision: number,
    force = false,
  ): void {
    const view = this.getOrCreateView(world);
    view.forwardImage.setVisible(debug.forwardRange);
    view.returnImage.setVisible(debug.returnViability);

    const signature = `${prototypeConfig.overlays.forwardOverlayOpacity}:${prototypeConfig.overlays.returnOverlayOpacity}`;
    if (!force && revision === this.lastRevision && signature === this.lastSignature) return;
    this.lastRevision = revision;
    this.lastSignature = signature;
    this.renderForward(world, forward, view.forwardTexture);
    this.renderReturn(world, returning, view.returnTexture);
  }

  destroy(): void {
    this.view?.forwardImage.destroy();
    this.view?.returnImage.destroy();
    for (const suffix of ["forward", "return"]) {
      const key = `${this.keyPrefix}-${suffix}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
    this.view = undefined;
  }

  private getOrCreateView(world: WorldGrid): OverlayView {
    if (this.view?.width === world.width && this.view.height === world.height) return this.view;
    this.destroy();

    const textureWidth = world.width * OVERLAY_SCALE;
    const textureHeight = world.height * OVERLAY_SCALE;
    const displayWidth = world.width * prototypeConfig.navigation.tileSize;
    const displayHeight = world.height * prototypeConfig.navigation.tileSize;
    const forwardKey = `${this.keyPrefix}-forward`;
    const returnKey = `${this.keyPrefix}-return`;
    const forwardTexture = this.scene.textures.createCanvas(forwardKey, textureWidth, textureHeight);
    const returnTexture = this.scene.textures.createCanvas(returnKey, textureWidth, textureHeight);
    if (!forwardTexture || !returnTexture) throw new Error("Could not create range-overlay textures");
    forwardTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    returnTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    const forwardImage = this.scene.add.image(0, 0, forwardKey).setOrigin(0).setDisplaySize(
      displayWidth,
      displayHeight,
    ).setDepth(37);
    const returnImage = this.scene.add.image(0, 0, returnKey).setOrigin(0).setDisplaySize(
      displayWidth,
      displayHeight,
    ).setDepth(38);
    this.view = {
      forwardTexture,
      forwardImage,
      returnTexture,
      returnImage,
      width: world.width,
      height: world.height,
    };
    this.lastRevision = -1;
    return this.view;
  }

  private renderForward(
    world: WorldGrid,
    result: ForwardRangeResult,
    texture: Phaser.Textures.CanvasTexture,
  ): void {
    const context = texture.getContext();
    context.clearRect(0, 0, texture.width, texture.height);
    const opacity = prototypeConfig.overlays.forwardOverlayOpacity;

    for (let index = 0; index < result.mask.length; index++) {
      if (!result.mask[index]) continue;
      const { x, y } = world.pointFromIndex(index);
      if (world.isVisibleNow(x, y)) continue;
      const px = x * OVERLAY_SCALE;
      const py = y * OVERLAY_SCALE;
      context.fillStyle = `rgba(165, 192, 190, ${opacity})`;
      context.fillRect(px, py, OVERLAY_SCALE, OVERLAY_SCALE);

      if (this.touchesOutside(result.mask, world, x, y)) {
        context.fillStyle = `rgba(226, 230, 210, ${Math.min(0.9, opacity * 3.4)})`;
        context.fillRect(px + OVERLAY_SCALE / 2 - 0.5, py, 1, 1);
        context.fillRect(px + OVERLAY_SCALE / 2 - 0.5, py + OVERLAY_SCALE - 1, 1, 1);
        context.fillRect(px, py + OVERLAY_SCALE / 2 - 0.5, 1, 1);
        context.fillRect(px + OVERLAY_SCALE - 1, py + OVERLAY_SCALE / 2 - 0.5, 1, 1);
      }
    }
    texture.refresh();
  }

  private renderReturn(
    world: WorldGrid,
    result: ReturnPathResult,
    texture: Phaser.Textures.CanvasTexture,
  ): void {
    const context = texture.getContext();
    context.clearRect(0, 0, texture.width, texture.height);
    const opacity = prototypeConfig.overlays.returnOverlayOpacity;

    for (let index = 0; index < result.risk.length; index++) {
      const level = result.risk[index] as ReturnRiskLevel;
      if (level === ReturnRiskLevel.Hidden) continue;
      const { x, y } = world.pointFromIndex(index);
      if (world.isVisibleNow(x, y)) continue;
      const px = x * OVERLAY_SCALE;
      const py = y * OVERLAY_SCALE;
      context.fillStyle = this.riskColor(level, opacity);
      context.fillRect(px, py, OVERLAY_SCALE, OVERLAY_SCALE);
      this.drawRiskPattern(context, level, px, py, opacity);
    }
    texture.refresh();
  }

  private riskColor(level: ReturnRiskLevel, opacity: number): string {
    switch (level) {
      case ReturnRiskLevel.Comfortable: return `rgba(164, 174, 163, ${opacity * 0.72})`;
      case ReturnRiskLevel.Warning: return `rgba(238, 188, 62, ${opacity})`;
      case ReturnRiskLevel.Critical: return `rgba(238, 105, 29, ${Math.min(0.9, opacity * 1.25)})`;
      case ReturnRiskLevel.Impossible: return `rgba(196, 38, 36, ${Math.min(0.95, opacity * 1.6)})`;
      default: return "rgba(0, 0, 0, 0)";
    }
  }

  private drawRiskPattern(
    context: CanvasRenderingContext2D,
    level: ReturnRiskLevel,
    px: number,
    py: number,
    opacity: number,
  ): void {
    if (level === ReturnRiskLevel.Comfortable) return;
    context.save();
    context.strokeStyle = `rgba(28, 24, 18, ${Math.min(0.82, opacity * 2.2)})`;
    context.lineWidth = 0.75;
    context.beginPath();
    context.moveTo(px + 0.75, py + OVERLAY_SCALE - 0.75);
    context.lineTo(px + OVERLAY_SCALE - 0.75, py + 0.75);
    if (level >= ReturnRiskLevel.Critical) {
      context.moveTo(px - 1, py + OVERLAY_SCALE - 0.75);
      context.lineTo(px + OVERLAY_SCALE * 0.5, py + 0.75);
    }
    if (level === ReturnRiskLevel.Impossible) {
      context.moveTo(px + 0.75, py + 0.75);
      context.lineTo(px + OVERLAY_SCALE - 0.75, py + OVERLAY_SCALE - 0.75);
    }
    context.stroke();
    context.restore();
  }

  private touchesOutside(mask: Uint8Array, world: WorldGrid, x: number, y: number): boolean {
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const;
    return neighbors.some(([nx, ny]) => !world.inBounds(nx, ny) || mask[world.index(nx, ny)] === 0);
  }
}
