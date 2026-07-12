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
import { GameEvents, type ReplenishmentReason } from "./GameEvents";
import type {
  GridPoint,
  MovementInput,
  MovementResult,
  ShipState,
  ShipwreckState,
} from "./types";

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
  expedition: {
    id: number;
    active: boolean;
    generation: number;
    successfulReturns: number;
    failures: number;
    atDock: boolean;
  };
  wrecks: readonly Readonly<ShipwreckState>[];
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
  lifecycleResolutionRevision = 0;
  forwardRange!: ForwardRangeResult;
  returnPaths!: ReturnPathResult;

  private movement!: MovementSystem;
  private visibility!: VisibilitySystem;
  private knowledge!: KnowledgeSystem;
  private provisions!: ProvisionSystem;
  private forwardRanges!: ForwardRangeSystem;
  private returnPathing!: ReturnPathSystem;
  private readonly generator: WorldGenerator;
  private expeditionId = 1;
  private activeExpedition = false;
  private currentGeneration = 1;
  private returnCount = 0;
  private failureCount = 0;
  private readonly shipwrecks: ShipwreckState[] = [];

  constructor(readonly config: PrototypeConfig = prototypeConfig) {
    this.generator = new WorldGenerator(config);
    this.regenerate(config.world.seed);
  }

  get world(): WorldGrid {
    return this.generated.grid;
  }

  get currentExpeditionId(): number {
    return this.expeditionId;
  }

  get expeditionActive(): boolean {
    return this.activeExpedition;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  get successfulReturns(): number {
    return this.returnCount;
  }

  get failedExpeditions(): number {
    return this.failureCount;
  }

  get wrecks(): readonly Readonly<ShipwreckState>[] {
    return this.shipwrecks;
  }

  get atDock(): boolean {
    return this.isDockTile(this.ship.currentTileX, this.ship.currentTileY);
  }

  /** Only developer-created zero-cargo states remain stranded; natural exhaustion resolves immediately. */
  get stranded(): boolean {
    if (this.ship.provisions > 0 || this.atDock) return false;
    const knowledge = this.world.getKnowledge(this.ship.currentTileX, this.ship.currentTileY);
    return knowledge !== KnowledgeState.Supported || knowledgeTravelCost(knowledge, this.config) > 0;
  }

  update(input: MovementInput, deltaSeconds: number): MovementResult {
    const previousTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    const previousKnowledge = this.world.getKnowledge(previousTile.x, previousTile.y);
    const previousBundles = this.ship.provisions;
    const movementInput = this.stranded ? { turn: input.turn, throttle: 0 } : input;
    const movement = this.movement.update(this.ship, movementInput, deltaSeconds);
    this.lastMovement = movement;
    const preparedCharge = this.provisions.prepareMovement(movement.segments);
    const charge = this.provisions.applyPreparedMovement(this.ship, preparedCharge, (remaining) => {
      this.events.emit("provisionConsumed", { remaining });
    });
    const exhaustedNaturally = previousBundles > 0
      && charge.consumedBundles > 0
      && this.ship.provisions === 0;
    let knowledgeChanged = 0;
    let lifecycleChanged = false;

    if (charge.consumedBundles > 0) {
      this.events.emit("provisionsChanged", { previous: previousBundles, current: this.ship.provisions });
    }

    const crossedDock = movement.enteredTiles.some(({ x, y }) => this.isDockTile(x, y));
    if (crossedDock) {
      this.movement.teleport(this.ship, this.generated.landmarks.homeReturnTile);
      this.lastMovement = NO_MOVEMENT;
      lifecycleChanged = true;
    }

    if (movement.tileChanged || crossedDock) {
      const currentTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
      const currentKnowledgeBeforeObservation = this.world.getKnowledge(currentTile.x, currentTile.y);
      if (
        !this.activeExpedition
        && previousKnowledge === KnowledgeState.Supported
        && currentKnowledgeBeforeObservation !== KnowledgeState.Supported
      ) {
        this.startExpedition();
        lifecycleChanged = true;
      }

      const visibility = this.visibility.updateForMovement(previousTile, currentTile);
      const knowledge = this.knowledge.applyTrailingVisibility(visibility, this.expeditionId);
      knowledgeChanged += knowledge.changedCount;
      this.discoverVisibleWrecks();
      this.events.emit("shipEnteredTile", currentTile);

      if (this.atDock) {
        knowledgeChanged += this.resolveDockArrival();
        lifecycleChanged = true;
      }
    }

    if (exhaustedNaturally && !this.isInSupportedWater()) {
      if (!this.activeExpedition) this.startExpedition();
      knowledgeChanged += this.failExpedition();
      lifecycleChanged = true;
    }

    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    if (movement.tileChanged || knowledgeChanged > 0 || lifecycleChanged) {
      this.recalculateRiskOverlays();
    } else if (preparedCharge.totalCost > 0) {
      this.updateRiskOverlayBudgets();
    }
    if (movement.tileChanged || charge.consumedBundles > 0 || knowledgeChanged > 0 || lifecycleChanged) {
      this.revision++;
    }
    return this.lastMovement;
  }

  regenerate(seed = this.config.world.seed): void {
    const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : this.config.world.seed;
    patchPrototypeConfig({ world: { seed: normalizedSeed } });
    this.generated = this.generator.generate(normalizedSeed);
    this.expeditionId = 1;
    this.activeExpedition = false;
    this.currentGeneration = 1;
    this.returnCount = 0;
    this.failureCount = 0;
    this.shipwrecks.length = 0;
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
    this.visibility.updateAt(this.generated.landmarks.dock);
    this.recalculateRiskOverlays();
    this.lastMovement = NO_MOVEMENT;
    this.lifecycleResolutionRevision++;
    this.revision++;
    this.events.emit("worldRegenerated", { seed: normalizedSeed });
  }

  teleport(tile: GridPoint): boolean {
    if (!this.world.inBounds(tile.x, tile.y) || this.world.isMovementBlocked(tile.x, tile.y)) return false;
    const targetKnowledge = this.world.getKnowledge(tile.x, tile.y);
    if (!this.activeExpedition && targetKnowledge !== KnowledgeState.Supported) this.startExpedition();

    this.movement.teleport(this.ship, tile);
    const visibility = this.visibility.updateAt(tile);
    let knowledgeChanged = this.knowledge.applyVisibility(visibility, this.expeditionId).changedCount;
    this.discoverVisibleWrecks();
    this.lastMovement = NO_MOVEMENT;
    this.events.emit("shipTeleported", tile);
    this.events.emit("shipEnteredTile", tile);

    if (this.atDock) knowledgeChanged += this.resolveDockArrival();

    this.recalculateRiskOverlays();
    this.revision++;
    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    return true;
  }

  refreshVisibility(): void {
    const tile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    if (!this.activeExpedition && !this.isInSupportedWater()) this.startExpedition();
    const visibility = this.visibility.updateAt(tile);
    const knowledge = this.knowledge.applyVisibility(visibility, this.expeditionId);
    this.discoverVisibleWrecks();
    this.recalculateRiskOverlays();
    this.revision++;
    if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
  }

  setProvisions(value: number): void {
    const previous = this.ship.provisions;
    const current = Math.max(0, Math.floor(Number.isFinite(value) ? value : previous));
    const accumulatorWillReset = current === 0 && this.ship.provisionAccumulator !== 0;
    if (current === previous && !accumulatorWillReset) return;

    this.ship.provisions = current;
    if (current === 0 || previous === 0) this.ship.provisionAccumulator = 0;
    if (current !== previous) this.events.emit("provisionsChanged", { previous, current });

    this.recalculateRiskOverlays();
    this.revision++;
  }

  addProvisions(delta: number): void {
    this.setProvisions(this.ship.provisions + Math.trunc(delta));
  }

  /** Deterministic sandbox hook; normal play reaches this outcome through travel consumption. */
  forceWreck(): boolean {
    if (this.isInSupportedWater()) return false;
    if (!this.activeExpedition) this.startExpedition();
    const knowledgeChanged = this.failExpedition();
    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    this.recalculateRiskOverlays();
    this.revision++;
    return true;
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
      expedition: {
        id: this.expeditionId,
        active: this.activeExpedition,
        generation: this.currentGeneration,
        successfulReturns: this.returnCount,
        failures: this.failureCount,
        atDock: this.atDock,
      },
      wrecks: this.shipwrecks.map((wreck) => ({ ...wreck })),
      debug: { ...this.debug },
    };
  }

  private startExpedition(): void {
    if (this.activeExpedition) return;
    this.activeExpedition = true;
    this.events.emit("expeditionStarted", {
      expeditionId: this.expeditionId,
      generation: this.currentGeneration,
    });
  }

  private resolveDockArrival(): number {
    this.movement.teleport(this.ship, this.generated.landmarks.homeReturnTile);
    this.visibility.updateAt(this.generated.landmarks.homeReturnTile);
    this.lastMovement = NO_MOVEMENT;

    if (this.activeExpedition) return this.completeExpedition();

    this.replenishCurrentShip("dock");
    this.lifecycleResolutionRevision++;
    return 0;
  }

  private completeExpedition(): number {
    const expeditionId = this.expeditionId;
    const generation = this.currentGeneration;
    const committed = this.knowledge.commitExpedition(expeditionId);
    this.activeExpedition = false;
    this.returnCount++;
    this.advanceExpeditionId();
    this.events.emit("expeditionReturned", {
      expeditionId,
      generation,
      supportedTileCount: committed.changedCount,
    });
    this.replenishCurrentShip("return", true);
    this.lifecycleResolutionRevision++;
    return committed.changedCount;
  }

  private failExpedition(): number {
    const expeditionId = this.expeditionId;
    const generation = this.currentGeneration;
    const lostShip = this.ship;
    const wreck: ShipwreckState = {
      id: this.shipwrecks.length + 1,
      generation,
      expeditionId,
      worldX: lostShip.worldX,
      worldY: lostShip.worldY,
      tileX: lostShip.currentTileX,
      tileY: lostShip.currentTileY,
      heading: lostShip.heading,
      discovered: false,
    };
    this.shipwrecks.push(wreck);
    const reverted = this.knowledge.revertExpedition(expeditionId);
    this.world.clearVisibility();
    this.events.emit("shipWrecked", {
      wreckId: wreck.id,
      expeditionId,
      generation,
      tileX: wreck.tileX,
      tileY: wreck.tileY,
      worldX: wreck.worldX,
      worldY: wreck.worldY,
    });
    this.activeExpedition = false;
    this.failureCount++;
    this.currentGeneration++;
    this.events.emit("generationAdvanced", {
      previousGeneration: generation,
      generation: this.currentGeneration,
      reason: "wreck",
    });
    this.advanceExpeditionId();

    const previousProvisions = lostShip.provisions;
    const previousAccumulator = lostShip.provisionAccumulator;
    this.ship = createShipStateAtGrid(
      this.generated.landmarks.homeReturnTile,
      this.config.provisions.startingBundles,
      0,
      this.config,
    );
    this.visibility.updateAt(this.generated.landmarks.homeReturnTile);
    this.lastMovement = NO_MOVEMENT;
    this.emitReplenishment(
      previousProvisions,
      previousAccumulator,
      this.ship.provisions,
      "respawn",
      true,
    );
    this.lifecycleResolutionRevision++;
    this.events.emit("expeditionFailed", {
      expeditionId,
      generation,
      forgottenTiles: reverted.changedCount,
      nextGeneration: this.currentGeneration,
      wreck: { ...wreck },
    });
    return reverted.changedCount;
  }

  private replenishCurrentShip(reason: ReplenishmentReason, forceEvent = false): boolean {
    const previous = this.ship.provisions;
    const previousAccumulator = this.ship.provisionAccumulator;
    const current = this.config.provisions.startingBundles;
    this.ship.provisions = current;
    this.ship.provisionAccumulator = 0;
    this.ship.speed = 0;
    return this.emitReplenishment(previous, previousAccumulator, current, reason, forceEvent);
  }

  private emitReplenishment(
    previous: number,
    previousAccumulator: number,
    current: number,
    reason: ReplenishmentReason,
    forceEvent: boolean,
  ): boolean {
    const changed = previous !== current || previousAccumulator !== 0;
    if (previous !== current) this.events.emit("provisionsChanged", { previous, current });
    if (changed || forceEvent) {
      this.events.emit("shipReplenished", {
        generation: this.currentGeneration,
        bundles: current,
        reason,
      });
    }
    return changed;
  }

  private advanceExpeditionId(): void {
    this.expeditionId = this.expeditionId === 0xffff_ffff ? 1 : this.expeditionId + 1;
  }

  private isDockTile(x: number, y: number): boolean {
    const dock = this.generated.landmarks.homeReturnTile;
    return x === dock.x && y === dock.y;
  }

  private isInSupportedWater(): boolean {
    return this.world.getKnowledge(this.ship.currentTileX, this.ship.currentTileY) === KnowledgeState.Supported;
  }

  private discoverVisibleWrecks(): void {
    for (const wreck of this.shipwrecks) {
      if (wreck.discovered || !this.world.isVisibleNow(wreck.tileX, wreck.tileY)) continue;
      wreck.discovered = true;
      this.events.emit("wreckDiscovered", {
        wreckId: wreck.id,
        generation: wreck.generation,
        tileX: wreck.tileX,
        tileY: wreck.tileY,
      });
    }
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
