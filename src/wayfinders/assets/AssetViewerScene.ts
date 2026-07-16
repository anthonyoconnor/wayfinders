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
  groupAssetLibraryEntries,
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
import { assetTrialApplicationHref } from "./AssetAppMode";
import {
  PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION,
  PRODUCTION_CANDIDATE_SUBCELL_SIZE,
  PRODUCTION_CANDIDATE_TILE_SIZE,
  productionCandidateAuthoringRequestsEqual,
  productionCandidateDraftToEditorProfile,
  validateProductionCandidateAuthoringRequest,
  type ProductionCandidateAuthoredCollision,
  type ProductionCandidateAuthoringRequest,
} from "./ProductionCandidateAuthoring";
import {
  assetWorkspaceSceneKey,
  assetWorkspaceSelectionKey,
  type AssetWorkspaceModule,
} from "./workspaces/AssetWorkspace";

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

interface AssetViewerCursorKeys {
  readonly up: Phaser.Input.Keyboard.Key;
  readonly down: Phaser.Input.Keyboard.Key;
  readonly left: Phaser.Input.Keyboard.Key;
  readonly right: Phaser.Input.Keyboard.Key;
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
const PRODUCTION_CANDIDATE_VALIDATE_ROUTE = "/__wayfinders/assets/candidate/validate";
const PRODUCTION_CANDIDATE_SAVE_ROUTE = "/__wayfinders/assets/candidate/save";
const PRODUCTION_CANDIDATE_PROMOTION_ROUTE = "/__wayfinders/assets/candidate/promote";

type StandaloneLibraryEntry = ReferenceImageLibraryEntry | ProductionCandidateLibraryEntry;
type ProductionPreviewMode = "source" | "prepared" | "compare";
type ProductionReviewState = "pending" | "approved" | "rejected" | "stale";
type ProductionValidationState = "unchecked" | "validating" | "current" | "stale" | "error";
type ProductionCollisionSemantics = ProductionCandidateAuthoredCollision["kind"];

interface ProductionValidationStatus {
  readonly state: ProductionValidationState;
  readonly message: string;
}

interface ProductionAuthoringResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly recipeId?: string;
  readonly fingerprint?: string;
  readonly previousFingerprint?: string;
  readonly candidateFingerprint?: string;
  readonly validationState?: "current";
  readonly reviewState?: ProductionReviewState;
  readonly promotionState?: "published";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function collisionDraftMethodLabel(method: string): string {
  if (method === "prepared-alpha-connected-shoreline-v1") return "prepared alpha shoreline";
  if (method === "manual-blank-draft") return "manual blank draft";
  if (method === "semantic-mask-center-sample") return "semantic mask sample";
  if (method === "explicit-alpha-center-sample") return "explicit alpha sample";
  return method.replaceAll("-", " ");
}

export class AssetViewerScene extends Phaser.Scene {
  private readonly workspaceCatalog: readonly Readonly<AssetLibraryEntry>[];
  private readonly workspaceGroups;
  private readonly authoredAssetIds: readonly AuthoredAssetId[];
  private catalogAssets!: PilotAssetRuntime;
  private previewAssets!: AuthoredAssetRuntime;
  private state: ViewerState;
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
  private selectedLibraryAssetId: string;
  private readonly acceptedMetadataByAssetId = new Map<AuthoredAssetId, Readonly<AuthoredAssetMetadata>>();
  private readonly collisionDraftsByAssetId = new Map<AuthoredAssetId, RuntimeCollisionProfile>();
  private referenceLoadRevision = 0;
  private loadedReferenceTextureKeys: string[] = [];
  private readonly productionPreviewModes = new Map<string, ProductionPreviewMode>();
  private readonly productionCompareOpacity = new Map<string, number>();
  private readonly productionReviewStates = new Map<string, ProductionReviewState>();
  private readonly productionValidationStates = new Map<string, Readonly<ProductionValidationStatus>>();
  private readonly productionLocallyDirty = new Set<string>();
  private readonly islandNameDrafts = new Map<string, string>();
  private readonly productionAuthoringBaselines = new Map<
    string,
    Readonly<ProductionCandidateAuthoringRequest>
  >();
  private readonly productionCollisionSemantics = new Map<string, ProductionCollisionSemantics>();
  private readonly productionEmptyReasons = new Map<string, string>();
  private readonly productionHybridDrafts = new Map<
    string,
    Readonly<ProductionCandidateAuthoringRequest["collision"]>
  >();
  private readonly layerVisibility = new Map<string, boolean>();
  private readonly layerOpacity = new Map<string, number>();
  private productionReviewInFlight = false;
  private productionAuthoringInFlight = false;
  private productionPromotionInFlight = false;
  private productionEditorCandidateId?: string;
  private collisionSaveInFlight = false;
  private controlsAbort?: AbortController;
  private cursors?: Readonly<AssetViewerCursorKeys>;
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

