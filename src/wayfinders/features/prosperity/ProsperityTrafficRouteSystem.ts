import type {
  FishingShoalDefinition,
  FishingShoalReturnedRecordV1,
} from "../fishing";
import type {
  IslandDossierDefinitionV1,
  IslandDossierReturnedRecordV1,
} from "../../exploration/IslandDossierContracts";
import {
  SupportedConnectivitySystem,
  type SupportedConnectivityResult,
  type SupportedPathEdge,
} from "../../exploration/SupportedConnectivitySystem";
import type { WorldGrid } from "../../world/WorldGrid";
import {
  PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
  type ProsperityFishingTrafficRouteV1,
  type ProsperityTradeTrafficRouteV1,
  type ProsperityTrafficRouteEdgeV1,
  type ProsperityTrafficRouteId,
  type ProsperityTrafficRouteReadModelV1,
  type ProsperityTrafficRouteRefreshV1,
  type ProsperityTrafficRouteV1,
} from "./ProsperityTrafficRouteContracts";

interface RefreshKey {
  readonly fishingRecordsRevision: number;
  readonly islandDossierRecordsRevision: number;
  readonly supportedTopologyRevision: number;
}

function emptyReadModel(): Readonly<ProsperityTrafficRouteReadModelV1> {
  const fishingRoutes = Object.freeze([] as Readonly<ProsperityFishingTrafficRouteV1>[]);
  const tradeRoutes = Object.freeze([] as Readonly<ProsperityTradeTrafficRouteV1>[]);
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    revision: 0,
    routes: Object.freeze([] as Readonly<ProsperityTrafficRouteV1>[]),
    fishingRoutes,
    tradeRoutes,
  });
}

