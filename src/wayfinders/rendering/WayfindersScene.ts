import Phaser from "phaser";
import { appendDeveloperLog } from "../../developerLog";
import {
  onPrototypeConfigChanged,
  patchPrototypeConfig,
  prototypeConfig,
  type DeepPartial,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { GameSimulation } from "../core/GameSimulation";
import { FrameTimingMonitor } from "../core/FrameTimingMonitor";
import { SimulationClock } from "../core/SimulationClock";
import type { GridPoint, MovementInput } from "../core/types";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  type FishingShoalInteractionResultV1,
} from "../exploration/FishingShoalContracts";
import {
  WRECK_SURVEY_CONTRACT_VERSION,
  type WreckSurveyInteractionResultV1,
} from "../exploration/WreckSurveyContracts";
import type { SaveStore } from "../persistence/IndexedDbSaveStore";
import { loadExactSaveSlot } from "../persistence/SaveGame";
import type { NavigatorVoyageAchievementRecordV1 } from "../lineage/NavigatorLineageSystem";
import { worldToGrid } from "../world/CoordinateSystem";
import type { GeneratedIsland } from "../world/IslandGenerator";
import { KnowledgeState } from "../world/TileData";
import { CargoRenderer } from "./CargoRenderer";
import { DiscoveryRenderer } from "./DiscoveryRenderer";
import { FishingShoalRenderer } from "./FishingShoalRenderer";
import { KnowledgeOverlayRenderer } from "./KnowledgeOverlayRenderer";
import { RiskOverlayRenderer } from "./RiskOverlayRenderer";
import {
  isSceneMovementInputSuppressed,
  resolveSceneMovementInput,
  type SceneMovementInputContext,
} from "./SceneMovementInput";
import { ShipRenderer } from "./ShipRenderer";
import type { ShipRenderPose } from "./ShipPose";
import { WreckRenderer } from "./WreckRenderer";
import { WorldRenderer } from "./WorldRenderer";
import {
  buildNavigatorGenerationSummary,
  describeNavigatorVoyageAchievements,
  type NavigatorAchievementSources,
  type NavigatorGenerationSummary,
} from "./NavigatorGenerationSummary";

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
  leave: Phaser.Input.Keyboard.Key;
}

interface BrowserDebugApi {
  snapshot: () => ReturnType<GameSimulation["snapshot"]>;
  teleport: (x: number, y: number) => boolean;
  addProvisions: (delta: number) => ReturnType<GameSimulation["snapshot"]>;
  forceWreck: () => boolean;
  regenerate: (seed?: number) => ReturnType<GameSimulation["snapshot"]>;
  setOverlay: (name: keyof GameSimulation["debug"], visible: boolean) => void;
  saveNow: () => Promise<boolean>;
  loadSave: () => Promise<boolean>;
  clearSave: () => Promise<boolean>;
  returnToDock: () => boolean;
  navigatorWreckTargets: () => ReadonlyArray<{ id: number; generation: number; x: number; y: number }>;
  performance: () => ReturnType<FrameTimingMonitor["snapshot"]> & { lastSaveSerializationMs: number };
  fishingShoalTargets: () => ReadonlyArray<{ id: string; x: number; y: number }>;
  surveyFishingShoal: () => FishingShoalInteractionResultV1 | undefined;
  leaveFishingShoal: () => FishingShoalInteractionResultV1 | undefined;
  surveyWreck: () => WreckSurveyInteractionResultV1 | undefined;
  leaveWreck: () => WreckSurveyInteractionResultV1 | undefined;
  continueGeneration: () => boolean;
}

export interface PersistenceBootState {
  status: "new" | "loaded" | "recovered" | "unavailable";
  message: string;
  autosave: boolean;
}

declare global {
  interface Window {
    __WAYFINDERS__?: BrowserDebugApi;
  }
}

const PALETTE = {
  grid: 0xa5d5d2,
  sight: 0x78fff0,
} as const;

const AUTOSAVE_INTERVAL_MS = 3_000;

export class WayfindersScene extends Phaser.Scene {
  readonly simulation: GameSimulation;

  private readonly clock = new SimulationClock();
  private readonly frameTiming = new FrameTimingMonitor();
  private readonly saveStore: SaveStore<unknown>;
  private readonly checkpointStore: SaveStore<unknown>;
  private readonly persistenceBoot: PersistenceBootState;
  private keys!: MovementKeys;
  private worldRenderer!: WorldRenderer;
  private knowledgeOverlay!: KnowledgeOverlayRenderer;
  private riskOverlay!: RiskOverlayRenderer;
  private cargoRenderer!: CargoRenderer;
  private discoveryRenderer!: DiscoveryRenderer;
  private fishingShoalRenderer!: FishingShoalRenderer;
  private shipRenderer!: ShipRenderer;
  private wreckRenderer!: WreckRenderer;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private domAbort?: AbortController;
  private developerToolsAbort?: AbortController;
  private readonly eventUnsubscribers: Array<() => void> = [];
  private gameHost?: HTMLElement;
  private gameStatus?: HTMLElement;
  private provisionOutput?: HTMLOutputElement;
  private persistenceOutput?: HTMLOutputElement;
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
  private surveyRibbonCase?: HTMLElement;
  private surveyButton?: HTMLButtonElement;
  private leaveButton?: HTMLButtonElement;
  private dismissedFishingShoalId?: string;
  private dismissedWreckId?: number;
  private surveyActionUntil = Number.NEGATIVE_INFINITY;
  private generationSummaryDialog?: HTMLDialogElement;
  private generationSummaryEyebrow?: HTMLElement;
  private generationSummaryTitle?: HTMLElement;
  private generationSummaryJourneys?: HTMLOListElement;
  private generationSummaryFindings?: HTMLElement;
  private generationSummaryHandover?: HTMLElement;
  private generationSummaryContinue?: HTMLButtonElement;
  private generationSummaryVisible = false;
  private teleportOnClick = false;
  private islandInspectionIndex = 0;
  private fishingShoalInspectionIndex = 0;
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
  private lastDiscoveryRecordsRevision = -1;
  private lastFishingShoalRecordsRevision = -1;
  private lastFishingShoalVisibilityVersion = -1;
  private lastFishingShoalKnowledgeVersion = -1;
  private lastFishingShoalSupportedTopologyVersion = -1;
  private persistenceEnabled: boolean;
  private persistenceStatus: PersistenceBootState["status"];
  private lastSavedSaveRevision = -1;
  private lastSaveAt = Number.NEGATIVE_INFINITY;
  private saveInFlight?: Promise<boolean>;
  private saveQueued = false;
  private clearInFlight?: Promise<boolean>;
  private lifecycleSaveScheduled = false;
  private checkpointAvailable: boolean | undefined;
  private browserDebugApi?: BrowserDebugApi;
  private activeLifecycleCue?: Phaser.GameObjects.Text;
  private returnCueScheduled = false;
  private pendingReturnedVoyage?: Readonly<NavigatorVoyageAchievementRecordV1>;
  private pendingReturnVoyagesRemaining?: number;
  private pendingGenerationSummary?: Readonly<NavigatorGenerationSummary>;
  private previousShipPose!: ShipRenderPose;
  private currentShipPose!: ShipRenderPose;
  private lastSaveSerializationMs = 0;

