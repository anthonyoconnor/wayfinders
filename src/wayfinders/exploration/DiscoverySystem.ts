import type { GeneratedIsland } from "../world/IslandGenerator";
import { IslandKind } from "../world/IslandGenerator";
import { seededValue } from "../world/SeededRandom";
import type { WorldGrid } from "../world/WorldGrid";

export enum DiscoveryType {
  Island = 0,
  Settlement = 1,
  FishingGround = 2,
  Anchorage = 3,
  ReefPassage = 4,
  HistoricWreck = 5,
  Resource = 6,
}

export interface DiscoveryDefinition {
  /** Stable generated-island ID; kept numeric for the version-one save schema. */
  id: number;
  type: DiscoveryType;
  islandId: number;
  name: string;
  rewardId: string;
  rewardLabel: string;
  detail: string;
  settlementId?: string;
  resourceId?: number;
}

export interface DiscoveryRecord extends DiscoveryDefinition {
  tileX: number;
  tileY: number;
  returned: boolean;
  expeditionId: number;
  generation: number;
}

export interface DiscoveryObservation {
  found: readonly Readonly<DiscoveryRecord>[];
}

const DISCOVERY_NAMESPACE = 41_009;
const NAME_ADJECTIVES = [
  "Amber", "Blue", "Bracken", "Cloud", "Copper", "Dawn", "Far", "Glass",
  "Green", "Hollow", "Moon", "North", "Quiet", "Red", "Salt", "Star",
] as const;
const NAME_NOUNS = [
  "Cairn", "Cay", "Crown", "Haven", "Head", "Key", "Lantern", "Mere",
  "Needle", "Reach", "Rest", "Rook", "Sound", "Spire", "Tide", "Watch",
] as const;
const SETTLEMENTS = ["anchorage", "hamlet", "harbour"] as const;
const RESOURCES = ["amber", "hardwood", "salt", "spice"] as const;

function choose<T>(values: readonly T[], seed: number, islandId: number, slot: number): T {
  const index = Math.floor(seededValue(seed + DISCOVERY_NAMESPACE, islandId, slot) * values.length);
  return values[Math.min(values.length - 1, index)];
}

function typeForIsland(island: GeneratedIsland, seed: number): DiscoveryType {
  switch (island.kind) {
    case IslandKind.HighIsland: return DiscoveryType.Settlement;
    case IslandKind.LowCay: return DiscoveryType.Resource;
    case IslandKind.Atoll:
      return seededValue(seed + DISCOVERY_NAMESPACE, island.id, 21) < 0.5
        ? DiscoveryType.Anchorage
        : DiscoveryType.ReefPassage;
    case IslandKind.RockySkerry:
      return seededValue(seed + DISCOVERY_NAMESPACE, island.id, 22) < 0.5
        ? DiscoveryType.HistoricWreck
        : DiscoveryType.FishingGround;
  }
}

function describeDiscovery(
  island: GeneratedIsland,
  type: DiscoveryType,
  seed: number,
): Pick<DiscoveryDefinition, "detail" | "rewardId" | "rewardLabel" | "settlementId" | "resourceId"> {
  switch (type) {
    case DiscoveryType.Settlement: {
      const settlement = choose(SETTLEMENTS, seed, island.id, 31);
      return {
        detail: `A ${settlement} with people willing to support later voyages.`,
        rewardId: `welcome-${settlement}`,
        rewardLabel: `${settlement} welcome`,
        settlementId: `${settlement}:${island.id}`,
      };
    }
    case DiscoveryType.Resource: {
      const resource = choose(RESOURCES, seed, island.id, 32);
      return {
        detail: `A dependable source of ${resource}.`,
        rewardId: `resource-${resource}`,
        rewardLabel: `${resource} source`,
        resourceId: 1_000 + island.id,
      };
    }
    case DiscoveryType.Anchorage:
      return {
        detail: "A sheltered anchorage for future crossings.",
        rewardId: "safe-anchorage",
        rewardLabel: "sheltered anchorage",
      };
    case DiscoveryType.ReefPassage:
      return {
        detail: "A navigable passage through the reef.",
        rewardId: "reef-passage",
        rewardLabel: "charted reef passage",
      };
    case DiscoveryType.HistoricWreck:
      return {
        detail: "An old wreck unrelated to the player's lost ships.",
        rewardId: "old-charts",
        rewardLabel: "weathered charts",
      };
    case DiscoveryType.FishingGround:
      return {
        detail: "Rich fishing water near the island shelf.",
        rewardId: "fishing-ground",
        rewardLabel: "rich fishing ground",
      };
    case DiscoveryType.Island:
      return {
        detail: "A newly named island.",
        rewardId: "island-chart",
        rewardLabel: "new island chart",
      };
  }
}

