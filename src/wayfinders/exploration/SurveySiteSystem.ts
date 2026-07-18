import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";
import type { SurveyBudgetReadModel } from "./SurveyContracts";
import {
  SURVEY_SITE_CONTENT_VERSION,
  SURVEY_SITE_CONTRACT_VERSION,
  SURVEY_SITE_INTERACTION_RANGE_TILES,
  SURVEY_SITE_PRESENTATION_MS,
  compareSurveySiteIds,
  isCurrentSurveySiteId,
  parseSurveySiteId,
  type SurveySiteDefinition,
  type SurveySiteHiddenReadModel,
  type SurveySiteId,
  type SurveySiteInteractionCommand,
  type SurveySiteInteractionReadModel,
  type SurveySiteInteractionResult,
  type SurveySiteProvisionalRecord,
  type SurveySiteReadModel,
  type SurveySiteRejectedResult,
  type SurveySiteReturnedRecord,
  type SurveySiteSurveyedReadModel,
  type SurveySiteType,
} from "./SurveySiteContracts";

export interface SurveySiteObservation {
  readonly found: readonly Readonly<SurveySiteProvisionalRecord>[];
}

export interface SurveySiteCommitResult {
  readonly leads: readonly Readonly<SurveySiteReturnedRecord>[];
  readonly reports: readonly Readonly<SurveySiteReturnedRecord>[];
}

/** Owns all mutable generic-site knowledge; definitions remain seed-derived. */
export class SurveySiteSystem<TType extends string = SurveySiteType> {
  readonly definitions: readonly Readonly<SurveySiteDefinition<TType>>[];

  private readonly definitionById = new Map<SurveySiteId, Readonly<SurveySiteDefinition<TType>>>();
  private readonly provisionalById = new Map<SurveySiteId, SurveySiteProvisionalRecord>();
  private readonly returnedById = new Map<SurveySiteId, SurveySiteReturnedRecord>();
  private provisionalCache: ReadonlyArray<Readonly<SurveySiteProvisionalRecord>> = Object.freeze([]);
  private returnedCache: ReadonlyArray<Readonly<SurveySiteReturnedRecord>> = Object.freeze([]);
  private recordsDirty = false;
  private recordsRevisionValue = 0;
  private readModelCache: readonly Readonly<SurveySiteReadModel<TType>>[] = Object.freeze([]);
  private readModelCacheMode: "all" | "bounded" | undefined;
  private readModelRecordsRevision = -1;
  private readModelKnowledgeVersion = -1;
  private readModelVisibilityVersion = -1;
  private readonly graph: GridGraph;

  constructor(
    private readonly world: WorldGrid,
    definitions: readonly Readonly<SurveySiteDefinition<TType>>[],
    config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
  ) {
    this.graph = new GridGraph(world, config);
    this.definitions = Object.freeze([...definitions].sort((left, right) => compareSurveySiteIds(left.id, right.id)));
    for (const definition of this.definitions) this.registerDefinition(definition);
  }

  get provisional(): readonly Readonly<SurveySiteProvisionalRecord>[] {
    this.refreshRecordCaches();
    return this.provisionalCache;
  }

  get returned(): readonly Readonly<SurveySiteReturnedRecord>[] {
    this.refreshRecordCaches();
    return this.returnedCache;
  }

  get recordsRevision(): number {
    return this.recordsRevisionValue;
  }

  definitionFor(id: string): Readonly<SurveySiteDefinition<TType>> | undefined {
    return isCurrentSurveySiteId(id) ? this.definitionById.get(id) : undefined;
  }

