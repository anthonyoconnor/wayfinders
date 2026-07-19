import Phaser from "phaser";
import {
  CLOUD_ASSET_PACKAGE,
  cloudAssetVariantEntries,
  type CloudAssetVariantEntry,
} from "../CloudAssetCatalog";
import {
  assetWorkspaceSceneKey,
  assetWorkspaceSelectionKey,
  type CloudAssetWorkspaceModule,
} from "../workspaces/AssetWorkspace";
import {
  CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
  validateCloudAssetIdentityRequest,
  validateCloudAssetSaveRequest,
} from "../CloudAssetAuthoring";

const CLOUD_ASSET_SAVE_ROUTE = "/__wayfinders/assets/clouds/save";
const CLOUD_ASSET_DELETE_ROUTE = "/__wayfinders/assets/clouds/delete";

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

function rgbCss(rgb: Readonly<{ red: number; green: number; blue: number }>): string {
  return `rgb(${rgb.red} ${rgb.green} ${rgb.blue})`;
}

/** Cloud-owned catalog, preview and guarded repository authoring workspace. */
export class CloudAssetWorkspaceScene extends Phaser.Scene {
  private readonly variants = cloudAssetVariantEntries(CLOUD_ASSET_PACKAGE);
  private readonly selectionKey: string;
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private sheetImage?: HTMLImageElement;
  private selectedVariantId?: string;
  private activeDraft = false;
  private mutationInFlight = false;
  private mutationStatus = "";
  private mutationError = false;

