import { KnowledgeState } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  isCurrentFishingShoalId,
  type FishingShoalDefinition,
  type FishingShoalHiddenReadModel,
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

  definitionFor(id: string): Readonly<FishingShoalDefinition> | undefined {
    return this.definitionById.get(id);
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
    for (const saved of records) {
      if (!isCurrentFishingShoalId(saved.id) || !this.definitionById.has(saved.id)) {
        throw new RangeError(`Fishing shoal ${saved.id} does not match the regenerated catalog`);
      }
      if (this.provisionalById.has(saved.id)) throw new RangeError(`Fishing shoal ${saved.id} is duplicated`);
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
}
