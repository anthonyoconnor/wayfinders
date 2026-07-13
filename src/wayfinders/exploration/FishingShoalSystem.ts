import { KnowledgeState } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";
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
  type FishingShoalSurveyedReadModel,
} from "./FishingShoalContracts";

export interface FishingShoalObservation {
  found: readonly Readonly<FishingShoalProvisionalRecordV1>[];
}

/** Owns mutable shoal knowledge while definitions remain seed-derived. */
export class FishingShoalSystem {
  private readonly definitionById = new Map<string, Readonly<FishingShoalDefinition>>();
  private readonly provisionalById = new Map<string, FishingShoalProvisionalRecordV1>();
  private provisionalCache: ReadonlyArray<Readonly<FishingShoalProvisionalRecordV1>> = Object.freeze([]);
  private recordsDirty = false;
  private recordsRevisionValue = 0;

  constructor(
    private readonly world: WorldGrid,
    readonly definitions: readonly Readonly<FishingShoalDefinition>[],
  ) {
    for (const definition of definitions) {
      if (this.definitionById.has(definition.id)) throw new RangeError(`Duplicate fishing shoal ${definition.id}`);
      this.definitionById.set(definition.id, definition);
    }
  }

  get provisional(): readonly Readonly<FishingShoalProvisionalRecordV1>[] {
    if (this.recordsDirty) {
      this.provisionalCache = Object.freeze([...this.provisionalById.values()]
        .sort((left, right) => left.id.localeCompare(right.id)));
      this.recordsDirty = false;
    }
    return this.provisionalCache;
  }

  get recordsRevision(): number {
    return this.recordsRevisionValue;
  }

  /** One non-stacking case is available unless this allocation already surveyed a shoal. */
  get surveyCasesRemaining(): 0 | 1 {
    for (const record of this.provisionalById.values()) {
      if (record.state === "surveyed") return 0;
    }
    return 1;
  }

  definitionFor(id: string): Readonly<FishingShoalDefinition> | undefined {
    return this.definitionById.get(id);
  }

  interactionNear(tile: Readonly<{ x: number; y: number }>): FishingShoalInteractionReadModel | undefined {
    let closest: { definition: Readonly<FishingShoalDefinition>; distance: number } | undefined;
    for (const definition of this.definitions) {
      const record = this.provisionalById.get(definition.id);
      if (record?.state !== "sighted") continue;
      const distance = Math.hypot(definition.tile.x - tile.x, definition.tile.y - tile.y);
      if (distance > FISHING_SHOAL_INTERACTION_RANGE_TILES) continue;
      if (
        closest
        && (distance > closest.distance || (distance === closest.distance && definition.id > closest.definition.id))
      ) continue;
      closest = { definition, distance };
    }
    if (!closest) return undefined;
    return {
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      id: closest.definition.id,
      tile: closest.definition.tile,
      state: "sighted",
      clueLabel: closest.definition.clue.label,
      surveyCasesRemaining: this.surveyCasesRemaining,
    };
  }

  applyInteraction(
    command: Readonly<FishingShoalInteractionCommandV1>,
    shipTile: Readonly<{ x: number; y: number }>,
  ): FishingShoalInteractionResultV1 {
    const definition = this.definitionById.get(command.id);
    if (!definition) return this.reject(command.id, "unknown-opportunity");
    if (
      Math.hypot(definition.tile.x - shipTile.x, definition.tile.y - shipTile.y)
      > FISHING_SHOAL_INTERACTION_RANGE_TILES
    ) return this.reject(command.id, "out-of-range");

    const record = this.provisionalById.get(command.id);
    if (command.type === "leave") {
      if (record?.state !== "sighted") return this.reject(command.id, "not-sighted");
      return {
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        status: "left",
        id: command.id,
      };
    }

    if (record?.state === "surveyed") return this.reject(command.id, "already-surveyed");
    if (record?.state !== "sighted") return this.reject(command.id, "not-sighted");
    if (this.surveyCasesRemaining === 0) return this.reject(command.id, "no-survey-case");

    record.state = "surveyed";
    this.markRecordsChanged();
    return {
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      status: "surveyed",
      id: command.id,
      quality: definition.quality,
      casesRemaining: 0,
      presentationMs: FISHING_SHOAL_SURVEY_PRESENTATION_MS,
    };
  }

  observeCurrentSight(
    expeditionId: number,
    generation: number,
    visibleIndices: Iterable<number> = this.world.getVisibleIndices(),
  ): FishingShoalObservation {
    const visible = typeof (visibleIndices as ReadonlySet<number>).has === "function"
      ? visibleIndices as ReadonlySet<number>
      : new Set(visibleIndices);
    const found: FishingShoalProvisionalRecordV1[] = [];
    for (const definition of this.definitions) {
      if (this.provisionalById.has(definition.id)) continue;
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

  restore(records: readonly FishingShoalProvisionalRecordV1[]): void {
    this.provisionalById.clear();
    let surveyedCount = 0;
    for (const saved of records) {
      if (!isCurrentFishingShoalId(saved.id) || !this.definitionById.has(saved.id)) {
        throw new RangeError(`Fishing shoal ${saved.id} does not match the regenerated catalog`);
      }
      if (this.provisionalById.has(saved.id)) throw new RangeError(`Fishing shoal ${saved.id} is duplicated`);
      if (saved.state === "surveyed" && ++surveyedCount > 1) {
        throw new RangeError("Only one fishing shoal may consume the fixed survey-case allocation");
      }
      this.provisionalById.set(saved.id, { ...saved });
    }
    this.markRecordsChanged();
  }

  readModels(): readonly Readonly<FishingShoalReadModel>[] {
    const models: FishingShoalReadModel[] = [];
    for (const definition of this.definitions) {
      const visible = this.world.isVisibleNow(definition.tile.x, definition.tile.y);
      const record = this.provisionalById.get(definition.id);
      if (!visible && (!record || this.world.getKnowledge(definition.tile.x, definition.tile.y) === KnowledgeState.Unknown)) {
        continue;
      }
      if (record?.state === "surveyed") {
        const model: FishingShoalSurveyedReadModel = {
          contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
          id: definition.id,
          tile: definition.tile,
          clue: definition.clue,
          state: "surveyed",
          quality: definition.quality,
        };
        models.push(model);
      } else {
        const model: FishingShoalHiddenReadModel = {
          contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
          id: definition.id,
          tile: definition.tile,
          clue: definition.clue,
          state: record ? "sighted" : "clue",
        };
        models.push(model);
      }
    }
    return Object.freeze(models);
  }

  private markRecordsChanged(): void {
    this.recordsDirty = true;
    this.recordsRevisionValue++;
  }

  private reject(
    id: FishingShoalProvisionalRecordV1["id"],
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
