import type {
  ProsperityTrafficRouteId,
  ProsperityTrafficRouteReadModelV1,
  ProsperityTrafficRouteV1,
} from "../../features/prosperity";

export const PROSPERITY_TRAFFIC_PRESENTATION_VERSION = 1 as const;
export const PROSPERITY_TRAFFIC_MAX_FISHING_VESSELS = 2 as const;
export const PROSPERITY_TRAFFIC_MAX_TRADE_VESSELS = 2 as const;
export const PROSPERITY_TRAFFIC_SPEED_TILES_PER_SECOND = 0.65 as const;
export const PROSPERITY_TRAFFIC_DESTINATION_DWELL_SECONDS = 9 as const;
export const PROSPERITY_TRAFFIC_HOME_DWELL_SECONDS = 12 as const;
export const PROSPERITY_TRAFFIC_HOME_DWELL_EDGE_PROGRESS = 0.65 as const;
export const PROSPERITY_TRAFFIC_REDUCED_MOTION_EDGE_PROGRESS = 0.75 as const;

const prosperityTrafficVesselIdBrand: unique symbol = Symbol("ProsperityTrafficVesselId");

export type ProsperityTrafficVesselId = string & {
  readonly [prosperityTrafficVesselIdBrand]: true;
};

export type ProsperityTrafficJourneyPhase =
  | "outbound"
  | "destination-dwell"
  | "inbound"
  | "home-dwell"
  | "reduced-motion"
  | "stationary";

export interface ProsperityTrafficRouteTiming {
  /** Complete stored route length, including the quiet Home departure edge. */
  readonly distanceTiles: number;
  readonly homeDwellDistanceTiles: number;
  readonly travelDistanceTiles: number;
  readonly outboundSeconds: number;
  readonly destinationDwellSeconds: number;
  readonly inboundSeconds: number;
  readonly homeDwellSeconds: number;
  readonly cycleSeconds: number;
  /** Stable first-service position inside destination dwell. */
  readonly phaseOffsetSeconds: number;
}

export interface ProsperityTrafficVesselPresentation {
  readonly presentationVersion: typeof PROSPERITY_TRAFFIC_PRESENTATION_VERSION;
  readonly id: ProsperityTrafficVesselId;
  readonly routeId: ProsperityTrafficRouteId;
  readonly kind: ProsperityTrafficRouteV1["kind"];
  readonly phase: ProsperityTrafficJourneyPhase;
  /** Lifted tile-centre position. Multiply by navigation tile size for world pixels. */
  readonly liftedTileX: number;
  readonly liftedTileY: number;
  /** Canonical Home tile-centre used for minimum-image harbour density. */
  readonly homeCanonicalTileX: number;
  readonly homeCanonicalTileY: number;
  /** Movement-system convention: east 0, south 90, west 180, north 270. */
  readonly headingDegrees: number;
  readonly moving: boolean;
  readonly wakeVisible: boolean;
  /** Lifted diagnostic only; density policy uses minimum-image Home distance. */
  readonly distanceFromHomeTiles: number;
}

export interface ProsperityTrafficPresentationFrame {
  readonly presentationVersion: typeof PROSPERITY_TRAFFIC_PRESENTATION_VERSION;
  readonly routeRevision: number;
  /** Increments only after every vessel in a service round has reached Home. */
  readonly selectionEpoch: number;
  /** At most two fishing and two trade vessels. */
  readonly vessels: readonly Readonly<ProsperityTrafficVesselPresentation>[];
}

interface SampledPosition {
  readonly x: number;
  readonly y: number;
  readonly headingDegrees: number;
}

function assertElapsedSeconds(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Prosperity traffic elapsed seconds must be finite and non-negative");
  }
}

