import {
  patchPrototypeConfig,
  prototypeConfig,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { ForwardRangeSystem, type ForwardRangeResult } from "../exploration/ForwardRangeSystem";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  FISHING_SHOAL_CONTRACT_VERSION,
  type FishingShoalDefinition,
  type FishingShoalInteractionCommandV1,
  type FishingShoalInteractionReadModel,
  type FishingShoalInteractionResultV1,
  type FishingShoalProvisionalRecordV1,
  type FishingShoalReadModel,
  type FishingShoalReturnedRecordV1,
} from "../exploration/FishingShoalContracts";
import { generateFishingShoalCatalog } from "../exploration/FishingShoalCatalog";
import { FishingShoalSystem } from "../exploration/FishingShoalSystem";
import {
  DiscoverySystem,
  type DiscoveryDefinition,
  type DiscoveryRecord,
} from "../exploration/DiscoverySystem";
import { KnowledgeSystem } from "../exploration/KnowledgeSystem";
import { ProvisionSystem, knowledgeTravelCost } from "../exploration/ProvisionSystem";
import { ReturnPathSystem, type ReturnPathResult } from "../exploration/ReturnPathSystem";
import { VisibilitySystem } from "../exploration/VisibilitySystem";
import { MovementSystem, createShipStateAtGrid } from "../navigation/MovementSystem";
import {
  NAVIGATOR_VOYAGE_LIMIT,
  NavigatorLineageSystem,
  type NavigatorRecordV3,
} from "../lineage/NavigatorLineageSystem";
import {
  SAVE_SCHEMA_VERSION,
  WORLD_GENERATOR_VERSION,
  applyGenerationConfig,
  captureGenerationConfig,
  decodeKnowledgeRuns,
  encodeWorldKnowledgeRuns,
  parseSaveGame,
  type KnowledgeRun,
  type SaveGame,
} from "../persistence/SaveGame";
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
    forwardFrontier: number;
    forwardHeading: number;
    forwardConeHalfAngleDegrees: number;
    comfortable: number;
    warning: number;
    critical: number;
    impossible: number;
    returnPathTiles: number;
    returnCorridorTiles: number;
    returnLevel: number;
    returnCost: number | null;
    returnMargin: number | null;
    stranded: boolean;
  };
  expedition: {
    id: number;
    active: boolean;
    generation: number;
    successfulReturns: number;
    failures: number;
    atDock: boolean;
    wreckPresentationActive: boolean;
    respawnSecondsRemaining: number;
    pendingWreckId: number | null;
  };
  navigator: Readonly<NavigatorRecordV3>;
  lineage: readonly Readonly<NavigatorRecordV3>[];
  wrecks: readonly Readonly<ShipwreckState>[];
  discoveries: {
    available: number;
    provisional: number;
    returned: number;
    records: readonly Readonly<DiscoveryRecord>[];
  };
  fishingShoals: {
    available: number;
    provisional: number;
    returned: number;
    activationEligible: number;
    surveyCasesRemaining: 0 | 1;
    interaction?: Readonly<FishingShoalInteractionReadModel>;
    records: readonly Readonly<FishingShoalReadModel>[];
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

interface PendingRespawnState {
  expeditionId: number;
  generation: number;
  forgottenTiles: number;
  wreck: ShipwreckState;
  remainingSeconds: number;
}

interface KnowledgeSaveCache {
  world: WorldGrid;
  knowledgeVersion: number;
  runs: readonly KnowledgeRun[];
}

/** A structurally valid save conflicts with its regenerated authoritative world. */
export class SaveRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveRestoreError";
  }
}

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
  /** Monotonic dirtiness key for authoritative state included in createSave(). */
  saveRevision = 0;
  /** Monotonic collection key for renderers that display permanent wrecks. */
  wrecksRevision = 0;
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
  private discoverySystem!: DiscoverySystem;
  private fishingShoalSystem!: FishingShoalSystem;
  private readonly generator: WorldGenerator;
  private expeditionId = 1;
  private activeExpedition = false;
  private lineage = new NavigatorLineageSystem();
  private readonly shipwrecks: ShipwreckState[] = [];
  private pendingRespawn?: PendingRespawnState;
  private knowledgeSaveCache?: KnowledgeSaveCache;
  private riskResultsInitialized = false;

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
    return this.lineage.generation;
  }

  get currentNavigator(): Readonly<NavigatorRecordV3> {
    return this.lineage.currentNavigator;
  }

  get navigatorLineage(): readonly Readonly<NavigatorRecordV3>[] {
    return this.lineage.navigators;
  }

  get navigatorVoyagesCompleted(): number {
    return this.currentNavigator.completedVoyages;
  }

  get navigatorVoyagesRemaining(): number {
    return this.currentNavigator.state === "active"
      ? NAVIGATOR_VOYAGE_LIMIT - this.currentNavigator.completedVoyages
      : 0;
  }

  get navigatorVoyageNumber(): number {
    return Math.min(this.navigatorVoyagesCompleted + 1, NAVIGATOR_VOYAGE_LIMIT);
  }

  get successfulReturns(): number {
    return this.lineage.totalCompletedVoyages;
  }

  get failedExpeditions(): number {
    return this.lineage.lostNavigatorCount;
  }

  get wrecks(): readonly Readonly<ShipwreckState>[] {
    return this.shipwrecks;
  }

  get discoveryDefinitions(): readonly Readonly<DiscoveryDefinition>[] {
    return this.discoverySystem.definitions;
  }

  get provisionalDiscoveries(): readonly Readonly<DiscoveryRecord>[] {
    return this.discoverySystem.provisional;
  }

  get returnedDiscoveries(): readonly Readonly<DiscoveryRecord>[] {
    return this.discoverySystem.returned;
  }

  get discoveries(): readonly Readonly<DiscoveryRecord>[] {
    return this.discoverySystem.allRecords;
  }

  get discoveryRecordsRevision(): number {
    return this.discoverySystem.recordsRevision;
  }

  get fishingShoalDefinitions(): readonly Readonly<FishingShoalDefinition>[] {
    return this.fishingShoalSystem.definitions;
  }

  get provisionalFishingShoals(): readonly Readonly<FishingShoalProvisionalRecordV1>[] {
    return this.fishingShoalSystem.provisional;
  }

  get returnedFishingShoals(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    return this.fishingShoalSystem.returned;
  }

  get activationEligibleFishingShoals(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    return this.fishingShoalSystem.activationEligible;
  }

  get fishingShoalConnectivityBuildCount(): number {
    return this.fishingShoalSystem.connectivityBuildCount;
  }

  get fishingShoalReadModels(): readonly Readonly<FishingShoalReadModel>[] {
    return this.fishingShoalSystem.readModels();
  }

  get fishingShoalRecordsRevision(): number {
    return this.fishingShoalSystem.recordsRevision;
  }

  get surveyCasesRemaining(): 0 | 1 {
    return this.pendingRespawn ? 0 : this.fishingShoalSystem.surveyCasesRemaining;
  }

  get fishingShoalInteraction(): Readonly<FishingShoalInteractionReadModel> | undefined {
    if (this.pendingRespawn) return undefined;
    return this.fishingShoalSystem.interactionNear({
      x: this.ship.currentTileX,
      y: this.ship.currentTileY,
    });
  }

  get wreckPresentationActive(): boolean {
    return this.pendingRespawn !== undefined;
  }

  get respawnSecondsRemaining(): number {
    return this.pendingRespawn?.remainingSeconds ?? 0;
  }

  get pendingWreckId(): number | null {
    return this.pendingRespawn?.wreck.id ?? null;
  }

  get atDock(): boolean {
    return this.isDockTile(this.ship.currentTileX, this.ship.currentTileY);
  }

  /** Only developer-created zero-cargo states remain stranded outside the timed wreck transition. */
  get stranded(): boolean {
    if (this.pendingRespawn) return false;
    if (this.ship.provisions > 0 || this.atDock) return false;
    const knowledge = this.world.getKnowledge(this.ship.currentTileX, this.ship.currentTileY);
    return knowledge !== KnowledgeState.Supported || knowledgeTravelCost(knowledge, this.config) > 0;
  }

  update(input: MovementInput, deltaSeconds: number): MovementResult {
    if (this.pendingRespawn) return this.advanceWreckPresentation(deltaSeconds);
    const previousShip = { ...this.ship };
    const previousTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    const previousHeading = this.ship.heading;
    const previousKnowledge = this.world.getKnowledge(previousTile.x, previousTile.y);
    const previousBundles = this.ship.provisions;
    const movementInput = this.stranded ? { turn: input.turn, throttle: 0 } : input;
    const movement = this.movement.update(this.ship, movementInput, deltaSeconds);
    const headingChanged = this.ship.heading !== previousHeading;
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
      this.observeDiscoveries();
      if (this.observeFishingShoals() > 0) lifecycleChanged = true;
      this.discoverVisibleWrecks();
      this.events.emit("shipEnteredTile", currentTile);

      if (this.atDock) {
        knowledgeChanged += this.resolveDockArrival();
        lifecycleChanged = true;
      }
    }

    if (exhaustedNaturally && !this.pendingRespawn && !this.isInSupportedWater()) {
      if (!this.activeExpedition) this.startExpedition();
      knowledgeChanged += this.failExpedition();
      lifecycleChanged = true;
    }

    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    if (movement.tileChanged || knowledgeChanged > 0 || lifecycleChanged) {
      this.recalculateRiskOverlays();
    } else if (preparedCharge.totalCost > 0) {
      this.updateRiskOverlayBudgets();
    } else if (headingChanged) {
      this.updateRiskOverlayHeading();
    }
    if (movement.tileChanged || headingChanged || charge.consumedBundles > 0 || knowledgeChanged > 0 || lifecycleChanged) {
      this.revision++;
    }
    if (this.shipSaveStateChanged(previousShip) || knowledgeChanged > 0 || lifecycleChanged) this.saveRevision++;
    return this.lastMovement;
  }

  regenerate(seed = this.config.world.seed): void {
    const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : this.config.world.seed;
    if (this.config === prototypeConfig) {
      patchPrototypeConfig({ world: { seed: normalizedSeed } });
    } else {
      this.config.world.seed = normalizedSeed;
    }
    this.generated = this.generator.generate(normalizedSeed);
    this.expeditionId = 1;
    this.activeExpedition = false;
    this.lineage = new NavigatorLineageSystem();
    this.shipwrecks.length = 0;
    this.wrecksRevision++;
    this.pendingRespawn = undefined;
    this.ship = createShipStateAtGrid(
      this.generated.landmarks.dock,
      this.config.provisions.startingBundles,
      0,
      this.config,
    );
    this.movement = new MovementSystem(this.world, this.config);
    this.visibility = new VisibilitySystem(this.world, this.config);
    this.knowledge = new KnowledgeSystem(this.world, this.config);
    this.provisions = new ProvisionSystem(this.world, this.config);
    this.forwardRanges = new ForwardRangeSystem(this.world, this.config);
    this.returnPathing = new ReturnPathSystem(this.world, this.config);
    this.riskResultsInitialized = false;
    this.discoverySystem = new DiscoverySystem(
      this.world,
      this.generated.seed,
      this.generated.islands,
    );
    this.fishingShoalSystem = new FishingShoalSystem(
      this.world,
      generateFishingShoalCatalog(
        this.world,
        this.generated.seed,
        this.generated.landmarks.homeReturnTile,
      ),
      this.generated.landmarks.homeReturnTile,
    );
    this.visibility.updateAt(this.generated.landmarks.dock);
    this.recalculateRiskOverlays();
    this.lastMovement = NO_MOVEMENT;
    this.lifecycleResolutionRevision++;
    this.revision++;
    this.saveRevision++;
    this.events.emit("worldRegenerated", { seed: normalizedSeed });
  }

  teleport(tile: GridPoint): boolean {
    if (this.pendingRespawn) return false;
    if (!this.world.inBounds(tile.x, tile.y) || this.world.isMovementBlocked(tile.x, tile.y)) return false;
    const targetKnowledge = this.world.getKnowledge(tile.x, tile.y);
    if (!this.activeExpedition && targetKnowledge !== KnowledgeState.Supported) this.startExpedition();

    this.movement.teleport(this.ship, tile);
    const visibility = this.visibility.updateAt(tile);
    let knowledgeChanged = this.knowledge.applyVisibility(visibility, this.expeditionId).changedCount;
    this.observeDiscoveries();
    this.observeFishingShoals();
    this.discoverVisibleWrecks();
    this.lastMovement = NO_MOVEMENT;
    this.events.emit("shipTeleported", tile);
    this.events.emit("shipEnteredTile", tile);

    if (this.atDock) knowledgeChanged += this.resolveDockArrival();

    this.recalculateRiskOverlays();
    this.revision++;
    this.saveRevision++;
    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    return true;
  }

  refreshVisibility(): void {
    if (this.pendingRespawn) return;
    const wasActiveExpedition = this.activeExpedition;
    const tile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    if (!this.activeExpedition && !this.isInSupportedWater()) this.startExpedition();
    const visibility = this.visibility.updateAt(tile);
    const knowledge = this.knowledge.applyVisibility(visibility, this.expeditionId);
    const discoveriesChanged = this.observeDiscoveries() > 0;
    const fishingShoalsChanged = this.observeFishingShoals() > 0;
    const wrecksChanged = this.discoverVisibleWrecks() > 0;
    this.recalculateRiskOverlays();
    this.revision++;
    if (
      knowledge.changedCount > 0
      || discoveriesChanged
      || fishingShoalsChanged
      || wrecksChanged
      || wasActiveExpedition !== this.activeExpedition
    ) this.saveRevision++;
    if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
  }

  setProvisions(value: number): void {
    if (this.pendingRespawn) return;
    const previous = this.ship.provisions;
    const current = Math.max(0, Math.floor(Number.isFinite(value) ? value : previous));
    const accumulatorWillReset = current === 0 && this.ship.provisionAccumulator !== 0;
    if (current === previous && !accumulatorWillReset) return;

    this.ship.provisions = current;
    if (current === 0 || previous === 0) this.ship.provisionAccumulator = 0;
    if (current !== previous) this.events.emit("provisionsChanged", { previous, current });

    this.recalculateRiskOverlays();
    this.revision++;
    this.saveRevision++;
  }

  addProvisions(delta: number): void {
    this.setProvisions(this.ship.provisions + Math.trunc(delta));
  }

  interactWithFishingShoal(
    command: Readonly<FishingShoalInteractionCommandV1>,
  ): FishingShoalInteractionResultV1 {
    if (this.pendingRespawn) {
      return {
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        status: "rejected",
        id: command.id,
        reason: "wreck-hold",
      };
    }
    const interaction = this.fishingShoalInteraction;
    if (
      command.type === "survey"
      && !this.activeExpedition
      && this.surveyCasesRemaining === 1
      && interaction?.id === command.id
      && interaction.state === "returned-lead"
    ) this.startExpedition();
    const result = this.fishingShoalSystem.applyInteraction(command, {
      x: this.ship.currentTileX,
      y: this.ship.currentTileY,
    }, this.expeditionId, this.generation);
    if (result.status !== "surveyed") return result;

    const definition = this.fishingShoalSystem.definitionFor(result.id);
    if (!definition) throw new Error(`Surveyed fishing shoal ${result.id} has no definition`);
    this.revision++;
    this.saveRevision++;
    this.events.emit("fishingShoalSurveyed", {
      ...result,
      tile: definition.tile,
    });
    return result;
  }

  /** Deterministic sandbox hook; normal play reaches this outcome through travel consumption. */
  forceWreck(): boolean {
    if (this.pendingRespawn) return false;
    if (this.isInSupportedWater()) return false;
    if (!this.activeExpedition) this.startExpedition();
    const knowledgeChanged = this.failExpedition();
    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    this.recalculateRiskOverlays();
    this.revision++;
    this.saveRevision++;
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

  createSave(): SaveGame<DiscoveryRecord> {
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      world: {
        seed: this.generated.seed,
        generatorVersion: WORLD_GENERATOR_VERSION,
        generationConfig: captureGenerationConfig(this.config),
        contentVersions: { fishingShoals: FISHING_SHOAL_CONTENT_VERSION },
      },
      generation: this.generation,
      expedition: {
        id: this.expeditionId,
        active: this.activeExpedition,
        pendingRespawn: this.pendingRespawn
          ? {
              expeditionId: this.pendingRespawn.expeditionId,
              generation: this.pendingRespawn.generation,
              forgottenTiles: this.pendingRespawn.forgottenTiles,
              wreckId: this.pendingRespawn.wreck.id,
              remainingSeconds: this.pendingRespawn.remainingSeconds,
            }
          : null,
      },
      ship: { ...this.ship },
      knowledge: {
        encoding: "non-unknown-runs-v1",
        runs: this.copyKnowledgeRunsForSave(),
      },
      wrecks: this.shipwrecks.map((wreck) => ({ ...wreck })),
      discoveries: {
        provisional: this.provisionalDiscoveries.map((discovery) => ({ ...discovery })),
        returned: this.returnedDiscoveries.map((discovery) => ({ ...discovery })),
      },
      fishingShoals: {
        provisional: this.provisionalFishingShoals.map((record) => ({ ...record })),
        returned: this.returnedFishingShoals.map((record) => ({ ...record })),
      },
      navigatorLineage: this.lineage.snapshot(),
      terrainPatches: [],
    };
  }

  /**
   * Restores authoritative state only. Base terrain and discovery definitions
   * are regenerated, while sight, movement caches and risk paths are rebuilt.
   */
  restoreSave(value: unknown): void {
    const parsed = parseSaveGame(value) as SaveGame<DiscoveryRecord>;
    const currentGenerationConfig = captureGenerationConfig(this.config);
    const savedGenerationConfig = captureGenerationConfig(applyGenerationConfig(
      parsed.world.generationConfig,
      parsed.world.seed,
    ));
    if (JSON.stringify(savedGenerationConfig) !== JSON.stringify(currentGenerationConfig)) {
      throw new SaveRestoreError("Saved world generation settings do not match this simulation configuration");
    }

    const generated = this.generator.generate(parsed.world.seed);
    const decoded = decodeKnowledgeRuns(generated.grid.tileCount, parsed.knowledge.runs);
    generated.grid.replaceKnowledge(decoded.knowledge, decoded.expeditionStamps);

    if (generated.grid.isMovementBlocked(parsed.ship.currentTileX, parsed.ship.currentTileY)) {
      throw new SaveRestoreError("Saved ship tile is blocked in the regenerated world");
    }
    const restoredDiscoveries = new DiscoverySystem(
      generated.grid,
      generated.seed,
      generated.islands,
    );
    try {
      restoredDiscoveries.restore(parsed.discoveries.provisional, parsed.discoveries.returned);
    } catch (error) {
      throw new SaveRestoreError(error instanceof Error ? error.message : "Saved discoveries are invalid");
    }
    const restoredFishingShoals = new FishingShoalSystem(
      generated.grid,
      generateFishingShoalCatalog(
        generated.grid,
        generated.seed,
        generated.landmarks.homeReturnTile,
        parsed.world.contentVersions.fishingShoals,
      ),
      generated.landmarks.homeReturnTile,
    );
    try {
      restoredFishingShoals.restore(
        parsed.fishingShoals.provisional,
        parsed.fishingShoals.returned,
      );
    } catch (error) {
      throw new SaveRestoreError(error instanceof Error ? error.message : "Saved fishing-shoal records are invalid");
    }

    const restoredWrecks = parsed.wrecks.map((wreck) => ({ ...wreck }));
    const restoredLineage = NavigatorLineageSystem.fromSnapshot(parsed.navigatorLineage);
    let pendingRespawn: PendingRespawnState | undefined;
    if (parsed.expedition.pendingRespawn) {
      const pending = parsed.expedition.pendingRespawn;
      const wreck = restoredWrecks.find(({ id }) => id === pending.wreckId);
      if (!wreck) throw new SaveRestoreError(`Pending wreck ${pending.wreckId} is missing`);
      pendingRespawn = {
        expeditionId: pending.expeditionId,
        generation: pending.generation,
        forgottenTiles: pending.forgottenTiles,
        wreck,
        remainingSeconds: pending.remainingSeconds,
      };
    }

    this.config.world.seed = parsed.world.seed;
    this.generated = generated;
    this.expeditionId = parsed.expedition.id;
    this.activeExpedition = parsed.expedition.active;
    this.lineage = restoredLineage;
    this.shipwrecks.length = 0;
    this.shipwrecks.push(...restoredWrecks);
    this.wrecksRevision++;
    this.pendingRespawn = pendingRespawn;
    this.ship = { ...parsed.ship };
    this.movement = new MovementSystem(this.world, this.config);
    this.visibility = new VisibilitySystem(this.world, this.config);
    this.knowledge = new KnowledgeSystem(this.world, this.config);
    this.provisions = new ProvisionSystem(this.world, this.config);
    this.forwardRanges = new ForwardRangeSystem(this.world, this.config);
    this.returnPathing = new ReturnPathSystem(this.world, this.config);
    this.riskResultsInitialized = false;
    this.discoverySystem = restoredDiscoveries;
    this.fishingShoalSystem = restoredFishingShoals;
    this.visibility.updateAt({ x: this.ship.currentTileX, y: this.ship.currentTileY });
    this.lastMovement = NO_MOVEMENT;
    this.recalculateRiskOverlays();
    this.lifecycleResolutionRevision++;
    this.revision++;
    this.saveRevision++;
    this.events.emit("gameLoaded", { schemaVersion: parsed.schemaVersion, seed: parsed.world.seed });
  }

  snapshot(): SimulationSnapshot {
    const knowledge = {
      supported: this.world.getKnowledgeCount(KnowledgeState.Supported),
      personal: this.world.getKnowledgeCount(KnowledgeState.Personal),
      unknown: this.world.getKnowledgeCount(KnowledgeState.Unknown),
      visibleNow: this.world.currentVisibleCount,
    };
    const risk = {
      budget: this.forwardRange.budget,
      forwardReachable: this.forwardRange.reachableCount,
      forwardFrontier: this.forwardRange.frontierCount,
      forwardHeading: this.forwardRange.presentationHeading,
      forwardConeHalfAngleDegrees: this.forwardRange.coneHalfAngleDegrees,
      comfortable: this.returnPaths.riskCounts.comfortable,
      warning: this.returnPaths.riskCounts.warning,
      critical: this.returnPaths.riskCounts.critical,
      impossible: this.returnPaths.riskCounts.impossible,
      returnPathTiles: this.returnPaths.pathIndices.length,
      returnCorridorTiles: this.returnPaths.corridorIndices.length,
      returnLevel: this.returnPaths.riskLevel,
      returnCost: Number.isFinite(this.returnPaths.returnCost) ? this.returnPaths.returnCost : null,
      returnMargin: Number.isFinite(this.returnPaths.returnMargin) ? this.returnPaths.returnMargin : null,
      stranded: this.stranded,
    };
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
        generation: this.generation,
        successfulReturns: this.successfulReturns,
        failures: this.failedExpeditions,
        atDock: this.atDock,
        wreckPresentationActive: this.wreckPresentationActive,
        respawnSecondsRemaining: this.respawnSecondsRemaining,
        pendingWreckId: this.pendingWreckId,
      },
      navigator: { ...this.currentNavigator },
      lineage: this.navigatorLineage.map((navigator) => ({ ...navigator })),
      wrecks: this.shipwrecks.map((wreck) => ({ ...wreck })),
      discoveries: {
        available: this.discoveryDefinitions.length,
        provisional: this.provisionalDiscoveries.length,
        returned: this.returnedDiscoveries.length,
        records: this.discoveries.map((discovery) => ({ ...discovery })),
      },
      fishingShoals: {
        available: this.fishingShoalDefinitions.length,
        provisional: this.provisionalFishingShoals.length,
        returned: this.returnedFishingShoals.length,
        activationEligible: this.activationEligibleFishingShoals.length,
        surveyCasesRemaining: this.surveyCasesRemaining,
        interaction: this.fishingShoalInteraction
          ? { ...this.fishingShoalInteraction, tile: { ...this.fishingShoalInteraction.tile } }
          : undefined,
        records: this.fishingShoalReadModels.map((model) => ({
          ...model,
          tile: { ...model.tile },
          clue: { ...model.clue },
        })),
      },
      debug: { ...this.debug },
    };
  }

  private startExpedition(): void {
    if (this.activeExpedition || this.pendingRespawn) return;
    this.activeExpedition = true;
    this.events.emit("expeditionStarted", {
      expeditionId: this.expeditionId,
      generation: this.generation,
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
    const generation = this.generation;
    const navigatorId = this.currentNavigator.id;
    const committed = this.knowledge.commitExpedition(expeditionId);
    const returnedDiscoveries = this.discoverySystem.commitExpedition(expeditionId);
    const returnedFishingShoals = this.fishingShoalSystem.commitExpedition(expeditionId);
    this.activeExpedition = false;
    this.advanceExpeditionId();
    const voyage = this.lineage.completeSuccessfulVoyage();
    this.events.emit("expeditionReturned", {
      expeditionId,
      generation,
      navigatorId,
      voyageNumber: voyage.completedVoyages,
      voyagesRemaining: voyage.remainingVoyages,
      tenureCompleted: voyage.tenureCompleted,
      supportedTileCount: committed.changedCount - (committed.closedUnknownCount ?? 0),
      closedUnknownTileCount: committed.closedUnknownCount ?? 0,
    });
    if (returnedDiscoveries.length > 0) {
      this.events.emit("discoveriesReturned", {
        expeditionId,
        generation,
        discoveries: returnedDiscoveries,
      });
    }
    if (returnedFishingShoals.leads.length > 0 || returnedFishingShoals.surveys.length > 0) {
      this.events.emit("fishingShoalsReturned", {
        expeditionId,
        generation,
        leads: returnedFishingShoals.leads,
        surveys: returnedFishingShoals.surveys,
      });
    }
    this.replenishCurrentShip("return", true);
    if (voyage.status === "tenure-completed") {
      this.events.emit("generationAdvanced", {
        previousGeneration: generation,
        previousNavigatorId: navigatorId,
        generation: voyage.successor.generation,
        navigatorId: voyage.successor.id,
        reason: "tenure",
      });
      this.events.emit("navigatorTenureCompleted", {
        navigatorId,
        generation,
        completedVoyages: voyage.completedVoyages,
        nextNavigatorId: voyage.successor.id,
        nextGeneration: voyage.successor.generation,
      });
    }
    this.lifecycleResolutionRevision++;
    return committed.changedCount;
  }

  private failExpedition(): number {
    const expeditionId = this.expeditionId;
    const generation = this.generation;
    const lostShip = this.ship;
    const wreckId = this.shipwrecks.reduce((maximum, wreck) => Math.max(maximum, wreck.id), 0) + 1;
    if (!Number.isSafeInteger(wreckId)) throw new RangeError("No safe shipwreck identifier remains");
    const wreck: ShipwreckState = {
      id: wreckId,
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
    this.wrecksRevision++;
    const reverted = this.knowledge.revertExpedition(expeditionId);
    const lostDiscoveries = this.discoverySystem.revertExpedition(expeditionId);
    const lostFishingShoals = this.fishingShoalSystem.revertExpedition(expeditionId);
    const previousProvisions = lostShip.provisions;
    lostShip.provisions = 0;
    lostShip.provisionAccumulator = 0;
    lostShip.speed = 0;
    this.activeExpedition = false;
    this.pendingRespawn = {
      expeditionId,
      generation,
      forgottenTiles: reverted.changedCount,
      wreck,
      remainingSeconds: this.config.simulation.wreckPresentationSeconds,
    };
    this.lineage.beginSuccession("wreck", wreck.id);
    this.lastMovement = NO_MOVEMENT;
    this.lifecycleResolutionRevision++;
    if (previousProvisions !== 0) {
      this.events.emit("provisionsChanged", { previous: previousProvisions, current: 0 });
    }
    this.events.emit("shipWrecked", {
      wreckId: wreck.id,
      expeditionId,
      generation,
      tileX: wreck.tileX,
      tileY: wreck.tileY,
      worldX: wreck.worldX,
      worldY: wreck.worldY,
    });
    if (lostDiscoveries.length > 0) {
      this.events.emit("discoveriesLost", {
        expeditionId,
        generation,
        discoveries: lostDiscoveries,
      });
    }
    if (lostFishingShoals.length > 0) {
      this.events.emit("fishingShoalsLost", {
        expeditionId,
        generation,
        records: lostFishingShoals,
      });
    }
    return reverted.changedCount;
  }

  private advanceWreckPresentation(deltaSeconds: number): MovementResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("deltaSeconds must be finite and non-negative");
    }
    const pending = this.pendingRespawn;
    if (!pending) return NO_MOVEMENT;

    this.ship.speed = 0;
    this.lastMovement = NO_MOVEMENT;
    if (deltaSeconds === 0) return NO_MOVEMENT;

    pending.remainingSeconds = Math.max(0, pending.remainingSeconds - deltaSeconds);
    if (pending.remainingSeconds <= 1e-9) this.completePendingRespawn(pending);
    this.saveRevision++;
    return NO_MOVEMENT;
  }

  private completePendingRespawn(pending: PendingRespawnState): void {
    this.pendingRespawn = undefined;
    this.world.clearVisibility();
    const succession = this.lineage.pendingSuccession;
    if (!succession || succession.reason !== "wreck" || succession.resolutionId !== pending.wreck.id) {
      throw new RangeError("Pending wreck does not match navigator succession");
    }
    const advanced = this.lineage.completeSuccession(succession.key);
    this.advanceExpeditionId();

    this.ship = createShipStateAtGrid(
      this.generated.landmarks.homeReturnTile,
      this.config.provisions.startingBundles,
      0,
      this.config,
    );
    this.visibility.updateAt(this.generated.landmarks.homeReturnTile);
    this.lastMovement = NO_MOVEMENT;
    this.recalculateRiskOverlays();
    this.lifecycleResolutionRevision++;
    this.revision++;
    this.events.emit("generationAdvanced", {
      previousGeneration: pending.generation,
      previousNavigatorId: advanced.transition.fromNavigatorId,
      generation: this.generation,
      navigatorId: advanced.navigator.id,
      reason: "wreck",
    });
    this.emitReplenishment(
      0,
      0,
      this.ship.provisions,
      "respawn",
      true,
    );
    this.events.emit("expeditionFailed", {
      expeditionId: pending.expeditionId,
      generation: pending.generation,
      forgottenTiles: pending.forgottenTiles,
      nextGeneration: this.generation,
      wreck: { ...pending.wreck },
    });
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
        generation: this.generation,
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

  private discoverVisibleWrecks(): number {
    let discoveredCount = 0;
    for (const wreck of this.shipwrecks) {
      if (wreck.discovered || !this.world.isVisibleNow(wreck.tileX, wreck.tileY)) continue;
      wreck.discovered = true;
      discoveredCount++;
      this.events.emit("wreckDiscovered", {
        wreckId: wreck.id,
        generation: wreck.generation,
        tileX: wreck.tileX,
        tileY: wreck.tileY,
      });
    }
    if (discoveredCount > 0) this.wrecksRevision++;
    return discoveredCount;
  }

  private observeDiscoveries(): number {
    if (!this.activeExpedition || this.pendingRespawn) return 0;
    const observation = this.discoverySystem.observeCurrentSight(
      this.expeditionId,
      this.generation,
    );
    for (const discovery of observation.found) this.events.emit("discoveryFound", discovery);
    return observation.found.length;
  }

  private observeFishingShoals(): number {
    if (!this.activeExpedition || this.pendingRespawn) return 0;
    const observation = this.fishingShoalSystem.observeCurrentSight(
      this.expeditionId,
      this.generation,
    );
    for (const record of observation.found) {
      const definition = this.fishingShoalSystem.definitionFor(record.id);
      if (!definition) continue;
      this.events.emit("fishingShoalSighted", {
        id: definition.id,
        tile: definition.tile,
        clue: definition.clue,
      });
    }
    return observation.found.length;
  }

  private copyKnowledgeRunsForSave(): KnowledgeRun[] {
    const world = this.world;
    if (
      !this.knowledgeSaveCache
      || this.knowledgeSaveCache.world !== world
      || this.knowledgeSaveCache.knowledgeVersion !== world.knowledgeVersion
    ) {
      this.knowledgeSaveCache = {
        world,
        knowledgeVersion: world.knowledgeVersion,
        runs: encodeWorldKnowledgeRuns(world),
      };
    }
    return this.knowledgeSaveCache.runs.map(([start, length, state, stamp]) => [start, length, state, stamp]);
  }

  private shipSaveStateChanged(previous: ShipState): boolean {
    return previous.worldX !== this.ship.worldX
      || previous.worldY !== this.ship.worldY
      || previous.heading !== this.ship.heading
      || previous.speed !== this.ship.speed
      || previous.currentTileX !== this.ship.currentTileX
      || previous.currentTileY !== this.ship.currentTileY
      || previous.provisions !== this.ship.provisions
      || previous.provisionAccumulator !== this.ship.provisionAccumulator;
  }

  private recalculateRiskOverlays(): void {
    if (this.riskResultsInitialized) {
      this.forwardRange = this.forwardRanges.recalculate(this.forwardRange, this.ship);
      this.returnPaths = this.returnPathing.recalculate(this.returnPaths, this.ship);
    } else {
      this.forwardRange = this.forwardRanges.calculate(this.ship);
      this.returnPaths = this.returnPathing.calculate(this.ship);
      this.riskResultsInitialized = true;
    }
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

  private updateRiskOverlayHeading(): void {
    if (!this.forwardRanges.updateHeading(this.forwardRange, this.ship)) return;
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
  }
}
