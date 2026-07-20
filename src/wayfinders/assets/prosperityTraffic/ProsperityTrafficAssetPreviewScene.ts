import Phaser from "phaser";
import {
  createProsperityTrafficCraftGraphics,
  setProsperityTrafficCraftState,
  type ProsperityTrafficCraftGraphics,
} from "../../rendering/prosperity/ProsperityTrafficCraft";
import {
  assetWorkspaceSceneKey,
  type ProsperityTrafficAssetWorkspaceModule,
} from "../workspaces/AssetWorkspace";
import {
  PROSPERITY_TRAFFIC_ASSET_CATALOG,
  prosperityTrafficAssetById,
  type ProsperityTrafficAssetDefinition,
} from "./ProsperityTrafficAssetCatalog";
import {
  PROSPERITY_TRAFFIC_FISHING_RUNTIME_LABEL,
  PROSPERITY_TRAFFIC_TRADE_RUNTIME_LABEL,
  prosperityTrafficAssetBrowserMarkup,
  prosperityTrafficAssetPreviewLayout,
  syncProsperityTrafficAssetBrowserSelection,
} from "./ProsperityTrafficAssetPreviewUi";

interface CraftPreview {
  readonly container: Phaser.GameObjects.Container;
  readonly graphics: Readonly<ProsperityTrafficCraftGraphics>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** View-only inspection surface for the two code-native runtime traffic craft. */
export class ProsperityTrafficAssetPreviewScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private background!: Phaser.GameObjects.Rectangle;
  private lanes!: Phaser.GameObjects.Graphics;
  private selectedPreview!: CraftPreview;
  private fishingTargetPreview!: CraftPreview;
  private tradeTargetPreview!: CraftPreview;
  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private fishingTargetLabel!: Phaser.GameObjects.Text;
  private tradeTargetLabel!: Phaser.GameObjects.Text;
  private selectedAsset: Readonly<ProsperityTrafficAssetDefinition> = PROSPERITY_TRAFFIC_ASSET_CATALOG[0];
  private wakeVisible = true;
  private headingDegrees = 0;

  constructor(workspace: Readonly<ProsperityTrafficAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
  }

