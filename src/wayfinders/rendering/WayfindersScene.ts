import Phaser from "phaser";
import { appendDeveloperLog, clearDeveloperLog } from "../../developerLog";
import { preloadPilotAssetPackages } from "../assets/PilotAssetCatalog";
import { createPilotAssetRuntime, type PilotAssetRuntime } from "../assets/PilotAssetRuntime";
import {
  preloadProductionAssetTestOverride,
  resolveProductionAssetTestOverride,
  type ProductionAssetTestOverride,
} from "../assets/ProductionAssetTesting";
import {
  onPrototypeConfigChanged,
  patchPrototypeConfig,
  prototypeConfig,
  type DeepPartial,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { GameSimulation } from "../core/GameSimulation";
import { FrameTimingMonitor } from "../core/FrameTimingMonitor";
import { PresentationWorkMonitor, type PresentationWorkCounters } from "../core/PresentationWorkCounters";
import { SimulationClock } from "../core/SimulationClock";
import { SimulationDiagnosticsAdapter } from "../core/SimulationDiagnosticsReadModel";
import type { GridPoint, MovementInput } from "../core/types";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  type FishingShoalInteractionResultV1,
} from "../exploration/FishingShoalContracts";
import {
  ISLAND_DOSSIER_CONTRACT_VERSION,
  type IslandDossierInteractionResultV1,
} from "../exploration/IslandDossierContracts";
import {
  SURVEY_SITE_CONTRACT_VERSION,
  compareSurveySiteIds,
  type SurveySiteInteractionResult,
  type SurveySiteType,
} from "../exploration/SurveySiteContracts";
import {
  WRECK_SURVEY_CONTRACT_VERSION,
  type WreckSurveyInteractionResultV1,
} from "../exploration/WreckSurveyContracts";
import type { SurveyBudgetReadModel } from "../exploration/SurveyContracts";
import {
  buildGreatHallChronicle,
  type GreatHallChronicle,
  type GreatHallChronicleSources,
  type GreatHallReturnedVoyage,
} from "../lineage/GreatHallChronicle";
import type { NavigatorId } from "../lineage/NavigatorLineageSystem";
import { worldToGrid } from "../world/CoordinateSystem";
import {
  COLLISION_SUBCELL_SIZE,
  COLLISION_SUBCELLS_PER_TILE,
  isCollisionSubcellSolid,
} from "../world/CollisionMask";
import { KnowledgeState } from "../world/TileData";
import { CargoRenderer } from "./CargoRenderer";
import { collectDebugEntityBounds, type DebugEntityBoundsRole } from "./DebugEntityBounds";
import { FishingShoalRenderer } from "./FishingShoalRenderer";
import { IslandDossierRenderer } from "./IslandDossierRenderer";
import { KnowledgeOverlayRenderer } from "./KnowledgeOverlayRenderer";
import { RiskOverlayRenderer } from "./RiskOverlayRenderer";
import { canVisitGreatHall } from "./GreatHallAccess";
import { GreatHallView } from "./GreatHallView";
import {
  isSceneMovementInputSuppressed,
  resolveSceneMovementInput,
  type SceneMovementInputContext,
} from "./SceneMovementInput";
import { ShipRenderer } from "./ShipRenderer";
import type { ShipRenderPose } from "./ShipPose";
import { SurveySiteRenderer } from "./SurveySiteRenderer";
import { WreckRenderer } from "./WreckRenderer";
import { WorldRenderer } from "./WorldRenderer";
import {
  ActiveChunkSet,
  DEFAULT_ACTIVE_CHUNK_BUDGET,
  DEFAULT_ACTIVE_CHUNK_PREFETCH_RING,
  viewportChunkRegion,
  type ActiveChunkDelta,
} from "./activation";

interface MovementKeys {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  forward: Phaser.Input.Keyboard.Key;
  reverse: Phaser.Input.Keyboard.Key;
  alternateLeft: Phaser.Input.Keyboard.Key;
  alternateRight: Phaser.Input.Keyboard.Key;
  alternateForward: Phaser.Input.Keyboard.Key;
  alternateReverse: Phaser.Input.Keyboard.Key;
  zoomIn: Phaser.Input.Keyboard.Key;
  zoomOut: Phaser.Input.Keyboard.Key;
  survey: Phaser.Input.Keyboard.Key;
  cancel: Phaser.Input.Keyboard.Key;
}

interface PresentationResourceSnapshot {
  readonly activeChunks: ReturnType<ActiveChunkSet["getTelemetry"]>;
  readonly world: ReturnType<WorldRenderer["getTelemetry"]>;
  readonly knowledge: ReturnType<KnowledgeOverlayRenderer["getResourceTelemetry"]>;
  readonly risk: ReturnType<RiskOverlayRenderer["getResourceTelemetry"]>;
  readonly markers: Readonly<{
    wrecks: ReturnType<WreckRenderer["getLifetimeTelemetry"]>;
    islandDossiers: ReturnType<IslandDossierRenderer["getLifetimeTelemetry"]>;
    surveySites: ReturnType<SurveySiteRenderer["getLifetimeTelemetry"]>;
    fishingShoals: ReturnType<FishingShoalRenderer["getLifetimeTelemetry"]>;
  }>;
}

interface BrowserDebugApi {
  snapshot: () => ReturnType<GameSimulation["snapshot"]>;
  teleport: (x: number, y: number) => boolean;
  addProvisions: (delta: number) => ReturnType<GameSimulation["snapshot"]>;
  forceWreck: () => boolean;
  regenerate: (seed?: number) => ReturnType<GameSimulation["snapshot"]>;
  setOverlay: (name: keyof GameSimulation["debug"], visible: boolean) => void;
  returnToDock: () => boolean;
  navigatorWreckTargets: () => ReadonlyArray<{ id: number; generation: number; x: number; y: number }>;
  performance: () => ReturnType<FrameTimingMonitor["snapshot"]>;
  presentationWork: () => Readonly<PresentationWorkCounters>;
  presentationResources: () => Readonly<PresentationResourceSnapshot>;
  fishingShoalTargets: () => ReadonlyArray<{ id: string; x: number; y: number }>;
  islandDossierTargets: () => ReadonlyArray<{ islandId: number; x: number; y: number }>;
  surveySiteTargets: () => ReadonlyArray<{ id: string; type: string; x: number; y: number }>;
  surveyIslandDossier: () => IslandDossierInteractionResultV1 | undefined;
  surveySurveySite: () => SurveySiteInteractionResult | undefined;
  surveyFishingShoal: () => FishingShoalInteractionResultV1 | undefined;
  surveyWreck: () => WreckSurveyInteractionResultV1 | undefined;
  continueGeneration: () => boolean;
  visitGreatHall: () => boolean;
  closeGreatHall: () => boolean;
  selectGreatHallGeneration: (generation: number) => boolean;
  greatHall: () => Readonly<GreatHallChronicle>;
  continueCompletedWorld: () => boolean;
  startNewGame: () => number | undefined;
}

declare global {
  interface Window {
    __WAYFINDERS__?: BrowserDebugApi;
  }
}

const PALETTE = {
  grid: 0xa5d5d2,
  collision: 0xff5a4f,
  shipCollision: 0xffc857,
  entityBounds: 0x55e7ff,
  serviceBounds: 0x8cf57c,
  sight: 0x78fff0,
} as const;

export class WayfindersScene extends Phaser.Scene {
  readonly simulation: GameSimulation;

  private readonly clock = new SimulationClock();
  private readonly frameTiming = new FrameTimingMonitor();
  private readonly presentationWork = new PresentationWorkMonitor();
  private readonly simulationDiagnostics = new SimulationDiagnosticsAdapter();
  private keys!: MovementKeys;
  private worldRenderer!: WorldRenderer;
  private knowledgeOverlay!: KnowledgeOverlayRenderer;
  private riskOverlay!: RiskOverlayRenderer;
  private cargoRenderer!: CargoRenderer;
  private islandDossierRenderer!: IslandDossierRenderer;
  private surveySiteRenderer!: SurveySiteRenderer;
  private fishingShoalRenderer!: FishingShoalRenderer;
  private shipRenderer!: ShipRenderer;
  private wreckRenderer!: WreckRenderer;
  private activeChunkSet!: ActiveChunkSet;
  private lastActiveChunkRevision = -1;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private entityDebugGraphics!: Phaser.GameObjects.Graphics;
  private domAbort?: AbortController;
  private developerToolsAbort?: AbortController;
  private readonly eventUnsubscribers: Array<() => void> = [];
  private gameHost?: HTMLElement;
  private gameStatus?: HTMLElement;
  private provisionOutput?: HTMLOutputElement;
  private recordsOutput?: HTMLOutputElement;
  private readonly developerStateOutputs = new Map<string, HTMLElement>();
  private readonly developerDisclosureState = new Map<string, boolean>([
    ["overlays", true],
    ["tuning", true],
    ["advanced", false],
  ]);
  private surveyRibbon?: HTMLElement;
  private surveyRibbonTitle?: HTMLElement;
  private surveyRibbonClue?: HTMLElement;
  private surveyRibbonCost?: HTMLElement;
  private surveyButton?: HTMLButtonElement;
  private homeAction?: HTMLElement;
  private homeActionButton?: HTMLButtonElement;
  private greatHallView?: GreatHallView;
  private greatHallUpdated = false;
  private teleportOnClick = false;
  private islandInspectionIndex = 0;
  private fishingShoalInspectionIndex = 0;
  private readonly surveySiteInspectionIndices = new Map<SurveySiteType, number>();
  private lastInspectedWreckId = 0;
  private datasetGenerated?: GameSimulation["generated"];
  private lastDebugRevision = -1;
  private lastDebugOverlayRevision = -1;
  private lastDebugVisible = false;
  private lastDiagnosticsRevision = -1;
  private lastDiagnosticsOverlayRevision = -1;
  private lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
  private lastDiagnosticsDeveloperToolsOpen = false;
  private lastDiagnosticsInputSuppressed = false;
  private lastWrecksRevision = -1;
  private lastWreckVisibilityVersion = -1;
  private lastIslandDossierRecordsRevision = -1;
  private lastSurveySiteRecordsRevision = -1;
  private lastSurveySiteVisibilityVersion = -1;
  private lastSurveySiteKnowledgeVersion = -1;
  private lastFishingShoalRecordsRevision = -1;
  private lastFishingShoalVisibilityVersion = -1;
  private lastFishingShoalKnowledgeVersion = -1;
  private lastFishingShoalSupportedTopologyVersion = -1;
  private activeWreckMarkers = 0;
  private activeIslandDossierMarkers = 0;
  private activeSurveySiteMarkers = 0;
  private activeFishingShoalMarkers = 0;
  private lastViewportX = Number.NaN;
  private lastViewportY = Number.NaN;
  private lastViewportWidth = Number.NaN;
  private lastViewportHeight = Number.NaN;
  private lastViewportZoom = Number.NaN;
  private browserDebugApi?: BrowserDebugApi;
  private activeLifecycleCue?: Phaser.GameObjects.Text;
  private returnCueScheduled = false;
  private pendingReturnedVoyage?: Readonly<GreatHallReturnedVoyage>;
  private pendingReturnVoyagesRemaining?: number;
  private pendingGenerationHandoverPresentation = false;
  private pendingCompletionNavigatorId?: NavigatorId;
  private previousShipPose!: ShipRenderPose;
  private currentShipPose!: ShipRenderPose;
  private pilotAssets!: PilotAssetRuntime;
  private readonly productionAssetTestOverride?: Readonly<ProductionAssetTestOverride>;
  constructor(simulation = new GameSimulation()) {
    super({ key: "WayfindersScene" });
    this.simulation = simulation;
    this.productionAssetTestOverride = typeof window === "undefined"
      ? undefined
      : resolveProductionAssetTestOverride(window.location.search);
  }

  preload(): void {
    preloadPilotAssetPackages(this);
    preloadProductionAssetTestOverride(this, this.productionAssetTestOverride);
  }

