import { describe, expect, it } from "vitest";
import { createFishingShoalId } from "../src/wayfinders/features/fishing/index.ts";
import {
  PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
  type ProsperityFishingTrafficRouteV1,
  type ProsperityTradeTrafficRouteV1,
  type ProsperityTrafficRouteEdgeV1,
  type ProsperityTrafficRouteId,
  type ProsperityTrafficRouteReadModelV1,
  type ProsperityTrafficRouteV1,
} from "../src/wayfinders/features/prosperity/index.ts";
import {
  PROSPERITY_TRAFFIC_DESTINATION_DWELL_SECONDS,
  PROSPERITY_TRAFFIC_SPEED_TILES_PER_SECOND,
  ProsperityTrafficPresentationScheduler,
  prosperityTrafficPlayerFadeAlpha,
  prosperityTrafficRouteTiming,
  sampleProsperityTrafficRoute,
} from "../src/wayfinders/rendering/prosperity/index.ts";
import type { CardinalDirection } from "../src/wayfinders/world/WorldTopology.ts";

function routeId(value: string): ProsperityTrafficRouteId {
  return value as ProsperityTrafficRouteId;
}

function edge(
  fromIndex: number,
  toIndex: number,
  direction: CardinalDirection,
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  imageOffset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
  destinationImageOffset: Readonly<{ x: number; y: number }> = imageOffset,
): Readonly<ProsperityTrafficRouteEdgeV1> {
  return Object.freeze({
    fromIndex,
    toIndex,
    direction,
    imageOffset: Object.freeze({ ...imageOffset }),
    destinationImageOffset: Object.freeze({ ...destinationImageOffset }),
    liftedFrom: Object.freeze({ ...from }),
    liftedTo: Object.freeze({ ...to }),
  });
}

function fishingRoute(
  ordinal: number,
  length = 2,
): Readonly<ProsperityFishingTrafficRouteV1> {
  const edges = Array.from({ length }, (_, index) => edge(
    index,
    index + 1,
    1,
    { x: index, y: 0 },
    { x: index + 1, y: 0 },
  ));
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    id: routeId(`route:test:fishing:${ordinal}`),
    kind: "fishing",
    fishingShoalId: createFishingShoalId(ordinal),
    shoalTile: Object.freeze({ x: length, y: 0 }),
    quality: "steady",
    destinationIndex: length,
    destinationTile: Object.freeze({ x: length, y: 0 }),
    pathIndices: Object.freeze(Array.from({ length: length + 1 }, (_, index) => index)),
    pathEdges: Object.freeze(edges),
  });
}

function tradeRoute(ordinal: number): Readonly<ProsperityTradeTrafficRouteV1> {
  const routeEdge = edge(0, 1, 3, { x: 0, y: 0 }, { x: 0, y: 1 });
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    id: routeId(`route:test:trade:${ordinal}`),
    kind: "trade",
    islandId: ordinal,
    islandName: `Island ${ordinal}`,
    dossierTheme: "community",
    destinationIndex: 1,
    destinationTile: Object.freeze({ x: 0, y: 1 }),
    pathIndices: Object.freeze([0, 1]),
    pathEdges: Object.freeze([routeEdge]),
  });
}

function readModel(
  fishingRoutes: readonly Readonly<ProsperityFishingTrafficRouteV1>[],
  tradeRoutes: readonly Readonly<ProsperityTradeTrafficRouteV1>[],
): Readonly<ProsperityTrafficRouteReadModelV1> {
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    revision: 7,
    routes: Object.freeze<Readonly<ProsperityTrafficRouteV1>[]>([
      ...fishingRoutes,
      ...tradeRoutes,
    ]),
    fishingRoutes: Object.freeze([...fishingRoutes]),
    tradeRoutes: Object.freeze([...tradeRoutes]),
  });
}

function elapsedForCyclePosition(
  route: Readonly<ProsperityTrafficRouteV1>,
  cyclePositionSeconds: number,
): number {
  const timing = prosperityTrafficRouteTiming(route);
  return ((cyclePositionSeconds - timing.phaseOffsetSeconds) % timing.cycleSeconds
    + timing.cycleSeconds) % timing.cycleSeconds;
}