/** Generates content without consuming any terrain-generation random stream. */
export function generateDiscoveryDefinitions(
  seed: number,
  islands: readonly GeneratedIsland[],
): readonly DiscoveryDefinition[] {
  const definitions: DiscoveryDefinition[] = [];
  const usedNames = new Set<string>();

  for (const island of [...islands].sort((left, right) => left.id - right.id)) {
    let salt = 0;
    let name: string;
    do {
      const adjective = choose(NAME_ADJECTIVES, seed, island.id, 1 + salt * 2);
      const noun = choose(NAME_NOUNS, seed, island.id, 2 + salt * 2);
      name = `${adjective} ${noun}`;
      salt++;
    } while (usedNames.has(name) && salt < NAME_ADJECTIVES.length * NAME_NOUNS.length);
    if (usedNames.has(name)) name = `${name} ${island.id}`;
    usedNames.add(name);

    const type = typeForIsland(island, seed);
    definitions.push({
      id: island.id,
      islandId: island.id,
      type,
      name,
      ...describeDiscovery(island, type, seed),
    });
  }
  return definitions;
}

/** Owns provisional and returned discovery records; generated definitions stay immutable. */
export class DiscoverySystem {
  readonly definitions: readonly DiscoveryDefinition[];

  private readonly definitionByIsland = new Map<number, DiscoveryDefinition>();
  private readonly provisionalById = new Map<number, DiscoveryRecord>();
  private readonly returnedById = new Map<number, DiscoveryRecord>();
  private provisionalCache: ReadonlyArray<Readonly<DiscoveryRecord>> = Object.freeze([]);
  private returnedCache: ReadonlyArray<Readonly<DiscoveryRecord>> = Object.freeze([]);
  private allRecordsCache: ReadonlyArray<Readonly<DiscoveryRecord>> = Object.freeze([]);
  private recordsDirty = false;
  private recordsRevisionValue = 0;

  constructor(
    private readonly world: WorldGrid,
    seed: number,
    islands: readonly GeneratedIsland[],
  ) {
    this.definitions = generateDiscoveryDefinitions(seed, islands);
    for (const definition of this.definitions) this.definitionByIsland.set(definition.islandId, definition);
  }

  get provisional(): readonly Readonly<DiscoveryRecord>[] {
    this.refreshRecordCaches();
    return this.provisionalCache;
  }

  get returned(): readonly Readonly<DiscoveryRecord>[] {
    this.refreshRecordCaches();
    return this.returnedCache;
  }

  get allRecords(): readonly Readonly<DiscoveryRecord>[] {
    this.refreshRecordCaches();
    return this.allRecordsCache;
  }

  /** Changes only when the provisional/returned record collections change. */
  get recordsRevision(): number {
    return this.recordsRevisionValue;
  }

  observeCurrentSight(
    expeditionId: number,
    generation: number,
    visibleIndices: Iterable<number> = this.world.getVisibleIndices(),
  ): DiscoveryObservation {
    const firstVisibleByIsland = new Map<number, number>();
    for (const index of visibleIndices) {
      const islandId = this.world.getIslandIdAtIndex(index);
      if (islandId <= 0 || firstVisibleByIsland.has(islandId)) continue;
      firstVisibleByIsland.set(islandId, index);
    }

    const found: DiscoveryRecord[] = [];
    for (const [islandId, index] of firstVisibleByIsland) {
      const definition = this.definitionByIsland.get(islandId);
      if (!definition || this.provisionalById.has(definition.id) || this.returnedById.has(definition.id)) continue;
      const tile = this.world.pointFromIndex(index);
      const record: DiscoveryRecord = {
        ...definition,
        tileX: tile.x,
        tileY: tile.y,
        returned: false,
        expeditionId,
        generation,
      };
      this.provisionalById.set(record.id, record);
      found.push(record);
    }
    found.sort((left, right) => left.id - right.id);
    if (found.length > 0) this.markRecordsChanged();
    return { found };
  }

