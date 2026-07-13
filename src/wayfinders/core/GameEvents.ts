import type { GridPoint, ShipwreckState } from "./types";
import type { DiscoveryRecord } from "../exploration/DiscoverySystem";
import type {
  FishingShoalClue,
  FishingShoalId,
  FishingShoalSurveyedResultV1,
} from "../exploration/FishingShoalContracts";

export type ReplenishmentReason = "dock" | "return" | "respawn";

export interface GameEventMap {
  shipEnteredTile: GridPoint;
  knowledgeChanged: { count: number };
  provisionConsumed: { remaining: number };
  provisionsChanged: { previous: number; current: number };
  shipReplenished: {
    generation: number;
    bundles: number;
    reason: ReplenishmentReason;
  };
  returnStateChanged: undefined;
  expeditionStarted: { expeditionId: number; generation: number };
  expeditionReturned: {
    expeditionId: number;
    generation: number;
    /** Personal route tiles committed by this expedition. */
    supportedTileCount: number;
    /** Enclosed Unknown tiles separately inferred by the return cleanup. */
    closedUnknownTileCount: number;
  };
  shipWrecked: {
    wreckId: number;
    expeditionId: number;
    generation: number;
    tileX: number;
    tileY: number;
    worldX: number;
    worldY: number;
  };
  generationAdvanced: {
    previousGeneration: number;
    generation: number;
    reason: "wreck";
  };
  wreckDiscovered: {
    wreckId: number;
    generation: number;
    tileX: number;
    tileY: number;
  };
  discoveryFound: Readonly<DiscoveryRecord>;
  fishingShoalSighted: {
    id: FishingShoalId;
    tile: Readonly<GridPoint>;
    clue: Readonly<FishingShoalClue>;
  };
  fishingShoalSurveyed: Readonly<FishingShoalSurveyedResultV1> & {
    tile: Readonly<GridPoint>;
  };
  discoveriesReturned: {
    expeditionId: number;
    generation: number;
    discoveries: readonly Readonly<DiscoveryRecord>[];
  };
  discoveriesLost: {
    expeditionId: number;
    generation: number;
    discoveries: readonly Readonly<DiscoveryRecord>[];
  };
  gameLoaded: { schemaVersion: number; seed: number };
  expeditionFailed: {
    expeditionId: number;
    generation: number;
    forgottenTiles: number;
    nextGeneration: number;
    wreck: Readonly<ShipwreckState>;
  };
  worldRegenerated: { seed: number };
  shipTeleported: GridPoint;
}

export type GameEventName = keyof GameEventMap;

type Listener<T> = (payload: T) => void;

/** Small typed event bus shared by the headless simulation and adapters. */
export class GameEvents {
  private readonly listeners = new Map<GameEventName, Set<Listener<never>>>();

  on<K extends GameEventName>(name: K, listener: Listener<GameEventMap[K]>): () => void {
    let group = this.listeners.get(name);
    if (!group) {
      group = new Set();
      this.listeners.set(name, group);
    }
    group.add(listener as Listener<never>);
    return () => group?.delete(listener as Listener<never>);
  }

  emit<K extends GameEventName>(name: K, payload: GameEventMap[K]): void {
    const group = this.listeners.get(name);
    if (!group) return;
    for (const listener of group) (listener as Listener<GameEventMap[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
