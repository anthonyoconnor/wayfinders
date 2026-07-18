import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import type { WorldGrid } from "../world/WorldGrid";
import {
  ISLAND_DOSSIER_CONTENT_VERSION,
  ISLAND_DOSSIER_CONTRACT_VERSION,
  ISLAND_DOSSIER_INTERACTION_RANGE_TILES,
  ISLAND_DOSSIER_SURVEY_PRESENTATION_MS,
  type IslandDossierCommitResultV1,
  type IslandDossierDefinitionV1,
  type IslandDossierInteractionCommandV1,
  type IslandDossierInteractionReadModelV1,
  type IslandDossierInteractionResultV1,
  type IslandDossierObservationV1,
  type IslandDossierProvisionalRecordV1,
  type IslandDossierReadModelV1,
  type IslandDossierReturnedRecordV1,
  type IslandDossierSurveyRejectionReasonV1,
} from "./IslandDossierContracts";
import type { SurveyBudgetReadModel } from "./SurveyContracts";

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

/** Owns the mutable lead/dossier lifecycle while catalog definitions stay derived. */
export class IslandDossierSystem {
  readonly definitions: readonly Readonly<IslandDossierDefinitionV1>[];

  private readonly definitionByIslandId = new Map<number, Readonly<IslandDossierDefinitionV1>>();
  private readonly approachIndicesByIslandId = new Map<number, ReadonlySet<number>>();
  private readonly provisionalByIslandId = new Map<number, IslandDossierProvisionalRecordV1>();
  private readonly returnedByIslandId = new Map<number, IslandDossierReturnedRecordV1>();
  private provisionalCache: ReadonlyArray<Readonly<IslandDossierProvisionalRecordV1>> = Object.freeze([]);
  private returnedCache: ReadonlyArray<Readonly<IslandDossierReturnedRecordV1>> = Object.freeze([]);
  private revealedIslandIdsCache: readonly number[] = Object.freeze([]);
  private recordsDirty = false;
  private recordsRevisionValue = 0;
  private fogRevealRevisionValue = 0;
  private readModelCache: readonly Readonly<IslandDossierReadModelV1>[] = Object.freeze([]);
  private readModelRecordsRevision = -1;
  private readonly graph: GridGraph;

  constructor(
    private readonly world: WorldGrid,
    definitions: readonly Readonly<IslandDossierDefinitionV1>[],
    config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
  ) {
    this.graph = new GridGraph(world, config);
    this.definitions = Object.freeze([...definitions].sort((left, right) => left.islandId - right.islandId));
    for (const definition of this.definitions) this.registerDefinition(definition);
  }

  get provisional(): readonly Readonly<IslandDossierProvisionalRecordV1>[] {
    this.refreshRecordCaches();
    return this.provisionalCache;
  }

  get returned(): readonly Readonly<IslandDossierReturnedRecordV1>[] {
    this.refreshRecordCaches();
    return this.returnedCache;
  }

  /** Sorted exact island IDs whose provisional or returned dossier clears fog. */
  get revealedIslandIds(): readonly number[] {
    this.refreshRecordCaches();
    return this.revealedIslandIdsCache;
  }

  get recordsRevision(): number {
    return this.recordsRevisionValue;
  }

  /** Changes only when an island enters or leaves the dossier-derived fog reveal set. */
  get fogRevealRevision(): number {
    return this.fogRevealRevisionValue;
  }

  definitionFor(islandId: number): Readonly<IslandDossierDefinitionV1> | undefined {
    return this.definitionByIslandId.get(islandId);
  }

  isIslandRevealed(islandId: number): boolean {
    return this.returnedByIslandId.get(islandId)?.state === "dossier"
      || this.provisionalByIslandId.get(islandId)?.state === "surveyed";
  }

  isValidApproach(islandId: number, tile: Readonly<GridPoint>): boolean {
    if (!this.world.inBounds(tile.x, tile.y)) return false;
    return this.approachIndicesByIslandId.get(islandId)?.has(this.world.index(tile.x, tile.y)) ?? false;
  }

  observeCurrentSight(
    expeditionId: number,
    generation: number,
    visibleIndices: Iterable<number> = this.world.getVisibleIndices(),
  ): IslandDossierObservationV1 {
    positiveSafeInteger(expeditionId, "Island-dossier expedition ID");
    positiveSafeInteger(generation, "Island-dossier generation");
    const visibleIslandIds = new Set<number>();
    for (const index of visibleIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= this.world.tileCount) continue;
      const islandId = this.world.getIslandIdAtIndex(index);
      if (this.definitionByIslandId.has(islandId)) visibleIslandIds.add(islandId);
    }