  create(): void {
    this.mountWorkspace();
    this.background = this.add.rectangle(0, 0, 1, 1, 0x082f3d).setOrigin(0).setDepth(-10);
    this.lanes = this.add.graphics().setDepth(-5);
    this.selectedPreview = this.createCraftPreview();
    this.fishingTargetPreview = this.createCraftPreview();
    this.tradeTargetPreview = this.createCraftPreview();
    setProsperityTrafficCraftState(this.fishingTargetPreview.graphics, "fishing", true);
    setProsperityTrafficCraftState(this.tradeTargetPreview.graphics, "trade", true);
    this.fishingTargetPreview.container.setAlpha(PROSPERITY_TRAFFIC_ASSET_CATALOG[0].runtimeAlpha);
    this.tradeTargetPreview.container.setAlpha(PROSPERITY_TRAFFIC_ASSET_CATALOG[1].runtimeAlpha);

    const titleStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: "#f0e5bf",
      fontFamily: "system-ui, sans-serif",
      fontSize: "25px",
      fontStyle: "bold",
      align: "center",
    };
    const smallStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: "#9dc9c6",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      align: "center",
    };
    this.title = this.add.text(0, 0, "", titleStyle).setOrigin(0.5).setDepth(5);
    this.subtitle = this.add.text(0, 0, "", smallStyle).setOrigin(0.5).setDepth(5);
    this.fishingTargetLabel = this.add.text(0, 0, PROSPERITY_TRAFFIC_FISHING_RUNTIME_LABEL, smallStyle)
      .setOrigin(0.5).setDepth(5);
    this.tradeTargetLabel = this.add.text(0, 0, PROSPERITY_TRAFFIC_TRADE_RUNTIME_LABEL, smallStyle)
      .setOrigin(0.5).setDepth(5);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.layout();
    this.renderBrowser();
    this.renderWorkbench();
    this.syncSelectedPreview();
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "2 code-native ship traffic assets · view only";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!region || !slot) throw new Error("Ship traffic preview requires the asset workspace shell");

    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser traffic-preview-browser";
    this.browser.setAttribute("aria-label", "Ship traffic asset catalog");
    region.append(this.browser);
    this.browser.addEventListener("click", this.onBrowserClick, { signal: this.controlsAbort.signal });

    slot.classList.add("tool-slot--connected", "traffic-preview-tools");
    slot.addEventListener("input", this.onWorkbenchInput, { signal: this.controlsAbort.signal });
  }

  private readonly onBrowserClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-traffic-asset]")
      : null;
    const selected = prosperityTrafficAssetById(target?.dataset.trafficAsset);
    if (!selected || selected.id === this.selectedAsset.id) return;
    this.selectedAsset = selected;
    syncProsperityTrafficAssetBrowserSelection(
      this.browser?.querySelectorAll<HTMLButtonElement>("[data-traffic-asset]") ?? [],
      selected.id,
    );
    this.renderWorkbench();
    this.syncSelectedPreview();
  };

  private readonly onWorkbenchInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.trafficControl === "wake") {
      this.wakeVisible = target.checked;
      this.syncSelectedPreview();
      return;
    }
    if (target.dataset.trafficControl === "heading") {
      this.headingDegrees = Math.max(-180, Math.min(180, target.valueAsNumber || 0));
      this.syncSelectedPreview();
      const output = document.querySelector<HTMLOutputElement>("[data-traffic-output='heading']");
      if (output) output.value = `${this.headingDegrees}°`;
    }
  };

  private createCraftPreview(): CraftPreview {
    const graphics = createProsperityTrafficCraftGraphics(this);
    const container = this.add.container(0, 0, [
      graphics.wake,
      graphics.fishingCraft,
      graphics.tradeCraft,
    ]);
    return { container, graphics };
  }

  private syncSelectedPreview(): void {
    setProsperityTrafficCraftState(
      this.selectedPreview.graphics,
      this.selectedAsset.kind,
      this.wakeVisible,
    );
    this.selectedPreview.container.setRotation(Phaser.Math.DegToRad(this.headingDegrees));
    this.title.setText(this.selectedAsset.name);
    this.subtitle.setText("4× inspection pose · full opacity");
  }

  private layout(): void {
    if (!this.background) return;
    const width = this.scale.width;
    const height = this.scale.height;
    this.background.setSize(width, height);
    this.lanes.clear();
    this.lanes.fillStyle(0x0c4150, 0.9).fillRoundedRect(
      Math.max(24, width * 0.08),
      Math.max(28, height * 0.08),
      Math.max(160, width * 0.84),
      Math.max(190, height * 0.82),
      22,
    );
    this.lanes.lineStyle(1, 0x4faaa5, 0.22);
    for (let row = 1; row <= 4; row++) {
      const y = height * (0.16 + row * 0.14);
      this.lanes.lineBetween(width * 0.13, y, width * 0.87, y);
    }

    const layout = prosperityTrafficAssetPreviewLayout(width, height);
    this.selectedPreview.container
      .setPosition(layout.selected.x, layout.selected.y)
      .setScale(layout.inspectionScale)
      .setAlpha(1);
    this.title.setPosition(layout.title.x, layout.title.y);
    this.subtitle.setPosition(layout.subtitle.x, layout.subtitle.y);

    this.fishingTargetPreview.container
      .setPosition(layout.fishingTarget.x, layout.fishingTarget.y)
      .setScale(1);
    this.tradeTargetPreview.container
      .setPosition(layout.tradeTarget.x, layout.tradeTarget.y)
      .setScale(1);
    this.fishingTargetLabel.setPosition(
      layout.fishingTargetLabel.x,
      layout.fishingTargetLabel.y,
    );
    this.tradeTargetLabel.setPosition(
      layout.tradeTargetLabel.x,
      layout.tradeTargetLabel.y,
    );
  }

  private renderBrowser(): void {
    if (!this.browser) return;
    this.browser.innerHTML = prosperityTrafficAssetBrowserMarkup(this.selectedAsset.id);
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    const asset = this.selectedAsset;
    slot.innerHTML = `<section class="asset-workbench traffic-preview-workbench">
      <header><div><p class="eyebrow">Runtime presentation</p><h3>${escapeHtml(asset.name)}</h3></div><span>View only</span></header>
      <p>${escapeHtml(asset.description)}</p>
      <div class="traffic-preview-controls">
        <label class="tool-check"><input data-traffic-control="wake" type="checkbox" ${this.wakeVisible ? "checked" : ""}> Show moving-state wake</label>
        <label class="traffic-preview-heading-control"><span>Inspection heading</span><input data-traffic-control="heading" type="range" min="-180" max="180" step="15" value="${this.headingDegrees}"><output data-traffic-output="heading">${this.headingDegrees}°</output></label>
      </div>
      <dl class="traffic-preview-metadata">
        <div><dt>Semantic ID</dt><dd><code>${asset.id}</code></dd></div>
        <div><dt>Traffic family</dt><dd>${asset.kind}</dd></div>
        <div><dt>Runtime opacity</dt><dd>${Math.round(asset.runtimeAlpha * 100)}%</dd></div>
        <div><dt>Source</dt><dd>Shared code-native factory</dd></div>
      </dl>
      <ul>${asset.identifyingDetails.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>
      <p class="traffic-preview-readonly">No upload, editing, generation, concept-art loading, or repository-write controls are exposed here.</p>
    </section>`;
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.controlsAbort = undefined;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.browser?.remove();
    this.browser = undefined;
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (slot) {
      slot.replaceChildren();
      slot.classList.remove("tool-slot--connected", "traffic-preview-tools");
    }
  }
}
