import type { GridPoint } from "../../core/types";
import type {
  FishingShoalId,
  FishingShoalQuality,
} from "../fishing";
import type { SupportedPathEdge } from "../../exploration/SupportedConnectivitySystem";

export const PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION = 1 as const;

const prosperityTrafficRouteIdBrand: unique symbol = Symbol("ProsperityTrafficRouteId");

export type ProsperityTrafficRouteId = string & {
  readonly [prosperityTrafficRouteIdBrand]: true;
};

export type ProsperityTrafficRouteKind = "fishing" | "trade";

/**
 * Direction-preserving route geometry selected by Supported-water authority.
 * Every object and nested point published by the route system is immutable.
 */
export type ProsperityTrafficRouteEdgeV1 = Readonly<SupportedPathEdge>;

interface ProsperityTrafficRouteBaseV1 {
  readonly contractVersion: typeof PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION;
  readonly id: ProsperityTrafficRouteId;
  readonly kind: ProsperityTrafficRouteKind;
  /** Selected Supported-water endpoint, inclusive in pathIndices. */
  readonly destinationIndex: number;
  readonly destinationTile: Readonly<GridPoint>;
  /** Exact home-to-destination Supported route, inclusive at both ends. */
  readonly pathIndices: readonly number[];
  /** Direction-preserving lifted geometry for every adjacent path pair. */
  readonly pathEdges: readonly ProsperityTrafficRouteEdgeV1[];
}

export interface ProsperityFishingTrafficRouteV1 extends ProsperityTrafficRouteBaseV1 {
  readonly kind: "fishing";
  readonly fishingShoalId: FishingShoalId;
  readonly shoalTile: Readonly<GridPoint>;
  readonly quality: FishingShoalQuality;
}

export interface ProsperityTradeTrafficRouteV1 extends ProsperityTrafficRouteBaseV1 {
  readonly kind: "trade";
  readonly islandId: number;
  readonly islandName: string;
  /** Only the explicit returned community dossier can create this route. */
  readonly dossierTheme: "community";
}

export type ProsperityTrafficRouteV1 =
  | ProsperityFishingTrafficRouteV1
  | ProsperityTradeTrafficRouteV1;

export interface ProsperityTrafficRouteReadModelV1 {
  readonly contractVersion: typeof PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION;
  /** Changes only when the immutable route collection changes. */
  readonly revision: number;
  /** Fishing routes first by shoal ID, then trade routes by numeric island ID. */
  readonly routes: readonly Readonly<ProsperityTrafficRouteV1>[];
  readonly fishingRoutes: readonly Readonly<ProsperityFishingTrafficRouteV1>[];
  readonly tradeRoutes: readonly Readonly<ProsperityTradeTrafficRouteV1>[];
}

export interface ProsperityTrafficRouteRefreshV1 {
  readonly fishingRecordsRevision: number;
  readonly islandDossierRecordsRevision: number;
  readonly supportedTopologyRevision: number;
}
