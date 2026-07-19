import Phaser from "phaser";
import {
  CLOUD_ASSET_PACKAGE,
  cloudAssetVariantEntries,
  validateCloudAssetPackage,
  type CloudAssetPackage,
  type CloudAssetVariantEntry,
} from "../CloudAssetCatalog";
import {
  applyCloudAssetAuthoringSettings,
  CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
  CLOUD_ASSET_AUTHORING_SETTINGS_BOUNDS,
  cloudAssetAuthoringSettingsFromPackage,
  validateCloudAssetAuthoringSettings,
  validateCloudAssetIdentityRequest,
  validateCloudAssetSaveRequest,
  type CloudAssetAuthoringSettings,
} from "../CloudAssetAuthoring";
import {
  assetWorkspaceSceneKey,
  assetWorkspaceSelectionKey,
  type CloudAssetWorkspaceModule,
} from "../workspaces/AssetWorkspace";
import {
  CLOUD_WORLD_PREVIEW_SPEEDS,
  CloudWorldPreviewCanvas,
  generateCloudWorldPreview,
  resolveCloudWorldPreviewDescriptors,
  type CloudWorldPreviewModel,
} from "./CloudWorldPreview";

const CLOUD_ASSET_SAVE_ROUTE = "/__wayfinders/assets/clouds/save";
const CLOUD_ASSET_DELETE_ROUTE = "/__wayfinders/assets/clouds/delete";
const DEFAULT_PREVIEW_SEED = 84_221;

const ORDERED_SETTING_PATHS = Object.freeze([
  ["opacity.minimum", "opacity.maximum"],
  ["scale.minimum", "scale.maximum"],
  ["driftAmplitudePixels.minimum", "driftAmplitudePixels.maximum"],
  ["driftPeriodSeconds.minimum", "driftPeriodSeconds.maximum"],
] as const);

type SettingFormat = "integer" | "percent" | "scale" | "pixels" | "seconds";

interface SettingControl {
  readonly path: string;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly format: SettingFormat;
}

interface CloudMutationResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly variantId?: string;
  readonly deletedVariantId?: string;
  readonly runtimeRevision?: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatSetting(value: number, format: SettingFormat): string {
  switch (format) {
    case "integer": return String(Math.round(value));
    case "percent": return `${Math.round(value * 100)}%`;
    case "scale": return `${value.toFixed(2)}×`;
    case "pixels": return `${Math.round(value)} px`;
    case "seconds": return `${Number.isInteger(value) ? value : value.toFixed(1)} s`;
  }
}

function mutableSettings(settings: Readonly<CloudAssetAuthoringSettings>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
}

function valueAtPath(root: unknown, path: string): number {
  let current = root;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current[Number(part)];
    else if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else throw new RangeError(`Cloud setting path ${path} is invalid`);
  }
  if (typeof current !== "number" || !Number.isFinite(current)) {
    throw new RangeError(`Cloud setting path ${path} is not numeric`);
  }
  return current;
}

function setValueAtPath(root: Record<string, unknown>, path: string, value: number): void {
  const parts = path.split(".");
  let current: Record<string, unknown> | unknown[] = root;
  for (const part of parts.slice(0, -1)) {
    const next = Array.isArray(current)
      ? current[Number(part)]
      : current[part];
    if (typeof next !== "object" || next === null) {
      throw new RangeError(`Cloud setting path ${path} is invalid`);
    }
    current = next as Record<string, unknown> | unknown[];
  }
  const finalPart = parts.at(-1)!;
  if (Array.isArray(current)) current[Number(finalPart)] = value;
  else current[finalPart] = value;
}