  interactionNear(
    shipTile: Readonly<GridPoint>,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
    candidateIds?: Iterable<string>,
  ): Readonly<SurveySiteInteractionReadModel<TType>> | undefined {
    let closest: {
      definition: Readonly<SurveySiteDefinition<TType>>;
      state: SurveySiteInteractionReadModel<TType>["state"];
      distance: number;
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
      const distance = this.interactionDistance(definition, shipTile);
      if (distance > SURVEY_SITE_INTERACTION_RANGE_TILES) continue;
      if (
        closest
        && (distance > closest.distance || (distance === closest.distance && definition.id > closest.definition.id))
      ) continue;
      closest = { definition, state, distance };
    }

    if (!closest) return undefined;
    return Object.freeze({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      id: closest.definition.id,
      type: closest.definition.type,
      typeLabel: closest.definition.typeLabel,
      tile: closest.definition.tile,
      serviceAnchor: closest.definition.serviceAnchor,
      state: closest.state,
      clueLabel: closest.definition.clue.label,
      distanceTiles: closest.distance,
      ...surveyBudget,
    });
  }

  applyInteraction(
    command: Readonly<SurveySiteInteractionCommand>,
    shipTile: Readonly<GridPoint>,
    expeditionId: number,
    generation: number,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
  ): SurveySiteInteractionResult<TType> {
    const raw = command as unknown as Record<string, unknown> | null;
    const id = raw && isCurrentSurveySiteId(raw.id) ? raw.id : undefined;
    if (!raw || raw.contractVersion !== SURVEY_SITE_CONTRACT_VERSION) {
      return this.reject(id, "unsupported-contract");
    }
    if (raw.type !== "survey") return this.reject(id, "invalid-command");
    if (!id) return this.reject(undefined, "unknown-site");
    const definition = this.definitionById.get(id);
    if (!definition) return this.reject(id, "unknown-site");

    const distance = this.interactionDistance(definition, shipTile);
    if (distance > SURVEY_SITE_INTERACTION_RANGE_TILES) return this.reject(id, "out-of-range");

    const provisional = this.provisionalById.get(id);
    const returned = this.returnedById.get(id);
    if (returned?.state === "report" || provisional?.state === "surveyed") {
      return this.reject(id, "already-surveyed");
    }
    if (provisional?.state !== "sighted" && returned?.state !== "lead") {
      return this.reject(id, "not-sighted");
    }
    if (!surveyBudget.canAfford) return this.reject(id, "insufficient-provisions");
    assertProvenance(expeditionId, generation, `Survey site ${id}`);

    this.provisionalById.set(id, {
      id,
      state: "surveyed",
      expeditionId: provisional?.expeditionId ?? expeditionId,
      generation: provisional?.generation ?? generation,
    });
    this.markRecordsChanged();
    return {
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      status: "surveyed",
      id,
      type: definition.type,
      result: definition.result,
      provisionsSpent: surveyBudget.surveyCost,
      availableProvisionUnitsRemaining: surveyBudget.remainingProvisionUnits,
      presentationMs: SURVEY_SITE_PRESENTATION_MS,
    };
  }

  observeCurrentSight(
    expeditionId: number,
    generation: number,
    visibleIndices: Iterable<number> = this.world.getVisibleIndices(),
    candidateIds?: Iterable<string>,
  ): SurveySiteObservation {
    assertProvenance(expeditionId, generation, "Survey-site observation");
    const visible = typeof (visibleIndices as ReadonlySet<number>).has === "function"
      ? visibleIndices as ReadonlySet<number>
      : new Set(visibleIndices);
    const found: SurveySiteProvisionalRecord[] = [];

    for (const definition of this.candidateDefinitions(candidateIds)) {
      if (this.provisionalById.has(definition.id) || this.returnedById.has(definition.id)) continue;
      if (!visible.has(this.world.index(definition.tile.x, definition.tile.y))) continue;
      const record: SurveySiteProvisionalRecord = {
        id: definition.id,
        state: "sighted",
        expeditionId,
        generation,
      };
      this.provisionalById.set(record.id, record);
      found.push(record);
    }
    found.sort((left, right) => compareSurveySiteIds(left.id, right.id));
    if (found.length > 0) this.markRecordsChanged();
    return { found: Object.freeze(found) };
  }