    const found: Readonly<IslandDossierProvisionalRecordV1>[] = [];
    for (const islandId of [...visibleIslandIds].sort((left, right) => left - right)) {
      if (this.provisionalByIslandId.has(islandId) || this.returnedByIslandId.has(islandId)) continue;
      const record: IslandDossierProvisionalRecordV1 = {
        islandId,
        state: "sighted",
        expeditionId,
        generation,
      };
      this.provisionalByIslandId.set(islandId, record);
      found.push(Object.freeze({ ...record }));
    }
    if (found.length > 0) this.markRecordsChanged(false);
    return { found: Object.freeze(found) };
  }

  interactionNear(
    tile: Readonly<GridPoint>,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
    candidateIslandIds?: Iterable<number>,
  ): Readonly<IslandDossierInteractionReadModelV1> | undefined {
    if (!this.world.inBounds(tile.x, tile.y)) return undefined;
    const index = this.world.index(tile.x, tile.y);
    for (const definition of this.candidateDefinitions(candidateIslandIds)) {
      const provisional = this.provisionalByIslandId.get(definition.islandId);
      const returned = this.returnedByIslandId.get(definition.islandId);
      const state = provisional?.state === "sighted"
        ? "sighted"
        : !provisional && returned?.state === "lead"
          ? "returned-lead"
          : undefined;
      if (!state || !this.approachIndicesByIslandId.get(definition.islandId)?.has(index)) continue;
      return Object.freeze({
        contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
        islandId: definition.islandId,
        name: definition.name,
        state,
        approachTile: Object.freeze({ ...tile }),
        canonicalApproach: definition.canonicalApproach,
        ...surveyBudget,
      });
    }
    return undefined;
  }

  applyInteraction(
    command: Readonly<IslandDossierInteractionCommandV1>,
    shipTile: Readonly<GridPoint>,
    expeditionId: number,
    generation: number,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
  ): IslandDossierInteractionResultV1 {
    positiveSafeInteger(expeditionId, "Island-dossier expedition ID");
    positiveSafeInteger(generation, "Island-dossier generation");
    const raw = command as unknown as Record<string, unknown> | null;
    const islandId = raw && Number.isSafeInteger(raw.islandId) && (raw.islandId as number) > 0
      ? raw.islandId as number
      : undefined;
    if (!raw || raw.contractVersion !== ISLAND_DOSSIER_CONTRACT_VERSION) {
      return this.reject(islandId, "unsupported-contract");
    }
    if (raw.type !== "survey") return this.reject(islandId, "invalid-command");
    if (islandId === undefined) return this.reject(undefined, "unknown-island");
    const definition = this.definitionByIslandId.get(islandId);
    if (!definition) return this.reject(islandId, "unknown-island");
    if (!this.isValidApproach(islandId, shipTile)) return this.reject(islandId, "out-of-range");

    const provisional = this.provisionalByIslandId.get(islandId);
    const returned = this.returnedByIslandId.get(islandId);
    if (returned?.state === "dossier" || provisional?.state === "surveyed") {
      return this.reject(islandId, "already-surveyed");
    }
    if (provisional?.state !== "sighted" && returned?.state !== "lead") {
      return this.reject(islandId, "not-sighted");
    }
    if (!surveyBudget.canAfford) return this.reject(islandId, "insufficient-provisions");

    if (provisional) {
      provisional.state = "surveyed";
    } else {
      this.provisionalByIslandId.set(islandId, {
        islandId,
        state: "surveyed",
        expeditionId,
        generation,
      });
    }
    this.markRecordsChanged(true);
    return {
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      status: "surveyed",
      islandId,
      name: definition.name,
      dossier: definition.dossier,
      provisionsSpent: surveyBudget.surveyCost,
      availableProvisionUnitsRemaining: surveyBudget.remainingProvisionUnits,
      presentationMs: ISLAND_DOSSIER_SURVEY_PRESENTATION_MS,
    };
  }

  commitExpedition(expeditionId: number): IslandDossierCommitResultV1 {
    positiveSafeInteger(expeditionId, "Island-dossier expedition ID");
    const leads: IslandDossierReturnedRecordV1[] = [];
    const dossiers: IslandDossierReturnedRecordV1[] = [];
    let changed = false;
    for (const [islandId, provisional] of this.provisionalByIslandId) {
      if (provisional.expeditionId !== expeditionId) continue;
      const previousReturned = this.returnedByIslandId.get(islandId);
      const nextState = provisional.state === "surveyed" ? "dossier" : "lead";
      this.provisionalByIslandId.delete(islandId);
      changed = true;
      if (previousReturned?.state === "dossier") continue;
      if (previousReturned?.state === "lead" && nextState === "lead") continue;
      const committed = Object.freeze({
        islandId,
        state: nextState,
        expeditionId: provisional.expeditionId,
        generation: provisional.generation,
      }) satisfies IslandDossierReturnedRecordV1;
      this.returnedByIslandId.set(islandId, committed);
      (nextState === "dossier" ? dossiers : leads).push(committed);
    }
    if (changed) this.markRecordsChanged(false);
    return {
      leads: Object.freeze(leads.sort((left, right) => left.islandId - right.islandId)),
      dossiers: Object.freeze(dossiers.sort((left, right) => left.islandId - right.islandId)),
    };
  }

  revertExpedition(
    expeditionId: number,
  ): readonly Readonly<IslandDossierProvisionalRecordV1>[] {
    positiveSafeInteger(expeditionId, "Island-dossier expedition ID");
    const lost: Readonly<IslandDossierProvisionalRecordV1>[] = [];
    let revealChanged = false;
    for (const [islandId, record] of this.provisionalByIslandId) {
      if (record.expeditionId !== expeditionId) continue;
      this.provisionalByIslandId.delete(islandId);
      lost.push(Object.freeze({ ...record }));
      if (record.state === "surveyed" && this.returnedByIslandId.get(islandId)?.state !== "dossier") {
        revealChanged = true;
      }
    }
    lost.sort((left, right) => left.islandId - right.islandId);
    if (lost.length > 0) this.markRecordsChanged(revealChanged);
    return Object.freeze(lost);
  }

  readModels(): readonly Readonly<IslandDossierReadModelV1>[] {
    if (this.readModelRecordsRevision === this.recordsRevisionValue) return this.readModelCache;
    const models: Readonly<IslandDossierReadModelV1>[] = [];
    const recordIds = new Set([
      ...this.provisionalByIslandId.keys(),
      ...this.returnedByIslandId.keys(),
    ]);
    for (const islandId of [...recordIds].sort((left, right) => left - right)) {
      const definition = this.definitionByIslandId.get(islandId);
      if (!definition) continue;
      const provisional = this.provisionalByIslandId.get(definition.islandId);
      const returned = this.returnedByIslandId.get(definition.islandId);
      if (returned?.state === "dossier") {
        models.push(Object.freeze({
          contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
          islandId: definition.islandId,
          name: definition.name,
          canonicalApproach: definition.canonicalApproach,
          state: "returned-dossier",
          dossier: definition.dossier,
        }));
      } else if (provisional?.state === "surveyed") {
        models.push(Object.freeze({
          contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
          islandId: definition.islandId,
          name: definition.name,
          canonicalApproach: definition.canonicalApproach,
          state: "surveyed",
          dossier: definition.dossier,
        }));
      } else if (returned?.state === "lead") {
        models.push(Object.freeze({
          contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
          islandId: definition.islandId,
          name: definition.name,
          canonicalApproach: definition.canonicalApproach,
          state: "returned-lead",
        }));
      } else if (provisional?.state === "sighted") {
        models.push(Object.freeze({
          contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
          islandId: definition.islandId,
          name: definition.name,
          canonicalApproach: definition.canonicalApproach,
          state: "sighted",
        }));
      }
    }
    this.readModelCache = Object.freeze(models);
    this.readModelRecordsRevision = this.recordsRevisionValue;
    return this.readModelCache;
  }

  private registerDefinition(definition: Readonly<IslandDossierDefinitionV1>): void {
    positiveSafeInteger(definition.islandId, "Island-dossier island ID");
    if (definition.contentVersion !== ISLAND_DOSSIER_CONTENT_VERSION) {
      throw new RangeError(`Island dossier ${definition.islandId} has an unsupported content version`);
    }
    if (this.definitionByIslandId.has(definition.islandId)) {
      throw new RangeError(`Duplicate island dossier ${definition.islandId}`);
    }
    if (definition.footprintIndices.length === 0 || definition.approachIndices.length === 0) {
      throw new RangeError(`Island dossier ${definition.islandId} requires a footprint and coastal approaches`);
    }

    const footprint = new Set<number>();
    for (const index of definition.footprintIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= this.world.tileCount) {
        throw new RangeError(`Island dossier ${definition.islandId} has an invalid footprint index`);
      }
      if (this.world.getIslandIdAtIndex(index) !== definition.islandId) {
        throw new RangeError(`Island dossier ${definition.islandId} footprint does not match the world`);
      }
      if (footprint.has(index)) throw new RangeError(`Island dossier ${definition.islandId} repeats a footprint index`);
      footprint.add(index);
    }

    const approaches = new Set<number>();
    for (const index of definition.approachIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= this.world.tileCount) {
        throw new RangeError(`Island dossier ${definition.islandId} has an invalid approach index`);
      }
      if (!this.graph.isNavigationNodePassable(index)) {
        throw new RangeError(`Island dossier ${definition.islandId} has a blocked approach`);
      }
      if (approaches.has(index)) throw new RangeError(`Island dossier ${definition.islandId} repeats an approach index`);
      const approach = this.world.pointFromIndex(index);
      let withinRange = false;
      for (const footprintIndex of footprint) {
        const tile = this.world.pointFromIndex(footprintIndex);
        if (
          this.world.topology.minimumImageTileDistanceSquared(approach, tile)
          <= ISLAND_DOSSIER_INTERACTION_RANGE_TILES * ISLAND_DOSSIER_INTERACTION_RANGE_TILES
        ) {
          withinRange = true;
          break;
        }
      }
      if (!withinRange) throw new RangeError(`Island dossier ${definition.islandId} has an out-of-range approach`);
      approaches.add(index);
    }
    const canonicalIndex = this.world.index(
      definition.canonicalApproach.x,
      definition.canonicalApproach.y,
    );
    if (!approaches.has(canonicalIndex)) {
      throw new RangeError(`Island dossier ${definition.islandId} canonical approach is not valid`);
    }

    this.definitionByIslandId.set(definition.islandId, definition);
    this.approachIndicesByIslandId.set(definition.islandId, approaches);
  }

  private *candidateDefinitions(
    candidateIslandIds?: Iterable<number>,
  ): IterableIterator<Readonly<IslandDossierDefinitionV1>> {
    if (candidateIslandIds === undefined) {
      yield* this.definitions;
      return;
    }
    const seen = new Set<number>();
    for (const islandId of candidateIslandIds) {
      if (seen.has(islandId)) continue;
      seen.add(islandId);
      const definition = this.definitionByIslandId.get(islandId);
      if (definition) yield definition;
    }
  }

  private collectRevealedIslandIds(
    provisional: ReadonlyMap<number, Readonly<IslandDossierProvisionalRecordV1>>,
    returned: ReadonlyMap<number, Readonly<IslandDossierReturnedRecordV1>>,
  ): number[] {
    const revealed = new Set<number>();
    for (const [islandId, record] of returned) if (record.state === "dossier") revealed.add(islandId);
    for (const [islandId, record] of provisional) if (record.state === "surveyed") revealed.add(islandId);
    return [...revealed].sort((left, right) => left - right);
  }

  private markRecordsChanged(revealChanged: boolean): void {
    this.recordsDirty = true;
    this.recordsRevisionValue++;
    if (revealChanged) this.fogRevealRevisionValue++;
  }

  private refreshRecordCaches(): void {
    if (!this.recordsDirty) return;
    this.provisionalCache = Object.freeze([...this.provisionalByIslandId.values()]
      .sort((left, right) => left.islandId - right.islandId)
      .map((record) => Object.freeze({ ...record })));
    this.returnedCache = Object.freeze([...this.returnedByIslandId.values()]
      .sort((left, right) => left.islandId - right.islandId)
      .map((record) => Object.freeze({ ...record })));
    this.revealedIslandIdsCache = Object.freeze(this.collectRevealedIslandIds(
      this.provisionalByIslandId,
      this.returnedByIslandId,
    ));
    this.recordsDirty = false;
  }

  private reject(
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
}