  commitExpedition(expeditionId: number): readonly Readonly<DiscoveryRecord>[] {
    const committed: DiscoveryRecord[] = [];
    for (const [id, record] of this.provisionalById) {
      if (record.expeditionId !== expeditionId) continue;
      const returned = { ...record, returned: true };
      this.provisionalById.delete(id);
      this.returnedById.set(id, returned);
      committed.push(returned);
    }
    committed.sort((left, right) => left.id - right.id);
    if (committed.length > 0) this.markRecordsChanged();
    return committed;
  }

  revertExpedition(expeditionId: number): readonly Readonly<DiscoveryRecord>[] {
    const lost: DiscoveryRecord[] = [];
    for (const [id, record] of this.provisionalById) {
      if (record.expeditionId !== expeditionId) continue;
      this.provisionalById.delete(id);
      lost.push(record);
    }
    lost.sort((left, right) => left.id - right.id);
    if (lost.length > 0) this.markRecordsChanged();
    return lost;
  }

  restore(
    provisional: readonly DiscoveryRecord[],
    returned: readonly DiscoveryRecord[],
  ): void {
    this.provisionalById.clear();
    this.returnedById.clear();
    for (const record of returned) this.restoreRecord(record, true);
    for (const record of provisional) this.restoreRecord(record, false);
    this.markRecordsChanged();
  }

  private restoreRecord(saved: DiscoveryRecord, returned: boolean): void {
    const definition = this.definitionByIsland.get(saved.islandId);
    if (!definition || definition.id !== saved.id || definition.type !== saved.type) {
      throw new RangeError(`Discovery ${saved.id} does not match the regenerated world catalog`);
    }
    if (!this.world.inBounds(saved.tileX, saved.tileY)) {
      throw new RangeError(`Discovery ${saved.id} is outside the regenerated world`);
    }
    if (this.world.getIslandId(saved.tileX, saved.tileY) !== saved.islandId) {
      throw new RangeError(`Discovery ${saved.id} marker does not belong to its regenerated island`);
    }
    if (!Number.isInteger(saved.expeditionId) || saved.expeditionId <= 0 || saved.expeditionId > 0xffff_ffff) {
      throw new RangeError(`Discovery ${saved.id} has an invalid expedition ID`);
    }
    if (!Number.isSafeInteger(saved.generation) || saved.generation <= 0) {
      throw new RangeError(`Discovery ${saved.id} has an invalid generation`);
    }
    if (this.provisionalById.has(saved.id) || this.returnedById.has(saved.id)) {
      throw new RangeError(`Discovery ${saved.id} is duplicated`);
    }
    const record: DiscoveryRecord = {
      ...definition,
      tileX: saved.tileX,
      tileY: saved.tileY,
      returned,
      expeditionId: saved.expeditionId,
      generation: saved.generation,
    };
    (returned ? this.returnedById : this.provisionalById).set(record.id, record);
  }

  private markRecordsChanged(): void {
    this.recordsDirty = true;
    this.recordsRevisionValue++;
  }

  private refreshRecordCaches(): void {
    if (!this.recordsDirty) return;
    this.provisionalCache = Object.freeze([...this.provisionalById.values()]
      .sort((left, right) => left.id - right.id));
    this.returnedCache = Object.freeze([...this.returnedById.values()]
      .sort((left, right) => left.id - right.id));
    this.allRecordsCache = Object.freeze([...this.returnedCache, ...this.provisionalCache]);
    this.recordsDirty = false;
  }
}
