import Phaser from "phaser";
import {
  patchPrototypeConfig,
  prototypeConfig,
  type DeepPartial,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { GameSimulation } from "../core/GameSimulation";
import { SimulationClock } from "../core/SimulationClock";
import type { MovementInput } from "../core/types";
import { worldToGrid } from "../world/CoordinateSystem";
import { ShipRenderer } from "./ShipRenderer";
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
  regenerate: (seed?: number) => ReturnType<GameSimulation["snapshot"]>;
  setOverlay: (name: keyof GameSimulation["debug"], visible: boolean) => void;
}

declare global {
  interface Window {
    __WAYFINDERS__?: BrowserDebugApi;
  }
}

const PALETTE = {
  grid: 0xa5d5d2,
  sight: 0x78fff0,
  forward: 0xd8e1d6,
  returnRange: 0xf7c653,
} as const;

export class TideboundScene extends Phaser.Scene {
  readonly simulation = new GameSimulation();

  private readonly clock = new SimulationClock();
  private keys!: MovementKeys;
  private worldRenderer!: WorldRenderer;
  private shipRenderer!: ShipRenderer;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private domAbort?: AbortController;
  private teleportOnClick = false;
  private lastRenderedRevision = -1;

  constructor() {
    super({ key: "TideboundScene" });
  }

