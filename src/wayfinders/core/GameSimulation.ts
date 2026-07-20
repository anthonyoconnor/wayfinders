import {
  prototypeConfig,
  type PrototypeConfig,
} from "../config/prototypeConfig";
import { PILOT_COLLISION_PROFILE_REGISTRY } from "../assets/CollisionProfileRegistry";
import type { AuthoredIslandCatalog } from "../world/AuthoredIslandCatalog";
import { ForwardRangeSystem, type ForwardRangeResult } from "../exploration/ForwardRangeSystem";
import type {
  ForwardGuidance,
  ForwardGuidanceSource,
  ForwardGuidanceStatus,
  ForwardGuidanceTask,
  ForwardGuidanceTelemetry,
} from "../exploration/ForwardGuidance";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  FISHING_SHOAL_INTERACTION_RANGE_TILES,
  type FishingShoalDefinition,
  type FishingShoalInteractionCommandV1,
  type FishingShoalInteractionReadModel,
  type FishingShoalInteractionResultV1,
  type FishingShoalProvisionalRecordV1,
  type FishingShoalReadModel,
  type FishingShoalReturnedRecordV1,
} from "../exploration/FishingShoalContracts";
import {
  createGeneratedFishingFeature,
  type FishingFeatureSystem,
} from "../features/fishing";
import {
  ISLAND_DOSSIER_CONTRACT_VERSION,
  ISLAND_DOSSIER_INTERACTION_RANGE_TILES,
  type IslandDossierDefinitionV1,
  type IslandDossierInteractionCommandV1,
  type IslandDossierInteractionReadModelV1,
  type IslandDossierInteractionResultV1,
  type IslandDossierProvisionalRecordV1,
  type IslandDossierReadModelV1,
  type IslandDossierReturnedRecordV1,
  type IslandDossierSurveyRejectionReasonV1,
} from "../exploration/IslandDossierContracts";
import { generateIslandDossierCatalog } from "../exploration/IslandDossierCatalog";
import { IslandDossierSystem } from "../exploration/IslandDossierSystem";
import { generateIdolLocationCatalog } from "../exploration/IdolLocationCatalog";
import type {
  IdolLocationDefinition,
  IdolLocationHostRef,
} from "../exploration/IdolLocationContracts";
import { KnowledgeSystem } from "../exploration/KnowledgeSystem";
import {
  ProvisionSystem,
  availableProvisionUnits,
  knowledgeTravelCost,
} from "../exploration/ProvisionSystem";
import { ReturnPathSystem, type ReturnPathResult } from "../exploration/ReturnPathSystem";
import type { ReturnQuery } from "../exploration/ReturnQuery";
import { VisibilitySystem } from "../exploration/VisibilitySystem";
import {
  createSurveyBudget,
  type SurveyBudgetReadModel,
} from "../exploration/SurveyContracts";
import { generateSurveySiteCatalog } from "../exploration/SurveySiteCatalog";
import {
  SURVEY_SITE_CONTRACT_VERSION,
  SURVEY_SITE_INTERACTION_RANGE_TILES,
  type SurveySiteDefinition,
  type SurveySiteId,
  type SurveySiteInteractionCommand,
  type SurveySiteInteractionReadModel,
  type SurveySiteInteractionResult,
  type SurveySiteProvisionalRecord,
  type SurveySiteReadModel,
  type SurveySiteRejectionReason,
  type SurveySiteReturnedRecord,
} from "../exploration/SurveySiteContracts";
import { SurveySiteSystem } from "../exploration/SurveySiteSystem";
import {
  WRECK_SURVEY_CONTRACT_VERSION,
  WRECK_SURVEY_INTERACTION_RANGE_TILES,
  WRECK_SURVEY_PRESENTATION_MS,
  type WreckSurveyReportV1,
  type WreckSurveyInteractionCommandV1,
  type WreckSurveyInteractionReadModelV1,
  type WreckSurveyInteractionResultV1,
  type WreckSurveyRejectionReasonV1,
} from "../exploration/WreckSurveyContracts";
import { MovementSystem, createShipStateAtGrid } from "../navigation/MovementSystem";
import type { MovementAuthority } from "../navigation/MovementAuthority";
import { GridGraph } from "../navigation/GridGraph";
import {
  WorldDescriptorRegistry,
  boundsForWorldIndices,
  boundsForWorldPoints,
  createBoundsDescriptor,
  createPointDescriptor,
  type WorldDescriptorCandidates,
  type WorldDescriptorEntry,
} from "../app/WorldDescriptorRegistry";
import {
  NAVIGATOR_GENERATION_HANDOVER_VERSION,
  NAVIGATOR_VOYAGE_LIMIT,
  NavigatorLineageSystem,
  createNavigatorId,
  type NavigatorGenerationHandoverV1,
  type NavigatorRecordV6,
  type NavigatorVoyageAchievementInputV3,
} from "../lineage/NavigatorLineageSystem";
import type { GeneratedWorld } from "../world/WorldGenerator";
import { WorldGenerator } from "../world/WorldGenerator";
import type { WorldGrid } from "../world/WorldGrid";
import { worldToGrid } from "../world/CoordinateSystem";
import { KnowledgeState } from "../world/TileData";
import { GameEvents, type ReplenishmentReason } from "./GameEvents";
import {
  measureSimulationPhase,
  type SimulationTraceSink,
} from "./SimulationTrace";
import type {
  GridPoint,
  MovementInput,
  MovementResult,
  ShipState,
  ShipwreckState,
  WorldPoint,
} from "./types";

export type GameCompletionState = "in-progress" | "awaiting-choice" | "continued";

export interface IdolLocationProgress {
  readonly total: number;
  readonly provisional: number;
  readonly returned: number;
  readonly complete: boolean;
  readonly completionState: GameCompletionState;
}

export interface SimulationSnapshot {
  seed: number;
  ship: Readonly<ShipState>;
  tile: GridPoint;
  world: { width: number; height: number };
  knowledge: { supported: number; personal: number; unknown: number; visibleNow: number };
  risk: {
    forwardAvailable: boolean;
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
    pendingGenerationHandover: Readonly<NavigatorGenerationHandoverV1> | null;
  };
  navigator: Readonly<NavigatorRecordV6>;
  lineage: readonly Readonly<NavigatorRecordV6>[];
  wrecks: readonly Readonly<ShipwreckState>[];
  islandDossiers: {
    available: number;
    provisional: number;
    returned: number;
    revealed: number;
    interaction?: Readonly<IslandDossierInteractionReadModelV1>;
    records: readonly Readonly<IslandDossierReadModelV1>[];
  };
  surveySites: {
    available: number;
    provisional: number;
    returned: number;
    interaction?: Readonly<SurveySiteInteractionReadModel>;
    records: readonly Readonly<SurveySiteReadModel>[];
  };
  fishingShoals: {
    available: number;
    provisional: number;
    returned: number;
    activationEligible: number;
    surveyCost: number;
    interaction?: Readonly<FishingShoalInteractionReadModel>;
    records: readonly Readonly<FishingShoalReadModel>[];
  };
  idolLocations: Readonly<IdolLocationProgress>;
}

export interface GameSimulationOptions {
  /** Snapshot used only when creating or regenerating a world. */
  readonly authoredIslandCatalog?: Readonly<AuthoredIslandCatalog>;
  /** Enables the optional, derived forward-range scheduler. */
  readonly forwardGuidanceEnabled?: boolean;
  /** Main-thread wall-clock target for one cooperative guidance slice. */
  readonly forwardGuidanceSliceBudgetMs?: number;
  /** Deterministic safety cap in addition to the wall-clock target. */
  readonly forwardGuidanceWorkUnitsPerSlice?: number;
  /** Injectable monotonic clock for deterministic scheduler tests. */
  readonly forwardGuidanceNow?: () => number;
}

const DEFAULT_FORWARD_GUIDANCE_SLICE_BUDGET_MS = 3;
const DEFAULT_FORWARD_GUIDANCE_WORK_UNITS = 49_152;

function emptyForwardRange(
  ship: Pick<ShipState, "heading" | "provisions" | "provisionAccumulator">,
  config: PrototypeConfig,
): ForwardRangeResult {
  return {
    mask: new Uint8Array(0),
    presentationMask: new Uint8Array(0),
    costs: new Float64Array(0),
    budget: availableProvisionUnits(ship),
    reachableCount: 0,
    frontierCount: 0,
    presentationHeading: ship.heading,
    coneHalfAngleDegrees: config.overlays.forwardConeHalfAngleDegrees,
    candidateIndices: Object.freeze([]),
    presentationCandidateIndices: Object.freeze([]),
    logicalRevision: 0,
  };
}

const NO_MOVEMENT: MovementResult = {
  movedDistancePixels: 0,
  liftedDisplacement: { x: 0, y: 0 },
  worldImageOffset: { x: 0, y: 0 },
  collided: false,
  enteredTiles: [],
  segments: [],
  tileChanged: false,
};

const NO_DESCRIPTOR_CANDIDATES: WorldDescriptorCandidates = Object.freeze({
  fishingShoalIds: Object.freeze([]),
  surveySiteIds: Object.freeze([]),
  islandDossierIds: Object.freeze([]),
  wreckIds: Object.freeze([]),
});