function assertRevision(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function sameRefreshKey(
  left: Readonly<RefreshKey> | undefined,
  right: Readonly<RefreshKey>,
): boolean {
  return left?.fishingRecordsRevision === right.fishingRecordsRevision
    && left.islandDossierRecordsRevision === right.islandDossierRecordsRevision
    && left.supportedTopologyRevision === right.supportedTopologyRevision;
}

function fishingRouteId(id: string): ProsperityTrafficRouteId {
  return `prosperity-traffic:v1:fishing:${id}` as ProsperityTrafficRouteId;
}

function tradeRouteId(islandId: number): ProsperityTrafficRouteId {
  return `prosperity-traffic:v1:trade:island:${islandId}` as ProsperityTrafficRouteId;
}

function immutableEdge(edge: Readonly<SupportedPathEdge>): ProsperityTrafficRouteEdgeV1 {
  return Object.freeze({
    fromIndex: edge.fromIndex,
    toIndex: edge.toIndex,
    direction: edge.direction,
    imageOffset: Object.freeze({ ...edge.imageOffset }),
    destinationImageOffset: Object.freeze({ ...edge.destinationImageOffset }),
    liftedFrom: Object.freeze({ ...edge.liftedFrom }),
    liftedTo: Object.freeze({ ...edge.liftedTo }),
  });
}

function routeGeometry(result: Readonly<SupportedConnectivityResult>): Readonly<Pick<
  ProsperityTrafficRouteV1,
  "destinationIndex" | "pathIndices" | "pathEdges"
>> {
  return Object.freeze({
    destinationIndex: result.serviceAnchorIndex,
    pathIndices: Object.freeze([...result.pathIndices]),
    pathEdges: Object.freeze(result.pathEdges.map(immutableEdge)),
  });
}

function equalNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalEdges(
  left: readonly Readonly<ProsperityTrafficRouteEdgeV1>[],
  right: readonly Readonly<ProsperityTrafficRouteEdgeV1>[],
): boolean {
  return left.length === right.length && left.every((edge, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && edge.fromIndex === candidate.fromIndex
      && edge.toIndex === candidate.toIndex
      && edge.direction === candidate.direction
      && edge.imageOffset.x === candidate.imageOffset.x
      && edge.imageOffset.y === candidate.imageOffset.y
      && edge.destinationImageOffset.x === candidate.destinationImageOffset.x
      && edge.destinationImageOffset.y === candidate.destinationImageOffset.y
      && edge.liftedFrom.x === candidate.liftedFrom.x
      && edge.liftedFrom.y === candidate.liftedFrom.y
      && edge.liftedTo.x === candidate.liftedTo.x
      && edge.liftedTo.y === candidate.liftedTo.y;
  });
}

function equalRoutes(
  left: readonly Readonly<ProsperityTrafficRouteV1>[],
  right: readonly Readonly<ProsperityTrafficRouteV1>[],
): boolean {
  return left.length === right.length && left.every((route, index) => {
    const candidate = right[index];
    if (
      candidate === undefined
      || route.id !== candidate.id
      || route.kind !== candidate.kind
      || route.destinationIndex !== candidate.destinationIndex
      || route.destinationTile.x !== candidate.destinationTile.x
      || route.destinationTile.y !== candidate.destinationTile.y
      || !equalNumbers(route.pathIndices, candidate.pathIndices)
      || !equalEdges(route.pathEdges, candidate.pathEdges)
    ) return false;
    if (route.kind === "fishing" && candidate.kind === "fishing") {
      return route.fishingShoalId === candidate.fishingShoalId
        && route.shoalTile.x === candidate.shoalTile.x
        && route.shoalTile.y === candidate.shoalTile.y
        && route.quality === candidate.quality;
    }
    if (route.kind === "trade" && candidate.kind === "trade") {
      return route.islandId === candidate.islandId
        && route.islandName === candidate.islandName
        && route.dossierTheme === candidate.dossierTheme;
    }
    return false;
  });
}

/**
 * Rebuildable, renderer-neutral route projection over returned knowledge.
 * Construction is world/session scoped, so regeneration naturally starts with
 * an empty cache and revision zero.
 */
export class ProsperityTrafficRouteSystem {
  private readonly fishingDefinitions = new Map<string, Readonly<FishingShoalDefinition>>();
  private readonly islandDefinitions = new Map<number, Readonly<IslandDossierDefinitionV1>>();
  private cachedRefreshKey: Readonly<RefreshKey> | undefined;
  private readModelValue: Readonly<ProsperityTrafficRouteReadModelV1> = emptyReadModel();

  constructor(
    private readonly world: WorldGrid,
    private readonly connectivity: SupportedConnectivitySystem,
    fishingDefinitions: readonly Readonly<FishingShoalDefinition>[],
    islandDefinitions: readonly Readonly<IslandDossierDefinitionV1>[],
  ) {
    if (!connectivity.isCompatibleWithWorld(world)) {
      throw new RangeError("Prosperity traffic connectivity must use the same world");
    }
    for (const definition of fishingDefinitions) {
      if (this.fishingDefinitions.has(definition.id)) {
        throw new RangeError(`Duplicate fishing-shoal definition ${definition.id}`);
      }
      this.fishingDefinitions.set(definition.id, definition);
    }
    for (const definition of islandDefinitions) {
      if (this.islandDefinitions.has(definition.islandId)) {
        throw new RangeError(`Duplicate island-dossier definition ${definition.islandId}`);
      }
      this.islandDefinitions.set(definition.islandId, definition);
    }
  }

  get readModel(): Readonly<ProsperityTrafficRouteReadModelV1> {
    return this.readModelValue;
  }

  refresh(
    refresh: Readonly<ProsperityTrafficRouteRefreshV1>,
    returnedFishingShoals: readonly Readonly<FishingShoalReturnedRecordV1>[],
    returnedIslandDossiers: readonly Readonly<IslandDossierReturnedRecordV1>[],
  ): Readonly<ProsperityTrafficRouteReadModelV1> {
    assertRevision(refresh.fishingRecordsRevision, "Fishing records revision");
    assertRevision(refresh.islandDossierRecordsRevision, "Island-dossier records revision");
    assertRevision(refresh.supportedTopologyRevision, "Supported topology revision");
    const refreshKey = Object.freeze({ ...refresh });
    if (sameRefreshKey(this.cachedRefreshKey, refreshKey)) return this.readModelValue;

    const fishingRoutes = this.buildFishingRoutes(
      returnedFishingShoals,
      refresh.supportedTopologyRevision,
    );
    const tradeRoutes = this.buildTradeRoutes(
      returnedIslandDossiers,
      refresh.supportedTopologyRevision,
    );
    const routes = Object.freeze<Readonly<ProsperityTrafficRouteV1>[]>([
      ...fishingRoutes,
      ...tradeRoutes,
    ]);
    this.cachedRefreshKey = refreshKey;
    if (equalRoutes(this.readModelValue.routes, routes)) return this.readModelValue;

    this.readModelValue = Object.freeze({
      contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
      revision: this.readModelValue.revision + 1,
      routes,
      fishingRoutes,
      tradeRoutes,
    });
    return this.readModelValue;
  }

  private buildFishingRoutes(
    returned: readonly Readonly<FishingShoalReturnedRecordV1>[],
    supportedTopologyRevision: number,
  ): readonly Readonly<ProsperityFishingTrafficRouteV1>[] {
    const seen = new Set<string>();
    const surveyed = returned
      .filter((record) => record.state === "survey")
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const routes: Readonly<ProsperityFishingTrafficRouteV1>[] = [];
    for (const record of surveyed) {
      if (seen.has(record.id)) throw new RangeError(`Duplicate returned fishing shoal ${record.id}`);
      seen.add(record.id);
      const definition = this.fishingDefinitions.get(record.id);
      if (!definition) throw new RangeError(`Returned fishing shoal ${record.id} has no definition`);
      const result = this.connectivity.connectivityTo(
        definition.serviceAnchor,
        supportedTopologyRevision,
      );
      if (!result.connected) continue;
      const geometry = routeGeometry(result);
      routes.push(Object.freeze({
        contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
        id: fishingRouteId(definition.id),
        kind: "fishing",
        fishingShoalId: definition.id,
        shoalTile: Object.freeze({ ...definition.tile }),
        quality: definition.quality,
        destinationIndex: geometry.destinationIndex,
        destinationTile: Object.freeze(this.world.pointFromIndex(geometry.destinationIndex)),
        pathIndices: geometry.pathIndices,
        pathEdges: geometry.pathEdges,
      }));
    }
    return Object.freeze(routes);
  }

  private buildTradeRoutes(
    returned: readonly Readonly<IslandDossierReturnedRecordV1>[],
    supportedTopologyRevision: number,
  ): readonly Readonly<ProsperityTradeTrafficRouteV1>[] {
    const seen = new Set<number>();
    const dossiers = returned
      .filter((record) => record.state === "dossier")
      .sort((left, right) => left.islandId - right.islandId);
    const routes: Readonly<ProsperityTradeTrafficRouteV1>[] = [];
    for (const record of dossiers) {
      if (seen.has(record.islandId)) {
        throw new RangeError(`Duplicate returned island dossier ${record.islandId}`);
      }
      seen.add(record.islandId);
      const definition = this.islandDefinitions.get(record.islandId);
      if (!definition) {
        throw new RangeError(`Returned island dossier ${record.islandId} has no definition`);
      }
      if (definition.dossier.theme !== "community") continue;
      const result = this.connectivity.connectivityToAny(
        definition.approachIndices.map((index) => this.world.pointFromIndex(index)),
        supportedTopologyRevision,
      );
      if (!result?.connected) continue;
      const geometry = routeGeometry(result);
      routes.push(Object.freeze({
        contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
        id: tradeRouteId(definition.islandId),
        kind: "trade",
        islandId: definition.islandId,
        islandName: definition.name,
        dossierTheme: "community",
        destinationIndex: geometry.destinationIndex,
        destinationTile: Object.freeze(this.world.pointFromIndex(geometry.destinationIndex)),
        pathIndices: geometry.pathIndices,
        pathEdges: geometry.pathEdges,
      }));
    }
    return Object.freeze(routes);
  }
}
