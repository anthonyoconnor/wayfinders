import Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  validateAuthoredAssetMetadata,
  type AuthoredAssetId,
  type AuthoredAssetMetadata,
  type AuthoredCollisionProfile,
} from "./AuthoredAssetContracts";
import {
  ASSET_CANDIDATE_BUNDLE_VERSION,
  CandidateAssetRuntime,
  candidateImageRequirements,
  mergeAssetCandidateMetadata,
  validateAssetCandidateBundle,
  type AssetCandidateBundle,
  type CandidateImage,
  type CandidateImageRequirement,
} from "./AssetCandidate";
import {
  ASSET_LIBRARY_CATALOG,
  ASSET_LIBRARY_GROUPS,
  assetLibraryEntryById,
  type AssetLibraryEntry,
  type AssetLibraryImageLayer,
  type ReferenceImageLibraryEntry,
  type ProductionCandidateLibraryEntry,
} from "./AssetLibraryCatalog";
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
import {
  applyCollisionCandidate,
  createCollisionCandidate,
  validateCollisionCandidateBundle,
  type AssetCollisionIntent,
  type CollisionCandidateBundle,
} from "./CollisionCandidate";
import {
  authoredAssetIdForCollisionObject,
  createCollisionAuthoringTarget,
  createCollisionAuthoringTargets,
  type CollisionAuthoringMetadataOverrides,
  type CollisionAuthoringTarget,
} from "./CollisionAuthoringTargets";
import {
  CollisionEditorModel,
  collisionBrushFootprint,
  createCollisionEditorBaseMasks,
  type CollisionEditorBrushSize,
  type CollisionEditorSelection,
  type CollisionEditorSnapshot,
  type CollisionEditorSubcellPoint,
} from "./CollisionEditorModel";
import { validateExactCollisionPackageSet } from "./ExactCollisionValidation";
import {
  PILOT_COLLISION_PROFILE_REGISTRY,
  RUNTIME_COLLISION_OBJECT_KINDS,
  type RuntimeCollisionObjectKind,
  type RuntimeCollisionProfile,
} from "./CollisionProfileRegistry";
import { ShipRenderer } from "../rendering/ShipRenderer";
import {
  COLLISION_SUBCELL_SIZE,
  COLLISION_SUBCELLS_PER_TILE,
  isCollisionSubcellSolid,
} from "../world/CollisionMask";
import homeIslandPackage from "./packages/home-island.json";
import playerBoatPackage from "./packages/player-boat.json";
import fishingShoalPackage from "./packages/fishing-shoal.json";
import {
  mountProductionAssetIntakeUi,
  PRODUCTION_ASSET_LIBRARY_SELECTION_KEY,
  type ProductionAssetIntakeUi,
} from "./ProductionAssetIntakeUi";

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
  selectCollisionTarget(objectKind: RuntimeCollisionObjectKind): boolean;
  collisionSnapshot(): Readonly<CollisionEditorSnapshot>;
  paintCollision(x: number, y: number, solid?: boolean): boolean;
  undoCollision(): boolean;
  redoCollision(): boolean;
  collisionProfile(): RuntimeCollisionProfile;
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

type CollisionTool = "paint" | "erase" | "flood-solid" | "flood-clear" | "select" | "pan";

interface CollisionPanGesture {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

const PLAYER_PROFILE = PILOT_COLLISION_PROFILE_REGISTRY.get("player-ship").profile;
const AUTHORITATIVE_SHIP_HALF_EXTENT = PLAYER_PROFILE.kind === "box"
  ? PLAYER_PROFILE.halfSize.width
  : 14;
const COLLISION_SAVE_ROUTE = "/__wayfinders/collision/save";
const ASSET_REVIEW_ROUTE = "/__wayfinders/assets/review";

type StandaloneLibraryEntry = ReferenceImageLibraryEntry | ProductionCandidateLibraryEntry;
type ProductionPreviewMode = "source" | "prepared" | "compare";
type ProductionReviewState = "pending" | "approved" | "rejected";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
  private collisionGraphics!: Phaser.GameObjects.Graphics;
  private developerVisualGraphics!: Phaser.GameObjects.Graphics;
  private contrastGraphics!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private placement!: Phaser.GameObjects.Text;
  private homeVisual?: AuthoredHomeIslandVisual;
  private shipRenderer?: ShipRenderer;
  private shoalVisual?: AuthoredFishingShoalVisual;
  private referenceVisual?: Phaser.GameObjects.Image;
  private comparisonVisual?: Phaser.GameObjects.Image;
  private additionalStandaloneVisuals: Phaser.GameObjects.Image[] = [];
  private assetLibraryBrowser?: HTMLElement;
  private productionIntakeUi?: ProductionAssetIntakeUi;
  private selectedLibraryAssetId: string = AUTHORED_ASSET_IDS.homeIsland;
  private readonly acceptedMetadataByAssetId = new Map<AuthoredAssetId, Readonly<AuthoredAssetMetadata>>();
  private readonly collisionDraftsByAssetId = new Map<AuthoredAssetId, RuntimeCollisionProfile>();
  private referenceLoadRevision = 0;
  private loadedReferenceTextureKeys: string[] = [];
  private readonly productionPreviewModes = new Map<string, ProductionPreviewMode>();
  private readonly productionCompareOpacity = new Map<string, number>();
  private readonly productionReviewStates = new Map<string, ProductionReviewState>();
  private readonly layerVisibility = new Map<string, boolean>();
  private readonly layerOpacity = new Map<string, number>();
  private productionReviewInFlight = false;
  private collisionSaveInFlight = false;
  private controlsAbort?: AbortController;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private zoomIn?: Phaser.Input.Keyboard.Key;
  private zoomOut?: Phaser.Input.Keyboard.Key;
  private validatedCandidate?: Readonly<AssetCandidateBundle>;
  private candidateTextureKeys: string[] = [];
  private candidateRevision = 0;
  private collisionTarget!: Readonly<CollisionAuthoringTarget>;
  private collisionModel!: CollisionEditorModel;
  private collisionAcceptedMetadata?: Readonly<AuthoredAssetMetadata>;
  private validatedCollisionCandidate?: Readonly<CollisionCandidateBundle>;
  private collisionTool: CollisionTool = "paint";
  private collisionBrushSize: CollisionEditorBrushSize = 1;
  private collisionSelection?: Readonly<CollisionEditorSelection>;
  private collisionSelectionStart?: Readonly<CollisionEditorSubcellPoint>;
  private collisionHover?: Readonly<CollisionEditorSubcellPoint>;
  private collisionProbeWorld?: Readonly<{ x: number; y: number }>;
  private collisionStrokePoints?: Map<string, CollisionEditorSubcellPoint>;
  private collisionPanGesture?: Readonly<CollisionPanGesture>;
  private collisionSpaceHeld = false;

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
    this.collisionGraphics = this.add.graphics().setDepth(82);
    this.developerVisualGraphics = this.add.graphics().setDepth(10);
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

