import Phaser from "phaser";
import { ReturnRiskLevel } from "../exploration/ReturnPathSystem";
import type {
  CargoBundlePresentation,
  CargoBundleSlice,
  CargoPresentationModel,
} from "./CargoPresentation";
import { CARGO_SURVEY_COLOR, cargoReturnColor } from "./CargoPresentation";

interface BundleView {
  readonly container: Phaser.GameObjects.Container;
  readonly glow: Phaser.GameObjects.Graphics;
  readonly icon: Phaser.GameObjects.Graphics;
}

const BUNDLE_WIDTH = 16;
const BUNDLE_LEFT = -BUNDLE_WIDTH / 2;
const BUNDLE_COLORS = [0xa66d36, 0xb8894f, 0x8f623c] as const;

/** Countable, physical provision bundles in a diegetic on-board rack. */
export class CargoRenderer {
  private readonly viewportContainer: Phaser.GameObjects.Container;
  private readonly container: Phaser.GameObjects.Container;
  private readonly rack: Phaser.GameObjects.Graphics;
  private readonly views: BundleView[] = [];
  private readonly status: HTMLElement;
  private displayedCount = -1;
  private signature = "";
  private surveyPulseTargets: Phaser.GameObjects.Graphics[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.rack = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.rack]);
    this.viewportContainer = scene.add.container(0, 0, [this.container]).setScrollFactor(0).setDepth(100);
    this.status = this.getOrCreateStatus();
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);
    this.positionRack();
  }

  sync(model: Readonly<CargoPresentationModel>): void {
    this.positionRack();
    if (model.signature === this.signature) return;
    const target = model.physicalBundles;
    const previous = Math.max(0, this.displayedCount);

    while (this.views.length < target) {
      const view = this.createBundleView();
      view.container.setScale(0.45).setAlpha(0);
      this.container.add(view.container);
      this.views.push(view);
      if (this.allowsMotion()) {
        this.scene.tweens.add({ targets: view.container, scale: 1, alpha: 1, duration: 180, ease: "Back.Out" });
      } else {
        view.container.setScale(1).setAlpha(1);
      }
    }
    while (this.views.length > target) {
      const view = this.views.pop();
      if (!view) break;
      if (this.allowsMotion()) {
        this.scene.tweens.add({
          targets: view.container,
          y: view.container.y - 18,
          scale: 0.4,
          alpha: 0,
          angle: 18,
          duration: 260,
          ease: "Cubic.In",
          onComplete: () => view.container.destroy(true),
        });
      } else {
        view.container.destroy(true);
      }
    }

    this.displayedCount = target;
    this.signature = model.signature;
    this.layoutIcons();
    for (const bundle of model.bundles) this.drawBundle(this.views[bundle.index], bundle, model.returnRiskLevel);
    this.redrawRack(model);
    this.syncSurveyPulse();
    this.status.textContent = model.statusText;
    if (previous > target) {
      this.container.setScale(1.025);
      if (this.allowsMotion()) this.scene.tweens.add({ targets: this.container, scale: 1, duration: 140 });
      else this.container.setScale(1);
    }
  }

  destroy(): void {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize);
    this.scene.tweens.killTweensOf(this.surveyPulseTargets);
    this.viewportContainer.destroy(true);
    this.status.remove();
  }

  private createBundleView(): BundleView {
    const glow = this.scene.add.graphics();
    const icon = this.scene.add.graphics();
    return {
      container: this.scene.add.container(0, 0, [glow, icon]),
      glow,
      icon,
    };
  }

  private drawBundle(
    view: BundleView,
    bundle: Readonly<CargoBundlePresentation>,
    riskLevel: ReturnRiskLevel,
  ): void {
    const baseColor = BUNDLE_COLORS[bundle.index % BUNDLE_COLORS.length];
    view.icon.clear();
    view.icon.fillStyle(baseColor, 1);
    view.icon.fillRoundedRect(-8, -7, 16, 14, 2);
    for (const slice of bundle.slices) this.drawSlice(view.icon, slice, riskLevel);
    view.icon.lineStyle(1.5, 0x402b20, 1);
    view.icon.strokeRoundedRect(-8, -7, 16, 14, 2);
    view.icon.lineBetween(0, -7, 0, 7);
    view.icon.lineBetween(-8, -1, 8, -1);
    view.icon.fillStyle(0xd0b06d, 1);
    view.icon.fillRect(-2, -8, 4, 3);

    view.glow.clear().setAlpha(0);
    const survey = bundle.slices.find((slice) => slice.kind === "survey");
    if (survey) {
      const x = BUNDLE_LEFT + survey.start * BUNDLE_WIDTH;
      const width = Math.max(1, (survey.end - survey.start) * BUNDLE_WIDTH);
      view.glow.fillStyle(0x7ce8f0, 0.18);
      view.glow.fillRoundedRect(x - 2, -10, width + 4, 20, 4);
      view.glow.lineStyle(1.5, 0xb9f5ff, 0.78);
      view.glow.strokeRoundedRect(x - 1, -9, width + 2, 18, 3);
      view.glow.setAlpha(0.68);
    }
  }

  private drawSlice(
    graphics: Phaser.GameObjects.Graphics,
    slice: Readonly<CargoBundleSlice>,
    riskLevel: ReturnRiskLevel,
  ): void {
    const x = BUNDLE_LEFT + slice.start * BUNDLE_WIDTH;
    const width = Math.max(0.5, (slice.end - slice.start) * BUNDLE_WIDTH);
    const color = slice.kind === "return"
      ? cargoReturnColor(riskLevel)
      : slice.kind === "survey"
        ? CARGO_SURVEY_COLOR
        : slice.kind === "depleted"
          ? 0x071013
          : null;
    if (color === null) return;
    graphics.fillStyle(color, slice.kind === "depleted" ? 0.72 : 0.76);
    graphics.fillRect(x, -7, width, 14);
    if (slice.kind !== "depleted") {
      graphics.fillStyle(color, 0.92);
      graphics.fillRect(x, 9, width, 2);
    }
  }

  private layoutIcons(): void {
    const count = Math.max(1, this.displayedCount);
    const rows = Math.ceil(count / 12);
    const rackHeight = rows * 20 + 18;
    for (let index = 0; index < this.views.length; index++) {
      const row = Math.floor(index / 12);
      const itemsInRow = Math.min(12, this.views.length - row * 12);
      const rowWidth = itemsInRow * 20;
      const column = index % 12;
      this.views[index].container.setPosition(-rowWidth / 2 + column * 20 + 10, -rackHeight + 15 + row * 20);
    }
  }

  private redrawRack(model: Readonly<CargoPresentationModel>): void {
    const count = Math.max(1, this.displayedCount);
    const columns = Math.min(12, count);
    const rows = Math.ceil(count / 12);
    const width = columns * 20 + 18;
    const height = rows * 20 + 18;
    this.rack.clear();
    this.rack.fillStyle(0x09171b, 0.82);
    this.rack.fillRoundedRect(-width / 2, -height, width, height, 6);
    this.rack.lineStyle(2, model.returnShortfall > 0 ? 0xc42624 : 0x72573c, 0.9);
    this.rack.strokeRoundedRect(-width / 2, -height, width, height, 6);
    this.rack.lineStyle(1, 0xc3a66d, 0.28);
    this.rack.lineBetween(-width / 2 + 8, -6, width / 2 - 8, -6);
    if (model.surveyShortfall > 0) {
      this.rack.lineStyle(2, CARGO_SURVEY_COLOR, 0.9);
      this.rack.lineBetween(width / 2 - 9, -height - 3, width / 2 + 3, -height + 9);
      this.rack.lineBetween(width / 2 - 3, -height - 3, width / 2 + 3, -height + 3);
    }
  }

  private syncSurveyPulse(): void {
    this.scene.tweens.killTweensOf(this.surveyPulseTargets);
    this.surveyPulseTargets = this.views
      .map((view) => view.glow)
      .filter((glow) => glow.alpha > 0);
    if (!this.allowsMotion() || this.surveyPulseTargets.length === 0) return;
    this.scene.tweens.add({
      targets: this.surveyPulseTargets,
      alpha: { from: 0.28, to: 0.88 },
      duration: 900,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private positionRack = (): void => {
    const camera = this.scene.cameras.main;
    const zoom = Math.max(Number.EPSILON, camera.zoom);
    const centerX = this.scene.scale.width / 2;
    const centerY = this.scene.scale.height / 2;
    const screenBottom = this.scene.scale.height - 12;
    this.viewportContainer
      .setPosition(centerX, centerY + (screenBottom - centerY) / zoom)
      .setScale(1 / zoom);
  };

  private readonly onResize = (): void => this.positionRack();

  private getOrCreateStatus(): HTMLElement {
    const existing = document.querySelector<HTMLElement>("#cargo-status");
    if (existing) return existing;
    const status = document.createElement("p");
    status.id = "cargo-status";
    status.className = "visually-hidden";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    document.querySelector("#game-region")?.append(status);
    return status;
  }

  private allowsMotion(): boolean {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
}
