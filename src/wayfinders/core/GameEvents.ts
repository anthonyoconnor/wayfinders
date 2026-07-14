import type { GridPoint, ShipwreckState } from "./types";
import type {
  IslandDossierProvisionalRecordV1,
  IslandDossierReturnedRecordV1,
  IslandDossierSurveyedResultV1,
} from "../exploration/IslandDossierContracts";
import type {
  SurveySiteClue,
  SurveySiteId,
  SurveySiteProvisionalRecord,
  SurveySiteReturnedRecord,
  SurveySiteSurveyedResult,
  SurveySiteType,
} from "../exploration/SurveySiteContracts";
import type {
  FishingShoalClue,
  FishingShoalId,
  FishingShoalSurveyedResultV1,
  FishingShoalProvisionalRecordV1,
  FishingShoalReturnedRecordV1,
} from "../exploration/FishingShoalContracts";
import type {
  WreckSurveyReportV1,
  WreckSurveyedResultV1,
} from "../exploration/WreckSurveyContracts";
import type {
  NavigatorId,
  NavigatorSuccessionReason,
  NavigatorVoyageAchievementRecordV3,
} from "../lineage/NavigatorLineageSystem";

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
  navigatorTenureCompleted: {
    navigatorId: NavigatorId;
    generation: number;
    completedVoyages: number;
    nextNavigatorId: NavigatorId;
    nextGeneration: number;
  };
  expeditionReturned: {
    expeditionId: number;
    generation: number;
    navigatorId: NavigatorId;
    voyageNumber: number;
    voyagesRemaining: number;
    tenureCompleted: boolean;
    /** Personal route tiles committed by this expedition. */
    supportedTileCount: number;
    /** Enclosed Unknown tiles separately inferred by the return cleanup. */
    closedUnknownTileCount: number;
    /** Immutable exact-dock achievement record stored in the navigator lineage. */
    achievements: Readonly<NavigatorVoyageAchievementRecordV3>;
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
    previousNavigatorId: NavigatorId;
    generation: number;
    navigatorId: NavigatorId;
    reason: NavigatorSuccessionReason;
  };
  wreckDiscovered: {
    wreckId: number;
    tileX: number;
    tileY: number;
  };
  wreckSurveyed: Readonly<WreckSurveyedResultV1> & {
    tile: Readonly<GridPoint>;
  };
  wreckSurveysReturned: {
    expeditionId: number;
    generation: number;
    reports: readonly Readonly<WreckSurveyReportV1>[];
  };
  wreckSurveysLost: {
    expeditionId: number;
    generation: number;
    reports: readonly Readonly<WreckSurveyReportV1>[];
  };
  islandSighted: {
    islandId: number;
    name: string;
    canonicalApproach: Readonly<GridPoint>;
  };
  islandDossierSurveyed: Readonly<IslandDossierSurveyedResultV1> & {
    canonicalApproach: Readonly<GridPoint>;
  };
  islandDossiersReturned: {
    expeditionId: number;
    generation: number;
    leads: readonly Readonly<IslandDossierReturnedRecordV1>[];
    dossiers: readonly Readonly<IslandDossierReturnedRecordV1>[];
  };
  islandDossiersLost: {
    expeditionId: number;
    generation: number;
    records: readonly Readonly<IslandDossierProvisionalRecordV1>[];
  };
  surveySiteSighted: {
    id: SurveySiteId;
    type: SurveySiteType;
    typeLabel: string;
    tile: Readonly<GridPoint>;
    serviceAnchor: Readonly<GridPoint>;
    clue: Readonly<SurveySiteClue>;
  };
  surveySiteSurveyed: Readonly<SurveySiteSurveyedResult> & {
    tile: Readonly<GridPoint>;
    serviceAnchor: Readonly<GridPoint>;
  };
  surveySitesReturned: {
    expeditionId: number;
    generation: number;
    leads: readonly Readonly<SurveySiteReturnedRecord>[];
    reports: readonly Readonly<SurveySiteReturnedRecord>[];
  };
  surveySitesLost: {
    expeditionId: number;
    generation: number;
    records: readonly Readonly<SurveySiteProvisionalRecord>[];
  };
  fishingShoalSighted: {
    id: FishingShoalId;
    tile: Readonly<GridPoint>;
    clue: Readonly<FishingShoalClue>;
  };
  fishingShoalSurveyed: Readonly<FishingShoalSurveyedResultV1> & {
    tile: Readonly<GridPoint>;
  };
  fishingShoalsReturned: {
    expeditionId: number;
    generation: number;
    leads: readonly Readonly<FishingShoalReturnedRecordV1>[];
    surveys: readonly Readonly<FishingShoalReturnedRecordV1>[];
  };
  fishingShoalsLost: {
    expeditionId: number;
    generation: number;
    records: readonly Readonly<FishingShoalProvisionalRecordV1>[];
  };
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
