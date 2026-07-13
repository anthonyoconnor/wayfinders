import Phaser from "phaser";
import {
  onPrototypeConfigChanged,
  patchPrototypeConfig,
  prototypeConfig,
  type DeepPartial,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { GameSimulation } from "../core/GameSimulation";
import { SimulationClock } from "../core/SimulationClock";
import type { MovementInput } from "../core/types";
import type { SaveStore } from "../persistence/IndexedDbSaveStore";
import { worldToGrid } from "../world/CoordinateSystem";
import type { GeneratedIsland } from "../world/IslandGenerator";
import { KnowledgeState } from "../world/TileData";
import { CargoRenderer } from "./CargoRenderer";
import { DiscoveryRenderer } from "./DiscoveryRenderer";
import { KnowledgeOverlayRenderer } from "./KnowledgeOverlayRenderer";
import { RiskOverlayRenderer } from "./RiskOverlayRenderer";
import { ShipRenderer } from "./ShipRenderer";
import { WreckRenderer } from "./WreckRenderer";
import { WorldRenderer } from "./WorldRenderer";

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
}

export interface PersistenceBootState {
  status: "new" | "loaded" | "recovered" | "unavailable" | "incompatible";
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

export class TideboundScene extends Phaser.Scene {
  readonly simulation: GameSimulation;

  private readonly clock = new SimulationClock();
  private readonly saveStore: SaveStore<unknown>;
  private readonly checkpointStore: SaveStore<unknown>;
  private readonly persistenceBoot: PersistenceBootState;
  private keys!: MovementKeys;
  private worldRenderer!: WorldRenderer;
  private knowledgeOverlay!: KnowledgeOverlayRenderer;
  private riskOverlay!: RiskOverlayRenderer;
  private cargoRenderer!: CargoRenderer;
  private discoveryRenderer!: DiscoveryRenderer;
  private shipRenderer!: ShipRenderer;
  private wreckRenderer!: WreckRenderer;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private domAbort?: AbortController;
  private readonly eventUnsubscribers: Array<() => void> = [];
  private gameHost?: HTMLElement;
  private gameStatus?: HTMLElement;
  private provisionOutput?: HTMLOutputElement;
  private persistenceOutput?: HTMLOutputElement;
  private discoveryOutput?: HTMLOutputElement;
  private teleportOnClick = false;
  private islandInspectionIndex = 0;
  private datasetGenerated?: GameSimulation["generated"];
  private lastDebugRevision = -1;
  private lastDebugOverlayRevision = -1;
  private lastDiagnosticsRevision = -1;
  private lastDiagnosticsOverlayRevision = -1;
  private lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
  private persistenceEnabled: boolean;
  private autosaveProtected: boolean;
  private persistenceStatus: PersistenceBootState["status"];
  private lastSavedRevision = -1;
  private lastSaveAt = Number.NEGATIVE_INFINITY;
  private saveInFlight?: Promise<boolean>;
  private saveQueued = false;
  private checkpointAvailable: boolean | undefined;
  private browserDebugApi?: BrowserDebugApi;
  private activeLifecycleCue?: Phaser.GameObjects.Text;
  private returnCueScheduled = false;
  private returnCuePending = false;
  private pendingReturnedDiscoveryNames: string[] = [];

  constructor(
    simulation = new GameSimulation(),
    saveStore: SaveStore<unknown>,
    checkpointStore: SaveStore<unknown>,
    persistenceBoot: PersistenceBootState,
  ) {
    super({ key: "TideboundScene" });
    this.simulation = simulation;
    this.saveStore = saveStore;
    this.checkpointStore = checkpointStore;
    this.persistenceBoot = persistenceBoot;
    this.persistenceEnabled = persistenceBoot.autosave;
    this.autosaveProtected = persistenceBoot.status === "incompatible";
    this.persistenceStatus = persistenceBoot.status;
    if (persistenceBoot.status === "loaded") this.lastSavedRevision = simulation.revision;
  }