function positiveModulo(value: number, divisor: number): number {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapDegrees(value: number): number {
  return positiveModulo(value, 360);
}

function stableUnitInterval(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

function vesselId(routeId: ProsperityTrafficRouteId): ProsperityTrafficVesselId {
  return `prosperity-traffic-vessel:v1:${routeId}` as ProsperityTrafficVesselId;
}

function headingBetween(
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
): number {
  if (from.x === to.x && from.y === to.y) return 0;
  return wrapDegrees(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI);
}

function sampleOutboundDistance(
  route: Readonly<ProsperityTrafficRouteV1>,
  distanceTiles: number,
  reverseHeading: boolean,
): SampledPosition {
  const edgeCount = route.pathEdges.length;
  if (edgeCount === 0) {
    return {
      x: route.destinationTile.x + 0.5,
      y: route.destinationTile.y + 0.5,
      headingDegrees: 0,
    };
  }

  const clampedDistance = clamp(distanceTiles, 0, edgeCount);
  const edgeIndex = clampedDistance >= edgeCount
    ? edgeCount - 1
    : Math.floor(clampedDistance);
  const edge = route.pathEdges[edgeIndex];
  if (!edge) {
    return {
      x: route.destinationTile.x + 0.5,
      y: route.destinationTile.y + 0.5,
      headingDegrees: 0,
    };
  }
  const edgeProgress = clampedDistance >= edgeCount
    ? 1
    : clampedDistance - edgeIndex;
  const outboundHeading = headingBetween(edge.liftedFrom, edge.liftedTo);
  return {
    x: edge.liftedFrom.x + (edge.liftedTo.x - edge.liftedFrom.x) * edgeProgress + 0.5,
    y: edge.liftedFrom.y + (edge.liftedTo.y - edge.liftedFrom.y) * edgeProgress + 0.5,
    headingDegrees: reverseHeading ? wrapDegrees(outboundHeading + 180) : outboundHeading,
  };
}

function homePosition(route: Readonly<ProsperityTrafficRouteV1>): Readonly<{ x: number; y: number }> {
  const firstEdge = route.pathEdges[0];
  return firstEdge
    ? { x: firstEdge.liftedFrom.x + 0.5, y: firstEdge.liftedFrom.y + 0.5 }
    : { x: route.destinationTile.x + 0.5, y: route.destinationTile.y + 0.5 };
}

function immutableVessel(
  route: Readonly<ProsperityTrafficRouteV1>,
  phase: ProsperityTrafficJourneyPhase,
  position: Readonly<SampledPosition>,
  moving: boolean,
): Readonly<ProsperityTrafficVesselPresentation> {
  const home = homePosition(route);
  return Object.freeze({
    presentationVersion: PROSPERITY_TRAFFIC_PRESENTATION_VERSION,
    id: vesselId(route.id),
    routeId: route.id,
    kind: route.kind,
    phase,
    liftedTileX: position.x,
    liftedTileY: position.y,
    homeCanonicalTileX: home.x,
    homeCanonicalTileY: home.y,
    headingDegrees: position.headingDegrees,
    moving,
    wakeVisible: moving,
    distanceFromHomeTiles: Math.hypot(position.x - home.x, position.y - home.y),
  });
}

export function prosperityTrafficRouteTiming(
  route: Readonly<ProsperityTrafficRouteV1>,
): Readonly<ProsperityTrafficRouteTiming> {
  const distanceTiles = route.pathEdges.length;
  const homeDwellDistanceTiles = Math.min(
    distanceTiles,
    PROSPERITY_TRAFFIC_HOME_DWELL_EDGE_PROGRESS,
  );
  const travelDistanceTiles = Math.max(0, distanceTiles - homeDwellDistanceTiles);
  const outboundSeconds = travelDistanceTiles / PROSPERITY_TRAFFIC_SPEED_TILES_PER_SECOND;
  const inboundSeconds = outboundSeconds;
  const cycleSeconds = outboundSeconds
    + PROSPERITY_TRAFFIC_DESTINATION_DWELL_SECONDS
    + inboundSeconds
    + PROSPERITY_TRAFFIC_HOME_DWELL_SECONDS;
  const phaseOffsetSeconds = outboundSeconds
    + stableUnitInterval(route.id) * PROSPERITY_TRAFFIC_DESTINATION_DWELL_SECONDS;
  return Object.freeze({
    distanceTiles,
    homeDwellDistanceTiles,
    travelDistanceTiles,
    outboundSeconds,
    destinationDwellSeconds: PROSPERITY_TRAFFIC_DESTINATION_DWELL_SECONDS,
    inboundSeconds,
    homeDwellSeconds: PROSPERITY_TRAFFIC_HOME_DWELL_SECONDS,
    cycleSeconds,
    phaseOffsetSeconds,
  });
}

function sampleProsperityTrafficRouteAtCyclePosition(
  route: Readonly<ProsperityTrafficRouteV1>,
  cyclePositionSeconds: number,
  reducedMotion: boolean,
): Readonly<ProsperityTrafficVesselPresentation> {
  const timing = prosperityTrafficRouteTiming(route);
  if (timing.distanceTiles === 0) {
    return immutableVessel(
      route,
      "stationary",
      sampleOutboundDistance(route, 0, false),
      false,
    );
  }
  if (reducedMotion) {
    const staticDistance = Math.max(
      timing.homeDwellDistanceTiles,
      timing.distanceTiles - 1 + PROSPERITY_TRAFFIC_REDUCED_MOTION_EDGE_PROGRESS,
    );
    return immutableVessel(
      route,
      "reduced-motion",
      sampleOutboundDistance(route, staticDistance, false),
      false,
    );
  }

  const phaseSeconds = clamp(cyclePositionSeconds, 0, timing.cycleSeconds);
  if (phaseSeconds < timing.outboundSeconds) {
    return immutableVessel(
      route,
      "outbound",
      sampleOutboundDistance(
        route,
        timing.homeDwellDistanceTiles
          + phaseSeconds * PROSPERITY_TRAFFIC_SPEED_TILES_PER_SECOND,
        false,
      ),
      true,
    );
  }

  const destinationDwellEnd = timing.outboundSeconds + timing.destinationDwellSeconds;
  if (phaseSeconds < destinationDwellEnd) {
    return immutableVessel(
      route,
      "destination-dwell",
      sampleOutboundDistance(route, timing.distanceTiles, false),
      false,
    );
  }

  const inboundEnd = destinationDwellEnd + timing.inboundSeconds;
  if (phaseSeconds < inboundEnd) {
    const inboundDistance = (phaseSeconds - destinationDwellEnd)
      * PROSPERITY_TRAFFIC_SPEED_TILES_PER_SECOND;
    return immutableVessel(
      route,
      "inbound",
      sampleOutboundDistance(route, timing.distanceTiles - inboundDistance, true),
      true,
    );
  }

  return immutableVessel(
    route,
    "home-dwell",
    sampleOutboundDistance(route, timing.homeDwellDistanceTiles, true),
    false,
  );
}

/** Samples one repeating route in constant time; its Home loop is position-continuous. */
export function sampleProsperityTrafficRoute(
  route: Readonly<ProsperityTrafficRouteV1>,
  elapsedSeconds: number,
  reducedMotion = false,
): Readonly<ProsperityTrafficVesselPresentation> {
  assertElapsedSeconds(elapsedSeconds);
  const timing = prosperityTrafficRouteTiming(route);
  const phaseSeconds = timing.cycleSeconds === 0
    ? 0
    : positiveModulo(elapsedSeconds + timing.phaseOffsetSeconds, timing.cycleSeconds);
  return sampleProsperityTrafficRouteAtCyclePosition(route, phaseSeconds, reducedMotion);
}

function selectFamily<T extends Readonly<ProsperityTrafficRouteV1>>(
  routes: readonly T[],
  maximum: number,
  roundIndex: number,
): readonly T[] {
  const count = Math.min(maximum, routes.length);
  if (count === 0) return Object.freeze([] as T[]);
  const firstIndex = routes.length <= maximum ? 0 : (roundIndex * maximum) % routes.length;
  const selected: T[] = [];
  for (let slot = 0; slot < count; slot++) {
    const route = routes[(firstIndex + slot) % routes.length];
    if (route) selected.push(route);
  }
  return Object.freeze(selected);
}

/**
 * Stateful bounded scheduler. A selected set remains stable until every craft
 * has completed its current route and Home dwell. Shorter routes wait at Home;
 * the next set therefore appears only at a shared endpoint handoff. Catalog
 * work occurs on a route-model change or handoff, never on an ordinary frame.
 */
export class ProsperityTrafficPresentationScheduler {
  private readModel: Readonly<ProsperityTrafficRouteReadModelV1> | undefined;
  private selectedRoutes: readonly Readonly<ProsperityTrafficRouteV1>[] = Object.freeze([]);
  private startPositionByRouteId = new Map<ProsperityTrafficRouteId, number>();
  private lastElapsedSeconds: number | undefined;
  private roundElapsedSeconds = 0;
  private roundDurationSeconds = 0;
  private roundIndex = 0;

  sample(
    routes: Readonly<ProsperityTrafficRouteReadModelV1>,
    elapsedSeconds: number,
    reducedMotion = false,
  ): Readonly<ProsperityTrafficPresentationFrame> {
    assertElapsedSeconds(elapsedSeconds);
    const previousElapsedSeconds = this.lastElapsedSeconds;
    const reset = this.readModel !== routes
      || previousElapsedSeconds === undefined
      || elapsedSeconds < previousElapsedSeconds;
    if (reset) {
      this.readModel = routes;
      this.roundElapsedSeconds = 0;
      this.roundIndex = 0;
      this.configureRound(true);
    } else if (!reducedMotion && previousElapsedSeconds !== undefined) {
      this.roundElapsedSeconds += elapsedSeconds - previousElapsedSeconds;
      this.advanceCompletedRounds();
    }
    this.lastElapsedSeconds = elapsedSeconds;

    const vessels = Object.freeze(this.selectedRoutes.map((route) => {
      const timing = prosperityTrafficRouteTiming(route);
      const start = this.startPositionByRouteId.get(route.id) ?? 0;
      return sampleProsperityTrafficRouteAtCyclePosition(
        route,
        Math.min(timing.cycleSeconds, start + this.roundElapsedSeconds),
        reducedMotion,
      );
    }));
    return Object.freeze({
      presentationVersion: PROSPERITY_TRAFFIC_PRESENTATION_VERSION,
      routeRevision: routes.revision,
      selectionEpoch: this.roundIndex,
      vessels,
    });
  }

  private advanceCompletedRounds(): void {
    while (
      this.roundDurationSeconds > 0
      && this.roundElapsedSeconds >= this.roundDurationSeconds
    ) {
      this.roundElapsedSeconds -= this.roundDurationSeconds;
      this.roundIndex++;
      this.configureRound(false);
    }
  }

  private configureRound(initial: boolean): void {
    const readModel = this.readModel;
    if (!readModel) return;
    const fishing = selectFamily(
      readModel.fishingRoutes,
      PROSPERITY_TRAFFIC_MAX_FISHING_VESSELS,
      this.roundIndex,
    );
    const trade = selectFamily(
      readModel.tradeRoutes,
      PROSPERITY_TRAFFIC_MAX_TRADE_VESSELS,
      this.roundIndex,
    );
    this.selectedRoutes = Object.freeze<Readonly<ProsperityTrafficRouteV1>[]>([
      ...fishing,
      ...trade,
    ]);
    this.startPositionByRouteId = new Map();
    this.roundDurationSeconds = 0;
    for (const route of this.selectedRoutes) {
      const timing = prosperityTrafficRouteTiming(route);
      const start = initial ? timing.phaseOffsetSeconds : 0;
      this.startPositionByRouteId.set(route.id, start);
      this.roundDurationSeconds = Math.max(
        this.roundDurationSeconds,
        Math.max(0, timing.cycleSeconds - start),
      );
    }
  }
}
