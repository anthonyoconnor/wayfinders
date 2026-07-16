import { KnowledgeState } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";
import type { GridPoint } from "../core/types";
import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  FISHING_SHOAL_INTERACTION_RANGE_TILES,
  FISHING_SHOAL_SURVEY_PRESENTATION_MS,
  isCurrentFishingShoalId,
  type FishingShoalDefinition,
  type FishingShoalHiddenReadModel,
  type FishingShoalInteractionCommandV1,
  type FishingShoalInteractionReadModel,
  type FishingShoalInteractionResultV1,
  type FishingShoalProvisionalRecordV1,
  type FishingShoalReadModel,
  type FishingShoalReturnedRecordV1,
  type FishingShoalReturnedSurveyReadModel,
  type FishingShoalSurveyedReadModel,
} from "./FishingShoalContracts";
import { SupportedConnectivitySystem } from "./SupportedConnectivitySystem";
import type { SurveyBudgetReadModel } from "./SurveyContracts";

export interface FishingShoalObservation {
  found: readonly Readonly<FishingShoalProvisionalRecordV1>[];
}

export interface FishingShoalCommitResult {
  leads: readonly Readonly<FishingShoalReturnedRecordV1>[];
  surveys: readonly Readonly<FishingShoalReturnedRecordV1>[];
}

/** Owns mutable shoal knowledge while definitions remain seed-derived. */
export class FishingShoalSystem {
  private readonly definitionById = new Map<string, Readonly<FishingShoalDefinition>>();
  private readonly definitionOrderById = new Map<string, number>();
  private readonly provisionalById = new Map<string, FishingShoalProvisionalRecordV1>();
  private readonly returnedById = new Map<string, FishingShoalReturnedRecordV1>();
  private provisionalCache: ReadonlyArray<Readonly<FishingShoalProvisionalRecordV1>> = Object.freeze([]);
  private returnedCache: ReadonlyArray<Readonly<FishingShoalReturnedRecordV1>> = Object.freeze([]);
  private recordsDirty = false;
  private recordsRevisionValue = 0;
  private readModelCache: readonly Readonly<FishingShoalReadModel>[] = Object.freeze([]);
  private readModelCacheMode: "all" | "bounded" | undefined;
  private readModelRecordsRevision = -1;
  private readModelKnowledgeVersion = -1;
  private readModelVisibilityVersion = -1;
  private readModelTopologyVersion = -1;
  private readonly supportedConnectivity: SupportedConnectivitySystem;

  constructor(
    private readonly world: WorldGrid,
    readonly definitions: readonly Readonly<FishingShoalDefinition>[],
    homeReturnTile: Readonly<GridPoint>,
    config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
  ) {
    this.supportedConnectivity = new SupportedConnectivitySystem(world, homeReturnTile, config);
    for (const [order, definition] of definitions.entries()) {
      if (this.definitionById.has(definition.id)) throw new RangeError(`Duplicate fishing shoal ${definition.id}`);
      this.definitionById.set(definition.id, definition);
      this.definitionOrderById.set(definition.id, order);
    }
  }

  get provisional(): readonly Readonly<FishingShoalProvisionalRecordV1>[] {
    this.refreshRecordCaches();
    return this.provisionalCache;
  }

  get returned(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    this.refreshRecordCaches();
    return this.returnedCache;
  }

  get activationEligible(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    return Object.freeze(this.returned.filter((record) => {
      if (record.state !== "survey") return false;
      const definition = this.definitionById.get(record.id);
      return definition !== undefined && this.isHomeConnected(definition);
    }));
  }

  get connectivityBuildCount(): number {
    return this.supportedConnectivity.buildCount;
  }

  get recordsRevision(): number {
    return this.recordsRevisionValue;
  }

  definitionFor(id: string): Readonly<FishingShoalDefinition> | undefined {
    return this.definitionById.get(id);
  }

  interactionNear(
    tile: Readonly<{ x: number; y: number }>,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
    candidateIds?: Iterable<string>,
  ): FishingShoalInteractionReadModel | undefined {
    let closest: {
      definition: Readonly<FishingShoalDefinition>;
      distance: number;
      state: FishingShoalInteractionReadModel["state"];
    } | undefined;
    for (const definition of this.candidateDefinitions(candidateIds)) {
      const provisional = this.provisionalById.get(definition.id);
      const returned = this.returnedById.get(definition.id);
      const state = provisional?.state === "sighted"
        ? "sighted"
        : !provisional && returned?.state === "lead"
          ? "returned-lead"
          : undefined;
      if (!state) continue;
      const distance = Math.hypot(definition.tile.x - tile.x, definition.tile.y - tile.y);
      if (distance > FISHING_SHOAL_INTERACTION_RANGE_TILES) continue;
      if (
        closest
        && (distance > closest.distance || (distance === closest.distance && definition.id > closest.definition.id))
      ) continue;
      closest = { definition, distance, state };
    }
    if (!closest) return undefined;
    return {
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      id: closest.definition.id,
      tile: closest.definition.tile,
      state: closest.state,
      clueLabel: closest.definition.clue.label,
      ...surveyBudget,
    };
  }

