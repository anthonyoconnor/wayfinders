import Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  validateAuthoredAssetMetadata,
  type AuthoredAssetId,
} from "./AuthoredAssetContracts";
import {
  ASSET_CANDIDATE_BUNDLE_VERSION,
  CandidateAssetRuntime,
  candidateImageRequirements,
  validateAssetCandidateBundle,
  type AssetCandidateBundle,
  type CandidateImage,
  type CandidateImageRequirement,
} from "./AssetCandidate";
import {
  createAuthoredFishingShoalVisual,
  createAuthoredHomeIslandVisual,
  type AuthoredFishingShoalVisual,
  type AuthoredHomeIslandVisual,
} from "./AuthoredAssetPresentation";
import { PILOT_ASSET_CATALOG, preloadPilotAssetPackages } from "./PilotAssetCatalog";
import {
  createPilotAssetRuntime,
  type AuthoredAssetRuntime,
  type PilotAssetRuntime,
} from "./PilotAssetRuntime";
import { ShipRenderer } from "../rendering/ShipRenderer";
import homeIslandPackage from "./packages/home-island.json";
import playerBoatPackage from "./packages/player-boat.json";
import fishingShoalPackage from "./packages/fishing-shoal.json";

interface ViewerState {
  assetId: AuthoredAssetId;
  heading: number;
  speed: number;
  seed: number;
  animate: boolean;
  showFog: boolean;
  showPersonalOverlay: boolean;
  showOrigin: boolean;
  showFootprint: boolean;
}

interface AssetViewerDebugApi {
  snapshot(): Readonly<ViewerState>;
  select(assetId: AuthoredAssetId): boolean;
  setHeading(heading: number): void;
  setContrast(fog: boolean, personal: boolean): void;
  diagnostics(): readonly string[];
}

declare global {
  interface Window {
    __WAYFINDERS_ASSET_VIEWER__?: AssetViewerDebugApi;
  }
}

const STAGE = Object.freeze({ width: 1_200, height: 800, centerX: 600, centerY: 400 });
const ASSET_IDS = Object.values(AUTHORED_ASSET_IDS);
const TEMPLATE_BY_ASSET_ID: Readonly<Record<AuthoredAssetId, unknown>> = Object.freeze({
  [AUTHORED_ASSET_IDS.homeIsland]: homeIslandPackage,
  [AUTHORED_ASSET_IDS.playerBoat]: playerBoatPackage,
  [AUTHORED_ASSET_IDS.fishingShoal]: fishingShoalPackage,
});

export class AssetViewerScene extends Phaser.Scene {
  private catalogAssets!: PilotAssetRuntime;
  private previewAssets!: AuthoredAssetRuntime;
  private state: ViewerState = {
    assetId: AUTHORED_ASSET_IDS.homeIsland,
    heading: 0,
    speed: 48,
    seed: 71_041,
    animate: true,
    showFog: false,
    showPersonalOverlay: false,
    showOrigin: true,
    showFootprint: true,
  };
  private guideGraphics!: Phaser.GameObjects.Graphics;
  private contrastGraphics!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private placement!: Phaser.GameObjects.Text;
  private homeVisual?: AuthoredHomeIslandVisual;
  private shipRenderer?: ShipRenderer;
  private shoalVisual?: AuthoredFishingShoalVisual;
  private controlsAbort?: AbortController;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private zoomIn?: Phaser.Input.Keyboard.Key;
  private zoomOut?: Phaser.Input.Keyboard.Key;
  private validatedCandidate?: Readonly<AssetCandidateBundle>;
  private candidateTextureKeys: string[] = [];
  private candidateRevision = 0;

  constructor() {
    super({ key: "AssetViewerScene" });
  }

  preload(): void {
    preloadPilotAssetPackages(this);
  }