  create(): void {
    this.worldRenderer = new WorldRenderer(this);
    this.wreckRenderer = new WreckRenderer(this);
    this.knowledgeOverlay = new KnowledgeOverlayRenderer(this);
    this.riskOverlay = new RiskOverlayRenderer(this);
    this.cargoRenderer = new CargoRenderer(this);
    this.discoveryRenderer = new DiscoveryRenderer(this);
    this.shipRenderer = new ShipRenderer(this);
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
    }) as MovementKeys;

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    this.cameras.main.startFollow(this.shipRenderer.container, true, 0.08, 0.08);
    this.configureCamera();
    this.renderWorld();
    this.eventUnsubscribers.push(onPrototypeConfigChanged((sections) => {
      if (sections.has("overlays")) this.simulation.refreshRiskOverlays();
    }));
    this.mountDeveloperTools();
    this.installBrowserDebugApi();
    this.bindSimulationEvents();
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
    if (Phaser.Input.Keyboard.JustDown(this.keys.zoomIn)) this.changeZoom(0.1);
    if (Phaser.Input.Keyboard.JustDown(this.keys.zoomOut)) this.changeZoom(-0.1);
    const movementInput = this.readMovementInput();
    let keepAdvancing = true;
    this.clock.advance(delta, (deltaSeconds) => {
      const lifecycleRevision = this.simulation.lifecycleResolutionRevision;
      this.simulation.update(movementInput, deltaSeconds);
      keepAdvancing = lifecycleRevision === this.simulation.lifecycleResolutionRevision;
      return keepAdvancing;
    });
    this.syncPresentation();
    this.maybeAutosave(time);
  }

  private readMovementInput(): MovementInput {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) {
      return { turn: 0, throttle: 0 };
    }

    const pressed = (primary: Phaser.Input.Keyboard.Key, alternate: Phaser.Input.Keyboard.Key): number =>
      primary.isDown || alternate.isDown ? 1 : 0;

    return {
      turn: pressed(this.keys.right, this.keys.alternateRight) - pressed(this.keys.left, this.keys.alternateLeft),
      throttle:
        pressed(this.keys.forward, this.keys.alternateForward) -
        pressed(this.keys.reverse, this.keys.alternateReverse),
    };
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
    this.shipRenderer.sync(this.simulation.ship, !this.simulation.wreckPresentationActive);
    this.wreckRenderer.sync(this.simulation.wrecks, this.simulation.world);
    this.discoveryRenderer.sync(this.simulation.discoveries);
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
    const diagnosticsDue = force
      || this.lastDiagnosticsRevision !== this.simulation.revision
      || this.lastDiagnosticsOverlayRevision !== this.simulation.overlaysRevision
      || this.time.now - this.lastDiagnosticsAt >= 100;
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
      host.dataset.successfulReturns = String(this.simulation.successfulReturns);
      host.dataset.failedExpeditions = String(this.simulation.failedExpeditions);
      host.dataset.atDock = String(this.simulation.atDock);
      host.dataset.wrecks = String(this.simulation.wrecks.length);
      host.dataset.discoveryProvisional = String(this.simulation.provisionalDiscoveries.length);
      host.dataset.discoveryReturned = String(this.simulation.returnedDiscoveries.length);
      host.dataset.persistenceStatus = this.persistenceStatus;
      host.dataset.wreckPresentation = String(this.simulation.wreckPresentationActive);
      host.dataset.respawnSeconds = this.simulation.respawnSecondsRemaining.toFixed(3);
      host.dataset.lifecyclePhase = this.simulation.wreckPresentationActive ? "wreck-hold" : "active";
      host.dataset.inputSuppressed = String(this.simulation.wreckPresentationActive);
      host.dataset.pendingWreckId = String(this.simulation.pendingWreckId ?? "");
      host.dataset.stranded = String(this.simulation.stranded);
      host.dataset.overlaysRevision = String(this.simulation.overlaysRevision);
      host.dataset.riskBudget = this.simulation.forwardRange.budget.toFixed(3);
      host.dataset.simulationRevision = String(this.simulation.revision);
      host.dataset.knowledgeVersion = String(this.simulation.world.knowledgeVersion);
      host.dataset.visibilityVersion = String(this.simulation.world.visibilityVersion);
    }
    if (document.documentElement.dataset.wayfindersReady !== "true") {
      document.documentElement.dataset.wayfindersReady = "true";
    }

    const debugChanged = force
      || this.lastDebugRevision !== this.simulation.revision
      || this.lastDebugOverlayRevision !== this.simulation.overlaysRevision;
    if (debugChanged) {
      this.renderDebug();
      this.lastDebugRevision = this.simulation.revision;
      this.lastDebugOverlayRevision = this.simulation.overlaysRevision;
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
      this.lastDiagnosticsAt = this.time.now;
    }
    if (diagnosticsDue && this.gameStatus) {
      const message = this.simulation.wreckPresentationActive
        ? `Ship wrecked · next generation departs in ${this.simulation.respawnSecondsRemaining.toFixed(1)}s`
        : this.simulation.stranded
        ? "Developer zero-cargo state · add a bundle or force a wreck"
        : this.simulation.expeditionActive
        ? "Expedition underway · return to the home dock to secure the route"
        : "WASD / arrows sail · wheel or Q/E zoom · Developer tools tune";
      if (this.gameStatus.textContent !== message) this.gameStatus.textContent = message;
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.teleportOnClick) return;
    if (this.simulation.wreckPresentationActive) {
      this.log("Teleport is unavailable during the wreck presentation.");
      return;
    }
    const tile = worldToGrid(pointer.worldX, pointer.worldY);
    if (this.simulation.teleport(tile)) {
      this.teleportOnClick = false;
      this.updateTeleportButton();
      this.log(`Teleported to ${tile.x}, ${tile.y}.`);
    } else {
      this.log(`Tile ${tile.x}, ${tile.y} is blocked or outside the world.`);
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
    this.domAbort?.abort();
    this.domAbort = new AbortController();
    const signal = this.domAbort.signal;

    slot.innerHTML = `
      <div class="sandbox-tools">
        <fieldset>
          <legend>World and ship</legend>
          <label>Seed <input data-field="seed" type="number" step="1" value="${this.simulation.generated.seed}"></label>
          <button data-action="regenerate" type="button">Regenerate current seed</button>
          <button data-action="inspect-island" type="button">Inspect next island</button>
          <div class="tool-row">
            <button data-action="teleport-click" type="button" aria-pressed="false">Teleport by clicking</button>
            <label>X <input data-field="teleport-x" type="number" step="1" value="${this.simulation.ship.currentTileX}"></label>
            <label>Y <input data-field="teleport-y" type="number" step="1" value="${this.simulation.ship.currentTileY}"></label>
            <button data-action="teleport-coordinates" type="button">Go</button>
          </div>
          <div class="tool-row tool-row--buttons">
            <button data-action="provisions-remove" type="button">− bundle</button>
            <output data-output="provisions">${this.simulation.ship.provisions} developer bundles</output>
            <button data-action="provisions-add" type="button">+ bundle</button>
            <button data-action="force-wreck" type="button">Force wreck</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Save and discoveries</legend>
          <div class="tool-row tool-row--buttons">
            <button data-action="save-checkpoint" type="button">Save checkpoint</button>
            <button data-action="load-checkpoint" type="button">Load checkpoint</button>
            <button data-action="clear-save" type="button">Clear saves</button>
          </div>
          <output data-output="persistence">${this.persistenceSummary()}</output>
          <output data-output="discoveries">${this.discoverySummary()}</output>
        </fieldset>
        <fieldset>
          <legend>Debug views</legend>
          ${this.toggleMarkup("navigationGrid", "Navigation grid")}
          ${this.toggleMarkup("currentSight", "Current line of sight")}
          ${this.toggleMarkup("forwardRange", "Forward exploration range")}
          ${this.toggleMarkup("returnViability", "Return viability")}
        </fieldset>
        <fieldset>
          <legend>Live gameplay tuning</legend>
          ${this.numberMarkup("sight-radius", "Sight radius", prototypeConfig.navigation.sightRadius, 1, 14, 1)}
          ${this.numberMarkup("starting-bundles", "Starting bundles", prototypeConfig.provisions.startingBundles, 1, 24, 1)}
          ${this.numberMarkup("supported-cost", "Supported cost", prototypeConfig.provisions.supportedCost, 0, 3, 0.1)}
          ${this.numberMarkup("personal-cost", "Personal cost", prototypeConfig.provisions.personalCost, 0, 3, 0.1)}
          ${this.numberMarkup("unknown-cost", "Unknown cost", prototypeConfig.provisions.unknownCost, 0.1, 4, 0.1)}
          ${this.numberMarkup("ship-speed", "Ship speed (tiles/s)", prototypeConfig.movement.shipSpeed, 0.5, 8, 0.1)}
          ${this.numberMarkup("risk-comfortable", "Comfortable margin", prototypeConfig.returnRisk.comfortable, 0, 12, 0.5)}
          ${this.numberMarkup("risk-warning", "Warning margin", prototypeConfig.returnRisk.warning, 0, 8, 0.5)}
          ${this.numberMarkup("risk-critical", "Critical margin", prototypeConfig.returnRisk.critical, 0, 4, 0.5)}
          ${this.numberMarkup("forward-cone-half-angle", "Forward cone half-angle", prototypeConfig.overlays.forwardConeHalfAngleDegrees, 1, 180, 5)}
          ${this.numberMarkup("unknown-cleanup-limit", "Returned Unknown cleanup", prototypeConfig.world.maxEnclosedUnknownTiles, 0, 8, 1)}
          ${this.numberMarkup("return-path-padding", "Return route padding", prototypeConfig.overlays.returnPathPadding, 0, 4, 1)}
          ${this.numberMarkup("forward-opacity", "Forward opacity", prototypeConfig.overlays.forwardOverlayOpacity, 0, 1, 0.05)}
          ${this.numberMarkup("return-opacity", "Return opacity", prototypeConfig.overlays.returnOverlayOpacity, 0, 1, 0.05)}
          ${this.numberMarkup("fog-blend", "Fog transition width", prototypeConfig.overlays.fogBlend, 0, 1, 0.02)}
          ${this.numberMarkup("fog-noise", "Fog noise strength", prototypeConfig.overlays.fogNoise, 0, 1, 0.02)}
        </fieldset>
      </div>`;

    this.provisionOutput = slot.querySelector<HTMLOutputElement>("[data-output='provisions']") ?? undefined;
    this.persistenceOutput = slot.querySelector<HTMLOutputElement>("[data-output='persistence']") ?? undefined;
    this.discoveryOutput = slot.querySelector<HTMLOutputElement>("[data-output='discoveries']") ?? undefined;

    slot.querySelectorAll<HTMLInputElement>("input[data-overlay]").forEach((input) => {
      input.addEventListener("change", () => {
        const name = input.dataset.overlay as keyof GameSimulation["debug"];
        this.simulation.setDebugVisibility(name, input.checked);
      }, { signal });
    });
    slot.querySelectorAll<HTMLInputElement>("input[data-config]").forEach((input) => {
      input.addEventListener("input", () => this.applyLiveConfig(input.dataset.config ?? "", input.valueAsNumber), { signal });
    });
    slot.querySelector<HTMLButtonElement>("[data-action='regenerate']")?.addEventListener("click", () => {
      const seed = this.field("seed").valueAsNumber;
      this.simulation.regenerate(seed);
      this.afterWorldChanged();
      this.log(`Regenerated deterministic world from seed ${this.simulation.generated.seed}.`);
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='teleport-click']")?.addEventListener("click", () => {
      this.teleportOnClick = !this.teleportOnClick;
      this.updateTeleportButton();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='inspect-island']")?.addEventListener("click", () => {
      this.inspectNextIsland();
    }, { signal });
    slot.querySelector<HTMLButtonElement>("[data-action='teleport-coordinates']")?.addEventListener("click", () => {
      if (this.simulation.wreckPresentationActive) {
        this.log("Teleport is unavailable during the wreck presentation.");
        return;
      }
      const x = Math.trunc(this.field("teleport-x").valueAsNumber);
      const y = Math.trunc(this.field("teleport-y").valueAsNumber);
      if (!this.simulation.teleport({ x, y })) this.log(`Tile ${x}, ${y} is blocked or outside the world.`);
      else this.log(`Teleported to ${x}, ${y}.`);
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
      if (this.simulation.wreckPresentationActive) this.log("The wreck presentation is already in progress.");
      else if (!this.forceWreckForTesting()) this.log("Move outside Supported water before forcing a wreck.");
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
  }

  private toggleMarkup(name: keyof GameSimulation["debug"], label: string): string {
    return `<label class="tool-check"><input data-overlay="${name}" type="checkbox" ${this.simulation.debug[name] ? "checked" : ""}> ${label}</label>`;
  }

  private numberMarkup(id: string, label: string, value: number, min: number, max: number, step: number): string {
    return `<label class="tool-number"><span>${label}</span><input data-config="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  }

  private applyLiveConfig(id: string, value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.simulation.wreckPresentationActive) {
      this.log("Live gameplay tuning is paused during the wreck presentation.");
      return;
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
    if (!patch) return;
    try {
      patchPrototypeConfig(patch);
      if (id === "sight-radius") this.simulation.refreshVisibility();
      else if (id === "starting-bundles") {
        this.simulation.setProvisions(value);
        this.updateProvisionOutput();
      }
      else if ([
        "supported-cost",
        "personal-cost",
        "unknown-cost",
        "risk-comfortable",
        "risk-warning",
        "risk-critical",
      ].includes(id)) this.simulation.refreshRiskOverlays();
      else this.simulation.revision++;
    } catch (error) {
      this.log(error instanceof Error ? error.message : "Configuration value was rejected.");
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
      this.provisionOutput.value = `${this.simulation.ship.provisions} developer bundles`;
    }
    this.updatePersistenceOutputs();
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

  private discoverySummary(): string {
    return `Discoveries: ${this.simulation.provisionalDiscoveries.length} provisional · `
      + `${this.simulation.returnedDiscoveries.length} returned`;
  }

  private updatePersistenceOutputs(): void {
    if (this.persistenceOutput) this.persistenceOutput.value = this.persistenceSummary();
    if (this.discoveryOutput) this.discoveryOutput.value = this.discoverySummary();
  }

  private maybeAutosave(time: number): void {
    if (!this.persistenceEnabled || this.lastSavedRevision === this.simulation.revision) return;
    if (this.saveInFlight) return;
    if (time - this.lastSaveAt < 750) return;
    void this.saveNow(false);
  }

  private saveNow(reportSuccess: boolean): Promise<boolean> {
    if (!this.persistenceEnabled) {
      if (reportSuccess) this.log("Browser saving is unavailable for this session.");
      this.updatePersistenceOutputs();
      return Promise.resolve(false);
    }
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
        const revision = this.simulation.revision;
        await this.saveStore.save(this.simulation.createSave());
        this.lastSavedRevision = revision;
        this.lastSaveAt = this.time.now;
      } while (this.saveQueued);
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
      this.checkpointAvailable = await this.checkpointStore.load() !== undefined;
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
    try {
      const value = await this.checkpointStore.load();
      if (value === undefined) {
        this.checkpointAvailable = false;
        this.updatePersistenceOutputs();
        this.log("No manual checkpoint exists yet. Use Save checkpoint first.");
        return false;
      }
      if (this.saveInFlight) await this.saveInFlight;
      this.simulation.restoreSave(value);
      this.checkpointAvailable = true;
      if (!this.autosaveProtected) {
        this.persistenceEnabled = true;
        this.persistenceStatus = "loaded";
        // The loaded checkpoint becomes the new rolling autosave baseline so
        // a subsequent page reload resumes from the restored state.
        this.lastSavedRevision = -1;
      }
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
      if (!this.autosaveProtected) await this.saveNow(false);
      return true;
    } catch (error) {
      this.log(`Load failed without changing the running world: ${error instanceof Error ? error.message : "invalid save"}`);
      return false;
    }
  }

  private async clearSaveFromStore(): Promise<boolean> {
    try {
      await Promise.all([this.saveStore.clear(), this.checkpointStore.clear()]);
      this.persistenceEnabled = true;
      this.autosaveProtected = false;
      this.persistenceStatus = "new";
      this.checkpointAvailable = false;
      this.lastSavedRevision = this.simulation.revision;
      this.updatePersistenceOutputs();
      this.log("Cleared the browser autosave and manual checkpoint. The running world was not reset.");
      return true;
    } catch (error) {
      this.log(`Could not clear browser storage: ${error instanceof Error ? error.message : "storage error"}`);
      return false;
    }
  }

  private requestLifecycleSave(): void {
    queueMicrotask(() => void this.saveNow(false));
  }

  private afterWorldChanged(): void {
    this.islandInspectionIndex = 0;
    this.renderWorld();
    this.configureCamera();
    this.lastDebugRevision = -1;
    this.lastDebugOverlayRevision = -1;
    this.lastDiagnosticsRevision = -1;
    this.lastDiagnosticsOverlayRevision = -1;
    this.lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
    this.updateProvisionOutput();
    this.syncPresentation(true);
    // Camera follow deliberately uses smoothing during play. A restored or
    // regenerated world is a discontinuity, so snap to the authoritative ship
    // before smooth following resumes.
    this.cameras.main.centerOn(this.simulation.ship.worldX, this.simulation.ship.worldY);
  }

  private inspectNextIsland(): void {
    if (this.simulation.wreckPresentationActive) {
      this.log("Island inspection is unavailable during the wreck presentation.");
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
    if (!tile || !this.simulation.teleport(tile)) {
      this.log(`Could not find a passable inspection point for island ${island.id}.`);
      return;
    }
    this.log(`Inspecting ${island.size} ${island.kind} ${island.id} from ${tile.x}, ${tile.y}.`);
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
    };
    this.browserDebugApi = api;
    window.__WAYFINDERS__ = api;
  }

  private log(message: string): void {
    const log = document.querySelector<HTMLDivElement>("#developer-log");
    if (!log) return;
    const entry = document.createElement("p");
    entry.textContent = message;
    log.append(entry);
    log.scrollTop = log.scrollHeight;
  }

  private forceWreckForTesting(): boolean {
    const started = this.simulation.forceWreck();
    if (started) this.clock.reset();
    this.updateProvisionOutput();
    return started;
  }

  private bindSimulationEvents(): void {
    this.eventUnsubscribers.push(
      this.simulation.events.on("expeditionReturned", ({ supportedTileCount, closedUnknownTileCount }) => {
        this.renderWorld();
        this.returnCuePending = true;
        this.scheduleReturnCue();
        this.log(
          `Expedition returned: ${supportedTileCount} Personal tiles and ${closedUnknownTileCount} enclosed Unknown tiles became Supported.`,
        );
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("shipWrecked", ({ generation }) => {
        const holdMs = Math.max(0, this.simulation.config.simulation.wreckPresentationSeconds * 1000 - 480);
        this.showLifecycleCue(
          `SHIP LOST AT SEA\nWRECK OF GENERATION ${generation} REMAINS`,
          "#ffd2aa",
          holdMs,
        );
        this.log(
          `Generation ${generation}'s ship was wrecked; respawn begins in `
          + `${this.simulation.config.simulation.wreckPresentationSeconds} seconds.`,
        );
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("expeditionFailed", ({ generation, nextGeneration, forgottenTiles }) => {
        this.cameras.main.centerOn(this.simulation.ship.worldX, this.simulation.ship.worldY);
        this.showLifecycleCue(
          `GENERATION ${nextGeneration} DEPARTS\nNEW SHIP AT HOME`,
          "#ffd2aa",
        );
        this.log(
          `Generation ${generation} lost ${forgottenTiles} unreturned tiles; generation ${nextGeneration} departed.`,
        );
        this.requestLifecycleSave();
      }),
      this.simulation.events.on("shipReplenished", ({ reason }) => {
        if (reason !== "dock") return;
        this.showLifecycleCue("DOCKED\nPROVISIONS REPLENISHED", "#d9fff5");
        this.log("Dock stores replenished the ship's provisions.");
      }),
      this.simulation.events.on("wreckDiscovered", ({ wreckId, generation }) => {
        this.log(`Found wreck ${wreckId} from generation ${generation}.`);
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
      this.simulation.events.on("discoveriesReturned", ({ discoveries }) => {
        const names = discoveries.map(({ name }) => name).join(", ");
        this.pendingReturnedDiscoveryNames.push(...discoveries.map(({ name }) => name));
        this.scheduleReturnCue();
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
    );
  }

  private scheduleReturnCue(): void {
    if (this.returnCueScheduled) return;
    this.returnCueScheduled = true;
    queueMicrotask(() => {
      this.returnCueScheduled = false;
      const names = this.pendingReturnedDiscoveryNames.splice(0);
      const returned = this.returnCuePending;
      this.returnCuePending = false;
      if (!returned && names.length === 0) return;

      if (names.length > 0) {
        const discoveryLine = names.length === 1
          ? names[0].toUpperCase()
          : `${names.length} DISCOVERIES RETURNED`;
        this.showLifecycleCue(
          `EXPEDITION RETURNED\n${discoveryLine}\nADDED TO THE INHERITED CHART\nROUTE SUPPORTED · PROVISIONS REPLENISHED`,
          "#eadb9f",
          5_000,
        );
      } else {
        this.showLifecycleCue(
          "EXPEDITION RETURNED\nROUTE NOW SUPPORTED\nPROVISIONS REPLENISHED",
          "#d9fff5",
          3_500,
        );
      }
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

  private destroyBindings(): void {
    this.domAbort?.abort();
    this.gameHost = undefined;
    this.gameStatus = undefined;
    this.provisionOutput = undefined;
    this.persistenceOutput = undefined;
    this.discoveryOutput = undefined;
    for (const unsubscribe of this.eventUnsubscribers.splice(0)) unsubscribe();
    this.knowledgeOverlay.destroy();
    this.riskOverlay.destroy();
    this.cargoRenderer.destroy();
    this.discoveryRenderer.destroy();
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
    if (this.lastSavedRevision !== this.simulation.revision) void this.saveNow(false);
  };

  private readonly onVisibilityChange = (): void => {
    if (
      document.visibilityState === "hidden"
      && this.lastSavedRevision !== this.simulation.revision
    ) void this.saveNow(false);
  };
}
