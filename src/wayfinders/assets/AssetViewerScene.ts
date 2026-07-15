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
  createCollisionEditorBaseMasks,
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
    this.activateCollisionTarget("home-island", initialMetadata, initialMetadata, false);

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

  private rebuildPreview(): void {
    this.homeVisual?.destroy();
    this.shipRenderer?.destroy();
    this.shoalVisual?.image.destroy();
    this.homeVisual = undefined;
    this.shipRenderer = undefined;
    this.shoalVisual = undefined;
    this.developerVisualGraphics.clear();

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
  }

  private drawGuides(): void {
    this.guideGraphics.clear();
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
      ?? (expectedAssetId ? this.catalogAssets.metadata(expectedAssetId) : undefined);
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

    if (expectedAssetId) this.state.assetId = expectedAssetId;
    if (rebuild) this.rebuildPreview();
    else this.drawGuides();
    this.syncCollisionControls();
    this.syncPackageSelectors();
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
      graphics.lineStyle(2, 0xfff2a8, 0.95).strokeRect(
        rect.left + this.collisionHover.x * displaySubcellSize,
        rect.top + this.collisionHover.y * displaySubcellSize,
        displaySubcellSize,
        displaySubcellSize,
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

  private onCollisionPointerDown(pointer: Phaser.Input.Pointer): void {
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
        this.collisionStrokePoints = new Map([[`${point.x},${point.y}`, point]]);
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
      this.collisionStrokePoints.set(`${point.x},${point.y}`, point);
    }
    if (point && pointer.isDown && this.collisionSelectionStart) {
      this.collisionSelection = this.selectionBetween(this.collisionSelectionStart, point);
    }
    this.drawGuides();
  }

  private onCollisionPointerUp(): void {
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
      <section class="collision-workbench" aria-labelledby="collision-workbench-title">
        <header>
          <div>
            <p class="eyebrow">GR-2.5</p>
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
        <div data-collision-panel="hybrid" class="collision-panel" hidden>
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
        <label class="collision-import">Import collision candidate
          <input data-collision="import" type="file" accept="application/json,.json">
        </label>
        <div class="collision-candidate-actions">
          <button data-collision="validate" type="button">Validate profile</button>
          <button data-collision="export" type="button" disabled>Export collision bundle</button>
        </div>
        <output data-collision="status" class="asset-viewer-diagnostics" aria-live="polite"></output>
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
    const importInput = slot.querySelector<HTMLInputElement>("[data-collision=import]");
    const validate = slot.querySelector<HTMLButtonElement>("[data-collision=validate]");
    const exportButton = slot.querySelector<HTMLButtonElement>("[data-collision=export]");
    if (
      !targetSelect || !fitButton || !selectionSolid || !selectionClear || !revertCell
      || !halfExtent || !applyBox || !setEmpty || !undo || !redo || !reset
      || !importInput || !validate || !exportButton
    ) return;

    for (const target of createCollisionAuthoringTargets()) {
      targetSelect.add(new Option(`${target.label} · ${target.objectKind}`, target.objectKind));
    }
    targetSelect.addEventListener("change", () => {
      const objectKind = targetSelect.value as RuntimeCollisionObjectKind;
      if (!RUNTIME_COLLISION_OBJECT_KINDS.includes(objectKind)) return;
      try {
        const assetId = authoredAssetIdForCollisionObject(objectKind);
        if (assetId) this.selectCatalogCollisionTarget(assetId);
        else {
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
    const metadata = this.catalogAssets.metadata(assetId);
    if (!metadata) throw new RangeError(`Catalog metadata ${assetId} is unavailable`);
    this.previewAssets = this.catalogAssets;
    this.activateCollisionTarget(this.collisionObjectKindForAsset(assetId), metadata, metadata);
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
    const acceptedHome = this.catalogAssets.metadata(AUTHORED_ASSET_IDS.homeIsland);
    const acceptedPlayer = this.catalogAssets.metadata(AUTHORED_ASSET_IDS.playerBoat);
    const acceptedShoal = this.catalogAssets.metadata(AUTHORED_ASSET_IDS.fishingShoal);
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
    const current = this.catalogAssets.metadata(candidate.assetId);
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
        : this.catalogAssets.metadata(assetId),
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

  private afterCollisionMutation(changed: boolean): void {
    if (changed) this.validatedCollisionCandidate = undefined;
    const snapshot = this.collisionModel.snapshot();
    this.drawGuides();
    this.syncCollisionControls();
    if (snapshot.serializationError) this.reportCollision(snapshot.serializationError, true);
    else if (changed) this.reportCollision("Collision draft changed; validate before export.");
  }

  private syncCollisionControls(): void {
    if (!this.collisionTarget || !this.collisionModel) return;
    const snapshot = this.collisionModel.snapshot();
    const effectiveMode = this.collisionTarget.editing === "hybrid-grid" && this.collisionTarget.tileSize !== 32
      ? "read-only"
      : this.collisionTarget.editing;
    const target = document.querySelector<HTMLSelectElement>("[data-collision=target]");
    if (target) target.value = this.collisionTarget.objectKind;
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
    }
    const halfExtent = document.querySelector<HTMLInputElement>("[data-collision=half-extent]");
    if (halfExtent && snapshot.profile.kind === "box") halfExtent.value = String(snapshot.profile.halfSize.width);
    const setDisabled = (selector: string, disabled: boolean) => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      if (button) button.disabled = disabled;
    };
    setDisabled("[data-collision=undo]", !snapshot.canUndo);
    setDisabled("[data-collision=redo]", !snapshot.canRedo);
    setDisabled("[data-collision=reset]", !snapshot.editable || !snapshot.dirty);
    setDisabled("[data-collision=selection-solid]", !this.collisionSelection || !snapshot.editable);
    setDisabled("[data-collision=selection-clear]", !this.collisionSelection || !snapshot.editable);
    setDisabled("[data-collision=revert-cell]", !this.collisionHover || !snapshot.editable);
    setDisabled(
      "[data-collision=validate]",
      !snapshot.editable || !snapshot.exportable || !this.collisionAcceptedMetadata,
    );
    setDisabled("[data-collision=export]", !this.validatedCollisionCandidate);
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
    const width = Math.max(
      this.collisionTarget.width * this.collisionTarget.tileSize,
      this.collisionTarget.visualBounds.width,
    );
    const height = Math.max(
      this.collisionTarget.height * this.collisionTarget.tileSize,
      this.collisionTarget.visualBounds.height,
    );
    const availableWidth = Math.max(320, this.scale.width - 440);
    const zoom = Phaser.Math.Clamp(Math.min(availableWidth / (width + 96), this.scale.height / (height + 128)), 0.55, 2.5);
    this.cameras.main.centerOn(STAGE.centerX, STAGE.centerY).setZoom(zoom);
  }

  private onCollisionKeyDown(event: KeyboardEvent): void {
    if (this.domControlsFocused(event.target)) return;
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
    return target instanceof Element && target.closest("#developer-tools-panel") !== null;
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
          const accepted = this.catalogAssets.metadata(bundle.metadata.assetId);
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
      this.catalogAssets.metadata(bundle.metadata.assetId),
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
        if (!ASSET_IDS.includes(assetId)) return false;
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
        if (!RUNTIME_COLLISION_OBJECT_KINDS.includes(objectKind)) return false;
        const assetId = authoredAssetIdForCollisionObject(objectKind);
        if (assetId) this.selectCatalogCollisionTarget(assetId);
        else {
          this.previewAssets = this.catalogAssets;
          this.activateCollisionTarget(objectKind);
        }
        return true;
      },
      collisionSnapshot: () => this.collisionModel.snapshot(),
      paintCollision: (x, y, solid = true) => {
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
        const changed = this.collisionModel.undo();
        this.afterCollisionMutation(changed);
        return changed;
      },
      redoCollision: () => {
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
  }

  private destroyBindings(): void {
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
    for (const key of this.candidateTextureKeys) this.textures.remove(key);
    this.candidateTextureKeys = [];
    delete window.__WAYFINDERS_ASSET_VIEWER__;
  }
}