const MAX_INTERACTION_QUERY_RADIUS = Math.max(
  FISHING_SHOAL_INTERACTION_RANGE_TILES,
  ISLAND_DOSSIER_INTERACTION_RANGE_TILES,
  SURVEY_SITE_INTERACTION_RANGE_TILES,
  WRECK_SURVEY_INTERACTION_RANGE_TILES,
);

/** Advances within the effective uint32 seed space and never repeats the prior world. */
export function createNextWorldSeed(previousSeed: number): number {
  const current = Math.trunc(previousSeed) >>> 0;
  let next = (Math.imul(current, 1_664_525) + 1_013_904_223) >>> 0;
  if (next === current) next = (current + 1) >>> 0;
  return next;
}

interface PendingRespawnState {
  expeditionId: number;
  generation: number;
  forgottenTiles: number;
  wreck: ShipwreckState;
  remainingSeconds: number;
}

/**
 * Phaser-independent owner of the live prototype state. Presentation adapters
 * may read it, but all state changes go through this class or its systems.
 */
export class GameSimulation {
  readonly events = new GameEvents();
  readonly config: PrototypeConfig;

  generated!: GeneratedWorld;
  ship!: ShipState;
  lastMovement: MovementResult = NO_MOVEMENT;
  revision = 0;
  /** Monotonic collection key for renderers that display permanent wrecks. */
  wrecksRevision = 0;
  overlaysRevision = 0;
  lifecycleResolutionRevision = 0;
  forwardRange!: ForwardRangeResult;
  returnPaths!: ReturnPathResult;

  private movement!: MovementAuthority;
  private visibility!: VisibilitySystem;
  private knowledge!: KnowledgeSystem;
  private provisions!: ProvisionSystem;
  private forwardRanges?: ForwardGuidance;
  private returnPathing!: ReturnQuery;
  private islandDossierSystem!: IslandDossierSystem;
  private surveySiteSystem!: SurveySiteSystem;
  private fishingFeature!: FishingFeatureSystem;
  private descriptorRegistry!: WorldDescriptorRegistry;
  private interactionCandidateCache?: {
    readonly x: number;
    readonly y: number;
    readonly spatialRevision: number;
    readonly candidates: WorldDescriptorCandidates;
  };
  private visibleCandidateCache?: {
    readonly visibilityRevision: number;
    readonly spatialRevision: number;
    readonly candidates: WorldDescriptorCandidates;
  };
  private idolLocationDefinitionsValue: readonly Readonly<IdolLocationDefinition>[] = Object.freeze([]);
  private readonly generator: WorldGenerator;
  private expeditionId = 1;
  private activeExpedition = false;
  private lineage = new NavigatorLineageSystem();
  private readonly shipwrecks: ShipwreckState[] = [];
  private pendingRespawn?: PendingRespawnState;
  private pendingGenerationHandoverValue?: Readonly<NavigatorGenerationHandoverV1>;
  private completionStateValue: GameCompletionState = "in-progress";
  private interactionTransactionActive = false;
  private riskResultsInitialized = false;
  private readonly trace: SimulationTraceSink | undefined;
  private readonly forwardGuidanceSliceBudgetMs: number;
  private readonly forwardGuidanceWorkUnitsPerSlice: number;
  private readonly forwardGuidanceNow: () => number;
  private forwardGuidanceEnabledValue: boolean;
  private forwardGuidanceAvailable = false;
  private forwardGuidancePending = false;
  private forwardGuidanceRequestId = 0;
  private forwardGuidanceAppliedRequestId = 0;
  private forwardGuidanceWorldEpoch = 0;
  private forwardGuidanceTask?: {
    readonly requestId: number;
    readonly source: ForwardGuidanceSource;
    readonly task: ForwardGuidanceTask;
    slices: number;
  };
  private readonly forwardGuidanceTelemetryValue = {
    requests: 0,
    jobsStarted: 0,
    jobsCompleted: 0,
    jobsCancelled: 0,
    requestsCoalesced: 0,
    staleResultsDiscarded: 0,
    slices: 0,
    lastSliceWorkUnits: 0,
    maxSliceWorkUnits: 0,
    lastRequestSlices: 0,
    maxRequestSlices: 0,
  } satisfies Record<keyof ForwardGuidanceTelemetry, number>;
  private forwardGuidanceSourceValue: ForwardGuidanceSource = Object.freeze({
    requestId: 0,
    worldEpoch: 0,
    worldRevision: 0,
    knowledgeRevision: 0,
    visibilityRevision: 0,
    originX: 0,
    originY: 0,
    provisionUnits: 0,
  });

  constructor(
    config: PrototypeConfig = prototypeConfig,
    trace?: SimulationTraceSink,
    options: Readonly<GameSimulationOptions> = {},
  ) {
    this.trace = trace;
    this.forwardGuidanceEnabledValue = options.forwardGuidanceEnabled ?? false;
    this.forwardGuidanceSliceBudgetMs = options.forwardGuidanceSliceBudgetMs
      ?? DEFAULT_FORWARD_GUIDANCE_SLICE_BUDGET_MS;
    if (
      !Number.isFinite(this.forwardGuidanceSliceBudgetMs)
      || this.forwardGuidanceSliceBudgetMs <= 0
    ) {
      throw new RangeError("forwardGuidanceSliceBudgetMs must be finite and positive");
    }
    this.forwardGuidanceWorkUnitsPerSlice = options.forwardGuidanceWorkUnitsPerSlice
      ?? DEFAULT_FORWARD_GUIDANCE_WORK_UNITS;
    if (
      !Number.isSafeInteger(this.forwardGuidanceWorkUnitsPerSlice)
      || this.forwardGuidanceWorkUnitsPerSlice <= 0
    ) {
      throw new RangeError("forwardGuidanceWorkUnitsPerSlice must be a positive safe integer");
    }
    this.forwardGuidanceNow = options.forwardGuidanceNow
      ?? (() => globalThis.performance?.now() ?? Date.now());
    this.config = {
      ...config,
      movement: PILOT_COLLISION_PROFILE_REGISTRY.createAuthoritativeMovementView(
        config.movement,
      ),
    };
    this.generator = new WorldGenerator(this.config, options.authoredIslandCatalog);
    this.regenerate(this.config.world.seed);
  }

  get world(): WorldGrid {
    return this.generated.grid;
  }

  get forwardGuidanceStatus(): ForwardGuidanceStatus {
    return {
      enabled: this.forwardGuidanceEnabledValue,
      available: this.forwardGuidanceAvailable,
      pending: this.forwardGuidancePending,
      requestedId: this.forwardGuidanceRequestId,
      appliedId: this.forwardGuidanceAppliedRequestId,
      activeId: this.forwardGuidanceTask?.requestId,
      telemetry: { ...this.forwardGuidanceTelemetryValue },
      source: this.forwardGuidanceSourceValue,
    };
  }

  get forwardGuidancePresentationAvailable(): boolean {
    return this.forwardGuidanceAvailable;
  }