  create(): void {
    this.catalogAssets = createPilotAssetRuntime(this);
    this.previewAssets = this.catalogAssets;
    this.add.rectangle(0, 0, STAGE.width, STAGE.height, 0x082f40)
      .setOrigin(0)
      .setDepth(-20);
    this.drawWaterGrid();
    this.guideGraphics = this.add.graphics().setDepth(80);
    this.contrastGraphics = this.add.graphics().setDepth(70);
    this.title = this.add.text(32, 28, "", {
      color: "#fff2c8",
      fontFamily: "ui-monospace, monospace",
      fontSize: "18px",
      fontStyle: "bold",
      stroke: "#041419",
      strokeThickness: 5,
    }).setDepth(90);
    this.placement = this.add.text(32, 56, "", {
      color: "#a9c8c8",
      fontFamily: "ui-monospace, monospace",
      fontSize: "12px",
      stroke: "#041419",
      strokeThickness: 4,
    }).setDepth(90);

    this.cameras.main.setBounds(0, 0, STAGE.width, STAGE.height).centerOn(STAGE.centerX, STAGE.centerY);
    this.cameras.main.setZoom(this.defaultZoom());
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.zoomIn = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.zoomOut = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.mountControls();
    this.installDebugApi();
    this.rebuildPreview();

    const sceneStatus = document.querySelector<HTMLElement>("#scene-status");
    if (sceneStatus) sceneStatus.textContent = "Runtime asset viewer active";
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "Asset viewer · wheel or Q/E zoom · arrows pan";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  override update(_time: number, delta: number): void {
    const pan = 0.42 * delta / this.cameras.main.zoom;
    if (this.cursors?.left.isDown) this.cameras.main.scrollX -= pan;
    if (this.cursors?.right.isDown) this.cameras.main.scrollX += pan;
    if (this.cursors?.up.isDown) this.cameras.main.scrollY -= pan;
    if (this.cursors?.down.isDown) this.cameras.main.scrollY += pan;
    if (this.zoomIn && Phaser.Input.Keyboard.JustDown(this.zoomIn)) this.changeZoom(0.1);
    if (this.zoomOut && Phaser.Input.Keyboard.JustDown(this.zoomOut)) this.changeZoom(-0.1);
    if (this.shipRenderer) {
      const heading = this.state.animate
        ? (this.state.heading + this.time.now * 0.025) % 360
        : this.state.heading;
      this.shipRenderer.sync({
        worldX: STAGE.centerX,
        worldY: STAGE.centerY,
        heading,
        speed: this.state.speed,
      });
      this.drawGuides();
    }
  }

  private drawWaterGrid(): void {
    const grid = this.add.graphics().setDepth(-10);
    grid.lineStyle(1, 0x8bd0cf, 0.1);
    for (let x = 0; x <= STAGE.width; x += 32) grid.lineBetween(x, 0, x, STAGE.height);
    for (let y = 0; y <= STAGE.height; y += 32) grid.lineBetween(0, y, STAGE.width, y);
  }

  private rebuildPreview(): void {
    this.homeVisual?.destroy();
    this.shipRenderer?.destroy();
    this.shoalVisual?.image.destroy();
    this.homeVisual = undefined;
    this.shipRenderer = undefined;
    this.shoalVisual = undefined;

    if (this.state.assetId === AUTHORED_ASSET_IDS.homeIsland) {
      this.homeVisual = createAuthoredHomeIslandVisual(this, this.previewAssets);
      const metadata = this.homeVisual?.metadata;
      if (this.homeVisual && metadata) {
        this.homeVisual.setPosition(
          STAGE.centerX - metadata.render.pixelSize.width / 2,
          STAGE.centerY - metadata.render.pixelSize.height / 2,
        );
        this.homeVisual.setVisible(true);
      }
    } else if (this.state.assetId === AUTHORED_ASSET_IDS.playerBoat) {
      this.shipRenderer = new ShipRenderer(this, this.previewAssets);
    } else {
      this.shoalVisual = createAuthoredFishingShoalVisual(this, this.previewAssets);
      this.shoalVisual?.image.setPosition(STAGE.centerX, STAGE.centerY).setVisible(true);
    }
    this.title.setText(this.state.assetId);
    this.updatePlacementLabel();
    this.drawGuides();
    this.drawContrast();
  }

  private drawGuides(): void {
    const graphics = this.guideGraphics.clear();
    const metadata = this.previewAssets.metadata(this.state.assetId);
    if (!metadata) return;
    if (this.state.showOrigin) {
      graphics.lineStyle(2, 0xffd47a, 0.95);
      graphics.lineBetween(STAGE.centerX - 18, STAGE.centerY, STAGE.centerX + 18, STAGE.centerY);
      graphics.lineBetween(STAGE.centerX, STAGE.centerY - 18, STAGE.centerX, STAGE.centerY + 18);
      graphics.strokeCircle(STAGE.centerX, STAGE.centerY, 5);
    }
    if (!this.state.showFootprint) return;
    graphics.lineStyle(2, 0x83fff0, 0.72);
    if (metadata.kind === "home-island") {
      const left = STAGE.centerX - metadata.render.pixelSize.width / 2;
      const top = STAGE.centerY - metadata.render.pixelSize.height / 2;
      graphics.strokeRect(left, top, metadata.render.pixelSize.width, metadata.render.pixelSize.height);
      graphics.lineStyle(1, 0x83fff0, 0.28);
      for (let x = 0; x <= metadata.grid.width; x++) {
        graphics.lineBetween(left + x * metadata.tileSize, top, left + x * metadata.tileSize, top + metadata.grid.height * metadata.tileSize);
      }
      for (let y = 0; y <= metadata.grid.height; y++) {
        graphics.lineBetween(left, top + y * metadata.tileSize, left + metadata.grid.width * metadata.tileSize, top + y * metadata.tileSize);
      }
      for (const anchor of Object.values(metadata.anchors)) {
        graphics.fillStyle(0xffd47a, 0.9);
        graphics.fillCircle(left + (anchor.x + 0.5) * metadata.tileSize, top + (anchor.y + 0.5) * metadata.tileSize, 3);
      }
    } else if (metadata.kind === "player-boat") {
      const width = metadata.visual.frameSize.width * metadata.visual.scale;
      const height = metadata.visual.frameSize.height * metadata.visual.scale;
      graphics.strokeRect(STAGE.centerX - width / 2, STAGE.centerY - height / 2, width, height);
    } else {
      const width = metadata.visual.pixelSize.width * metadata.visual.scale;
      const height = metadata.visual.pixelSize.height * metadata.visual.scale;
      graphics.strokeRect(
        STAGE.centerX - width * metadata.visual.origin.x,
        STAGE.centerY - height * metadata.visual.origin.y,
        width,
        height,
      );
    }
  }

  private drawContrast(): void {
    const graphics = this.contrastGraphics.clear();
    if (this.state.showPersonalOverlay) {
      graphics.fillStyle(0x6e7477, 0.42).fillRect(0, 0, STAGE.width, STAGE.height);
    }
    if (this.state.showFog) {
      graphics.fillStyle(0x02090d, 0.7).fillRect(0, 0, STAGE.width, STAGE.height);
      graphics.lineStyle(2, 0xb3efef, 0.25);
      graphics.strokeCircle(STAGE.centerX, STAGE.centerY, 110);
    }
  }

  private updatePlacementLabel(): void {
    const x = Math.abs((this.state.seed * 1_103_515_245 + 12_345) | 0) % 997;
    const y = Math.abs((this.state.seed * 214_013 + 2_531_011) | 0) % 997;
    this.placement.setText(`fixed seed ${this.state.seed} · placement (${x}, ${y})`);
  }

  private mountControls(): void {
    const slot = document.querySelector<HTMLDivElement>("#scene-tools-slot");
    if (!slot) return;
    this.controlsAbort?.abort();
    this.controlsAbort = new AbortController();
    const signal = this.controlsAbort.signal;
    slot.classList.add("tool-slot--connected");
    slot.innerHTML = `
      <section class="asset-viewer-controls" aria-labelledby="asset-viewer-title">
        <h3 id="asset-viewer-title">Runtime viewer</h3>
        <label>Package <select data-viewer="asset"></select></label>
        <label>Heading <input data-viewer="heading" type="range" min="0" max="359" step="1"><output data-viewer-output="heading"></output></label>
        <label>Speed <input data-viewer="speed" type="range" min="-96" max="96" step="1"><output data-viewer-output="speed"></output></label>
        <label>Fixed seed <input data-viewer="seed" type="number" step="1"></label>
        <div class="asset-viewer-checks">
          <label><input data-viewer="animate" type="checkbox"> Animate headings/frames</label>
          <label><input data-viewer="origin" type="checkbox"> Origin guides</label>
          <label><input data-viewer="footprint" type="checkbox"> Footprint/grid</label>
          <label><input data-viewer="personal" type="checkbox"> Personal-grey overlay</label>
          <label><input data-viewer="fog" type="checkbox"> Fog contrast</label>
        </div>
        <output data-viewer-output="diagnostics" class="asset-viewer-diagnostics"></output>
      </section>
      <section class="asset-workbench" aria-labelledby="asset-workbench-title">
        <header>
          <div>
            <p class="eyebrow">GR-2.2</p>
            <h3 id="asset-workbench-title">Candidate intake</h3>
          </div>
          <button data-workbench="template" type="button">Load template</button>
        </header>
        <label>Contract template <select data-workbench="kind"></select></label>
        <label class="asset-workbench-editor">Semantic metadata
          <textarea data-workbench="metadata" rows="18" spellcheck="false"></textarea>
        </label>
        <div class="asset-workbench-actions">
          <button data-workbench="bindings" type="button">Refresh PNG bindings</button>
          <button data-workbench="catalog-images" type="button">Use catalog PNGs</button>
        </div>
        <div data-workbench="images" class="asset-workbench-images"></div>
        <div class="asset-workbench-actions">
          <button data-workbench="validate" type="button">Validate and preview</button>
          <button data-workbench="export" type="button" disabled>Export candidate bundle</button>
        </div>
        <output data-workbench-output="status" class="asset-viewer-diagnostics" aria-live="polite"></output>
      </section>`;
    const assetSelect = slot.querySelector<HTMLSelectElement>("[data-viewer=asset]");
    if (!assetSelect) return;
    for (const assetId of ASSET_IDS) assetSelect.add(new Option(assetId, assetId));
    assetSelect.value = this.state.assetId;
    const heading = slot.querySelector<HTMLInputElement>("[data-viewer=heading]");
    const speed = slot.querySelector<HTMLInputElement>("[data-viewer=speed]");
    const seed = slot.querySelector<HTMLInputElement>("[data-viewer=seed]");
    const animate = slot.querySelector<HTMLInputElement>("[data-viewer=animate]");
    const origin = slot.querySelector<HTMLInputElement>("[data-viewer=origin]");
    const footprint = slot.querySelector<HTMLInputElement>("[data-viewer=footprint]");
    const personal = slot.querySelector<HTMLInputElement>("[data-viewer=personal]");
    const fog = slot.querySelector<HTMLInputElement>("[data-viewer=fog]");
    if (!heading || !speed || !seed || !animate || !origin || !footprint || !personal || !fog) return;
    heading.value = String(this.state.heading);
    speed.value = String(this.state.speed);
    seed.value = String(this.state.seed);
    animate.checked = this.state.animate;
    origin.checked = this.state.showOrigin;
    footprint.checked = this.state.showFootprint;
    personal.checked = this.state.showPersonalOverlay;
    fog.checked = this.state.showFog;
    const syncOutputs = () => {
      const headingOutput = slot.querySelector<HTMLOutputElement>("[data-viewer-output=heading]");
      const speedOutput = slot.querySelector<HTMLOutputElement>("[data-viewer-output=speed]");
      if (headingOutput) headingOutput.value = `${this.state.heading}°`;
      if (speedOutput) speedOutput.value = `${this.state.speed} px/s`;
    };
    syncOutputs();
    assetSelect.addEventListener("change", () => {
      if (ASSET_IDS.includes(assetSelect.value as AuthoredAssetId)) {
        this.previewAssets = this.catalogAssets;
        this.state.assetId = assetSelect.value as AuthoredAssetId;
        this.rebuildPreview();
      }
    }, { signal });
    heading.addEventListener("input", () => { this.state.heading = Number(heading.value); syncOutputs(); this.drawGuides(); }, { signal });
    speed.addEventListener("input", () => { this.state.speed = Number(speed.value); syncOutputs(); }, { signal });
    seed.addEventListener("change", () => { this.state.seed = Number(seed.value) || 0; this.updatePlacementLabel(); }, { signal });
    animate.addEventListener("change", () => { this.state.animate = animate.checked; }, { signal });
    origin.addEventListener("change", () => { this.state.showOrigin = origin.checked; this.drawGuides(); }, { signal });
    footprint.addEventListener("change", () => { this.state.showFootprint = footprint.checked; this.drawGuides(); }, { signal });
    personal.addEventListener("change", () => { this.state.showPersonalOverlay = personal.checked; this.drawContrast(); }, { signal });
    fog.addEventListener("change", () => { this.state.showFog = fog.checked; this.drawContrast(); }, { signal });
    const diagnostics = slot.querySelector<HTMLOutputElement>("[data-viewer-output=diagnostics]");
    if (diagnostics) diagnostics.value = this.catalogAssets.diagnostics.length === 0
      ? `${ASSET_IDS.length} packages loaded with complete textures.`
      : this.catalogAssets.diagnostics.map(({ assetId, message }) => `${assetId}: ${message}`).join("\n");
    this.mountCandidateWorkbench(slot, signal, assetSelect);
  }

  private mountCandidateWorkbench(
    slot: HTMLDivElement,
    signal: AbortSignal,
    assetSelect: HTMLSelectElement,
  ): void {
    const kind = slot.querySelector<HTMLSelectElement>("[data-workbench=kind]");
    const metadataEditor = slot.querySelector<HTMLTextAreaElement>("[data-workbench=metadata]");
    const templateButton = slot.querySelector<HTMLButtonElement>("[data-workbench=template]");
    const bindingsButton = slot.querySelector<HTMLButtonElement>("[data-workbench=bindings]");
    const catalogImagesButton = slot.querySelector<HTMLButtonElement>("[data-workbench=catalog-images]");
    const imagesRoot = slot.querySelector<HTMLDivElement>("[data-workbench=images]");
    const validateButton = slot.querySelector<HTMLButtonElement>("[data-workbench=validate]");
    const exportButton = slot.querySelector<HTMLButtonElement>("[data-workbench=export]");
    const status = slot.querySelector<HTMLOutputElement>("[data-workbench-output=status]");
    if (
      !kind || !metadataEditor || !templateButton || !bindingsButton || !catalogImagesButton
      || !imagesRoot || !validateButton || !exportButton || !status
    ) return;

    const filesByImageId = new Map<string, File>();
    let requirements: readonly Readonly<CandidateImageRequirement>[] = [];
    for (const assetId of ASSET_IDS) kind.add(new Option(assetId, assetId));
    kind.value = this.state.assetId;

    const report = (message: string, error = false) => {
      status.value = message;
      status.dataset.state = error ? "error" : "ready";
    };
    const resetCandidate = () => {
      this.validatedCandidate = undefined;
      exportButton.disabled = true;
    };
    const renderBindings = () => {
      resetCandidate();
      filesByImageId.clear();
      imagesRoot.replaceChildren();
      const parsed = JSON.parse(metadataEditor.value) as unknown;
      const metadata = this.validateCandidateMetadataOnly(parsed);
      requirements = candidateImageRequirements(metadata);
      for (const requirement of requirements) {
        const label = document.createElement("label");
        const text = document.createElement("span");
        text.textContent = `${requirement.imageId} · ${requirement.size.width}×${requirement.size.height}`;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,.png";
        input.dataset.imageId = requirement.imageId;
        input.addEventListener("change", () => {
          resetCandidate();
          const file = input.files?.[0];
          if (file) filesByImageId.set(requirement.imageId, file);
          else filesByImageId.delete(requirement.imageId);
        }, { signal });
        label.append(text, input);
        imagesRoot.append(label);
      }
      report(`${requirements.length} PNG binding${requirements.length === 1 ? "" : "s"} required.`);
    };
    const loadTemplate = () => {
      const assetId = kind.value as AuthoredAssetId;
      const template = structuredClone(TEMPLATE_BY_ASSET_ID[assetId]) as Record<string, unknown>;
      template.runtimeRevision = Number(template.runtimeRevision) + 1;
      template.sourceAssetId = `${String(template.sourceAssetId)}.candidate`;
      metadataEditor.value = JSON.stringify(template, null, 2);
      renderBindings();
    };

    templateButton.addEventListener("click", () => {
      try { loadTemplate(); } catch (error) { report(this.errorMessage(error), true); }
    }, { signal });
    kind.addEventListener("change", loadTemplate, { signal });
    bindingsButton.addEventListener("click", () => {
      try { renderBindings(); } catch (error) { report(this.errorMessage(error), true); }
    }, { signal });
    metadataEditor.addEventListener("input", resetCandidate, { signal });
    catalogImagesButton.addEventListener("click", () => {
      void this.loadCatalogCandidateFiles(kind.value as AuthoredAssetId, requirements, filesByImageId, imagesRoot)
        .then(() => report("Current runtime PNGs are bound as candidate inputs."))
        .catch((error: unknown) => report(this.errorMessage(error), true));
    }, { signal });
    validateButton.addEventListener("click", () => {
      validateButton.disabled = true;
      void this.buildCandidateBundle(metadataEditor.value, requirements, filesByImageId)
        .then(async (bundle) => {
          this.validatedCandidate = bundle;
          await this.loadCandidatePreview(bundle);
          assetSelect.value = bundle.metadata.assetId;
          kind.value = bundle.metadata.assetId;
          exportButton.disabled = false;
          report(`Valid ${bundle.metadata.assetId} candidate loaded into the shared runtime viewer.`);
        })
        .catch((error: unknown) => {
          resetCandidate();
          report(this.errorMessage(error), true);
        })
        .finally(() => { validateButton.disabled = false; });
    }, { signal });
    exportButton.addEventListener("click", () => {
      if (!this.validatedCandidate) return;
      const filename = `${this.validatedCandidate.metadata.assetId.replaceAll(".", "-")}.candidate.json`;
      const blob = new Blob([`${JSON.stringify(this.validatedCandidate, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      report(`Exported ${filename}; run the repository intake command to materialize tracked files.`);
    }, { signal });
    loadTemplate();
  }

  private validateCandidateMetadataOnly(value: unknown) {
    return validateAuthoredAssetMetadata(value);
  }

  private async loadCatalogCandidateFiles(
    assetId: AuthoredAssetId,
    requirements: readonly Readonly<CandidateImageRequirement>[],
    filesByImageId: Map<string, File>,
    imagesRoot: HTMLElement,
  ): Promise<void> {
    const entry = PILOT_ASSET_CATALOG.find((candidate) => candidate.assetId === assetId);
    if (!entry) throw new RangeError(`No catalog entry exists for ${assetId}`);
    for (const requirement of requirements) {
      const catalogImage = entry.images.find(({ imageId }) => imageId === requirement.imageId);
      if (!catalogImage) throw new RangeError(`Catalog does not bind ${requirement.imageId}`);
      const response = await fetch(catalogImage.url);
      if (!response.ok) throw new Error(`Could not load ${catalogImage.url}: ${response.status}`);
      const file = new File([await response.blob()], `${requirement.imageId}.png`, { type: "image/png" });
      filesByImageId.set(requirement.imageId, file);
      const input = imagesRoot.querySelector<HTMLInputElement>(`input[data-image-id="${CSS.escape(requirement.imageId)}"]`);
      input?.closest("label")?.setAttribute("data-bound", "true");
    }
  }

  private async buildCandidateBundle(
    metadataJson: string,
    requirements: readonly Readonly<CandidateImageRequirement>[],
    filesByImageId: ReadonlyMap<string, File>,
  ): Promise<Readonly<AssetCandidateBundle>> {
    const metadata = JSON.parse(metadataJson) as unknown;
    const validatedMetadata = this.validateCandidateMetadataOnly(metadata);
    const currentRequirements = candidateImageRequirements(validatedMetadata);
    if (requirements.map(({ imageId }) => imageId).join("|") !== currentRequirements.map(({ imageId }) => imageId).join("|")) {
      throw new RangeError("Metadata image references changed; refresh PNG bindings before validation");
    }
    const images: CandidateImage[] = [];
    for (const requirement of currentRequirements) {
      const file = filesByImageId.get(requirement.imageId);
      if (!file) throw new RangeError(`candidate is missing image ${requirement.imageId}`);
      if (file.type !== "image/png") throw new RangeError(`${requirement.imageId} must be a PNG file`);
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      images.push({
        imageId: requirement.imageId,
        filename: `${requirement.imageId.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-")}.png`,
        mimeType: "image/png",
        width,
        height,
        dataUrl: await this.readFileAsDataUrl(file),
      });
    }
    return validateAssetCandidateBundle({
      bundleVersion: ASSET_CANDIDATE_BUNDLE_VERSION,
      metadata,
      images,
    });
  }

  private async loadCandidatePreview(bundle: Readonly<AssetCandidateBundle>): Promise<void> {
    this.homeVisual?.destroy();
    this.shipRenderer?.destroy();
    this.shoalVisual?.image.destroy();
    this.homeVisual = undefined;
    this.shipRenderer = undefined;
    this.shoalVisual = undefined;
    for (const key of this.candidateTextureKeys) this.textures.remove(key);
    this.candidateTextureKeys = [];
    const textureKeys = new Map<string, string>();
    const requirements = new Map(candidateImageRequirements(bundle.metadata).map((requirement) => [requirement.imageId, requirement]));
    const loadErrors: string[] = [];
    const revision = ++this.candidateRevision;
    for (const [index, image] of bundle.images.entries()) {
      const requirement = requirements.get(image.imageId);
      if (!requirement) continue;
      const key = `wayfinders:candidate:${revision}:${index}`;
      textureKeys.set(image.imageId, key);
      this.candidateTextureKeys.push(key);
      if (requirement.role === "spritesheet" && requirement.frameSize) {
        this.load.spritesheet(key, image.dataUrl, {
          frameWidth: requirement.frameSize.width,
          frameHeight: requirement.frameSize.height,
        });
      } else {
        this.load.image(key, image.dataUrl);
      }
    }
    await new Promise<void>((resolve) => {
      const onError = (file: Phaser.Loader.File) => { loadErrors.push(file.key); };
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
        resolve();
      });
      this.load.start();
    });
    if (loadErrors.length > 0) throw new Error(`Candidate texture loading failed: ${loadErrors.join(", ")}`);
    this.previewAssets = new CandidateAssetRuntime(bundle.metadata, textureKeys);
    this.state.assetId = bundle.metadata.assetId;
    this.rebuildPreview();
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
      reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read PNG file")), { once: true });
      reader.readAsDataURL(file);
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private installDebugApi(): void {
    window.__WAYFINDERS_ASSET_VIEWER__ = {
      snapshot: () => Object.freeze({ ...this.state }),
      select: (assetId) => {
        if (!ASSET_IDS.includes(assetId)) return false;
        this.state.assetId = assetId;
        this.rebuildPreview();
        const select = document.querySelector<HTMLSelectElement>("[data-viewer=asset]");
        if (select) select.value = assetId;
        return true;
      },
      setHeading: (heading) => { this.state.heading = ((heading % 360) + 360) % 360; },
      setContrast: (fog, personal) => {
        this.state.showFog = fog;
        this.state.showPersonalOverlay = personal;
        this.drawContrast();
      },
      diagnostics: () => this.catalogAssets.diagnostics.map(({ assetId, message }) => `${assetId}: ${message}`),
    };
  }

  private onPointerWheel(
    _pointer: Phaser.Input.Pointer,
    _objects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void {
    this.changeZoom(deltaY > 0 ? -0.1 : 0.1);
  }

  private changeZoom(delta: number): void {
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom + delta, 0.55, 2.5));
  }

  private defaultZoom(): number {
    return Phaser.Math.Clamp(Math.min(this.scale.width / STAGE.width, this.scale.height / STAGE.height), 0.55, 1.25);
  }

  private onResize(): void {
    this.cameras.main.setZoom(this.defaultZoom());
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.homeVisual?.destroy();
    this.shipRenderer?.destroy();
    this.shoalVisual?.image.destroy();
    for (const key of this.candidateTextureKeys) this.textures.remove(key);
    this.candidateTextureKeys = [];
    delete window.__WAYFINDERS_ASSET_VIEWER__;
  }
}