  commitExpedition(expeditionId: number): SurveySiteCommitResult {
    const leads: SurveySiteReturnedRecord[] = [];
    const reports: SurveySiteReturnedRecord[] = [];
    let changed = false;

    for (const [id, provisional] of this.provisionalById) {
      if (provisional.expeditionId !== expeditionId) continue;
      const previousReturned = this.returnedById.get(id);
      const nextState = provisional.state === "surveyed" ? "report" : "lead";
      if (previousReturned?.state === "report") {
        this.provisionalById.delete(id);
        changed = true;
        continue;
      }
      if (previousReturned?.state === "lead" && nextState === "lead") {
        this.provisionalById.delete(id);
        changed = true;
        continue;
      }
      const committed: SurveySiteReturnedRecord = {
        id,
        state: nextState,
        expeditionId: provisional.expeditionId,
        generation: provisional.generation,
      };
      this.returnedById.set(id, committed);
      this.provisionalById.delete(id);
      (nextState === "report" ? reports : leads).push(committed);
      changed = true;
    }

    leads.sort((left, right) => compareSurveySiteIds(left.id, right.id));
    reports.sort((left, right) => compareSurveySiteIds(left.id, right.id));
    if (changed) this.markRecordsChanged();
    return { leads: Object.freeze(leads), reports: Object.freeze(reports) };
  }

  revertExpedition(expeditionId: number): readonly Readonly<SurveySiteProvisionalRecord>[] {
    const lost: SurveySiteProvisionalRecord[] = [];
    for (const [id, record] of this.provisionalById) {
      if (record.expeditionId !== expeditionId) continue;
      this.provisionalById.delete(id);
      lost.push(record);
    }
    lost.sort((left, right) => compareSurveySiteIds(left.id, right.id));
    if (lost.length > 0) this.markRecordsChanged();
    return Object.freeze(lost);
  }

  readModels(candidateIds?: Iterable<string>): readonly Readonly<SurveySiteReadModel<TType>>[] {
    const mode = candidateIds === undefined ? "all" : "bounded";
    if (
      this.readModelCacheMode === mode
      && this.readModelRecordsRevision === this.recordsRevisionValue
      && this.readModelKnowledgeVersion === this.world.knowledgeVersion
      && this.readModelVisibilityVersion === this.world.visibilityVersion
    ) return this.readModelCache;

    const models: SurveySiteReadModel<TType>[] = [];
    const definitions = candidateIds === undefined
      ? this.definitions
      : this.readModelDefinitions(candidateIds);
    for (const definition of definitions) {
      const provisional = this.provisionalById.get(definition.id);
      const returned = this.returnedById.get(definition.id);
      const base = {
        contractVersion: SURVEY_SITE_CONTRACT_VERSION,
        id: definition.id,
        type: definition.type,
        typeLabel: definition.typeLabel,
        tile: definition.tile,
        serviceAnchor: definition.serviceAnchor,
        clue: definition.clue,
        presentation: definition.presentation,
      } as const;

      if (returned?.state === "report") {
        const model: SurveySiteSurveyedReadModel<TType> = {
          ...base,
          state: "returned-report",
          result: definition.result,
        };
        models.push(Object.freeze(model));
        continue;
      }
      if (provisional?.state === "surveyed") {
        const model: SurveySiteSurveyedReadModel<TType> = {
          ...base,
          state: "surveyed",
          result: definition.result,
        };
        models.push(Object.freeze(model));
        continue;
      }
      if (returned?.state === "lead") {
        const model: SurveySiteHiddenReadModel<TType> = { ...base, state: "returned-lead" };
        models.push(Object.freeze(model));
        continue;
      }

      const visible = this.world.isVisibleNow(definition.tile.x, definition.tile.y);
      if (
        !visible
        && (!provisional || this.world.getKnowledge(definition.tile.x, definition.tile.y) === KnowledgeState.Unknown)
      ) continue;
      const model: SurveySiteHiddenReadModel<TType> = {
        ...base,
        state: provisional ? "sighted" : "clue",
      };
      models.push(Object.freeze(model));
    }
    this.readModelCache = Object.freeze(models);
    this.readModelCacheMode = mode;
    this.readModelRecordsRevision = this.recordsRevisionValue;
    this.readModelKnowledgeVersion = this.world.knowledgeVersion;
    this.readModelVisibilityVersion = this.world.visibilityVersion;
    return this.readModelCache;
  }