  constructor(private readonly workspace: Readonly<AssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
    this.workspaceCatalog = Object.freeze(ASSET_LIBRARY_CATALOG.filter((entry) => workspace.accepts(entry)));
    this.workspaceGroups = groupAssetLibraryEntries(this.workspaceCatalog);
    this.authoredAssetIds = Object.freeze(this.workspaceCatalog
      .filter((entry) => entry.entryType === "authored-package")
      .map((entry) => entry.id as AuthoredAssetId));
    if (!this.workspaceCatalog.some((entry) => entry.id === workspace.initialAssetId)) {
      throw new RangeError(`Asset workspace ${workspace.id} has no initial asset ${workspace.initialAssetId}`);
    }
    this.state = {
      assetId: workspace.initialAssetId,
      heading: 0,
      speed: 48,
      seed: 71_041,
      animate: true,
      showFog: false,
      showPersonalOverlay: false,
      showOrigin: true,
      showFootprint: true,
    };
    this.selectedLibraryAssetId = workspace.initialAssetId;
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

    const initialMetadata = this.catalogAssets.metadata(this.state.assetId);
    if (!initialMetadata) throw new Error(`${this.state.assetId} is unavailable to collision authoring`);
    for (const assetId of ASSET_IDS) {
      const metadata = this.catalogAssets.metadata(assetId);
      if (metadata) this.acceptedMetadataByAssetId.set(assetId, metadata);
    }
    this.activateCollisionTarget(
      this.collisionObjectKindForAsset(this.state.assetId),
      initialMetadata,
      initialMetadata,
      false,
    );
    const restoredLibraryAssetId = sessionStorage.getItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY)
      ?? sessionStorage.getItem(assetWorkspaceSelectionKey(this.workspace.id));
    if (restoredLibraryAssetId && this.workspaceEntryById(restoredLibraryAssetId)) {
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
    this.cursors = this.input.keyboard?.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    }, false) as AssetViewerCursorKeys | undefined;
    this.zoomIn = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E, false);
    this.zoomOut = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Q, false);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.mountControls();
    this.installDebugApi();
    const restoredEntry = this.selectedLibraryEntry();
    if (restoredEntry.entryType === "production-candidate") {
      this.activateProductionCandidateEditor(restoredEntry);
      this.beginReferencePreviewLoad(restoredEntry);
    } else if (restoredEntry.entryType === "reference-image") {
      this.beginReferencePreviewLoad(restoredEntry);
    } else {
      this.rebuildPreview();
    }

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
    const entry = this.workspaceEntryById(this.selectedLibraryAssetId);
    if (!entry) throw new RangeError(`Unknown asset library entry ${this.selectedLibraryAssetId}`);
    return entry;
  }

  private workspaceEntryById(id: string): Readonly<AssetLibraryEntry> | undefined {
    return this.workspaceCatalog.find((entry) => entry.id === id);
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

  private productionCandidateDimensions(
    entry: Readonly<ProductionCandidateLibraryEntry>,
  ): Readonly<{ width: number; height: number }> {
    const firstLayer = entry.recipe.layers[0];
    if (!firstLayer) throw new RangeError(`${entry.id} has no authorable layers`);
    const width = firstLayer.preparation.targetWidth;
    const height = firstLayer.preparation.targetHeight;
    if (entry.recipe.layers.some((layer) =>
      layer.preparation.targetWidth !== width || layer.preparation.targetHeight !== height)) {
      throw new RangeError(`${entry.id} layers do not share one candidate canvas`);
    }
    return Object.freeze({ width, height });
  }

  private productionCandidateAuthoredCollision(
    entry: Readonly<ProductionCandidateLibraryEntry>,
  ): Readonly<ProductionCandidateAuthoredCollision> {
    const draft = entry.collisionDraft;
    if (draft.kind === "hybrid-grid-draft") {
      return Object.freeze({
        kind: "hybrid-grid-draft",
        tileSize: PRODUCTION_CANDIDATE_TILE_SIZE,
        subcellSize: PRODUCTION_CANDIDATE_SUBCELL_SIZE,
        grid: Object.freeze({ ...draft.grid }),
        solidSubcells: Object.freeze(draft.solidSubcells.map((point) => Object.freeze({ ...point }))),
      });
    }
    if (draft.kind === "empty") {
      return Object.freeze({ kind: "empty", passable: true, reason: draft.reason });
    }
    throw new RangeError(`${entry.id} preserves runtime collision and is not authorable as a pending mask`);
  }

  private activateProductionCandidateEditor(entry: Readonly<ProductionCandidateLibraryEntry>): void {
    const collision = this.productionCandidateAuthoredCollision(entry);
    const dimensions = this.productionCandidateDimensions(entry);
    this.productionEditorCandidateId = entry.id;
    this.productionCollisionSemantics.set(entry.id, collision.kind);
    if (collision.kind === "hybrid-grid-draft") {
      this.productionHybridDrafts.set(entry.id, collision);
    } else {
      this.productionEmptyReasons.set(entry.id, collision.reason);
    }
    this.productionAuthoringBaselines.set(entry.id, this.productionCandidateSavedRequest(entry));
    this.activateProductionCandidateCollisionTarget(entry, dimensions.width, dimensions.height, collision);
    this.renderProductionAuthoringForm(entry);
    this.syncSelectedAssetUi();
    void this.validateProductionCandidate();
  }

  private activateProductionCandidateCollisionTarget(
    entry: Readonly<ProductionCandidateLibraryEntry>,
    targetWidth: number,
    targetHeight: number,
    collision: Readonly<ProductionCandidateAuthoredCollision>,
  ): void {
    const profile = productionCandidateDraftToEditorProfile(collision);
    const hybrid = collision.kind === "hybrid-grid-draft";
    const width = hybrid ? collision.grid.width : Math.max(1, Math.ceil(targetWidth / PRODUCTION_CANDIDATE_TILE_SIZE));
    const height = hybrid ? collision.grid.height : Math.max(1, Math.ceil(targetHeight / PRODUCTION_CANDIDATE_TILE_SIZE));
    this.collisionTarget = Object.freeze({
      objectKind: hybrid ? "generated-island" : "fishing-shoal",
      label: entry.name,
      source: "developer-metadata",
      editing: hybrid ? "hybrid-grid" : "explicit-empty",
      editingNote: hybrid
        ? "Edit the pending candidate's canonical 32/8 px collision mask. Save candidate persists it."
        : "This pending candidate is explicitly passable and has no solid collision mask.",
      width,
      height,
      tileSize: PRODUCTION_CANDIDATE_TILE_SIZE,
      baseMasks: Object.freeze(Array.from({ length: width * height }, () => 0)),
      profile,
      anchors: Object.freeze([]),
      visualBounds: Object.freeze({ width: targetWidth, height: targetHeight }),
    });
    this.collisionModel = this.createCollisionModel(this.collisionTarget);
    this.collisionAcceptedMetadata = undefined;
    this.validatedCollisionCandidate = undefined;
    this.collisionSelection = undefined;
    this.collisionSelectionStart = undefined;
    this.collisionHover = undefined;
    this.collisionStrokePoints = undefined;
    this.collisionPanGesture = undefined;
    this.collisionProbeWorld = Object.freeze({ x: STAGE.centerX, y: STAGE.centerY });
    this.syncCollisionControls();
    this.reportCollision(this.collisionTarget.editingNote);
    this.drawGuides();
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
    this.collisionGraphics.clear();
    if (!this.state.showFootprint || this.productionEditorCandidateId !== entry.id || !visual?.visible) return;
    this.drawCollisionOverlay();
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
      const mode = this.productionPreviewModes.get(candidate.id) ?? "prepared";
      const preparedVisual = mode === "compare"
        ? this.comparisonVisual
        : mode === "prepared"
          ? this.referenceVisual
          : undefined;
      this.drawProductionCollisionOverlay(candidate, preparedVisual);
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
    const candidate = this.selectedProductionCandidate();
    if (candidate && this.productionEditorCandidateId === candidate.id) {
      const mode = this.productionPreviewModes.get(candidate.id) ?? "prepared";
      const visual = mode === "compare" ? this.comparisonVisual : mode === "prepared" ? this.referenceVisual : undefined;
      if (visual?.visible) {
        const bounds = visual.getBounds();
        return Object.freeze({
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        });
      }
    }
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
    const displayTileWidth = rect.width / target.width;
    const displayTileHeight = rect.height / target.height;
    const displaySubcellWidth = displayTileWidth / COLLISION_SUBCELLS_PER_TILE;
    const displaySubcellHeight = displayTileHeight / COLLISION_SUBCELLS_PER_TILE;

    if (snapshot.masks) {
      graphics.fillStyle(0xff4e4e, 0.26);
      for (let cellY = 0; cellY < target.height; cellY++) {
        for (let cellX = 0; cellX < target.width; cellX++) {
          const mask = snapshot.masks[cellY * target.width + cellX];
          for (let subY = 0; subY < COLLISION_SUBCELLS_PER_TILE; subY++) {
            for (let subX = 0; subX < COLLISION_SUBCELLS_PER_TILE; subX++) {
              if (!isCollisionSubcellSolid(mask, subX, subY)) continue;
              graphics.fillRect(
                rect.left + cellX * displayTileWidth + subX * displaySubcellWidth,
                rect.top + cellY * displayTileHeight + subY * displaySubcellHeight,
                displaySubcellWidth,
                displaySubcellHeight,
              );
            }
          }
        }
      }
      graphics.lineStyle(1, 0xa4d9d3, 0.18);
      const subcellWidth = target.width * COLLISION_SUBCELLS_PER_TILE;
      const subcellHeight = target.height * COLLISION_SUBCELLS_PER_TILE;
      for (let x = 0; x <= subcellWidth; x++) {
        const worldX = rect.left + x * displaySubcellWidth;
        graphics.lineBetween(worldX, rect.top, worldX, rect.top + rect.height);
      }
      for (let y = 0; y <= subcellHeight; y++) {
        const worldY = rect.top + y * displaySubcellHeight;
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
      const worldX = rect.left + x * displayTileWidth;
      graphics.lineBetween(worldX, rect.top, worldX, rect.top + rect.height);
    }
    for (let y = 0; y <= target.height; y++) {
      const worldY = rect.top + y * displayTileHeight;
      graphics.lineBetween(rect.left, worldY, rect.left + rect.width, worldY);
    }

    if (this.state.showFootprint) {
      const candidate = this.selectedProductionCandidate();
      graphics.lineStyle(2, 0x83fff0, 0.8).strokeRect(
        candidate ? rect.left : STAGE.centerX - target.visualBounds.width / 2,
        candidate ? rect.top : STAGE.centerY - target.visualBounds.height / 2,
        candidate ? rect.width : target.visualBounds.width,
        candidate ? rect.height : target.visualBounds.height,
      );
      for (const anchor of target.anchors) {
        const x = rect.left + (anchor.x + 0.5) * displayTileWidth;
        const y = rect.top + (anchor.y + 0.5) * displayTileHeight;
        graphics.fillStyle(anchor.requiredClearance ? 0xffd47a : 0xf1f6c7, 0.95).fillCircle(x, y, 4);
        graphics.lineStyle(1, 0x041419, 0.9).strokeCircle(x, y, 5);
      }
    }

    if (this.state.showOrigin) {
      let originX = STAGE.centerX;
      let originY = STAGE.centerY;
      const metadata = target.packageMetadata;
      if (metadata?.kind === "home-island") {
        originX = rect.left + (metadata.grid.placementOrigin.x + 0.5) * displayTileWidth;
        originY = rect.top + (metadata.grid.placementOrigin.y + 0.5) * displayTileHeight;
      }
      graphics.lineStyle(2, 0xffd47a, 0.95);
      graphics.lineBetween(originX - 14, originY, originX + 14, originY);
      graphics.lineBetween(originX, originY - 14, originX, originY + 14);
      graphics.strokeCircle(originX, originY, 5);
    }

    if (this.collisionSelection) {
      const selection = this.collisionSelection;
      graphics.fillStyle(0x4bd6ff, 0.12).fillRect(
        rect.left + selection.x * displaySubcellWidth,
        rect.top + selection.y * displaySubcellHeight,
        selection.width * displaySubcellWidth,
        selection.height * displaySubcellHeight,
      );
      graphics.lineStyle(2, 0x4bd6ff, 0.95).strokeRect(
        rect.left + selection.x * displaySubcellWidth,
        rect.top + selection.y * displaySubcellHeight,
        selection.width * displaySubcellWidth,
        selection.height * displaySubcellHeight,
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
        rect.left + first.x * displaySubcellWidth,
        rect.top + first.y * displaySubcellHeight,
        hoverBrushSize * displaySubcellWidth,
        hoverBrushSize * displaySubcellHeight,
      );
    }
    if (this.collisionStrokePoints) {
      const solid = this.collisionTool === "paint";
      graphics.fillStyle(solid ? 0xff7b5e : 0x5ec8ff, 0.58);
      for (const point of this.collisionStrokePoints.values()) {
        graphics.fillRect(
          rect.left + point.x * displaySubcellWidth,
          rect.top + point.y * displaySubcellHeight,
          displaySubcellWidth,
          displaySubcellHeight,
        );
      }
    }

    const probeWorld = this.collisionProbeWorld ?? { x: STAGE.centerX, y: STAGE.centerY };
    const modelScaleX = snapshot.masks ? PRODUCTION_CANDIDATE_TILE_SIZE / displayTileWidth : 1;
    const modelScaleY = snapshot.masks ? PRODUCTION_CANDIDATE_TILE_SIZE / displayTileHeight : 1;
    const probeInput = snapshot.masks
      ? {
        centerX: (probeWorld.x - rect.left) * modelScaleX,
        centerY: (probeWorld.y - rect.top) * modelScaleY,
      }
      : { centerX: probeWorld.x - STAGE.centerX, centerY: probeWorld.y - STAGE.centerY };
    const probe = this.collisionModel.probeHull({
      ...probeInput,
      halfWidth: AUTHORITATIVE_SHIP_HALF_EXTENT * modelScaleX,
      halfHeight: AUTHORITATIVE_SHIP_HALF_EXTENT * modelScaleY,
      outsideIsSolid: false,
    });
    const displayProbeHalfWidth = snapshot.masks
      ? AUTHORITATIVE_SHIP_HALF_EXTENT / modelScaleX
      : AUTHORITATIVE_SHIP_HALF_EXTENT;
    const displayProbeHalfHeight = snapshot.masks
      ? AUTHORITATIVE_SHIP_HALF_EXTENT / modelScaleY
      : AUTHORITATIVE_SHIP_HALF_EXTENT;
    graphics.fillStyle(probe.collides ? 0xff4949 : 0x53e18d, 0.12).fillRect(
      probeWorld.x - displayProbeHalfWidth,
      probeWorld.y - displayProbeHalfHeight,
      displayProbeHalfWidth * 2,
      displayProbeHalfHeight * 2,
    );
    graphics.lineStyle(2, probe.collides ? 0xff4949 : 0x53e18d, 0.95).strokeRect(
      probeWorld.x - displayProbeHalfWidth,
      probeWorld.y - displayProbeHalfHeight,
      displayProbeHalfWidth * 2,
      displayProbeHalfHeight * 2,
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
    const displaySubcellWidth = rect.width
      / (this.collisionTarget.width * COLLISION_SUBCELLS_PER_TILE);
    const displaySubcellHeight = rect.height
      / (this.collisionTarget.height * COLLISION_SUBCELLS_PER_TILE);
    const x = Math.floor((worldX - rect.left) / displaySubcellWidth);
    const y = Math.floor((worldY - rect.top) / displaySubcellHeight);
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
    if (this.selectedReferenceEntry() || this.collisionSaveInFlight || this.productionAuthoringInFlight) return;
    const selectedCandidate = this.selectedProductionCandidate();
    if (selectedCandidate
      && (this.productionPreviewModes.get(selectedCandidate.id) ?? "prepared") === "source") return;
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
    if (this.selectedReferenceEntry() || this.collisionSaveInFlight || this.productionAuthoringInFlight) return;
    const selectedCandidate = this.selectedProductionCandidate();
    if (selectedCandidate
      && (this.productionPreviewModes.get(selectedCandidate.id) ?? "prepared") === "source") return;
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
    if (this.collisionSaveInFlight || this.productionAuthoringInFlight) {
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
    if (this.workspace.id === "islands") {
      this.mountIslandControls(slot, signal);
      return;
    }
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
          <form data-production-authoring="form" class="production-authoring-form">
            <header>
              <div><p class="eyebrow">Persisted candidate recipe</p><h4>Finish this asset</h4></div>
              <span data-production="validation-badge" class="production-state-badge">Unchecked</span>
            </header>
            <div class="production-authoring-fields">
              <label>Name <input data-production-authoring="name" type="text" maxlength="120" required></label>
              <label>Family
                <select data-production-authoring="family">
                  <option value="island">Island</option>
                  <option value="vessel">Vessel</option>
                  <option value="shoal">Shoal</option>
                  <option value="world-feature">World feature</option>
                  <option value="environment">Environment</option>
                </select>
              </label>
              <label>Canvas width <input data-production-authoring="width" type="number" min="1" max="4096" step="1" required></label>
              <label>Canvas height <input data-production-authoring="height" type="number" min="1" max="4096" step="1" required></label>
              <label>Collision semantics
                <select data-production-authoring="collision-semantics">
                  <option value="hybrid-grid-draft">Solid 32/8 px mask</option>
                  <option value="empty">Explicitly passable</option>
                </select>
              </label>
              <label>Test binding
                <select data-production-authoring="runtime-binding">
                  <option value="">No runtime binding</option>
                  ${this.authoredAssetIds.map((assetId) => `<option value="${escapeHtml(assetId)}">${escapeHtml(assetId)}</option>`).join("")}
                </select>
              </label>
            </div>
            <fieldset class="production-layer-authoring">
              <legend>Persisted layer order, visibility and opacity</legend>
              <div data-production-authoring="layers"></div>
            </fieldset>
            <p data-production-authoring="collision-note" class="production-review-notice"></p>
            <div class="production-authoring-actions">
              <button data-production-action="validate" type="button">Validate current</button>
              <button data-production-action="save" type="button">Save candidate</button>
            </div>
            <output data-production="validation-status" class="asset-viewer-diagnostics" aria-live="polite"></output>
          </form>
          <section class="production-preview-only" aria-label="Preview-only controls">
            <header><p class="eyebrow">Preview only</p><h4>Display controls (not saved)</h4></header>
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
          </section>
          <section class="production-lifecycle-actions" aria-label="Candidate review and publication">
            <header><p class="eyebrow">Persisted lifecycle</p><h4>Review, trial and publish</h4></header>
            <div class="production-review-actions">
              <button data-production-review-action="approved" type="button">Approve current</button>
              <button data-production-review-action="rejected" type="button">Reject current</button>
              <button data-production-action="promote" type="button">Promote approved</button>
              <a data-production="trial-link" class="production-test-link" href="#">Trial candidate</a>
            </div>
            <output data-production="status" class="asset-viewer-diagnostics" aria-live="polite"></output>
          </section>
        </section>
        <details class="asset-selection-overview">
          <summary>Preview-only asset overview, layers and animation</summary>
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
      <details class="asset-inspector-section" data-collision-editor-section open>
        <summary>Collision</summary>
        <section class="collision-workbench" aria-labelledby="collision-workbench-title">
          <header>
            <div>
              <p class="eyebrow" data-collision="eyebrow">Live package editor</p>
              <h3 id="collision-workbench-title" data-collision="title">Collision authoring</h3>
            </div>
            <button data-collision="fit" type="button">Fit</button>
          </header>
          <label class="collision-target-row" data-package-collision-only>Runtime profile
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
          <button data-collision="save" data-package-collision-only class="collision-save-button" type="button">Save to library</button>
          <output data-collision="status" class="asset-viewer-diagnostics" aria-live="polite"></output>
          <details class="collision-portable" data-package-collision-only>
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
    for (const assetId of this.authoredAssetIds) assetSelect.add(new Option(assetId, assetId));
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
      if (this.authoredAssetIds.includes(assetSelect.value as AuthoredAssetId)) {
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
      ? `${this.authoredAssetIds.length} packages loaded with complete textures.`
      : this.catalogAssets.diagnostics.map(({ assetId, message }) => `${assetId}: ${message}`).join("\n");
    this.mountCollisionWorkbench(slot, signal);
    this.mountCandidateWorkbench(slot, signal, assetSelect);
    this.productionIntakeUi ??= mountProductionAssetIntakeUi({
      existingAssets: this.workspaceCatalog
        .filter((entry) => entry.entryType !== "reference-image")
        .map(({ id, name }) => ({ id, name })),
    });
    this.mountAssetLibraryBrowser(signal);
    this.mountSelectedAssetControls(slot, signal);
    this.syncSelectedAssetUi();
  }

  private mountIslandControls(slot: HTMLDivElement, signal: AbortSignal): void {
    slot.innerHTML = `
      <section class="island-workbench" aria-labelledby="island-workbench-title">
        <header class="island-workbench__header">
          <div>
            <p class="eyebrow">Selected island</p>
            <h3 id="island-workbench-title" data-island="title"></h3>
            <p data-island="subtitle" class="asset-selection-subtitle"></p>
          </div>
          <button data-island-action="fit" type="button">Fit</button>
        </header>
        <form data-island="properties" class="island-properties">
          <label>Name
            <input data-island="name" type="text" maxlength="120" required>
          </label>
          <label class="island-availability">
            <input data-island="available" type="checkbox" disabled>
            <span>Available in game</span>
          </label>
          <p data-island="availability-status" class="island-availability-status"></p>
        </form>
        <div class="island-workbench__actions">
          <a data-island-action="trial" class="production-test-link" href="#">View with ship</a>
          <button data-island-action="save" type="button">Save changes</button>
        </div>
        <output data-island="status" class="asset-viewer-diagnostics" aria-live="polite"></output>
      </section>
      <section class="island-collision-workbench" aria-labelledby="island-collision-title">
        <header>
          <div><p class="eyebrow">Collision mask</p><h3 id="island-collision-title">Collision editing</h3></div>
          <button data-collision="fit" type="button">Fit</button>
        </header>
        <p data-collision="note" class="collision-note"></p>
        <div class="collision-legend" aria-label="Collision overlay legend">
          <span><i data-swatch="solid"></i>Solid</span>
          <span><i data-swatch="coarse"></i>32 px grid</span>
          <span><i data-swatch="fine"></i>8 px subgrid</span>
          <span><i data-swatch="clearance"></i>Ship clearance</span>
        </div>
        <div class="collision-brush-toolbar">
          <span>Brush size</span>
          <div class="collision-segmented" role="group" aria-label="Collision brush size">
            <button data-collision-brush="1" type="button">8 px detail</button>
            <button data-collision-brush="4" type="button">32 px cell</button>
          </div>
        </div>
        <div class="collision-tool-grid" role="group" aria-label="Collision tools">
          <button data-collision-tool="paint" type="button">Paint</button>
          <button data-collision-tool="erase" type="button">Erase</button>
        </div>
        <div class="collision-history-actions">
          <button data-collision="undo" type="button">Undo</button>
          <button data-collision="redo" type="button">Redo</button>
          <button data-collision="reset" type="button">Reset edits</button>
        </div>
      </section>`;

    slot.querySelector<HTMLButtonElement>("[data-island-action=fit]")
      ?.addEventListener("click", () => this.fitSelectedLibraryAsset(), { signal });
    slot.querySelector<HTMLButtonElement>("[data-collision=fit]")
      ?.addEventListener("click", () => this.fitCollisionTarget(), { signal });
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
    slot.querySelector<HTMLButtonElement>("[data-collision=undo]")
      ?.addEventListener("click", () => this.afterCollisionMutation(this.collisionModel.undo()), { signal });
    slot.querySelector<HTMLButtonElement>("[data-collision=redo]")
      ?.addEventListener("click", () => this.afterCollisionMutation(this.collisionModel.redo()), { signal });
    slot.querySelector<HTMLButtonElement>("[data-collision=reset]")
      ?.addEventListener("click", () => this.afterCollisionMutation(this.collisionModel.reset()), { signal });
    slot.querySelector<HTMLInputElement>("[data-island=name]")?.addEventListener("input", (event) => {
      const entry = this.selectedProductionCandidate();
      if (entry) {
        this.islandNameDrafts.set(entry.id, (event.currentTarget as HTMLInputElement).value);
        this.productionLocallyDirty.add(entry.id);
      }
      this.syncIslandWorkbench();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-island-action=save]")
      ?.addEventListener("click", () => { void this.saveIslandChanges(); }, { signal });
    slot.querySelector<HTMLAnchorElement>("[data-island-action=trial]")
      ?.addEventListener("click", (event) => {
        const link = event.currentTarget as HTMLAnchorElement;
        if (link.getAttribute("aria-disabled") === "true") event.preventDefault();
        else {
          const entry = this.selectedProductionCandidate();
          if (entry) sessionStorage.setItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY, entry.id);
        }
      }, { signal });
    window.addEventListener("keydown", (event) => this.onCollisionKeyDown(event), { signal });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") this.collisionSpaceHeld = false;
    }, { signal });

    this.productionIntakeUi ??= mountProductionAssetIntakeUi({
      focusedFamily: "island",
      existingAssets: this.workspaceCatalog
        .filter((entry) => entry.entryType !== "reference-image")
        .map(({ id, name }) => ({ id, name })),
    });
    this.mountAssetLibraryBrowser(signal);
    this.syncSelectedAssetUi();
    this.syncCollisionControls();
  }

  private islandCandidateAuthoringRequest(
    entry: Readonly<ProductionCandidateLibraryEntry>,
    name: string,
  ): Readonly<ProductionCandidateAuthoringRequest> {
    if (entry.recipe.family !== "island") throw new RangeError("The selected asset is not an island");
    const dimensions = this.productionCandidateDimensions(entry);
    return validateProductionCandidateAuthoringRequest({
      formatVersion: PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION,
      recipeId: entry.id,
      candidateFingerprint: entry.fingerprint,
      settings: {
        name: name.trim(),
        family: "island",
        targetWidth: dimensions.width,
        targetHeight: dimensions.height,
        layers: entry.recipe.layers.map((layer) => ({
          id: layer.id,
          defaultVisible: layer.defaultVisible,
          opacity: layer.opacity,
        })),
        runtimeBindingAssetId: null,
      },
      collision: this.productionHybridCollisionFromModel(dimensions.width, dimensions.height),
    });
  }

  private syncIslandWorkbench(): void {
    if (this.workspace.id !== "islands") return;
    const entry = this.selectedLibraryEntry();
    const title = document.querySelector<HTMLElement>("[data-island=title]");
    const subtitle = document.querySelector<HTMLElement>("[data-island=subtitle]");
    const name = document.querySelector<HTMLInputElement>("[data-island=name]");
    const available = document.querySelector<HTMLInputElement>("[data-island=available]");
    const availabilityStatus = document.querySelector<HTMLElement>("[data-island=availability-status]");
    const trial = document.querySelector<HTMLAnchorElement>("[data-island-action=trial]");
    const save = document.querySelector<HTMLButtonElement>("[data-island-action=save]");
    if (title) title.textContent = entry.name;
    if (subtitle) subtitle.textContent = entry.subtitle;
    if (name && document.activeElement !== name) name.value = this.islandNameDrafts.get(entry.id) ?? entry.name;
    if (name) name.disabled = entry.entryType !== "production-candidate" || this.productionAuthoringInFlight;
    const isAvailable = entry.entryType === "authored-package";
    if (available) available.checked = isAvailable;
    if (availabilityStatus) availabilityStatus.textContent = isAvailable
      ? "Available in game"
      : "Unavailable in game";

    const candidate = entry.entryType === "production-candidate" ? entry : undefined;
    const locallyDirty = candidate !== undefined && this.productionLocallyDirty.has(candidate.id);
    const collision = this.collisionModel.snapshot();
    let requestError: string | undefined;
    if (candidate && name) {
      try { this.islandCandidateAuthoringRequest(candidate, name.value); }
      catch (error) { requestError = this.errorMessage(error); }
    }
    if (save) {
      const needsCanonicalMask = candidate?.collisionDraft.kind === "hybrid-grid-draft"
        && candidate.recipe.collision.mode !== "mask-file";
      const changed = candidate ? locallyDirty || needsCanonicalMask : collision.dirty;
      save.disabled = this.productionAuthoringInFlight
        || this.collisionSaveInFlight
        || requestError !== undefined
        || !changed;
      save.textContent = this.productionAuthoringInFlight || this.collisionSaveInFlight
        ? "Saving…"
        : "Save changes";
      save.title = requestError ?? (changed ? "Save island properties and collision mask" : "No unsaved changes");
    }
    if (trial) {
      const canTrial = candidate !== undefined
        && candidate.collisionDraft.kind === "hybrid-grid-draft"
        && !locallyDirty
        && !this.productionAuthoringInFlight;
      if (canTrial) {
        trial.href = assetTrialApplicationHref({
          candidateId: candidate.id,
          candidateFingerprint: candidate.fingerprint,
        });
      } else {
        trial.removeAttribute("href");
      }
      trial.setAttribute("aria-disabled", String(!canTrial));
      trial.title = candidate
        ? canTrial ? "Open this island with the ship" : "Save changes before viewing with the ship"
        : "The built-in home island does not need an isolated trial";
    }
  }

  private async saveIslandChanges(): Promise<void> {
    const entry = this.selectedLibraryEntry();
    if (entry.entryType === "authored-package") {
      await this.saveCollisionToLibrary();
      this.syncIslandWorkbench();
      return;
    }
    if (entry.entryType !== "production-candidate" || this.productionAuthoringInFlight) return;
    const name = document.querySelector<HTMLInputElement>("[data-island=name]");
    if (!name) return;
    try {
      const request = this.islandCandidateAuthoringRequest(entry, name.value);
      this.productionAuthoringInFlight = true;
      this.syncIslandWorkbench();
      this.reportIslandStatus("Saving changes…");
      sessionStorage.setItem(assetWorkspaceSelectionKey(this.workspace.id), entry.id);
      sessionStorage.setItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY, entry.id);
      const response = await fetch(PRODUCTION_CANDIDATE_SAVE_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => undefined) as ProductionAuthoringResponse | undefined;
      if (!response.ok || payload?.ok !== true || !payload.fingerprint) {
        throw new Error(payload?.error ?? `Save failed with HTTP ${response.status}`);
      }
      this.productionLocallyDirty.delete(entry.id);
      this.reportIslandStatus(payload.message ?? "Changes saved.");
      window.location.reload();
    } catch (error) {
      this.reportIslandStatus(this.errorMessage(error), true);
    } finally {
      this.productionAuthoringInFlight = false;
      this.syncIslandWorkbench();
    }
  }

  private reportIslandStatus(message: string, error = false): void {
    const status = document.querySelector<HTMLOutputElement>("[data-island=status]");
    if (!status) return;
    status.value = message;
    status.dataset.state = error ? "error" : "ready";
  }

  private mountAssetLibraryBrowser(signal: AbortSignal): void {
    const host = document.querySelector<HTMLElement>(".game-region");
    if (!host) return;
    const browser = this.assetLibraryBrowser ?? document.createElement("aside");
    browser.id = "asset-library-browser";
    browser.className = "asset-library-browser";
    browser.setAttribute("aria-label", "Asset library browser");
    const focusedIslands = this.workspace.id === "islands";
    const groups = this.workspaceGroups.map((group) => `
      <section class="asset-library-group" data-library-group="${escapeHtml(group.id)}">
        <header><h3>${escapeHtml(group.name)}</h3><span>${group.entries.length}</span></header>
        <div class="asset-library-list">
          ${group.entries.map((entry) => {
            const settlement = entry.entryType === "reference-image"
              ? entry.reference.settlement ?? entry.reference.kind
              : entry.entryType === "production-candidate"
                ? entry.reviewState
                : "runtime";
            const status = focusedIslands
              ? entry.entryType === "authored-package" ? "Available" : entry.entryType === "production-candidate" ? "Unavailable" : "Reference"
              : entry.entryType === "authored-package"
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
                data-library-availability="${entry.entryType === "authored-package" ? "available" : "unavailable"}"
                data-library-search="${escapeHtml(`${entry.name} ${entry.subtitle} ${entry.id} ${entry.tags.join(" ")}`.toLowerCase())}"
              >
                <span class="asset-library-thumb"><img loading="lazy" decoding="async" alt="" data-library-thumb-src="${escapeHtml(entry.thumbnailUrl)}"></span>
                <span class="asset-library-item-copy">
                  <strong>${escapeHtml(entry.name)}</strong>
                  <small>${escapeHtml(focusedIslands && entry.entryType === "production-candidate" ? "Imported island" : entry.subtitle)}</small>
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
        <div><p class="eyebrow">Wayfinders workshop</p><h2>${focusedIslands ? "Islands" : "Asset library"}</h2></div>
        <div class="asset-library-header-actions">
          <span>${this.workspaceCatalog.length} assets</span>
          <button data-library-intake-new type="button">Add PNG</button>
        </div>
      </header>
      <div class="asset-library-filters">
        <label><span>Search</span><input data-library-search type="search" placeholder="Name, tag, or ID"></label>
        <label><span>Show</span>
          <select data-library-filter>
            <option value="all">${focusedIslands ? "All islands" : "All assets"}</option>
            ${focusedIslands ? `
            <option value="available">Available in game</option>
            <option value="unavailable">Unavailable in game</option>` : `
            <option value="authored-package">Runtime packages</option>
            <option value="production-candidate">Production candidates</option>
            <option value="reference-image">Source examples</option>
            <option value="inhabited">Inhabited islands</option>
            <option value="uninhabited">Uninhabited islands</option>`}
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
          || item.dataset.librarySettlement === mode
          || item.dataset.libraryAvailability === mode;
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
          sourceUrl: entry.layers[0]?.url ?? entry.thumbnailUrl,
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
    const authoringForm = slot.querySelector<HTMLFormElement>("[data-production-authoring=form]");
    authoringForm?.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      const layerRow = input.closest<HTMLElement>("[data-production-layer-id]");
      if (layerRow && input.matches("[data-production-layer-opacity]")) {
        const output = layerRow.querySelector<HTMLOutputElement>("[data-production-layer-opacity-output]");
        if (output) output.value = `${Math.round(Number(input.value) * 100)}%`;
      }
      this.markProductionCandidateStale("Unsaved candidate settings or collision edits require validation.");
    }, { signal });
    authoringForm?.addEventListener("change", (event) => {
      const control = event.target as HTMLElement;
      if (control.matches(
        "[data-production-authoring=width], [data-production-authoring=height], [data-production-authoring=collision-semantics]",
      )) this.applyProductionCandidateShapeControls();
      this.syncProductionAuthoringControls();
    }, { signal });
    authoringForm?.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-production-layer-move]");
      if (!button) return;
      const row = button.closest<HTMLElement>("[data-production-layer-id]");
      const direction = Number(button.dataset.productionLayerMove);
      if (!row || (direction !== -1 && direction !== 1)) return;
      const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
      if (!(sibling instanceof HTMLElement)) return;
      if (direction < 0) row.parentElement?.insertBefore(row, sibling);
      else row.parentElement?.insertBefore(sibling, row);
      this.markProductionCandidateStale("Layer order changed; save and validate the candidate.");
      this.syncProductionLayerMoveControls();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-production-action=validate]")
      ?.addEventListener("click", () => { void this.validateProductionCandidate(); }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-production-action=save]")
      ?.addEventListener("click", () => { void this.saveProductionCandidate(); }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-production-action=promote]")
      ?.addEventListener("click", () => { void this.promoteProductionCandidate(); }, { signal });
    slot.querySelector<HTMLAnchorElement>("[data-production=trial-link]")
      ?.addEventListener("click", (event) => {
        const entry = this.selectedProductionCandidate();
        if (!entry) return;
        if (
          this.productionAuthoringInFlight
          || this.productionLocallyDirty.has(entry.id)
          || entry.recipe.family !== "island"
          || entry.collisionDraft.kind !== "hybrid-grid-draft"
        ) {
          event.preventDefault();
          this.reportProductionReview("Save a current island collision draft before launching its sea trial.", true);
          return;
        }
        sessionStorage.setItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY, entry.id);
      }, { signal });
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

  private renderProductionAuthoringForm(entry: Readonly<ProductionCandidateLibraryEntry>): void {
    const form = document.querySelector<HTMLFormElement>("[data-production-authoring=form]");
    if (!form) return;
    const dimensions = this.productionCandidateDimensions(entry);
    const name = form.querySelector<HTMLInputElement>("[data-production-authoring=name]");
    const family = form.querySelector<HTMLSelectElement>("[data-production-authoring=family]");
    const width = form.querySelector<HTMLInputElement>("[data-production-authoring=width]");
    const height = form.querySelector<HTMLInputElement>("[data-production-authoring=height]");
    const semantics = form.querySelector<HTMLSelectElement>("[data-production-authoring=collision-semantics]");
    const binding = form.querySelector<HTMLSelectElement>("[data-production-authoring=runtime-binding]");
    const layers = form.querySelector<HTMLElement>("[data-production-authoring=layers]");
    if (!name || !family || !width || !height || !semantics || !binding || !layers) return;
    name.value = entry.recipe.name;
    family.value = entry.recipe.family;
    width.value = String(dimensions.width);
    height.value = String(dimensions.height);
    semantics.value = this.productionCollisionSemantics.get(entry.id) ?? entry.collisionDraft.kind;
    binding.value = entry.recipe.runtimeBinding?.assetId ?? "";
    layers.innerHTML = entry.recipe.layers.map((layer) => `
      <div class="production-layer-authoring-row" data-production-layer-id="${escapeHtml(layer.id)}">
        <div class="production-layer-order-actions">
          <button data-production-layer-move="-1" type="button" aria-label="Move ${escapeHtml(layer.name)} earlier">&uarr;</button>
          <button data-production-layer-move="1" type="button" aria-label="Move ${escapeHtml(layer.name)} later">&darr;</button>
        </div>
        <strong>${escapeHtml(layer.name)}</strong>
        <code>${escapeHtml(layer.id)}</code>
        <label><input data-production-layer-visible type="checkbox" ${layer.defaultVisible ? "checked" : ""}> Visible by default</label>
        <label>Opacity
          <input data-production-layer-opacity type="range" min="0" max="1" step="0.05" value="${layer.opacity}">
          <output data-production-layer-opacity-output>${Math.round(layer.opacity * 100)}%</output>
        </label>
      </div>`).join("");
    this.productionLocallyDirty.delete(entry.id);
    this.productionValidationStates.set(entry.id, Object.freeze({
      state: "unchecked",
      message: "Validate the exact prepared fingerprint before approval.",
    }));
    this.syncProductionLayerMoveControls();
    this.syncProductionAuthoringControls();
  }

  private syncProductionLayerMoveControls(): void {
    const root = document.querySelector<HTMLElement>("[data-production-authoring=layers]");
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-production-layer-id]")];
    rows.forEach((row, index) => {
      const earlier = row.querySelector<HTMLButtonElement>('[data-production-layer-move="-1"]');
      const later = row.querySelector<HTMLButtonElement>('[data-production-layer-move="1"]');
      if (earlier) earlier.disabled = index === 0 || this.productionAuthoringInFlight;
      if (later) later.disabled = index === rows.length - 1 || this.productionAuthoringInFlight;
    });
  }

  private currentProductionValidation(
    entry: Readonly<ProductionCandidateLibraryEntry>,
  ): Readonly<ProductionValidationStatus> {
    return this.productionValidationStates.get(entry.id) ?? Object.freeze({
      state: "unchecked",
      message: "Validate the exact prepared fingerprint before approval.",
    });
  }

  private setProductionValidation(
    entry: Readonly<ProductionCandidateLibraryEntry>,
    state: ProductionValidationState,
    message: string,
  ): void {
    this.productionValidationStates.set(entry.id, Object.freeze({ state, message }));
    const status = document.querySelector<HTMLOutputElement>("[data-production=validation-status]");
    if (status) {
      status.value = message;
      status.dataset.state = state === "error" || state === "stale" ? "error" : "ready";
    }
    this.syncProductionAuthoringControls();
  }

  private markProductionCandidateStale(message: string): void {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionEditorCandidateId !== entry.id) return;
    const baseline = this.productionAuthoringBaselines.get(entry.id);
    let matchesSaved = false;
    try {
      matchesSaved = baseline !== undefined
        && productionCandidateAuthoringRequestsEqual(baseline, this.productionCandidateAuthoringRequest());
    } catch {
      // Invalid in-progress input is still a local edit; the form exposes its specific error separately.
    }
    if (matchesSaved) {
      this.productionLocallyDirty.delete(entry.id);
      this.setProductionValidation(
        entry,
        "unchecked",
        "Edits match the saved candidate again. Validate the exact prepared fingerprint before approval.",
      );
      return;
    }
    this.productionLocallyDirty.add(entry.id);
    this.setProductionValidation(entry, "stale", message);
  }

  private productionCandidateSavedRequest(
    entry: Readonly<ProductionCandidateLibraryEntry>,
  ): Readonly<ProductionCandidateAuthoringRequest> {
    const dimensions = this.productionCandidateDimensions(entry);
    return validateProductionCandidateAuthoringRequest({
      formatVersion: PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION,
      recipeId: entry.id,
      candidateFingerprint: entry.fingerprint,
      settings: {
        name: entry.recipe.name,
        family: entry.recipe.family,
        targetWidth: dimensions.width,
        targetHeight: dimensions.height,
        layers: entry.recipe.layers.map((layer) => ({
          id: layer.id,
          defaultVisible: layer.defaultVisible,
          opacity: layer.opacity,
        })),
        runtimeBindingAssetId: entry.recipe.runtimeBinding?.assetId ?? null,
      },
      collision: this.productionCandidateAuthoredCollision(entry),
    });
  }

  private productionHybridCollisionFromModel(
    targetWidth: number,
    targetHeight: number,
  ): Readonly<ProductionCandidateAuthoredCollision> {
    if (
      !Number.isInteger(targetWidth)
      || !Number.isInteger(targetHeight)
      || targetWidth <= 0
      || targetHeight <= 0
      || targetWidth % PRODUCTION_CANDIDATE_TILE_SIZE !== 0
      || targetHeight % PRODUCTION_CANDIDATE_TILE_SIZE !== 0
    ) {
      throw new RangeError("Solid collision canvases must use positive dimensions aligned to 32 px");
    }
    const width = targetWidth / PRODUCTION_CANDIDATE_TILE_SIZE;
    const height = targetHeight / PRODUCTION_CANDIDATE_TILE_SIZE;
    const subcellColumns = width * COLLISION_SUBCELLS_PER_TILE;
    const subcellRows = height * COLLISION_SUBCELLS_PER_TILE;
    const solidSubcells: Array<Readonly<{ x: number; y: number }>> = [];
    const snapshot = this.collisionModel.snapshot();
    if (snapshot.masks) {
      const sourceWidth = this.collisionTarget.width;
      const sourceHeight = this.collisionTarget.height;
      for (let cellY = 0; cellY < Math.min(height, sourceHeight); cellY++) {
        for (let cellX = 0; cellX < Math.min(width, sourceWidth); cellX++) {
          const mask = snapshot.masks[cellY * sourceWidth + cellX];
          for (let subY = 0; subY < COLLISION_SUBCELLS_PER_TILE; subY++) {
            for (let subX = 0; subX < COLLISION_SUBCELLS_PER_TILE; subX++) {
              if (!isCollisionSubcellSolid(mask, subX, subY)) continue;
              solidSubcells.push(Object.freeze({
                x: cellX * COLLISION_SUBCELLS_PER_TILE + subX,
                y: cellY * COLLISION_SUBCELLS_PER_TILE + subY,
              }));
            }
          }
        }
      }
    } else {
      const entry = this.selectedProductionCandidate();
      const savedDraft = entry ? this.productionHybridDrafts.get(entry.id) : undefined;
      if (savedDraft?.kind === "hybrid-grid-draft") {
        for (const point of savedDraft.solidSubcells) {
          if (point.x < subcellColumns && point.y < subcellRows) solidSubcells.push(Object.freeze({ ...point }));
        }
      }
    }
    return Object.freeze({
      kind: "hybrid-grid-draft",
      tileSize: PRODUCTION_CANDIDATE_TILE_SIZE,
      subcellSize: PRODUCTION_CANDIDATE_SUBCELL_SIZE,
      grid: Object.freeze({ width, height, subcellColumns, subcellRows }),
      solidSubcells: Object.freeze(solidSubcells),
    });
  }

  private applyProductionCandidateShapeControls(): void {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionEditorCandidateId !== entry.id) return;
    const widthInput = document.querySelector<HTMLInputElement>("[data-production-authoring=width]");
    const heightInput = document.querySelector<HTMLInputElement>("[data-production-authoring=height]");
    const semanticsInput = document.querySelector<HTMLSelectElement>(
      "[data-production-authoring=collision-semantics]",
    );
    if (!widthInput || !heightInput || !semanticsInput) return;
    const targetWidth = Number(widthInput.value);
    const targetHeight = Number(heightInput.value);
    const semantics = semanticsInput.value as ProductionCollisionSemantics;
    try {
      if (
        !Number.isInteger(targetWidth)
        || !Number.isInteger(targetHeight)
        || targetWidth < 1
        || targetHeight < 1
        || targetWidth > 4_096
        || targetHeight > 4_096
      ) throw new RangeError("Candidate canvas dimensions must be integers between 1 and 4096 px");
      const previousSemantics = this.productionCollisionSemantics.get(entry.id);
      if (previousSemantics === "hybrid-grid-draft") {
        const currentWidth = this.collisionTarget.width * PRODUCTION_CANDIDATE_TILE_SIZE;
        const currentHeight = this.collisionTarget.height * PRODUCTION_CANDIDATE_TILE_SIZE;
        this.productionHybridDrafts.set(
          entry.id,
          this.productionHybridCollisionFromModel(currentWidth, currentHeight),
        );
      }
      let collision: Readonly<ProductionCandidateAuthoredCollision>;
      if (semantics === "hybrid-grid-draft") {
        const saved = this.productionHybridDrafts.get(entry.id);
        if (this.collisionModel.snapshot().masks && previousSemantics === "hybrid-grid-draft") {
          collision = this.productionHybridCollisionFromModel(targetWidth, targetHeight);
        } else {
          if (
            targetWidth % PRODUCTION_CANDIDATE_TILE_SIZE !== 0
            || targetHeight % PRODUCTION_CANDIDATE_TILE_SIZE !== 0
          ) throw new RangeError("Solid collision canvases must align to the 32 px navigation grid");
          const width = targetWidth / PRODUCTION_CANDIDATE_TILE_SIZE;
          const height = targetHeight / PRODUCTION_CANDIDATE_TILE_SIZE;
          collision = Object.freeze({
            kind: "hybrid-grid-draft",
            tileSize: PRODUCTION_CANDIDATE_TILE_SIZE,
            subcellSize: PRODUCTION_CANDIDATE_SUBCELL_SIZE,
            grid: Object.freeze({
              width,
              height,
              subcellColumns: width * COLLISION_SUBCELLS_PER_TILE,
              subcellRows: height * COLLISION_SUBCELLS_PER_TILE,
            }),
            solidSubcells: Object.freeze(saved?.kind === "hybrid-grid-draft"
              ? saved.solidSubcells.filter((point) =>
                point.x < width * COLLISION_SUBCELLS_PER_TILE
                && point.y < height * COLLISION_SUBCELLS_PER_TILE)
              : []),
          });
        }
        this.productionHybridDrafts.set(entry.id, collision);
      } else if (semantics === "empty") {
        collision = Object.freeze({
          kind: "empty",
          passable: true,
          reason: this.productionEmptyReasons.get(entry.id)
            ?? "Author explicitly marked this candidate passable.",
        });
      } else {
        throw new RangeError("Choose supported collision semantics");
      }
      this.productionCollisionSemantics.set(entry.id, semantics);
      this.activateProductionCandidateCollisionTarget(entry, targetWidth, targetHeight, collision);
      this.markProductionCandidateStale("Canvas or collision semantics changed; save and validate the candidate.");
      this.rebuildPreview();
    } catch (error) {
      this.setProductionValidation(entry, "error", this.errorMessage(error));
    }
  }

  private productionCandidateAuthoringRequest(): Readonly<ProductionCandidateAuthoringRequest> {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionEditorCandidateId !== entry.id) {
      throw new Error("Select an authorable production candidate first");
    }
    const form = document.querySelector<HTMLFormElement>("[data-production-authoring=form]");
    const name = form?.querySelector<HTMLInputElement>("[data-production-authoring=name]");
    const family = form?.querySelector<HTMLSelectElement>("[data-production-authoring=family]");
    const width = form?.querySelector<HTMLInputElement>("[data-production-authoring=width]");
    const height = form?.querySelector<HTMLInputElement>("[data-production-authoring=height]");
    const semantics = form?.querySelector<HTMLSelectElement>("[data-production-authoring=collision-semantics]");
    const binding = form?.querySelector<HTMLSelectElement>("[data-production-authoring=runtime-binding]");
    const layerRoot = form?.querySelector<HTMLElement>("[data-production-authoring=layers]");
    if (!name || !family || !width || !height || !semantics || !binding || !layerRoot) {
      throw new Error("Candidate authoring controls are unavailable");
    }
    const targetWidth = Number(width.value);
    const targetHeight = Number(height.value);
    const collision: Readonly<ProductionCandidateAuthoredCollision> = semantics.value === "empty"
      ? Object.freeze({
        kind: "empty",
        passable: true,
        reason: this.productionEmptyReasons.get(entry.id)
          ?? "Author explicitly marked this candidate passable.",
      })
      : this.productionHybridCollisionFromModel(targetWidth, targetHeight);
    const layers = [...layerRoot.querySelectorAll<HTMLElement>("[data-production-layer-id]")].map((row) => {
      const id = row.dataset.productionLayerId;
      const visible = row.querySelector<HTMLInputElement>("[data-production-layer-visible]");
      const opacity = row.querySelector<HTMLInputElement>("[data-production-layer-opacity]");
      if (!id || !visible || !opacity) throw new Error("Candidate layer controls are incomplete");
      return { id, defaultVisible: visible.checked, opacity: Number(opacity.value) };
    });
    let runtimeBindingAssetId: AuthoredAssetId | null = null;
    if (binding.value !== "") {
      if (!this.authoredAssetIds.includes(binding.value as AuthoredAssetId)) {
        throw new RangeError("Test binding must name a current pilot runtime asset");
      }
      runtimeBindingAssetId = binding.value as AuthoredAssetId;
    }
    return validateProductionCandidateAuthoringRequest({
      formatVersion: PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION,
      recipeId: entry.id,
      candidateFingerprint: entry.fingerprint,
      settings: {
        name: name.value,
        family: family.value,
        targetWidth,
        targetHeight,
        layers,
        runtimeBindingAssetId,
      },
      collision,
    });
  }

  private async validateProductionCandidate(): Promise<void> {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionAuthoringInFlight) return;
    if (this.productionLocallyDirty.has(entry.id)) {
      this.setProductionValidation(entry, "stale", "Save candidate before validating unsaved edits.");
      return;
    }
    this.productionAuthoringInFlight = true;
    this.setProductionValidation(entry, "validating", "Validating the exact prepared candidate fingerprint...");
    try {
      const response = await fetch(PRODUCTION_CANDIDATE_VALIDATE_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formatVersion: PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION,
          recipeId: entry.id,
          candidateFingerprint: entry.fingerprint,
        }),
      });
      const payload = await response.json().catch(() => undefined) as ProductionAuthoringResponse | undefined;
      if (!response.ok || payload?.ok !== true || payload.validationState !== "current") {
        throw new Error(payload?.error ?? `Candidate validation failed with HTTP ${response.status}`);
      }
      if (payload.reviewState) this.productionReviewStates.set(entry.id, payload.reviewState);
      this.setProductionValidation(entry, "current", "Current fingerprint and prepared output are valid.");
    } catch (error) {
      const message = this.errorMessage(error);
      this.setProductionValidation(entry, /stale|refresh/iu.test(message) ? "stale" : "error", message);
    } finally {
      this.productionAuthoringInFlight = false;
      this.syncSelectedAssetUi();
      this.syncProductionAuthoringControls();
    }
  }

  private async saveProductionCandidate(): Promise<void> {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionAuthoringInFlight) return;
    try {
      const request = this.productionCandidateAuthoringRequest();
      this.productionAuthoringInFlight = true;
      sessionStorage.setItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY, entry.id);
      this.setProductionValidation(entry, "validating", "Saving recipe, canonical collision and prepared output...");
      const response = await fetch(PRODUCTION_CANDIDATE_SAVE_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => undefined) as ProductionAuthoringResponse | undefined;
      if (!response.ok || payload?.ok !== true || !payload.fingerprint) {
        throw new Error(payload?.error ?? `Candidate save failed with HTTP ${response.status}`);
      }
      this.productionLocallyDirty.delete(entry.id);
      this.productionReviewStates.set(entry.id, "pending");
      this.setProductionValidation(entry, "current", payload.message ?? "Candidate saved and returned to pending review.");
      window.location.reload();
    } catch (error) {
      const message = this.errorMessage(error);
      this.setProductionValidation(entry, /stale|refresh/iu.test(message) ? "stale" : "error", message);
    } finally {
      this.productionAuthoringInFlight = false;
      this.syncProductionAuthoringControls();
    }
  }

  private async promoteProductionCandidate(): Promise<void> {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionPromotionInFlight) return;
    const validation = this.currentProductionValidation(entry);
    if (
      validation.state !== "current"
      || this.productionLocallyDirty.has(entry.id)
      || this.productionReviewState(entry) !== "approved"
      || entry.recipe.runtimeBinding?.collisionIntent !== "preserve"
    ) {
      this.reportProductionReview(
        "Promotion requires the current validated fingerprint, its approval, and a collision-preserving runtime binding.",
        true,
      );
      return;
    }
    this.productionPromotionInFlight = true;
    this.syncProductionAuthoringControls();
    this.reportProductionReview("Publishing the exact approved candidate fingerprint...");
    try {
      const response = await fetch(PRODUCTION_CANDIDATE_PROMOTION_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formatVersion: PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION,
          recipeId: entry.id,
          candidateFingerprint: entry.fingerprint,
        }),
      });
      const payload = await response.json().catch(() => undefined) as ProductionAuthoringResponse | undefined;
      if (!response.ok || payload?.ok !== true || payload.promotionState !== "published") {
        throw new Error(payload?.error ?? `Candidate promotion failed with HTTP ${response.status}`);
      }
      this.reportProductionReview(payload.message ?? "Current approved candidate published.");
    } catch (error) {
      const message = this.errorMessage(error);
      if (/stale|refresh/iu.test(message)) this.setProductionValidation(entry, "stale", message);
      this.reportProductionReview(message, true);
    } finally {
      this.productionPromotionInFlight = false;
      this.syncProductionAuthoringControls();
    }
  }

  private syncProductionAuthoringControls(): void {
    const entry = this.selectedProductionCandidate();
    if (!entry) return;
    const validation = this.currentProductionValidation(entry);
    const locallyDirty = this.productionLocallyDirty.has(entry.id);
    const reviewState = this.productionReviewState(entry);
    const badge = document.querySelector<HTMLElement>("[data-production=validation-badge]");
    if (badge) {
      badge.textContent = validation.state;
      badge.dataset.state = validation.state;
    }
    const validationStatus = document.querySelector<HTMLOutputElement>("[data-production=validation-status]");
    if (validationStatus && validationStatus.value !== validation.message) {
      validationStatus.value = validation.message;
      validationStatus.dataset.state = validation.state === "error" || validation.state === "stale"
        ? "error"
        : "ready";
    }
    let requestError: string | undefined;
    try { this.productionCandidateAuthoringRequest(); }
    catch (error) { requestError = this.errorMessage(error); }
    const validate = document.querySelector<HTMLButtonElement>("[data-production-action=validate]");
    const save = document.querySelector<HTMLButtonElement>("[data-production-action=save]");
    const promote = document.querySelector<HTMLButtonElement>("[data-production-action=promote]");
    if (validate) {
      validate.disabled = this.productionAuthoringInFlight || locallyDirty;
      validate.textContent = validation.state === "validating" ? "Validating..." : "Validate current";
    }
    if (save) {
      const needsCanonicalMask = entry.collisionDraft.kind === "hybrid-grid-draft"
        && entry.recipe.collision.mode !== "mask-file";
      const hasSaveableChange = locallyDirty || needsCanonicalMask;
      save.disabled = this.productionAuthoringInFlight || requestError !== undefined || !hasSaveableChange;
      save.textContent = this.productionAuthoringInFlight ? "Working..." : "Save candidate";
      save.title = requestError
        ?? (hasSaveableChange
          ? "Persist recipe settings and canonical collision"
          : "This exact candidate is already saved");
    }
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "[data-production-authoring=form] input, [data-production-authoring=form] select",
    )) control.disabled = this.productionAuthoringInFlight;
    this.syncProductionLayerMoveControls();
    const canApprove = validation.state === "current" && !locallyDirty && !this.productionReviewInFlight;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-production-review-action]")) {
      button.disabled = this.productionReviewInFlight
        || this.productionAuthoringInFlight
        || (button.dataset.productionReviewAction === "approved" && !canApprove);
    }
    if (promote) {
      promote.disabled = this.productionPromotionInFlight
        || validation.state !== "current"
        || locallyDirty
        || reviewState !== "approved"
        || entry.recipe.runtimeBinding?.collisionIntent !== "preserve";
      promote.textContent = this.productionPromotionInFlight ? "Promoting..." : "Promote approved";
      promote.title = entry.recipe.runtimeBinding?.collisionIntent === "preserve"
        ? "Publish the exact current approved fingerprint"
        : "Choose a collision-preserving runtime binding before promotion";
    }
    const trialLink = document.querySelector<HTMLAnchorElement>("[data-production=trial-link]");
    if (trialLink && !trialLink.hidden) {
      const blocked = this.productionAuthoringInFlight || locallyDirty;
      trialLink.setAttribute("aria-disabled", String(blocked));
      trialLink.textContent = blocked ? "Save before trial" : "Trial candidate";
      trialLink.title = blocked
        ? "Save the current settings and collision mask before launching the sea trial"
        : "Launch the isolated trial for this exact saved fingerprint";
    }
    const collisionNote = document.querySelector<HTMLElement>("[data-production-authoring=collision-note]");
    if (collisionNote) {
      const semantics = this.productionCollisionSemantics.get(entry.id);
      collisionNote.textContent = requestError ?? (semantics === "empty"
        ? "Explicitly passable candidates save no solid mask. Islands must use a solid 32/8 px mask."
        : "The collision workbench below edits the canonical saved mask. Solid canvases align to 32 px.");
      collisionNote.dataset.state = requestError ? "error" : "ready";
    }
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

  private async reviewProductionCandidate(decision: "approved" | "rejected"): Promise<void> {
    const entry = this.selectedProductionCandidate();
    if (!entry || this.productionReviewInFlight) return;
    const validation = this.currentProductionValidation(entry);
    if (decision === "approved"
      && (validation.state !== "current" || this.productionLocallyDirty.has(entry.id))) {
      this.reportProductionReview("Approval requires the current validated fingerprint with no unsaved edits.", true);
      return;
    }
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
          ? "Current candidate fingerprint approved. It may now be promoted or trialed."
          : "Rejected. Runtime files remain unchanged.",
      );
    } catch (error) {
      const message = this.errorMessage(error);
      if (/stale|refresh/iu.test(message)) this.setProductionValidation(entry, "stale", message);
      this.reportProductionReview(message, true);
    } finally {
      this.productionReviewInFlight = false;
      this.syncSelectedAssetUi();
      this.syncProductionAuthoringControls();
    }
  }

  private stepLibrarySelection(direction: -1 | 1): void {
    if (this.collisionSaveInFlight || this.productionAuthoringInFlight || this.productionPromotionInFlight) return;
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
    if (this.collisionSaveInFlight || this.productionAuthoringInFlight || this.productionPromotionInFlight) return;
    if (id === this.selectedLibraryAssetId) return;
    const currentCandidate = this.selectedProductionCandidate();
    if (currentCandidate && this.productionLocallyDirty.has(currentCandidate.id)) {
      const discard = window.confirm(
        `Discard unsaved settings and collision edits for ${currentCandidate.name}?`,
      );
      if (!discard) {
        this.reportProductionReview("Selection unchanged; save or discard the candidate edits first.", true);
        return;
      }
      this.productionLocallyDirty.delete(currentCandidate.id);
      this.islandNameDrafts.delete(currentCandidate.id);
    }
    const entry = this.workspaceEntryById(id);
    if (!entry) return;
    if (!currentCandidate) this.stashCurrentCollisionDraft();
    this.referenceLoadRevision++;
    this.selectedLibraryAssetId = entry.id;
    sessionStorage.setItem(assetWorkspaceSelectionKey(this.workspace.id), entry.id);
    this.previewAssets = this.catalogAssets;
    if (entry.entryType === "authored-package") {
      this.productionEditorCandidateId = undefined;
      this.selectCatalogCollisionTarget(entry.package.metadata.assetId, false);
    } else {
      this.validatedCollisionCandidate = undefined;
      if (entry.entryType === "production-candidate") this.activateProductionCandidateEditor(entry);
      else this.productionEditorCandidateId = undefined;
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
    if (this.workspace.id === "islands") {
      this.syncIslandWorkbench();
      return;
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
        collision.disabled = this.productionCollisionSemantics.get(entry.id) !== "hybrid-grid-draft";
      }
      const collisionLabel = document.querySelector<HTMLElement>("[data-production=collision-label]");
      if (collisionLabel) collisionLabel.textContent = this.productionCollisionSemantics.get(entry.id) === "hybrid-grid-draft"
        ? `Show ${PRODUCTION_CANDIDATE_TILE_SIZE}/${PRODUCTION_CANDIDATE_SUBCELL_SIZE} px editable collision draft${entry.collisionDraft.kind === "hybrid-grid-draft" ? ` · ${collisionDraftMethodLabel(entry.collisionDraft.method)}` : ""}`
        : this.productionCollisionSemantics.get(entry.id) === "empty"
          ? "Explicitly passable (no collision grid)"
          : entry.collisionDraft.kind === "preserve-runtime-collision"
            ? `Uses accepted collision from ${entry.collisionDraft.runtimeAssetId}`
            : "Collision draft is unavailable";
      const notice = document.querySelector<HTMLElement>("[data-production=notice]");
      if (notice) {
        const bindingNotice = entry.recipe.runtimeBinding
          ? `${reviewState}. Persisted test binding: ${entry.recipe.runtimeBinding.assetId}. The isolated trial uses this candidate's own prepared layers and saved collision.`
          : `${reviewState}. No runtime test binding. The isolated trial uses this candidate's own prepared layers and saved collision.`;
        const collisionWarnings = entry.collisionDraft.kind === "hybrid-grid-draft"
          && entry.collisionDraft.warnings.length > 0
          ? ` Collision warning${entry.collisionDraft.warnings.length === 1 ? "" : "s"}: ${entry.collisionDraft.warnings.join(" ")}`
          : "";
        notice.textContent = `${bindingNotice}${collisionWarnings}`;
      }
      for (const button of document.querySelectorAll<HTMLButtonElement>("[data-production-review-action]")) {
        button.dataset.active = String(button.dataset.productionReviewAction === reviewState);
      }
      const trialLink = document.querySelector<HTMLAnchorElement>("[data-production=trial-link]");
      if (trialLink) {
        const supportsTrial = entry.recipe.family === "island"
          && entry.collisionDraft.kind === "hybrid-grid-draft";
        trialLink.hidden = !supportsTrial;
        if (supportsTrial) {
          trialLink.href = assetTrialApplicationHref({
            candidateId: entry.id,
            candidateFingerprint: entry.fingerprint,
          });
        } else {
          trialLink.removeAttribute("href");
        }
      }
      const item = this.assetLibraryBrowser?.querySelector<HTMLButtonElement>(
        `[data-library-id="${CSS.escape(entry.id)}"]`,
      );
      const status = item?.querySelector<HTMLElement>(".asset-library-status");
      if (status) status.textContent = reviewState;
      this.syncProductionAuthoringControls();
    }
    for (const packageOnly of document.querySelectorAll<HTMLElement>("[data-selected-package-only]")) {
      packageOnly.hidden = entry.entryType !== "authored-package";
    }
    const collisionEditor = document.querySelector<HTMLElement>("[data-collision-editor-section]");
    if (collisionEditor) collisionEditor.hidden = entry.entryType === "reference-image";
    const collisionEyebrow = document.querySelector<HTMLElement>("[data-collision=eyebrow]");
    const collisionTitle = document.querySelector<HTMLElement>("[data-collision=title]");
    if (collisionEyebrow) collisionEyebrow.textContent = entry.entryType === "production-candidate"
      ? "Persisted candidate mask"
      : "Live package editor";
    if (collisionTitle) collisionTitle.textContent = entry.entryType === "production-candidate"
      ? "Candidate collision authoring"
      : "Collision authoring";
    for (const packageCollisionOnly of document.querySelectorAll<HTMLElement>("[data-package-collision-only]")) {
      packageCollisionOnly.hidden = entry.entryType !== "authored-package";
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
      if (!this.workspace.collisionObjectKinds.includes(target.objectKind)) continue;
      targetSelect.add(new Option(`${target.label} · ${target.objectKind}`, target.objectKind));
    }
    targetSelect.addEventListener("change", () => {
      if (this.collisionSaveInFlight) return;
      const objectKind = targetSelect.value as RuntimeCollisionObjectKind;
      if (!this.workspace.collisionObjectKinds.includes(objectKind)) return;
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

  private selectCatalogCollisionTarget(assetId: AuthoredAssetId, stashCurrent = true): void {
    if (this.collisionSaveInFlight) return;
    if (stashCurrent) this.stashCurrentCollisionDraft();
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
    const candidate = this.selectedProductionCandidate();
    if (snapshot.serializationError) {
      this.reportCollision(snapshot.serializationError, true);
      if (candidate) this.setProductionValidation(candidate, "error", snapshot.serializationError);
    } else if (changed && candidate && this.productionEditorCandidateId === candidate.id) {
      this.markProductionCandidateStale("Collision changed; save candidate before validation or approval.");
      this.reportCollision(this.workspace.id === "islands"
        ? "Collision changed; choose Save changes when the mask is ready."
        : "Candidate collision changed; use Save candidate to persist its canonical mask.");
    } else if (changed) {
      this.reportCollision("Collision draft changed; save it to update the runtime package.");
    }
  }

  private syncCollisionControls(): void {
    if (!this.collisionTarget || !this.collisionModel) return;
    const snapshot = this.collisionModel.snapshot();
    const busy = this.collisionSaveInFlight || this.productionAuthoringInFlight;
    const productionCandidate = this.selectedProductionCandidate();
    const effectiveMode = this.collisionTarget.editing === "hybrid-grid" && this.collisionTarget.tileSize !== 32
      ? "read-only"
      : this.collisionTarget.editing;
    const target = document.querySelector<HTMLSelectElement>("[data-collision=target]");
    if (target) {
      target.value = this.collisionTarget.objectKind;
      target.disabled = busy || productionCandidate !== undefined;
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
      button.disabled = busy || !snapshot.editable;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-collision-brush]")) {
      const active = Number(button.dataset.collisionBrush) === this.collisionBrushSize;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = busy || !snapshot.editable;
    }
    const halfExtent = document.querySelector<HTMLInputElement>("[data-collision=half-extent]");
    if (halfExtent) {
      if (snapshot.profile.kind === "box") halfExtent.value = String(snapshot.profile.halfSize.width);
      halfExtent.disabled = busy || !snapshot.editable;
    }
    const setDisabled = (selector: string, disabled: boolean) => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      if (button) button.disabled = disabled;
    };
    setDisabled("[data-collision=undo]", busy || !snapshot.canUndo);
    setDisabled("[data-collision=redo]", busy || !snapshot.canRedo);
    setDisabled("[data-collision=reset]", busy || !snapshot.editable || !snapshot.dirty);
    setDisabled(
      "[data-collision=save]",
      busy
        || !snapshot.editable
        || !snapshot.dirty
        || !snapshot.exportable
        || !this.collisionAcceptedMetadata,
    );
    setDisabled("[data-collision=selection-solid]", busy || !this.collisionSelection || !snapshot.editable);
    setDisabled("[data-collision=selection-clear]", busy || !this.collisionSelection || !snapshot.editable);
    setDisabled("[data-collision=revert-cell]", busy || !this.collisionHover || !snapshot.editable);
    setDisabled("[data-collision=apply-box]", busy || !snapshot.editable);
    setDisabled("[data-collision=set-empty]", busy || !snapshot.editable);
    setDisabled(
      "[data-collision=validate]",
      busy || !snapshot.editable || !snapshot.exportable || !this.collisionAcceptedMetadata,
    );
    setDisabled("[data-collision=export]", busy || !this.validatedCollisionCandidate);
    const save = document.querySelector<HTMLButtonElement>("[data-collision=save]");
    if (save) {
      save.textContent = this.collisionSaveInFlight ? "Saving…" : "Save to library";
      save.setAttribute("aria-busy", String(this.collisionSaveInFlight));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-library-id], [data-library-action=previous], [data-library-action=next]",
    )) button.disabled = busy || this.productionPromotionInFlight || this.productionReviewInFlight;
    const viewer = document.querySelector<HTMLSelectElement>("[data-viewer=asset]");
    if (viewer) viewer.disabled = busy;
    this.syncIslandWorkbench();
  }

  private syncPackageSelectors(): void {
    const assetId = authoredAssetIdForCollisionObject(this.collisionTarget.objectKind);
    if (!assetId) return;
    const viewer = document.querySelector<HTMLSelectElement>("[data-viewer=asset]");
    if (viewer) viewer.value = assetId;
  }

  private reportCollision(message: string, error = false): void {
    const status = document.querySelector<HTMLOutputElement>("[data-collision=status]");
    if (!status) {
      this.reportIslandStatus(message, error);
      return;
    }
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
    if (
      this.selectedReferenceEntry()
      || this.domControlsFocused(event.target)
      || this.collisionSaveInFlight
      || this.productionAuthoringInFlight
    ) return;
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
      && target.closest("#developer-tools-panel, #asset-library-browser, .production-intake-dialog") !== null;
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
    for (const assetId of this.authoredAssetIds) kind.add(new Option(assetId, assetId));
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
        if (this.collisionSaveInFlight || !this.authoredAssetIds.includes(assetId)) return false;
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
        if (this.collisionSaveInFlight || !this.workspace.collisionObjectKinds.includes(objectKind)) return false;
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
