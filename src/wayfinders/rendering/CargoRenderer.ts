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

const BUNDLE_WIDTH = 25;
const BUNDLE_HEIGHT = 23;
const BUNDLE_LEFT = -BUNDLE_WIDTH / 2;
const BUNDLE_TOP = -BUNDLE_HEIGHT / 2;
const BUNDLE_BOTTOM = BUNDLE_HEIGHT / 2;
const BUNDLES_PER_ROW = 12;
const COMPACT_BUNDLES_PER_ROW = 6;
const BUNDLE_SPACING = 32;
const BUNDLE_COLORS = [0xa66a2d, 0xbd8540, 0x8e5728] as const;

/** Countable, physical provision bundles in a diegetic on-board rack. */
export class CargoRenderer {
  private readonly viewportContainer: Phaser.GameObjects.Container;
  private readonly container: Phaser.GameObjects.Container;
  private readonly rack: Phaser.GameObjects.Graphics;
  private readonly views: BundleView[] = [];
  private readonly status: HTMLElement;
  private readonly gameHost?: HTMLElement;
  private readonly reducedMotionQuery: MediaQueryList;
  private displayedCount = -1;
  private latestModel?: Readonly<CargoPresentationModel>;
  private signature = "";
  private safeAreaBottomInset = 0;
  private surveyPulseTargets: Phaser.GameObjects.Graphics[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.rack = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.rack]);
    this.viewportContainer = scene.add.container(0, 0, [this.container]).setScrollFactor(0).setDepth(100);
    this.status = this.getOrCreateStatus();
    this.gameHost = document.querySelector<HTMLElement>("#game-host") ?? undefined;
    this.updateSafeAreaBottomInset();
    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotionQuery.addEventListener?.("change", this.onReducedMotionChange);
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);
    this.positionRack();
  }

  sync(model: Readonly<CargoPresentationModel>): void {
    this.latestModel = model;
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
    this.reducedMotionQuery.removeEventListener?.("change", this.onReducedMotionChange);
    this.scene.tweens.killTweensOf(this.surveyPulseTargets);
    this.gameHost?.style.removeProperty("--cargo-rack-height");
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
    view.icon.fillRoundedRect(BUNDLE_LEFT, BUNDLE_TOP, BUNDLE_WIDTH, BUNDLE_HEIGHT, 3);
    view.icon.fillStyle(0x2f2018, 0.12);
    view.icon.fillRect(BUNDLE_LEFT, 1.75, BUNDLE_WIDTH, BUNDLE_BOTTOM - 1.75);
    view.icon.fillStyle(0xd7b46c, 0.42);
    view.icon.fillRect(BUNDLE_LEFT + 2, BUNDLE_TOP + 2, BUNDLE_WIDTH - 4, 3);
    view.icon.fillStyle(0xd4b374, 0.94);
    view.icon.fillRect(-2, BUNDLE_TOP, 4, BUNDLE_HEIGHT);
    view.icon.fillRect(BUNDLE_LEFT, -1.5, BUNDLE_WIDTH, 3);
    view.icon.lineStyle(1.5, 0x684624, 0.86);
    view.icon.lineBetween(0, BUNDLE_TOP, 0, BUNDLE_BOTTOM);
    view.icon.lineBetween(BUNDLE_LEFT, 0, -2, 0);
    view.icon.lineBetween(2, 0, -BUNDLE_LEFT, 0);
    for (const slice of bundle.slices) this.drawSlice(view.icon, slice, riskLevel);
    view.icon.lineStyle(2.5, 0x2c1a12, 1);
    view.icon.strokeRoundedRect(BUNDLE_LEFT, BUNDLE_TOP, BUNDLE_WIDTH, BUNDLE_HEIGHT, 3);
    view.icon.fillStyle(0xe0c383, 1);
    view.icon.fillTriangle(-4, BUNDLE_TOP, 0, BUNDLE_TOP - 4, 4, BUNDLE_TOP);
    view.icon.fillStyle(0x5b351c, 1);
    view.icon.fillRoundedRect(-3.25, -3, 6.5, 6, 1);
    view.icon.fillStyle(0xe2bf75, 1);
    view.icon.fillRect(-1.25, -1.25, 2.5, 2.5);

    view.glow.clear().setAlpha(0);
    const survey = bundle.slices.find((slice) => slice.kind === "survey");
    if (survey) {
      const x = BUNDLE_LEFT + survey.start * BUNDLE_WIDTH;
      const width = Math.max(1, (survey.end - survey.start) * BUNDLE_WIDTH);
      view.glow.fillStyle(0x7ce8f0, 0.12);
      view.glow.fillRoundedRect(x - 2, BUNDLE_TOP - 3.5, width + 4, BUNDLE_HEIGHT + 7, 4);
      view.glow.lineStyle(1.75, 0xb9f5ff, 0.68);
      view.glow.strokeRoundedRect(x - 1.5, BUNDLE_TOP - 3, width + 3, BUNDLE_HEIGHT + 6, 3);
      view.glow.setAlpha(0.58);
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
    graphics.fillRect(x, BUNDLE_TOP, width, BUNDLE_HEIGHT);
    if (slice.kind !== "depleted") {
      graphics.fillStyle(color, 0.92);
      graphics.fillRect(x, BUNDLE_BOTTOM + 3, width, 3);
    }
  }

  private layoutIcons(): void {
    const count = Math.max(1, this.displayedCount);
    const columnsPerRow = this.columnsPerRow();
    const rows = Math.ceil(count / columnsPerRow);
    const rackHeight = rows * BUNDLE_SPACING + 30;
    for (let index = 0; index < this.views.length; index++) {
      const { x, y } = this.bundlePosition(index, this.views.length, rackHeight, columnsPerRow);
      this.views[index].container.setPosition(x, y);
    }
  }

  private redrawRack(model: Readonly<CargoPresentationModel>): void {
    const count = Math.max(1, this.displayedCount);
    const columnsPerRow = this.columnsPerRow();
    const columns = Math.min(columnsPerRow, count);
    const rows = Math.ceil(count / columnsPerRow);
    const width = columns * BUNDLE_SPACING + 30;
    const height = rows * BUNDLE_SPACING + 30;
    this.gameHost?.style.setProperty("--cargo-rack-height", `${height}px`);
    const left = -width / 2;
    const top = -height;
    this.rack.clear();
    this.rack.fillStyle(0x24150f, 1);
    this.rack.fillRoundedRect(left, top, width, height, 4);
    this.rack.lineStyle(4, 0x170d09, 1);
    this.rack.strokeRoundedRect(left, top, width, height, 4);
    this.rack.lineStyle(2.5, 0xc29143, 1);
    this.rack.strokeRoundedRect(left + 3, top + 3, width - 6, height - 6, 3);
    this.rack.fillStyle(0x68401f, 1);
    this.rack.fillRoundedRect(left + 6, top + 6, width - 12, height - 12, 2);
    this.rack.fillStyle(0x07191c, 0.94);
    this.rack.fillRoundedRect(left + 11, top + 11, width - 22, height - 22, 2);
    this.rack.lineStyle(2, 0x342117, 1);
    this.rack.strokeRoundedRect(left + 11, top + 11, width - 22, height - 22, 2);

    for (let index = 0; index < count; index++) {
      const { x, y } = this.bundlePosition(index, count, height, columnsPerRow);
      this.rack.fillStyle(0x020d0f, 0.68);
      this.rack.fillRoundedRect(x - 14, y - 14, 28, 28, 2);
      this.rack.lineStyle(1.5, 0x9d7548, 0.32);
      this.rack.strokeRoundedRect(x - 14, y - 14, 28, 28, 2);
    }

    this.rack.fillStyle(0x3e2516, 1);
    this.rack.fillRect(left + 7, top + 7, 7, height - 14);
    this.rack.fillRect(width / 2 - 14, top + 7, 7, height - 14);
    this.rack.fillStyle(0x9d6930, 1);
    this.rack.fillRect(left + 8, top + 7, width - 16, 6);
    this.rack.fillRect(left + 8, -13, width - 16, 6);
    this.rack.lineStyle(2, 0xe0b35c, 0.82);
    this.rack.lineBetween(left + 10, top + 8, width / 2 - 10, top + 8);
    this.rack.lineBetween(left + 10, -12, width / 2 - 10, -12);

    for (const x of [left + 8, width / 2 - 8]) {
      for (const y of [top + 8, -8]) {
        this.rack.fillStyle(0xd0ad63, 0.8);
        this.rack.fillCircle(x, y, 2.5);
      }
    }

    const ringY = top + height / 2;
    for (const x of [left - 10, width / 2 + 10]) {
      this.rack.lineStyle(5, 0x170d09, 1);
      this.rack.strokeCircle(x, ringY, 10);
      this.rack.lineStyle(2.5, 0xb4a171, 0.92);
      this.rack.strokeCircle(x, ringY, 7);
    }

    for (const x of [left + 8, width / 2 - 8]) {
      this.rack.fillStyle(0x170d09, 1);
      this.rack.fillTriangle(x - 8, top + 2, x, top - 9, x + 8, top + 2);
      this.rack.fillTriangle(x - 8, -2, x, 9, x + 8, -2);
      this.rack.fillStyle(0xc29143, 1);
      this.rack.fillTriangle(x - 5, top + 1, x, top - 6, x + 5, top + 1);
      this.rack.fillTriangle(x - 5, -1, x, 6, x + 5, -1);
      this.rack.fillStyle(0xf0c66c, 0.86);
      this.rack.fillCircle(x, top, 2);
      this.rack.fillCircle(x, 0, 2);
    }

    if (model.surveyShortfall > 0) {
      this.rack.lineStyle(3, CARGO_SURVEY_COLOR, 0.88);
      this.rack.lineBetween(width / 2 - 14, top - 4, width / 2 + 4, top + 14);
      this.rack.lineBetween(width / 2 - 6, top - 4, width / 2 + 4, top + 6);
    }
    if (model.returnShortfall > 0) {
      this.rack.lineStyle(3, 0xc42624, 0.95);
      this.rack.lineBetween(left - 3, -18, left + 15, 0);
      this.rack.lineBetween(left - 3, -10, left + 7, 0);
    }
  }

  private bundlePosition(
    index: number,
    count: number,
    rackHeight: number,
    columnsPerRow: number,
  ): { x: number; y: number } {
    const row = Math.floor(index / columnsPerRow);
    const itemsInRow = Math.min(columnsPerRow, count - row * columnsPerRow);
    const rowWidth = itemsInRow * BUNDLE_SPACING;
    const column = index % columnsPerRow;
    return {
      x: -rowWidth / 2 + column * BUNDLE_SPACING + BUNDLE_SPACING / 2,
      y: -rackHeight + BUNDLE_SPACING + row * BUNDLE_SPACING,
    };
  }

  private columnsPerRow(): number {
    return this.scene.scale.width < 496 ? COMPACT_BUNDLES_PER_ROW : BUNDLES_PER_ROW;
  }

  private syncSurveyPulse(): void {
    this.scene.tweens.killTweensOf(this.surveyPulseTargets);
    this.surveyPulseTargets = this.views
      .map((view) => view.glow)
      .filter((glow) => glow.alpha > 0);
    if (!this.allowsMotion() || this.surveyPulseTargets.length === 0) return;
    this.scene.tweens.add({
      targets: this.surveyPulseTargets,
      alpha: { from: 0.4, to: 0.68 },
      duration: 1500,
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
    const rackBottom = Math.max(18, this.safeAreaBottomInset + 10);
    const screenBottom = this.scene.scale.height - rackBottom;
    this.viewportContainer
      .setPosition(centerX, centerY + (screenBottom - centerY) / zoom)
      .setScale(1 / zoom);
  };

  private readonly onResize = (): void => {
    this.updateSafeAreaBottomInset();
    this.positionRack();
    if (this.latestModel) {
      this.layoutIcons();
      this.redrawRack(this.latestModel);
    }
  };

  private readonly onReducedMotionChange = (): void => {
    this.syncSurveyPulse();
    if (!this.allowsMotion()) {
      for (const glow of this.surveyPulseTargets) glow.setAlpha(0.58);
    }
  };

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

  private updateSafeAreaBottomInset(): void {
    const inset = Number.parseFloat(window.getComputedStyle(this.status).paddingBottom);
    this.safeAreaBottomInset = Number.isFinite(inset) ? inset : 0;
  }

  private allowsMotion(): boolean {
    return !this.reducedMotionQuery.matches;
  }
}