function sameSettings(
  left: Readonly<CloudAssetAuthoringSettings>,
  right: Readonly<CloudAssetAuthoringSettings>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Cloud-owned catalog, live world preview and guarded repository authoring workspace. */
export class CloudAssetWorkspaceScene extends Phaser.Scene {
  private readonly variants = cloudAssetVariantEntries(CLOUD_ASSET_PACKAGE);
  private readonly selectionKey: string;
  private readonly savedSettings = cloudAssetAuthoringSettingsFromPackage(CLOUD_ASSET_PACKAGE);
  private settingsDraft = this.savedSettings;
  private previewPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE;
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private sheetImage?: HTMLImageElement;
  private previewCanvas?: CloudWorldPreviewCanvas;
  private previewModel?: Readonly<CloudWorldPreviewModel>;
  private resolvedPreviewDescriptors: ReturnType<typeof resolveCloudWorldPreviewDescriptors> = Object.freeze([]);
  private selectedVariantId?: string;
  private activeDraft = false;
  private mutationInFlight = false;
  private mutationStatus = "";
  private mutationError = false;
  private previewSeed = DEFAULT_PREVIEW_SEED;
  private previewSpeed = 12;
  private previewPaused = false;
  private showGuides = true;
  private previewTimeMs = 0;
  private activationAgeMs = 0;
  private previewLastTimestamp?: number;
  private previewLastRenderedAt = Number.NEGATIVE_INFINITY;
  private animationFrame?: number;

  constructor(workspace: Readonly<CloudAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
    this.selectionKey = assetWorkspaceSelectionKey(workspace.id);
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.selectedVariantId = this.resolveInitialSelection();
    this.activeDraft = this.selectedVariant()?.activeInGame ?? false;
    this.previewModel = generateCloudWorldPreview(this.previewSeed);
    this.refreshPreviewPackage();
    this.mountWorkspace();
    this.renderBrowser();
    this.renderPreview();
    this.renderWorkbench();
    this.loadSheetImage();
    this.ensureAnimation();
    this.reportShellStatus(
      this.variants.length === 0
        ? "Cloud library - no catalog entries"
        : `Cloud library - ${this.variants.length} catalog entries - live world preview`,
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!region || !slot) throw new Error("Cloud preview requires the asset workspace shell");

    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser cloud-library-browser";
    this.browser.setAttribute("aria-label", "Cloud asset library");
    region.append(this.browser);

    this.stage = document.createElement("section");
    this.stage.className = "cloud-preview-stage";
    this.stage.setAttribute("aria-label", "Live world cloud settings preview");
    region.append(this.stage);

    slot.classList.add("tool-slot--connected", "cloud-preview-tools");
    const signal = this.controlsAbort.signal;
    this.browser.addEventListener("click", this.onBrowserClick, { signal });
    this.stage.addEventListener("click", this.onPreviewClick, { signal });
    this.stage.addEventListener("change", this.onPreviewChange, { signal });
    slot.addEventListener("input", this.onWorkbenchInput, { signal });
    slot.addEventListener("change", this.onWorkbenchChange, { signal });
    slot.addEventListener("click", this.onWorkbenchClick, { signal });
  }

  private readonly onBrowserClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-cloud-variant]")
      : null;
    const variantId = target?.dataset.cloudVariant;
    if (!variantId || variantId === this.selectedVariantId || this.mutationInFlight) return;
    const variant = this.variants.find(({ id }) => id === variantId);
    if (!variant) return;
    this.selectedVariantId = variant.id;
    this.activeDraft = variant.activeInGame;
    this.clearMutationStatus();
    this.persistSelection(variant.id);
    this.refreshPreviewPackage();
    this.updateSelectedButtons();
    this.renderPreview();
    this.renderWorkbench();
  };

  private readonly onPreviewClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-cloud-preview-action]")
      : null;
    if (!target) return;
    const action = target.dataset.cloudPreviewAction;
    if (action === "pause") {
      this.previewPaused = !this.previewPaused;
      this.previewLastTimestamp = undefined;
      this.syncPreviewControls();
      if (!this.previewPaused) this.ensureAnimation();
      return;
    }
    if (action === "reroll") {
      this.previewSeed += 7_919;
      this.previewTimeMs = 0;
      this.activationAgeMs = 0;
      this.previewModel = generateCloudWorldPreview(this.previewSeed);
      this.resolvePreviewClouds();
      this.syncPreviewControls();
      this.drawWorldPreview();
    }
  };

  private readonly onPreviewChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const control = target.dataset.cloudPreviewControl;
    if (control === "seed") {
      const seed = Number(target.value);
      if (!Number.isFinite(seed)) return;
      this.previewSeed = Math.trunc(seed);
      this.previewTimeMs = 0;
      this.activationAgeMs = 0;
      this.previewModel = generateCloudWorldPreview(this.previewSeed);
      this.resolvePreviewClouds();
      this.syncPreviewControls();
      this.drawWorldPreview();
      return;
    }
    if (control === "speed") {
      const speed = Number(target.value);
      if (!CLOUD_WORLD_PREVIEW_SPEEDS.some((candidate) => candidate === speed)) return;
      this.previewSpeed = speed;
      this.previewLastTimestamp = undefined;
      this.syncPreviewControls();
      return;
    }
    if (control === "guides" && target instanceof HTMLInputElement) {
      this.showGuides = target.checked;
      this.syncPreviewControls();
      this.drawWorldPreview();
    }
  };

  private readonly onWorkbenchInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.cloudSetting) return;
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;
    try {
      const draft = mutableSettings(this.settingsDraft);
      setValueAtPath(draft, target.dataset.cloudSetting, value);
      this.keepRangeOrdered(draft, target.dataset.cloudSetting);
      this.settingsDraft = validateCloudAssetAuthoringSettings(draft);
      this.clearMutationStatus();
      this.refreshPreviewPackage();
      this.syncWorkbenchState();
      this.syncPreviewSummary();
      this.drawWorldPreview();
    } catch (error) {
      this.mutationStatus = this.errorMessage(error);
      this.mutationError = true;
      this.syncWorkbenchState();
    }
  };

  private readonly onWorkbenchChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.cloud !== "active") return;
    this.activeDraft = target.checked;
    this.clearMutationStatus();
    this.refreshPreviewPackage();
    this.syncWorkbenchState();
    this.syncPreviewSummary();
    this.drawWorldPreview();
  };

  private readonly onWorkbenchClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-cloud-action]")
      : null;
    if (!target || this.mutationInFlight) return;
    if (target.dataset.cloudAction === "save") void this.saveCloudChanges();
    else if (target.dataset.cloudAction === "reset") this.resetSettingsDraft();
    else if (target.dataset.cloudAction === "delete") void this.deleteCloud();
  };

  private renderBrowser(): void {
    if (!this.browser) return;
    this.browser.innerHTML = `
      <header class="asset-library-header">
        <div><p class="eyebrow">Atmosphere catalog</p><h2>Clouds</h2></div>
        <span>${this.variants.length} stored</span>
      </header>
      <div class="asset-library-groups cloud-library-groups">
        <section class="asset-library-group" aria-labelledby="cloud-library-heading">
          <header><h3 id="cloud-library-heading">Cloud and shadow pairs</h3><span>${this.variants.length}</span></header>
          <div class="asset-library-list">
            ${this.variants.length === 0
              ? '<p class="cloud-library-empty">Every cloud has been deleted from the catalog.</p>'
              : this.variants.map((variant) => this.variantMarkup(variant)).join("")}
          </div>
        </section>
        <p class="cloud-library-help">Gold route guides in the world preview identify every instance of the selected frame.</p>
      </div>`;
    this.syncFrameStyles();
  }

  private variantMarkup(variant: Readonly<CloudAssetVariantEntry>): string {
    const selected = variant.id === this.selectedVariantId;
    return `<button
      type="button"
      class="asset-library-item cloud-library-item"
      data-cloud-variant="${escapeHtml(variant.id)}"
      data-active="${selected}"
      aria-pressed="${selected}"
    >
      <span class="asset-library-thumb cloud-library-thumb" data-cloud-frame="${variant.frame}" aria-hidden="true"></span>
      <span class="asset-library-item-copy">
        <strong>${escapeHtml(variant.name)}</strong>
        <small>Frame ${variant.frame + 1} - paired shadow</small>
      </span>
      <span class="asset-library-status" data-cloud-status="${variant.activeInGame ? "active" : "inactive"}">
        ${variant.activeInGame ? "Active" : "Inactive"}
      </span>
    </button>`;
  }

  private renderPreview(): void {
    if (!this.stage) return;
    const variant = this.selectedVariant();
    this.stage.innerHTML = `<article class="cloud-preview-card cloud-world-preview-card">
      <header>
        <div>
          <p class="eyebrow">Live world atmosphere</p>
          <h2>Cloud settings in context</h2>
        </div>
        <span class="cloud-preview-kind" data-cloud-preview-draft-state>Checked-in settings</span>
      </header>
      <p class="cloud-preview-intro">A real generated 96 × 96 world uses the game’s seeded chunk layout, scale, shadows, and route motion. Every setting below updates this view immediately.</p>
      <div class="cloud-world-preview-toolbar" aria-label="Cloud world preview controls">
        <label>World seed <input type="number" data-cloud-preview-control="seed" value="${this.previewSeed}"></label>
        <label>Preview speed
          <select data-cloud-preview-control="speed">
            ${CLOUD_WORLD_PREVIEW_SPEEDS.map((speed) => `<option value="${speed}" ${speed === this.previewSpeed ? "selected" : ""}>${speed}×</option>`).join("")}
          </select>
        </label>
        <label class="cloud-world-preview-check"><input type="checkbox" data-cloud-preview-control="guides" ${this.showGuides ? "checked" : ""}> Layout guides</label>
        <button type="button" data-cloud-preview-action="reroll">New layout</button>
        <button type="button" data-cloud-preview-action="pause" aria-pressed="${this.previewPaused}">${this.previewPaused ? "Play motion" : "Pause motion"}</button>
      </div>
      <div class="cloud-preview-canvas-shell cloud-world-preview-canvas-shell">
        <canvas data-cloud-world-preview aria-label="Generated world showing the live cloud settings"></canvas>
      </div>
      <div class="cloud-world-preview-pills" aria-label="Cloud preview summary">
        <span data-cloud-preview-summary="count"></span>
        <span data-cloud-preview-summary="density"></span>
        <span data-cloud-preview-summary="scale"></span>
        <span data-cloud-preview-summary="motion"></span>
      </div>
      <p class="cloud-preview-note" data-cloud-preview-note>${variant
        ? `Gold guides mark ${escapeHtml(variant.name)}. Seed, speed, guides, and pause are preview-only; atmosphere settings and Active in game are saved to the runtime package.`
        : "No cloud assets remain, so the generated world intentionally has no cloud or shadow views."}</p>
    </article>`;
    this.syncPreviewControls();
    this.syncPreviewSummary();
    this.drawWorldPreview();
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    const variant = this.selectedVariant();
    const bounds = CLOUD_ASSET_AUTHORING_SETTINGS_BOUNDS;
    slot.innerHTML = `<section class="asset-workbench cloud-preview-workbench">
      <header>
        <div><p class="eyebrow">Atmosphere settings</p><h3>${variant ? escapeHtml(variant.name) : "No cloud selected"}</h3></div>
        <span data-cloud-availability-status>${variant && this.activeDraft ? "Active in game" : "Inactive in game"}</span>
      </header>
      ${variant ? `<label class="cloud-preview-availability">
        <span><strong>Active in game</strong><small>Updates this frame’s eligibility in the live preview</small></span>
        <input type="checkbox" data-cloud="active" ${this.activeDraft ? "checked" : ""} ${this.mutationInFlight ? "disabled" : ""}>
      </label>` : '<p class="cloud-library-empty">Settings remain inspectable, but saving requires a catalog cloud.</p>'}

      <details class="cloud-settings-group" open>
        <summary><span><strong>Layout and size</strong><small>Frequency, coverage, opacity, and scale</small></span></summary>
        <div class="cloud-settings-grid">
          ${this.settingControl({ path: "candidatesPerChunk", label: "Clouds per chunk", minimum: bounds.candidatesPerChunk.minimum, maximum: bounds.candidatesPerChunk.maximum, step: 1, format: "integer" })}
          ${this.settingControl({ path: "chunkDensity", label: "Populated chunks", minimum: bounds.chunkDensity.minimum, maximum: bounds.chunkDensity.maximum, step: 0.01, format: "percent" })}
          ${this.settingControl({ path: "scale.minimum", label: "Minimum size", minimum: bounds.scale.minimum, maximum: bounds.scale.maximum, step: 0.01, format: "scale" })}
          ${this.settingControl({ path: "scale.maximum", label: "Maximum size", minimum: bounds.scale.minimum, maximum: bounds.scale.maximum, step: 0.01, format: "scale" })}
          ${this.settingControl({ path: "opacity.minimum", label: "Minimum opacity", minimum: bounds.opacity.minimum, maximum: bounds.opacity.maximum, step: 0.01, format: "percent" })}
          ${this.settingControl({ path: "opacity.maximum", label: "Maximum opacity", minimum: bounds.opacity.minimum, maximum: bounds.opacity.maximum, step: 0.01, format: "percent" })}
        </div>
      </details>

      <details class="cloud-settings-group" open>
        <summary><span><strong>Movement</strong><small>Travel, timing, and route fades</small></span></summary>
        <div class="cloud-settings-grid">
          ${this.settingControl({ path: "driftAmplitudePixels.minimum", label: "Minimum travel", minimum: bounds.driftAmplitudePixels.minimum, maximum: bounds.driftAmplitudePixels.maximum, step: 4, format: "pixels" })}
          ${this.settingControl({ path: "driftAmplitudePixels.maximum", label: "Maximum travel", minimum: bounds.driftAmplitudePixels.minimum, maximum: bounds.driftAmplitudePixels.maximum, step: 4, format: "pixels" })}
          ${this.settingControl({ path: "driftPeriodSeconds.minimum", label: "Fastest route", minimum: bounds.driftPeriodSeconds.minimum, maximum: bounds.driftPeriodSeconds.maximum, step: 1, format: "seconds" })}
          ${this.settingControl({ path: "driftPeriodSeconds.maximum", label: "Slowest route", minimum: bounds.driftPeriodSeconds.minimum, maximum: bounds.driftPeriodSeconds.maximum, step: 1, format: "seconds" })}
          ${this.settingControl({ path: "fadeInSeconds", label: "Appear duration", minimum: bounds.fadeInSeconds.minimum, maximum: bounds.fadeInSeconds.maximum, step: 0.5, format: "seconds" })}
          ${this.settingControl({ path: "routeFadeFraction", label: "Route-edge fade", minimum: bounds.routeFadeFraction.minimum, maximum: bounds.routeFadeFraction.maximum, step: 0.01, format: "percent" })}
        </div>
      </details>

      <details class="cloud-settings-group">
        <summary><span><strong>Shadow</strong><small>Position, flattening, and strength</small></span></summary>
        <div class="cloud-settings-grid">
          ${this.settingControl({ path: "shadow.offsetPixels.x", label: "Horizontal offset", minimum: bounds.shadow.offsetPixels.minimum, maximum: bounds.shadow.offsetPixels.maximum, step: 2, format: "pixels" })}
          ${this.settingControl({ path: "shadow.offsetPixels.y", label: "Vertical offset", minimum: bounds.shadow.offsetPixels.minimum, maximum: bounds.shadow.offsetPixels.maximum, step: 2, format: "pixels" })}
          ${this.settingControl({ path: "shadow.scale.x", label: "Width", minimum: bounds.shadow.scale.minimum, maximum: bounds.shadow.scale.maximum, step: 0.01, format: "scale" })}
          ${this.settingControl({ path: "shadow.scale.y", label: "Height", minimum: bounds.shadow.scale.minimum, maximum: bounds.shadow.scale.maximum, step: 0.01, format: "scale" })}
          ${this.settingControl({ path: "shadow.opacityMultiplier", label: "Strength", minimum: bounds.shadow.opacityMultiplier.minimum, maximum: bounds.shadow.opacityMultiplier.maximum, step: 0.01, format: "percent" })}
        </div>
      </details>

      <div class="asset-workbench-actions cloud-preview-settings-actions">
        <button type="button" data-cloud-action="save">Save changes</button>
        <button type="button" data-cloud-action="reset">Reset settings</button>
      </div>
      ${variant ? `<button type="button" class="cloud-preview-delete" data-cloud-action="delete">Delete cloud</button>` : ""}
      <p class="cloud-preview-status${this.mutationError ? " cloud-preview-status--error" : ""}" role="${this.mutationError ? "alert" : "status"}" aria-live="polite">${escapeHtml(this.mutationStatus)}</p>
      <p class="cloud-preview-delete-note">Save writes the selected availability and the complete atmosphere draft in one atomic package revision. Reset affects only the unsaved settings. Catalog deletion retains the reserved atlas slot; git is the recovery path.</p>
    </section>`;
    this.syncWorkbenchState();
  }

  private settingControl(control: Readonly<SettingControl>): string {
    const value = valueAtPath(this.settingsDraft, control.path);
    return `<label class="cloud-setting-control">
      <span><strong>${control.label}</strong><output data-cloud-setting-output="${control.path}">${formatSetting(value, control.format)}</output></span>
      <input
        type="range"
        data-cloud-setting="${control.path}"
        data-cloud-setting-format="${control.format}"
        min="${control.minimum}"
        max="${control.maximum}"
        step="${control.step}"
        value="${value}"
        aria-label="${control.label}"
      >
    </label>`;
  }

  private refreshPreviewPackage(): void {
    const selectedId = this.selectedVariantId;
    const variants = CLOUD_ASSET_PACKAGE.variants.map((variant) => (
      variant !== null && variant.id === selectedId
        ? { ...variant, activeInGame: this.activeDraft }
        : variant
    ));
    this.previewPackage = validateCloudAssetPackage({
      ...CLOUD_ASSET_PACKAGE,
      presentation: applyCloudAssetAuthoringSettings(CLOUD_ASSET_PACKAGE.presentation, this.settingsDraft),
      variants,
    });
    this.resolvePreviewClouds();
  }

  private resolvePreviewClouds(): void {
    if (!this.previewModel) return;
    this.resolvedPreviewDescriptors = resolveCloudWorldPreviewDescriptors(this.previewModel, this.previewPackage);
  }

  private drawWorldPreview(): void {
    const canvas = this.stage?.querySelector<HTMLCanvasElement>("[data-cloud-world-preview]");
    const model = this.previewModel;
    if (!canvas || !model || !this.previewCanvas) return;
    this.previewCanvas.draw(canvas, model, this.resolvedPreviewDescriptors, this.previewPackage, {
      timeMs: this.previewTimeMs,
      activationAgeMs: this.activationAgeMs,
      showGuides: this.showGuides,
      selectedFrame: this.selectedVariant()?.frame,
    });
  }

  private readonly animatePreview = (timestamp: number): void => {
    this.animationFrame = undefined;
    if (this.previewPaused || !this.stage?.isConnected) return;
    if (this.previewLastTimestamp !== undefined) {
      const elapsed = Math.min(100, Math.max(0, timestamp - this.previewLastTimestamp));
      this.previewTimeMs += elapsed * this.previewSpeed;
      this.activationAgeMs += elapsed * this.previewSpeed;
    }
    this.previewLastTimestamp = timestamp;
    if (timestamp - this.previewLastRenderedAt >= 50) {
      this.previewLastRenderedAt = timestamp;
      this.drawWorldPreview();
    }
    this.animationFrame = requestAnimationFrame(this.animatePreview);
  };

  private ensureAnimation(): void {
    if (this.previewPaused || this.animationFrame !== undefined) return;
    this.animationFrame = requestAnimationFrame(this.animatePreview);
  }

  private syncPreviewControls(): void {
    const seed = this.stage?.querySelector<HTMLInputElement>("[data-cloud-preview-control=seed]");
    const speed = this.stage?.querySelector<HTMLSelectElement>("[data-cloud-preview-control=speed]");
    const guides = this.stage?.querySelector<HTMLInputElement>("[data-cloud-preview-control=guides]");
    const pause = this.stage?.querySelector<HTMLButtonElement>("[data-cloud-preview-action=pause]");
    if (seed) seed.value = String(this.previewSeed);
    if (speed) speed.value = String(this.previewSpeed);
    if (guides) guides.checked = this.showGuides;
    if (pause) {
      pause.textContent = this.previewPaused ? "Play motion" : "Pause motion";
      pause.setAttribute("aria-pressed", String(this.previewPaused));
    }
  }

  private syncPreviewSummary(): void {
    const presentation = this.previewPackage.presentation;
    const summary = {
      count: `${this.resolvedPreviewDescriptors.length} clouds · ${presentation.candidatesPerChunk}/chunk`,
      density: `${Math.round(presentation.chunkDensity * 100)}% chunk coverage`,
      scale: `${presentation.scale.minimum.toFixed(2)}–${presentation.scale.maximum.toFixed(2)}× scale`,
      motion: `${presentation.driftAmplitudePixels.minimum}–${presentation.driftAmplitudePixels.maximum} px travel`,
    } as const;
    for (const [key, value] of Object.entries(summary)) {
      const output = this.stage?.querySelector<HTMLElement>(`[data-cloud-preview-summary=${key}]`);
      if (output) output.textContent = value;
    }
    const draftState = this.stage?.querySelector<HTMLElement>("[data-cloud-preview-draft-state]");
    if (draftState) draftState.textContent = this.hasUnsavedChanges() ? "Unsaved live draft" : "Checked-in settings";
  }

  private keepRangeOrdered(draft: Record<string, unknown>, changedPath: string): void {
    for (const [minimumPath, maximumPath] of ORDERED_SETTING_PATHS) {
      if (changedPath === minimumPath) {
        const minimum = valueAtPath(draft, minimumPath);
        if (minimum > valueAtPath(draft, maximumPath)) setValueAtPath(draft, maximumPath, minimum);
      } else if (changedPath === maximumPath) {
        const maximum = valueAtPath(draft, maximumPath);
        if (maximum < valueAtPath(draft, minimumPath)) setValueAtPath(draft, minimumPath, maximum);
      }
    }
  }

  private syncWorkbenchState(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    for (const input of slot.querySelectorAll<HTMLInputElement>("[data-cloud-setting]")) {
      const path = input.dataset.cloudSetting!;
      const value = valueAtPath(this.settingsDraft, path);
      input.value = String(value);
      input.disabled = this.mutationInFlight;
      const output = slot.querySelector<HTMLOutputElement>(`[data-cloud-setting-output="${path}"]`);
      if (output) output.value = formatSetting(value, input.dataset.cloudSettingFormat as SettingFormat);
    }
    const active = slot.querySelector<HTMLInputElement>("[data-cloud=active]");
    if (active) {
      active.checked = this.activeDraft;
      active.disabled = this.mutationInFlight;
    }
    const availability = slot.querySelector<HTMLElement>("[data-cloud-availability-status]");
    if (availability) availability.textContent = this.selectedVariant() && this.activeDraft
      ? "Active in game"
      : "Inactive in game";
    const save = slot.querySelector<HTMLButtonElement>("[data-cloud-action=save]");
    if (save) {
      save.disabled = !this.selectedVariant() || !this.hasUnsavedChanges() || this.mutationInFlight;
      save.textContent = this.mutationInFlight ? "Saving..." : "Save changes";
    }
    const reset = slot.querySelector<HTMLButtonElement>("[data-cloud-action=reset]");
    if (reset) reset.disabled = !this.settingsChanged() || this.mutationInFlight;
    const remove = slot.querySelector<HTMLButtonElement>("[data-cloud-action=delete]");
    if (remove) remove.disabled = this.mutationInFlight;
    const status = slot.querySelector<HTMLElement>(".cloud-preview-status");
    if (status) {
      status.textContent = this.mutationStatus;
      status.classList.toggle("cloud-preview-status--error", this.mutationError);
      status.setAttribute("role", this.mutationError ? "alert" : "status");
    }
    this.syncPreviewSummary();
  }

  private settingsChanged(): boolean {
    return !sameSettings(this.savedSettings, this.settingsDraft);
  }

  private hasUnsavedChanges(): boolean {
    return this.settingsChanged() || this.activeDraft !== (this.selectedVariant()?.activeInGame ?? false);
  }

  private resetSettingsDraft(): void {
    if (!this.settingsChanged() || this.mutationInFlight) return;
    this.settingsDraft = this.savedSettings;
    this.clearMutationStatus();
    this.refreshPreviewPackage();
    this.syncWorkbenchState();
    this.syncPreviewSummary();
    this.drawWorldPreview();
  }

  private async saveCloudChanges(): Promise<void> {
    const variant = this.selectedVariant();
    if (!variant || !this.hasUnsavedChanges()) return;
    this.setMutationState(true, "Saving cloud availability and atmosphere settings...");
    try {
      const request = validateCloudAssetSaveRequest({
        formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
        assetId: CLOUD_ASSET_PACKAGE.assetId,
        runtimeRevision: CLOUD_ASSET_PACKAGE.runtimeRevision,
        variantId: variant.id,
        activeInGame: this.activeDraft,
        settings: this.settingsDraft,
      });
      const response = await this.postMutation(CLOUD_ASSET_SAVE_ROUTE, request);
      if (response.variantId !== variant.id) throw new Error("Cloud save response did not match the selected variant");
      this.persistSelection(variant.id);
      this.setMutationState(true, "Saved. Reloading the cloud catalog...");
      window.location.reload();
    } catch (error) {
      this.setMutationState(false, this.errorMessage(error), true);
    }
  }

  private async deleteCloud(): Promise<void> {
    const variant = this.selectedVariant();
    if (!variant) return;
    if (!window.confirm(
      `Permanently delete "${variant.name}" from the cloud catalog? This cannot be undone in the asset workspace.`,
    )) return;
    this.setMutationState(true, `Deleting ${variant.name}...`);
    try {
      const request = validateCloudAssetIdentityRequest({
        formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
        assetId: CLOUD_ASSET_PACKAGE.assetId,
        runtimeRevision: CLOUD_ASSET_PACKAGE.runtimeRevision,
        variantId: variant.id,
      });
      const response = await this.postMutation(CLOUD_ASSET_DELETE_ROUTE, request);
      if (response.deletedVariantId !== variant.id) {
        throw new Error("Cloud delete response did not match the selected variant");
      }
      const selectedIndex = this.variants.findIndex(({ id }) => id === variant.id);
      const nextSelection = this.variants[selectedIndex + 1]?.id ?? this.variants[selectedIndex - 1]?.id;
      this.persistSelection(nextSelection);
      this.setMutationState(true, "Cloud deleted. Reloading the catalog...");
      window.location.reload();
    } catch (error) {
      this.setMutationState(false, this.errorMessage(error), true);
    }
  }

  private async postMutation(route: string, request: unknown): Promise<Readonly<CloudMutationResponse>> {
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    let result: CloudMutationResponse;
    try {
      result = await response.json() as CloudMutationResponse;
    } catch {
      throw new Error(`Cloud authoring returned HTTP ${response.status} without JSON`);
    }
    if (!response.ok || result.ok !== true) {
      throw new Error(result.error ?? `Cloud authoring failed with HTTP ${response.status}`);
    }
    return result;
  }

  private setMutationState(inFlight: boolean, message: string, error = false): void {
    this.mutationInFlight = inFlight;
    this.mutationStatus = message;
    this.mutationError = error;
    this.syncWorkbenchState();
  }

  private clearMutationStatus(): void {
    this.mutationStatus = "";
    this.mutationError = false;
  }

  private loadSheetImage(): void {
    if (this.sheetImage) return;
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => {
      this.previewCanvas = new CloudWorldPreviewCanvas(image);
      this.drawWorldPreview();
    }, { once: true, signal: this.controlsAbort?.signal });
    image.addEventListener("error", () => {
      this.mutationStatus = "The checked-in cloud sheet could not be loaded for preview.";
      this.mutationError = true;
      this.syncWorkbenchState();
    }, { once: true, signal: this.controlsAbort?.signal });
    image.src = CLOUD_ASSET_PACKAGE.image.url;
    this.sheetImage = image;
  }

  private syncFrameStyles(): void {
    const { image } = CLOUD_ASSET_PACKAGE;
    const columns = image.pixelSize.width / image.frameSize.width;
    const rows = image.pixelSize.height / image.frameSize.height;
    for (const element of this.browser?.querySelectorAll<HTMLElement>("[data-cloud-frame]") ?? []) {
      const frame = Number(element.dataset.cloudFrame);
      const column = frame % columns;
      const row = Math.floor(frame / columns);
      element.style.backgroundImage = `url("${image.url}")`;
      element.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
      element.style.backgroundPosition = `${columns === 1 ? 0 : column / (columns - 1) * 100}% ${rows === 1 ? 0 : row / (rows - 1) * 100}%`;
    }
  }

  private updateSelectedButtons(): void {
    for (const button of this.browser?.querySelectorAll<HTMLElement>("[data-cloud-variant]") ?? []) {
      const selected = button.dataset.cloudVariant === this.selectedVariantId;
      button.dataset.active = String(selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }

  private selectedVariant(): Readonly<CloudAssetVariantEntry> | undefined {
    return this.variants.find(({ id }) => id === this.selectedVariantId);
  }

  private resolveInitialSelection(): string | undefined {
    let stored: string | null = null;
    try { stored = window.sessionStorage.getItem(this.selectionKey); }
    catch { /* Browser storage is optional for this local tool. */ }
    return this.variants.find(({ id }) => id === stored)?.id ?? this.variants[0]?.id;
  }

  private persistSelection(variantId: string | undefined): void {
    try {
      if (variantId) window.sessionStorage.setItem(this.selectionKey, variantId);
      else window.sessionStorage.removeItem(this.selectionKey);
    } catch {
      // Selection persistence is a convenience; authoring remains available.
    }
  }

  private reportShellStatus(message: string): void {
    const status = document.querySelector<HTMLElement>("#game-status");
    if (status) status.textContent = message;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Cloud authoring failed unexpectedly";
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.controlsAbort = undefined;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.previewCanvas?.destroy();
    this.previewCanvas = undefined;
    this.browser?.remove();
    this.browser = undefined;
    this.stage?.remove();
    this.stage = undefined;
    this.sheetImage = undefined;
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (slot) {
      slot.replaceChildren();
      slot.classList.remove("tool-slot--connected", "cloud-preview-tools");
    }
  }
}