  applyInteraction(
    command: Readonly<FishingShoalInteractionCommandV1>,
    shipTile: Readonly<{ x: number; y: number }>,
    expeditionId: number,
    generation: number,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
  ): FishingShoalInteractionResultV1 {
    const raw = command as unknown as Record<string, unknown> | null;
    const id = raw && isCurrentFishingShoalId(raw.id) ? raw.id : undefined;
    if (!raw || raw.contractVersion !== FISHING_SHOAL_CONTRACT_VERSION) {
      return this.reject(id, "unsupported-contract");
    }
    if (raw.type !== "survey") return this.reject(id, "invalid-command");
    if (!id) return this.reject(undefined, "unknown-opportunity");
    const definition = this.definitionById.get(id);
    if (!definition) return this.reject(id, "unknown-opportunity");
    if (
      Math.hypot(definition.tile.x - shipTile.x, definition.tile.y - shipTile.y)
      > FISHING_SHOAL_INTERACTION_RANGE_TILES
    ) return this.reject(id, "out-of-range");

    const provisional = this.provisionalById.get(id);
    const returned = this.returnedById.get(id);

    if (returned?.state === "survey" || provisional?.state === "surveyed") {
      return this.reject(id, "already-surveyed");
    }
    if (provisional?.state !== "sighted" && returned?.state !== "lead") {
      return this.reject(id, "not-sighted");
    }
    if (!surveyBudget.canAfford) return this.reject(id, "insufficient-provisions");

    if (provisional) {
      provisional.state = "surveyed";
    } else {
      this.provisionalById.set(id, {
        id,
        state: "surveyed",
        expeditionId,
        generation,
      });
    }
    this.markRecordsChanged();
    return {
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      status: "surveyed",
      id,
      quality: definition.quality,
      provisionsSpent: surveyBudget.surveyCost,
      availableProvisionUnitsRemaining: surveyBudget.remainingProvisionUnits,
      presentationMs: FISHING_SHOAL_SURVEY_PRESENTATION_MS,
    };
  }

  observeCurrentSight(
    expeditionId: number,
    generation: number,
    visibleIndices: Iterable<number> = this.world.getVisibleIndices(),
    candidateIds?: Iterable<string>,
  ): FishingShoalObservation {
    const visible = typeof (visibleIndices as ReadonlySet<number>).has === "function"
      ? visibleIndices as ReadonlySet<number>
      : new Set(visibleIndices);
    const found: FishingShoalProvisionalRecordV1[] = [];
    for (const definition of this.candidateDefinitions(candidateIds)) {
      if (this.provisionalById.has(definition.id) || this.returnedById.has(definition.id)) continue;
      if (!visible.has(this.world.index(definition.tile.x, definition.tile.y))) continue;
      const record: FishingShoalProvisionalRecordV1 = {
        id: definition.id,
        state: "sighted",
        expeditionId,
        generation,
      };
      this.provisionalById.set(record.id, record);
      found.push(record);
    }
    if (found.length > 0) this.markRecordsChanged();
    return { found: Object.freeze(found) };
  }

  commitExpedition(expeditionId: number): FishingShoalCommitResult {
    const leads: FishingShoalReturnedRecordV1[] = [];
    const surveys: FishingShoalReturnedRecordV1[] = [];
    let changed = false;
    for (const [id, provisional] of this.provisionalById) {
      if (provisional.expeditionId !== expeditionId) continue;
      const previousReturned = this.returnedById.get(id);
      const nextState = provisional.state === "surveyed" ? "survey" : "lead";
      if (previousReturned?.state === "survey") {
        this.provisionalById.delete(id);
        changed = true;
        continue;
      }
      if (previousReturned?.state === "lead" && nextState === "lead") {
        this.provisionalById.delete(id);
        changed = true;
        continue;
      }
      const committed: FishingShoalReturnedRecordV1 = {
        id: provisional.id,
        state: nextState,
        expeditionId: provisional.expeditionId,
        generation: provisional.generation,
      };
      this.returnedById.set(id, committed);
      this.provisionalById.delete(id);
      changed = true;
      (nextState === "survey" ? surveys : leads).push(committed);
    }
    leads.sort((left, right) => left.id.localeCompare(right.id));
    surveys.sort((left, right) => left.id.localeCompare(right.id));
    if (changed) this.markRecordsChanged();
    return {
      leads: Object.freeze(leads),
      surveys: Object.freeze(surveys),
    };
  }

  revertExpedition(expeditionId: number): readonly Readonly<FishingShoalProvisionalRecordV1>[] {
    const lost: FishingShoalProvisionalRecordV1[] = [];
    for (const [id, record] of this.provisionalById) {
      if (record.expeditionId !== expeditionId) continue;
      this.provisionalById.delete(id);
      lost.push(record);
    }
    lost.sort((left, right) => left.id.localeCompare(right.id));
    if (lost.length > 0) this.markRecordsChanged();
    return Object.freeze(lost);
  }