describe("Prosperity traffic presentation policy", () => {
  it("samples outbound, destination dwell, inbound, and home dwell with route headings", () => {
    const route = fishingRoute(0);
    const timing = prosperityTrafficRouteTiming(route);

    const outbound = sampleProsperityTrafficRoute(
      route,
      elapsedForCyclePosition(route, 0.5 / PROSPERITY_TRAFFIC_SPEED_TILES_PER_SECOND),
    );
    expect(outbound).toMatchObject({
      phase: "outbound",
      homeCanonicalTileX: 0.5,
      homeCanonicalTileY: 0.5,
      headingDegrees: 0,
      moving: true,
      wakeVisible: true,
    });
    expect(outbound.liftedTileX).toBeCloseTo(1.65);
    expect(outbound.liftedTileY).toBeCloseTo(0.5);
    expect(outbound.distanceFromHomeTiles).toBeCloseTo(1.15);

    const destination = sampleProsperityTrafficRoute(
      route,
      elapsedForCyclePosition(route, timing.outboundSeconds + 1),
    );
    expect(destination).toMatchObject({
      phase: "destination-dwell",
      liftedTileX: 2.5,
      liftedTileY: 0.5,
      headingDegrees: 0,
      moving: false,
      wakeVisible: false,
      distanceFromHomeTiles: 2,
    });

    const inbound = sampleProsperityTrafficRoute(
      route,
      elapsedForCyclePosition(
        route,
        timing.outboundSeconds
          + PROSPERITY_TRAFFIC_DESTINATION_DWELL_SECONDS
          + 0.5 / PROSPERITY_TRAFFIC_SPEED_TILES_PER_SECOND,
      ),
    );
    expect(inbound).toMatchObject({
      phase: "inbound",
      headingDegrees: 180,
      moving: true,
      wakeVisible: true,
    });
    expect(inbound.liftedTileX).toBeCloseTo(2);
    expect(inbound.distanceFromHomeTiles).toBeCloseTo(1.5);

    const home = sampleProsperityTrafficRoute(
      route,
      elapsedForCyclePosition(
        route,
        timing.outboundSeconds + timing.destinationDwellSeconds + timing.inboundSeconds + 1,
      ),
    );
    expect(home).toMatchObject({
      phase: "home-dwell",
      liftedTileX: 1.15,
      liftedTileY: 0.5,
      headingDegrees: 180,
      moving: false,
      wakeVisible: false,
    });
    expect(home.distanceFromHomeTiles).toBeCloseTo(0.65);

    const beforeLoop = sampleProsperityTrafficRoute(
      route,
      elapsedForCyclePosition(route, timing.cycleSeconds - 0.001),
    );
    const afterLoop = sampleProsperityTrafficRoute(
      route,
      elapsedForCyclePosition(route, 0.001),
    );
    expect(beforeLoop.liftedTileX).toBeCloseTo(1.15);
    expect(afterLoop.liftedTileX).toBeCloseTo(1.15, 2);
    expect(Math.abs(afterLoop.liftedTileX - beforeLoop.liftedTileX)).toBeLessThan(0.01);

    // Stable offsets deliberately make every newly sampled route observable at its destination.
    expect(sampleProsperityTrafficRoute(route, 0).phase).toBe("destination-dwell");
    expect(prosperityTrafficRouteTiming(route).phaseOffsetSeconds).not.toBe(
      prosperityTrafficRouteTiming(fishingRoute(1)).phaseOffsetSeconds,
    );
  });

  it("interpolates one lifted tile across a wrapping seam", () => {
    const seamEdge = edge(
      0,
      3,
      0,
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: -4, y: 0 },
      { x: -4, y: 0 },
    );
    const route: Readonly<ProsperityFishingTrafficRouteV1> = Object.freeze({
      contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
      id: routeId("route:test:fishing:seam"),
      kind: "fishing",
      fishingShoalId: createFishingShoalId(8),
      shoalTile: Object.freeze({ x: 3, y: 0 }),
      quality: "steady",
      destinationIndex: 3,
      destinationTile: Object.freeze({ x: 3, y: 0 }),
      pathIndices: Object.freeze([0, 3]),
      pathEdges: Object.freeze([seamEdge]),
    });
    const timing = prosperityTrafficRouteTiming(route);
    const halfway = sampleProsperityTrafficRoute(
      route,
      elapsedForCyclePosition(route, timing.outboundSeconds / 2),
    );

    expect(halfway).toMatchObject({
      phase: "outbound",
      liftedTileY: 0.5,
      headingDegrees: 180,
      moving: true,
      wakeVisible: true,
    });
    expect(halfway.liftedTileX).toBeCloseTo(-0.325);
    expect(halfway.distanceFromHomeTiles).toBeCloseTo(0.825);
  });

  it("keeps route identities for a complete service round and rotates only at the Home handoff", () => {
    const fishing = Array.from({ length: 5 }, (_, index) => fishingRoute(index));
    const trade = Array.from({ length: 4 }, (_, index) => tradeRoute(index + 10));
    const routes = readModel(fishing, trade);
    const scheduler = new ProsperityTrafficPresentationScheduler();

    const epochZero = scheduler.sample(routes, 0);
    const firstRoundSeconds = Math.max(
      ...[fishing[0], fishing[1], trade[0], trade[1]].map((route) => {
        const timing = prosperityTrafficRouteTiming(route);
        return timing.cycleSeconds - timing.phaseOffsetSeconds;
      }),
    );
    const beforeHandoff = scheduler.sample(routes, firstRoundSeconds - 0.001);
    const epochOne = scheduler.sample(routes, firstRoundSeconds);
    const secondRoundSeconds = Math.max(
      prosperityTrafficRouteTiming(fishing[2]).cycleSeconds,
      prosperityTrafficRouteTiming(fishing[3]).cycleSeconds,
      prosperityTrafficRouteTiming(trade[2]).cycleSeconds,
      prosperityTrafficRouteTiming(trade[3]).cycleSeconds,
    );
    const epochTwo = scheduler.sample(routes, firstRoundSeconds + secondRoundSeconds);

    expect(epochZero.vessels.map(({ routeId: id }) => id)).toEqual([
      fishing[0].id,
      fishing[1].id,
      trade[0].id,
      trade[1].id,
    ]);
    expect(beforeHandoff.selectionEpoch).toBe(0);
    expect(beforeHandoff.vessels.map(({ routeId: id }) => id)).toEqual(
      epochZero.vessels.map(({ routeId: id }) => id),
    );
    expect(epochOne.vessels.map(({ routeId: id }) => id)).toEqual([
      fishing[2].id,
      fishing[3].id,
      trade[2].id,
      trade[3].id,
    ]);
    expect(epochTwo.vessels.map(({ routeId: id }) => id)).toEqual([
      fishing[4].id,
      fishing[0].id,
      trade[0].id,
      trade[1].id,
    ]);
    expect(epochZero.vessels).toHaveLength(4);
    expect(epochZero.vessels.filter(({ kind }) => kind === "fishing")).toHaveLength(2);
    expect(epochZero.vessels.filter(({ kind }) => kind === "trade")).toHaveLength(2);
    expect(epochOne.selectionEpoch).toBe(1);
    expect(epochTwo.selectionEpoch).toBe(2);
    expect(epochOne.vessels.every(({ distanceFromHomeTiles }) => (
      Math.abs(distanceFromHomeTiles - 0.65) < 0.000_001
    ))).toBe(true);
    expect(Object.isFrozen(epochZero)).toBe(true);
    expect(Object.isFrozen(epochZero.vessels)).toBe(true);
    expect(epochZero.vessels.every(Object.isFrozen)).toBe(true);
  });

  it("freezes route selection and progress while reduced motion is active", () => {
    const fishing = Array.from({ length: 4 }, (_, index) => fishingRoute(index));
    const routes = readModel(fishing, []);
    const scheduler = new ProsperityTrafficPresentationScheduler();

    const initial = scheduler.sample(routes, 0, false);
    const reduced = scheduler.sample(routes, 10_000, true);
    const stillReduced = scheduler.sample(routes, 20_000, true);
    const resumed = scheduler.sample(routes, 20_000.1, false);

    expect(reduced.selectionEpoch).toBe(0);
    expect(stillReduced.selectionEpoch).toBe(0);
    expect(reduced.vessels.map(({ routeId: id }) => id)).toEqual(
      initial.vessels.map(({ routeId: id }) => id),
    );
    expect(stillReduced.vessels).toEqual(reduced.vessels);
    expect(reduced.vessels.every(({ phase, moving, wakeVisible }) => (
      phase === "reduced-motion" && !moving && !wakeVisible
    ))).toBe(true);
    expect(resumed.selectionEpoch).toBe(0);
    expect(resumed.vessels.map(({ routeId: id }) => id)).toEqual(
      initial.vessels.map(({ routeId: id }) => id),
    );
  });

  it("uses a static final-edge pose for reduced motion and safely handles an empty route", () => {
    const route = fishingRoute(0);
    const reduced = sampleProsperityTrafficRoute(route, 123, true);
    expect(reduced).toMatchObject({
      phase: "reduced-motion",
      liftedTileX: 2.25,
      liftedTileY: 0.5,
      headingDegrees: 0,
      moving: false,
      wakeVisible: false,
      distanceFromHomeTiles: 1.75,
    });

    const empty: Readonly<ProsperityFishingTrafficRouteV1> = Object.freeze({
      ...fishingRoute(1, 0),
      destinationIndex: 9,
      destinationTile: Object.freeze({ x: 4, y: 2 }),
      shoalTile: Object.freeze({ x: 4, y: 2 }),
    });
    expect(sampleProsperityTrafficRoute(empty, 12, true)).toMatchObject({
      phase: "stationary",
      liftedTileX: 4.5,
      liftedTileY: 2.5,
      headingDegrees: 0,
      moving: false,
      wakeVisible: false,
      distanceFromHomeTiles: 0,
    });
  });

  it("smoothly fades traffic between the declared player-distance bounds", () => {
    expect(prosperityTrafficPlayerFadeAlpha(0)).toBe(0);
    expect(prosperityTrafficPlayerFadeAlpha(1.25)).toBe(0);
    expect(prosperityTrafficPlayerFadeAlpha(1.5)).toBeCloseTo(0.15625);
    expect(prosperityTrafficPlayerFadeAlpha(1.75)).toBe(0.5);
    expect(prosperityTrafficPlayerFadeAlpha(2)).toBeCloseTo(0.84375);
    expect(prosperityTrafficPlayerFadeAlpha(2.25)).toBe(1);
    expect(prosperityTrafficPlayerFadeAlpha(10)).toBe(1);
    expect(() => prosperityTrafficPlayerFadeAlpha(-0.01)).toThrow(RangeError);
  });
});
