import {
  patchPrototypeConfig,
  prototypeConfig,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { ForwardRangeSystem, type ForwardRangeResult } from "../exploration/ForwardRangeSystem";
import { KnowledgeSystem } from "../exploration/KnowledgeSystem";
import { ProvisionSystem, knowledgeTravelCost } from "../exploration/ProvisionSystem";
import {
  ReturnPathSystem,
  ReturnRiskLevel,
  type ReturnPathResult,
} from "../exploration/ReturnPathSystem";
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
  risk: {
    budget: number;
    forwardReachable: number;
    comfortable: number;
    warning: number;
    critical: number;
    impossible: number;
    stranded: boolean;
  };
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
    forwardRange: true,
    returnViability: true,
  };

  generated!: GeneratedWorld;
  ship!: ShipState;
  lastMovement: MovementResult = NO_MOVEMENT;
  revision = 0;
  overlaysRevision = 0;
  forwardRange!: ForwardRangeResult;
  returnPaths!: ReturnPathResult;

  private movement!: MovementSystem;
  private visibility!: VisibilitySystem;
  private knowledge!: KnowledgeSystem;
  private provisions!: ProvisionSystem;
  private forwardRanges!: ForwardRangeSystem;
  private returnPathing!: ReturnPathSystem;
  private readonly generator: WorldGenerator;
  private readonly currentExpeditionId = 1;

  constructor(readonly config: PrototypeConfig = prototypeConfig) {
    this.generator = new WorldGenerator(config);
    this.regenerate(config.world.seed);
  }

  get world(): WorldGrid {
    return this.generated.grid;
  }

  get stranded(): boolean {
    if (this.ship.provisions > 0) return false;
    const state = this.world.getKnowledge(this.ship.currentTileX, this.ship.currentTileY);
    return knowledgeTravelCost(state, this.config) > 0;
  }

  update(input: MovementInput, deltaSeconds: number): MovementResult {
    const previousTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    const previousBundles = this.ship.provisions;
    const movementInput = this.stranded ? { turn: input.turn, throttle: 0 } : input;
    this.lastMovement = this.movement.update(this.ship, movementInput, deltaSeconds);
    const preparedCharge = this.provisions.prepareMovement(this.lastMovement.segments);
    const charge = this.provisions.applyPreparedMovement(this.ship, preparedCharge, (remaining) => {
      this.events.emit("provisionConsumed", { remaining });
    });
    let knowledgeChanged = 0;

    if (this.lastMovement.tileChanged) {
      const currentTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
      const visibility = this.visibility.updateForMovement(previousTile, currentTile);
      const knowledge = this.knowledge.applyTrailingVisibility(
        visibility,
        this.currentExpeditionId,
      );
      knowledgeChanged = knowledge.changedCount;
      this.events.emit("shipEnteredTile", currentTile);
      if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
    }

    if (charge.consumedBundles > 0) {
      this.events.emit("provisionsChanged", { previous: previousBundles, current: this.ship.provisions });
    }
    if (this.lastMovement.tileChanged || knowledgeChanged > 0) {
      this.recalculateRiskOverlays();
    } else if (preparedCharge.totalCost > 0) {
      this.updateRiskOverlayBudgets();
    }
    if (this.lastMovement.tileChanged || charge.consumedBundles > 0 || knowledgeChanged > 0) {
      this.revision++;
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
    this.provisions = new ProvisionSystem(this.world, this.config);
    this.forwardRanges = new ForwardRangeSystem(this.world, this.config);
    this.returnPathing = new ReturnPathSystem(this.world, this.config);
    const initialVisibility = this.visibility.updateAt(this.generated.landmarks.dock);
    this.knowledge.applyVisibility(initialVisibility, this.currentExpeditionId);
    this.recalculateRiskOverlays();
    this.lastMovement = NO_MOVEMENT;
    this.revision++;
    this.events.emit("worldRegenerated", { seed: normalizedSeed });
  }

  teleport(tile: GridPoint): boolean {
    if (!this.world.inBounds(tile.x, tile.y) || this.world.isMovementBlocked(tile.x, tile.y)) return false;
    this.movement.teleport(this.ship, tile);
    const visibility = this.visibility.updateAt(tile);
    const knowledge = this.knowledge.applyVisibility(visibility, this.currentExpeditionId);
    this.recalculateRiskOverlays();
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
    this.recalculateRiskOverlays();
    this.revision++;
    if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
  }

  setProvisions(value: number): void {
    const previous = this.ship.provisions;
    const current = Math.max(0, Math.floor(Number.isFinite(value) ? value : previous));
    if (current === previous) return;
    this.ship.provisions = current;
    if (current === 0 || previous === 0) this.ship.provisionAccumulator = 0;
    this.recalculateRiskOverlays();
    this.revision++;
    this.events.emit("provisionsChanged", { previous, current });
  }

  addProvisions(delta: number): void {
    this.setProvisions(this.ship.provisions + Math.trunc(delta));
  }

  refreshRiskOverlays(): void {
    this.recalculateRiskOverlays();
    this.revision++;
  }

  setDebugVisibility<K extends keyof DebugVisibilityState>(name: K, visible: boolean): void {
    if (this.debug[name] === visible) return;
    this.debug[name] = visible;
    this.revision++;
  }

  snapshot(): SimulationSnapshot {
    const knowledge = { supported: 0, personal: 0, unknown: 0, visibleNow: 0 };
    const risk = {
      budget: this.forwardRange.budget,
      forwardReachable: 0,
      comfortable: 0,
      warning: 0,
      critical: 0,
      impossible: 0,
      stranded: this.stranded,
    };
    this.world.forEachTile((x, y, index) => {
      const state = this.world.getKnowledge(x, y);
      if (state === KnowledgeState.Unknown) knowledge.unknown++;
      else if (state === KnowledgeState.Personal) knowledge.personal++;
      else knowledge.supported++;
      if (this.world.isVisibleNow(x, y)) knowledge.visibleNow++;
      if (this.forwardRange.mask[index]) risk.forwardReachable++;
      switch (this.returnPaths.risk[index]) {
        case ReturnRiskLevel.Comfortable: risk.comfortable++; break;
        case ReturnRiskLevel.Warning: risk.warning++; break;
        case ReturnRiskLevel.Critical: risk.critical++; break;
        case ReturnRiskLevel.Impossible: risk.impossible++; break;
      }
    });
    return {
      seed: this.generated.seed,
      ship: { ...this.ship },
      tile: { x: this.ship.currentTileX, y: this.ship.currentTileY },
      world: { width: this.world.width, height: this.world.height },
      knowledge,
      risk,
      debug: { ...this.debug },
    };
  }

  private recalculateRiskOverlays(): void {
    this.forwardRange = this.forwardRanges.calculate(this.ship);
    this.returnPaths = this.returnPathing.calculate(this.ship);
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
  }

  private updateRiskOverlayBudgets(): void {
    const forwardChanged = this.forwardRanges.updateBudget(this.forwardRange, this.ship);
    const returnChanged = this.returnPathing.updateBudget(this.returnPaths, this.ship);
    if (!forwardChanged && !returnChanged) return;
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
  }
}