  create(): void {
    this.pilotAssets = createPilotAssetRuntime(
      this,
      this.productionAssetTestOverride ? [this.productionAssetTestOverride] : [],
    );
    this.worldRenderer = new WorldRenderer(this, this.pilotAssets);
    this.wreckRenderer = new WreckRenderer(this);
    this.knowledgeOverlay = new KnowledgeOverlayRenderer(this);
    this.riskOverlay = new RiskOverlayRenderer(this);
    this.cargoRenderer = new CargoRenderer(this);
    this.islandDossierRenderer = new IslandDossierRenderer(this);
    this.surveySiteRenderer = new SurveySiteRenderer(this);
    this.fishingShoalRenderer = new FishingShoalRenderer(this, this.pilotAssets);
    this.shipRenderer = new ShipRenderer(this, this.pilotAssets);
    this.resetActiveChunkSet();
    this.resetShipPresentation(true);
    this.gridGraphics = this.add.graphics().setDepth(70);
    this.debugGraphics = this.add.graphics().setDepth(71);
    this.entityDebugGraphics = this.add.graphics().setDepth(72);
    this.gameHost = document.querySelector<HTMLElement>("#game-host") ?? undefined;
    this.gameStatus = document.querySelector<HTMLElement>("#game-status") ?? undefined;
    for (const diagnostic of this.pilotAssets.diagnostics) {
      this.log(`Using developer graphics for ${diagnostic.assetId}: ${diagnostic.message}`);
    }
    if (this.productionAssetTestOverride) this.log(this.productionAssetTestOverride.collisionNotice);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input is unavailable");
    this.keys = keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      forward: Phaser.Input.Keyboard.KeyCodes.W,
      reverse: Phaser.Input.Keyboard.KeyCodes.S,
      alternateLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      alternateRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      alternateForward: Phaser.Input.Keyboard.KeyCodes.UP,
      alternateReverse: Phaser.Input.Keyboard.KeyCodes.DOWN,
      zoomIn: Phaser.Input.Keyboard.KeyCodes.E,
      zoomOut: Phaser.Input.Keyboard.KeyCodes.Q,
      survey: Phaser.Input.Keyboard.KeyCodes.F,
      cancel: Phaser.Input.Keyboard.KeyCodes.ESC,
    }, false) as MovementKeys;

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    // Fractional zoom and pixel rounding create visible one-pixel steps. A
    // stronger bounded lerp keeps the first camera response below one frame.
    this.cameras.main.startFollow(this.shipRenderer.container, false, 0.18, 0.18);
    this.configureCamera();
    this.renderWorld();
    this.eventUnsubscribers.push(onPrototypeConfigChanged((sections) => {
      if (sections.has("overlays")) this.simulation.refreshRiskOverlays();
    }));
    this.domAbort = new AbortController();
    this.mountDeveloperTools();
    this.mountSurveyRibbon();
    this.mountHomeAction();
    this.mountGreatHall();
    this.installBrowserDebugApi();
    this.bindSimulationEvents();
    this.showPendingGenerationHandover();
    this.syncPresentation(true);
    const sceneStatus = document.querySelector<HTMLElement>("#scene-status");
    if (sceneStatus) sceneStatus.textContent = "Exploration sandbox active";
    if (this.gameStatus) this.gameStatus.textContent = "WASD / arrows sail · wheel or Q/E zoom · Developer tools tune";

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyBindings());
  }

  override update(_time: number, delta: number): void {
    // Derived guidance requested by the prior authoritative tick is applied
    // before this frame's movement. Requests are coalesced by revision.
    this.simulation.advanceForwardGuidance();
    const activeElement = document.activeElement;
    const developerToolsOpen = document.documentElement.dataset.developerTools === "open";
    const textInputFocused = this.isTextEntryElement(activeElement);
    const greatHallOpen = this.greatHallView?.isOpen ?? false;
    if (!developerToolsOpen && !textInputFocused && !this.simulation.generationHandoverActive && !greatHallOpen && Phaser.Input.Keyboard.JustDown(this.keys.zoomIn)) {
      this.changeZoom(0.1);
    }
    if (!developerToolsOpen && !textInputFocused && !this.simulation.generationHandoverActive && !greatHallOpen && Phaser.Input.Keyboard.JustDown(this.keys.zoomOut)) {
      this.changeZoom(-0.1);
    }
    if (!developerToolsOpen && !textInputFocused && !this.simulation.generationHandoverActive && !greatHallOpen && Phaser.Input.Keyboard.JustDown(this.keys.survey)) {
      if (!this.openGreatHallAtHome()) this.performSurveyAction();
    }
    if (!developerToolsOpen && !textInputFocused && Phaser.Input.Keyboard.JustDown(this.keys.cancel)) {
      if (this.greatHallView?.mode === "home") this.closeGreatHallHome();
    }
    const movementInput = this.readMovementInput();
    let keepAdvancing = true;
    this.clock.advance(delta, (deltaSeconds) => {
      const lifecycleRevision = this.simulation.lifecycleResolutionRevision;
      this.previousShipPose = this.currentShipPose;
      this.simulation.update(movementInput, deltaSeconds);
      this.currentShipPose = this.captureShipPose();
      keepAdvancing = lifecycleRevision === this.simulation.lifecycleResolutionRevision;
      if (!keepAdvancing) this.previousShipPose = this.currentShipPose;
      return keepAdvancing;
    });
    this.frameTiming.record(delta, this.clock.lastDroppedMs, document.visibilityState === "visible");
    this.syncPresentation();
  }

  private readMovementInput(): MovementInput {
    return resolveSceneMovementInput({
      left: this.keys.left.isDown,
      right: this.keys.right.isDown,
      forward: this.keys.forward.isDown,
      reverse: this.keys.reverse.isDown,
      alternateLeft: this.keys.alternateLeft.isDown,
      alternateRight: this.keys.alternateRight.isDown,
      alternateForward: this.keys.alternateForward.isDown,
      alternateReverse: this.keys.alternateReverse.isDown,
    }, this.sceneMovementInputContext());
  }

  private sceneMovementInputContext(): SceneMovementInputContext {
    const activeElement = document.activeElement;
    return {
      developerToolsOpen: document.documentElement.dataset.developerTools === "open",
      developerNumberFocused: this.isDeveloperNumberInput(activeElement),
      textEntryFocused: this.isTextEntryElement(activeElement),
      generationHandoverActive: this.simulation.generationHandoverActive,
      greatHallOpen: this.greatHallView?.isOpen ?? false,
    };
  }

  private isDeveloperNumberInput(element: Element | null): boolean {
    return element instanceof HTMLInputElement
      && (element.type === "number" || element.type === "range")
      && element.closest("#developer-tools-panel") !== null;
  }

  private isTextEntryElement(element: Element | null): boolean {
    if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLElement && element.isContentEditable) return true;
    if (!(element instanceof HTMLInputElement)) return false;
    return [
      "date",
      "datetime-local",
      "email",
      "month",
      "number",
      "password",
      "range",
      "search",
      "tel",
      "text",
      "time",
      "url",
      "week",
    ].includes(element.type);
  }

  private configureCamera(): void {
    const tileSize = prototypeConfig.navigation.tileSize;
    const worldWidth = this.simulation.world.width * tileSize;
    const worldHeight = this.simulation.world.height * tileSize;
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setZoom(Math.max(0.7, Math.min(1.15, this.scale.height / (tileSize * 26))));
  }

  private renderWorld(): void {
    this.resetActiveChunkSet();
    const delta = this.activeChunkSet.update(this.currentViewportChunkRegion());
    this.worldRenderer.render(this.simulation.generated, delta.active);
    this.applyActiveChunkDelta(delta, true);
  }

  private resetActiveChunkSet(): void {
    const world = this.simulation.world;
    this.activeChunkSet = new ActiveChunkSet({
      worldBounds: {
        minX: 0,
        minY: 0,
        maxX: Math.ceil(world.width / world.chunkSize) - 1,
        maxY: Math.ceil(world.height / world.chunkSize) - 1,
      },
      prefetchRing: DEFAULT_ACTIVE_CHUNK_PREFETCH_RING,
      maxActiveChunks: DEFAULT_ACTIVE_CHUNK_BUDGET,
    });
    this.lastActiveChunkRevision = -1;
  }

  private currentViewportChunkRegion() {
    const camera = this.cameras.main;
    const current = camera.worldView;
    const width = current.width > 0 ? current.width : this.scale.width / Math.max(camera.zoom, 0.01);
    const height = current.height > 0 ? current.height : this.scale.height / Math.max(camera.zoom, 0.01);
    const viewport = current.width > 0 && current.height > 0
      ? current
      : {
          x: this.simulation.ship.worldX - width / 2,
          y: this.simulation.ship.worldY - height / 2,
          width,
          height,
        };
    return viewportChunkRegion(viewport, {
      worldWidthTiles: this.simulation.world.width,
      worldHeightTiles: this.simulation.world.height,
      chunkSizeTiles: this.simulation.world.chunkSize,
      tileSizePixels: this.simulation.config.navigation.tileSize,
    });
  }

  private syncActiveChunks(force = false): void {
    const delta = this.activeChunkSet.update(this.currentViewportChunkRegion());
    if (!force && delta.revision === this.lastActiveChunkRevision) return;
    this.applyActiveChunkDelta(delta);
  }

  private applyActiveChunkDelta(delta: Readonly<ActiveChunkDelta>, worldAlreadyBound = false): void {
    if (!worldAlreadyBound) this.worldRenderer.applyActiveChunks(delta);
    this.knowledgeOverlay.applyActiveChunkDelta(this.simulation.world, delta);
    this.riskOverlay.applyActiveChunkDelta(this.simulation.world, delta);
    this.wreckRenderer.applyActiveChunks(delta.active);
    this.islandDossierRenderer.applyActiveChunks(delta.active);
    this.surveySiteRenderer.applyActiveChunks(delta.active);
    this.fishingShoalRenderer.applyActiveChunks(delta.active);
    this.lastActiveChunkRevision = delta.revision;
  }

  private renderDebug(): void {
    const size = this.simulation.config.navigation.tileSize;
    const world = this.simulation.world;
    this.gridGraphics.clear();
    this.debugGraphics.clear();

    if (this.simulation.debug.navigationGrid) {
      this.gridGraphics.lineStyle(1, PALETTE.grid, 0.18);
      for (let x = 0; x <= world.width; x++) this.gridGraphics.lineBetween(x * size, 0, x * size, world.height * size);
      for (let y = 0; y <= world.height; y++) this.gridGraphics.lineBetween(0, y * size, world.width * size, y * size);
    }

    if (this.simulation.debug.collisionBoxes) {
      this.debugGraphics.fillStyle(PALETTE.collision, 0.2);
      this.debugGraphics.lineStyle(1.5, PALETTE.collision, 0.9);
      world.forEachTile((x, y) => {
        const fineMask = world.getFineCollisionMask(x, y);
        if (fineMask !== undefined) {
          for (let subY = 0; subY < COLLISION_SUBCELLS_PER_TILE; subY++) {
            for (let subX = 0; subX < COLLISION_SUBCELLS_PER_TILE; subX++) {
              if (!isCollisionSubcellSolid(fineMask, subX, subY)) continue;
              const left = x * size + subX * COLLISION_SUBCELL_SIZE;
              const top = y * size + subY * COLLISION_SUBCELL_SIZE;
              this.debugGraphics.fillRect(left + 0.5, top + 0.5, COLLISION_SUBCELL_SIZE - 1, COLLISION_SUBCELL_SIZE - 1);
              this.debugGraphics.strokeRect(left + 0.5, top + 0.5, COLLISION_SUBCELL_SIZE - 1, COLLISION_SUBCELL_SIZE - 1);
            }
          }
          return;
        }
        if (world.isMovementBlocked(x, y)) {
          this.debugGraphics.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
          this.debugGraphics.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
        }
      });
    }

    if (this.simulation.debug.currentSight) {
      this.debugGraphics.fillStyle(PALETTE.sight, 0.12);
      this.debugGraphics.lineStyle(1, PALETTE.sight, 0.38);
      for (const index of world.getVisibleIndices()) {
        const x = index % world.width;
        const y = Math.floor(index / world.width);
        this.debugGraphics.fillRect(x * size, y * size, size, size);
        this.debugGraphics.strokeRect(x * size, y * size, size, size);
      }
    }

  }

  private renderEntityDebug(): void {
    const graphics = this.entityDebugGraphics;
    graphics.clear();
    if (!this.simulation.debug.collisionBoxes) return;

    const size = this.simulation.config.navigation.tileSize;
    const bounds = collectDebugEntityBounds({
      ship: {
        worldX: this.shipRenderer.container.x,
        worldY: this.shipRenderer.container.y,
      },
      wrecks: this.simulation.wrecks,
      fishingShoals: this.simulation.fishingShoalDefinitions,
      surveySites: this.simulation.surveySiteDefinitions,
      islandDossiers: this.simulation.islandDossierDefinitions,
      homeDock: this.simulation.generated.landmarks.dock,
    }, size, this.simulation.config.movement.shipCollisionHalfExtent);

    for (const bound of bounds) {
      const color = this.debugEntityColor(bound.role);
      const x = bound.centerX - bound.halfWidth;
      const y = bound.centerY - bound.halfHeight;
      const width = bound.halfWidth * 2;
      const height = bound.halfHeight * 2;
      graphics.fillStyle(color, bound.role === "ship-collider" ? 0.18 : 0.08);
      graphics.lineStyle(bound.role === "ship-collider" ? 2 : 1.5, color, 0.95);
      graphics.fillRect(x, y, width, height);
      graphics.strokeRect(x, y, width, height);
      graphics.lineBetween(bound.centerX - 3, bound.centerY, bound.centerX + 3, bound.centerY);
      graphics.lineBetween(bound.centerX, bound.centerY - 3, bound.centerX, bound.centerY + 3);
    }
  }

  private debugEntityColor(role: DebugEntityBoundsRole): number {
    switch (role) {
      case "ship-collider": return PALETTE.shipCollision;
      case "item": return PALETTE.entityBounds;
      case "service": return PALETTE.serviceBounds;
    }
  }

  private syncPresentation(force = false): void {
    this.presentationWork.beginFrame();
    this.syncActiveChunks(force);
    const spatialEntitiesBefore = this.simulation.descriptorSpatialQueryTotals.entitiesExamined;
    this.shipRenderer.syncInterpolated(
      this.previousShipPose,
      this.currentShipPose,
      this.clock.interpolationAlpha,
      !this.simulation.wreckPresentationActive,
    );
    if (
      force
      || this.lastWrecksRevision !== this.simulation.wrecksRevision
      || this.lastWreckVisibilityVersion !== this.simulation.world.visibilityVersion
    ) {
      const wrecks = this.simulation.wrecks;
      this.wreckRenderer.sync(wrecks, this.simulation.world);
      this.presentationWork.recordRevisionSync(this.activeWreckMarkers, wrecks.length);
      this.activeWreckMarkers = wrecks.length;
      this.lastWrecksRevision = this.simulation.wrecksRevision;
      this.lastWreckVisibilityVersion = this.simulation.world.visibilityVersion;
    }
    if (force || this.lastIslandDossierRecordsRevision !== this.simulation.islandDossierRecordsRevision) {
      const records = this.simulation.islandDossierReadModels;
      this.islandDossierRenderer.sync(records);
      this.presentationWork.recordRevisionSync(this.activeIslandDossierMarkers, records.length);
      this.activeIslandDossierMarkers = records.length;
      this.lastIslandDossierRecordsRevision = this.simulation.islandDossierRecordsRevision;
    }
    if (
      force
      || this.lastSurveySiteRecordsRevision !== this.simulation.surveySiteRecordsRevision
      || this.lastSurveySiteVisibilityVersion !== this.simulation.world.visibilityVersion
      || this.lastSurveySiteKnowledgeVersion !== this.simulation.world.knowledgeVersion
    ) {
      const records = this.simulation.surveySiteReadModels;
      this.surveySiteRenderer.sync(records);
      this.presentationWork.recordRevisionSync(this.activeSurveySiteMarkers, records.length);
      this.activeSurveySiteMarkers = records.length;
      this.lastSurveySiteRecordsRevision = this.simulation.surveySiteRecordsRevision;
      this.lastSurveySiteVisibilityVersion = this.simulation.world.visibilityVersion;
      this.lastSurveySiteKnowledgeVersion = this.simulation.world.knowledgeVersion;
    }
    if (
      force
      || this.lastFishingShoalRecordsRevision !== this.simulation.fishingShoalRecordsRevision
      || this.lastFishingShoalVisibilityVersion !== this.simulation.world.visibilityVersion
      || this.lastFishingShoalKnowledgeVersion !== this.simulation.world.knowledgeVersion
      || this.lastFishingShoalSupportedTopologyVersion !== this.simulation.world.supportedTopologyVersion
    ) {
      const records = this.simulation.fishingShoalReadModels;
      this.fishingShoalRenderer.sync(records);
      this.presentationWork.recordRevisionSync(this.activeFishingShoalMarkers, records.length);
      this.activeFishingShoalMarkers = records.length;
      this.lastFishingShoalRecordsRevision = this.simulation.fishingShoalRecordsRevision;
      this.lastFishingShoalVisibilityVersion = this.simulation.world.visibilityVersion;
      this.lastFishingShoalKnowledgeVersion = this.simulation.world.knowledgeVersion;
      this.lastFishingShoalSupportedTopologyVersion = this.simulation.world.supportedTopologyVersion;
    }
    const camera = this.cameras.main;
    const viewport = camera.worldView;
    const viewportChanged = force
      || viewport.x !== this.lastViewportX
      || viewport.y !== this.lastViewportY
      || viewport.width !== this.lastViewportWidth
      || viewport.height !== this.lastViewportHeight
      || camera.zoom !== this.lastViewportZoom;
    if (viewportChanged) {
      this.presentationWork.recordViewportQuery();
      this.lastViewportX = viewport.x;
      this.lastViewportY = viewport.y;
      this.lastViewportWidth = viewport.width;
      this.lastViewportHeight = viewport.height;
      this.lastViewportZoom = camera.zoom;
    }
    this.renderEntityDebug();
    this.knowledgeOverlay.sync(
      this.simulation.world,
      this.simulation.generated.seed,
      force,
      new Set(this.simulation.revealedIslandIds),
      this.simulation.islandFogRevealRevision,
    );
    this.riskOverlay.sync(
      this.simulation.world,
      this.simulation.forwardRange,
      this.simulation.returnPaths,
      this.simulation.debug,
      this.simulation.overlaysRevision,
      force,
    );
    this.cargoRenderer.sync(this.simulation.ship.provisions);
    this.syncSurveyRibbon();
    const spatialEntitiesAfter = this.simulation.descriptorSpatialQueryTotals.entitiesExamined;
    this.presentationWork.recordEntityQueries(spatialEntitiesAfter - spatialEntitiesBefore);
    this.syncHomeAction();
    const developerToolsOpen = document.documentElement.dataset.developerTools === "open";
    const greatHallOpen = this.greatHallView?.isOpen ?? false;
    const inputSuppressed = this.simulation.wreckPresentationActive
      || isSceneMovementInputSuppressed(this.sceneMovementInputContext());
    const diagnosticsDirty = this.lastDiagnosticsRevision !== this.simulation.revision
      || this.lastDiagnosticsOverlayRevision !== this.simulation.overlaysRevision
      || this.lastDiagnosticsDeveloperToolsOpen !== developerToolsOpen
      || this.lastDiagnosticsInputSuppressed !== inputSuppressed;
    const diagnosticsDue = force || (
      this.time.now - this.lastDiagnosticsAt >= 100
      && (
        diagnosticsDirty
        || Math.abs(this.simulation.ship.speed) > 0
        || this.simulation.wreckPresentationActive
        || this.simulation.generationHandoverActive
        || greatHallOpen
      )
    );
    const diagnosticsStartedAt = diagnosticsDue ? performance.now() : undefined;
    const host = this.gameHost;
    if (diagnosticsDue && host) {
      if (this.datasetGenerated !== this.simulation.generated) {
        host.dataset.seed = String(this.simulation.generated.seed);
        host.dataset.islandCount = String(this.simulation.generated.islands.length);
        host.dataset.islandKinds = String(new Set(this.simulation.generated.islands.map(({ kind }) => kind)).size);
        host.dataset.islandSizes = String(new Set(this.simulation.generated.islands.map(({ size }) => size)).size);
        this.datasetGenerated = this.simulation.generated;
      }
      host.dataset.tileX = String(this.simulation.ship.currentTileX);
      host.dataset.tileY = String(this.simulation.ship.currentTileY);
      host.dataset.tileKnowledge = KnowledgeState[
        this.simulation.world.getKnowledge(this.simulation.ship.currentTileX, this.simulation.ship.currentTileY)
      ].toLowerCase();
      host.dataset.heading = this.simulation.ship.heading.toFixed(1);
      host.dataset.speed = this.simulation.ship.speed.toFixed(2);
      host.dataset.collided = String(this.simulation.lastMovement.collided);
      host.dataset.provisions = String(this.simulation.ship.provisions);
      host.dataset.provisionAccumulator = this.simulation.ship.provisionAccumulator.toFixed(3);
      host.dataset.expeditionId = String(this.simulation.currentExpeditionId);
      host.dataset.expeditionActive = String(this.simulation.expeditionActive);
      host.dataset.generation = String(this.simulation.generation);
      host.dataset.navigatorId = this.simulation.currentNavigator.id;
      host.dataset.navigatorState = this.simulation.currentNavigator.state;
      host.dataset.navigatorVoyagesCompleted = String(this.simulation.navigatorVoyagesCompleted);
      host.dataset.navigatorVoyagesRemaining = String(this.simulation.navigatorVoyagesRemaining);
      host.dataset.navigatorVoyageNumber = String(this.simulation.navigatorVoyageNumber);
      host.dataset.lineageNavigators = String(this.simulation.navigatorLineage.length);
      host.dataset.successfulReturns = String(this.simulation.successfulReturns);
      host.dataset.failedExpeditions = String(this.simulation.failedExpeditions);
      host.dataset.atDock = String(this.simulation.atDock);
      host.dataset.greatHallAvailable = String(this.canVisitGreatHall());
      host.dataset.greatHallOpen = String(greatHallOpen);
      host.dataset.greatHallMode = this.greatHallView?.mode ?? "";
      host.dataset.greatHallSelectedGeneration = String(this.greatHallView?.selectedGeneration ?? "");
      host.dataset.greatHallUpdated = String(this.greatHallUpdated);
      host.dataset.wrecks = String(this.simulation.wrecks.length);
      host.dataset.wreckSurveyProvisional = String(this.simulation.provisionalWreckSurveys.length);
      host.dataset.wreckSurveyReturned = String(this.simulation.returnedWreckSurveys.length);
      host.dataset.wreckSurveyInteraction = String(this.simulation.wreckSurveyInteraction?.wreckId ?? "");
      host.dataset.islandDossierProvisional = String(this.simulation.provisionalIslandDossiers.length);
      host.dataset.islandDossierReturned = String(this.simulation.returnedIslandDossiers.length);
      host.dataset.islandDossierRevealed = String(this.simulation.revealedIslandIds.length);
      host.dataset.islandDossierInteraction = String(this.simulation.islandDossierInteraction?.islandId ?? "");
      host.dataset.surveySiteAvailable = String(this.simulation.surveySiteDefinitions.length);
      host.dataset.surveySiteProvisional = String(this.simulation.provisionalSurveySites.length);
      host.dataset.surveySiteReturned = String(this.simulation.returnedSurveySites.length);
      host.dataset.surveySiteVisible = String(this.simulation.surveySiteReadModels.length);
      host.dataset.surveySiteInteraction = this.simulation.surveySiteInteraction?.id ?? "";
      host.dataset.fishingShoalAvailable = String(this.simulation.fishingShoalDefinitions.length);
      host.dataset.fishingShoalProvisional = String(this.simulation.provisionalFishingShoals.length);
      host.dataset.fishingShoalReturned = String(this.simulation.returnedFishingShoals.length);
      host.dataset.fishingShoalActivationEligible = String(this.simulation.activationEligibleFishingShoals.length);
      host.dataset.fishingShoalConnectivityBuilds = String(this.simulation.fishingShoalConnectivityBuildCount);
      host.dataset.fishingShoalVisible = String(this.simulation.fishingShoalReadModels.length);
      host.dataset.surveyCost = String(this.simulation.config.provisions.surveyCost);
      host.dataset.fishingShoalInteraction = this.simulation.fishingShoalInteraction?.id ?? "";
      host.dataset.wreckPresentation = String(this.simulation.wreckPresentationActive);
      host.dataset.respawnSeconds = this.simulation.respawnSecondsRemaining.toFixed(3);
      host.dataset.lifecyclePhase = this.simulation.generationHandoverActive
        ? "generation-summary"
        : greatHallOpen
          ? "great-hall"
          : this.simulation.wreckPresentationActive
          ? "wreck-hold"
          : "active";
      host.dataset.inputSuppressed = String(inputSuppressed);
      host.dataset.pendingWreckId = String(this.simulation.pendingWreckId ?? "");
      host.dataset.stranded = String(this.simulation.stranded);
      host.dataset.overlaysRevision = String(this.simulation.overlaysRevision);
      host.dataset.riskBudget = this.simulation.forwardRange.budget.toFixed(3);
      host.dataset.simulationRevision = String(this.simulation.revision);
      host.dataset.knowledgeVersion = String(this.simulation.world.knowledgeVersion);
      host.dataset.supportedTopologyVersion = String(this.simulation.world.supportedTopologyVersion);
      host.dataset.visibilityVersion = String(this.simulation.world.visibilityVersion);
      const timing = this.frameTiming.snapshot();
      host.dataset.frameP50Ms = timing.p50Ms.toFixed(2);
      host.dataset.frameP95Ms = timing.p95Ms.toFixed(2);
      host.dataset.frameP99Ms = timing.p99Ms.toFixed(2);
      host.dataset.frameMaxMs = timing.maxMs.toFixed(2);
      host.dataset.longFrames = String(timing.longFrameCount);
      host.dataset.droppedSimulationMs = timing.totalDroppedSimulationMs.toFixed(2);
    }
    if (document.documentElement.dataset.wayfindersReady !== "true") {
      document.documentElement.dataset.wayfindersReady = "true";
    }

    const debugChanged = force
      || this.lastDebugRevision !== this.simulation.revision
      || this.lastDebugOverlayRevision !== this.simulation.overlaysRevision;
    const debugVisible = this.simulation.debug.navigationGrid
      || this.simulation.debug.collisionBoxes
      || this.simulation.debug.currentSight;
    if (debugChanged && (debugVisible || this.lastDebugVisible)) {
      this.renderDebug();
    }
    if (debugChanged) {
      this.lastDebugRevision = this.simulation.revision;
      this.lastDebugOverlayRevision = this.simulation.overlaysRevision;
      this.lastDebugVisible = debugVisible;
      this.syncRiskLegend();
    }

    if (diagnosticsDue) {
      const diagnostics = this.simulationDiagnostics.read(this.simulation);
      this.updateProvisionOutput();
      if (host) {
        host.dataset.personalTiles = String(diagnostics.knowledge.personal);
        host.dataset.supportedTiles = String(diagnostics.knowledge.supported);
        host.dataset.unknownTiles = String(diagnostics.knowledge.unknown);
        host.dataset.visibleTiles = String(diagnostics.knowledge.visibleNow);
        host.dataset.forwardReachable = String(diagnostics.risk.forwardReachable);
        host.dataset.forwardFrontier = String(diagnostics.risk.forwardFrontier);
        host.dataset.forwardHeading = diagnostics.risk.forwardHeading.toFixed(2);
        host.dataset.forwardConeHalfAngle = String(diagnostics.risk.forwardConeHalfAngleDegrees);
        host.dataset.returnComfortable = String(diagnostics.risk.comfortable);
        host.dataset.returnWarning = String(diagnostics.risk.warning);
        host.dataset.returnCritical = String(diagnostics.risk.critical);
        host.dataset.returnImpossible = String(diagnostics.risk.impossible);
        host.dataset.returnPathTiles = String(diagnostics.risk.returnPathTiles);
        host.dataset.returnCorridorTiles = String(diagnostics.risk.returnCorridorTiles);
        host.dataset.returnLevel = String(diagnostics.risk.returnLevel);
        host.dataset.returnCost = diagnostics.risk.returnCost?.toFixed(3) ?? "unreachable";
        host.dataset.returnMargin = diagnostics.risk.returnMargin?.toFixed(3) ?? "unreachable";
      }
      this.lastDiagnosticsRevision = this.simulation.revision;
      this.lastDiagnosticsOverlayRevision = this.simulation.overlaysRevision;
      this.lastDiagnosticsDeveloperToolsOpen = developerToolsOpen;
      this.lastDiagnosticsInputSuppressed = inputSuppressed;
      this.lastDiagnosticsAt = this.time.now;
    }
    if (diagnosticsDue && this.gameStatus) {
      const voyage = `Voyage ${this.simulation.navigatorVoyageNumber} of 4`;
      const message = this.greatHallView?.mode === "home"
        ? "Great Hall · lineage chronicle open at the home dock"
        : this.simulation.generationHandoverActive
        ? "A navigator's journeys are being remembered · continue to begin the next generation"
        : this.simulation.wreckPresentationActive
        ? `Home mourns · a new navigator takes the helm in ${this.simulation.respawnSecondsRemaining.toFixed(1)}s`
        : this.simulation.stranded
        ? "Developer zero-cargo state · add a bundle or force a wreck"
        : this.simulation.expeditionActive
        ? `${voyage} underway · return to the home dock to secure findings`
        : `${voyage} ready · WASD / arrows sail · wheel or Q/E zoom`;
      if (this.gameStatus.textContent !== message) this.gameStatus.textContent = message;
    }
    if (diagnosticsStartedAt !== undefined) {
      this.presentationWork.recordDiagnostics(performance.now() - diagnosticsStartedAt);
      if (host) {
        const work = this.presentationWork.snapshot();
        host.dataset.presentationQueriedEntities = String(work.queriedEntities);
        host.dataset.presentationChangedEntities = String(work.changedEntities);
        host.dataset.presentationActiveMarkers = String(work.activeMarkers);
        host.dataset.presentationDiagnosticsMs = work.diagnosticsMs.toFixed(3);
      }
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.teleportOnClick) return;
    const tile = worldToGrid(pointer.worldX, pointer.worldY);
    if (this.teleportForDeveloper(tile, `Teleported to ${tile.x}, ${tile.y}.`)) {
      this.teleportOnClick = false;
      this.updateTeleportButton();
    }
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
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom + delta, 0.65, 1.7));
  }

  private mountDeveloperTools(): void {
    const slot = document.querySelector<HTMLDivElement>("#scene-tools-slot");
    if (!slot) return;
    this.developerToolsAbort?.abort();
    this.developerToolsAbort = new AbortController();
    const signal = this.developerToolsAbort.signal;
    slot.classList.add("tool-slot--connected");

    slot.innerHTML = `
      <div class="sandbox-tools">
        <section class="tool-card tool-card--status" aria-labelledby="current-expedition-title">
          <h3 id="current-expedition-title">Current expedition</h3>
          <dl class="tool-facts">
            <div><dt>Generation</dt><dd data-state="generation"></dd></div>
            <div><dt>Navigator</dt><dd data-state="navigator"></dd></div>
            <div><dt>Voyage</dt><dd data-state="voyage"></dd></div>
            <div><dt>Lifecycle</dt><dd data-state="lifecycle"></dd></div>
            <div><dt>Lineage</dt><dd data-state="lineage"></dd></div>
            <div><dt>Wreck reports</dt><dd data-state="wreck-reports"></dd></div>
            <div><dt>Survey cost</dt><dd data-state="survey-cost"></dd></div>
          </dl>
          <p class="tool-lock-message" data-output="lock-reason" role="status" hidden></p>
        </section>

        <fieldset class="tool-card">
          <legend>World and travel</legend>
          <label class="tool-number tool-number--seed"><span>Seed</span><input data-field="seed" type="number" step="1" value="${this.simulation.generated.seed}"></label>
          <div class="tool-button-grid">
            <button class="tool-button--wide" data-action="regenerate" type="button">Reset world from entered seed</button>
            <button class="tool-button--wide" data-action="return-dock" type="button">Return to home dock (complete voyage)</button>
            <button data-action="inspect-island" type="button">Move to next island dossier</button>
            <button data-action="inspect-fishing-shoal" type="button">Move to next fishing ground</button>
            <button data-action="inspect-wreck" type="button">Move to next navigator wreck</button>
            <button data-action="inspect-site-historic-wreck" type="button">Move to historic / old wreck site</button>
            <button data-action="inspect-site-coastal-ruin" type="button">Move to coastal ruin</button>
            <button data-action="inspect-site-tidal-cave" type="button">Move to tidal cave</button>
            <button data-action="teleport-click" type="button" aria-pressed="false">Teleport by clicking</button>
          </div>
          <div class="tool-row">
            <label>X <input data-field="teleport-x" type="number" step="1" value="${this.simulation.ship.currentTileX}"></label>
            <label>Y <input data-field="teleport-y" type="number" step="1" value="${this.simulation.ship.currentTileY}"></label>
            <button data-action="teleport-coordinates" type="button">Go</button>
          </div>
        </fieldset>

        <fieldset class="tool-card">
          <legend>Ship and failure</legend>
          <div class="tool-row tool-row--buttons">
            <button data-action="provisions-remove" type="button">− bundle</button>
            <output data-output="provisions">${this.simulation.ship.provisions} bundles aboard</output>
            <button data-action="provisions-add" type="button">+ bundle</button>
            <button data-action="force-wreck" type="button">Force wreck</button>
          </div>
        </fieldset>

        <fieldset class="tool-card">
          <legend>Expedition records</legend>
          <output data-output="records">${this.expeditionRecordsSummary()}</output>
        </fieldset>

        <details class="tool-disclosure" data-tool-group="overlays" ${this.developerDisclosureState.get("overlays") ? "open" : ""}>
          <summary>Overlay visibility</summary>
          <div class="tool-disclosure__body">
            ${this.toggleMarkup("navigationGrid", "Navigation grid")}
            ${this.toggleMarkup("collisionBoxes", "Collision boxes")}
            <p class="tool-live-note">Red: blocking terrain &middot; amber: live ship hull &middot; cyan: world items &middot; green: service/approach tiles</p>
            ${this.toggleMarkup("currentSight", "Current line of sight")}
            ${this.toggleMarkup("forwardRange", "Forward reach limit")}
            ${this.toggleMarkup("returnViability", "Return route viability")}
          </div>
        </details>

        <details class="tool-disclosure" data-tool-group="tuning" ${this.developerDisclosureState.get("tuning") ? "open" : ""}>
          <summary>Session-only tuning</summary>
          <div class="tool-disclosure__body">
            <p class="tool-live-note">Tune while sailing: WASD stays active when a number has focus; arrows edit that number.</p>
            ${this.numberMarkup("sight-radius", "Sight radius", prototypeConfig.navigation.sightRadius, 1, 14, 1)}
            ${this.numberMarkup("starting-bundles", "Default voyage bundles", prototypeConfig.provisions.startingBundles, 1, 24, 1)}
            ${this.numberMarkup("survey-cost", "Survey cost (bundles)", prototypeConfig.provisions.surveyCost, 1, 12, 1)}
            ${this.numberMarkup("supported-cost", "Supported cost", prototypeConfig.provisions.supportedCost, 0, 3, 0.1)}
            ${this.numberMarkup("personal-cost", "Personal cost", prototypeConfig.provisions.personalCost, 0, 3, 0.1)}
            ${this.numberMarkup("unknown-cost", "Unknown cost", prototypeConfig.provisions.unknownCost, 0, 4, 0.1)}
            ${this.numberMarkup("ship-speed", "Ship speed (tiles/s)", prototypeConfig.movement.shipSpeed, 0.5, 8, 0.1)}
            ${this.numberMarkup("risk-comfortable", "Comfortable margin", prototypeConfig.returnRisk.comfortable, 0, 12, 0.5)}
            ${this.numberMarkup("risk-warning", "Warning margin", prototypeConfig.returnRisk.warning, 0, 8, 0.5)}
            ${this.numberMarkup("risk-critical", "Critical margin", prototypeConfig.returnRisk.critical, 0, 4, 0.5)}
          </div>
        </details>

        <details class="tool-disclosure" data-tool-group="advanced" ${this.developerDisclosureState.get("advanced") ? "open" : ""}>
          <summary>Advanced navigation and presentation</summary>
          <div class="tool-disclosure__body">
            ${this.numberMarkup("forward-cone-half-angle", "Forward cone half-angle", prototypeConfig.overlays.forwardConeHalfAngleDegrees, 1, 180, 5)}
            ${this.numberMarkup("unknown-cleanup-limit", "Returned Unknown cleanup limit", prototypeConfig.world.maxEnclosedUnknownTiles, 0, 8, 1)}
            ${this.numberMarkup("return-path-padding", "Return route padding", prototypeConfig.overlays.returnPathPadding, 0, 4, 1)}
            ${this.numberMarkup("forward-opacity", "Forward opacity", prototypeConfig.overlays.forwardOverlayOpacity, 0, 1, 0.05)}
            ${this.numberMarkup("return-opacity", "Return opacity", prototypeConfig.overlays.returnOverlayOpacity, 0, 1, 0.05)}
            ${this.numberMarkup("fog-blend", "Fog transition width", prototypeConfig.overlays.fogBlend, 0, 1, 0.02)}
            ${this.numberMarkup("fog-noise", "Fog noise strength", prototypeConfig.overlays.fogNoise, 0, 1, 0.02)}
          </div>
        </details>
      </div>`;

    this.provisionOutput = slot.querySelector<HTMLOutputElement>("[data-output='provisions']") ?? undefined;
    this.recordsOutput = slot.querySelector<HTMLOutputElement>("[data-output='records']") ?? undefined;
    this.developerStateOutputs.clear();
    slot.querySelectorAll<HTMLElement>("[data-state]").forEach((output) => {
      if (output.dataset.state) this.developerStateOutputs.set(output.dataset.state, output);
    });

    slot.querySelectorAll<HTMLDetailsElement>("details[data-tool-group]").forEach((details) => {
      details.addEventListener("toggle", () => {
        if (details.dataset.toolGroup) this.developerDisclosureState.set(details.dataset.toolGroup, details.open);
      }, { signal });
    });

    slot.querySelectorAll<HTMLInputElement>("input[data-overlay]").forEach((input) => {
      input.addEventListener("change", () => {
        const name = input.dataset.overlay as keyof GameSimulation["debug"];
        this.simulation.setDebugVisibility(name, input.checked);
        this.syncRiskLegend();
      }, { signal });
    });
    slot.querySelectorAll<HTMLInputElement>("input[data-config]").forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.dataset.config ?? "";
        if (!input.checkValidity()) {
          this.log(`${input.labels?.[0]?.textContent?.trim() ?? "Configuration value"} is outside its allowed range.`);
        } else {
          this.applyLiveConfig(id, input.valueAsNumber);
        }
        input.value = String(this.liveConfigValue(id));
      }, { signal });
    });
    slot.querySelector<HTMLButtonElement>("[data-action='regenerate']")?.addEventListener("click", () => {
      const seed = this.field("seed").valueAsNumber;
      this.simulation.regenerate(seed);
      this.afterWorldChanged();
      this.log(`Regenerated deterministic world from seed ${this.simulation.generated.seed}.`);
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='return-dock']")?.addEventListener("click", () => {
      this.returnToDockForTesting();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='teleport-click']")?.addEventListener("click", () => {
      this.teleportOnClick = !this.teleportOnClick;
      this.updateTeleportButton();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='inspect-island']")?.addEventListener("click", () => {
      this.inspectNextIsland();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='inspect-fishing-shoal']")?.addEventListener("click", () => {
      this.inspectNextFishingShoal();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='inspect-wreck']")?.addEventListener("click", () => {
      this.inspectNextNavigatorWreck();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='inspect-site-historic-wreck']")?.addEventListener("click", () => {
      this.inspectNextSurveySite("historic-wreck");
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='inspect-site-coastal-ruin']")?.addEventListener("click", () => {
      this.inspectNextSurveySite("coastal-ruin");
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='inspect-site-tidal-cave']")?.addEventListener("click", () => {
      this.inspectNextSurveySite("tidal-cave");
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='teleport-coordinates']")?.addEventListener("click", () => {
      const x = Math.trunc(this.field("teleport-x").valueAsNumber);
      const y = Math.trunc(this.field("teleport-y").valueAsNumber);
      this.teleportForDeveloper({ x, y }, `Teleported to ${x}, ${y}.`);
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='provisions-add']")?.addEventListener("click", () => {
      this.simulation.addProvisions(1);
      this.updateProvisionOutput();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='provisions-remove']")?.addEventListener("click", () => {
      this.simulation.addProvisions(-1);
      this.updateProvisionOutput();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='force-wreck']")?.addEventListener("click", () => {
      const lockReason = this.developerActionLockReason();
      if (lockReason) this.log(lockReason);
      else if (!this.forceWreckForTesting()) this.log("Force wreck requires an active ship outside Supported water.");
    }, { signal });
    this.updateDeveloperStateOutputs();
    this.syncDeveloperToolAvailability();
    this.syncRiskLegend();
  }

  private mountSurveyRibbon(): void {
    const host = this.gameHost;
    const signal = this.domAbort?.signal;
    if (!host || !signal) return;

    const ribbon = document.createElement("section");
    ribbon.className = "survey-ribbon";
    ribbon.hidden = true;
    ribbon.setAttribute("aria-label", "Survey decision");
    ribbon.innerHTML = `
      <div>
        <strong data-survey-title>Fishing sign nearby</strong>
        <span data-survey-clue></span>
        <span data-survey-cost></span>
      </div>
      <div class="survey-ribbon__actions">
        <button data-survey-action="survey" type="button">Survey <kbd>F</kbd></button>
      </div>`;
    host.append(ribbon);
    this.surveyRibbon = ribbon;
    this.surveyRibbonTitle = ribbon.querySelector<HTMLElement>("[data-survey-title]") ?? undefined;
    this.surveyRibbonClue = ribbon.querySelector<HTMLElement>("[data-survey-clue]") ?? undefined;
    this.surveyRibbonCost = ribbon.querySelector<HTMLElement>("[data-survey-cost]") ?? undefined;
    this.surveyButton = ribbon.querySelector<HTMLButtonElement>("[data-survey-action='survey']") ?? undefined;
    this.surveyButton?.addEventListener("click", () => this.performSurveyAction(), { signal });
  }

  private syncSurveyRibbon(): void {
    const ribbon = this.surveyRibbon;
    if (!ribbon) return;
    if (this.simulation.generationHandoverActive || this.greatHallView?.isOpen) {
      ribbon.hidden = true;
      return;
    }

    const wreckInteraction = this.simulation.wreckSurveyInteraction;
    if (wreckInteraction) {
      if (this.surveyRibbonTitle) this.surveyRibbonTitle.textContent = "Unidentified navigator wreck";
      if (this.surveyRibbonClue) {
        this.surveyRibbonClue.textContent = "Survey the remains to identify the lost navigator.";
      }
      if (this.surveyRibbonCost) this.surveyRibbonCost.textContent = this.surveyBudgetText(wreckInteraction);
      if (this.surveyButton) this.surveyButton.disabled = !wreckInteraction.canAfford;
      ribbon.dataset.surveyKind = "wreck";
      ribbon.dataset.surveyTarget = String(wreckInteraction.wreckId);
      delete ribbon.dataset.shoalId;
      ribbon.hidden = false;
      return;
    }

    const surveySiteInteraction = this.simulation.surveySiteInteraction;
    if (surveySiteInteraction) {
      if (this.surveyRibbonTitle) {
        this.surveyRibbonTitle.textContent = surveySiteInteraction.state === "returned-lead"
          ? `Returned ${surveySiteInteraction.typeLabel.toLowerCase()} lead`
          : `${surveySiteInteraction.typeLabel} nearby`;
      }
      if (this.surveyRibbonClue) this.surveyRibbonClue.textContent = surveySiteInteraction.clueLabel;
      if (this.surveyRibbonCost) this.surveyRibbonCost.textContent = this.surveyBudgetText(surveySiteInteraction);
      if (this.surveyButton) this.surveyButton.disabled = !surveySiteInteraction.canAfford;
      ribbon.dataset.surveyKind = "survey-site";
      ribbon.dataset.surveyTarget = surveySiteInteraction.id;
      delete ribbon.dataset.shoalId;
      ribbon.hidden = false;
      return;
    }

    const fishingInteraction = this.simulation.fishingShoalInteraction;
    if (fishingInteraction) {
      if (this.surveyRibbonTitle) {
        this.surveyRibbonTitle.textContent = fishingInteraction.state === "returned-lead"
        ? "Returned fishing lead"
        : "Fishing sign nearby";
      }
      if (this.surveyRibbonClue) this.surveyRibbonClue.textContent = fishingInteraction.clueLabel;
      if (this.surveyRibbonCost) this.surveyRibbonCost.textContent = this.surveyBudgetText(fishingInteraction);
      if (this.surveyButton) this.surveyButton.disabled = !fishingInteraction.canAfford;
      ribbon.dataset.surveyKind = "fishing-shoal";
      ribbon.dataset.surveyTarget = fishingInteraction.id;
      ribbon.dataset.shoalId = fishingInteraction.id;
      ribbon.hidden = false;
      return;
    }

    const islandInteraction = this.simulation.islandDossierInteraction;
    if (islandInteraction) {
      if (this.surveyRibbonTitle) {
        this.surveyRibbonTitle.textContent = islandInteraction.state === "returned-lead"
          ? `Returned island lead · ${islandInteraction.name}`
          : `Island landfall · ${islandInteraction.name}`;
      }
      if (this.surveyRibbonClue) {
        this.surveyRibbonClue.textContent = "Survey from this coastal approach to complete the island dossier.";
      }
      if (this.surveyRibbonCost) this.surveyRibbonCost.textContent = this.surveyBudgetText(islandInteraction);
      if (this.surveyButton) this.surveyButton.disabled = !islandInteraction.canAfford;
      ribbon.dataset.surveyKind = "island-dossier";
      ribbon.dataset.surveyTarget = String(islandInteraction.islandId);
      delete ribbon.dataset.shoalId;
      ribbon.hidden = false;
      return;
    }

    ribbon.hidden = true;
    delete ribbon.dataset.surveyKind;
    delete ribbon.dataset.surveyTarget;
    delete ribbon.dataset.shoalId;
  }

  private performSurveyAction():
    | FishingShoalInteractionResultV1
    | WreckSurveyInteractionResultV1
    | IslandDossierInteractionResultV1
    | SurveySiteInteractionResult
    | undefined {
    if (this.simulation.generationHandoverActive) return undefined;
    if (this.simulation.wreckSurveyInteraction) return this.performWreckSurvey();
    if (this.simulation.surveySiteInteraction) return this.performSurveySiteSurvey();
    if (this.simulation.fishingShoalInteraction) return this.performFishingShoalSurvey();
    return this.performIslandDossierSurvey();
  }

  private surveyBudgetText(budget: Readonly<SurveyBudgetReadModel>): string {
    const remaining = budget.remainingProvisionUnits.toFixed(1).replace(/\.0$/, "");
    if (!budget.canAfford) {
      const available = budget.availableProvisionUnits.toFixed(1).replace(/\.0$/, "");
      return `Costs ${budget.surveyCost} bundles — only ${available} usable remain. Keep sailing to defer.`;
    }
    const returnMessage = budget.projectedReturnMargin === null
      ? "return route currently unknown"
      : budget.projectedReturnMargin >= 0
        ? `${budget.projectedReturnMargin.toFixed(1)} bundle projected return margin`
        : `${Math.abs(budget.projectedReturnMargin).toFixed(1)} bundles short of the known return`;
    return `Costs ${budget.surveyCost} bundles · ${remaining} usable remain · ${returnMessage} · provisional until dock.`;
  }

  private performWreckSurvey(): WreckSurveyInteractionResultV1 | undefined {
    const interaction = this.simulation.wreckSurveyInteraction;
    if (!interaction) return undefined;
    const result = this.simulation.interactWithWreck({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      type: "survey",
      wreckId: interaction.wreckId,
    });
    if (result.status === "surveyed") {
      this.updateRecordsOutputs();
    } else if (result.status === "rejected") {
      this.log(`Wreck survey was not started: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private performFishingShoalSurvey(): FishingShoalInteractionResultV1 | undefined {
    const interaction = this.simulation.fishingShoalInteraction;
    if (!interaction) return undefined;
    const result = this.simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: interaction.id,
    });
    if (result.status === "surveyed") {
      this.updateRecordsOutputs();
    } else if (result.status === "rejected") {
      this.log(`Fishing-shoal survey was not started: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private performSurveySiteSurvey(): SurveySiteInteractionResult | undefined {
    const interaction = this.simulation.surveySiteInteraction;
    if (!interaction) return undefined;
    const result = this.simulation.interactWithSurveySite({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: interaction.id,
    });
    if (result.status === "surveyed") {
      this.updateRecordsOutputs();
    } else {
      this.log(`${interaction.typeLabel} survey was not started: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private performIslandDossierSurvey(): IslandDossierInteractionResultV1 | undefined {
    const interaction = this.simulation.islandDossierInteraction;
    if (!interaction) return undefined;
    const result = this.simulation.interactWithIslandDossier({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: interaction.islandId,
    });
    if (result.status === "surveyed") {
      this.updateRecordsOutputs();
    } else {
      this.log(`Island dossier survey was not started: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private mountHomeAction(): void {
    const host = this.gameHost;
    const signal = this.domAbort?.signal;
    if (!host || !signal) return;
    const action = document.createElement("aside");
    action.className = "home-action";
    action.dataset.homeAction = "great-hall";
    action.hidden = true;
    action.setAttribute("aria-label", "Home shore action");
    action.innerHTML = `
      <div>
        <strong>Home shore</strong>
        <span>The Great Hall preserves every journey returned to the tribe.</span>
      </div>
      <button data-visit-great-hall type="button">Go ashore · Great Hall <kbd>F</kbd></button>`;
    host.append(action);
    this.homeAction = action;
    this.homeActionButton = action.querySelector<HTMLButtonElement>("[data-visit-great-hall]") ?? undefined;
    this.homeActionButton?.addEventListener("click", () => this.openGreatHallAtHome(), { signal });
  }

  private mountGreatHall(): void {
    const host = this.gameHost;
    const signal = this.domAbort?.signal;
    if (!host || !signal) return;
    this.greatHallView = new GreatHallView(host, signal, {
      closeHome: () => { this.closeGreatHallHome(); },
      continueHandover: () => { this.dismissGenerationHandover(); },
      continueCompletedWorld: () => { this.continueCompletedWorld(); },
      startNewGame: () => { this.startNewGameFromCompletion(); },
    });
  }

  private greatHallChronicle(): Readonly<GreatHallChronicle> {
    return buildGreatHallChronicle(this.simulation.navigatorLineage, this.greatHallChronicleSources());
  }

  private greatHallChronicleSources(): GreatHallChronicleSources {
    return {
      islandDossiers: this.simulation.islandDossierDefinitions,
      surveySites: this.simulation.surveySiteDefinitions,
      fishingShoals: this.simulation.fishingShoalDefinitions,
      wrecks: this.simulation.wrecks,
      idols: {
        total: this.simulation.idolLocationProgress.total,
        returned: this.simulation.returnedIdolLocations,
      },
    };
  }

  private canVisitGreatHall(): boolean {
    return canVisitGreatHall({
      atDock: this.simulation.atDock,
      expeditionActive: this.simulation.expeditionActive,
      wreckPresentationActive: this.simulation.wreckPresentationActive,
      generationHandoverActive: this.simulation.generationHandoverActive,
      greatHallOpen: this.greatHallView?.isOpen ?? false,
    });
  }

  private openGreatHallAtHome(): boolean {
    const view = this.greatHallView;
    if (!view || !this.canVisitGreatHall()) return false;
    view.showHome(this.greatHallChronicle(), this.simulation.currentNavigator.id);
    this.greatHallUpdated = false;
    this.lastDiagnosticsRevision = -1;
    this.syncHomeAction();
    this.syncSurveyRibbon();
    this.syncRiskLegend();
    this.log("Went ashore to visit the Great Hall lineage chronicle.");
    return true;
  }

  private closeGreatHallHome(restoreFocus = true): boolean {
    const view = this.greatHallView;
    if (!view || view.mode !== "home") return false;
    view.hide();
    this.lastDiagnosticsRevision = -1;
    this.syncHomeAction();
    this.syncSurveyRibbon();
    this.syncRiskLegend();
    if (restoreFocus) (this.homeActionButton ?? this.gameHost)?.focus({ preventScroll: true });
    return true;
  }

  private selectGreatHallGeneration(generation: number): boolean {
    const selected = this.greatHallView?.selectGeneration(Math.trunc(generation)) ?? false;
    if (selected) this.lastDiagnosticsRevision = -1;
    return selected;
  }

  private showPendingGenerationHandover(): boolean {
    const handover = this.simulation.pendingGenerationHandover;
    const view = this.greatHallView;
    if (!handover || !view) return false;
    const navigator = this.simulation.navigatorLineage.find(({ id }) => id === handover.fromNavigatorId);
    if (!navigator || navigator.state === "active") {
      throw new Error(`Terminal navigator ${handover.fromNavigatorId} is missing from the lineage`);
    }
    view.showHandover(this.greatHallChronicle(), handover.fromNavigatorId, handover.nextGeneration);
    this.greatHallUpdated = false;
    this.lastDiagnosticsRevision = -1;
    this.syncHomeAction();
    this.syncSurveyRibbon();
    this.syncRiskLegend();
    return true;
  }

  private showCompletedGreatHall(findingNavigatorId: NavigatorId): boolean {
    const view = this.greatHallView;
    if (!view) return false;
    view.showCompletion(this.greatHallChronicle(), findingNavigatorId);
    this.greatHallUpdated = false;
    this.lastDiagnosticsRevision = -1;
    this.syncHomeAction();
    this.syncSurveyRibbon();
    this.syncRiskLegend();
    return true;
  }

  private dismissGenerationHandover(): boolean {
    if (this.greatHallView?.mode !== "handover") return false;
    if (!this.simulation.acknowledgeGenerationHandover()) return false;
    this.greatHallView.hide();
    this.lastDiagnosticsRevision = -1;
    this.syncHomeAction();
    this.syncSurveyRibbon();
    this.syncRiskLegend();
    const focusTarget = document.documentElement.dataset.developerTools === "open"
      ? document.querySelector<HTMLElement>("#developer-tools-close")
      : this.gameHost;
    focusTarget?.focus({ preventScroll: true });
    return true;
  }

  private continueCompletedWorld(): boolean {
    const view = this.greatHallView;
    if (!view || view.mode !== "completion") return false;
    if (!this.simulation.continueCompletedWorld()) return false;
    view.hide();
    this.lastDiagnosticsRevision = -1;
    if (this.showPendingGenerationHandover()) return true;
    this.syncHomeAction();
    this.syncSurveyRibbon();
    this.syncRiskLegend();
    (this.homeActionButton ?? this.gameHost)?.focus({ preventScroll: true });
    return true;
  }

  private startNewGameFromCompletion(): number | undefined {
    if (this.greatHallView?.mode !== "completion") return undefined;
    const previousSeed = this.simulation.generated.seed;
    const nextSeed = this.simulation.startNewGame();
    if (nextSeed === undefined) return undefined;
    const developerLog = document.querySelector<HTMLDivElement>("#developer-log");
    if (developerLog) clearDeveloperLog(developerLog);
    this.afterWorldChanged();
    this.log(`Started a new game in world ${nextSeed}; completed world ${previousSeed} was left behind.`);
    return nextSeed;
  }

  private syncHomeAction(): void {
    const action = this.homeAction;
    if (!action) return;
    if (this.greatHallView?.mode === "home" && !this.simulation.atDock) {
      this.closeGreatHallHome(false);
      this.log("The Great Hall closed because the ship left the exact home dock.");
    }
    action.hidden = !this.canVisitGreatHall();
    action.dataset.updated = String(this.greatHallUpdated);
  }

  private toggleMarkup(name: keyof GameSimulation["debug"], label: string): string {
    return `<label class="tool-check"><input data-overlay="${name}" type="checkbox" ${this.simulation.debug[name] ? "checked" : ""}> ${label}</label>`;
  }

  private numberMarkup(id: string, label: string, value: number, min: number, max: number, step: number): string {
    return `<label class="tool-number"><span>${label}</span><input data-config="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  }

  private developerActionLockReason(): string | undefined {
    if (this.simulation.wreckPresentationActive) return "Controls are paused while the navigator's loss is presented.";
    if (this.simulation.completionChoiceActive) return "Controls are paused until the completed world's future is chosen.";
    if (this.simulation.generationHandoverActive) return "Controls are paused until the next generation begins.";
    return undefined;
  }

  private teleportForDeveloper(tile: GridPoint, successMessage: string): boolean {
    const lockReason = this.developerActionLockReason();
    if (lockReason) {
      this.log(lockReason);
      return false;
    }
    if (!this.simulation.teleport(tile)) {
      this.log(`Tile ${tile.x}, ${tile.y} is blocked or outside the world.`);
      return false;
    }
    this.log(successMessage);
    return true;
  }

  private returnToDockForTesting(): boolean {
    if (this.simulation.atDock) {
      this.log("The ship is already at the exact home dock.");
      return false;
    }
    const dock = this.simulation.generated.landmarks.homeReturnTile;
    return this.teleportForDeveloper(
      dock,
      `Returned to the exact home dock at ${dock.x}, ${dock.y}; normal dock-arrival rules resolved.`,
    );
  }

  private navigatorWreckTargets(): ReadonlyArray<{ id: number; generation: number; x: number; y: number }> {
    return this.simulation.wrecks
      .filter(({ generation, survey }) => generation < this.simulation.generation && survey.state === "unexamined")
      .sort((left, right) => left.id - right.id)
      .map(({ id, generation, tileX, tileY }) => ({ id, generation, x: tileX, y: tileY }));
  }

  private updateDeveloperStateOutputs(): void {
    const set = (name: string, value: string): void => {
      const output = this.developerStateOutputs.get(name);
      if (output && output.textContent !== value) output.textContent = value;
    };
    const navigator = this.simulation.currentNavigator;
    const handover = this.simulation.pendingGenerationHandover;

    if (this.simulation.wreckPresentationActive) {
      set("generation", String(navigator.generation));
      set("navigator", `${navigator.id} · lost`);
      set("voyage", `Ended during voyage ${Math.min(navigator.completedVoyages + 1, 4)}`);
      set(
        "lifecycle",
        `Wreck #${this.simulation.pendingWreckId ?? "?"} · succession in ${this.simulation.respawnSecondsRemaining.toFixed(1)}s`,
      );
    } else if (handover) {
      set("generation", `${handover.fromGeneration} → ${handover.nextGeneration}`);
      set("navigator", `${handover.nextNavigatorId} · awaiting helm`);
      set("voyage", "Next voyage not begun");
      set("lifecycle", `${handover.reason === "wreck" ? "Loss at sea" : "Four returns"} · awaiting Continue`);
    } else {
      set("generation", String(this.simulation.generation));
      set("navigator", `${navigator.id} · ${navigator.state}`);
      set(
        "voyage",
        `${this.simulation.navigatorVoyageNumber} of 4 · ${this.simulation.navigatorVoyagesRemaining} remain`,
      );
      set(
        "lifecycle",
        this.simulation.expeditionActive
          ? `Expedition #${this.simulation.currentExpeditionId} underway`
          : this.simulation.atDock
            ? "Ready at home dock"
            : "Ready in home waters",
      );
    }
    set("lineage", `${this.simulation.navigatorLineage.length} navigator${this.simulation.navigatorLineage.length === 1 ? "" : "s"}`);
    set(
      "wreck-reports",
      `${this.simulation.provisionalWreckSurveys.length} provisional · ${this.simulation.returnedWreckSurveys.length} returned`,
    );
    set(
      "survey-cost",
      `${this.simulation.config.provisions.surveyCost} bundles · ${this.simulation.surveyBudget.availableProvisionUnits.toFixed(1)} usable now`,
    );
  }

  private syncDeveloperToolAvailability(): void {
    const slot = document.querySelector<HTMLDivElement>("#scene-tools-slot");
    if (!slot) return;
    const lockReason = this.developerActionLockReason();
    const locked = lockReason !== undefined;
    const setAction = (action: string, disabled: boolean, title = ""): void => {
      const button = slot.querySelector<HTMLButtonElement>(`[data-action='${action}']`);
      if (!button) return;
      button.disabled = disabled;
      if (title) button.title = title;
      else button.removeAttribute("title");
    };

    for (const action of [
      "inspect-island",
      "inspect-fishing-shoal",
      "teleport-click",
      "teleport-coordinates",
      "provisions-add",
    ]) setAction(action, locked, lockReason);
    for (const [type, action] of [
      ["historic-wreck", "inspect-site-historic-wreck"],
      ["coastal-ruin", "inspect-site-coastal-ruin"],
      ["tidal-cave", "inspect-site-tidal-cave"],
    ] as const) {
      const available = this.simulation.surveySiteDefinitions.some((definition) => definition.type === type);
      setAction(
        action,
        locked || !available,
        lockReason ?? (!available ? `This seed contains no ${type.replaceAll("-", " ")} site.` : ""),
      );
    }
    setAction("return-dock", locked || this.simulation.atDock, lockReason ?? (this.simulation.atDock ? "The ship is already at the exact home dock." : ""));
    setAction(
      "inspect-wreck",
      locked || this.navigatorWreckTargets().length === 0,
      lockReason ?? (this.navigatorWreckTargets().length === 0 ? "No unexamined earlier-generation navigator wrecks exist yet." : ""),
    );
    setAction(
      "provisions-remove",
      locked || this.simulation.ship.provisions === 0,
      lockReason ?? (this.simulation.ship.provisions === 0 ? "No provision bundles remain to remove." : ""),
    );
    const supported = this.simulation.world.getKnowledge(
      this.simulation.ship.currentTileX,
      this.simulation.ship.currentTileY,
    ) === KnowledgeState.Supported;
    setAction(
      "force-wreck",
      locked || supported,
      lockReason ?? (supported ? "Move outside Supported water before forcing a wreck." : ""),
    );

    slot.querySelectorAll<HTMLInputElement>("input[data-config], input[data-field='teleport-x'], input[data-field='teleport-y']")
      .forEach((input) => { input.disabled = locked; });
    const lockOutput = slot.querySelector<HTMLElement>("[data-output='lock-reason']");
    if (lockOutput) {
      lockOutput.hidden = !locked;
      lockOutput.textContent = lockReason ?? "";
    }
    if (locked && this.teleportOnClick) {
      this.teleportOnClick = false;
      this.updateTeleportButton();
    }
  }

  private syncRiskLegend(): void {
    document.querySelectorAll<HTMLInputElement>("#scene-tools-slot input[data-overlay]").forEach((input) => {
      const name = input.dataset.overlay as keyof GameSimulation["debug"];
      input.checked = this.simulation.debug[name];
    });
    const legend = document.querySelector<HTMLElement>("#risk-legend");
    if (!legend) return;
    const visibility = {
      forwardRange: this.simulation.debug.forwardRange,
      returnViability: this.simulation.debug.returnViability,
    };
    legend.querySelectorAll<HTMLElement>("[data-overlay-legend]").forEach((entry) => {
      const name = entry.dataset.overlayLegend as keyof typeof visibility;
      entry.hidden = !visibility[name];
    });
    legend.hidden = this.simulation.generationHandoverActive
      || (this.greatHallView?.isOpen ?? false)
      || (!visibility.forwardRange && !visibility.returnViability);
  }

  private liveConfigValue(id: string): number {
    switch (id) {
      case "sight-radius": return prototypeConfig.navigation.sightRadius;
      case "starting-bundles": return prototypeConfig.provisions.startingBundles;
      case "survey-cost": return prototypeConfig.provisions.surveyCost;
      case "supported-cost": return prototypeConfig.provisions.supportedCost;
      case "personal-cost": return prototypeConfig.provisions.personalCost;
      case "unknown-cost": return prototypeConfig.provisions.unknownCost;
      case "ship-speed": return prototypeConfig.movement.shipSpeed;
      case "risk-comfortable": return prototypeConfig.returnRisk.comfortable;
      case "risk-warning": return prototypeConfig.returnRisk.warning;
      case "risk-critical": return prototypeConfig.returnRisk.critical;
      case "forward-cone-half-angle": return prototypeConfig.overlays.forwardConeHalfAngleDegrees;
      case "unknown-cleanup-limit": return prototypeConfig.world.maxEnclosedUnknownTiles;
      case "return-path-padding": return prototypeConfig.overlays.returnPathPadding;
      case "forward-opacity": return prototypeConfig.overlays.forwardOverlayOpacity;
      case "return-opacity": return prototypeConfig.overlays.returnOverlayOpacity;
      case "fog-blend": return prototypeConfig.overlays.fogBlend;
      case "fog-noise": return prototypeConfig.overlays.fogNoise;
      default: throw new RangeError(`Unknown live configuration field: ${id}`);
    }
  }

  private applyLiveConfig(id: string, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    const lockReason = this.developerActionLockReason();
    if (lockReason) {
      this.log(lockReason);
      return false;
    }
    let patch: DeepPartial<PrototypeConfig> | undefined;
    switch (id) {
      case "sight-radius":
        patch = { navigation: { sightRadius: value } };
        break;
      case "starting-bundles":
        patch = { provisions: { startingBundles: value } };
        break;
      case "survey-cost": patch = { provisions: { surveyCost: value } }; break;
      case "supported-cost": patch = { provisions: { supportedCost: value } }; break;
      case "personal-cost": patch = { provisions: { personalCost: value } }; break;
      case "unknown-cost": patch = { provisions: { unknownCost: value } }; break;
      case "ship-speed": patch = { movement: { shipSpeed: value } }; break;
      case "risk-comfortable": patch = { returnRisk: { comfortable: value } }; break;
      case "risk-warning": patch = { returnRisk: { warning: value } }; break;
      case "risk-critical": patch = { returnRisk: { critical: value } }; break;
      case "forward-cone-half-angle": patch = { overlays: { forwardConeHalfAngleDegrees: value } }; break;
      case "unknown-cleanup-limit": patch = { world: { maxEnclosedUnknownTiles: value } }; break;
      case "return-path-padding": patch = { overlays: { returnPathPadding: value } }; break;
      case "forward-opacity": patch = { overlays: { forwardOverlayOpacity: value } }; break;
      case "return-opacity": patch = { overlays: { returnOverlayOpacity: value } }; break;
      case "fog-blend": patch = { overlays: { fogBlend: value } }; break;
      case "fog-noise": patch = { overlays: { fogNoise: value } }; break;
    }
    if (!patch) return false;
    try {
      patchPrototypeConfig(patch);
      if (id === "sight-radius") this.simulation.refreshVisibility();
      else if ([
        "supported-cost",
        "personal-cost",
        "unknown-cost",
        "survey-cost",
        "risk-comfortable",
        "risk-warning",
        "risk-critical",
      ].includes(id)) this.simulation.refreshRiskOverlays();
      else if (!["forward-cone-half-angle", "return-path-padding", "forward-opacity", "return-opacity", "fog-blend", "fog-noise"].includes(id)) {
        this.simulation.revision++;
      }
      return true;
    } catch (error) {
      this.log(error instanceof Error ? error.message : "Configuration value was rejected.");
      return false;
    }
  }

  private field(name: string): HTMLInputElement {
    const field = document.querySelector<HTMLInputElement>(`#scene-tools-slot [data-field='${name}']`);
    if (!field) throw new Error(`Developer field ${name} is missing`);
    return field;
  }

  private updateTeleportButton(): void {
    const button = document.querySelector<HTMLButtonElement>("#scene-tools-slot [data-action='teleport-click']");
    if (!button) return;
    button.setAttribute("aria-pressed", String(this.teleportOnClick));
    button.textContent = this.teleportOnClick ? "Click a water tile…" : "Teleport by clicking";
  }

  private updateProvisionOutput(): void {
    if (this.provisionOutput) {
      this.provisionOutput.value = `${this.simulation.ship.provisions} bundles aboard`;
    }
      this.updateRecordsOutputs();
    this.syncDeveloperToolAvailability();
  }

  private expeditionRecordsSummary(): string {
    const idolProgress = this.simulation.idolLocationProgress;
    return `Idol locations: ${idolProgress.provisional} provisional · ${idolProgress.returned} returned · `
      + `${idolProgress.total} total · Island dossiers: ${this.simulation.provisionalIslandDossiers.length} provisional · `
      + `${this.simulation.returnedIslandDossiers.length} returned · Survey sites: `
      + `${this.simulation.provisionalSurveySites.length} provisional · `
      + `${this.simulation.returnedSurveySites.length} returned · Fishing reports: `
      + `${this.simulation.provisionalFishingShoals.length} provisional · `
      + `${this.simulation.returnedFishingShoals.length} returned · Wreck reports: `
      + `${this.simulation.provisionalWreckSurveys.length} provisional · `
      + `${this.simulation.returnedWreckSurveys.length} returned · `
      + `Survey cost ${this.simulation.config.provisions.surveyCost} bundles`;
  }

  private updateRecordsOutputs(): void {
    if (this.recordsOutput) this.recordsOutput.value = this.expeditionRecordsSummary();
    this.updateDeveloperStateOutputs();
  }

  private afterWorldChanged(): void {
    this.islandInspectionIndex = 0;
    this.fishingShoalInspectionIndex = 0;
    this.surveySiteInspectionIndices.clear();
    this.lastInspectedWreckId = 0;
    const seedField = document.querySelector<HTMLInputElement>(
      "#scene-tools-slot [data-field='seed']",
    );
    if (seedField) seedField.value = String(this.simulation.generated.seed);
    this.resetShipPresentation(true);
    this.configureCamera();
    this.cameras.main.centerOn(this.simulation.ship.worldX, this.simulation.ship.worldY);
    this.renderWorld();
    this.lastDebugRevision = -1;
    this.lastDebugOverlayRevision = -1;
    this.lastDiagnosticsRevision = -1;
    this.lastDiagnosticsOverlayRevision = -1;
    this.lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
    this.pendingReturnedVoyage = undefined;
    this.pendingReturnVoyagesRemaining = undefined;
    this.pendingGenerationHandoverPresentation = false;
    this.pendingCompletionNavigatorId = undefined;
    this.greatHallUpdated = false;
    this.greatHallView?.hide();
    this.updateProvisionOutput();
    this.showPendingGenerationHandover();
    this.syncPresentation(true);
    // Camera follow deliberately uses smoothing during play. Regeneration was
    // snapped before active chunks were selected, so the first presented
    // region is already the playable one.
  }

  private inspectNextIsland(): void {
    const lockReason = this.developerActionLockReason();
    if (lockReason) {
      this.log(lockReason);
      return;
    }
    const definitions = this.simulation.islandDossierDefinitions;
    if (definitions.length === 0) {
      this.log("This seed contains no island dossiers.");
      return;
    }
    const definition = definitions[this.islandInspectionIndex % definitions.length];
    this.islandInspectionIndex++;
    this.teleportForDeveloper(
      definition.canonicalApproach,
      `Inspecting island dossier ${definition.name} (${definition.islandId}) from `
        + `${definition.canonicalApproach.x}, ${definition.canonicalApproach.y}.`,
    );
  }

  private inspectNextFishingShoal(): void {
    const lockReason = this.developerActionLockReason();
    if (lockReason) {
      this.log(lockReason);
      return;
    }
    const definitions = this.simulation.fishingShoalDefinitions;
    if (definitions.length === 0) {
      this.log("This seed contains no eligible fishing signs.");
      return;
    }
    const definition = definitions[this.fishingShoalInspectionIndex % definitions.length];
    this.fishingShoalInspectionIndex++;
    this.teleportForDeveloper(
      definition.tile,
      `Inspecting fishing sign ${definition.id} at ${definition.tile.x}, ${definition.tile.y}.`,
    );
  }

  private inspectNextSurveySite(type: SurveySiteType): boolean {
    const lockReason = this.developerActionLockReason();
    if (lockReason) {
      this.log(lockReason);
      return false;
    }
    const definitions = this.simulation.surveySiteDefinitions
      .filter((definition) => definition.type === type)
      .sort((left, right) => compareSurveySiteIds(left.id, right.id));
    if (definitions.length === 0) {
      this.log(`This seed contains no ${type.replaceAll("-", " ")} site.`);
      return false;
    }
    const index = this.surveySiteInspectionIndices.get(type) ?? 0;
    const definition = definitions[index % definitions.length];
    const inspected = this.teleportForDeveloper(
      definition.serviceAnchor,
      `Inspecting ${definition.typeLabel.toLowerCase()} ${definition.id} from its passable service anchor at `
        + `${definition.serviceAnchor.x}, ${definition.serviceAnchor.y}.`,
    );
    if (inspected) this.surveySiteInspectionIndices.set(type, index + 1);
    return inspected;
  }

  private inspectNextNavigatorWreck(): boolean {
    const lockReason = this.developerActionLockReason();
    if (lockReason) {
      this.log(lockReason);
      return false;
    }
    const targets = this.navigatorWreckTargets();
    if (targets.length === 0) {
      this.log("No unexamined earlier-generation navigator wrecks exist yet.");
      return false;
    }
    const target = targets.find(({ id }) => id > this.lastInspectedWreckId) ?? targets[0];
    const inspected = this.teleportForDeveloper(
      { x: target.x, y: target.y },
      `Inspecting navigator wreck ${target.id} from generation ${target.generation} at ${target.x}, ${target.y}.`,
    );
    if (inspected) this.lastInspectedWreckId = target.id;
    return inspected;
  }

  private installBrowserDebugApi(): void {
    const api: BrowserDebugApi = {
      snapshot: () => this.simulation.snapshot(),
      teleport: (x, y) => this.simulation.teleport({ x: Math.trunc(x), y: Math.trunc(y) }),
      addProvisions: (delta) => {
        this.simulation.addProvisions(delta);
        this.updateProvisionOutput();
        return this.simulation.snapshot();
      },
      forceWreck: () => {
        return this.forceWreckForTesting();
      },
      regenerate: (seed) => {
        this.simulation.regenerate(seed);
        this.afterWorldChanged();
        return this.simulation.snapshot();
      },
      setOverlay: (name, visible) => this.simulation.setDebugVisibility(name, visible),
      returnToDock: () => this.returnToDockForTesting(),
      navigatorWreckTargets: () => this.navigatorWreckTargets(),
      performance: () => this.frameTiming.snapshot(),
      presentationWork: () => this.presentationWork.snapshot(),
      presentationResources: () => this.presentationResourceSnapshot(),
      fishingShoalTargets: () => this.simulation.fishingShoalDefinitions.map(({ id, tile }) => ({
        id,
        x: tile.x,
        y: tile.y,
      })),
      islandDossierTargets: () => this.simulation.islandDossierDefinitions.map((definition) => ({
        islandId: definition.islandId,
        x: definition.canonicalApproach.x,
        y: definition.canonicalApproach.y,
      })),
      surveySiteTargets: () => this.simulation.surveySiteDefinitions.map((definition) => ({
        id: definition.id,
        type: definition.type,
        x: definition.serviceAnchor.x,
        y: definition.serviceAnchor.y,
      })),
      surveyIslandDossier: () => this.performIslandDossierSurvey(),
      surveySurveySite: () => this.performSurveySiteSurvey(),
      surveyFishingShoal: () => this.performFishingShoalSurvey(),
      surveyWreck: () => this.performWreckSurvey(),
      continueGeneration: () => this.dismissGenerationHandover(),
      visitGreatHall: () => this.openGreatHallAtHome(),
      closeGreatHall: () => this.closeGreatHallHome(),
      selectGreatHallGeneration: (generation) => this.selectGreatHallGeneration(generation),
      greatHall: () => this.greatHallChronicle(),
      continueCompletedWorld: () => this.continueCompletedWorld(),
      startNewGame: () => this.startNewGameFromCompletion(),
    };
    this.browserDebugApi = api;
    window.__WAYFINDERS__ = api;
  }

  private presentationResourceSnapshot(): Readonly<PresentationResourceSnapshot> {
    return Object.freeze({
      activeChunks: this.activeChunkSet.getTelemetry(),
      world: this.worldRenderer.getTelemetry(),
      knowledge: this.knowledgeOverlay.getResourceTelemetry(),
      risk: this.riskOverlay.getResourceTelemetry(),
      markers: Object.freeze({
        wrecks: this.wreckRenderer.getLifetimeTelemetry(),
        islandDossiers: this.islandDossierRenderer.getLifetimeTelemetry(),
        surveySites: this.surveySiteRenderer.getLifetimeTelemetry(),
        fishingShoals: this.fishingShoalRenderer.getLifetimeTelemetry(),
      }),
    });
  }

  private log(message: string): void {
    appendDeveloperLog(document.querySelector<HTMLDivElement>("#developer-log"), message);
  }

  private forceWreckForTesting(): boolean {
    const started = this.simulation.forceWreck();
    if (started) this.clock.reset();
    this.updateProvisionOutput();
    return started;
  }

  private bindSimulationEvents(): void {
    this.eventUnsubscribers.push(
      this.simulation.events.on("expeditionReturned", ({
        navigatorId,
        voyageNumber,
        voyagesRemaining,
        tenureCompleted,
        supportedTileCount,
        closedUnknownTileCount,
      }) => {
        this.worldRenderer.refreshKnowledge(this.simulation.generated);
        const entry = this.greatHallChronicle().navigators.find(({ navigatorId: id }) => id === navigatorId);
        const voyage = entry?.voyages.find((record) => (
          record.voyageNumber === voyageNumber && record.outcome === "returned"
        ));
        if (!voyage || voyage.outcome !== "returned") {
          throw new Error(`Returned voyage ${navigatorId}:${voyageNumber} is missing from the Great Hall chronicle`);
        }
        this.pendingReturnedVoyage = voyage;
        this.pendingReturnVoyagesRemaining = voyagesRemaining;
        this.greatHallUpdated = !tenureCompleted;
        this.scheduleReturnCue();
        this.log(
          `Voyage ${voyageNumber} of 4 returned: ${supportedTileCount} Personal tiles and `
          + `${closedUnknownTileCount} enclosed Unknown tiles became Supported; ${voyagesRemaining} remain.`,
        );
      }),
      this.simulation.events.on("navigatorTenureCompleted", ({
        generation,
        completedVoyages,
        nextGeneration,
      }) => {
        this.pendingGenerationHandoverPresentation = true;
        this.scheduleReturnCue();
        this.log(
          `Generation ${generation}'s navigator completed ${completedVoyages} successful voyages; `
          + `generation ${nextGeneration} took the helm.`,
        );
      }),
      this.simulation.events.on("gameCompleted", ({
        navigatorId,
        generation,
        voyageNumber,
        returnedIdolLocations,
        totalIdolLocations,
      }) => {
        this.pendingCompletionNavigatorId = navigatorId;
        this.scheduleReturnCue();
        this.log(
          `Generation ${generation} returned the final idol location on voyage ${voyageNumber}; `
          + `all ${returnedIdolLocations} of ${totalIdolLocations} locations are preserved in the Great Hall.`,
        );
      }),
      this.simulation.events.on("completedWorldContinued", ({ seed }) => {
        this.log(`Continued exploring completed world ${seed}; its ending cannot trigger again.`);
      }),
      this.simulation.events.on("shipWrecked", ({ generation }) => {
        const holdMs = Math.max(0, this.simulation.config.simulation.wreckPresentationSeconds * 1000 - 480);
        this.showLifecycleCue(
          `NAVIGATOR LOST AT SEA\nTHEIR WRECK REMAINS\nHOME MOURNS · TIME PASSES`,
          "#ffd2aa",
          holdMs,
        );
        this.log(
          `Generation ${generation}'s navigator was lost at sea; home mourns as time passes.`,
        );
      }),
      this.simulation.events.on("expeditionFailed", ({ generation, nextGeneration, forgottenTiles }) => {
        this.resetShipPresentation(false);
        this.cameras.main.centerOn(this.simulation.ship.worldX, this.simulation.ship.worldY);
        this.showPendingGenerationHandover();
        this.log(
          `Generation ${generation} lost ${forgottenTiles} unreturned tiles; `
          + `generation ${nextGeneration} now carries the inherited chart.`,
        );
      }),
      this.simulation.events.on("shipReplenished", ({ reason }) => {
        if (reason !== "dock") return;
        this.showLifecycleCue("DOCKED\nPROVISIONS REPLENISHED", "#d9fff5");
        this.log("Dock stores replenished the ship's provisions.");
      }),
      this.simulation.events.on("wreckDiscovered", ({ wreckId }) => {
        this.log(`Found unidentified navigator wreck ${wreckId}. Survey it to learn whose vessel it was.`);
      }),
      this.simulation.events.on("wreckSurveyed", ({ lostGeneration, presentationMs, provisionsSpent }) => {
        this.showLifecycleCue(
          `WRECK IDENTIFIED\nGENERATION ${lostGeneration} NAVIGATOR\nRETURN HOME TO REPORT THEIR FATE`,
          "#f0d7a2",
          presentationMs,
        );
        this.log(`Wreck survey spent ${provisionsSpent} bundles and identified generation ${lostGeneration}'s navigator; the report is provisional.`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("wreckSurveysReturned", ({ reports }) => {
        this.log(
          `Returned wreck report secured for ${reports.map(({ lostGeneration }) => `generation ${lostGeneration}`).join(", ")}.`,
        );
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("wreckSurveysLost", ({ reports }) => {
        this.log(
          `Unreturned wreck identification lost at sea for ${reports.map(({ lostGeneration }) => `generation ${lostGeneration}`).join(", ")}; the wreck can be surveyed again.`,
        );
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("idolLocationDiscovered", ({
        location,
        presentationMs,
        provisionsSpent,
      }) => {
        this.showLifecycleCue(
          `LOST IDOL LOCATION FOUND\n${location.displayLabel.toUpperCase()}\nRETURN HOME OR THIS KNOWLEDGE WILL BE LOST AGAIN`,
          "#ffe69b",
          presentationMs,
        );
        this.log(
          `${location.displayLabel}'s location was found for ${provisionsSpent} bundles; `
          + "the knowledge remains provisional until it reaches home.",
        );
        this.updateRecordsOutputs();
      }),
      this.simulation.events.on("idolLocationsReturned", ({ locations }) => {
        this.log(
          `Idol-location knowledge secured in the Great Hall: ${locations.map(({ displayLabel }) => displayLabel).join(", ")}.`,
        );
        this.updateRecordsOutputs();
      }),
      this.simulation.events.on("idolLocationsLost", ({ locations }) => {
        this.log(
          `Unreturned idol-location knowledge lost at sea: ${locations.map(({ displayLabel }) => displayLabel).join(", ")}. `
          + "Those locations can be found again by survey.",
        );
        this.updateRecordsOutputs();
      }),
      this.simulation.events.on("islandSighted", ({ name }) => {
        this.showLifecycleCue(
          `ISLAND SIGHTED\n${name.toUpperCase()}\nSURVEY NOW OR RETURN WITH THE LEAD`,
          "#b9fff5",
          5_000,
        );
        this.log(`Provisional island lead: ${name}. Its dossier remains hidden until surveyed.`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("islandDossierSurveyed", ({
        name,
        dossier,
        presentationMs,
        provisionsSpent,
      }) => {
        this.showLifecycleCue(
          `ISLAND DOSSIER COMPLETE\n${name.toUpperCase()}\n${dossier.findingLabel.toUpperCase()}\nRETURN HOME TO REPORT IT`,
          "#ffddb0",
          presentationMs,
        );
        this.log(`Surveyed ${name} for ${provisionsSpent} bundles: ${dossier.detail}`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("surveySiteSighted", ({ typeLabel, clue }) => {
        this.showLifecycleCue(
          `${typeLabel.toUpperCase()} SIGHTED\n${clue.label.toUpperCase()}\nSURVEY NOW OR RETURN WITH THE LEAD`,
          "#d7e6c4",
          5_000,
        );
        this.log(`Provisional ${typeLabel.toLowerCase()} lead: ${clue.label}.`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("surveySiteSurveyed", ({
        id,
        result,
        presentationMs,
        provisionsSpent,
      }) => {
        const definition = this.simulation.surveySiteDefinitions.find((site) => site.id === id);
        const typeLabel = definition?.typeLabel ?? "Survey site";
        this.showLifecycleCue(
          `${typeLabel.toUpperCase()} SURVEYED\n${result.label.toUpperCase()}\nRETURN HOME TO REPORT IT`,
          "#f3d59f",
          presentationMs,
        );
        this.log(`Surveyed ${typeLabel.toLowerCase()} for ${provisionsSpent} bundles: ${result.detail}`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("surveySitesReturned", ({ leads, reports }) => {
        const labelFor = (id: string): string => this.simulation.surveySiteDefinitions
          .find((definition) => definition.id === id)?.typeLabel.toLowerCase() ?? id;
        this.log(
          `Survey-site knowledge secured: ${[
            leads.length > 0 ? `leads for ${leads.map(({ id }) => labelFor(id)).join(", ")}` : "",
            reports.length > 0 ? `reports for ${reports.map(({ id }) => labelFor(id)).join(", ")}` : "",
          ].filter(Boolean).join("; ")}.`,
        );
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("surveySitesLost", ({ records }) => {
        const sighted = records.filter(({ state }) => state === "sighted").length;
        const surveyed = records.length - sighted;
        this.log(
          `Unreturned survey-site work lost with the ship: ${sighted} lead${sighted === 1 ? "" : "s"}, `
          + `${surveyed} report${surveyed === 1 ? "" : "s"}. Earlier returned leads remain inherited.`,
        );
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("fishingShoalSighted", ({ clue }) => {
        this.showLifecycleCue(
          `FISHING SIGN SIGHTED\n${clue.label.toUpperCase()}\nRETURN HOME TO RECORD IT`,
          "#a9f7fb",
          5_000,
        );
        this.log(`Provisional fishing-shoal sighting: ${clue.label}.`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("fishingShoalSurveyed", ({ quality, presentationMs, provisionsSpent }) => {
        this.showLifecycleCue(
          `FISHING GROUND SURVEYED\n${quality.toUpperCase()} QUALITY\nRETURN HOME TO REPORT IT`,
          "#ffe1b6",
          presentationMs,
        );
        this.log(`Fishing ground surveyed: ${quality} quality for ${provisionsSpent} bundles.`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("fishingShoalsReturned", ({ leads, surveys }) => {
        const returnedQualities: string[] = [];
        for (const survey of surveys) {
          const quality = this.simulation.fishingShoalDefinitions
            .find(({ id }) => id === survey.id)?.quality;
          if (!quality) continue;
          returnedQualities.push(quality);
        }
        const leadReport = leads.length > 0 ? `${leads.length} inactive lead${leads.length === 1 ? "" : "s"}` : "";
        const surveyReport = returnedQualities.length > 0
          ? `${returnedQualities.join(", ")} returned survey`
          : "";
        this.log(`Fishing report secured: ${[leadReport, surveyReport].filter(Boolean).join("; ")}.`);
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("fishingShoalsLost", ({ records }) => {
        const surveys = records.filter(({ state }) => state === "surveyed").length;
        const sightings = records.length - surveys;
        this.log(
          `Unreturned fishing work lost with the ship: ${sightings} sighting${sightings === 1 ? "" : "s"}, `
          + `${surveys} survey${surveys === 1 ? "" : "s"}. Earlier returned leads remain inherited.`,
        );
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("islandDossiersReturned", ({ leads, dossiers }) => {
        const nameFor = (islandId: number): string => this.simulation.islandDossierDefinitions
          .find((definition) => definition.islandId === islandId)?.name ?? `island ${islandId}`;
        const leadNames = leads.map(({ islandId }) => nameFor(islandId));
        const dossierNames = dossiers.map(({ islandId }) => nameFor(islandId));
        this.log(
          `Island knowledge secured: ${[
            leadNames.length > 0 ? `leads for ${leadNames.join(", ")}` : "",
            dossierNames.length > 0 ? `dossiers for ${dossierNames.join(", ")}` : "",
          ].filter(Boolean).join("; ")}.`,
        );
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("islandDossiersLost", ({ records }) => {
        const sighted = records.filter(({ state }) => state === "sighted").length;
        const surveyed = records.length - sighted;
        this.log(
          `Unreturned island work lost with the ship: ${sighted} lead${sighted === 1 ? "" : "s"}, `
          + `${surveyed} dossier${surveyed === 1 ? "" : "s"}. Earlier returned leads remain inherited.`,
        );
      this.updateRecordsOutputs();
      }),
      this.simulation.events.on("worldRegenerated", () => {
      }),
      this.simulation.events.on("shipTeleported", () => {
        this.resetShipPresentation(true);
      }),
    );
  }

  private scheduleReturnCue(): void {
    if (this.returnCueScheduled) return;
    this.returnCueScheduled = true;
    queueMicrotask(() => {
      this.returnCueScheduled = false;
      const voyage = this.pendingReturnedVoyage;
      this.pendingReturnedVoyage = undefined;
      const voyagesRemaining = this.pendingReturnVoyagesRemaining;
      this.pendingReturnVoyagesRemaining = undefined;
      const generationHandover = this.pendingGenerationHandoverPresentation;
      this.pendingGenerationHandoverPresentation = false;
      const completionNavigatorId = this.pendingCompletionNavigatorId;
      this.pendingCompletionNavigatorId = undefined;
      if (!voyage && !generationHandover && !completionNavigatorId) return;

      // The final Great Hall is the exact-dock ending. It supersedes both the
      // ordinary return cue and a same-voyage tenure handover. The simulation's
      // pending handover remains intact and is presented only after Continue.
      if (completionNavigatorId) {
        this.showCompletedGreatHall(completionNavigatorId);
        return;
      }

      if (generationHandover) {
        this.showPendingGenerationHandover();
        return;
      }
      if (!voyage) return;

      const voyageHeading = `VOYAGE ${voyage.voyageNumber} OF 4 RETURNED`;
      const remainingLine = voyagesRemaining === undefined
        ? ""
        : `${voyagesRemaining} VOYAGE${voyagesRemaining === 1 ? "" : "S"} REMAIN · `;
      const achievements = (voyage.achievements.length > 0
        ? voyage.achievements.map(({ label }) => label)
        : ["No new findings returned."]
      ).map((achievement) => achievement.toUpperCase()).join("\n");
      const hasNotableFindings = voyage.achievements.some(({ kind }) => (
        kind !== "supported-route-tiles" && kind !== "mapped-enclosed-water-tiles"
      ));
      this.showLifecycleCue(
        `${voyageHeading}\n${achievements}\nRECORDED IN THE GREAT HALL\n`
        + `${remainingLine}PROVISIONS REPLENISHED`,
        hasNotableFindings ? "#eadb9f" : "#d9fff5",
        hasNotableFindings ? 5_000 : 3_500,
      );
    });
  }

  private showLifecycleCue(message: string, color: string, holdMs = 2_600): void {
    if (this.activeLifecycleCue) {
      this.tweens.killTweensOf(this.activeLifecycleCue);
      this.activeLifecycleCue.destroy();
      this.activeLifecycleCue = undefined;
    }
    const cue = this.add.text(this.scale.width / 2, Math.max(90, this.scale.height * 0.17), message, {
      align: "center",
      color,
      fontFamily: "ui-monospace, monospace",
      fontSize: "17px",
      fontStyle: "bold",
      stroke: "#082d35",
      strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(110).setAlpha(0);
    this.activeLifecycleCue = cue;
    this.cameras.main.flash(180, 125, 212, 199, false);
    this.tweens.add({
      targets: cue,
      alpha: { from: 0, to: 1 },
      y: cue.y - 8,
      duration: 240,
      yoyo: true,
      hold: holdMs,
      onComplete: () => {
        cue.destroy();
        if (this.activeLifecycleCue === cue) this.activeLifecycleCue = undefined;
      },
    });
  }

  private captureShipPose(): ShipRenderPose {
    const { worldX, worldY, heading, speed } = this.simulation.ship;
    return { worldX, worldY, heading, speed };
  }

  private resetShipPresentation(resetClock: boolean): void {
    const pose = this.captureShipPose();
    this.previousShipPose = pose;
    this.currentShipPose = { ...pose };
    if (resetClock) this.clock.reset();
  }

  private destroyBindings(): void {
    this.domAbort?.abort();
    this.developerToolsAbort?.abort();
    this.gameHost = undefined;
    this.gameStatus = undefined;
    this.provisionOutput = undefined;
    this.recordsOutput = undefined;
    this.developerStateOutputs.clear();
    this.surveyRibbon?.remove();
    this.surveyRibbon = undefined;
    this.surveyRibbonTitle = undefined;
    this.surveyRibbonClue = undefined;
    this.surveyRibbonCost = undefined;
    this.surveyButton = undefined;
    this.homeAction?.remove();
    this.homeAction = undefined;
    this.homeActionButton = undefined;
    this.greatHallView?.destroy();
    this.greatHallView = undefined;
    for (const unsubscribe of this.eventUnsubscribers.splice(0)) unsubscribe();
    this.knowledgeOverlay.destroy();
    this.riskOverlay.destroy();
    this.cargoRenderer.destroy();
    this.islandDossierRenderer.destroy();
    this.surveySiteRenderer.destroy();
    this.fishingShoalRenderer.destroy();
    this.wreckRenderer.destroy();
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    if (this.activeLifecycleCue) {
      this.tweens.killTweensOf(this.activeLifecycleCue);
      this.activeLifecycleCue.destroy();
      this.activeLifecycleCue = undefined;
    }
    if (window.__WAYFINDERS__ === this.browserDebugApi) delete window.__WAYFINDERS__;
    this.browserDebugApi = undefined;
  }

}