  private registerDefinition(definition: Readonly<SurveySiteDefinition<TType>>): void {
    const parsed = parseSurveySiteId(definition.id);
    if (
      !parsed
      || parsed.contentVersion !== SURVEY_SITE_CONTENT_VERSION
      || definition.contentVersion !== SURVEY_SITE_CONTENT_VERSION
      || parsed.type !== definition.type
    ) throw new RangeError(`Survey site ${definition.id} has an invalid current definition`);
    if (this.definitionById.has(definition.id)) throw new RangeError(`Duplicate survey site ${definition.id}`);
    if (!this.world.inBounds(definition.tile.x, definition.tile.y)) {
      throw new RangeError(`Survey site ${definition.id} is outside the world`);
    }
    if (this.world.getIslandId(definition.tile.x, definition.tile.y) !== definition.islandId) {
      throw new RangeError(`Survey site ${definition.id} does not match its island`);
    }
    if (
      !this.world.inBounds(definition.serviceAnchor.x, definition.serviceAnchor.y)
      || !this.graph.isNavigationNodePassable(
        this.world.index(definition.serviceAnchor.x, definition.serviceAnchor.y),
      )
    ) throw new RangeError(`Survey site ${definition.id} has an invalid service anchor`);
    if (
      this.interactionDistance(definition, definition.tile) > SURVEY_SITE_INTERACTION_RANGE_TILES
    ) throw new RangeError(`Survey site ${definition.id} service anchor is out of range`);
    this.definitionById.set(definition.id, definition);
  }

  private *candidateDefinitions(
    candidateIds?: Iterable<string>,
  ): IterableIterator<Readonly<SurveySiteDefinition<TType>>> {
    if (candidateIds === undefined) {
      yield* this.definitions;
      return;
    }
    const seen = new Set<string>();
    for (const id of candidateIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const definition = this.definitionById.get(id as SurveySiteId);
      if (definition) yield definition;
    }
  }

  private interactionDistance(
    definition: Readonly<SurveySiteDefinition<TType>>,
    shipTile: Readonly<GridPoint>,
  ): number {
    return Math.sqrt(this.world.topology.minimumImageTileDistanceSquared(
      shipTile,
      definition.serviceAnchor,
    ));
  }

  private readModelDefinitions(candidateIds: Iterable<string>): readonly Readonly<SurveySiteDefinition<TType>>[] {
    const ids = new Set(candidateIds);
    for (const id of this.provisionalById.keys()) ids.add(id);
    for (const id of this.returnedById.keys()) ids.add(id);
    return [...ids]
      .map((id) => this.definitionById.get(id as SurveySiteId))
      .filter((definition): definition is Readonly<SurveySiteDefinition<TType>> => definition !== undefined)
      .sort((left, right) => compareSurveySiteIds(left.id, right.id));
  }

  private reject(id: SurveySiteId | undefined, reason: SurveySiteRejectedResult["reason"]): SurveySiteRejectedResult {
    return {
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      status: "rejected",
      ...(id === undefined ? {} : { id }),
      reason,
    };
  }

  private markRecordsChanged(): void {
    this.recordsDirty = true;
    this.recordsRevisionValue++;
  }

  private refreshRecordCaches(): void {
    if (!this.recordsDirty) return;
    this.provisionalCache = Object.freeze([...this.provisionalById.values()]
      .sort((left, right) => compareSurveySiteIds(left.id, right.id)));
    this.returnedCache = Object.freeze([...this.returnedById.values()]
      .sort((left, right) => compareSurveySiteIds(left.id, right.id)));
    this.recordsDirty = false;
  }
}

function assertProvenance(expeditionId: number, generation: number, label: string): void {
  if (!Number.isInteger(expeditionId) || expeditionId <= 0 || expeditionId > 0xffff_ffff) {
    throw new RangeError(`${label} has an invalid expedition ID`);
  }
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new RangeError(`${label} has an invalid generation`);
  }
}