  constructor(
    simulation = new GameSimulation(),
    saveStore: SaveStore<unknown>,
    checkpointStore: SaveStore<unknown>,
    persistenceBoot: PersistenceBootState,
  ) {
    super({ key: "WayfindersScene" });
    this.simulation = simulation;
    this.saveStore = saveStore;
    this.checkpointStore = checkpointStore;
    this.persistenceBoot = persistenceBoot;
    this.persistenceEnabled = persistenceBoot.autosave;
    this.persistenceStatus = persistenceBoot.status;
    if (persistenceBoot.status === "loaded") this.lastSavedSaveRevision = simulation.saveRevision;
  }

  create(): void {
    this.worldRenderer = new WorldRenderer(this);
    this.wreckRenderer = new WreckRenderer(this);
    this.knowledgeOverlay = new KnowledgeOverlayRenderer(this);
    this.riskOverlay = new RiskOverlayRenderer(this);
    this.cargoRenderer = new CargoRenderer(this);
    this.discoveryRenderer = new DiscoveryRenderer(this);
    this.fishingShoalRenderer = new FishingShoalRenderer(this);
    this.shipRenderer = new ShipRenderer(this);
    this.resetShipPresentation(true);
    this.gridGraphics = this.add.graphics().setDepth(70);
    this.debugGraphics = this.add.graphics().setDepth(71);
    this.gameHost = document.querySelector<HTMLElement>("#game-host") ?? undefined;
    this.gameStatus = document.querySelector<HTMLElement>("#game-status") ?? undefined;

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
      leave: Phaser.Input.Keyboard.KeyCodes.ESC,
    }, false) as MovementKeys;

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.cameras.main.startFollow(this.shipRenderer.container, true, 0.08, 0.08);
    this.configureCamera();
    this.renderWorld();
    this.eventUnsubscribers.push(onPrototypeConfigChanged((sections) => {
      if (sections.has("overlays")) this.simulation.refreshRiskOverlays();
    }));
    this.domAbort = new AbortController();
    this.mountDeveloperTools();
    this.mountSurveyRibbon();
    this.mountGenerationSummaryDialog();
    this.installBrowserDebugApi();
    this.bindSimulationEvents();
    this.showPendingGenerationSummary();
    this.syncPresentation(true);
    this.log(this.persistenceBoot.message);
    void this.refreshCheckpointAvailability();
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    const sceneStatus = document.querySelector<HTMLElement>("#scene-status");
    if (sceneStatus) sceneStatus.textContent = "Exploration sandbox active";
    if (this.gameStatus) this.gameStatus.textContent = "WASD / arrows sail · wheel or Q/E zoom · Developer tools tune";

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyBindings());
  }

  override update(time: number, delta: number): void {
    const activeElement = document.activeElement;
    const developerToolsOpen = document.documentElement.dataset.developerTools === "open";
    const textInputFocused = this.isTextEntryElement(activeElement);
    if (!developerToolsOpen && !textInputFocused && !this.simulation.generationHandoverActive && Phaser.Input.Keyboard.JustDown(this.keys.zoomIn)) {
      this.changeZoom(0.1);
    }
    if (!developerToolsOpen && !textInputFocused && !this.simulation.generationHandoverActive && Phaser.Input.Keyboard.JustDown(this.keys.zoomOut)) {
      this.changeZoom(-0.1);
    }
    if (!developerToolsOpen && !textInputFocused && !this.simulation.generationHandoverActive && Phaser.Input.Keyboard.JustDown(this.keys.survey)) {
      this.performSurveyAction();
    }
    if (!developerToolsOpen && !textInputFocused && !this.simulation.generationHandoverActive && Phaser.Input.Keyboard.JustDown(this.keys.leave)) {
      this.performSurveyLeave();
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
    this.maybeAutosave(time);
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
      surveyActionActive: this.time.now < this.surveyActionUntil,
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
    this.worldRenderer.render(this.simulation.generated);
  }

  private renderDebug(): void {
    const size = prototypeConfig.navigation.tileSize;
    const world = this.simulation.world;
    this.gridGraphics.clear();
    this.debugGraphics.clear();

    if (this.simulation.debug.navigationGrid) {
      this.gridGraphics.lineStyle(1, PALETTE.grid, 0.18);
      for (let x = 0; x <= world.width; x++) this.gridGraphics.lineBetween(x * size, 0, x * size, world.height * size);
      for (let y = 0; y <= world.height; y++) this.gridGraphics.lineBetween(0, y * size, world.width * size, y * size);
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

  private syncPresentation(force = false): void {
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
      this.wreckRenderer.sync(this.simulation.wrecks, this.simulation.world);
      this.lastWrecksRevision = this.simulation.wrecksRevision;
      this.lastWreckVisibilityVersion = this.simulation.world.visibilityVersion;
    }
    if (force || this.lastDiscoveryRecordsRevision !== this.simulation.discoveryRecordsRevision) {
      this.discoveryRenderer.sync(this.simulation.discoveries);
      this.lastDiscoveryRecordsRevision = this.simulation.discoveryRecordsRevision;
    }
    if (
      force
      || this.lastFishingShoalRecordsRevision !== this.simulation.fishingShoalRecordsRevision
      || this.lastFishingShoalVisibilityVersion !== this.simulation.world.visibilityVersion
      || this.lastFishingShoalKnowledgeVersion !== this.simulation.world.knowledgeVersion
      || this.lastFishingShoalSupportedTopologyVersion !== this.simulation.world.supportedTopologyVersion
    ) {
      this.fishingShoalRenderer.sync(this.simulation.fishingShoalReadModels);
      this.lastFishingShoalRecordsRevision = this.simulation.fishingShoalRecordsRevision;
      this.lastFishingShoalVisibilityVersion = this.simulation.world.visibilityVersion;
      this.lastFishingShoalKnowledgeVersion = this.simulation.world.knowledgeVersion;
      this.lastFishingShoalSupportedTopologyVersion = this.simulation.world.supportedTopologyVersion;
    }
    this.wreckRenderer.updateViewport(this.cameras.main);
    this.discoveryRenderer.updateViewport(this.cameras.main);
    this.fishingShoalRenderer.updateViewport(this.cameras.main);
    this.knowledgeOverlay.sync(this.simulation.world, this.simulation.generated.seed, force);
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
    const developerToolsOpen = document.documentElement.dataset.developerTools === "open";
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
      )
    );
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
      host.dataset.wrecks = String(this.simulation.wrecks.length);
      host.dataset.wreckSurveyProvisional = String(this.simulation.provisionalWreckSurveys.length);
      host.dataset.wreckSurveyReturned = String(this.simulation.returnedWreckSurveys.length);
      host.dataset.wreckSurveyInteraction = String(this.simulation.wreckSurveyInteraction?.wreckId ?? "");
      host.dataset.discoveryProvisional = String(this.simulation.provisionalDiscoveries.length);
      host.dataset.discoveryReturned = String(this.simulation.returnedDiscoveries.length);
      host.dataset.fishingShoalAvailable = String(this.simulation.fishingShoalDefinitions.length);
      host.dataset.fishingShoalProvisional = String(this.simulation.provisionalFishingShoals.length);
      host.dataset.fishingShoalReturned = String(this.simulation.returnedFishingShoals.length);
      host.dataset.fishingShoalActivationEligible = String(this.simulation.activationEligibleFishingShoals.length);
      host.dataset.fishingShoalConnectivityBuilds = String(this.simulation.fishingShoalConnectivityBuildCount);
      host.dataset.fishingShoalVisible = String(this.simulation.fishingShoalReadModels.length);
      host.dataset.surveyCases = String(this.simulation.surveyCasesRemaining);
      host.dataset.fishingShoalInteraction = this.simulation.fishingShoalInteraction?.id ?? "";
      host.dataset.persistenceStatus = this.persistenceStatus;
      host.dataset.wreckPresentation = String(this.simulation.wreckPresentationActive);
      host.dataset.respawnSeconds = this.simulation.respawnSecondsRemaining.toFixed(3);
      host.dataset.lifecyclePhase = this.simulation.generationHandoverActive
        ? "generation-summary"
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
      host.dataset.lastSaveSerializationMs = this.lastSaveSerializationMs.toFixed(2);
    }
    if (document.documentElement.dataset.wayfindersReady !== "true") {
      document.documentElement.dataset.wayfindersReady = "true";
    }

    const debugChanged = force
      || this.lastDebugRevision !== this.simulation.revision
      || this.lastDebugOverlayRevision !== this.simulation.overlaysRevision;
    const debugVisible = this.simulation.debug.navigationGrid || this.simulation.debug.currentSight;
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
      const snapshot = this.simulation.snapshot();
      this.updateProvisionOutput();
      if (host) {
        host.dataset.personalTiles = String(snapshot.knowledge.personal);
        host.dataset.supportedTiles = String(snapshot.knowledge.supported);
        host.dataset.unknownTiles = String(snapshot.knowledge.unknown);
        host.dataset.visibleTiles = String(snapshot.knowledge.visibleNow);
        host.dataset.forwardReachable = String(snapshot.risk.forwardReachable);
        host.dataset.forwardFrontier = String(snapshot.risk.forwardFrontier);
        host.dataset.forwardHeading = snapshot.risk.forwardHeading.toFixed(2);
        host.dataset.forwardConeHalfAngle = String(snapshot.risk.forwardConeHalfAngleDegrees);
        host.dataset.returnComfortable = String(snapshot.risk.comfortable);
        host.dataset.returnWarning = String(snapshot.risk.warning);
        host.dataset.returnCritical = String(snapshot.risk.critical);
        host.dataset.returnImpossible = String(snapshot.risk.impossible);
        host.dataset.returnPathTiles = String(snapshot.risk.returnPathTiles);
        host.dataset.returnCorridorTiles = String(snapshot.risk.returnCorridorTiles);
        host.dataset.returnLevel = String(snapshot.risk.returnLevel);
        host.dataset.returnCost = snapshot.risk.returnCost?.toFixed(3) ?? "unreachable";
        host.dataset.returnMargin = snapshot.risk.returnMargin?.toFixed(3) ?? "unreachable";
      }
      this.lastDiagnosticsRevision = this.simulation.revision;
      this.lastDiagnosticsOverlayRevision = this.simulation.overlaysRevision;
      this.lastDiagnosticsDeveloperToolsOpen = developerToolsOpen;
      this.lastDiagnosticsInputSuppressed = inputSuppressed;
      this.lastDiagnosticsAt = this.time.now;
    }
    if (diagnosticsDue && this.gameStatus) {
      const voyage = `Voyage ${this.simulation.navigatorVoyageNumber} of 4`;
      const message = this.simulation.generationHandoverActive
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
            <div><dt>Survey cases</dt><dd data-state="survey-cases"></dd></div>
          </dl>
          <p class="tool-lock-message" data-output="lock-reason" role="status" hidden></p>
        </section>

        <fieldset class="tool-card">
          <legend>World and travel</legend>
          <label class="tool-number tool-number--seed"><span>Seed</span><input data-field="seed" type="number" step="1" value="${this.simulation.generated.seed}"></label>
          <div class="tool-button-grid">
            <button class="tool-button--wide" data-action="regenerate" type="button">Reset world from entered seed</button>
            <button class="tool-button--wide" data-action="return-dock" type="button">Return to home dock (complete voyage)</button>
            <button data-action="inspect-island" type="button">Inspect next island</button>
            <button data-action="inspect-fishing-shoal" type="button">Inspect next fishing sign</button>
            <button data-action="inspect-wreck" type="button">Inspect next navigator wreck</button>
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
          <legend>Persistence and expedition records</legend>
          <div class="tool-row tool-row--buttons">
            <button data-action="save-checkpoint" type="button">Save checkpoint</button>
            <button data-action="load-checkpoint" type="button">Load checkpoint</button>
            <button data-action="clear-save" type="button">Clear stored saves</button>
          </div>
          <output data-output="persistence">${this.persistenceSummary()}</output>
          <output data-output="records">${this.expeditionRecordsSummary()}</output>
        </fieldset>

        <details class="tool-disclosure" data-tool-group="overlays" ${this.developerDisclosureState.get("overlays") ? "open" : ""}>
          <summary>Overlay visibility</summary>
          <div class="tool-disclosure__body">
            ${this.toggleMarkup("navigationGrid", "Navigation grid")}
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
            ${this.numberMarkup("supported-cost", "Supported cost", prototypeConfig.provisions.supportedCost, 0, 3, 0.1)}
            ${this.numberMarkup("personal-cost", "Personal cost", prototypeConfig.provisions.personalCost, 0, 3, 0.1)}
            ${this.numberMarkup("unknown-cost", "Unknown cost", prototypeConfig.provisions.unknownCost, 0.1, 4, 0.1)}
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
    this.persistenceOutput = slot.querySelector<HTMLOutputElement>("[data-output='persistence']") ?? undefined;
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
    slot.querySelector<HTMLButtonElement>("[data-action='save-checkpoint']")?.addEventListener("click", () => {
      void this.saveCheckpoint();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='load-checkpoint']")?.addEventListener("click", () => {
      void this.loadCheckpointFromStore();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='clear-save']")?.addEventListener("click", () => {
      void this.clearSaveFromStore();
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
        <span data-survey-case></span>
      </div>
      <div class="survey-ribbon__actions">
        <button data-survey-action="survey" type="button">Survey <kbd>F</kbd></button>
        <button data-survey-action="leave" type="button">Leave <kbd>Esc</kbd></button>
      </div>`;
    host.append(ribbon);
    this.surveyRibbon = ribbon;
    this.surveyRibbonTitle = ribbon.querySelector<HTMLElement>("[data-survey-title]") ?? undefined;
    this.surveyRibbonClue = ribbon.querySelector<HTMLElement>("[data-survey-clue]") ?? undefined;
    this.surveyRibbonCase = ribbon.querySelector<HTMLElement>("[data-survey-case]") ?? undefined;
    this.surveyButton = ribbon.querySelector<HTMLButtonElement>("[data-survey-action='survey']") ?? undefined;
    this.leaveButton = ribbon.querySelector<HTMLButtonElement>("[data-survey-action='leave']") ?? undefined;
    this.surveyButton?.addEventListener("click", () => this.performSurveyAction(), { signal });
    this.leaveButton?.addEventListener("click", () => this.performSurveyLeave(), { signal });
  }

  private syncSurveyRibbon(): void {
    const ribbon = this.surveyRibbon;
    if (!ribbon) return;
    if (this.simulation.generationHandoverActive) {
      ribbon.hidden = true;
      return;
    }

    const wreckInteraction = this.simulation.wreckSurveyInteraction;
    if (wreckInteraction) {
      this.dismissedFishingShoalId = undefined;
      if (this.dismissedWreckId !== undefined && this.dismissedWreckId !== wreckInteraction.wreckId) {
        this.dismissedWreckId = undefined;
      }
      if (this.dismissedWreckId === wreckInteraction.wreckId || this.time.now < this.surveyActionUntil) {
        ribbon.hidden = true;
        return;
      }
      if (this.surveyRibbonTitle) this.surveyRibbonTitle.textContent = "Unidentified navigator wreck";
      if (this.surveyRibbonClue) {
        this.surveyRibbonClue.textContent = "Survey the remains to identify the lost navigator.";
      }
      if (this.surveyRibbonCase) {
        this.surveyRibbonCase.textContent = wreckInteraction.surveyCasesRemaining === 1
          ? "Survey case ready — the identity report must be brought home."
          : "No survey case remains on this voyage.";
      }
      if (this.surveyButton) this.surveyButton.disabled = wreckInteraction.surveyCasesRemaining === 0;
      ribbon.dataset.surveyKind = "wreck";
      ribbon.dataset.surveyTarget = String(wreckInteraction.wreckId);
      delete ribbon.dataset.shoalId;
      ribbon.hidden = false;
      return;
    }

    this.dismissedWreckId = undefined;
    const interaction = this.simulation.fishingShoalInteraction;
    if (!interaction) {
      ribbon.hidden = true;
      this.dismissedFishingShoalId = undefined;
      delete ribbon.dataset.surveyKind;
      delete ribbon.dataset.surveyTarget;
      delete ribbon.dataset.shoalId;
      return;
    }
    if (this.dismissedFishingShoalId && this.dismissedFishingShoalId !== interaction.id) {
      this.dismissedFishingShoalId = undefined;
    }
    if (this.dismissedFishingShoalId === interaction.id || this.time.now < this.surveyActionUntil) {
      ribbon.hidden = true;
      return;
    }

    if (this.surveyRibbonTitle) {
      this.surveyRibbonTitle.textContent = interaction.state === "returned-lead"
        ? "Returned fishing lead"
        : "Fishing sign nearby";
    }
    if (this.surveyRibbonClue) this.surveyRibbonClue.textContent = interaction.clueLabel;
    if (this.surveyRibbonCase) {
      this.surveyRibbonCase.textContent = interaction.surveyCasesRemaining === 1
        ? "Survey case ready — surveying spends it for this voyage."
        : "No survey case remains on this voyage.";
    }
    if (this.surveyButton) this.surveyButton.disabled = interaction.surveyCasesRemaining === 0;
    ribbon.dataset.surveyKind = "fishing-shoal";
    ribbon.dataset.surveyTarget = interaction.id;
    ribbon.dataset.shoalId = interaction.id;
    ribbon.hidden = false;
  }

  private performSurveyAction(): FishingShoalInteractionResultV1 | WreckSurveyInteractionResultV1 | undefined {
    if (this.simulation.generationHandoverActive) return undefined;
    return this.simulation.wreckSurveyInteraction
      ? this.performWreckSurvey()
      : this.performFishingShoalSurvey();
  }

  private performSurveyLeave(): FishingShoalInteractionResultV1 | WreckSurveyInteractionResultV1 | undefined {
    if (this.simulation.generationHandoverActive) return undefined;
    return this.simulation.wreckSurveyInteraction
      ? this.performWreckLeave()
      : this.performFishingShoalLeave();
  }

  private performWreckSurvey(): WreckSurveyInteractionResultV1 | undefined {
    const interaction = this.simulation.wreckSurveyInteraction;
    if (!interaction || this.time.now < this.surveyActionUntil) return undefined;
    const result = this.simulation.interactWithWreck({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      type: "survey",
      wreckId: interaction.wreckId,
    });
    if (result.status === "surveyed") {
      this.surveyActionUntil = this.time.now + result.presentationMs;
      this.dismissedWreckId = interaction.wreckId;
      this.updatePersistenceOutputs();
      this.requestLifecycleSave();
    } else if (result.status === "rejected") {
      this.log(`Wreck survey was not started: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private performWreckLeave(): WreckSurveyInteractionResultV1 | undefined {
    const interaction = this.simulation.wreckSurveyInteraction;
    if (!interaction || this.time.now < this.surveyActionUntil) return undefined;
    const result = this.simulation.interactWithWreck({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      type: "leave",
      wreckId: interaction.wreckId,
    });
    if (result.status === "left") {
      this.dismissedWreckId = interaction.wreckId;
      this.log("Left the unidentified wreck unexamined; the survey case was preserved.");
    } else if (result.status === "rejected") {
      this.log(`Could not leave the wreck prompt: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private performFishingShoalSurvey(): FishingShoalInteractionResultV1 | undefined {
    const interaction = this.simulation.fishingShoalInteraction;
    if (!interaction || this.time.now < this.surveyActionUntil) return undefined;
    const result = this.simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: interaction.id,
    });
    if (result.status === "surveyed") {
      this.surveyActionUntil = this.time.now + result.presentationMs;
      this.dismissedFishingShoalId = interaction.id;
      this.updatePersistenceOutputs();
      this.requestLifecycleSave();
    } else if (result.status === "rejected") {
      this.log(`Fishing-shoal survey was not started: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private performFishingShoalLeave(): FishingShoalInteractionResultV1 | undefined {
    const interaction = this.simulation.fishingShoalInteraction;
    if (!interaction || this.time.now < this.surveyActionUntil) return undefined;
    const result = this.simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "leave",
      id: interaction.id,
    });
    if (result.status === "left") {
      this.dismissedFishingShoalId = interaction.id;
      this.log("Left the fishing sign unexamined; the survey case was preserved.");
    } else if (result.status === "rejected") {
      this.log(`Could not leave the fishing-shoal prompt: ${result.reason}.`);
    }
    this.syncSurveyRibbon();
    return result;
  }

  private mountGenerationSummaryDialog(): void {
    const host = this.gameHost;
    const signal = this.domAbort?.signal;
    if (!host || !signal) return;
    const dialog = document.createElement("dialog");
    dialog.className = "generation-summary";
    dialog.setAttribute("aria-labelledby", "generation-summary-title");
    dialog.innerHTML = `
      <div class="generation-summary__panel">
        <p class="generation-summary__eyebrow" data-generation-summary-eyebrow></p>
        <h2 id="generation-summary-title" data-generation-summary-title></h2>
        <ol class="generation-summary__journeys" data-generation-summary-journeys></ol>
        <p class="generation-summary__findings" data-generation-summary-findings></p>
        <p class="generation-summary__handover" data-generation-summary-handover></p>
        <button data-generation-summary-continue type="button">Continue</button>
      </div>`;
    host.append(dialog);
    this.generationSummaryDialog = dialog;
    this.generationSummaryEyebrow = dialog.querySelector<HTMLElement>("[data-generation-summary-eyebrow]") ?? undefined;
    this.generationSummaryTitle = dialog.querySelector<HTMLElement>("[data-generation-summary-title]") ?? undefined;
    this.generationSummaryJourneys = dialog.querySelector<HTMLOListElement>("[data-generation-summary-journeys]") ?? undefined;
    this.generationSummaryFindings = dialog.querySelector<HTMLElement>("[data-generation-summary-findings]") ?? undefined;
    this.generationSummaryHandover = dialog.querySelector<HTMLElement>("[data-generation-summary-handover]") ?? undefined;
    this.generationSummaryContinue = dialog.querySelector<HTMLButtonElement>("[data-generation-summary-continue]") ?? undefined;
    this.generationSummaryContinue?.addEventListener("click", () => this.dismissGenerationSummary(), { signal });
    dialog.addEventListener("cancel", (event) => event.preventDefault(), { signal });
  }

  private showGenerationSummary(summary: Readonly<NavigatorGenerationSummary>): void {
    const dialog = this.generationSummaryDialog;
    if (!dialog) return;
    if (this.generationSummaryEyebrow) {
      this.generationSummaryEyebrow.textContent = `Generation ${summary.generation} navigator`;
    }
    if (this.generationSummaryTitle) {
      this.generationSummaryTitle.textContent = summary.outcome === "tenure-completed"
        ? "Four journeys completed"
        : "Lost at sea";
    }
    if (this.generationSummaryJourneys) {
      this.generationSummaryJourneys.replaceChildren(...summary.journeys.map((journey) => {
        const row = document.createElement("li");
        row.dataset.outcome = journey.outcome;
        const heading = document.createElement("div");
        heading.className = "generation-summary__journey-heading";
        const label = document.createElement("strong");
        label.textContent = `Journey ${journey.voyageNumber}`;
        const outcome = document.createElement("span");
        outcome.textContent = journey.outcome === "returned" ? "Returned safely" : "Lost at sea";
        heading.append(label, outcome);
        const achievements = document.createElement("ul");
        achievements.className = "generation-summary__achievements";
        achievements.replaceChildren(...journey.achievements.map((achievement) => {
          const item = document.createElement("li");
          item.textContent = achievement;
          return item;
        }));
        row.append(heading, achievements);
        return row;
      }));
    }
    if (this.generationSummaryFindings) {
      this.generationSummaryFindings.textContent = summary.outcome === "tenure-completed"
        ? "All findings returned during these journeys are secured with the tribe."
        : "Findings returned before the final voyage remain secured with the tribe.";
    }
    if (this.generationSummaryHandover) {
      this.generationSummaryHandover.textContent = summary.outcome === "tenure-completed"
        ? `Their four journeys enter the tribe's memory. Time passes, and generation ${summary.nextGeneration} takes the helm.`
        : `The tribe mourns, time passes, and generation ${summary.nextGeneration} takes the helm.`;
    }
    if (this.generationSummaryContinue) {
      this.generationSummaryContinue.textContent = `Begin generation ${summary.nextGeneration}`;
    }
    dialog.dataset.outcome = summary.outcome;
    dialog.dataset.generation = String(summary.generation);
    dialog.dataset.nextGeneration = String(summary.nextGeneration);
    this.generationSummaryVisible = true;
    // Keep the developer drawer reachable for checkpoint testing while the
    // simulation's handover state remains the authoritative gameplay gate.
    if (!dialog.open) {
      if (typeof dialog.show === "function") dialog.show();
      else dialog.setAttribute("open", "");
    }
    this.lastDiagnosticsRevision = -1;
    this.syncSurveyRibbon();
    this.generationSummaryContinue?.focus();
  }

  private showPendingGenerationSummary(): boolean {
    const handover = this.simulation.pendingGenerationHandover;
    if (!handover) return false;
    const navigator = this.simulation.navigatorLineage.find(({ id }) => id === handover.fromNavigatorId);
    if (!navigator || navigator.state === "active") {
      throw new Error(`Terminal navigator ${handover.fromNavigatorId} is missing from the lineage`);
    }
    this.showGenerationSummary(buildNavigatorGenerationSummary(navigator, this.navigatorAchievementSources()));
    return true;
  }

  private navigatorAchievementSources(): NavigatorAchievementSources {
    return {
      discoveries: this.simulation.returnedDiscoveries,
      fishingShoals: this.simulation.fishingShoalDefinitions,
      wrecks: this.simulation.wrecks,
    };
  }

  private dismissGenerationSummary(): boolean {
    if (!this.generationSummaryDialog || !this.generationSummaryVisible) return false;
    if (!this.simulation.acknowledgeGenerationHandover()) return false;
    this.closeGenerationSummaryPresentation();
    this.requestLifecycleSave();
    const focusTarget = document.documentElement.dataset.developerTools === "open"
      ? document.querySelector<HTMLElement>("#developer-tools-close")
      : this.gameHost;
    focusTarget?.focus({ preventScroll: true });
    return true;
  }

  private closeGenerationSummaryPresentation(): boolean {
    const dialog = this.generationSummaryDialog;
    if (!dialog) return false;
    const wasVisible = this.generationSummaryVisible || dialog.open;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    this.generationSummaryVisible = false;
    this.lastDiagnosticsRevision = -1;
    this.syncSurveyRibbon();
    return wasVisible;
  }

  private toggleMarkup(name: keyof GameSimulation["debug"], label: string): string {
    return `<label class="tool-check"><input data-overlay="${name}" type="checkbox" ${this.simulation.debug[name] ? "checked" : ""}> ${label}</label>`;
  }

  private numberMarkup(id: string, label: string, value: number, min: number, max: number, step: number): string {
    return `<label class="tool-number"><span>${label}</span><input data-config="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  }

  private developerActionLockReason(): string | undefined {
    if (this.simulation.wreckPresentationActive) return "Controls are paused while the navigator's loss is presented.";
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
    set("survey-cases", `${this.simulation.surveyCasesRemaining} remaining`);
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
      || (!visibility.forwardRange && !visibility.returnViability);
  }

  private liveConfigValue(id: string): number {
    switch (id) {
      case "sight-radius": return prototypeConfig.navigation.sightRadius;
      case "starting-bundles": return prototypeConfig.provisions.startingBundles;
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
    this.updatePersistenceOutputs();
    this.syncDeveloperToolAvailability();
  }

  private persistenceSummary(): string {
    const label = this.persistenceStatus === "loaded"
      ? "saved"
      : this.persistenceStatus === "new"
        ? "empty"
        : this.persistenceStatus;
    const checkpoint = this.checkpointAvailable === undefined
      ? "checking"
      : this.checkpointAvailable
        ? "ready"
        : "none";
    return `Browser autosave: ${label}${this.persistenceEnabled ? " · on" : " · off"} `
      + `· Manual checkpoint: ${checkpoint}`;
  }

  private expeditionRecordsSummary(): string {
    return `Discoveries: ${this.simulation.provisionalDiscoveries.length} provisional · `
      + `${this.simulation.returnedDiscoveries.length} returned · Fishing reports: `
      + `${this.simulation.provisionalFishingShoals.length} provisional · `
      + `${this.simulation.returnedFishingShoals.length} returned · Wreck reports: `
      + `${this.simulation.provisionalWreckSurveys.length} provisional · `
      + `${this.simulation.returnedWreckSurveys.length} returned · `
      + `${this.simulation.surveyCasesRemaining} survey case${this.simulation.surveyCasesRemaining === 1 ? "" : "s"}`;
  }

  private updatePersistenceOutputs(): void {
    if (this.persistenceOutput) this.persistenceOutput.value = this.persistenceSummary();
    if (this.recordsOutput) this.recordsOutput.value = this.expeditionRecordsSummary();
    this.updateDeveloperStateOutputs();
  }

  private maybeAutosave(time: number): void {
    if (!this.persistenceEnabled || this.lastSavedSaveRevision === this.simulation.saveRevision) return;
    if (this.saveInFlight || this.clearInFlight) return;
    if (time - this.lastSaveAt < AUTOSAVE_INTERVAL_MS) return;
    void this.saveNow(false);
  }

  private saveNow(reportSuccess: boolean): Promise<boolean> {
    if (!this.persistenceEnabled) {
      if (reportSuccess) this.log("Browser saving is unavailable for this session.");
      this.updatePersistenceOutputs();
      return Promise.resolve(false);
    }
    if (this.clearInFlight) return Promise.resolve(false);
    if (this.saveInFlight) {
      this.saveQueued = true;
      return this.saveInFlight;
    }

    const operation = this.performSaveLoop(reportSuccess);
    this.saveInFlight = operation;
    void operation.finally(() => {
      if (this.saveInFlight === operation) this.saveInFlight = undefined;
    });
    return operation;
  }

  private async performSaveLoop(reportSuccess: boolean): Promise<boolean> {
    try {
      do {
        this.saveQueued = false;
        const saveRevision = this.simulation.saveRevision;
        const serializationStarted = performance.now();
        const save = this.simulation.createSave();
        this.lastSaveSerializationMs = performance.now() - serializationStarted;
        await this.saveStore.save(save);
        this.lastSavedSaveRevision = saveRevision;
        this.lastSaveAt = this.time.now;
      } while (
        this.saveQueued
        && this.lastSavedSaveRevision !== this.simulation.saveRevision
      );
      this.persistenceStatus = "loaded";
      this.updatePersistenceOutputs();
      if (reportSuccess) this.log("Saved the inherited world to browser storage.");
      return true;
    } catch (error) {
      this.persistenceStatus = "unavailable";
      this.persistenceEnabled = false;
      this.updatePersistenceOutputs();
      this.log(`Browser save failed: ${error instanceof Error ? error.message : "unknown storage error"}`);
      return false;
    }
  }

  private async refreshCheckpointAvailability(): Promise<void> {
    try {
      const slot = await loadExactSaveSlot(
        this.checkpointStore,
        (save) => new GameSimulation(structuredClone(prototypeConfig)).restoreSave(save),
      );
      this.checkpointAvailable = slot.status === "loaded";
      if (slot.status === "discarded") {
        if (slot.removed) {
          this.log(
            `Removed an incompatible manual checkpoint: ${slot.error instanceof Error ? slot.error.message : "invalid save"}.`,
          );
        } else {
          this.log(
            `The manual checkpoint is incompatible and could not be removed: `
            + `${slot.removalError instanceof Error ? slot.removalError.message : "storage error"}.`,
          );
        }
      }
    } catch {
      this.checkpointAvailable = false;
    }
    this.updatePersistenceOutputs();
  }

  private async saveCheckpoint(): Promise<boolean> {
    try {
      const tile = this.simulation.snapshot().tile;
      await this.checkpointStore.save(this.simulation.createSave());
      this.checkpointAvailable = true;
      this.updatePersistenceOutputs();
      this.showLifecycleCue(
        `CHECKPOINT SAVED\nSHIP AT ${tile.x}, ${tile.y}`,
        "#d9fff5",
        3_000,
      );
      this.log(`Saved a manual checkpoint with the ship at ${tile.x}, ${tile.y}.`);
      return true;
    } catch (error) {
      this.log(`Checkpoint save failed: ${error instanceof Error ? error.message : "storage error"}`);
      return false;
    }
  }

  private async loadCheckpointFromStore(): Promise<boolean> {
    let slot: Awaited<ReturnType<typeof loadExactSaveSlot>>;
    try {
      slot = await loadExactSaveSlot(
        this.checkpointStore,
        (save) => new GameSimulation(structuredClone(prototypeConfig)).restoreSave(save),
      );
    } catch (error) {
      this.log(`Checkpoint load failed: ${error instanceof Error ? error.message : "storage error"}`);
      return false;
    }
    if (slot.status === "empty") {
      this.checkpointAvailable = false;
      this.updatePersistenceOutputs();
      this.log("No manual checkpoint exists yet. Use Save checkpoint first.");
      return false;
    }
    if (slot.status === "discarded") {
      this.checkpointAvailable = false;
      this.updatePersistenceOutputs();
      this.log(
        `The manual checkpoint is incompatible with this build${slot.removed ? " and was removed" : ""}: `
        + `${slot.removed
          ? (slot.error instanceof Error ? slot.error.message : "invalid save")
          : (slot.removalError instanceof Error ? slot.removalError.message : "storage error")}.`,
      );
      return false;
    }
    if (this.saveInFlight) await this.saveInFlight;
    try {
      this.simulation.restoreSave(slot.save);
    } catch (error) {
      this.checkpointAvailable = false;
      this.updatePersistenceOutputs();
      this.log(`Checkpoint restoration failed after validation: ${error instanceof Error ? error.message : "invalid save"}.`);
      return false;
    }
    try {
      this.checkpointAvailable = true;
      this.persistenceEnabled = true;
      this.persistenceStatus = "loaded";
      // The loaded checkpoint becomes the new rolling autosave baseline so
      // a subsequent page reload resumes from the restored state.
      this.lastSavedSaveRevision = -1;
      this.mountDeveloperTools();
      this.afterWorldChanged();
      const tile = this.simulation.snapshot().tile;
      this.showLifecycleCue(
        `CHECKPOINT LOADED\nSHIP RESTORED TO ${tile.x}, ${tile.y}`,
        "#d9fff5",
        3_000,
      );
      this.log(
        `Loaded the manual checkpoint, restored the ship to ${tile.x}, ${tile.y}, `
        + "and rebuilt sight and route calculations.",
      );
      await this.saveNow(false);
      return true;
    } catch (error) {
      this.log(`Load failed without changing the running world: ${error instanceof Error ? error.message : "invalid save"}`);
      return false;
    }
  }

  private clearSaveFromStore(): Promise<boolean> {
    if (this.clearInFlight) return this.clearInFlight;
    const operation = this.performClearSave();
    this.clearInFlight = operation;
    void operation.finally(() => {
      if (this.clearInFlight === operation) this.clearInFlight = undefined;
    });
    return operation;
  }

  private async performClearSave(): Promise<boolean> {
    const saveRevisionAtRequest = this.simulation.saveRevision;
    try {
      if (this.saveInFlight) await this.saveInFlight;
      await Promise.all([this.saveStore.clear(), this.checkpointStore.clear()]);
      this.persistenceEnabled = true;
      this.persistenceStatus = "new";
      this.checkpointAvailable = false;
      this.lastSavedSaveRevision = saveRevisionAtRequest;
      this.updatePersistenceOutputs();
      this.log("Cleared the browser autosave and manual checkpoint. The running world was not reset.");
      return true;
    } catch (error) {
      this.log(`Could not clear browser storage: ${error instanceof Error ? error.message : "storage error"}`);
      return false;
    }
  }

  private requestLifecycleSave(): void {
    if (this.lifecycleSaveScheduled) return;
    this.lifecycleSaveScheduled = true;
    queueMicrotask(() => {
      this.lifecycleSaveScheduled = false;
      void this.saveNow(false);
    });
  }

  private afterWorldChanged(): void {
    this.islandInspectionIndex = 0;
    this.fishingShoalInspectionIndex = 0;
    this.lastInspectedWreckId = 0;
    this.renderWorld();
    this.configureCamera();
    this.lastDebugRevision = -1;
    this.lastDebugOverlayRevision = -1;
    this.lastDiagnosticsRevision = -1;
    this.lastDiagnosticsOverlayRevision = -1;
    this.lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
    this.dismissedFishingShoalId = undefined;
    this.dismissedWreckId = undefined;
    this.surveyActionUntil = Number.NEGATIVE_INFINITY;
    this.pendingGenerationSummary = undefined;
    this.closeGenerationSummaryPresentation();
    this.resetShipPresentation(true);
    this.updateProvisionOutput();
    this.showPendingGenerationSummary();
    this.syncPresentation(true);
    // Camera follow deliberately uses smoothing during play. A restored or
    // regenerated world is a discontinuity, so snap to the authoritative ship
    // before smooth following resumes.
    this.cameras.main.centerOn(this.simulation.ship.worldX, this.simulation.ship.worldY);
  }

  private inspectNextIsland(): void {
    const lockReason = this.developerActionLockReason();
    if (lockReason) {
      this.log(lockReason);
      return;
    }
    const islands = this.simulation.generated.islands;
    if (islands.length === 0) {
      this.log("This seed contains no scattered islands.");
      return;
    }
    const island = islands[this.islandInspectionIndex % islands.length];
    this.islandInspectionIndex++;
    const tile = this.findIslandInspectionTile(island);
    if (!tile) {
      this.log(`Could not find a passable inspection point for island ${island.id}.`);
      return;
    }
    this.teleportForDeveloper(
      tile,
      `Inspecting ${island.size} ${island.kind} ${island.id} from ${tile.x}, ${tile.y}.`,
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
    this.dismissedFishingShoalId = undefined;
    this.surveyActionUntil = Number.NEGATIVE_INFINITY;
    this.teleportForDeveloper(
      definition.tile,
      `Inspecting fishing sign ${definition.id} at ${definition.tile.x}, ${definition.tile.y}.`,
    );
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
    this.dismissedWreckId = undefined;
    this.surveyActionUntil = Number.NEGATIVE_INFINITY;
    const inspected = this.teleportForDeveloper(
      { x: target.x, y: target.y },
      `Inspecting navigator wreck ${target.id} from generation ${target.generation} at ${target.x}, ${target.y}.`,
    );
    if (inspected) this.lastInspectedWreckId = target.id;
    return inspected;
  }

  private findIslandInspectionTile(island: GeneratedIsland): { x: number; y: number } | undefined {
    let closestWater: { x: number; y: number } | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let y = island.bounds.minY; y <= island.bounds.maxY; y++) {
      for (let x = island.bounds.minX; x <= island.bounds.maxX; x++) {
        if (!this.simulation.world.inBounds(x, y) || this.simulation.world.isMovementBlocked(x, y)) continue;
        if (this.simulation.world.getTile(x, y).islandId !== island.id) continue;
        const distance = Math.hypot(x - island.center.x, y - island.center.y);
        if (distance >= closestDistance) continue;
        closestDistance = distance;
        closestWater = { x, y };
      }
    }
    if (closestWater) return closestWater;

    // A configured morphology could paint no passable interior. Keep a bounded
    // outside-ring fallback so the inspection control still cannot hang.
    const baseRadius = Math.ceil(island.outerRadius + 1);
    for (let extra = 0; extra <= 3; extra++) {
      const radius = baseRadius + extra;
      for (let step = 0; step < 24; step++) {
        const angle = island.rotation + step / 24 * Math.PI * 2;
        const tile = {
          x: Math.round(island.center.x + Math.cos(angle) * radius),
          y: Math.round(island.center.y + Math.sin(angle) * radius),
        };
        if (
          this.simulation.world.inBounds(tile.x, tile.y)
          && !this.simulation.world.isMovementBlocked(tile.x, tile.y)
        ) return tile;
      }
    }
    return undefined;
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
      saveNow: () => this.saveCheckpoint(),
      loadSave: () => this.loadCheckpointFromStore(),
      clearSave: () => this.clearSaveFromStore(),
      returnToDock: () => this.returnToDockForTesting(),
      navigatorWreckTargets: () => this.navigatorWreckTargets(),
      performance: () => ({
        ...this.frameTiming.snapshot(),
        lastSaveSerializationMs: this.lastSaveSerializationMs,
      }),
      fishingShoalTargets: () => this.simulation.fishingShoalDefinitions.map(({ id, tile }) => ({
        id,
        x: tile.x,
        y: tile.y,
      })),
      surveyFishingShoal: () => this.performFishingShoalSurvey(),
      leaveFishingShoal: () => this.performFishingShoalLeave(),
      surveyWreck: () => this.performWreckSurvey(),
      leaveWreck: () => this.performWreckLeave(),
      continueGeneration: () => this.dismissGenerationSummary(),
    };
    this.browserDebugApi = api;
    window.__WAYFINDERS__ = api;
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
        voyageNumber,
        voyagesRemaining,
        supportedTileCount,
        closedUnknownTileCount,
        achievements,
      }) => {
        this.worldRenderer.refreshKnowledge(this.simulation.generated);
        this.pendingReturnedVoyage = achievements;
        this.pendingReturnVoyagesRemaining = voyagesRemaining;
        this.scheduleReturnCue();
        this.log(
          `Voyage ${voyageNumber} of 4 returned: ${supportedTileCount} Personal tiles and `
          + `${closedUnknownTileCount} enclosed Unknown tiles became Supported; ${voyagesRemaining} remain.`,
        );
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("navigatorTenureCompleted", ({
        navigatorId,
        generation,
        completedVoyages,
        nextGeneration,
      }) => {
        const navigator = this.simulation.navigatorLineage.find(({ id }) => id === navigatorId);
        if (!navigator) throw new Error(`Completed navigator ${navigatorId} is missing from the lineage`);
        this.pendingGenerationSummary = buildNavigatorGenerationSummary(
          navigator,
          this.navigatorAchievementSources(),
        );
        this.scheduleReturnCue();
        this.log(
          `Generation ${generation}'s navigator completed ${completedVoyages} successful voyages; `
          + `generation ${nextGeneration} took the helm.`,
        );
        this.requestLifecycleSave();
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
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("expeditionFailed", ({ generation, nextGeneration, forgottenTiles }) => {
        this.resetShipPresentation(false);
        this.cameras.main.centerOn(this.simulation.ship.worldX, this.simulation.ship.worldY);
        const navigator = this.simulation.navigatorLineage.find((record) => record.generation === generation);
        if (!navigator) throw new Error(`Lost navigator from generation ${generation} is missing from the lineage`);
        this.showGenerationSummary(buildNavigatorGenerationSummary(
          navigator,
          this.navigatorAchievementSources(),
        ));
        this.log(
          `Generation ${generation} lost ${forgottenTiles} unreturned tiles; `
          + `generation ${nextGeneration} now carries the inherited chart.`,
        );
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("shipReplenished", ({ reason }) => {
        if (reason !== "dock") return;
        this.showLifecycleCue("DOCKED\nPROVISIONS REPLENISHED", "#d9fff5");
        this.log("Dock stores replenished the ship's provisions.");
      }),
      this.simulation.events.on("wreckDiscovered", ({ wreckId }) => {
        this.log(`Found unidentified navigator wreck ${wreckId}. Survey it to learn whose vessel it was.`);
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("wreckSurveyed", ({ lostGeneration, presentationMs }) => {
        this.showLifecycleCue(
          `WRECK IDENTIFIED\nGENERATION ${lostGeneration} NAVIGATOR\nRETURN HOME TO REPORT THEIR FATE`,
          "#f0d7a2",
          presentationMs,
        );
        this.log(`Wreck survey identified generation ${lostGeneration}'s navigator; the report is provisional.`);
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("wreckSurveysReturned", ({ reports }) => {
        this.log(
          `Returned wreck report secured for ${reports.map(({ lostGeneration }) => `generation ${lostGeneration}`).join(", ")}.`,
        );
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("wreckSurveysLost", ({ reports }) => {
        this.log(
          `Unreturned wreck identification lost at sea for ${reports.map(({ lostGeneration }) => `generation ${lostGeneration}`).join(", ")}; the wreck can be surveyed again.`,
        );
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("discoveryFound", ({ name, detail }) => {
        this.showLifecycleCue(
          `DISCOVERY SIGHTED\n${name.toUpperCase()}\nRETURN HOME TO SECURE IT`,
          "#b9fff5",
          5_000,
        );
        this.log(`Provisional discovery: ${name}. ${detail}`);
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("fishingShoalSighted", ({ clue }) => {
        this.showLifecycleCue(
          `FISHING SIGN SIGHTED\n${clue.label.toUpperCase()}\nRETURN HOME TO RECORD IT`,
          "#a9f7fb",
          5_000,
        );
        this.log(`Provisional fishing-shoal sighting: ${clue.label}.`);
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("fishingShoalSurveyed", ({ quality, presentationMs }) => {
        this.showLifecycleCue(
          `FISHING GROUND SURVEYED\n${quality.toUpperCase()} QUALITY\nRETURN HOME TO REPORT IT`,
          "#ffe1b6",
          presentationMs,
        );
        this.log(`Fishing ground surveyed: ${quality} quality. The voyage's survey case was spent.`);
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
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
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("fishingShoalsLost", ({ records }) => {
        const surveys = records.filter(({ state }) => state === "surveyed").length;
        const sightings = records.length - surveys;
        this.log(
          `Unreturned fishing work lost with the ship: ${sightings} sighting${sightings === 1 ? "" : "s"}, `
          + `${surveys} survey${surveys === 1 ? "" : "s"}. Earlier returned leads remain inherited.`,
        );
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("discoveriesReturned", ({ discoveries }) => {
        const names = discoveries.map(({ name }) => name).join(", ");
        this.log(`Returned discoveries secured: ${names}.`);
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("discoveriesLost", ({ discoveries }) => {
        this.log(`Unreturned discoveries lost with the ship: ${discoveries.map(({ name }) => name).join(", ")}.`);
        this.updatePersistenceOutputs();
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("worldRegenerated", () => {
        this.requestLifecycleSave();
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
      const generationSummary = this.pendingGenerationSummary;
      this.pendingGenerationSummary = undefined;
      if (!voyage && !generationSummary) return;

      if (generationSummary) {
        this.showGenerationSummary(generationSummary);
        return;
      }
      if (!voyage) return;

      const voyageHeading = `VOYAGE ${voyage.voyageNumber} OF 4 RETURNED`;
      const remainingLine = voyagesRemaining === undefined
        ? ""
        : `${voyagesRemaining} VOYAGE${voyagesRemaining === 1 ? "" : "S"} REMAIN · `;
      const achievements = describeNavigatorVoyageAchievements(
        voyage,
        this.navigatorAchievementSources(),
      ).map((achievement) => achievement.toUpperCase()).join("\n");
      const hasNotableFindings = voyage.discoveryIds.length > 0
        || voyage.fishingLeadIds.length > 0
        || voyage.fishingSurveyIds.length > 0
        || voyage.wreckIds.length > 0;
      this.showLifecycleCue(
        `${voyageHeading}\n${achievements}\nADDED TO THE INHERITED CHART\n`
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
    this.persistenceOutput = undefined;
    this.recordsOutput = undefined;
    this.developerStateOutputs.clear();
    this.surveyRibbon?.remove();
    this.surveyRibbon = undefined;
    this.surveyRibbonTitle = undefined;
    this.surveyRibbonClue = undefined;
    this.surveyRibbonCase = undefined;
    this.surveyButton = undefined;
    this.leaveButton = undefined;
    this.generationSummaryDialog?.remove();
    this.generationSummaryDialog = undefined;
    this.generationSummaryEyebrow = undefined;
    this.generationSummaryTitle = undefined;
    this.generationSummaryJourneys = undefined;
    this.generationSummaryFindings = undefined;
    this.generationSummaryHandover = undefined;
    this.generationSummaryContinue = undefined;
    this.generationSummaryVisible = false;
    for (const unsubscribe of this.eventUnsubscribers.splice(0)) unsubscribe();
    this.knowledgeOverlay.destroy();
    this.riskOverlay.destroy();
    this.cargoRenderer.destroy();
    this.discoveryRenderer.destroy();
    this.fishingShoalRenderer.destroy();
    this.wreckRenderer.destroy();
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.saveStore.close();
    this.checkpointStore.close();
    if (this.activeLifecycleCue) {
      this.tweens.killTweensOf(this.activeLifecycleCue);
      this.activeLifecycleCue.destroy();
      this.activeLifecycleCue = undefined;
    }
    if (window.__WAYFINDERS__ === this.browserDebugApi) delete window.__WAYFINDERS__;
    this.browserDebugApi = undefined;
  }

  private readonly onPageHide = (): void => {
    if (this.lastSavedSaveRevision !== this.simulation.saveRevision) void this.saveNow(false);
  };

  private readonly onVisibilityChange = (): void => {
    if (
      document.visibilityState === "hidden"
      && this.lastSavedSaveRevision !== this.simulation.saveRevision
    ) void this.saveNow(false);
  };
}