  /** Enables optional derived forward guidance only while its presentation is requested. */
  setForwardGuidanceEnabled(enabled: boolean): boolean {
    if (this.forwardGuidanceEnabledValue === enabled) return false;
    this.forwardGuidanceEnabledValue = enabled;
    if (!enabled) {
      this.cancelForwardGuidanceTask();
      this.forwardGuidancePending = false;
      this.forwardGuidanceAvailable = false;
      if (this.riskResultsInitialized) this.replaceForwardRangeWithEmpty();
    } else if (this.riskResultsInitialized) {
      this.forwardRanges ??= new ForwardRangeSystem(this.world, this.config);
      this.forwardGuidanceAvailable = false;
      this.requestForwardGuidance();
    }
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
    return true;
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

  get currentNavigator(): Readonly<NavigatorRecordV6> {
    return this.lineage.currentNavigator;
  }

  get navigatorLineage(): readonly Readonly<NavigatorRecordV6>[] {
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

  get pendingGenerationHandover(): Readonly<NavigatorGenerationHandoverV1> | undefined {
    return this.pendingGenerationHandoverValue;
  }

  get generationHandoverActive(): boolean {
    return this.pendingGenerationHandoverValue !== undefined;
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

  get provisionalWreckSurveys(): readonly Readonly<ShipwreckState>[] {
    return this.shipwrecks.filter(({ survey }) => survey.state === "provisional");
  }

  get returnedWreckSurveys(): readonly Readonly<ShipwreckState>[] {
    return this.shipwrecks.filter(({ survey }) => survey.state === "returned");
  }

  get islandDossierDefinitions(): readonly Readonly<IslandDossierDefinitionV1>[] {
    return this.islandDossierSystem.definitions;
  }

  get provisionalIslandDossiers(): readonly Readonly<IslandDossierProvisionalRecordV1>[] {
    return this.islandDossierSystem.provisional;
  }

  get returnedIslandDossiers(): readonly Readonly<IslandDossierReturnedRecordV1>[] {
    return this.islandDossierSystem.returned;
  }

  get islandDossierReadModels(): readonly Readonly<IslandDossierReadModelV1>[] {
    return this.islandDossierSystem.readModels();
  }

  get islandDossierRecordsRevision(): number {
    return this.islandDossierSystem.recordsRevision;
  }

  get islandFogRevealRevision(): number {
    return this.islandDossierSystem.fogRevealRevision;
  }

  get revealedIslandIds(): readonly number[] {
    return this.islandDossierSystem.revealedIslandIds;
  }

  get surveySiteDefinitions(): readonly Readonly<SurveySiteDefinition>[] {
    return this.surveySiteSystem.definitions;
  }

  get provisionalSurveySites(): readonly Readonly<SurveySiteProvisionalRecord>[] {
    return this.surveySiteSystem.provisional;
  }

  get returnedSurveySites(): readonly Readonly<SurveySiteReturnedRecord>[] {
    return this.surveySiteSystem.returned;
  }

  get surveySiteReadModels(): readonly Readonly<SurveySiteReadModel>[] {
    return this.surveySiteSystem.readModels(
      this.visibleDescriptorCandidates().surveySiteIds,
    );
  }

  get surveySiteRecordsRevision(): number {
    return this.surveySiteSystem.recordsRevision;
  }

  /** Hidden deterministic authority; player-facing read models expose only discovered hosts. */
  get idolLocationDefinitions(): readonly Readonly<IdolLocationDefinition>[] {
    return this.idolLocationDefinitionsValue;
  }

  get provisionalIdolLocations(): readonly Readonly<IdolLocationDefinition>[] {
    return Object.freeze(this.idolLocationDefinitionsValue.filter((definition) => (
      this.idolLocationHostIsProvisional(definition.host)
    )));
  }

  get returnedIdolLocations(): readonly Readonly<IdolLocationDefinition>[] {
    return Object.freeze(this.idolLocationDefinitionsValue.filter((definition) => (
      this.idolLocationHostIsReturned(definition.host)
    )));
  }

  get idolLocationProgress(): Readonly<IdolLocationProgress> {
    const provisional = this.provisionalIdolLocations.length;
    const returned = this.returnedIdolLocations.length;
    const total = this.idolLocationDefinitionsValue.length;
    return Object.freeze({
      total,
      provisional,
      returned,
      complete: returned === total,
      completionState: this.completionStateValue,
    });
  }

  get completionState(): GameCompletionState {
    return this.completionStateValue;
  }

  get completionChoiceActive(): boolean {
    return this.completionStateValue === "awaiting-choice";
  }

  get fishingShoalDefinitions(): readonly Readonly<FishingShoalDefinition>[] {
    return this.fishingFeature.definitions;
  }

  get provisionalFishingShoals(): readonly Readonly<FishingShoalProvisionalRecordV1>[] {
    return this.fishingFeature.provisional;
  }

  get returnedFishingShoals(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    return this.fishingFeature.returned;
  }

  get activationEligibleFishingShoals(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    return this.fishingFeature.activationEligible;
  }

  get fishingShoalConnectivityBuildCount(): number {
    return this.fishingFeature.connectivityBuildCount;
  }

  get fishingShoalReadModels(): readonly Readonly<FishingShoalReadModel>[] {
    return this.fishingFeature.readModels(
      this.visibleDescriptorCandidates().fishingShoalIds,
    );
  }

  get fishingShoalRecordsRevision(): number {
    return this.fishingFeature.recordsRevision;
  }

  get descriptorSpatialQueryTotals() {
    return this.descriptorRegistry.queryTotals();
  }

  get surveyBudget(): Readonly<SurveyBudgetReadModel> {
    return createSurveyBudget(
      this.config.provisions.surveyCost,
      availableProvisionUnits(this.ship),
      this.returnPaths.returnCost,
    );
  }

  get fishingShoalInteraction(): Readonly<FishingShoalInteractionReadModel> | undefined {
    if (this.pendingRespawn || this.pendingGenerationHandoverValue || this.completionChoiceActive) return undefined;
    return this.fishingFeature.interactionNear({
      x: this.ship.currentTileX,
      y: this.ship.currentTileY,
    }, this.surveyBudget, this.interactionCandidates().fishingShoalIds);
  }

  get islandDossierInteraction(): Readonly<IslandDossierInteractionReadModelV1> | undefined {
    if (this.pendingRespawn || this.pendingGenerationHandoverValue || this.completionChoiceActive) return undefined;
    return this.islandDossierSystem.interactionNear({
      x: this.ship.currentTileX,
      y: this.ship.currentTileY,
    }, this.surveyBudget, this.interactionCandidates().islandDossierIds);
  }

  get surveySiteInteraction(): Readonly<SurveySiteInteractionReadModel> | undefined {
    if (this.pendingRespawn || this.pendingGenerationHandoverValue || this.completionChoiceActive) return undefined;
    return this.surveySiteSystem.interactionNear({
      x: this.ship.currentTileX,
      y: this.ship.currentTileY,
    }, this.surveyBudget, this.interactionCandidates().surveySiteIds);
  }

  get wreckSurveyInteraction(): Readonly<WreckSurveyInteractionReadModelV1> | undefined {
    if (this.pendingRespawn || this.pendingGenerationHandoverValue || this.completionChoiceActive) return undefined;
    let closest: { wreck: ShipwreckState; distance: number } | undefined;
    for (const wreckId of this.interactionCandidates().wreckIds) {
      const wreck = this.shipwrecks.find(({ id }) => id === wreckId);
      if (!wreck) continue;
      if (
        !wreck.discovered
        || wreck.survey.state !== "unexamined"
        || wreck.generation >= this.generation
      ) continue;
      const distanceSquared = this.wreckDistanceSquared(wreck);
      if (distanceSquared > WRECK_SURVEY_INTERACTION_RANGE_TILES ** 2) continue;
      if (
        closest
        && (
          distanceSquared > closest.distance
          || (distanceSquared === closest.distance && wreck.id > closest.wreck.id)
        )
      ) continue;
      closest = { wreck, distance: distanceSquared };
    }
    if (!closest) return undefined;
    return Object.freeze({
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      wreckId: closest.wreck.id,
      tile: Object.freeze({ x: closest.wreck.tileX, y: closest.wreck.tileY }),
      ...this.surveyBudget,
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
    if (this.interactionTransactionActive) return NO_MOVEMENT;
    if (this.pendingRespawn) return this.advanceWreckPresentation(deltaSeconds);
    if (this.pendingGenerationHandoverValue || this.completionChoiceActive) {
      this.ship.speed = 0;
      this.lastMovement = NO_MOVEMENT;
      return NO_MOVEMENT;
    }
    const previousTile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    const previousWorld = { x: this.ship.worldX, y: this.ship.worldY };
    const previousHeading = this.ship.heading;
    const previousKnowledge = this.world.getKnowledge(previousTile.x, previousTile.y);
    const previousBundles = this.ship.provisions;
    const movementInput = this.stranded ? { turn: input.turn, throttle: 0 } : input;
    const movement = measureSimulationPhase(
      this.trace,
      "movement",
      () => this.movement.update(this.ship, movementInput, deltaSeconds),
    );
    const headingChanged = this.ship.heading !== previousHeading;
    this.lastMovement = movement;
    const crossedCenters = this.liftedCrossedCenters(previousTile, previousWorld, movement);
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
        && (
          currentKnowledgeBeforeObservation !== KnowledgeState.Supported
          || movement.enteredTiles.some(({ x, y }) => (
            this.world.getKnowledge(x, y) !== KnowledgeState.Supported
          ))
        )
      ) {
        this.startExpedition();
        lifecycleChanged = true;
      }

      measureSimulationPhase(this.trace, "observation", () => {
        const visibility = this.visibility.updateForCrossedCenters(crossedCenters);
        const knowledge = this.knowledge.applyTrailingVisibility(visibility, this.expeditionId);
        knowledgeChanged += knowledge.changedCount;
        const visibleCandidates = this.visibleDescriptorCandidates();
        this.observeIslandDossiers();
        if (this.observeSurveySites(visibleCandidates.surveySiteIds) > 0) lifecycleChanged = true;
        if (this.observeFishingShoals(visibleCandidates.fishingShoalIds) > 0) lifecycleChanged = true;
        this.discoverVisibleWrecks(visibleCandidates.wreckIds);
        this.events.emit("shipEnteredTile", currentTile);

        if (this.atDock) {
          knowledgeChanged += this.resolveDockArrival();
          lifecycleChanged = true;
        }
      });
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
    return this.lastMovement;
  }

  regenerate(seed = this.config.world.seed): void {
    if (this.interactionTransactionActive) return;
    this.cancelForwardGuidanceTask();
    this.forwardGuidanceWorldEpoch++;
    PILOT_COLLISION_PROFILE_REGISTRY.assertMovementConfigCompatible(this.config);
    const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : this.config.world.seed;
    this.generated = measureSimulationPhase(
      this.trace,
      "world-generation",
      () => {
        const planned = measureSimulationPhase(
          this.trace,
          "manifest-generation",
          () => this.generator.plan(normalizedSeed),
        );
        const rasterized = measureSimulationPhase(
          this.trace,
          "logical-rasterization",
          () => this.generator.rasterize(planned),
        );
        const analysis = measureSimulationPhase(
          this.trace,
          "world-analysis",
          () => this.generator.analyze(rasterized),
        );
        const water = this.generator.planWater(rasterized, analysis);
        return { ...rasterized, analysis, water };
      },
    );
    this.expeditionId = 1;
    this.activeExpedition = false;
    this.lineage = new NavigatorLineageSystem();
    this.shipwrecks.length = 0;
    this.wrecksRevision++;
    this.pendingRespawn = undefined;
    this.pendingGenerationHandoverValue = undefined;
    this.ship = createShipStateAtGrid(
      this.generated.landmarks.dock,
      this.config.provisions.startingBundles,
      0,
      this.config,
    );
    this.forwardGuidancePending = false;
    this.forwardGuidanceAvailable = false;
    this.forwardGuidanceRequestId = 0;
    this.forwardGuidanceAppliedRequestId = 0;
    this.forwardGuidanceTask = undefined;
    this.forwardGuidanceSourceValue = this.captureForwardGuidanceSource(0);
    this.movement = new MovementSystem(this.world, this.config);
    this.visibility = new VisibilitySystem(this.world, this.config);
    this.knowledge = new KnowledgeSystem(this.world, this.config);
    this.provisions = new ProvisionSystem(this.world, this.config);
    this.forwardRanges = this.forwardGuidanceEnabledValue
      ? new ForwardRangeSystem(this.world, this.config)
      : undefined;
    this.returnPathing = new ReturnPathSystem(this.world, this.config);
    this.descriptorRegistry = new WorldDescriptorRegistry(this.world.topology);
    this.interactionCandidateCache = undefined;
    this.visibleCandidateCache = undefined;
    this.riskResultsInitialized = false;
    measureSimulationPhase(this.trace, "feature-seeding", () => {
        this.islandDossierSystem = new IslandDossierSystem(
          this.world,
          generateIslandDossierCatalog(
            this.world,
            this.generated.seed,
            this.generated.islands,
            this.generated.landmarks.homeReturnTile,
            undefined,
            this.config,
            this.generated.analysis,
          ),
          this.config,
        );
        this.surveySiteSystem = new SurveySiteSystem(
          this.world,
          generateSurveySiteCatalog(
            this.world,
            this.generated.seed,
            this.generated.islands,
            this.generated.landmarks.homeReturnTile,
            undefined,
            this.config,
            this.generated.analysis,
          ),
          this.config,
        );
        this.idolLocationDefinitionsValue = generateIdolLocationCatalog(
          this.generated.seed,
          this.config.world.idolCount,
          this.islandDossierSystem.definitions,
          this.surveySiteSystem.definitions,
        );
        this.completionStateValue = "in-progress";
        this.fishingFeature = createGeneratedFishingFeature({
          world: this.world,
          seed: this.generated.seed,
          homeReturnTile: this.generated.landmarks.homeReturnTile,
          config: this.config,
          analysis: this.generated.analysis,
        });
        this.rebuildDescriptorRegistry();
    });
    measureSimulationPhase(this.trace, "playable-region", () => {
      this.visibility.updateAt(this.generated.landmarks.dock);
      this.recalculateRiskOverlays();
      this.lastMovement = NO_MOVEMENT;
    });
    this.lifecycleResolutionRevision++;
    this.revision++;
    this.events.emit("worldRegenerated", { seed: normalizedSeed });
  }

  teleport(tile: GridPoint): boolean {
    if (
      this.interactionTransactionActive
      || this.pendingRespawn
      || this.pendingGenerationHandoverValue
      || this.completionChoiceActive
    ) return false;
    if (!this.world.inBounds(tile.x, tile.y)) return false;
    if (!new GridGraph(this.world, this.config).isNavigationNodePassable(this.world.index(tile.x, tile.y))) {
      return false;
    }
    const targetKnowledge = this.world.getKnowledge(tile.x, tile.y);
    if (!this.activeExpedition && targetKnowledge !== KnowledgeState.Supported) this.startExpedition();

    this.movement.teleport(this.ship, tile);
    const visibility = this.visibility.updateAt(tile);
    let knowledgeChanged = this.knowledge.applyVisibility(visibility, this.expeditionId).changedCount;
    const visibleCandidates = this.visibleDescriptorCandidates();
    this.observeIslandDossiers();
    this.observeSurveySites(visibleCandidates.surveySiteIds);
    this.observeFishingShoals(visibleCandidates.fishingShoalIds);
    this.discoverVisibleWrecks(visibleCandidates.wreckIds);
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
    if (
      this.interactionTransactionActive
      || this.pendingRespawn
      || this.pendingGenerationHandoverValue
      || this.completionChoiceActive
    ) return;
    const tile = { x: this.ship.currentTileX, y: this.ship.currentTileY };
    if (!this.activeExpedition && !this.isInSupportedWater()) this.startExpedition();
    const visibility = this.visibility.updateAt(tile);
    const knowledge = this.knowledge.applyVisibility(visibility, this.expeditionId);
    const visibleCandidates = this.visibleDescriptorCandidates();
    this.observeIslandDossiers();
    this.observeSurveySites(visibleCandidates.surveySiteIds);
    this.observeFishingShoals(visibleCandidates.fishingShoalIds);
    this.discoverVisibleWrecks(visibleCandidates.wreckIds);
    this.recalculateRiskOverlays();
    this.revision++;
    if (knowledge.changedCount > 0) this.events.emit("knowledgeChanged", { count: knowledge.changedCount });
  }

  setProvisions(value: number): void {
    if (
      this.interactionTransactionActive
      || this.pendingRespawn
      || this.pendingGenerationHandoverValue
      || this.completionChoiceActive
    ) return;
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

  private applySurveyProvisionCharge(cost: number): void {
    if (!Number.isSafeInteger(cost) || cost <= 0) throw new RangeError("Survey cost must be a positive integer");
    if (availableProvisionUnits(this.ship) + 1e-10 < cost || this.ship.provisions < cost) {
      throw new RangeError("Survey provision charge exceeds the available supply");
    }
    const previous = this.ship.provisions;
    this.ship.provisions -= cost;
    for (let remaining = previous - 1; remaining >= this.ship.provisions; remaining--) {
      this.events.emit("provisionConsumed", { remaining });
    }
    this.events.emit("provisionsChanged", { previous, current: this.ship.provisions });
    this.updateRiskOverlayBudgets();
  }

  private resolveSurveyExhaustion(): void {
    if (this.ship.provisions > 0 || this.isInSupportedWater()) return;
    const knowledgeChanged = this.failExpedition();
    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    this.recalculateRiskOverlays();
  }

  interactWithIslandDossier(
    command: Readonly<IslandDossierInteractionCommandV1>,
  ): IslandDossierInteractionResultV1 {
    if (this.interactionTransactionActive) {
      return this.rejectIslandDossierSurvey(command.islandId, "interaction-busy");
    }
    if (this.completionChoiceActive) {
      return this.rejectIslandDossierSurvey(command.islandId, "interaction-busy");
    }
    if (this.pendingGenerationHandoverValue) {
      return this.rejectIslandDossierSurvey(command.islandId, "generation-handover");
    }
    if (this.pendingRespawn) {
      return this.rejectIslandDossierSurvey(command.islandId, "wreck-hold");
    }

    this.interactionTransactionActive = true;
    try {
      const result = this.islandDossierSystem.applyInteraction(command, {
        x: this.ship.currentTileX,
        y: this.ship.currentTileY,
      }, this.expeditionId, this.generation, this.surveyBudget);
      if (result.status !== "surveyed") return result;

      const expeditionStarted = !this.activeExpedition;
      if (expeditionStarted) this.activeExpedition = true;
      this.applySurveyProvisionCharge(result.provisionsSpent);
      const definition = this.islandDossierSystem.definitionFor(result.islandId);
      if (!definition) throw new Error(`Surveyed island ${result.islandId} has no dossier definition`);
      this.revision++;
      if (expeditionStarted) {
        this.events.emit("expeditionStarted", {
          expeditionId: this.expeditionId,
          generation: this.generation,
        });
      }
      this.events.emit("islandDossierSurveyed", {
        ...result,
        canonicalApproach: definition.canonicalApproach,
      });
      const idolLocation = this.idolLocationForHost({
        kind: "island-dossier",
        islandId: result.islandId,
      });
      if (idolLocation) {
        this.events.emit("idolLocationDiscovered", {
          expeditionId: this.expeditionId,
          generation: this.generation,
          location: idolLocation,
          provisionsSpent: result.provisionsSpent,
          presentationMs: result.presentationMs,
        });
      }
      this.resolveSurveyExhaustion();
      return result;
    } finally {
      this.interactionTransactionActive = false;
    }
  }

  interactWithSurveySite(
    command: Readonly<SurveySiteInteractionCommand>,
  ): SurveySiteInteractionResult {
    if (this.interactionTransactionActive) {
      return this.rejectSurveySiteSurvey(command.id, "interaction-busy");
    }
    if (this.completionChoiceActive) {
      return this.rejectSurveySiteSurvey(command.id, "interaction-busy");
    }
    if (this.pendingGenerationHandoverValue) {
      return this.rejectSurveySiteSurvey(command.id, "generation-handover");
    }
    if (this.pendingRespawn) {
      return this.rejectSurveySiteSurvey(command.id, "wreck-hold");
    }

    this.interactionTransactionActive = true;
    try {
      const result = this.surveySiteSystem.applyInteraction(command, {
        x: this.ship.currentTileX,
        y: this.ship.currentTileY,
      }, this.expeditionId, this.generation, this.surveyBudget);
      if (result.status !== "surveyed") return result;

      const expeditionStarted = !this.activeExpedition;
      if (expeditionStarted) this.activeExpedition = true;
      this.applySurveyProvisionCharge(result.provisionsSpent);
      const definition = this.surveySiteSystem.definitionFor(result.id);
      if (!definition) throw new Error(`Surveyed site ${result.id} has no definition`);
      this.revision++;
      if (expeditionStarted) {
        this.events.emit("expeditionStarted", {
          expeditionId: this.expeditionId,
          generation: this.generation,
        });
      }
      this.events.emit("surveySiteSurveyed", {
        ...result,
        tile: definition.tile,
        serviceAnchor: definition.serviceAnchor,
      });
      const idolLocation = this.idolLocationForHost({
        kind: "survey-site",
        surveySiteId: result.id,
      });
      if (idolLocation) {
        this.events.emit("idolLocationDiscovered", {
          expeditionId: this.expeditionId,
          generation: this.generation,
          location: idolLocation,
          provisionsSpent: result.provisionsSpent,
          presentationMs: result.presentationMs,
        });
      }
      this.resolveSurveyExhaustion();
      return result;
    } finally {
      this.interactionTransactionActive = false;
    }
  }

  interactWithFishingShoal(
    command: Readonly<FishingShoalInteractionCommandV1>,
  ): FishingShoalInteractionResultV1 {
    if (this.interactionTransactionActive) {
      return {
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        status: "rejected",
        reason: "interaction-busy",
      };
    }
    if (this.completionChoiceActive) {
      return {
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        status: "rejected",
        reason: "interaction-busy",
      };
    }
    if (this.pendingGenerationHandoverValue) {
      return {
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        status: "rejected",
        reason: "generation-handover",
      };
    }
    if (this.pendingRespawn) {
      return {
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        status: "rejected",
        reason: "wreck-hold",
      };
    }
    this.interactionTransactionActive = true;
    try {
      const { outcome: result } = this.fishingFeature.execute(command, {
        shipTile: {
          x: this.ship.currentTileX,
          y: this.ship.currentTileY,
        },
        expeditionId: this.expeditionId,
        generation: this.generation,
        surveyBudget: this.surveyBudget,
      });
      if (result.status !== "surveyed") return result;

      const expeditionStarted = !this.activeExpedition;
      if (expeditionStarted) this.activeExpedition = true;
      this.applySurveyProvisionCharge(result.provisionsSpent);
      const definition = this.fishingFeature.definitionFor(result.id);
      if (!definition) throw new Error(`Surveyed fishing shoal ${result.id} has no definition`);
      this.revision++;
      if (expeditionStarted) {
        this.events.emit("expeditionStarted", {
          expeditionId: this.expeditionId,
          generation: this.generation,
        });
      }
      this.events.emit("fishingShoalSurveyed", {
        ...result,
        tile: definition.tile,
      });
      this.resolveSurveyExhaustion();
      return result;
    } finally {
      this.interactionTransactionActive = false;
    }
  }

  interactWithWreck(
    command: Readonly<WreckSurveyInteractionCommandV1>,
  ): WreckSurveyInteractionResultV1 {
    const raw = command as unknown as Record<string, unknown> | null;
    const wreckId = raw && Number.isSafeInteger(raw.wreckId) ? raw.wreckId as number : -1;
    if (!raw || raw.contractVersion !== WRECK_SURVEY_CONTRACT_VERSION) {
      return this.rejectWreckSurvey(wreckId, "unsupported-contract");
    }
    if (raw.type !== "survey") {
      return this.rejectWreckSurvey(wreckId, "invalid-command");
    }
    if (this.interactionTransactionActive) {
      return this.rejectWreckSurvey(wreckId, "interaction-busy");
    }
    if (this.completionChoiceActive) {
      return this.rejectWreckSurvey(wreckId, "interaction-busy");
    }
    if (this.pendingGenerationHandoverValue) {
      return this.rejectWreckSurvey(wreckId, "generation-handover");
    }
    if (this.pendingRespawn) return this.rejectWreckSurvey(wreckId, "wreck-hold");
    const wreck = this.shipwrecks.find(({ id }) => id === wreckId);
    if (!wreck) return this.rejectWreckSurvey(wreckId, "unknown-wreck");
    if (!wreck.discovered) return this.rejectWreckSurvey(wreckId, "not-discovered");
    if (this.wreckDistanceSquared(wreck) > WRECK_SURVEY_INTERACTION_RANGE_TILES ** 2) {
      return this.rejectWreckSurvey(wreckId, "out-of-range");
    }
    if (wreck.generation >= this.generation) {
      return this.rejectWreckSurvey(wreckId, "current-generation");
    }
    if (wreck.survey.state !== "unexamined") {
      return this.rejectWreckSurvey(wreckId, "already-surveyed");
    }
    const surveyBudget = this.surveyBudget;
    if (!surveyBudget.canAfford) return this.rejectWreckSurvey(wreckId, "insufficient-provisions");
    const expeditionStarted = !this.activeExpedition;
    this.interactionTransactionActive = true;
    try {
      if (expeditionStarted) this.activeExpedition = true;
      wreck.survey = {
        state: "provisional",
        expeditionId: this.expeditionId,
        generation: this.generation,
      };
      this.applySurveyProvisionCharge(surveyBudget.surveyCost);
      this.wrecksRevision++;
      this.revision++;
      const result = {
        contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
        status: "surveyed",
        wreckId: wreck.id,
        navigatorId: createNavigatorId(wreck.generation),
        lostGeneration: wreck.generation,
        provisionsSpent: surveyBudget.surveyCost,
        availableProvisionUnitsRemaining: surveyBudget.remainingProvisionUnits,
        presentationMs: WRECK_SURVEY_PRESENTATION_MS,
      } as const;
      if (expeditionStarted) {
        this.events.emit("expeditionStarted", {
          expeditionId: this.expeditionId,
          generation: this.generation,
        });
      }
      this.events.emit("wreckSurveyed", {
        ...result,
        tile: { x: wreck.tileX, y: wreck.tileY },
      });
      this.resolveSurveyExhaustion();
      return result;
    } finally {
      this.interactionTransactionActive = false;
    }
  }

  /** Deterministic sandbox hook; normal play reaches this outcome through travel consumption. */
  forceWreck(): boolean {
    if (
      this.interactionTransactionActive
      || this.pendingRespawn
      || this.pendingGenerationHandoverValue
      || this.completionChoiceActive
    ) return false;
    if (this.isInSupportedWater()) return false;
    if (!this.activeExpedition) this.startExpedition();
    const knowledgeChanged = this.failExpedition();
    if (knowledgeChanged > 0) this.events.emit("knowledgeChanged", { count: knowledgeChanged });
    this.recalculateRiskOverlays();
    this.revision++;
    return true;
  }

  acknowledgeGenerationHandover(): boolean {
    if (
      this.interactionTransactionActive
      || this.completionChoiceActive
      || !this.pendingGenerationHandoverValue
    ) return false;
    this.pendingGenerationHandoverValue = undefined;
    this.ship.speed = 0;
    this.lastMovement = NO_MOVEMENT;
    this.lifecycleResolutionRevision++;
    this.revision++;
    return true;
  }

  continueCompletedWorld(): boolean {
    if (this.interactionTransactionActive || !this.completionChoiceActive) return false;
    this.completionStateValue = "continued";
    this.ship.speed = 0;
    this.lastMovement = NO_MOVEMENT;
    this.lifecycleResolutionRevision++;
    this.revision++;
    this.events.emit("completedWorldContinued", { seed: this.generated.seed });
    return true;
  }

  startNewGame(): number | undefined {
    if (this.interactionTransactionActive || !this.completionChoiceActive) return undefined;
    const nextSeed = createNextWorldSeed(this.generated.seed);
    this.regenerate(nextSeed);
    return nextSeed;
  }

  refreshRiskOverlays(): void {
    this.recalculateRiskOverlays();
    this.revision++;
  }

  /**
   * Applies the newest coalesced forward-guidance request. Interactive callers
   * invoke this once per frame, before authoritative simulation updates.
   */
  advanceForwardGuidance(): boolean {
    if (
      !this.forwardGuidanceEnabledValue
      || !this.forwardGuidancePending
      || !this.riskResultsInitialized
    ) {
      return false;
    }

    const source = this.forwardGuidanceSourceValue;
    if (!this.isCurrentForwardGuidanceSource(source)) {
      this.requestForwardGuidance();
      return false;
    }

    const startedAt = this.forwardGuidanceNow();
    const deadline = startedAt + this.forwardGuidanceSliceBudgetMs;
    if (!this.forwardGuidanceTask) {
      this.forwardGuidanceTask = {
        requestId: source.requestId,
        source,
        task: this.requireForwardRanges().beginTask(this.forwardRange, this.ship),
        slices: 0,
      };
      this.forwardGuidanceTelemetryValue.jobsStarted++;
    }

    const active = this.forwardGuidanceTask;
    if (
      active.requestId !== source.requestId
      || !this.sameForwardGuidanceSource(active.source, source)
    ) {
      this.cancelForwardGuidanceTask();
      return false;
    }

    const step = measureSimulationPhase(
      this.trace,
      "forward-guidance-slice",
      () => active.task.step({
        maxWorkUnits: this.forwardGuidanceWorkUnitsPerSlice,
        shouldYield: () => this.forwardGuidanceNow() >= deadline,
      }),
    );
    active.slices++;
    this.forwardGuidanceTelemetryValue.slices++;
    this.forwardGuidanceTelemetryValue.lastSliceWorkUnits = step.workUnits;
    this.forwardGuidanceTelemetryValue.maxSliceWorkUnits = Math.max(
      this.forwardGuidanceTelemetryValue.maxSliceWorkUnits,
      step.workUnits,
    );
    if (step.status !== "complete") return false;

    this.forwardGuidanceTelemetryValue.jobsCompleted++;
    if (
      this.forwardGuidanceTask !== active
      || active.requestId !== this.forwardGuidanceRequestId
      || !this.sameForwardGuidanceSource(active.source, this.forwardGuidanceSourceValue)
      || !this.isCurrentForwardGuidanceSource(active.source)
    ) {
      this.requireForwardRanges().releaseResult(step.result);
      this.forwardGuidanceTelemetryValue.staleResultsDiscarded++;
      if (this.forwardGuidanceTask === active) this.forwardGuidanceTask = undefined;
      if (!this.isCurrentForwardGuidanceSource(this.forwardGuidanceSourceValue)) {
        this.requestForwardGuidance();
      }
      return false;
    }

    // Heading is deliberately not a cancellation input: continuous steering
    // cannot starve the logical search. Reclip the sparse terminal band just
    // before atomic publication instead.
    const forwardRanges = this.requireForwardRanges();
    forwardRanges.updateHeading(step.result, this.ship);
    const previous = this.forwardRange;
    this.forwardRange = step.result;
    forwardRanges.releaseResult(previous);
    this.forwardGuidanceAppliedRequestId = active.requestId;
    this.forwardGuidancePending = false;
    this.forwardGuidanceAvailable = true;
    this.forwardGuidanceTask = undefined;
    this.forwardGuidanceTelemetryValue.lastRequestSlices = active.slices;
    this.forwardGuidanceTelemetryValue.maxRequestSlices = Math.max(
      this.forwardGuidanceTelemetryValue.maxRequestSlices,
      active.slices,
    );
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
    return true;
  }

  snapshot(): SimulationSnapshot {
    const knowledge = {
      supported: this.world.getKnowledgeCount(KnowledgeState.Supported),
      personal: this.world.getKnowledgeCount(KnowledgeState.Personal),
      unknown: this.world.getKnowledgeCount(KnowledgeState.Unknown),
      visibleNow: this.world.currentVisibleCount,
    };
    const risk = {
      forwardAvailable: this.forwardGuidanceAvailable,
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
        pendingGenerationHandover: this.pendingGenerationHandoverValue
          ? { ...this.pendingGenerationHandoverValue }
          : null,
      },
      navigator: { ...this.currentNavigator },
      lineage: this.navigatorLineage.map((navigator) => ({ ...navigator })),
      wrecks: this.shipwrecks.map((wreck) => ({ ...wreck, survey: { ...wreck.survey } })),
      islandDossiers: {
        available: this.islandDossierDefinitions.length,
        provisional: this.provisionalIslandDossiers.length,
        returned: this.returnedIslandDossiers.length,
        revealed: this.revealedIslandIds.length,
        interaction: this.islandDossierInteraction
          ? {
              ...this.islandDossierInteraction,
              approachTile: { ...this.islandDossierInteraction.approachTile },
              canonicalApproach: { ...this.islandDossierInteraction.canonicalApproach },
            }
          : undefined,
        records: this.islandDossierReadModels,
      },
      surveySites: {
        available: this.surveySiteDefinitions.length,
        provisional: this.provisionalSurveySites.length,
        returned: this.returnedSurveySites.length,
        interaction: this.surveySiteInteraction
          ? {
              ...this.surveySiteInteraction,
              tile: { ...this.surveySiteInteraction.tile },
              serviceAnchor: { ...this.surveySiteInteraction.serviceAnchor },
            }
          : undefined,
        records: this.surveySiteReadModels,
      },
      fishingShoals: {
        available: this.fishingShoalDefinitions.length,
        provisional: this.provisionalFishingShoals.length,
        returned: this.returnedFishingShoals.length,
        activationEligible: this.activationEligibleFishingShoals.length,
        surveyCost: this.config.provisions.surveyCost,
        interaction: this.fishingShoalInteraction
          ? { ...this.fishingShoalInteraction, tile: { ...this.fishingShoalInteraction.tile } }
          : undefined,
        records: this.fishingShoalReadModels.map((model) => ({
          ...model,
          tile: { ...model.tile },
          clue: { ...model.clue },
        })),
      },
      idolLocations: this.idolLocationProgress,
    };
  }

  private startExpedition(): void {
    if (
      this.activeExpedition
      || this.pendingRespawn
      || this.pendingGenerationHandoverValue
      || this.completionChoiceActive
    ) return;
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
    const returnedIslandDossiers = this.islandDossierSystem.commitExpedition(expeditionId);
    const returnedSurveySites = this.surveySiteSystem.commitExpedition(expeditionId);
    const returnedFishingShoals = this.fishingFeature.commitExpedition(expeditionId);
    const returnedWreckSurveys = this.commitWreckSurveys(expeditionId);
    const returnedIdolLocations = this.idolLocationDefinitionsValue.filter(({ host }) => {
      if (host.kind === "island-dossier") {
        return returnedIslandDossiers.dossiers.some(({ islandId }) => islandId === host.islandId);
      }
      return returnedSurveySites.reports.some(({ id }) => id === host.surveySiteId);
    });
    const achievements: NavigatorVoyageAchievementInputV3 = {
      expeditionId,
      supportedTileCount: committed.changedCount - (committed.closedUnknownCount ?? 0),
      closedUnknownTileCount: committed.closedUnknownCount ?? 0,
      islandLeadIds: returnedIslandDossiers.leads.map(({ islandId }) => islandId).sort((left, right) => left - right),
      islandDossierIds: returnedIslandDossiers.dossiers.map(({ islandId }) => islandId).sort((left, right) => left - right),
      surveySiteLeadIds: returnedSurveySites.leads.map(({ id }) => id).sort(),
      surveySiteReportIds: returnedSurveySites.reports.map(({ id }) => id).sort(),
      fishingLeadIds: returnedFishingShoals.leads.map(({ id }) => id).sort(),
      fishingSurveyIds: returnedFishingShoals.surveys.map(({ id }) => id).sort(),
      wreckIds: returnedWreckSurveys.map(({ wreckId }) => wreckId).sort((left, right) => left - right),
    };
    this.activeExpedition = false;
    this.advanceExpeditionId();
    const voyage = this.lineage.completeSuccessfulVoyage(achievements);
    const previousProvisions = this.ship.provisions;
    const previousAccumulator = this.ship.provisionAccumulator;
    this.ship.provisions = this.config.provisions.startingBundles;
    this.ship.provisionAccumulator = 0;
    this.ship.speed = 0;
    if (voyage.status === "tenure-completed") {
      this.pendingGenerationHandoverValue = Object.freeze({
        contractVersion: NAVIGATOR_GENERATION_HANDOVER_VERSION,
        fromNavigatorId: navigatorId,
        fromGeneration: generation,
        nextNavigatorId: voyage.successor.id,
        nextGeneration: voyage.successor.generation,
        reason: "tenure",
      });
    }
    const completedGame = this.completionStateValue === "in-progress"
      && returnedIdolLocations.length > 0
      && this.returnedIdolLocations.length === this.idolLocationDefinitionsValue.length;
    if (completedGame) this.completionStateValue = "awaiting-choice";
    this.events.emit("expeditionReturned", {
      expeditionId,
      generation,
      navigatorId,
      voyageNumber: voyage.completedVoyages,
      voyagesRemaining: voyage.remainingVoyages,
      tenureCompleted: voyage.tenureCompleted,
      supportedTileCount: voyage.voyage.supportedTileCount,
      closedUnknownTileCount: voyage.voyage.closedUnknownTileCount,
      achievements: voyage.voyage,
    });
    if (returnedIslandDossiers.leads.length > 0 || returnedIslandDossiers.dossiers.length > 0) {
      this.events.emit("islandDossiersReturned", {
        expeditionId,
        generation,
        leads: returnedIslandDossiers.leads,
        dossiers: returnedIslandDossiers.dossiers,
      });
    }
    if (returnedSurveySites.leads.length > 0 || returnedSurveySites.reports.length > 0) {
      this.events.emit("surveySitesReturned", {
        expeditionId,
        generation,
        leads: returnedSurveySites.leads,
        reports: returnedSurveySites.reports,
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
    if (returnedWreckSurveys.length > 0) {
      this.events.emit("wreckSurveysReturned", {
        expeditionId,
        generation,
        reports: returnedWreckSurveys,
      });
    }
    if (returnedIdolLocations.length > 0) {
      this.events.emit("idolLocationsReturned", {
        expeditionId,
        generation,
        locations: Object.freeze([...returnedIdolLocations]),
      });
    }
    this.emitReplenishment(
      previousProvisions,
      previousAccumulator,
      this.ship.provisions,
      "return",
      true,
    );
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
    if (completedGame) {
      this.events.emit("gameCompleted", {
        navigatorId,
        generation,
        voyageNumber: voyage.completedVoyages,
        returnedIdolLocations: this.returnedIdolLocations.length,
        totalIdolLocations: this.idolLocationDefinitionsValue.length,
      });
    }
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
      survey: { state: "unexamined" },
    };
    this.shipwrecks.push(wreck);
    this.descriptorRegistry.upsert(createPointDescriptor(
      "wreck",
      wreck.id,
      { x: wreck.tileX, y: wreck.tileY },
    ));
    this.interactionCandidateCache = undefined;
    this.wrecksRevision++;
    const reverted = this.knowledge.revertExpedition(expeditionId);
    const lostIslandDossiers = this.islandDossierSystem.revertExpedition(expeditionId);
    const lostSurveySites = this.surveySiteSystem.revertExpedition(expeditionId);
    const lostFishingShoals = this.fishingFeature.revertExpedition(expeditionId);
    const lostWreckSurveys = this.revertWreckSurveys(expeditionId);
    const lostIdolLocations = this.idolLocationDefinitionsValue.filter(({ host }) => {
      if (host.kind === "island-dossier") {
        return lostIslandDossiers.some((record) => (
          record.state === "surveyed" && record.islandId === host.islandId
        ));
      }
      return lostSurveySites.some((record) => (
        record.state === "surveyed" && record.id === host.surveySiteId
      ));
    });
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
    if (lostIslandDossiers.length > 0) {
      this.events.emit("islandDossiersLost", {
        expeditionId,
        generation,
        records: lostIslandDossiers,
      });
    }
    if (lostSurveySites.length > 0) {
      this.events.emit("surveySitesLost", {
        expeditionId,
        generation,
        records: lostSurveySites,
      });
    }
    if (lostFishingShoals.length > 0) {
      this.events.emit("fishingShoalsLost", {
        expeditionId,
        generation,
        records: lostFishingShoals,
      });
    }
    if (lostWreckSurveys.length > 0) {
      this.events.emit("wreckSurveysLost", {
        expeditionId,
        generation,
        reports: lostWreckSurveys,
      });
    }
    if (lostIdolLocations.length > 0) {
      this.events.emit("idolLocationsLost", {
        expeditionId,
        generation,
        locations: Object.freeze([...lostIdolLocations]),
      });
    }
    return reverted.changedCount;
  }

  private idolLocationForHost(
    host: Readonly<IdolLocationHostRef>,
  ): Readonly<IdolLocationDefinition> | undefined {
    return this.idolLocationDefinitionsValue.find(({ host: candidate }) => {
      if (host.kind !== candidate.kind) return false;
      if (host.kind === "island-dossier" && candidate.kind === "island-dossier") {
        return host.islandId === candidate.islandId;
      }
      return host.kind === "survey-site"
        && candidate.kind === "survey-site"
        && host.surveySiteId === candidate.surveySiteId;
    });
  }

  private idolLocationHostIsProvisional(host: Readonly<IdolLocationHostRef>): boolean {
    if (host.kind === "island-dossier") {
      return this.provisionalIslandDossiers.some((record) => (
        record.state === "surveyed" && record.islandId === host.islandId
      ));
    }
    return this.provisionalSurveySites.some((record) => (
      record.state === "surveyed" && record.id === host.surveySiteId
    ));
  }

  private idolLocationHostIsReturned(host: Readonly<IdolLocationHostRef>): boolean {
    if (host.kind === "island-dossier") {
      return this.returnedIslandDossiers.some((record) => (
        record.state === "dossier" && record.islandId === host.islandId
      ));
    }
    return this.returnedSurveySites.some((record) => (
      record.state === "report" && record.id === host.surveySiteId
    ));
  }

  private commitWreckSurveys(expeditionId: number): readonly Readonly<WreckSurveyReportV1>[] {
    const reports: WreckSurveyReportV1[] = [];
    for (const wreck of this.shipwrecks) {
      const survey = wreck.survey;
      if (survey.state !== "provisional" || survey.expeditionId !== expeditionId) continue;
      reports.push({
        wreckId: wreck.id,
        navigatorId: createNavigatorId(wreck.generation),
        lostGeneration: wreck.generation,
        surveyExpeditionId: survey.expeditionId,
        surveyGeneration: survey.generation,
      });
      wreck.survey = {
        state: "returned",
        expeditionId: survey.expeditionId,
        generation: survey.generation,
      };
    }
    if (reports.length > 0) this.wrecksRevision++;
    return Object.freeze(reports.map((report) => Object.freeze(report)));
  }

  private revertWreckSurveys(expeditionId: number): readonly Readonly<WreckSurveyReportV1>[] {
    const reports: WreckSurveyReportV1[] = [];
    for (const wreck of this.shipwrecks) {
      const survey = wreck.survey;
      if (survey.state !== "provisional" || survey.expeditionId !== expeditionId) continue;
      reports.push({
        wreckId: wreck.id,
        navigatorId: createNavigatorId(wreck.generation),
        lostGeneration: wreck.generation,
        surveyExpeditionId: survey.expeditionId,
        surveyGeneration: survey.generation,
      });
      wreck.survey = { state: "unexamined" };
    }
    if (reports.length > 0) this.wrecksRevision++;
    return Object.freeze(reports.map((report) => Object.freeze(report)));
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
    this.pendingGenerationHandoverValue = Object.freeze({
      contractVersion: NAVIGATOR_GENERATION_HANDOVER_VERSION,
      fromNavigatorId: advanced.transition.fromNavigatorId,
      fromGeneration: pending.generation,
      nextNavigatorId: advanced.navigator.id,
      nextGeneration: advanced.navigator.generation,
      reason: "wreck",
    });

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
      wreck: { ...pending.wreck, survey: { ...pending.wreck.survey } },
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

  /**
   * Reconstructs the authoritative lifted tile-image order from accepted
   * movement segments. Canonical entered-tile IDs alone cannot distinguish
   * winding on a two-tile axis or after an immediate reversal.
   */
  private liftedCrossedCenters(
    previousTile: Readonly<GridPoint>,
    previousWorld: Readonly<WorldPoint>,
    movement: Readonly<MovementResult>,
  ): GridPoint[] {
    const crossedCenters: GridPoint[] = [{ ...previousTile }];
    const append = (point: Readonly<GridPoint>): void => {
      const previous = crossedCenters[crossedCenters.length - 1];
      if (previous.x !== point.x || previous.y !== point.y) crossedCenters.push({ ...point });
    };
    const tileSize = this.config.navigation.tileSize;
    for (const segment of movement.segments) {
      if (segment.distancePixels <= 0) continue;
      append(worldToGrid(
        (segment.fromWorldX + segment.toWorldX) / 2,
        (segment.fromWorldY + segment.toWorldY) / 2,
        tileSize,
      ));
    }
    append(worldToGrid(
      previousWorld.x + movement.liftedDisplacement.x,
      previousWorld.y + movement.liftedDisplacement.y,
      tileSize,
    ));
    return crossedCenters;
  }

  private wreckDistanceSquared(wreck: Readonly<ShipwreckState>): number {
    return this.world.topology.minimumImageTileDistanceSquared(
      { x: this.ship.currentTileX, y: this.ship.currentTileY },
      { x: wreck.tileX, y: wreck.tileY },
    );
  }

  private rejectWreckSurvey(
    wreckId: number,
    reason: WreckSurveyRejectionReasonV1,
  ): WreckSurveyInteractionResultV1 {
    return {
      contractVersion: WRECK_SURVEY_CONTRACT_VERSION,
      status: "rejected",
      wreckId,
      reason,
    };
  }

  private rejectIslandDossierSurvey(
    islandId: number | undefined,
    reason: IslandDossierSurveyRejectionReasonV1,
  ): IslandDossierInteractionResultV1 {
    return {
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      status: "rejected",
      ...(islandId === undefined ? {} : { islandId }),
      reason,
    };
  }

  private rejectSurveySiteSurvey(
    id: SurveySiteId | undefined,
    reason: SurveySiteRejectionReason,
  ): SurveySiteInteractionResult {
    return {
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      status: "rejected",
      ...(id === undefined ? {} : { id }),
      reason,
    };
  }

  private rebuildDescriptorRegistry(): void {
    const entries: WorldDescriptorEntry[] = [];
    for (const definition of this.fishingFeature.definitions) {
      entries.push(createPointDescriptor("fishing-shoal", definition.id, definition.tile));
    }
    for (const definition of this.surveySiteSystem.definitions) {
      entries.push(createBoundsDescriptor(
        "survey-site",
        definition.id,
        boundsForWorldPoints([definition.tile, definition.serviceAnchor], this.world.topology),
      ));
    }
    for (const definition of this.islandDossierSystem.definitions) {
      entries.push(createBoundsDescriptor(
        "island-dossier",
        definition.islandId,
        boundsForWorldIndices(definition.approachIndices, this.world.topology),
      ));
    }
    for (const wreck of this.shipwrecks) {
      entries.push(createPointDescriptor(
        "wreck",
        wreck.id,
        { x: wreck.tileX, y: wreck.tileY },
      ));
    }
    this.descriptorRegistry.replace(entries);
    this.interactionCandidateCache = undefined;
    this.visibleCandidateCache = undefined;
  }

  private interactionCandidates(): WorldDescriptorCandidates {
    const x = this.ship.currentTileX;
    const y = this.ship.currentTileY;
    const cached = this.interactionCandidateCache;
    if (
      cached
      && cached.x === x
      && cached.y === y
      && cached.spatialRevision === this.descriptorRegistry.revision
    ) return cached.candidates;

    const candidates = this.descriptorRegistry.queryNear(
      { x, y },
      MAX_INTERACTION_QUERY_RADIUS,
    ).candidates;
    this.interactionCandidateCache = Object.freeze({
      x,
      y,
      spatialRevision: this.descriptorRegistry.revision,
      candidates,
    });
    return candidates;
  }

  private visibleDescriptorCandidates(): WorldDescriptorCandidates {
    const cached = this.visibleCandidateCache;
    if (
      cached
      && cached.visibilityRevision === this.world.visibilityVersion
      && cached.spatialRevision === this.descriptorRegistry.revision
    ) return cached.candidates;

    const visible = this.world.getVisibleIndices();
    if (visible.size === 0) {
      this.visibleCandidateCache = Object.freeze({
        visibilityRevision: this.world.visibilityVersion,
        spatialRevision: this.descriptorRegistry.revision,
        candidates: NO_DESCRIPTOR_CANDIDATES,
      });
      return NO_DESCRIPTOR_CANDIDATES;
    }
    const candidates = this.descriptorRegistry.queryBounds(
      boundsForWorldIndices([...visible], this.world.topology),
    ).candidates;
    this.visibleCandidateCache = Object.freeze({
      visibilityRevision: this.world.visibilityVersion,
      spatialRevision: this.descriptorRegistry.revision,
      candidates,
    });
    return candidates;
  }

  private discoverVisibleWrecks(candidateIds?: Iterable<number>): number {
    let discoveredCount = 0;
    const wrecks = candidateIds === undefined
      ? this.shipwrecks
      : [...candidateIds]
        .map((id) => this.shipwrecks.find((wreck) => wreck.id === id))
        .filter((wreck): wreck is ShipwreckState => wreck !== undefined);
    for (const wreck of wrecks) {
      if (wreck.discovered || !this.world.isVisibleNow(wreck.tileX, wreck.tileY)) continue;
      wreck.discovered = true;
      discoveredCount++;
      this.events.emit("wreckDiscovered", {
        wreckId: wreck.id,
        tileX: wreck.tileX,
        tileY: wreck.tileY,
      });
    }
    if (discoveredCount > 0) this.wrecksRevision++;
    return discoveredCount;
  }

  private observeIslandDossiers(): number {
    if (!this.activeExpedition || this.pendingRespawn) return 0;
    const observation = this.islandDossierSystem.observeCurrentSight(
      this.expeditionId,
      this.generation,
    );
    for (const record of observation.found) {
      const definition = this.islandDossierSystem.definitionFor(record.islandId);
      if (!definition) continue;
      this.events.emit("islandSighted", {
        islandId: definition.islandId,
        name: definition.name,
        canonicalApproach: definition.canonicalApproach,
      });
    }
    return observation.found.length;
  }

  private observeSurveySites(candidateIds?: Iterable<string>): number {
    if (!this.activeExpedition || this.pendingRespawn) return 0;
    const observation = this.surveySiteSystem.observeCurrentSight(
      this.expeditionId,
      this.generation,
      this.world.getVisibleIndices(),
      candidateIds,
    );
    for (const record of observation.found) {
      const definition = this.surveySiteSystem.definitionFor(record.id);
      if (!definition) continue;
      this.events.emit("surveySiteSighted", {
        id: definition.id,
        type: definition.type,
        typeLabel: definition.typeLabel,
        tile: definition.tile,
        serviceAnchor: definition.serviceAnchor,
        clue: definition.clue,
      });
    }
    return observation.found.length;
  }

  private observeFishingShoals(candidateIds?: Iterable<string>): number {
    if (!this.activeExpedition || this.pendingRespawn) return 0;
    const observation = this.fishingFeature.observeCurrentSight(
      this.expeditionId,
      this.generation,
      this.world.getVisibleIndices(),
      candidateIds,
    );
    for (const record of observation.found) {
      const definition = this.fishingFeature.definitionFor(record.id);
      if (!definition) continue;
      this.events.emit("fishingShoalSighted", {
        id: definition.id,
        tile: definition.tile,
        clue: definition.clue,
      });
    }
    return observation.found.length;
  }

  private recalculateRiskOverlays(): void {
    if (this.riskResultsInitialized) {
      if (this.forwardGuidanceEnabledValue) this.requestForwardGuidance();
      else this.refreshEmptyForwardRange();
      this.returnPaths = measureSimulationPhase(
        this.trace,
        "return-query",
        () => this.returnPathing.recalculate(this.returnPaths, this.ship),
      );
    } else {
      if (this.forwardGuidanceEnabledValue) {
        this.forwardRange = measureSimulationPhase(
          this.trace,
          "forward-guidance",
          () => this.requireForwardRanges().calculate(this.ship),
        );
        this.forwardGuidanceAvailable = true;
      } else {
        this.forwardRange = emptyForwardRange(this.ship, this.config);
        this.forwardGuidanceAvailable = false;
      }
      this.returnPaths = measureSimulationPhase(
        this.trace,
        "return-query",
        () => this.returnPathing.calculate(this.ship),
      );
      this.forwardGuidanceSourceValue = this.captureForwardGuidanceSource(
        this.forwardGuidanceRequestId,
      );
      this.forwardGuidanceAppliedRequestId = this.forwardGuidanceRequestId;
      this.forwardGuidancePending = false;
      this.riskResultsInitialized = true;
    }
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
  }

  private updateRiskOverlayBudgets(): void {
    const forwardChanged = this.forwardGuidanceEnabledValue
      ? this.forwardGuidanceAvailable
        && this.requireForwardRanges().updateBudget(this.forwardRange, this.ship)
      : this.refreshEmptyForwardRange();
    const returnChanged = this.returnPathing.updateBudget(this.returnPaths, this.ship);
    if (!forwardChanged && !returnChanged) return;
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
  }

  private updateRiskOverlayHeading(): void {
    if (!this.forwardGuidanceEnabledValue) {
      if (!this.refreshEmptyForwardRange()) return;
      this.overlaysRevision++;
      this.events.emit("returnStateChanged", undefined);
      return;
    }
    if (
      !this.forwardGuidanceAvailable
      || !this.requireForwardRanges().updateHeading(this.forwardRange, this.ship)
    ) return;
    this.overlaysRevision++;
    this.events.emit("returnStateChanged", undefined);
  }

  private requestForwardGuidance(): void {
    if (!this.forwardGuidanceEnabledValue) return;
    this.forwardRanges ??= new ForwardRangeSystem(this.world, this.config);
    if (this.forwardGuidancePending) {
      this.forwardGuidanceTelemetryValue.requestsCoalesced++;
    }
    this.cancelForwardGuidanceTask();
    this.forwardGuidanceRequestId++;
    this.forwardGuidanceTelemetryValue.requests++;
    this.forwardGuidanceSourceValue = this.captureForwardGuidanceSource(
      this.forwardGuidanceRequestId,
    );
    this.forwardGuidancePending = true;
  }

  private captureForwardGuidanceSource(requestId: number): ForwardGuidanceSource {
    return Object.freeze({
      requestId,
      worldEpoch: this.forwardGuidanceWorldEpoch,
      worldRevision: this.world.collisionVersion,
      knowledgeRevision: this.world.knowledgeVersion,
      visibilityRevision: this.world.visibilityVersion,
      originX: this.ship.currentTileX,
      originY: this.ship.currentTileY,
      provisionUnits: availableProvisionUnits(this.ship),
    });
  }

  private isCurrentForwardGuidanceSource(source: ForwardGuidanceSource): boolean {
    return source.worldEpoch === this.forwardGuidanceWorldEpoch
      && source.worldRevision === this.world.collisionVersion
      && source.knowledgeRevision === this.world.knowledgeVersion
      && source.visibilityRevision === this.world.visibilityVersion
      && source.originX === this.ship.currentTileX
      && source.originY === this.ship.currentTileY
      && source.provisionUnits === availableProvisionUnits(this.ship);
  }

  private sameForwardGuidanceSource(
    left: ForwardGuidanceSource,
    right: ForwardGuidanceSource,
  ): boolean {
    return left.requestId === right.requestId
      && left.worldEpoch === right.worldEpoch
      && left.worldRevision === right.worldRevision
      && left.knowledgeRevision === right.knowledgeRevision
      && left.visibilityRevision === right.visibilityRevision
      && left.originX === right.originX
      && left.originY === right.originY
      && left.provisionUnits === right.provisionUnits;
  }

  private cancelForwardGuidanceTask(): void {
    const active = this.forwardGuidanceTask;
    if (!active) return;
    active.task.cancel();
    this.forwardGuidanceTask = undefined;
    this.forwardGuidanceTelemetryValue.jobsCancelled++;
  }

  private replaceForwardRangeWithEmpty(): void {
    const previous = this.forwardRange;
    this.forwardRange = emptyForwardRange(this.ship, this.config);
    this.forwardRanges?.releaseResult(previous);
  }

  private refreshEmptyForwardRange(): boolean {
    const budget = availableProvisionUnits(this.ship);
    const heading = this.ship.heading;
    const coneHalfAngleDegrees = this.config.overlays.forwardConeHalfAngleDegrees;
    const changed = this.forwardRange.budget !== budget
      || this.forwardRange.presentationHeading !== heading
      || this.forwardRange.coneHalfAngleDegrees !== coneHalfAngleDegrees;
    this.forwardRange.budget = budget;
    this.forwardRange.presentationHeading = heading;
    this.forwardRange.coneHalfAngleDegrees = coneHalfAngleDegrees;
    return changed;
  }

  private requireForwardRanges(): ForwardGuidance {
    if (!this.forwardRanges) {
      throw new Error("Forward guidance is not enabled");
    }
    return this.forwardRanges;
  }
}