  constructor(workspace: Readonly<CloudAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
    this.selectionKey = assetWorkspaceSelectionKey(workspace.id);
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.selectedVariantId = this.resolveInitialSelection();
    this.activeDraft = this.selectedVariant()?.activeInGame ?? false;
    this.mountWorkspace();
    this.renderBrowser();
    this.renderPreview();
    this.renderWorkbench();
    this.loadSheetImage();
    this.reportShellStatus(
      this.variants.length === 0
        ? "Cloud library - no catalog entries"
        : `Cloud library - ${this.variants.length} catalog entries`,
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
    this.stage.setAttribute("aria-label", "Selected cloud and shadow preview");
    region.append(this.stage);

    slot.classList.add("tool-slot--connected", "cloud-preview-tools");
    this.browser.addEventListener("click", this.onBrowserClick, { signal: this.controlsAbort.signal });
    slot.addEventListener("change", this.onWorkbenchChange, { signal: this.controlsAbort.signal });
    slot.addEventListener("click", this.onWorkbenchClick, { signal: this.controlsAbort.signal });
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
    this.mutationStatus = "";
    this.mutationError = false;
    this.persistSelection(variant.id);
    this.updateSelectedButtons();
    this.renderPreview();
    this.renderWorkbench();
    this.drawSelectedCloud();
  };

  private readonly onWorkbenchChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.cloud !== "active") return;
    this.activeDraft = target.checked;
    this.mutationStatus = "";
    this.mutationError = false;
    this.renderWorkbench();
  };

  private readonly onWorkbenchClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-cloud-action]")
      : null;
    if (!target || this.mutationInFlight) return;
    if (target.dataset.cloudAction === "save") void this.saveAvailability();
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
    if (!variant) {
      this.stage.innerHTML = `<article class="cloud-preview-card cloud-preview-card--empty">
        <p class="eyebrow">Cloud atmosphere</p>
        <h2>No cloud assets remain</h2>
        <p>The runtime cloud layer stays empty until a new catalog entry is authored.</p>
      </article>`;
      return;
    }
    this.stage.innerHTML = `<article class="cloud-preview-card">
      <header>
        <div><p class="eyebrow">Selected cloud and paired shadow</p><h2>${escapeHtml(variant.name)}</h2></div>
        <span class="cloud-preview-kind">${variant.activeInGame ? "Active in game" : "Inactive in game"}</span>
      </header>
      <div class="cloud-preview-canvas-shell">
        <canvas width="760" height="500" data-cloud-preview aria-label="${escapeHtml(variant.name)} with its in-game shadow"></canvas>
      </div>
      <dl class="cloud-preview-facts">
        <div><dt>Stable ID</dt><dd><code>${escapeHtml(variant.id)}</code></dd></div>
        <div><dt>Atlas frame</dt><dd>${variant.frame + 1} of ${CLOUD_ASSET_PACKAGE.image.frameCount}</dd></div>
        <div><dt>Runtime revision</dt><dd>${CLOUD_ASSET_PACKAGE.runtimeRevision}</dd></div>
      </dl>
      <p class="cloud-preview-note">The preview uses the checked-in frame and its actual flattened, offset shadow treatment. Movement and fog behavior are not edited here.</p>
    </article>`;
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    const variant = this.selectedVariant();
    if (!variant) {
      slot.innerHTML = `<section class="asset-workbench cloud-preview-workbench">
        <header><div><p class="eyebrow">Cloud catalog</p><h3>No selection</h3></div><span>Empty</span></header>
        <p>No cloud entries remain. The shared atlas is retained as inert source history.</p>
      </section>`;
      return;
    }
    const changed = this.activeDraft !== variant.activeInGame;
    slot.innerHTML = `<section class="asset-workbench cloud-preview-workbench">
      <header>
        <div><p class="eyebrow">Selected cloud</p><h3>${escapeHtml(variant.name)}</h3></div>
        <span data-cloud-availability-status>${this.activeDraft ? "Active in game" : "Inactive in game"}</span>
      </header>
      <label class="cloud-preview-availability">
        <span><strong>Active in game</strong><small>Eligible for deterministic cloud placement</small></span>
        <input type="checkbox" data-cloud="active" ${this.activeDraft ? "checked" : ""} ${this.mutationInFlight ? "disabled" : ""}>
      </label>
      <p>Saving changes updates the checked-in cloud package. The game keeps the same positions, motion, fog rules, and paired-shadow behavior.</p>
      <div class="asset-workbench-actions">
        <button type="button" data-cloud-action="save" ${!changed || this.mutationInFlight ? "disabled" : ""}>
          ${this.mutationInFlight ? "Saving..." : "Save changes"}
        </button>
        <button type="button" class="cloud-preview-delete" data-cloud-action="delete" ${this.mutationInFlight ? "disabled" : ""}>
          Delete cloud
        </button>
      </div>
      <p class="cloud-preview-status${this.mutationError ? " cloud-preview-status--error" : ""}" role="${this.mutationError ? "alert" : "status"}" aria-live="polite">
        ${escapeHtml(this.mutationStatus)}
      </p>
      <p class="cloud-preview-delete-note">Deletion permanently removes this frame from the catalog. Its reserved atlas slot remains inert so other frame IDs never shift; git is the recovery path.</p>
    </section>`;
  }

  private async saveAvailability(): Promise<void> {
    const variant = this.selectedVariant();
    if (!variant || this.activeDraft === variant.activeInGame) return;
    this.setMutationState(true, "Saving cloud availability...");
    try {
      const request = validateCloudAssetSaveRequest({
        formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
        assetId: CLOUD_ASSET_PACKAGE.assetId,
        runtimeRevision: CLOUD_ASSET_PACKAGE.runtimeRevision,
        variantId: variant.id,
        activeInGame: this.activeDraft,
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
    this.renderWorkbench();
  }

  private loadSheetImage(): void {
    if (this.sheetImage) return;
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => this.drawSelectedCloud(), {
      once: true,
      signal: this.controlsAbort?.signal,
    });
    image.addEventListener("error", () => {
      this.mutationStatus = "The checked-in cloud sheet could not be loaded for preview.";
      this.mutationError = true;
      this.renderWorkbench();
    }, { once: true, signal: this.controlsAbort?.signal });
    image.src = CLOUD_ASSET_PACKAGE.image.url;
    this.sheetImage = image;
  }

  private drawSelectedCloud(): void {
    const variant = this.selectedVariant();
    const canvas = this.stage?.querySelector<HTMLCanvasElement>("[data-cloud-preview]");
    const image = this.sheetImage;
    if (!variant || !canvas || !image?.complete || image.naturalWidth === 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { image: atlas, presentation } = CLOUD_ASSET_PACKAGE;
    const columns = atlas.pixelSize.width / atlas.frameSize.width;
    const sourceX = (variant.frame % columns) * atlas.frameSize.width;
    const sourceY = Math.floor(variant.frame / columns) * atlas.frameSize.height;
    const displaySize = 570;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 - 20;
    const previewScale = displaySize / atlas.frameSize.width;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = canvas.width;
    shadowCanvas.height = canvas.height;
    const shadowContext = shadowCanvas.getContext("2d");
    if (shadowContext) {
      shadowContext.imageSmoothingEnabled = false;
      shadowContext.save();
      shadowContext.translate(
        centerX + presentation.shadow.offsetPixels.x * previewScale,
        centerY + presentation.shadow.offsetPixels.y * previewScale,
      );
      shadowContext.scale(presentation.shadow.scale.x, presentation.shadow.scale.y);
      shadowContext.drawImage(
        image,
        sourceX,
        sourceY,
        atlas.frameSize.width,
        atlas.frameSize.height,
        -displaySize / 2,
        -displaySize / 2,
        displaySize,
        displaySize,
      );
      shadowContext.restore();
      shadowContext.globalCompositeOperation = "source-in";
      shadowContext.fillStyle = rgbCss(presentation.shadow.tintRgb);
      shadowContext.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height);
      context.globalAlpha = presentation.shadow.opacityMultiplier;
      context.drawImage(shadowCanvas, 0, 0);
      context.globalAlpha = 1;
    }

    context.drawImage(
      image,
      sourceX,
      sourceY,
      atlas.frameSize.width,
      atlas.frameSize.height,
      centerX - displaySize / 2,
      centerY - displaySize / 2,
      displaySize,
      displaySize,
    );
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