  readModels(candidateIds?: Iterable<string>): readonly Readonly<FishingShoalReadModel>[] {
    const mode = candidateIds === undefined ? "all" : "bounded";
    if (
      this.readModelCacheMode === mode
      && this.readModelRecordsRevision === this.recordsRevisionValue
      && this.readModelKnowledgeVersion === this.world.knowledgeVersion
      && this.readModelVisibilityVersion === this.world.visibilityVersion
      && this.readModelTopologyVersion === this.world.supportedTopologyVersion
    ) return this.readModelCache;

    const models: FishingShoalReadModel[] = [];
    const definitions = candidateIds === undefined
      ? this.definitions
      : this.readModelDefinitions(candidateIds);
    for (const definition of definitions) {
      const visible = this.world.isVisibleNow(definition.tile.x, definition.tile.y);
      const provisional = this.provisionalById.get(definition.id);
      const returned = this.returnedById.get(definition.id);
      if (returned?.state === "survey") {
        const model: FishingShoalReturnedSurveyReadModel = {
          contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
          id: definition.id,
          tile: definition.tile,
          clue: definition.clue,
          state: "returned-survey",
          quality: definition.quality,
          homeConnected: this.isHomeConnected(definition),
        };
        models.push(model);
        continue;
      }
      if (provisional?.state === "surveyed") {
        const model: FishingShoalSurveyedReadModel = {
          contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
          id: definition.id,
          tile: definition.tile,
          clue: definition.clue,
          state: "surveyed",
          quality: definition.quality,
        };
        models.push(model);
        continue;
      }
      if (returned?.state === "lead") {
        const model: FishingShoalHiddenReadModel = {
          contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
          id: definition.id,
          tile: definition.tile,
          clue: definition.clue,
          state: "returned-lead",
        };
        models.push(model);
        continue;
      }
      if (
        !visible
        && (!provisional || this.world.getKnowledge(definition.tile.x, definition.tile.y) === KnowledgeState.Unknown)
      ) continue;
      const model: FishingShoalHiddenReadModel = {
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        id: definition.id,
        tile: definition.tile,
        clue: definition.clue,
        state: provisional ? "sighted" : "clue",
      };
      models.push(model);
    }
    this.readModelCache = Object.freeze(models);
    this.readModelCacheMode = mode;
    this.readModelRecordsRevision = this.recordsRevisionValue;
    this.readModelKnowledgeVersion = this.world.knowledgeVersion;
    this.readModelVisibilityVersion = this.world.visibilityVersion;
    this.readModelTopologyVersion = this.world.supportedTopologyVersion;
    return this.readModelCache;
  }

  private markRecordsChanged(): void {
    this.recordsDirty = true;
    this.recordsRevisionValue++;
  }

  private *candidateDefinitions(
    candidateIds?: Iterable<string>,
  ): IterableIterator<Readonly<FishingShoalDefinition>> {
    if (candidateIds === undefined) {
      yield* this.definitions;
      return;
    }
    for (const id of candidateIds) {
      const definition = this.definitionById.get(id);
      if (definition) yield definition;
    }
  }

  private readModelDefinitions(candidateIds: Iterable<string>): readonly Readonly<FishingShoalDefinition>[] {
    const ids = new Set(candidateIds);
    for (const id of this.provisionalById.keys()) ids.add(id);
    for (const id of this.returnedById.keys()) ids.add(id);
    return [...ids]
      .map((id) => this.definitionById.get(id))
      .filter((definition): definition is Readonly<FishingShoalDefinition> => definition !== undefined)
      .sort((left, right) => (
        (this.definitionOrderById.get(left.id) ?? 0) - (this.definitionOrderById.get(right.id) ?? 0)
      ));
  }

  private isHomeConnected(definition: Readonly<FishingShoalDefinition>): boolean {
    return this.supportedConnectivity.isConnected(
      definition.serviceAnchor,
      this.world.supportedTopologyVersion,
    );
  }

  private refreshRecordCaches(): void {
    if (!this.recordsDirty) return;
    this.provisionalCache = Object.freeze([...this.provisionalById.values()]
      .sort((left, right) => left.id.localeCompare(right.id)));
    this.returnedCache = Object.freeze([...this.returnedById.values()]
      .sort((left, right) => left.id.localeCompare(right.id)));
    this.recordsDirty = false;
  }

  private reject(
    id: FishingShoalProvisionalRecordV1["id"] | undefined,
    reason: Extract<FishingShoalInteractionResultV1, { status: "rejected" }>["reason"],
  ): Extract<FishingShoalInteractionResultV1, { status: "rejected" }> {
    return {
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      status: "rejected",
      id,
      reason,
    };
  }
}
