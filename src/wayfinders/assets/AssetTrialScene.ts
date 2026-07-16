import Phaser from "phaser";
import type { MovementInput, ShipState } from "../core/types";
import { MovementSystem, createShipStateAtGrid } from "../navigation/MovementSystem";
import { ShipRenderer } from "../rendering/ShipRenderer";
import {
  COLLISION_SUBCELL_SIZE,
  COLLISION_SUBCELLS_PER_TILE,
  isCollisionSubcellSolid,
} from "../world/CollisionMask";
import { assetLibraryEntryById, type ProductionCandidateLibraryEntry } from "./AssetLibraryCatalog";
import { applicationModeHref, type AssetTrialApplicationRequest } from "./AssetAppMode";
import { preloadPilotAssetPackages } from "./PilotAssetCatalog";
import { createPilotAssetRuntime } from "./PilotAssetRuntime";
import {
  createProductionAssetTrial,
  type ProductionAssetTrial,
  type ProductionAssetTrialBoatPosition,
} from "./ProductionAssetTrial";
import { PRODUCTION_ASSET_LIBRARY_SELECTION_KEY } from "./ProductionAssetIntakeUi";

interface AssetTrialKeys {
  readonly left: Phaser.Input.Keyboard.Key;
  readonly right: Phaser.Input.Keyboard.Key;
  readonly forward: Phaser.Input.Keyboard.Key;
  readonly reverse: Phaser.Input.Keyboard.Key;
  readonly alternateLeft: Phaser.Input.Keyboard.Key;
  readonly alternateRight: Phaser.Input.Keyboard.Key;
  readonly alternateForward: Phaser.Input.Keyboard.Key;
  readonly alternateReverse: Phaser.Input.Keyboard.Key;
}

interface AssetTrialDebugApi {
  snapshot(): Readonly<{
    candidateId: string;
    fingerprint: string;
    collisionRevision: string;
    ship: Readonly<ShipState>;
    worldContent: readonly ["open-water", "player-boat", "candidate-island"];
  }>;
  reset(position?: ProductionAssetTrialBoatPosition["id"]): void;
}

declare global {
  interface Window {
    __WAYFINDERS_ASSET_TRIAL__?: AssetTrialDebugApi;
  }
}

const FIXED_STEP_SECONDS = 1 / 60;
const MAXIMUM_STEPS_PER_FRAME = 5;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function blendMode(mode: ProductionCandidateLibraryEntry["candidateLayers"][number]["blendMode"]): number {
  switch (mode) {
    case "multiply": return Phaser.BlendModes.MULTIPLY;
    case "screen": return Phaser.BlendModes.SCREEN;
    case "add": return Phaser.BlendModes.ADD;
    case "normal": return Phaser.BlendModes.NORMAL;
  }
}

/** Disposable candidate-only navigation scene; it never creates GameSimulation. */
export class AssetTrialScene extends Phaser.Scene {
  private readonly candidate: Readonly<ProductionCandidateLibraryEntry>;
  private readonly textureKeys = new Map<string, string>();
  private readonly trial: Readonly<ProductionAssetTrial>;
  private movement!: MovementSystem;
  private ship!: ShipState;
  private shipRenderer!: ShipRenderer;
  private keys?: Readonly<AssetTrialKeys>;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private collisionGraphics!: Phaser.GameObjects.Graphics;
  private accumulatorSeconds = 0;
  private resetIndex = 0;
  private controlsAbort?: AbortController;

