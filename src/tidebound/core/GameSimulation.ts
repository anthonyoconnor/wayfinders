import {
  patchPrototypeConfig,
  prototypeConfig,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { KnowledgeSystem } from "../exploration/KnowledgeSystem";
import { VisibilitySystem } from "../exploration/VisibilitySystem";
import { MovementSystem, createShipStateAtGrid } from "../navigation/MovementSystem";
import type { GeneratedWorld } from "../world/WorldGenerator";
import { WorldGenerator } from "../world/WorldGenerator";
import type { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";
import { GameEvents } from "./GameEvents";
import type { GridPoint, MovementInput, MovementResult, ShipState } from "./types";

export interface DebugVisibilityState {
  navigationGrid: boolean;
  currentSight: boolean;
  forwardRange: boolean;
  returnViability: boolean;
}

export interface SimulationSnapshot {
  seed: number;
  ship: Readonly<ShipState>;
  tile: GridPoint;
  world: { width: number; height: number };
  knowledge: { supported: number; personal: number; unknown: number; visibleNow: number };
  debug: Readonly<DebugVisibilityState>;
}

const NO_MOVEMENT: MovementResult = {
  movedDistancePixels: 0,
  collided: false,
  enteredTiles: [],
  segments: [],
  tileChanged: false,
};

/**
 * Phaser-independent owner of the live prototype state. Presentation adapters
 * may read it, but all state changes go through this class or its systems.
 */
export class GameSimulation {
  readonly events = new GameEvents();
  readonly debug: DebugVisibilityState = {
    navigationGrid: false,
    currentSight: false,
    forwardRange: false,
    returnViability: false,
  };

  generated!: GeneratedWorld;
  ship!: ShipState;
  lastMovement: MovementResult = NO_MOVEMENT;
  revision = 0;

  private movement!: MovementSystem;
  private visibility!: VisibilitySystem;
  private knowledge!: KnowledgeSystem;
  private readonly generator: WorldGenerator;
  private readonly currentExpeditionId = 1;

  constructor(readonly config: PrototypeConfig = prototypeConfig) {
    this.generator = new WorldGenerator(config);
    this.regenerate(config.world.seed);
  }

  get world(): WorldGrid {
    return this.generated.grid;
  }

  update(input: MovementInput, deltaSeconds: number): MovementResult {
    const previousTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    this.lastMovement = this.movement.update(this.ship, input, deltaSeconds);
    if (this.lastMovement.tileChanged) {
      const currentTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
      const visibility = this.visibility.updateForMovement(previousTile, currentTile);
      const knowledge = this.knowledge.applyVisibility(visibility, this.currentExpeditionId);
      this.revision++;
      this.events.emit("shipEnteredTile", currentTile);
      if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
    }
    return this.lastMovement;
  }

  regenerate(seed = this.config.world.seed): void {
    const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : this.config.world.seed;
    patchPrototypeConfig({ world: { seed: normalizedSeed } });
    this.generated = this.generator.generate(normalizedSeed);
    this.ship = createShipStateAtGrid(
      this.generated.landmarks.dock,
      this.config.provisions.startingBundles,
      0,
      this.config,
    );
    this.movement = new MovementSystem(this.world, this.config);
    this.visibility = new VisibilitySystem(this.world, this.config);
    this.knowledge = new KnowledgeSystem(this.world);
    const initialVisibility = this.visibility.updateAt(this.generated.landmarks.dock);
    this.knowledge.applyVisibility(initialVisibility, this.currentExpeditionId);
    this.lastMovement = NO_MOVEMENT;
    this.revision++;
    this.events.emit("worldRegenerated", { seed: normalizedSeed });
  }

  teleport(tile: GridPoint): boolean {
    if (!this.world.inBounds(tile.x, tile.y) || this.world.isMovementBlocked(tile.x, tile.y)) return false;
    this.movement.teleport(this.ship, tile);
    const visibility = this.visibility.updateAt(tile);
    const knowledge = this.knowledge.applyVisibility(visibility, this.currentExpeditionId);
    this.lastMovement = NO_MOVEMENT;
    this.revision++;
    this.events.emit("shipTeleported", tile);
    this.events.emit("shipEnteredTile", tile);
    if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
    return true;
  }

  refreshVisibility(): void {
    const tile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    const visibility = this.visibility.updateAt(tile);
    const knowledge = this.knowledge.applyVisibility(visibility, this.currentExpeditionId);
    this.revision++;
    if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
  }

  setProvisions(value: number): void {
    const previous = this.ship.provisions;
    const current = Math.max(0, Math.floor(Number.isFinite(value) ? value : previous));
    if (current === previous) return;
    this.ship.provisions = current;
    this.revision++;
    this.events.emit("provisionsChanged", { previous, current });
  }

  addProvisions(delta: number): void {
    this.setProvisions(this.ship.provisions + Math.trunc(delta));
  }

  setDebugVisibility<K extends keyof DebugVisibilityState>(name: K, visible: boolean): void {
    if (this.debug[name] === visible) return;
    this.debug[name] = visible;
    this.revision++;
  }

  snapshot(): SimulationSnapshot {
    const knowledge = { supported: 0, personal: 0, unknown: 0, visibleNow: 0 };
    this.world.forEachTile((x, y) => {
      const state = this.world.getKnowledge(x, y);
      if (state === KnowledgeState.Unknown) knowledge.unknown++;
      else if (state === KnowledgeState.Personal) knowledge.personal++;
      else knowledge.supported++;
      if (this.world.isVisibleNow(x, y)) knowledge.visibleNow++;
    });
    return {
      seed: this.generated.seed,
      ship: { ...this.ship },
      tile: { x: this.ship.currentTileX, y: this.ship.currentTileY },
      world: { width: this.world.width, height: this.world.height },
      knowledge,
      debug: { ...this.debug },
    };
  }
}