  create(): void {
    this.worldRenderer = new WorldRenderer(this);
    this.shipRenderer = new ShipRenderer(this);
    this.gridGraphics = this.add.graphics().setDepth(20);
    this.debugGraphics = this.add.graphics().setDepth(30);

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
    this.mountDeveloperTools();
    this.installBrowserDebugApi();
    this.syncPresentation(true);

    const sceneStatus = document.querySelector<HTMLElement>("#scene-status");
    if (sceneStatus) sceneStatus.textContent = "Exploration sandbox active";
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "WASD / arrows sail · wheel or Q/E zoom · Developer tools tune";

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyBindings());
  }

  override update(_time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.zoomIn)) this.changeZoom(0.1);
    if (Phaser.Input.Keyboard.JustDown(this.keys.zoomOut)) this.changeZoom(-0.1);
    const movementInput = this.readMovementInput();
    this.clock.advance(delta, (deltaSeconds) => this.simulation.update(movementInput, deltaSeconds));
    this.syncPresentation();
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
      this.debugGraphics.lineStyle(3, PALETTE.sight, 0.72);
      this.debugGraphics.strokeCircle(
        this.simulation.ship.worldX,
        this.simulation.ship.worldY,
        prototypeConfig.navigation.sightRadius * size,
      );
    }

    const remaining = Math.max(0, this.simulation.ship.provisions - this.simulation.ship.provisionAccumulator);
    if (this.simulation.debug.forwardRange && prototypeConfig.provisions.unknownCost > 0) {
      this.debugGraphics.lineStyle(3, PALETTE.forward, 0.5);
      this.debugGraphics.strokeCircle(
        this.simulation.ship.worldX,
        this.simulation.ship.worldY,
        remaining / prototypeConfig.provisions.unknownCost * size,
      );
    }
    if (this.simulation.debug.returnViability && prototypeConfig.provisions.personalCost > 0) {
      this.debugGraphics.lineStyle(2, PALETTE.returnRange, 0.42);
      this.debugGraphics.strokeCircle(
        this.simulation.ship.worldX,
        this.simulation.ship.worldY,
        remaining / prototypeConfig.provisions.personalCost * size,
      );
    }
  }

  private syncPresentation(force = false): void {
    this.shipRenderer.sync(this.simulation.ship);
    const host = document.querySelector<HTMLElement>("#game-host");
    if (host) {
      host.dataset.seed = String(this.simulation.generated.seed);
      host.dataset.tileX = String(this.simulation.ship.currentTileX);
      host.dataset.tileY = String(this.simulation.ship.currentTileY);
      host.dataset.provisions = String(this.simulation.ship.provisions);
      host.dataset.simulationRevision = String(this.simulation.revision);
    }
    document.documentElement.dataset.wayfindersReady = "true";
    if (force || this.lastRenderedRevision !== this.simulation.revision) {
      this.renderDebug();
      this.lastRenderedRevision = this.simulation.revision;
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.teleportOnClick) return;
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
          </div>
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
          ${this.numberMarkup("risk-critical", "Critical margin", prototypeConfig.returnRisk.critical, -4, 4, 0.5)}
          ${this.numberMarkup("forward-opacity", "Forward opacity", prototypeConfig.overlays.forwardOverlayOpacity, 0, 1, 0.05)}
          ${this.numberMarkup("return-opacity", "Return opacity", prototypeConfig.overlays.returnOverlayOpacity, 0, 1, 0.05)}
          ${this.numberMarkup("fog-blend", "Fog transition width", prototypeConfig.overlays.fogBlend, 0, 1, 0.02)}
          ${this.numberMarkup("fog-noise", "Fog noise strength", prototypeConfig.overlays.fogNoise, 0, 1, 0.02)}
        </fieldset>
      </div>`;

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
    slot.querySelector<HTMLButtonElement>("[data-action='teleport-coordinates']")?.addEventListener("click", () => {
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
  }

  private toggleMarkup(name: keyof GameSimulation["debug"], label: string): string {
    return `<label class="tool-check"><input data-overlay="${name}" type="checkbox" ${this.simulation.debug[name] ? "checked" : ""}> ${label}</label>`;
  }

  private numberMarkup(id: string, label: string, value: number, min: number, max: number, step: number): string {
    return `<label class="tool-number"><span>${label}</span><input data-config="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  }

  private applyLiveConfig(id: string, value: number): void {
    if (!Number.isFinite(value)) return;
    let patch: DeepPartial<PrototypeConfig> | undefined;
    switch (id) {
      case "sight-radius": patch = { navigation: { sightRadius: value } }; break;
      case "starting-bundles":
        patch = { provisions: { startingBundles: value } };
        this.simulation.setProvisions(value);
        this.updateProvisionOutput();
        break;
      case "supported-cost": patch = { provisions: { supportedCost: value } }; break;
      case "personal-cost": patch = { provisions: { personalCost: value } }; break;
      case "unknown-cost": patch = { provisions: { unknownCost: value } }; break;
      case "ship-speed": patch = { movement: { shipSpeed: value } }; break;
      case "risk-comfortable": patch = { returnRisk: { comfortable: value } }; break;
      case "risk-warning": patch = { returnRisk: { warning: value } }; break;
      case "risk-critical": patch = { returnRisk: { critical: value } }; break;
      case "forward-opacity": patch = { overlays: { forwardOverlayOpacity: value } }; break;
      case "return-opacity": patch = { overlays: { returnOverlayOpacity: value } }; break;
      case "fog-blend": patch = { overlays: { fogBlend: value } }; break;
      case "fog-noise": patch = { overlays: { fogNoise: value } }; break;
    }
    if (!patch) return;
    try {
      patchPrototypeConfig(patch);
      this.simulation.revision++;
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
    const output = document.querySelector<HTMLOutputElement>("#scene-tools-slot [data-output='provisions']");
    if (output) output.value = `${this.simulation.ship.provisions} developer bundles`;
  }

  private afterWorldChanged(): void {
    this.renderWorld();
    this.configureCamera();
    this.lastRenderedRevision = -1;
    this.updateProvisionOutput();
    this.syncPresentation(true);
  }

  private installBrowserDebugApi(): void {
    window.__WAYFINDERS__ = {
      snapshot: () => this.simulation.snapshot(),
      teleport: (x, y) => this.simulation.teleport({ x: Math.trunc(x), y: Math.trunc(y) }),
      addProvisions: (delta) => {
        this.simulation.addProvisions(delta);
        this.updateProvisionOutput();
        return this.simulation.snapshot();
      },
      regenerate: (seed) => {
        this.simulation.regenerate(seed);
        this.afterWorldChanged();
        return this.simulation.snapshot();
      },
      setOverlay: (name, visible) => this.simulation.setDebugVisibility(name, visible),
    };
  }

  private log(message: string): void {
    const log = document.querySelector<HTMLDivElement>("#developer-log");
    if (!log) return;
    const entry = document.createElement("p");
    entry.textContent = message;
    log.append(entry);
    log.scrollTop = log.scrollHeight;
  }

  private destroyBindings(): void {
    this.domAbort?.abort();
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this);
    if (window.__WAYFINDERS__?.snapshot().seed === this.simulation.generated.seed) delete window.__WAYFINDERS__;
  }
}