  constructor(private readonly request: Readonly<AssetTrialApplicationRequest>) {
    super("AssetTrialScene");
    const entry = assetLibraryEntryById(request.candidateId);
    if (!entry || entry.entryType !== "production-candidate") {
      throw new RangeError(`Unknown production candidate ${request.candidateId}`);
    }
    this.candidate = entry;
    sessionStorage.setItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY, entry.id);
    this.trial = createProductionAssetTrial(entry, request.candidateFingerprint);
  }

  preload(): void {
    preloadPilotAssetPackages(this);
    for (const [index, layer] of this.candidate.candidateLayers.entries()) {
      const key = `wayfinders:asset-trial:${this.candidate.id}:${this.request.candidateFingerprint}:${index}`;
      this.textureKeys.set(layer.id, key);
      this.load.image(key, layer.url);
    }
  }

  create(): void {
    this.movement = new MovementSystem(this.trial.world);
    this.ship = createShipStateAtGrid(this.trial.spawn.tile, 0, this.trial.spawn.heading);

    this.add.rectangle(
      0,
      0,
      this.trial.worldPixelSize.width,
      this.trial.worldPixelSize.height,
      0x0b5970,
    ).setOrigin(0).setDepth(-20);
    this.add.rectangle(
      0,
      0,
      this.trial.worldPixelSize.width,
      this.trial.worldPixelSize.height,
      0x4ec5dc,
      0.08,
    ).setOrigin(0).setDepth(-19);

    for (const [index, layer] of [...this.trial.layers].sort((left, right) => left.order - right.order).entries()) {
      const key = this.textureKeys.get(layer.id);
      if (!key) throw new RangeError(`Trial texture for ${layer.id} was not prepared`);
      this.add.image(this.trial.island.origin.worldX, this.trial.island.origin.worldY, key)
        .setDepth(10 + index * 0.01)
        .setVisible(layer.defaultVisible)
        .setAlpha(layer.opacity)
        .setBlendMode(blendMode(layer.blendMode));
    }

    this.gridGraphics = this.add.graphics().setDepth(30);
    this.collisionGraphics = this.add.graphics().setDepth(31);
    this.drawGridAndCollision();
    this.shipRenderer = new ShipRenderer(this, createPilotAssetRuntime(this));
    this.shipRenderer.sync(this.ship);

    this.keys = this.input.keyboard?.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      forward: Phaser.Input.Keyboard.KeyCodes.W,
      reverse: Phaser.Input.Keyboard.KeyCodes.S,
      alternateLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      alternateRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      alternateForward: Phaser.Input.Keyboard.KeyCodes.UP,
      alternateReverse: Phaser.Input.Keyboard.KeyCodes.DOWN,
    }, false) as AssetTrialKeys | undefined;
    this.cameras.main.setBounds(0, 0, this.trial.worldPixelSize.width, this.trial.worldPixelSize.height);
    this.fitTrial();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitTrial, this);
    this.mountControls();
    this.installDebugApi();
    const sceneStatus = document.querySelector<HTMLElement>("#scene-status");
    if (sceneStatus) sceneStatus.textContent = "Isolated asset sea trial";
    const status = document.querySelector<HTMLElement>("#game-status");
    if (status) status.textContent = "Sea trial · WASD or arrows sail · candidate collision is authoritative";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  override update(_time: number, deltaMilliseconds: number): void {
    const input = this.movementInput();
    this.accumulatorSeconds = Math.min(
      this.accumulatorSeconds + Math.max(0, deltaMilliseconds) / 1_000,
      FIXED_STEP_SECONDS * MAXIMUM_STEPS_PER_FRAME,
    );
    let steps = 0;
    while (this.accumulatorSeconds >= FIXED_STEP_SECONDS && steps < MAXIMUM_STEPS_PER_FRAME) {
      this.movement.update(this.ship, input, FIXED_STEP_SECONDS);
      this.accumulatorSeconds -= FIXED_STEP_SECONDS;
      steps++;
    }
    this.shipRenderer.sync(this.ship);
  }

  private movementInput(): Readonly<MovementInput> {
    if (!this.keys) return Object.freeze({ turn: 0, throttle: 0 });
    return Object.freeze({
      turn: Number(this.keys.right.isDown || this.keys.alternateRight.isDown)
        - Number(this.keys.left.isDown || this.keys.alternateLeft.isDown),
      throttle: Number(this.keys.forward.isDown || this.keys.alternateForward.isDown)
        - Number(this.keys.reverse.isDown || this.keys.alternateReverse.isDown),
    });
  }

  private drawGridAndCollision(): void {
    const grid = this.gridGraphics.clear();
    const collision = this.collisionGraphics.clear();
    const { island, collisionDraft } = this.trial;
    grid.lineStyle(1, 0xb9eff5, 0.16);
    for (let x = 0; x <= collisionDraft.grid.subcellColumns; x++) {
      const worldX = island.topLeftWorldX + x * COLLISION_SUBCELL_SIZE;
      grid.lineBetween(worldX, island.topLeftWorldY, worldX, island.topLeftWorldY + island.pixelHeight);
    }
    for (let y = 0; y <= collisionDraft.grid.subcellRows; y++) {
      const worldY = island.topLeftWorldY + y * COLLISION_SUBCELL_SIZE;
      grid.lineBetween(island.topLeftWorldX, worldY, island.topLeftWorldX + island.pixelWidth, worldY);
    }
    grid.lineStyle(2, 0x6cf0a5, 0.68);
    for (let x = 0; x <= collisionDraft.grid.width; x++) {
      const worldX = island.topLeftWorldX + x * collisionDraft.tileSize;
      grid.lineBetween(worldX, island.topLeftWorldY, worldX, island.topLeftWorldY + island.pixelHeight);
    }
    for (let y = 0; y <= collisionDraft.grid.height; y++) {
      const worldY = island.topLeftWorldY + y * collisionDraft.tileSize;
      grid.lineBetween(island.topLeftWorldX, worldY, island.topLeftWorldX + island.pixelWidth, worldY);
    }
    grid.lineStyle(2, 0xffd47a, 0.95);
    grid.lineBetween(island.origin.worldX - 12, island.origin.worldY, island.origin.worldX + 12, island.origin.worldY);
    grid.lineBetween(island.origin.worldX, island.origin.worldY - 12, island.origin.worldX, island.origin.worldY + 12);

    collision.fillStyle(0xff4e4e, 0.34);
    for (let cellY = 0; cellY < collisionDraft.grid.height; cellY++) {
      for (let cellX = 0; cellX < collisionDraft.grid.width; cellX++) {
        const mask = this.trial.world.getFineCollisionMask(island.tileX + cellX, island.tileY + cellY) ?? 0;
        for (let subY = 0; subY < COLLISION_SUBCELLS_PER_TILE; subY++) {
          for (let subX = 0; subX < COLLISION_SUBCELLS_PER_TILE; subX++) {
            if (!isCollisionSubcellSolid(mask, subX, subY)) continue;
            collision.fillRect(
              island.topLeftWorldX + (cellX * COLLISION_SUBCELLS_PER_TILE + subX) * COLLISION_SUBCELL_SIZE,
              island.topLeftWorldY + (cellY * COLLISION_SUBCELLS_PER_TILE + subY) * COLLISION_SUBCELL_SIZE,
              COLLISION_SUBCELL_SIZE,
              COLLISION_SUBCELL_SIZE,
            );
          }
        }
      }
    }
  }

  private mountControls(): void {
    this.controlsAbort?.abort();
    this.controlsAbort = new AbortController();
    const signal = this.controlsAbort.signal;
    const slot = document.querySelector<HTMLDivElement>("#scene-tools-slot");
    if (!slot) return;
    const fingerprint = this.trial.candidateFingerprint;
    slot.innerHTML = `
      <section class="asset-trial-controls" aria-labelledby="asset-trial-title">
        <p class="eyebrow">GR-3.8 disposable world</p>
        <h3 id="asset-trial-title">${escapeHtml(this.candidate.name)}</h3>
        <dl>
          <div><dt>Fingerprint</dt><dd><code>${escapeHtml(fingerprint)}</code></dd></div>
          <div><dt>Dimensions</dt><dd>${this.trial.island.pixelWidth}\u00d7${this.trial.island.pixelHeight} px</dd></div>
          <div><dt>Origin</dt><dd>center · ${this.trial.island.origin.worldX}, ${this.trial.island.origin.worldY}</dd></div>
          <div><dt>Collision revision</dt><dd><code>${escapeHtml(this.trial.candidateFingerprint)}</code></dd></div>
          <div><dt>Review</dt><dd>${escapeHtml(this.trial.reviewState)}</dd></div>
        </dl>
        <p>Only open water, the player boat, and this candidate island exist in the trial.</p>
        <div class="tool-actions">
          <button type="button" data-trial-reset>Reset boat west</button>
          <label><input type="checkbox" data-trial-grid checked> Navigation grid</label>
          <label><input type="checkbox" data-trial-collision checked> Collision overlay</label>
        </div>
        <a class="tool-toggle tool-link" data-trial-return href="${applicationModeHref("asset-trial")}">Return to candidate</a>
      </section>`;
    slot.querySelector<HTMLButtonElement>("[data-trial-reset]")?.addEventListener("click", () => {
      this.resetBoat(this.trial.resetPositions[this.resetIndex]);
      this.resetIndex = (this.resetIndex + 1) % this.trial.resetPositions.length;
      const button = slot.querySelector<HTMLButtonElement>("[data-trial-reset]");
      if (button) button.textContent = `Reset boat ${this.trial.resetPositions[this.resetIndex].id}`;
    }, { signal });
    slot.querySelector<HTMLInputElement>("[data-trial-grid]")?.addEventListener("change", (event) => {
      this.gridGraphics.setVisible((event.currentTarget as HTMLInputElement).checked);
    }, { signal });
    slot.querySelector<HTMLInputElement>("[data-trial-collision]")?.addEventListener("change", (event) => {
      this.collisionGraphics.setVisible((event.currentTarget as HTMLInputElement).checked);
    }, { signal });
    const rememberCandidate = (): void => {
      sessionStorage.setItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY, this.candidate.id);
    };
    slot.querySelector<HTMLAnchorElement>("[data-trial-return]")
      ?.addEventListener("click", rememberCandidate, { signal });
    document.querySelector<HTMLAnchorElement>("#asset-mode-link")
      ?.addEventListener("click", rememberCandidate, { signal });
  }

  private resetBoat(position: Readonly<ProductionAssetTrialBoatPosition>): void {
    this.movement.teleport(this.ship, position.tile);
    this.ship.heading = position.heading;
    this.ship.speed = 0;
    this.accumulatorSeconds = 0;
    this.shipRenderer.sync(this.ship);
  }

  private fitTrial(): void {
    const padding = 48;
    const zoom = Phaser.Math.Clamp(Math.min(
      this.scale.width / (this.trial.worldPixelSize.width + padding * 2),
      this.scale.height / (this.trial.worldPixelSize.height + padding * 2),
    ), 0.35, 2.5);
    this.cameras.main
      .centerOn(this.trial.worldPixelSize.width / 2, this.trial.worldPixelSize.height / 2)
      .setZoom(zoom);
  }

  private installDebugApi(): void {
    window.__WAYFINDERS_ASSET_TRIAL__ = {
      snapshot: () => Object.freeze({
        candidateId: this.trial.candidateId,
        fingerprint: this.trial.candidateFingerprint,
        collisionRevision: this.trial.candidateFingerprint,
        ship: Object.freeze({ ...this.ship }),
        worldContent: Object.freeze(["open-water", "player-boat", "candidate-island"] as const),
      }),
      reset: (id = "west") => {
        const position = this.trial.resetPositions.find((candidate) => candidate.id === id);
        if (!position) throw new RangeError(`Unknown trial reset position ${id}`);
        this.resetBoat(position);
      },
    };
  }

  private shutdown(): void {
    this.controlsAbort?.abort();
    this.scale.off(Phaser.Scale.Events.RESIZE, this.fitTrial, this);
    this.shipRenderer?.destroy();
    delete window.__WAYFINDERS_ASSET_TRIAL__;
  }
}