    const initialMetadata = this.catalogAssets.metadata(AUTHORED_ASSET_IDS.homeIsland);
    if (!initialMetadata) throw new Error("The home-island package is unavailable to collision authoring");
    for (const assetId of ASSET_IDS) {
      const metadata = this.catalogAssets.metadata(assetId);
      if (metadata) this.acceptedMetadataByAssetId.set(assetId, metadata);
    }
    this.activateCollisionTarget("home-island", initialMetadata, initialMetadata, false);
    const restoredLibraryAssetId = sessionStorage.getItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY);
    if (restoredLibraryAssetId && assetLibraryEntryById(restoredLibraryAssetId)) {
      this.selectedLibraryAssetId = restoredLibraryAssetId;
    }
    sessionStorage.removeItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY);

    this.cameras.main.setBounds(0, 0, STAGE.width, STAGE.height).centerOn(STAGE.centerX, STAGE.centerY);
    this.cameras.main.setZoom(this.defaultZoom());
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onCollisionPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onCollisionPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onCollisionPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onCollisionPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.zoomIn = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.zoomOut = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.mountControls();
    this.installDebugApi();
    this.rebuildPreview();

    const sceneStatus = document.querySelector<HTMLElement>("#scene-status");
    if (sceneStatus) sceneStatus.textContent = "Runtime asset viewer and collision authoring active";
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "Collision authoring · wheel or Q/E zoom · arrows or Pan tool move";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  override update(_time: number, delta: number): void {
    if (!this.domControlsFocused()) {
      const pan = 0.42 * delta / this.cameras.main.zoom;
      if (this.cursors?.left.isDown) this.cameras.main.scrollX -= pan;
      if (this.cursors?.right.isDown) this.cameras.main.scrollX += pan;
      if (this.cursors?.up.isDown) this.cameras.main.scrollY -= pan;
      if (this.cursors?.down.isDown) this.cameras.main.scrollY += pan;
      if (this.zoomIn && Phaser.Input.Keyboard.JustDown(this.zoomIn)) this.changeZoom(0.1);
      if (this.zoomOut && Phaser.Input.Keyboard.JustDown(this.zoomOut)) this.changeZoom(-0.1);
    }
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
    }
  }

  private drawWaterGrid(): void {
    const grid = this.add.graphics().setDepth(-10);
    grid.lineStyle(1, 0x8bd0cf, 0.1);
    for (let x = 0; x <= STAGE.width; x += 32) grid.lineBetween(x, 0, x, STAGE.height);
    for (let y = 0; y <= STAGE.height; y += 32) grid.lineBetween(0, y, STAGE.width, y);
  }

  private libraryTextureKey(assetId: string, variant = "primary"): string {
    return `wayfinders:library:${assetId}:${variant}`;
  }

  private selectedLibraryEntry(): Readonly<AssetLibraryEntry> {
    const entry = assetLibraryEntryById(this.selectedLibraryAssetId);
    if (!entry) throw new RangeError(`Unknown asset library entry ${this.selectedLibraryAssetId}`);
    return entry;
  }

  private selectedReferenceEntry(): Readonly<ReferenceImageLibraryEntry> | undefined {
    const entry = this.selectedLibraryEntry();
    return entry.entryType === "reference-image" ? entry : undefined;
  }

  private selectedStandaloneEntry(): Readonly<StandaloneLibraryEntry> | undefined {
    const entry = this.selectedLibraryEntry();
    return entry.entryType === "authored-package" ? undefined : entry;
  }

  private selectedProductionCandidate(): Readonly<ProductionCandidateLibraryEntry> | undefined {
    const entry = this.selectedLibraryEntry();
    return entry.entryType === "production-candidate" ? entry : undefined;
  }

  private acceptedMetadata(assetId: AuthoredAssetId): Readonly<AuthoredAssetMetadata> | undefined {
    return this.acceptedMetadataByAssetId.get(assetId) ?? this.catalogAssets.metadata(assetId);
  }

  private releaseReferenceTexture(exceptKeys: readonly string[] = []): void {
    const retained = new Set(exceptKeys);
    for (const key of this.loadedReferenceTextureKeys) {
      if (!retained.has(key) && this.textures.exists(key)) this.textures.remove(key);
    }
    this.loadedReferenceTextureKeys = this.loadedReferenceTextureKeys.filter((key) => retained.has(key));
  }

  private standaloneTextureSources(entry: Readonly<StandaloneLibraryEntry>): readonly Readonly<{
    key: string;
    url: string;
  }>[] {
    if (entry.entryType === "production-candidate") {
      if (entry.sourceLayers.length === 0 || entry.candidateLayers.length === 0) {
        throw new RangeError(`${entry.id} needs source and prepared preview layers`);
      }
      return [...entry.sourceLayers, ...entry.candidateLayers].map((layer) => ({
        key: this.libraryTextureKey(entry.id, layer.id),
        url: layer.url,
      }));
    }
    const layer = entry.layers[0];
    if (!layer) throw new RangeError(`${entry.id} has no preview layer`);
    return [{ key: this.libraryTextureKey(entry.id, "reference"), url: layer.url }];
  }

  private beginReferencePreviewLoad(entry: Readonly<StandaloneLibraryEntry>): void {
    const revision = ++this.referenceLoadRevision;
    const sources = this.standaloneTextureSources(entry);
    const keys = sources.map(({ key }) => key);
    this.rebuildPreview();
    if (keys.every((key) => this.textures.exists(key))) {
      this.releaseReferenceTexture(keys);
      this.loadedReferenceTextureKeys = [...keys];
      this.rebuildPreview();
      this.fitSelectedLibraryAsset();
      return;
    }

    const pending = sources
      .filter(({ key }) => !this.textures.exists(key))
      .map(({ key, url }) => new Promise<Readonly<{ key: string; image: HTMLImageElement }>>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.addEventListener("load", () => resolve({ key, image }), { once: true });
        image.addEventListener("error", () => reject(new Error(`Could not load ${url}`)), { once: true });
        image.src = url;
      }));
    void Promise.all(pending).then((loaded) => {
      if (revision !== this.referenceLoadRevision || this.selectedLibraryAssetId !== entry.id) return;
      this.referenceVisual?.destroy();
      this.comparisonVisual?.destroy();
      for (const visual of this.additionalStandaloneVisuals) visual.destroy();
      this.referenceVisual = undefined;
      this.comparisonVisual = undefined;
      this.additionalStandaloneVisuals = [];
      this.releaseReferenceTexture(keys);
      for (const { key, image } of loaded) {
        if (!this.textures.exists(key)) this.textures.addImage(key, image);
      }
      this.loadedReferenceTextureKeys = [...keys];
      this.rebuildPreview();
      this.fitSelectedLibraryAsset();
    }).catch(() => {
      if (revision !== this.referenceLoadRevision || this.selectedLibraryAssetId !== entry.id) return;
      this.title.setText(entry.name);
      this.placement.setText("Asset preview could not be loaded");
    });
  }

  private layerStateKey(entryId: string, layerId: string): string {
    return `${entryId}:${layerId}`;
  }

  private layerIsVisible(entryId: string, layer: Readonly<{ id: string; defaultVisible: boolean }>): boolean {
    return this.layerVisibility.get(this.layerStateKey(entryId, layer.id)) ?? layer.defaultVisible;
  }

  private layerAlpha(entryId: string, layer: Readonly<{ id: string; opacity: number }>): number {
    return this.layerOpacity.get(this.layerStateKey(entryId, layer.id)) ?? layer.opacity;
  }

  private createStandaloneVisual(
    textureKey: string,
    x: number,
    maximumWidth: number,
    maximumHeight: number,
    alpha = 1,
  ): Phaser.GameObjects.Image {
    const texture = this.textures.get(textureKey);
    const source = texture.getSourceImage() as { width?: number; height?: number } | undefined;
    const width = source?.width ?? 1;
    const height = source?.height ?? 1;
    const scale = Math.min(maximumWidth / width, maximumHeight / height, 1);
    return this.add.image(x, STAGE.centerY + 22, textureKey).setDepth(5).setScale(scale).setAlpha(alpha);
  }

  private phaserBlendMode(blendMode: Readonly<AssetLibraryImageLayer>["blendMode"]): number {
    switch (blendMode) {
      case "multiply": return Phaser.BlendModes.MULTIPLY;
      case "screen": return Phaser.BlendModes.SCREEN;
      case "add": return Phaser.BlendModes.ADD;
      case "normal": return Phaser.BlendModes.NORMAL;
    }
  }

  private createStandaloneLayerStack(
    entryId: string,
    layers: readonly Readonly<AssetLibraryImageLayer>[],
    x: number,
    maximumWidth: number,
    maximumHeight: number,
    editable: boolean,
    alphaMultiplier = 1,
  ): Phaser.GameObjects.Image[] {
    const ordered = [...layers].sort((left, right) => left.order - right.order);
    const dimensions = ordered.map((layer) => {
      const texture = this.textures.get(this.libraryTextureKey(entryId, layer.id));
      const source = texture.getSourceImage() as { width?: number; height?: number } | undefined;
      return { width: source?.width ?? 1, height: source?.height ?? 1 };
    });
    const contentWidth = Math.max(...dimensions.map(({ width }) => width), 1);
    const contentHeight = Math.max(...dimensions.map(({ height }) => height), 1);
    const scale = Math.min(maximumWidth / contentWidth, maximumHeight / contentHeight, 1);
    return ordered.map((layer, index) => this.add.image(
      x,
      STAGE.centerY + 22,
      this.libraryTextureKey(entryId, layer.id),
    )
      .setDepth(5 + index * 0.01)
      .setScale(scale)
      .setBlendMode(this.phaserBlendMode(layer.blendMode))
      .setVisible(editable ? this.layerIsVisible(entryId, layer) : layer.defaultVisible)
      .setAlpha((editable ? this.layerAlpha(entryId, layer) : layer.opacity) * alphaMultiplier));
  }

  private drawProductionCollisionOverlay(
    entry: Readonly<ProductionCandidateLibraryEntry>,
    visual?: Phaser.GameObjects.Image,
  ): void {
    const graphics = this.collisionGraphics.clear();
    if (!this.state.showFootprint || !visual?.visible) return;
    if (entry.collisionDraft.kind !== "hybrid-grid-draft") return;
    const bounds = visual.getBounds();
    const { grid } = entry.collisionDraft;
    const subcellWidth = bounds.width / grid.subcellColumns;
    const subcellHeight = bounds.height / grid.subcellRows;
    graphics.fillStyle(0xff4e4e, 0.32);
    for (const solid of entry.collisionDraft.solidSubcells) {
      graphics.fillRect(
        bounds.left + solid.x * subcellWidth,
        bounds.top + solid.y * subcellHeight,
        subcellWidth,
        subcellHeight,
      );
    }
    graphics.lineStyle(1, 0xa4d9d3, 0.18);
    for (let x = 0; x <= grid.subcellColumns; x++) {
      const worldX = bounds.left + x * subcellWidth;
      graphics.lineBetween(worldX, bounds.top, worldX, bounds.bottom);
    }
    for (let y = 0; y <= grid.subcellRows; y++) {
      const worldY = bounds.top + y * subcellHeight;
      graphics.lineBetween(bounds.left, worldY, bounds.right, worldY);
    }
    graphics.lineStyle(2, 0x45d584, 0.78);
    for (let x = 0; x <= grid.width; x++) {
      const worldX = bounds.left + x * (bounds.width / grid.width);
      graphics.lineBetween(worldX, bounds.top, worldX, bounds.bottom);
    }
    for (let y = 0; y <= grid.height; y++) {
      const worldY = bounds.top + y * (bounds.height / grid.height);
      graphics.lineBetween(bounds.left, worldY, bounds.right, worldY);
    }
  }

  private rebuildStandalonePreview(entry: Readonly<StandaloneLibraryEntry>): void {
    const sources = this.standaloneTextureSources(entry);
    if (!sources.every(({ key }) => this.textures.exists(key))) {
      this.title.setText(entry.name);
      this.placement.setText("Loading asset preview\u2026");
      this.guideGraphics.clear();
      this.collisionGraphics.clear();
      this.drawContrast();
      this.syncSelectedAssetUi();
      return;
    }

    this.guideGraphics.clear();
    this.collisionGraphics.clear();
    this.title.setText(entry.name);
    if (entry.entryType === "reference-image") {
      const layer = entry.layers[0];
      const key = sources[0].key;
      this.referenceVisual = this.createStandaloneVisual(key, STAGE.centerX, STAGE.width - 220, STAGE.height - 140);
      this.referenceVisual
        .setVisible(this.layerIsVisible(entry.id, layer))
        .setAlpha(this.layerAlpha(entry.id, layer));
      const source = this.textures.get(key).getSourceImage() as { width?: number; height?: number } | undefined;
      const settlement = entry.reference.settlement ? ` \u00b7 ${entry.reference.settlement}` : "";
      this.placement.setText(
        `Source reference \u00b7 ${source?.width ?? 1}\u00d7${source?.height ?? 1} px${settlement} \u00b7 ${entry.reference.kind}`,
      );
    } else {
      const mode = this.productionPreviewModes.get(entry.id) ?? "prepared";
      let preparedVisual: Phaser.GameObjects.Image | undefined;
      if (mode === "compare") {
        const sourceStack = this.createStandaloneLayerStack(
          entry.id,
          entry.sourceLayers,
          350,
          430,
          STAGE.height - 150,
          false,
        );
        const preparedStack = this.createStandaloneLayerStack(
          entry.id,
          entry.candidateLayers,
          850,
          430,
          STAGE.height - 150,
          true,
          this.productionCompareOpacity.get(entry.id) ?? 1,
        );
        this.referenceVisual = sourceStack[0];
        preparedVisual = preparedStack[0];
        this.comparisonVisual = preparedVisual;
        this.additionalStandaloneVisuals.push(...sourceStack.slice(1), ...preparedStack.slice(1));
        this.placement.setText("Source on left \u00b7 prepared candidate on right \u00b7 collision draft overlays prepared art");
      } else if (mode === "source") {
        const sourceStack = this.createStandaloneLayerStack(
          entry.id,
          entry.sourceLayers,
          STAGE.centerX,
          STAGE.width - 220,
          STAGE.height - 140,
          false,
        );
        this.referenceVisual = sourceStack[0];
        this.additionalStandaloneVisuals.push(...sourceStack.slice(1));
        this.placement.setText("Original selected source \u00b7 no runtime files changed");
      } else {
        const preparedStack = this.createStandaloneLayerStack(
          entry.id,
          entry.candidateLayers,
          STAGE.centerX,
          STAGE.width - 220,
          STAGE.height - 140,
          true,
        );
        preparedVisual = preparedStack[0];
        this.referenceVisual = preparedVisual;
        this.additionalStandaloneVisuals.push(...preparedStack.slice(1));
        this.placement.setText("Deterministically prepared candidate \u00b7 visual test keeps accepted runtime collision");
      }
      this.drawProductionCollisionOverlay(entry, preparedVisual);
    }
    this.drawContrast();
    this.syncSelectedAssetUi();
  }

  private rebuildPreview(): void {
    this.homeVisual?.destroy();
    this.shipRenderer?.destroy();
    this.shoalVisual?.image.destroy();
    this.referenceVisual?.destroy();
    this.comparisonVisual?.destroy();
    for (const visual of this.additionalStandaloneVisuals) visual.destroy();
    this.homeVisual = undefined;
    this.shipRenderer = undefined;
    this.shoalVisual = undefined;
    this.referenceVisual = undefined;
    this.comparisonVisual = undefined;
    this.additionalStandaloneVisuals = [];
    this.developerVisualGraphics.clear();

    const standalone = this.selectedStandaloneEntry();
    if (standalone) {
      this.rebuildStandalonePreview(standalone);
      return;
    }

    const reference = this.selectedReferenceEntry();
    if (reference) {
      const textureKey = this.libraryTextureKey(reference.id);
      if (!this.textures.exists(textureKey)) {
        this.title.setText(reference.name);
        this.placement.setText("Loading source reference\u2026");
        this.guideGraphics.clear();
        this.collisionGraphics.clear();
        this.drawContrast();
        this.syncSelectedAssetUi();
        return;
      }
      const texture = this.textures.get(textureKey);
      const source = texture.getSourceImage() as { width?: number; height?: number } | undefined;
      const width = source?.width ?? 1;
      const height = source?.height ?? 1;
      const scale = Math.min((STAGE.width - 220) / width, (STAGE.height - 140) / height, 1);
      this.referenceVisual = this.add.image(STAGE.centerX, STAGE.centerY + 22, textureKey)
        .setDepth(5)
        .setScale(scale);
      this.title.setText(reference.name);
      this.placement.setText(
        `Source reference · ${width}×${height} px · ${reference.reference.settlement} · matte background`,
      );
      this.guideGraphics.clear();
      this.collisionGraphics.clear();
      this.drawContrast();
      this.syncSelectedAssetUi();
      return;
    }

    this.releaseReferenceTexture();

    if (!this.collisionTarget.packageMetadata) {
      this.drawDeveloperVisual();
    } else if (this.state.assetId === AUTHORED_ASSET_IDS.homeIsland) {
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
    this.title.setText(`${this.collisionTarget.label} · ${this.collisionTarget.objectKind}`);
    this.updatePlacementLabel();
    this.drawGuides();
    this.drawContrast();
    this.syncSelectedAssetUi();
  }

  private drawGuides(): void {
    this.guideGraphics.clear();
    const candidate = this.selectedProductionCandidate();
    if (candidate) {
      this.drawProductionCollisionOverlay(candidate, this.comparisonVisual ?? this.referenceVisual);
      return;
    }
    if (this.selectedReferenceEntry()) {
      this.collisionGraphics.clear();
      return;
    }
    this.drawCollisionOverlay();
  }

  private activateCollisionTarget(
    objectKind: RuntimeCollisionObjectKind,
    metadata?: Readonly<AuthoredAssetMetadata>,
    acceptedMetadata?: Readonly<AuthoredAssetMetadata>,
    rebuild = true,
  ): void {
    const expectedAssetId = authoredAssetIdForCollisionObject(objectKind);
    if (metadata && metadata.assetId !== expectedAssetId) {
      throw new RangeError(`${objectKind} cannot use authored metadata ${metadata.assetId}`);
    }
    const overrides = metadata ? this.collisionOverrides(metadata) : {};
    const target = createCollisionAuthoringTarget(objectKind, overrides);
    this.collisionTarget = target;
    this.collisionModel = this.createCollisionModel(target);
    this.collisionAcceptedMetadata = acceptedMetadata
      ?? (expectedAssetId ? this.acceptedMetadata(expectedAssetId) : undefined);
    this.validatedCollisionCandidate = undefined;
    this.collisionSelection = undefined;
    this.collisionSelectionStart = undefined;
    this.collisionHover = undefined;
    this.collisionStrokePoints = undefined;
    this.collisionPanGesture = undefined;

    const rect = this.collisionAssetRect();
    const probeAnchor = target.anchors.find(({ requiredClearance }) => requiredClearance)
      ?? target.anchors[0];
    this.collisionProbeWorld = probeAnchor
      ? {
        x: rect.left + (probeAnchor.x + 0.5) * target.tileSize,
        y: rect.top + (probeAnchor.y + 0.5) * target.tileSize,
      }
      : { x: STAGE.centerX, y: STAGE.centerY };

    if (expectedAssetId) {
      this.state.assetId = expectedAssetId;
      this.selectedLibraryAssetId = expectedAssetId;
    }
    if (rebuild) this.rebuildPreview();
    else this.drawGuides();
    this.syncCollisionControls();
    this.syncPackageSelectors();
  }

  private stashCurrentCollisionDraft(): void {
    if (!this.collisionModel || !this.collisionTarget) return;
    const assetId = authoredAssetIdForCollisionObject(this.collisionTarget.objectKind);
    if (!assetId) return;
    const snapshot = this.collisionModel.snapshot();
    if (snapshot.dirty) this.collisionDraftsByAssetId.set(assetId, snapshot.profile);
    else this.collisionDraftsByAssetId.delete(assetId);
  }

  private restoreCollisionDraft(assetId: AuthoredAssetId): void {
    const draft = this.collisionDraftsByAssetId.get(assetId);
    if (!draft || !this.collisionModel.snapshot().editable) return;
    const snapshot = this.collisionModel.snapshot();
    if (snapshot.masks && (draft.kind === "hybrid-grid" || draft.kind === "coarse-grid")) {
      const grid = {
        width: this.collisionTarget.width,
        height: this.collisionTarget.height,
        tileSize: COLLISION_SUBCELL_SIZE * COLLISION_SUBCELLS_PER_TILE,
        subcellSize: COLLISION_SUBCELL_SIZE,
        coarseMasks: Object.freeze(Array.from(this.collisionTarget.baseMasks)),
      };
      const desired = createCollisionEditorBaseMasks(grid, draft);
      const solid: CollisionEditorSubcellPoint[] = [];
      const clear: CollisionEditorSubcellPoint[] = [];
      for (let cellY = 0; cellY < grid.height; cellY++) {
        for (let cellX = 0; cellX < grid.width; cellX++) {
          const index = cellY * grid.width + cellX;
          for (let localY = 0; localY < COLLISION_SUBCELLS_PER_TILE; localY++) {
            for (let localX = 0; localX < COLLISION_SUBCELLS_PER_TILE; localX++) {
              const currentSolid = isCollisionSubcellSolid(snapshot.masks[index], localX, localY);
              const desiredSolid = isCollisionSubcellSolid(desired[index], localX, localY);
              if (currentSolid === desiredSolid) continue;
              const point = {
                x: cellX * COLLISION_SUBCELLS_PER_TILE + localX,
                y: cellY * COLLISION_SUBCELLS_PER_TILE + localY,
              };
              (desiredSolid ? solid : clear).push(point);
            }
          }
        }
      }
      if (clear.length > 0) this.collisionModel.eraseStroke(clear);
      if (solid.length > 0) this.collisionModel.paintStroke(solid);
    } else if (draft.kind === "box") {
      this.collisionModel.setBox(draft);
    } else if (draft.kind === "empty") {
      this.collisionModel.setExplicitEmpty();
    }
    this.validatedCollisionCandidate = undefined;
  }

  private collisionOverrides(
    metadata: Readonly<AuthoredAssetMetadata>,
  ): CollisionAuthoringMetadataOverrides {
    switch (metadata.kind) {
      case "home-island": return { homeIsland: metadata };
      case "player-boat": return { playerBoat: metadata };
      case "fishing-shoal": return { fishingShoal: metadata };
    }
  }

  private createCollisionModel(target: Readonly<CollisionAuthoringTarget>): CollisionEditorModel {
    const fineGridCompatible = target.tileSize === COLLISION_SUBCELL_SIZE * COLLISION_SUBCELLS_PER_TILE;
    const editable = target.editing !== "read-only"
      && (target.editing !== "hybrid-grid" || fineGridCompatible);
    if (target.profile.kind === "hybrid-grid" || target.profile.kind === "coarse-grid") {
      const grid = {
        width: target.width,
        height: target.height,
        // Read-only legacy coarse packages may use another display cell size;
        // the model needs only a normalized 32/8 mask lattice in that case.
        tileSize: COLLISION_SUBCELL_SIZE * COLLISION_SUBCELLS_PER_TILE,
        subcellSize: COLLISION_SUBCELL_SIZE,
        coarseMasks: Object.freeze(Array.from(target.baseMasks)),
      };
      return new CollisionEditorModel({
        objectKind: target.objectKind,
        editable,
        grid,
        baseMasks: Array.from(createCollisionEditorBaseMasks(grid, target.profile)),
        profile: target.profile,
      });
    }
    return new CollisionEditorModel({
      objectKind: target.objectKind,
      editable,
      profile: target.profile,
    });
  }

  private collisionAssetRect(): Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
  }> {
    const width = this.collisionTarget.width * this.collisionTarget.tileSize;
    const height = this.collisionTarget.height * this.collisionTarget.tileSize;
    return Object.freeze({
      left: STAGE.centerX - width / 2,
      top: STAGE.centerY - height / 2,
      width,
      height,
    });
  }

  private drawCollisionOverlay(): void {
    const graphics = this.collisionGraphics.clear();
    if (!this.collisionTarget || !this.collisionModel) return;
    const target = this.collisionTarget;
    const snapshot = this.collisionModel.snapshot();
    const rect = this.collisionAssetRect();
    const displaySubcellSize = target.tileSize / COLLISION_SUBCELLS_PER_TILE;

    if (snapshot.masks) {
      graphics.fillStyle(0xff4e4e, 0.26);
      for (let cellY = 0; cellY < target.height; cellY++) {
        for (let cellX = 0; cellX < target.width; cellX++) {
          const mask = snapshot.masks[cellY * target.width + cellX];
          for (let subY = 0; subY < COLLISION_SUBCELLS_PER_TILE; subY++) {
            for (let subX = 0; subX < COLLISION_SUBCELLS_PER_TILE; subX++) {
              if (!isCollisionSubcellSolid(mask, subX, subY)) continue;
              graphics.fillRect(
                rect.left + cellX * target.tileSize + subX * displaySubcellSize,
                rect.top + cellY * target.tileSize + subY * displaySubcellSize,
                displaySubcellSize,
                displaySubcellSize,
              );
            }
          }
        }
      }
      graphics.lineStyle(1, 0xa4d9d3, 0.18);
      const subcellWidth = target.width * COLLISION_SUBCELLS_PER_TILE;
      const subcellHeight = target.height * COLLISION_SUBCELLS_PER_TILE;
      for (let x = 0; x <= subcellWidth; x++) {
        const worldX = rect.left + x * displaySubcellSize;
        graphics.lineBetween(worldX, rect.top, worldX, rect.top + rect.height);
      }
      for (let y = 0; y <= subcellHeight; y++) {
        const worldY = rect.top + y * displaySubcellSize;
        graphics.lineBetween(rect.left, worldY, rect.left + rect.width, worldY);
      }
    } else if (snapshot.profile.kind === "box") {
      const profile = snapshot.profile;
      const left = STAGE.centerX + profile.offset.x - profile.halfSize.width;
      const top = STAGE.centerY + profile.offset.y - profile.halfSize.height;
      graphics.fillStyle(0xff4e4e, 0.24).fillRect(
        left,
        top,
        profile.halfSize.width * 2,
        profile.halfSize.height * 2,
      );
      graphics.lineStyle(2, 0xff6f66, 0.95).strokeRect(
        left,
        top,
        profile.halfSize.width * 2,
        profile.halfSize.height * 2,
      );
    }

    graphics.lineStyle(2, 0x45d584, 0.78);
    for (let x = 0; x <= target.width; x++) {
      const worldX = rect.left + x * target.tileSize;
      graphics.lineBetween(worldX, rect.top, worldX, rect.top + rect.height);
    }
    for (let y = 0; y <= target.height; y++) {
      const worldY = rect.top + y * target.tileSize;
      graphics.lineBetween(rect.left, worldY, rect.left + rect.width, worldY);
    }

    if (this.state.showFootprint) {
      graphics.lineStyle(2, 0x83fff0, 0.8).strokeRect(
        STAGE.centerX - target.visualBounds.width / 2,
        STAGE.centerY - target.visualBounds.height / 2,
        target.visualBounds.width,
        target.visualBounds.height,
      );
      for (const anchor of target.anchors) {
        const x = rect.left + (anchor.x + 0.5) * target.tileSize;
        const y = rect.top + (anchor.y + 0.5) * target.tileSize;
        graphics.fillStyle(anchor.requiredClearance ? 0xffd47a : 0xf1f6c7, 0.95).fillCircle(x, y, 4);
        graphics.lineStyle(1, 0x041419, 0.9).strokeCircle(x, y, 5);
      }
    }

    if (this.state.showOrigin) {
      let originX = STAGE.centerX;
      let originY = STAGE.centerY;
      const metadata = target.packageMetadata;
      if (metadata?.kind === "home-island") {
        originX = rect.left + (metadata.grid.placementOrigin.x + 0.5) * target.tileSize;
        originY = rect.top + (metadata.grid.placementOrigin.y + 0.5) * target.tileSize;
      }
      graphics.lineStyle(2, 0xffd47a, 0.95);
      graphics.lineBetween(originX - 14, originY, originX + 14, originY);
      graphics.lineBetween(originX, originY - 14, originX, originY + 14);
      graphics.strokeCircle(originX, originY, 5);
    }

    if (this.collisionSelection) {
      const selection = this.collisionSelection;
      graphics.fillStyle(0x4bd6ff, 0.12).fillRect(
        rect.left + selection.x * displaySubcellSize,
        rect.top + selection.y * displaySubcellSize,
        selection.width * displaySubcellSize,
        selection.height * displaySubcellSize,
      );
      graphics.lineStyle(2, 0x4bd6ff, 0.95).strokeRect(
        rect.left + selection.x * displaySubcellSize,
        rect.top + selection.y * displaySubcellSize,
        selection.width * displaySubcellSize,
        selection.height * displaySubcellSize,
      );
    }
    if (this.collisionHover && snapshot.masks) {
      const hoverBrushSize = this.collisionTool === "paint" || this.collisionTool === "erase"
        ? this.collisionBrushSize
        : 1;
      const hoverPoints = collisionBrushFootprint(
        this.collisionHover,
        hoverBrushSize,
        target.width * COLLISION_SUBCELLS_PER_TILE,
        target.height * COLLISION_SUBCELLS_PER_TILE,
      );
      const first = hoverPoints[0];
      graphics.lineStyle(2, 0xfff2a8, 0.95).strokeRect(
        rect.left + first.x * displaySubcellSize,
        rect.top + first.y * displaySubcellSize,
        hoverBrushSize * displaySubcellSize,
        hoverBrushSize * displaySubcellSize,
      );
    }
    if (this.collisionStrokePoints) {
      const solid = this.collisionTool === "paint";
      graphics.fillStyle(solid ? 0xff7b5e : 0x5ec8ff, 0.58);
      for (const point of this.collisionStrokePoints.values()) {
        graphics.fillRect(
          rect.left + point.x * displaySubcellSize,
          rect.top + point.y * displaySubcellSize,
          displaySubcellSize,
          displaySubcellSize,
        );
      }
    }

    const probeWorld = this.collisionProbeWorld ?? { x: STAGE.centerX, y: STAGE.centerY };
    const modelScale = snapshot.masks ? 32 / target.tileSize : 1;
    const probeInput = snapshot.masks
      ? {
        centerX: (probeWorld.x - rect.left) * modelScale,
        centerY: (probeWorld.y - rect.top) * modelScale,
      }
      : { centerX: probeWorld.x - STAGE.centerX, centerY: probeWorld.y - STAGE.centerY };
    const probe = this.collisionModel.probeHull({
      ...probeInput,
      halfWidth: AUTHORITATIVE_SHIP_HALF_EXTENT * modelScale,
      outsideIsSolid: false,
    });
    graphics.fillStyle(probe.collides ? 0xff4949 : 0x53e18d, 0.12).fillRect(
      probeWorld.x - AUTHORITATIVE_SHIP_HALF_EXTENT,
      probeWorld.y - AUTHORITATIVE_SHIP_HALF_EXTENT,
      AUTHORITATIVE_SHIP_HALF_EXTENT * 2,
      AUTHORITATIVE_SHIP_HALF_EXTENT * 2,
    );
    graphics.lineStyle(2, probe.collides ? 0xff4949 : 0x53e18d, 0.95).strokeRect(
      probeWorld.x - AUTHORITATIVE_SHIP_HALF_EXTENT,
      probeWorld.y - AUTHORITATIVE_SHIP_HALF_EXTENT,
      AUTHORITATIVE_SHIP_HALF_EXTENT * 2,
      AUTHORITATIVE_SHIP_HALF_EXTENT * 2,
    );
  }

  private drawDeveloperVisual(): void {
    const graphics = this.developerVisualGraphics.clear();
    const target = this.collisionTarget;
    const rect = this.collisionAssetRect();
    switch (target.objectKind) {
      case "generated-island":
        graphics.fillStyle(0x7da353, 0.76);
        for (let y = 0; y < target.height; y++) {
          for (let x = 0; x < target.width; x++) {
            if (target.baseMasks[y * target.width + x] === 0) continue;
            graphics.fillRect(
              rect.left + x * target.tileSize,
              rect.top + y * target.tileSize,
              target.tileSize,
              target.tileSize,
            );
          }
        }
        break;
      case "wreck":
        graphics.fillStyle(0x8a654c, 0.9).fillTriangle(
          STAGE.centerX - 30,
          STAGE.centerY + 10,
          STAGE.centerX + 30,
          STAGE.centerY - 12,
          STAGE.centerX + 18,
          STAGE.centerY + 18,
        );
        graphics.lineStyle(3, 0xe0bd83, 0.8).lineBetween(
          STAGE.centerX - 8,
          STAGE.centerY - 28,
          STAGE.centerX + 3,
          STAGE.centerY + 13,
        );
        break;
      case "survey-site":
        graphics.fillStyle(0xe1af5a, 0.88).fillCircle(STAGE.centerX, STAGE.centerY, 14);
        graphics.lineStyle(3, 0x4c2c23, 0.9).strokeCircle(STAGE.centerX, STAGE.centerY, 14);
        break;
      case "survey-service":
      case "island-approach":
      case "home-dock":
        graphics.fillStyle(0xffd47a, 0.85).fillCircle(STAGE.centerX, STAGE.centerY, 8);
        graphics.lineStyle(3, 0x4bd6ff, 0.9);
        graphics.lineBetween(STAGE.centerX - 14, STAGE.centerY, STAGE.centerX + 14, STAGE.centerY);
        graphics.lineBetween(STAGE.centerX, STAGE.centerY - 14, STAGE.centerX, STAGE.centerY + 14);
        break;
    }
  }

  private collisionSubcellAt(worldX: number, worldY: number): CollisionEditorSubcellPoint | undefined {
    const snapshot = this.collisionModel.snapshot();
    if (!snapshot.masks) return undefined;
    const rect = this.collisionAssetRect();
    const displaySubcellSize = this.collisionTarget.tileSize / COLLISION_SUBCELLS_PER_TILE;
    const x = Math.floor((worldX - rect.left) / displaySubcellSize);
    const y = Math.floor((worldY - rect.top) / displaySubcellSize);
    if (
      x < 0
      || y < 0
      || x >= this.collisionTarget.width * COLLISION_SUBCELLS_PER_TILE
      || y >= this.collisionTarget.height * COLLISION_SUBCELLS_PER_TILE
    ) return undefined;
    return Object.freeze({ x, y });
  }

  private collisionBrushPoints(
    point: Readonly<CollisionEditorSubcellPoint>,
  ): readonly Readonly<CollisionEditorSubcellPoint>[] {
    return collisionBrushFootprint(
      point,
      this.collisionBrushSize,
      this.collisionTarget.width * COLLISION_SUBCELLS_PER_TILE,
      this.collisionTarget.height * COLLISION_SUBCELLS_PER_TILE,
    );
  }

  private onCollisionPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.selectedStandaloneEntry() || this.collisionSaveInFlight) return;
    this.collisionProbeWorld = Object.freeze({ x: pointer.worldX, y: pointer.worldY });
    if (pointer.button === 1 || this.collisionSpaceHeld || this.collisionTool === "pan") {
      this.collisionPanGesture = Object.freeze({
        pointerX: pointer.x,
        pointerY: pointer.y,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
      });
      return;
    }
    if (this.collisionTarget.editing !== "hybrid-grid" || !this.collisionModel.snapshot().editable) {
      this.drawGuides();
      return;
    }
    const point = this.collisionSubcellAt(pointer.worldX, pointer.worldY);
    if (!point) return;
    this.collisionHover = point;
    try {
      if (this.collisionTool === "paint" || this.collisionTool === "erase") {
        this.collisionStrokePoints = new Map(
          this.collisionBrushPoints(point).map((brushPoint) => [
            `${brushPoint.x},${brushPoint.y}`,
            brushPoint,
          ]),
        );
      } else if (this.collisionTool === "flood-solid" || this.collisionTool === "flood-clear") {
        const selection = this.collisionSelection && this.selectionContains(this.collisionSelection, point)
          ? this.collisionSelection
          : undefined;
        this.afterCollisionMutation(this.collisionModel.floodFill(
          point,
          this.collisionTool === "flood-solid",
          selection,
        ));
      } else if (this.collisionTool === "select") {
        this.collisionSelectionStart = point;
        this.collisionSelection = Object.freeze({ ...point, width: 1, height: 1 });
      }
    } catch (error) {
      this.reportCollision(this.errorMessage(error), true);
    }
    this.drawGuides();
  }

  private onCollisionPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.selectedStandaloneEntry() || this.collisionSaveInFlight) return;
    this.collisionProbeWorld = Object.freeze({ x: pointer.worldX, y: pointer.worldY });
    const point = this.collisionSubcellAt(pointer.worldX, pointer.worldY);
    this.collisionHover = point;
    if (this.collisionPanGesture && pointer.isDown) {
      const gesture = this.collisionPanGesture;
      this.cameras.main.scrollX = gesture.scrollX - (pointer.x - gesture.pointerX) / this.cameras.main.zoom;
      this.cameras.main.scrollY = gesture.scrollY - (pointer.y - gesture.pointerY) / this.cameras.main.zoom;
      return;
    }
    if (point && pointer.isDown && this.collisionStrokePoints) {
      for (const brushPoint of this.collisionBrushPoints(point)) {
        this.collisionStrokePoints.set(`${brushPoint.x},${brushPoint.y}`, brushPoint);
      }
    }
    if (point && pointer.isDown && this.collisionSelectionStart) {
      this.collisionSelection = this.selectionBetween(this.collisionSelectionStart, point);
    }
    this.drawGuides();
  }

  private onCollisionPointerUp(): void {
    if (this.collisionSaveInFlight) {
      this.collisionStrokePoints = undefined;
      this.collisionSelectionStart = undefined;
      return;
    }
    this.collisionPanGesture = undefined;
    this.collisionSelectionStart = undefined;
    const stroke = this.collisionStrokePoints;
    this.collisionStrokePoints = undefined;
    if (!stroke || stroke.size === 0) {
      this.drawGuides();
      return;
    }
    try {
      const points = [...stroke.values()];
      this.afterCollisionMutation(this.collisionTool === "paint"
        ? this.collisionModel.paintStroke(points)
        : this.collisionModel.eraseStroke(points));
    } catch (error) {
      this.reportCollision(this.errorMessage(error), true);
    }
    this.drawGuides();
  }

  private selectionBetween(
    start: Readonly<CollisionEditorSubcellPoint>,
    end: Readonly<CollisionEditorSubcellPoint>,
  ): Readonly<CollisionEditorSelection> {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    return Object.freeze({
      x,
      y,
      width: Math.abs(start.x - end.x) + 1,
      height: Math.abs(start.y - end.y) + 1,
    });
  }

  private selectionContains(
    selection: Readonly<CollisionEditorSelection>,
    point: Readonly<CollisionEditorSubcellPoint>,
  ): boolean {
    return point.x >= selection.x
      && point.y >= selection.y
      && point.x < selection.x + selection.width
      && point.y < selection.y + selection.height;
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
    if (this.collisionTarget && !this.collisionTarget.packageMetadata) {
      this.placement.setText(`${this.collisionTarget.source} · ${this.collisionTarget.editingNote}`);
      return;
    }
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
      <section class="asset-selection-inspector" aria-labelledby="selected-asset-title">
        <header>
          <div>
            <p class="eyebrow">Selected asset</p>
            <h3 id="selected-asset-title" data-library="title"></h3>
            <p data-library="subtitle" class="asset-selection-subtitle"></p>
          </div>
          <div class="asset-selection-header-actions">
            <button data-library-action="import" type="button" hidden>Import and prepare</button>
            <button data-library-action="fit" type="button">Fit</button>
          </div>
        </header>
        <div class="asset-selection-nav">
          <button data-library-action="previous" type="button" aria-label="Previous asset">← Previous</button>
          <code data-library="id"></code>
          <button data-library-action="next" type="button" aria-label="Next asset">Next →</button>
        </div>
        <div data-library="badges" class="asset-selection-badges"></div>
        <section data-production-review class="production-review-panel" hidden>
          <div class="production-preview-modes" role="group" aria-label="Candidate preview mode">
            <button data-production-mode="source" type="button">Source</button>
            <button data-production-mode="prepared" type="button">Prepared</button>
            <button data-production-mode="compare" type="button">Compare</button>
          </div>
          <label class="production-opacity">Prepared opacity
            <input data-production="opacity" type="range" min="0" max="1" step="0.05" value="1">
            <output data-production="opacity-output">100%</output>
          </label>
          <label class="production-collision-toggle">
            <input data-production="collision" type="checkbox" checked>
            <span data-production="collision-label">Show collision draft</span>
          </label>
          <p data-production="notice" class="production-review-notice"></p>
          <div class="production-review-actions">
            <button data-production-review-action="approved" type="button">Approve for testing</button>
            <button data-production-review-action="rejected" type="button">Reject</button>
            <a data-production="test-link" class="production-test-link" href="#" hidden>Test visually in game</a>
          </div>
          <output data-production="status" class="asset-viewer-diagnostics" aria-live="polite"></output>
        </section>
        <details class="asset-selection-overview">
          <summary>Asset overview, layers and animation</summary>
          <div class="asset-selection-overview-body">
            <div data-library="details" class="asset-selection-details"></div>
            <div class="asset-selection-subsection">
              <h4>Visual layers</h4>
              <div data-library="layers" class="asset-layer-list"></div>
            </div>
            <div data-library="animation-section" class="asset-selection-subsection">
              <h4>Animations</h4>
              <div data-library="animations" class="asset-animation-list"></div>
            </div>
          </div>
        </details>
      </section>
      <details class="asset-inspector-section" data-selected-package-only open>
        <summary>Collision</summary>
        <section class="collision-workbench" aria-labelledby="collision-workbench-title">
          <header>
            <div>
              <p class="eyebrow">Live package editor</p>
              <h3 id="collision-workbench-title">Collision authoring</h3>
            </div>
            <button data-collision="fit" type="button">Fit</button>
          </header>
          <label class="collision-target-row">Runtime profile
            <select data-collision="target"></select>
          </label>
          <p data-collision="note" class="collision-note"></p>
          <div class="collision-legend" aria-label="Collision overlay legend">
            <span><i data-swatch="solid"></i>Solid</span>
            <span><i data-swatch="coarse"></i>32 px grid</span>
            <span><i data-swatch="fine"></i>8 px subgrid</span>
            <span><i data-swatch="clearance"></i>14 px hull probe</span>
          </div>
          <div data-collision-panel="hybrid-grid" class="collision-panel" hidden>
            <div class="collision-brush-toolbar">
              <span>Brush size</span>
              <div class="collision-segmented" role="group" aria-label="Collision brush size">
                <button data-collision-brush="1" type="button">8 px detail</button>
                <button data-collision-brush="4" type="button">32 px cell</button>
              </div>
            </div>
            <div class="collision-tool-grid" role="group" aria-label="Collision grid tools">
              <button data-collision-tool="paint" type="button">Paint</button>
              <button data-collision-tool="erase" type="button">Erase</button>
              <button data-collision-tool="flood-solid" type="button">Fill solid</button>
              <button data-collision-tool="flood-clear" type="button">Fill clear</button>
              <button data-collision-tool="select" type="button">Select</button>
              <button data-collision-tool="pan" type="button">Pan</button>
            </div>
            <div class="collision-action-grid">
              <button data-collision="selection-solid" type="button">Selection solid</button>
              <button data-collision="selection-clear" type="button">Selection clear</button>
              <button data-collision="revert-cell" type="button">Revert hovered cell</button>
            </div>
          </div>
          <div data-collision-panel="box" class="collision-panel" hidden>
            <label>Centered square half-extent
              <input data-collision="half-extent" type="number" min="1" max="15" step="1">
            </label>
            <button data-collision="apply-box" type="button">Apply hull</button>
          </div>
          <div data-collision-panel="explicit-empty" class="collision-panel" hidden>
            <p>Passable objects use an explicit empty collision profile.</p>
            <button data-collision="set-empty" type="button">Set explicitly passable</button>
          </div>
          <div data-collision-panel="read-only" class="collision-panel collision-panel--read-only" hidden>
            <p data-collision="read-only-note"></p>
          </div>
          <div class="collision-history-actions">
            <button data-collision="undo" type="button">Undo</button>
            <button data-collision="redo" type="button">Redo</button>
            <button data-collision="reset" type="button">Reset edits</button>
          </div>
          <button data-collision="save" class="collision-save-button" type="button">Save to library</button>
          <output data-collision="status" class="asset-viewer-diagnostics" aria-live="polite"></output>
          <details class="collision-portable">
            <summary>Portable candidate file</summary>
            <div class="collision-portable-body">
              <label class="collision-import">Import collision candidate
                <input data-collision="import" type="file" accept="application/json,.json">
              </label>
              <div class="collision-candidate-actions">
                <button data-collision="validate" type="button">Validate profile</button>
                <button data-collision="export" type="button" disabled>Export collision bundle</button>
              </div>
            </div>
          </details>
        </section>
      </details>
      <details class="asset-inspector-section" data-selected-package-only>
        <summary>Preview and animation</summary>
        <section class="asset-viewer-controls" aria-labelledby="asset-viewer-title">
          <h3 id="asset-viewer-title">Runtime preview</h3>
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
      </details>
      <details class="asset-inspector-section" data-selected-package-only>
        <summary>Advanced package candidate</summary>
        <section class="asset-workbench" aria-labelledby="asset-workbench-title">
          <header>
            <div>
              <p class="eyebrow">Portable visual intake</p>
              <h3 id="asset-workbench-title">Candidate package</h3>
            </div>
            <button data-workbench="template" type="button">Load template</button>
          </header>
          <label>Contract template <select data-workbench="kind"></select></label>
          <label>Collision handling
            <select data-workbench="collision-intent">
              <option value="preserve">Preserve accepted mask</option>
              <option value="replace">Replace with candidate mask</option>
              <option value="reset-to-coarse">Reset to coarse terrain</option>
            </select>
          </label>
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
        </section>
      </details>`;
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
        this.selectCatalogCollisionTarget(assetSelect.value as AuthoredAssetId);
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
    this.mountCollisionWorkbench(slot, signal);
    this.mountCandidateWorkbench(slot, signal, assetSelect);
    this.productionIntakeUi ??= mountProductionAssetIntakeUi();
    this.mountAssetLibraryBrowser(signal);
    this.mountSelectedAssetControls(slot, signal);
    this.syncSelectedAssetUi();
  }

  private mountAssetLibraryBrowser(signal: AbortSignal): void {
    const host = document.querySelector<HTMLElement>(".game-region");
    if (!host) return;
    const browser = this.assetLibraryBrowser ?? document.createElement("aside");
    browser.id = "asset-library-browser";
    browser.className = "asset-library-browser";
    browser.setAttribute("aria-label", "Asset library browser");
    const groups = ASSET_LIBRARY_GROUPS.map((group) => `
      <section class="asset-library-group" data-library-group="${escapeHtml(group.id)}">
        <header><h3>${escapeHtml(group.name)}</h3><span>${group.entries.length}</span></header>
        <div class="asset-library-list">
          ${group.entries.map((entry) => {
            const settlement = entry.entryType === "reference-image"
              ? entry.reference.settlement ?? entry.reference.kind
              : entry.entryType === "production-candidate"
                ? entry.reviewState
                : "runtime";
            const status = entry.entryType === "authored-package"
              ? "Runtime"
              : entry.entryType === "production-candidate"
                ? entry.reviewState
                : entry.reference.sequence === undefined
                  ? "Reference"
                  : String(entry.reference.sequence).padStart(2, "0");
            return `
              <button
                type="button"
                class="asset-library-item"
                data-library-id="${escapeHtml(entry.id)}"
                data-library-type="${escapeHtml(entry.entryType)}"
                data-library-settlement="${escapeHtml(settlement)}"
                data-library-search="${escapeHtml(`${entry.name} ${entry.subtitle} ${entry.id} ${entry.tags.join(" ")}`.toLowerCase())}"
              >
                <span class="asset-library-thumb"><img loading="lazy" decoding="async" alt="" data-library-thumb-src="${escapeHtml(entry.thumbnailUrl)}"></span>
                <span class="asset-library-item-copy">
                  <strong>${escapeHtml(entry.name)}</strong>
                  <small>${escapeHtml(entry.subtitle)}</small>
                </span>
                <span class="asset-library-status" data-status="${escapeHtml(entry.entryType)}">
                  ${escapeHtml(status)}
                </span>
              </button>`;
          }).join("")}
        </div>
      </section>`).join("");
    browser.innerHTML = `
      <header class="asset-library-header">
        <div><p class="eyebrow">Wayfinders workshop</p><h2>Asset library</h2></div>
        <div class="asset-library-header-actions">
          <span>${ASSET_LIBRARY_CATALOG.length} assets</span>
          <button data-library-intake-new type="button">Add PNG</button>
        </div>
      </header>
      <div class="asset-library-filters">
        <label><span>Search</span><input data-library-search type="search" placeholder="Name, tag, or ID"></label>
        <label><span>Show</span>
          <select data-library-filter>
            <option value="all">All assets</option>
            <option value="authored-package">Runtime packages</option>
            <option value="production-candidate">Production candidates</option>
            <option value="reference-image">Source examples</option>
            <option value="inhabited">Inhabited islands</option>
            <option value="uninhabited">Uninhabited islands</option>
          </select>
        </label>
      </div>
      <div class="asset-library-groups">${groups}</div>`;
    if (!browser.isConnected) host.append(browser);
    this.assetLibraryBrowser = browser;

    const search = browser.querySelector<HTMLInputElement>("[data-library-search]");
    const filter = browser.querySelector<HTMLSelectElement>("[data-library-filter]");
    const applyFilters = () => {
      const query = search?.value.trim().toLowerCase() ?? "";
      const mode = filter?.value ?? "all";
      for (const item of browser.querySelectorAll<HTMLButtonElement>("[data-library-id]")) {
        const matchesQuery = query.length === 0 || (item.dataset.librarySearch ?? "").includes(query);
        const matchesMode = mode === "all"
          || item.dataset.libraryType === mode
          || item.dataset.librarySettlement === mode;
        item.hidden = !matchesQuery || !matchesMode;
      }
      for (const group of browser.querySelectorAll<HTMLElement>("[data-library-group]")) {
        group.hidden = !group.querySelector("[data-library-id]:not([hidden])");
      }
    };
    search?.addEventListener("input", applyFilters, { signal });
    filter?.addEventListener("change", applyFilters, { signal });
    const deferredThumbnails = browser.querySelectorAll<HTMLImageElement>("[data-library-thumb-src]");
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((records) => {
        for (const record of records) {
          if (!record.isIntersecting) continue;
          const image = record.target as HTMLImageElement;
          const source = image.dataset.libraryThumbSrc;
          if (source) image.src = source;
          delete image.dataset.libraryThumbSrc;
          observer.unobserve(image);
        }
      }, {
        root: browser.querySelector(".asset-library-groups"),
        rootMargin: "160px",
      });
      deferredThumbnails.forEach((image) => observer.observe(image));
      signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    } else {
      deferredThumbnails.forEach((image) => {
        if (image.dataset.libraryThumbSrc) image.src = image.dataset.libraryThumbSrc;
        delete image.dataset.libraryThumbSrc;
      });
    }
    for (const item of browser.querySelectorAll<HTMLButtonElement>("[data-library-id]")) {
      item.addEventListener("click", () => {
        const id = item.dataset.libraryId;
        if (id) this.selectLibraryAsset(id);
      }, { signal });
    }
    browser.querySelector<HTMLButtonElement>("[data-library-intake-new]")
      ?.addEventListener("click", () => this.productionIntakeUi?.open(), { signal });
  }

  private mountSelectedAssetControls(slot: HTMLElement, signal: AbortSignal): void {
    slot.querySelector<HTMLButtonElement>("[data-library-action=fit]")
      ?.addEventListener("click", () => this.fitSelectedLibraryAsset(), { signal });
    slot.querySelector<HTMLButtonElement>("[data-library-action=import]")
      ?.addEventListener("click", () => {
        const entry = this.selectedReferenceEntry();
        if (!entry) return;
        this.productionIntakeUi?.open({
          name: entry.name,
          repositoryPath: entry.reference.relativePath,
          kind: entry.reference.kind,
        });
      }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-library-action=previous]")
      ?.addEventListener("click", () => this.stepLibrarySelection(-1), { signal });
    slot.querySelector<HTMLButtonElement>("[data-library-action=next]")
      ?.addEventListener("click", () => this.stepLibrarySelection(1), { signal });
    for (const button of slot.querySelectorAll<HTMLButtonElement>("[data-production-mode]")) {
      button.addEventListener("click", () => {
        const entry = this.selectedProductionCandidate();
        const mode = button.dataset.productionMode as ProductionPreviewMode | undefined;
        if (!entry || !mode || !["source", "prepared", "compare"].includes(mode)) return;
        this.productionPreviewModes.set(entry.id, mode);
        this.rebuildPreview();
      }, { signal });
    }
    slot.querySelector<HTMLInputElement>("[data-production=opacity]")
      ?.addEventListener("input", (event) => {
        const entry = this.selectedProductionCandidate();
        if (!entry) return;
        const value = Number((event.currentTarget as HTMLInputElement).value);
        this.productionCompareOpacity.set(entry.id, Phaser.Math.Clamp(value, 0, 1));
        this.rebuildPreview();
      }, { signal });
    slot.querySelector<HTMLInputElement>("[data-production=collision]")
      ?.addEventListener("change", (event) => {
        this.state.showFootprint = (event.currentTarget as HTMLInputElement).checked;
        this.drawGuides();
        this.syncSelectedAssetUi();
      }, { signal });
    for (const button of slot.querySelectorAll<HTMLButtonElement>("[data-production-review-action]")) {
      button.addEventListener("click", () => {
        const decision = button.dataset.productionReviewAction as ProductionReviewState | undefined;
        if (decision === "approved" || decision === "rejected") {
          void this.reviewProductionCandidate(decision);
        }
      }, { signal });
    }
    const layers = slot.querySelector<HTMLElement>("[data-library=layers]");
    layers?.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      const entry = this.selectedLibraryEntry();
      const layerId = input.dataset.layerVisibility;
      if (!layerId) return;
      this.layerVisibility.set(this.layerStateKey(entry.id, layerId), input.checked);
      this.rebuildPreview();
    }, { signal });
    layers?.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      const entry = this.selectedLibraryEntry();
      const layerId = input.dataset.layerOpacity;
      if (!layerId) return;
      this.layerOpacity.set(
        this.layerStateKey(entry.id, layerId),
        Phaser.Math.Clamp(Number(input.value), 0, 1),
      );
      this.rebuildPreview();
    }, { signal });
  }

  private productionReviewState(entry: Readonly<ProductionCandidateLibraryEntry>): ProductionReviewState {
    return this.productionReviewStates.get(entry.id) ?? entry.reviewState;
  }

  private reportProductionReview(message: string, error = false): void {
    const status = document.querySelector<HTMLOutputElement>("[data-production=status]");
    if (!status) return;
    status.value = message;
    status.dataset.state = error ? "error" : "ready";
  }

  private productionGameTestUrl(entry: Readonly<ProductionCandidateLibraryEntry>): string {
    const url = new URL(window.location.href);
    url.searchParams.delete("mode");
    url.searchParams.set("testAsset", entry.id);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  private async reviewProductionCandidate(decision: "approved" | "rejected"): Promise<void> {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionReviewInFlight) return;
    this.productionReviewInFlight = true;
    this.syncSelectedAssetUi();
    this.reportProductionReview(`Saving ${decision} decision\u2026`);
    try {
      const response = await fetch(ASSET_REVIEW_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeId: entry.id,
          candidateFingerprint: entry.fingerprint,
          decision,
        }),
      });
      const payload = await response.json() as Readonly<{ error?: string; message?: string }>;
      if (!response.ok) throw new Error(payload.error ?? `Review save failed with HTTP ${response.status}`);
      this.productionReviewStates.set(entry.id, decision);
      this.reportProductionReview(
        decision === "approved"
          ? "Approved for visual testing. Collision and gameplay metadata remain unchanged."
          : "Rejected. Runtime files remain unchanged.",
      );
    } catch (error) {
      this.reportProductionReview(this.errorMessage(error), true);
    } finally {
      this.productionReviewInFlight = false;
      this.syncSelectedAssetUi();
    }
  }

  private stepLibrarySelection(direction: -1 | 1): void {
    if (this.collisionSaveInFlight) return;
    const visibleItems = [...(this.assetLibraryBrowser?.querySelectorAll<HTMLButtonElement>(
      "[data-library-id]:not([hidden])",
    ) ?? [])].filter((item) => !item.closest<HTMLElement>("[data-library-group]")?.hidden);
    if (visibleItems.length === 0) return;
    const current = visibleItems.findIndex(({ dataset }) => dataset.libraryId === this.selectedLibraryAssetId);
    const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
    const next = (start + direction + visibleItems.length) % visibleItems.length;
    const id = visibleItems[next].dataset.libraryId;
    if (id) this.selectLibraryAsset(id);
  }

  private selectLibraryAsset(id: string): void {
    if (this.collisionSaveInFlight) return;
    const entry = assetLibraryEntryById(id);
    if (!entry) return;
    this.stashCurrentCollisionDraft();
    this.referenceLoadRevision++;
    this.selectedLibraryAssetId = entry.id;
    this.previewAssets = this.catalogAssets;
    if (entry.entryType === "authored-package") {
      this.selectCatalogCollisionTarget(entry.package.metadata.assetId);
    } else {
      this.validatedCollisionCandidate = undefined;
      this.beginReferencePreviewLoad(entry);
    }
  }

  private selectedAssetDetails(entry: Readonly<AssetLibraryEntry>): Readonly<AssetLibraryEntry>["details"] {
    if (entry.entryType === "production-candidate") {
      const reviewState = this.productionReviewState(entry);
      return entry.details.map((section) => ({
        ...section,
        fields: section.fields.map((field) => field.id === "review"
          ? { ...field, value: reviewState[0].toUpperCase() + reviewState.slice(1) }
          : field),
      }));
    }
    if (entry.entryType !== "authored-package") return entry.details;
    const metadata = this.acceptedMetadata(entry.package.metadata.assetId) ?? entry.package.metadata;
    return entry.details.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        let value = field.value;
        if (field.id === "runtime-revision") value = metadata.runtimeRevision;
        else if (field.id === "source-asset-id") value = metadata.sourceAssetId;
        else if (metadata.kind === "home-island" && field.id === "collision") {
          value = metadata.collision
            ? `Hybrid grid (${metadata.collision.subcellSize} px, ${metadata.collision.mixedCells.length} overrides)`
            : "Coarse terrain grid";
        } else if (metadata.kind === "player-boat" && metadata.collision && field.id === "half-width") {
          value = metadata.collision.halfSize.width;
        } else if (metadata.kind === "player-boat" && metadata.collision && field.id === "half-height") {
          value = metadata.collision.halfSize.height;
        }
        return { ...field, value };
      }),
    }));
  }

  private syncSelectedAssetUi(): void {
    const entry = this.selectedLibraryEntry();
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-library-id]")) {
      const active = item.dataset.libraryId === entry.id;
      item.dataset.active = String(active);
      item.setAttribute("aria-current", active ? "true" : "false");
      if (active) item.scrollIntoView({ block: "nearest" });
    }
    const title = document.querySelector<HTMLElement>("[data-library=title]");
    const subtitle = document.querySelector<HTMLElement>("[data-library=subtitle]");
    const id = document.querySelector<HTMLElement>("[data-library=id]");
    if (title) title.textContent = entry.name;
    if (subtitle) subtitle.textContent = entry.subtitle;
    if (id) id.textContent = entry.id;

    const badges = document.querySelector<HTMLElement>("[data-library=badges]");
    if (badges) badges.innerHTML = [
      `<span>${entry.entryType === "authored-package" ? "Runtime package" : entry.entryType === "production-candidate" ? "Production candidate" : "Source reference"}</span>`,
      `<span>${escapeHtml(entry.collection)}</span>`,
      ...(entry.entryType === "reference-image" ? ["<span>RGB matte</span>"] : []),
      ...(entry.entryType === "production-candidate"
        ? [`<span>${escapeHtml(this.productionReviewState(entry))}</span>`]
        : []),
    ].join("");
    const details = document.querySelector<HTMLElement>("[data-library=details]");
    if (details) details.innerHTML = this.selectedAssetDetails(entry).map((section) => `
      <section><h4>${escapeHtml(section.name)}</h4><dl>
        ${section.fields.map((field) => `<div><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(String(field.value))}${field.unit ? ` ${escapeHtml(field.unit)}` : ""}</dd></div>`).join("")}
      </dl></section>`).join("");
    const layers = document.querySelector<HTMLElement>("[data-library=layers]");
    if (layers && entry.entryType !== "authored-package") layers.innerHTML = entry.layers.map((layer) => {
      const dimensions = layer.frameSize
        ? `${layer.frameSize.width}\u00d7${layer.frameSize.height} frame`
        : layer.pixelSize
          ? `${layer.pixelSize.width}\u00d7${layer.pixelSize.height} px`
          : "Source image";
      return `<div class="asset-layer-row asset-layer-row--editable">
        <input data-layer-visibility="${escapeHtml(layer.id)}" type="checkbox" aria-label="Show ${escapeHtml(layer.name)}" ${this.layerIsVisible(entry.id, layer) ? "checked" : ""}>
        <span data-role="${escapeHtml(layer.role)}">${escapeHtml(layer.role)}</span>
        <strong>${escapeHtml(layer.name)}</strong>
        <small>${dimensions}</small>
        <input data-layer-opacity="${escapeHtml(layer.id)}" type="range" min="0" max="1" step="0.05" aria-label="${escapeHtml(layer.name)} opacity" value="${this.layerAlpha(entry.id, layer)}">
      </div>`;
    }).join("");
    if (layers && entry.entryType === "authored-package") layers.innerHTML = entry.layers.map((layer) => `
      <div class="asset-layer-row"><span data-role="${escapeHtml(layer.role)}">${escapeHtml(layer.role)}</span><strong>${escapeHtml(layer.name)}</strong><small>${layer.frameSize ? `${layer.frameSize.width}×${layer.frameSize.height} frame` : layer.pixelSize ? `${layer.pixelSize.width}×${layer.pixelSize.height} px` : "Source image"}</small></div>`).join("");
    const animationSection = document.querySelector<HTMLElement>("[data-library=animation-section]");
    const animations = document.querySelector<HTMLElement>("[data-library=animations]");
    if (animationSection) animationSection.hidden = entry.animations.length === 0;
    if (animations) animations.innerHTML = entry.animations.map((animation) => `
      <div class="asset-animation-row"><strong>${escapeHtml(animation.name)}</strong><span>${animation.frameCount} frames · ${animation.framesPerSecond} fps · ${animation.directionCount} direction${animation.directionCount === 1 ? "" : "s"}</span></div>`).join("");
    const productionPanel = document.querySelector<HTMLElement>("[data-production-review]");
    if (productionPanel) productionPanel.hidden = entry.entryType !== "production-candidate";
    const importButton = document.querySelector<HTMLButtonElement>("[data-library-action=import]");
    if (importButton) importButton.hidden = entry.entryType !== "reference-image";
    if (entry.entryType === "production-candidate") {
      const mode = this.productionPreviewModes.get(entry.id) ?? "prepared";
      const reviewState = this.productionReviewState(entry);
      const opacity = this.productionCompareOpacity.get(entry.id) ?? 1;
      for (const button of document.querySelectorAll<HTMLButtonElement>("[data-production-mode]")) {
        button.dataset.active = String(button.dataset.productionMode === mode);
      }
      const opacityInput = document.querySelector<HTMLInputElement>("[data-production=opacity]");
      const opacityOutput = document.querySelector<HTMLOutputElement>("[data-production=opacity-output]");
      if (opacityInput) {
        opacityInput.value = String(opacity);
        opacityInput.disabled = mode !== "compare";
      }
      if (opacityOutput) opacityOutput.value = `${Math.round(opacity * 100)}%`;
      const collision = document.querySelector<HTMLInputElement>("[data-production=collision]");
      if (collision) {
        collision.checked = this.state.showFootprint;
        collision.disabled = entry.collisionDraft.kind !== "hybrid-grid-draft";
      }
      const collisionLabel = document.querySelector<HTMLElement>("[data-production=collision-label]");
      if (collisionLabel) collisionLabel.textContent = entry.collisionDraft.kind === "hybrid-grid-draft"
        ? `Show ${entry.collisionDraft.tileSize}/${entry.collisionDraft.subcellSize} px collision draft`
        : entry.collisionDraft.kind === "empty"
          ? "Explicitly passable (no collision grid)"
          : `Uses accepted collision from ${entry.collisionDraft.runtimeAssetId}`;
      const notice = document.querySelector<HTMLElement>("[data-production=notice]");
      if (notice) notice.textContent = entry.recipe.runtimeBinding
        ? `${reviewState}. Visual game testing uses ${entry.recipe.runtimeBinding.assetId} and preserves its accepted collision mask.`
        : `${reviewState}. This candidate has no runtime test binding.`;
      for (const button of document.querySelectorAll<HTMLButtonElement>("[data-production-review-action]")) {
        button.disabled = this.productionReviewInFlight;
        button.dataset.active = String(button.dataset.productionReviewAction === reviewState);
      }
      const testLink = document.querySelector<HTMLAnchorElement>("[data-production=test-link]");
      if (testLink) {
        testLink.hidden = reviewState !== "approved" || !entry.recipe.runtimeBinding;
        testLink.href = this.productionGameTestUrl(entry);
      }
      const item = this.assetLibraryBrowser?.querySelector<HTMLButtonElement>(
        `[data-library-id="${CSS.escape(entry.id)}"]`,
      );
      const status = item?.querySelector<HTMLElement>(".asset-library-status");
      if (status) status.textContent = reviewState;
    }
    for (const packageOnly of document.querySelectorAll<HTMLElement>("[data-selected-package-only]")) {
      packageOnly.hidden = entry.entryType !== "authored-package";
    }
  }

  private mountCollisionWorkbench(slot: HTMLDivElement, signal: AbortSignal): void {
    const targetSelect = slot.querySelector<HTMLSelectElement>("[data-collision=target]");
    const fitButton = slot.querySelector<HTMLButtonElement>("[data-collision=fit]");
    const selectionSolid = slot.querySelector<HTMLButtonElement>("[data-collision=selection-solid]");
    const selectionClear = slot.querySelector<HTMLButtonElement>("[data-collision=selection-clear]");
    const revertCell = slot.querySelector<HTMLButtonElement>("[data-collision=revert-cell]");
    const halfExtent = slot.querySelector<HTMLInputElement>("[data-collision=half-extent]");
    const applyBox = slot.querySelector<HTMLButtonElement>("[data-collision=apply-box]");
    const setEmpty = slot.querySelector<HTMLButtonElement>("[data-collision=set-empty]");
    const undo = slot.querySelector<HTMLButtonElement>("[data-collision=undo]");
    const redo = slot.querySelector<HTMLButtonElement>("[data-collision=redo]");
    const reset = slot.querySelector<HTMLButtonElement>("[data-collision=reset]");
    const save = slot.querySelector<HTMLButtonElement>("[data-collision=save]");
    const importInput = slot.querySelector<HTMLInputElement>("[data-collision=import]");
    const validate = slot.querySelector<HTMLButtonElement>("[data-collision=validate]");
    const exportButton = slot.querySelector<HTMLButtonElement>("[data-collision=export]");
    if (
      !targetSelect || !fitButton || !selectionSolid || !selectionClear || !revertCell
      || !halfExtent || !applyBox || !setEmpty || !undo || !redo || !reset
      || !save || !importInput || !validate || !exportButton
    ) return;

    for (const target of createCollisionAuthoringTargets()) {
      targetSelect.add(new Option(`${target.label} · ${target.objectKind}`, target.objectKind));
    }
    targetSelect.addEventListener("change", () => {
      if (this.collisionSaveInFlight) return;
      const objectKind = targetSelect.value as RuntimeCollisionObjectKind;
      if (!RUNTIME_COLLISION_OBJECT_KINDS.includes(objectKind)) return;
      try {
        const assetId = authoredAssetIdForCollisionObject(objectKind);
        if (assetId) this.selectCatalogCollisionTarget(assetId);
        else {
          this.stashCurrentCollisionDraft();
          this.previewAssets = this.catalogAssets;
          this.activateCollisionTarget(objectKind);
        }
        this.reportCollision(this.collisionTarget.editingNote);
      } catch (error) {
        this.reportCollision(this.errorMessage(error), true);
      }
    }, { signal });
    fitButton.addEventListener("click", () => this.fitCollisionTarget(), { signal });

    for (const button of slot.querySelectorAll<HTMLButtonElement>("[data-collision-tool]")) {
      button.addEventListener("click", () => {
        this.collisionTool = button.dataset.collisionTool as CollisionTool;
        this.syncCollisionControls();
        this.drawGuides();
      }, { signal });
    }
    for (const button of slot.querySelectorAll<HTMLButtonElement>("[data-collision-brush]")) {
      button.addEventListener("click", () => {
        const brushSize = Number(button.dataset.collisionBrush);
        if (brushSize !== 1 && brushSize !== COLLISION_SUBCELLS_PER_TILE) return;
        this.collisionBrushSize = brushSize;
        this.syncCollisionControls();
        this.drawGuides();
      }, { signal });
    }
    const run = (operation: () => boolean) => {
      try { this.afterCollisionMutation(operation()); }
      catch (error) { this.reportCollision(this.errorMessage(error), true); }
    };
    selectionSolid.addEventListener("click", () => {
      if (this.collisionSelection) run(() => this.collisionModel.fillSelection(this.collisionSelection!));
    }, { signal });
    selectionClear.addEventListener("click", () => {
      if (this.collisionSelection) run(() => this.collisionModel.eraseSelection(this.collisionSelection!));
    }, { signal });
    revertCell.addEventListener("click", () => {
      const point = this.collisionHover;
      if (!point) return;
      run(() => this.collisionModel.revertCoarseCell(
        Math.floor(point.x / COLLISION_SUBCELLS_PER_TILE),
        Math.floor(point.y / COLLISION_SUBCELLS_PER_TILE),
      ));
    }, { signal });
    applyBox.addEventListener("click", () => {
      const value = Number(halfExtent.value);
      run(() => this.collisionModel.setBox({
        kind: "box",
        offset: { x: 0, y: 0 },
        halfSize: { width: value, height: value },
      }));
    }, { signal });
    halfExtent.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applyBox.click();
    }, { signal });
    setEmpty.addEventListener("click", () => run(() => this.collisionModel.setExplicitEmpty()), { signal });
    undo.addEventListener("click", () => this.afterCollisionMutation(this.collisionModel.undo()), { signal });
    redo.addEventListener("click", () => this.afterCollisionMutation(this.collisionModel.redo()), { signal });
    reset.addEventListener("click", () => run(() => this.collisionModel.reset()), { signal });
    save.addEventListener("click", () => { void this.saveCollisionToLibrary(); }, { signal });
    validate.addEventListener("click", () => {
      try {
        const candidate = this.validateCollisionDraft();
        this.reportCollision(
          `Valid ${candidate.assetId} ${candidate.collisionIntent} candidate; preview uses the exact package validator.`,
        );
      } catch (error) {
        this.validatedCollisionCandidate = undefined;
        this.syncCollisionControls();
        this.reportCollision(this.errorMessage(error), true);
      }
    }, { signal });
    exportButton.addEventListener("click", () => this.exportCollisionCandidate(), { signal });
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (!file) return;
      void file.text()
        .then((text) => this.importCollisionCandidate(JSON.parse(text) as unknown))
        .then((candidate) => this.reportCollision(
          `Imported and exactly validated ${candidate.assetId} ${candidate.collisionIntent} candidate.`,
        ))
        .catch((error: unknown) => this.reportCollision(this.errorMessage(error), true))
        .finally(() => { importInput.value = ""; });
    }, { signal });

    window.addEventListener("keydown", (event) => this.onCollisionKeyDown(event), { signal });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") this.collisionSpaceHeld = false;
    }, { signal });
    this.syncCollisionControls();
    this.reportCollision(this.collisionTarget.editingNote);
  }

  private selectCatalogCollisionTarget(assetId: AuthoredAssetId): void {
    if (this.collisionSaveInFlight) return;
    this.stashCurrentCollisionDraft();
    const metadata = this.acceptedMetadata(assetId);
    if (!metadata) throw new RangeError(`Catalog metadata ${assetId} is unavailable`);
    this.previewAssets = this.catalogAssets;
    this.activateCollisionTarget(this.collisionObjectKindForAsset(assetId), metadata, metadata, false);
    this.restoreCollisionDraft(assetId);
    this.rebuildPreview();
    this.syncCollisionControls();
  }

  private collisionObjectKindForAsset(assetId: AuthoredAssetId): RuntimeCollisionObjectKind {
    switch (assetId) {
      case AUTHORED_ASSET_IDS.homeIsland: return "home-island";
      case AUTHORED_ASSET_IDS.playerBoat: return "player-ship";
      case AUTHORED_ASSET_IDS.fishingShoal: return "fishing-shoal";
    }
  }

  private validateCollisionMetadataExact(value: unknown): Readonly<AuthoredAssetMetadata> {
    const metadata = validateAuthoredAssetMetadata(value);
    const acceptedHome = this.acceptedMetadata(AUTHORED_ASSET_IDS.homeIsland);
    const acceptedPlayer = this.acceptedMetadata(AUTHORED_ASSET_IDS.playerBoat);
    const acceptedShoal = this.acceptedMetadata(AUTHORED_ASSET_IDS.fishingShoal);
    if (!acceptedHome || !acceptedPlayer || !acceptedShoal) {
      throw new Error("Exact collision validation requires all three accepted pilot packages");
    }
    const validated = validateExactCollisionPackageSet({
      homeIsland: metadata.kind === "home-island" ? metadata : acceptedHome,
      playerBoat: metadata.kind === "player-boat" ? metadata : acceptedPlayer,
      fishingShoal: metadata.kind === "fishing-shoal" ? metadata : acceptedShoal,
    });
    switch (metadata.kind) {
      case "home-island": return validated.homeIsland;
      case "player-boat": return validated.playerBoat;
      case "fishing-shoal": {
        if (!validated.fishingShoal) throw new TypeError("Exact validation omitted the fishing-shoal package");
        return validated.fishingShoal;
      }
    }
  }

  private validateCollisionDraft(): Readonly<CollisionCandidateBundle> {
    const current = this.collisionAcceptedMetadata;
    if (!current || !this.collisionTarget.packageMetadata) {
      throw new Error("This runtime profile is inspectable but has no package collision destination");
    }
    const snapshot = this.collisionModel.snapshot();
    if (!snapshot.exportable) throw new RangeError(snapshot.serializationError ?? "Collision profile is not exportable");
    const candidate = snapshot.profile.kind === "coarse-grid"
      ? createCollisionCandidate(
        current,
        undefined,
        "reset-to-coarse",
        (value) => this.validateCollisionMetadataExact(value),
      )
      : createCollisionCandidate(
        current,
        snapshot.profile as Readonly<AuthoredCollisionProfile>,
        "replace",
        (value) => this.validateCollisionMetadataExact(value),
      );
    const applied = applyCollisionCandidate(
      current,
      candidate,
      (value) => this.validateCollisionMetadataExact(value),
    );
    this.validatedCollisionCandidate = candidate;
    this.previewAssets = this.runtimeWithMetadata(applied, this.previewAssets);
    this.state.assetId = applied.assetId;
    this.rebuildPreview();
    this.syncCollisionControls();
    this.syncPackageSelectors();
    return candidate;
  }

  private importCollisionCandidate(value: unknown): Readonly<CollisionCandidateBundle> {
    const candidate = validateCollisionCandidateBundle(value);
    const current = this.acceptedMetadata(candidate.assetId);
    if (!current) throw new RangeError(`Catalog metadata ${candidate.assetId} is unavailable`);
    const applied = applyCollisionCandidate(
      current,
      candidate,
      (input) => this.validateCollisionMetadataExact(input),
    );
    this.previewAssets = this.runtimeWithMetadata(applied, this.catalogAssets);
    this.activateCollisionTarget(
      this.collisionObjectKindForAsset(candidate.assetId),
      applied,
      current,
      false,
    );
    this.validatedCollisionCandidate = candidate;
    this.rebuildPreview();
    this.syncCollisionControls();
    this.syncPackageSelectors();
    return candidate;
  }

  private runtimeWithMetadata(
    metadata: Readonly<AuthoredAssetMetadata>,
    textures: Readonly<AuthoredAssetRuntime>,
  ): AuthoredAssetRuntime {
    return Object.freeze({
      metadata: (assetId: AuthoredAssetId) => assetId === metadata.assetId
        ? metadata
        : this.acceptedMetadata(assetId),
      textureKey: (imageId: string) => textures.textureKey(imageId) ?? this.catalogAssets.textureKey(imageId),
    });
  }

  private exportCollisionCandidate(): void {
    const candidate = this.validatedCollisionCandidate;
    if (!candidate) return;
    const filename = `${candidate.assetId.replaceAll(".", "-")}.collision.json`;
    const blob = new Blob([`${JSON.stringify(candidate, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    this.reportCollision(`Exported ${filename}; repository intake will revalidate its revision and fingerprint.`);
  }

  private async saveCollisionToLibrary(): Promise<void> {
    if (this.collisionSaveInFlight) return;
    try {
      const candidate = this.validateCollisionDraft();
      const appliedMetadata = this.previewAssets.metadata(candidate.assetId);
      if (!appliedMetadata || appliedMetadata.runtimeRevision !== candidate.baseRuntimeRevision + 1) {
        throw new Error("The validated collision preview did not produce the next runtime revision");
      }
      this.collisionSaveInFlight = true;
      this.syncCollisionControls();
      this.reportCollision("Validating collision and saving to the local asset library…");
      const response = await fetch(COLLISION_SAVE_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const payload = await response.json().catch(() => undefined) as
        | { ok?: boolean; message?: string; error?: string }
        | undefined;
      if (!response.ok || payload?.ok !== true) {
        const message = response.status === 404
          ? "Direct save is unavailable. Restart npm.cmd run dev so the local save bridge is active."
          : payload?.error ?? `Collision save failed with HTTP ${response.status}`;
        throw new Error(message);
      }

      this.acceptedMetadataByAssetId.set(candidate.assetId, appliedMetadata);
      this.collisionDraftsByAssetId.delete(candidate.assetId);
      if (this.selectedLibraryAssetId === candidate.assetId) {
        this.previewAssets = this.runtimeWithMetadata(appliedMetadata, this.catalogAssets);
        this.activateCollisionTarget(
          this.collisionObjectKindForAsset(candidate.assetId),
          appliedMetadata,
          appliedMetadata,
          false,
        );
        this.rebuildPreview();
      }
      this.reportCollision(`${payload.message ?? "Collision saved."} The runtime package is now current.`);
    } catch (error) {
      this.reportCollision(this.errorMessage(error), true);
    } finally {
      this.collisionSaveInFlight = false;
      this.syncCollisionControls();
    }
  }

  private afterCollisionMutation(changed: boolean): void {
    if (changed) this.validatedCollisionCandidate = undefined;
    const snapshot = this.collisionModel.snapshot();
    this.drawGuides();
    this.syncCollisionControls();
    if (snapshot.serializationError) this.reportCollision(snapshot.serializationError, true);
    else if (changed) this.reportCollision("Collision draft changed; save it to update the runtime package.");
  }

  private syncCollisionControls(): void {
    if (!this.collisionTarget || !this.collisionModel) return;
    const snapshot = this.collisionModel.snapshot();
    const effectiveMode = this.collisionTarget.editing === "hybrid-grid" && this.collisionTarget.tileSize !== 32
      ? "read-only"
      : this.collisionTarget.editing;
    const target = document.querySelector<HTMLSelectElement>("[data-collision=target]");
    if (target) {
      target.value = this.collisionTarget.objectKind;
      target.disabled = this.collisionSaveInFlight;
    }
    const note = document.querySelector<HTMLElement>("[data-collision=note]");
    if (note) note.textContent = effectiveMode === "read-only" && this.collisionTarget.tileSize !== 32
      ? `${this.collisionTarget.editingNote} Fine editing requires a 32 px package grid.`
      : this.collisionTarget.editingNote;
    for (const panel of document.querySelectorAll<HTMLElement>("[data-collision-panel]")) {
      panel.hidden = panel.dataset.collisionPanel !== effectiveMode;
    }
    const readOnly = document.querySelector<HTMLElement>("[data-collision=read-only-note]");
    if (readOnly) readOnly.textContent = this.collisionTarget.editingNote;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-collision-tool]")) {
      const active = button.dataset.collisionTool === this.collisionTool;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = this.collisionSaveInFlight || !snapshot.editable;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-collision-brush]")) {
      const active = Number(button.dataset.collisionBrush) === this.collisionBrushSize;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = this.collisionSaveInFlight || !snapshot.editable;
    }
    const halfExtent = document.querySelector<HTMLInputElement>("[data-collision=half-extent]");
    if (halfExtent) {
      if (snapshot.profile.kind === "box") halfExtent.value = String(snapshot.profile.halfSize.width);
      halfExtent.disabled = this.collisionSaveInFlight || !snapshot.editable;
    }
    const setDisabled = (selector: string, disabled: boolean) => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      if (button) button.disabled = disabled;
    };
    setDisabled("[data-collision=undo]", this.collisionSaveInFlight || !snapshot.canUndo);
    setDisabled("[data-collision=redo]", this.collisionSaveInFlight || !snapshot.canRedo);
    setDisabled("[data-collision=reset]", this.collisionSaveInFlight || !snapshot.editable || !snapshot.dirty);
    setDisabled(
      "[data-collision=save]",
      this.collisionSaveInFlight
        || !snapshot.editable
        || !snapshot.dirty
        || !snapshot.exportable
        || !this.collisionAcceptedMetadata,
    );
    setDisabled("[data-collision=selection-solid]", this.collisionSaveInFlight || !this.collisionSelection || !snapshot.editable);
    setDisabled("[data-collision=selection-clear]", this.collisionSaveInFlight || !this.collisionSelection || !snapshot.editable);
    setDisabled("[data-collision=revert-cell]", this.collisionSaveInFlight || !this.collisionHover || !snapshot.editable);
    setDisabled("[data-collision=apply-box]", this.collisionSaveInFlight || !snapshot.editable);
    setDisabled("[data-collision=set-empty]", this.collisionSaveInFlight || !snapshot.editable);
    setDisabled(
      "[data-collision=validate]",
      this.collisionSaveInFlight || !snapshot.editable || !snapshot.exportable || !this.collisionAcceptedMetadata,
    );
    setDisabled("[data-collision=export]", this.collisionSaveInFlight || !this.validatedCollisionCandidate);
    const save = document.querySelector<HTMLButtonElement>("[data-collision=save]");
    if (save) {
      save.textContent = this.collisionSaveInFlight ? "Saving…" : "Save to library";
      save.setAttribute("aria-busy", String(this.collisionSaveInFlight));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-library-id], [data-library-action=previous], [data-library-action=next]",
    )) button.disabled = this.collisionSaveInFlight;
    const viewer = document.querySelector<HTMLSelectElement>("[data-viewer=asset]");
    if (viewer) viewer.disabled = this.collisionSaveInFlight;
  }

  private syncPackageSelectors(): void {
    const assetId = authoredAssetIdForCollisionObject(this.collisionTarget.objectKind);
    if (!assetId) return;
    const viewer = document.querySelector<HTMLSelectElement>("[data-viewer=asset]");
    if (viewer) viewer.value = assetId;
  }

  private reportCollision(message: string, error = false): void {
    const status = document.querySelector<HTMLOutputElement>("[data-collision=status]");
    if (!status) return;
    status.value = message;
    status.dataset.state = error ? "error" : "ready";
  }

  private fitCollisionTarget(): void {
    this.fitSelectedLibraryAsset();
  }

  private fitSelectedLibraryAsset(): void {
    const standalone = this.selectedStandaloneEntry();
    const width = standalone
      ? (this.comparisonVisual
        ? Math.max(1, this.comparisonVisual.getBounds().right - (this.referenceVisual?.getBounds().left ?? 0))
        : this.referenceVisual?.displayWidth ?? STAGE.width * 0.7)
      : Math.max(
        this.collisionTarget.width * this.collisionTarget.tileSize,
        this.collisionTarget.visualBounds.width,
      );
    const height = standalone
      ? Math.max(
        this.referenceVisual?.displayHeight ?? 0,
        this.comparisonVisual?.displayHeight ?? 0,
        STAGE.height * 0.45,
      )
      : Math.max(
        this.collisionTarget.height * this.collisionTarget.tileSize,
        this.collisionTarget.visualBounds.height,
      );
    const browserRect = this.assetLibraryBrowser?.getBoundingClientRect();
    const inspector = document.querySelector<HTMLElement>("#developer-tools-panel");
    const inspectorRect = inspector && !inspector.hidden ? inspector.getBoundingClientRect() : undefined;
    const stackedPanels = window.matchMedia("(max-width: 64rem)").matches;
    const browserWidth = stackedPanels ? 0 : browserRect?.width ?? 0;
    const inspectorWidth = stackedPanels ? 0 : inspectorRect?.width ?? 0;
    const topOccupied = stackedPanels && browserRect ? browserRect.bottom + 12 : 48;
    const bottomOccupied = stackedPanels && inspectorRect
      ? Math.max(0, this.scale.height - inspectorRect.top) + 12
      : 48;
    const availableWidth = Math.max(240, this.scale.width - browserWidth - inspectorWidth - 72);
    const availableHeight = Math.max(120, this.scale.height - topOccupied - bottomOccupied);
    const zoom = Phaser.Math.Clamp(
      Math.min(availableWidth / (width + 96), availableHeight / (height + 128)),
      0.3,
      2.5,
    );
    const horizontalOffset = (inspectorWidth - browserWidth) / (2 * zoom);
    const verticalOffset = stackedPanels ? (bottomOccupied - topOccupied) / (2 * zoom) : 0;
    this.cameras.main.centerOn(
      STAGE.centerX + horizontalOffset,
      STAGE.centerY + verticalOffset,
    ).setZoom(zoom);
  }

  private onCollisionKeyDown(event: KeyboardEvent): void {
    if (this.selectedStandaloneEntry() || this.domControlsFocused(event.target) || this.collisionSaveInFlight) return;
    if (event.code === "Space") {
      this.collisionSpaceHeld = true;
      event.preventDefault();
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.afterCollisionMutation(event.shiftKey ? this.collisionModel.redo() : this.collisionModel.undo());
    } else if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.afterCollisionMutation(this.collisionModel.redo());
    } else if (event.key === "Escape" && this.collisionSelection) {
      this.collisionSelection = undefined;
      this.syncCollisionControls();
      this.drawGuides();
    }
  }

  private domControlsFocused(target: EventTarget | null = document.activeElement): boolean {
    return target instanceof Element
      && target.closest("#developer-tools-panel, #asset-library-browser") !== null;
  }

  private mountCandidateWorkbench(
    slot: HTMLDivElement,
    signal: AbortSignal,
    assetSelect: HTMLSelectElement,
  ): void {
    const kind = slot.querySelector<HTMLSelectElement>("[data-workbench=kind]");
    const collisionIntent = slot.querySelector<HTMLSelectElement>("[data-workbench=collision-intent]");
    const metadataEditor = slot.querySelector<HTMLTextAreaElement>("[data-workbench=metadata]");
    const templateButton = slot.querySelector<HTMLButtonElement>("[data-workbench=template]");
    const bindingsButton = slot.querySelector<HTMLButtonElement>("[data-workbench=bindings]");
    const catalogImagesButton = slot.querySelector<HTMLButtonElement>("[data-workbench=catalog-images]");
    const imagesRoot = slot.querySelector<HTMLDivElement>("[data-workbench=images]");
    const validateButton = slot.querySelector<HTMLButtonElement>("[data-workbench=validate]");
    const exportButton = slot.querySelector<HTMLButtonElement>("[data-workbench=export]");
    const status = slot.querySelector<HTMLOutputElement>("[data-workbench-output=status]");
    if (
      !kind || !collisionIntent || !metadataEditor || !templateButton || !bindingsButton || !catalogImagesButton
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
    collisionIntent.addEventListener("change", resetCandidate, { signal });
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
      void this.buildCandidateBundle(
        metadataEditor.value,
        requirements,
        filesByImageId,
        collisionIntent.value as AssetCollisionIntent,
      )
        .then(async (bundle) => {
          this.validatedCandidate = bundle;
          const accepted = this.acceptedMetadata(bundle.metadata.assetId);
          if (!accepted) throw new RangeError(`Catalog metadata ${bundle.metadata.assetId} is unavailable`);
          const previewMetadata = mergeAssetCandidateMetadata(
            accepted,
            bundle.metadata,
            bundle.collisionIntent,
            (value) => this.validateCollisionMetadataExact(value),
          );
          await this.loadCandidatePreview({ ...bundle, metadata: previewMetadata });
          assetSelect.value = bundle.metadata.assetId;
          kind.value = bundle.metadata.assetId;
          exportButton.disabled = false;
          report(
            `Valid ${bundle.metadata.assetId} candidate previewed with ${bundle.collisionIntent} collision handling.`,
          );
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
    collisionIntent: AssetCollisionIntent,
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
      collisionIntent,
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
    this.activateCollisionTarget(
      this.collisionObjectKindForAsset(bundle.metadata.assetId),
      bundle.metadata,
      this.acceptedMetadata(bundle.metadata.assetId),
      false,
    );
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
        if (this.collisionSaveInFlight || !ASSET_IDS.includes(assetId)) return false;
        this.selectCatalogCollisionTarget(assetId);
        return true;
      },
      setHeading: (heading) => { this.state.heading = ((heading % 360) + 360) % 360; },
      setContrast: (fog, personal) => {
        this.state.showFog = fog;
        this.state.showPersonalOverlay = personal;
        this.drawContrast();
      },
      diagnostics: () => this.catalogAssets.diagnostics.map(({ assetId, message }) => `${assetId}: ${message}`),
      selectCollisionTarget: (objectKind) => {
        if (this.collisionSaveInFlight || !RUNTIME_COLLISION_OBJECT_KINDS.includes(objectKind)) return false;
        const assetId = authoredAssetIdForCollisionObject(objectKind);
        if (assetId) this.selectCatalogCollisionTarget(assetId);
        else {
          this.stashCurrentCollisionDraft();
          this.previewAssets = this.catalogAssets;
          this.activateCollisionTarget(objectKind);
        }
        return true;
      },
      collisionSnapshot: () => this.collisionModel.snapshot(),
      paintCollision: (x, y, solid = true) => {
        if (this.collisionSaveInFlight) return false;
        try {
          const changed = solid
            ? this.collisionModel.paintStroke([{ x, y }])
            : this.collisionModel.eraseStroke([{ x, y }]);
          this.afterCollisionMutation(changed);
          return changed;
        } catch {
          return false;
        }
      },
      undoCollision: () => {
        if (this.collisionSaveInFlight) return false;
        const changed = this.collisionModel.undo();
        this.afterCollisionMutation(changed);
        return changed;
      },
      redoCollision: () => {
        if (this.collisionSaveInFlight) return false;
        const changed = this.collisionModel.redo();
        this.afterCollisionMutation(changed);
        return changed;
      },
      collisionProfile: () => this.collisionModel.snapshot().profile,
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
    this.drawGuides();
    this.fitSelectedLibraryAsset();
  }

  private destroyBindings(): void {
    this.referenceLoadRevision++;
    this.controlsAbort?.abort();
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onCollisionPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onCollisionPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onCollisionPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onCollisionPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.homeVisual?.destroy();
    this.shipRenderer?.destroy();
    this.shoalVisual?.image.destroy();
    this.referenceVisual?.destroy();
    this.comparisonVisual?.destroy();
    for (const visual of this.additionalStandaloneVisuals) visual.destroy();
    this.additionalStandaloneVisuals = [];
    this.releaseReferenceTexture();
    this.assetLibraryBrowser?.remove();
    this.assetLibraryBrowser = undefined;
    this.productionIntakeUi?.destroy();
    this.productionIntakeUi = undefined;
    for (const key of this.candidateTextureKeys) this.textures.remove(key);
    this.candidateTextureKeys = [];
    delete window.__WAYFINDERS_ASSET_VIEWER__;
  }
}
