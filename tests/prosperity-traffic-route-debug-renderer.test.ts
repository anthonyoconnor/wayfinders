import { describe, expect, it, vi } from "vitest";
import type Phaser from "phaser";
import {
  PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
  type ProsperityFishingTrafficRouteV1,
  type ProsperityTradeTrafficRouteV1,
  type ProsperityTrafficRouteEdgeV1,
  type ProsperityTrafficRouteId,
  type ProsperityTrafficRouteReadModelV1,
  type ProsperityTrafficRouteV1,
} from "../src/wayfinders/features/prosperity/index.ts";
import { createFishingShoalId } from "../src/wayfinders/features/fishing/index.ts";
import {
  PROSPERITY_FISHING_ROUTE_DEBUG_COLOR,
  PROSPERITY_TRADE_ROUTE_DEBUG_COLOR,
  PROSPERITY_TRAFFIC_ROUTE_DEBUG_DEPTH,
  ProsperityTrafficRouteDebugRenderer,
} from "../src/wayfinders/rendering/prosperity/ProsperityTrafficRouteDebugRenderer.ts";
import { buildVoyageSenseThread } from "../src/wayfinders/rendering/VoyageSenseThread.ts";
import type { ActiveChunkEntry } from "../src/wayfinders/rendering/activation/index.ts";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
} from "../src/wayfinders/world/WorldTopology.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { prototypeConfig } from "../src/wayfinders/config/prototypeConfig.ts";

vi.mock("phaser", () => ({ default: {} }));

class FakeGraphics {
  visible = true;
  destroyed = false;
  depth = 0;
  name = "";
  clears = 0;
  strokes = 0;
  lineStyles: Array<Readonly<{ width: number; color: number; alpha: number }>> = [];
  points: Array<Readonly<{ x: number; y: number }>> = [];

  setDepth(depth: number): this { this.depth = depth; return this; }
  setName(name: string): this { this.name = name; return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  clear(): this { this.clears++; this.lineStyles = []; this.points = []; return this; }
  lineStyle(width: number, color: number, alpha: number): this {
    this.lineStyles.push({ width, color, alpha });
    return this;
  }
  beginPath(): this { return this; }
  moveTo(x: number, y: number): this { this.points.push({ x, y }); return this; }
  lineTo(x: number, y: number): this { this.points.push({ x, y }); return this; }
  strokePath(): this { this.strokes++; return this; }
  destroy(): void { this.destroyed = true; }
}

function fakeScene(): { readonly scene: Phaser.Scene; readonly graphics: FakeGraphics } {
  const graphics = new FakeGraphics();
  return {
    scene: { add: { graphics: () => graphics } } as unknown as Phaser.Scene,
    graphics,
  };
}

function routeId(value: string): ProsperityTrafficRouteId {
  return value as ProsperityTrafficRouteId;
}

const PATH_EDGES = Object.freeze<Readonly<ProsperityTrafficRouteEdgeV1>[]>([
  Object.freeze({
    fromIndex: 22,
    toIndex: 23,
    direction: 1,
    imageOffset: Object.freeze({ x: 0, y: 0 }),
    destinationImageOffset: Object.freeze({ x: 0, y: 0 }),
    liftedFrom: Object.freeze({ x: 6, y: 1 }),
    liftedTo: Object.freeze({ x: 7, y: 1 }),
  }),
  Object.freeze({
    fromIndex: 23,
    toIndex: 24,
    direction: 1,
    imageOffset: Object.freeze({ x: 0, y: 0 }),
    destinationImageOffset: Object.freeze({ x: 0, y: 0 }),
    liftedFrom: Object.freeze({ x: 7, y: 1 }),
    liftedTo: Object.freeze({ x: 8, y: 1 }),
  }),
  Object.freeze({
    fromIndex: 24,
    toIndex: 40,
    direction: 2,
    imageOffset: Object.freeze({ x: 0, y: 0 }),
    destinationImageOffset: Object.freeze({ x: 0, y: 0 }),
    liftedFrom: Object.freeze({ x: 8, y: 1 }),
    liftedTo: Object.freeze({ x: 8, y: 2 }),
  }),
]);

function fishingRoute(ordinal = 1): Readonly<ProsperityFishingTrafficRouteV1> {
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    id: routeId(`prosperity-traffic:v1:fishing:debug:${ordinal}`),
    kind: "fishing",
    destinationIndex: 40,
    destinationTile: Object.freeze({ x: 8, y: 2 }),
    pathIndices: Object.freeze([22, 23, 24, 40]),
    pathEdges: PATH_EDGES,
    fishingShoalId: createFishingShoalId(ordinal),
    shoalTile: Object.freeze({ x: 8, y: 2 }),
    quality: "steady",
  });
}

function tradeRoute(): Readonly<ProsperityTradeTrafficRouteV1> {
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    id: routeId("prosperity-traffic:v1:trade:debug"),
    kind: "trade",
    destinationIndex: 40,
    destinationTile: Object.freeze({ x: 8, y: 2 }),
    pathIndices: Object.freeze([22, 23, 24, 40]),
    pathEdges: PATH_EDGES,
    islandId: 4,
    islandName: "Debug Island",
    dossierTheme: "community",
  });
}

function routes(): Readonly<ProsperityTrafficRouteReadModelV1> {
  const fishing = Object.freeze([fishingRoute()]);
  const trade = Object.freeze([tradeRoute()]);
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    revision: 2,
    routes: Object.freeze<Readonly<ProsperityTrafficRouteV1>[]>([...fishing, ...trade]),
    fishingRoutes: fishing,
    tradeRoutes: trade,
  });
}

function fishingOnlyRoutes(
  fishingRoutes: readonly Readonly<ProsperityFishingTrafficRouteV1>[],
  revision = 1,
): Readonly<ProsperityTrafficRouteReadModelV1> {
  const fishing = Object.freeze([...fishingRoutes]);
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    revision,
    routes: Object.freeze<Readonly<ProsperityTrafficRouteV1>[]>([...fishing]),
    fishingRoutes: fishing,
    tradeRoutes: Object.freeze([] as Readonly<ProsperityTradeTrafficRouteV1>[]),
  });
}

function activeChunk(
  canonicalX: number,
  imageOffsetX: number,
  loadPriority: number,
): Readonly<ActiveChunkEntry> {
  return Object.freeze({
    viewKey: `${canonicalX},0@${imageOffsetX},0`,
    canonicalChunk: Object.freeze({ x: canonicalX, y: 0 }),
    imageOffset: Object.freeze({ x: imageOffsetX, y: 0 }),
    band: "visible",
    ringDistance: 0,
    loadPriority,
  });
}

const ACTIVE_CHUNKS = Object.freeze<Readonly<ActiveChunkEntry>[]>([
  Object.freeze({
    viewKey: "0,0@0,0",
    canonicalChunk: Object.freeze({ x: 0, y: 0 }),
    imageOffset: Object.freeze({ x: 0, y: 0 }),
    band: "visible",
    ringDistance: 0,
    loadPriority: 0,
  }),
  Object.freeze({
    viewKey: "1,0@0,0",
    canonicalChunk: Object.freeze({ x: 1, y: 0 }),
    imageOffset: Object.freeze({ x: 0, y: 0 }),
    band: "visible",
    ringDistance: 0,
    loadPriority: 1,
  }),
]);

describe("ProsperityTrafficRouteDebugRenderer", () => {
  it("draws cached, deduplicated fishing and trade threads with independent visibility", () => {
    const fake = fakeScene();
    const renderer = new ProsperityTrafficRouteDebugRenderer(fake.scene);
    const world = new WorldGrid(16, 8, 8, BOUNDED_WORLD_TOPOLOGY, 32);
    const model = routes();
    renderer.applyActiveChunks(ACTIVE_CHUNKS);

    expect(fake.graphics.depth).toBe(PROSPERITY_TRAFFIC_ROUTE_DEBUG_DEPTH);
    expect(fake.graphics.visible).toBe(false);
    renderer.sync(model, world, 32, false, false);
    expect(renderer.getTelemetry()).toMatchObject({ visible: false, geometryBuilds: 0 });

    renderer.sync(model, world, 32, true, true);
    const segmentCount = buildVoyageSenseThread(
      world,
      PATH_EDGES,
      32,
      prototypeConfig.overlays.returnThreadCurveRadius,
      4.5,
    ).segments.length;
    expect(renderer.getTelemetry()).toMatchObject({
      visible: true,
      fishingVisible: true,
      tradeVisible: true,
      routeRevision: 2,
      routeCount: 2,
      geometryBuilds: 1,
      redraws: 2,
      drawnSegments: segmentCount * 2,
    });
    expect(fake.graphics.lineStyles.map(({ color }) => color)).toEqual([
      PROSPERITY_TRADE_ROUTE_DEBUG_COLOR,
      PROSPERITY_TRADE_ROUTE_DEBUG_COLOR,
      PROSPERITY_FISHING_ROUTE_DEBUG_COLOR,
      PROSPERITY_FISHING_ROUTE_DEBUG_COLOR,
    ]);
    expect(fake.graphics.lineStyles[0]!.width).toBeGreaterThan(fake.graphics.lineStyles[2]!.width);

    renderer.sync(model, world, 32, true, true);
    expect(renderer.getTelemetry().redraws).toBe(2);

    renderer.sync(model, world, 32, true, false);
    expect(renderer.getTelemetry()).toMatchObject({
      fishingVisible: true,
      tradeVisible: false,
      redraws: 3,
      drawnSegments: segmentCount,
    });
    expect(fake.graphics.lineStyles.every(({ color }) => color === PROSPERITY_FISHING_ROUTE_DEBUG_COLOR)).toBe(true);

    renderer.destroy();
    expect(fake.graphics.destroyed).toBe(true);
    expect(renderer.getTelemetry().drawnSegments).toBe(0);
  });

  it("keeps seam aliases short and deduplicates their padded chunk copies", () => {
    const fake = fakeScene();
    const renderer = new ProsperityTrafficRouteDebugRenderer(fake.scene);
    const world = new WorldGrid(4, 2, 2, WRAPPING_WORLD_TOPOLOGY, 32);
    const seamEdges = Object.freeze<Readonly<ProsperityTrafficRouteEdgeV1>[]>([
      Object.freeze({
        fromIndex: world.index(3, 0),
        toIndex: world.index(0, 0),
        direction: 1,
        imageOffset: Object.freeze({ x: 4, y: 0 }),
        destinationImageOffset: Object.freeze({ x: 4, y: 0 }),
        liftedFrom: Object.freeze({ x: 3, y: 0 }),
        liftedTo: Object.freeze({ x: 4, y: 0 }),
      }),
    ]);
    const route = Object.freeze({
      contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
      id: routeId("prosperity-traffic:v1:fishing:seam"),
      kind: "fishing" as const,
      destinationIndex: world.index(0, 0),
      destinationTile: Object.freeze({ x: 0, y: 0 }),
      pathIndices: Object.freeze([world.index(3, 0), world.index(0, 0)]),
      pathEdges: seamEdges,
      fishingShoalId: createFishingShoalId(20),
      shoalTile: Object.freeze({ x: 0, y: 0 }),
      quality: "steady" as const,
    }) satisfies Readonly<ProsperityFishingTrafficRouteV1>;
    renderer.applyActiveChunks(Object.freeze([
      activeChunk(0, 0, 0),
      activeChunk(1, -128, 1),
      activeChunk(1, 0, 2),
      activeChunk(0, 128, 3),
    ]));

    renderer.sync(fishingOnlyRoutes([route]), world, 32, true, false);

    expect(renderer.getTelemetry()).toMatchObject({ drawnSegments: 2, geometryBuilds: 1 });
    const haloEndpoints = fake.graphics.points.slice(0, 4);
    expect(haloEndpoints).toEqual([
      { x: -16, y: 16 },
      { x: 16, y: 16 },
      { x: 112, y: 16 },
      { x: 144, y: 16 },
    ]);
    for (let index = 0; index < haloEndpoints.length; index += 2) {
      const from = haloEndpoints[index]!;
      const to = haloEndpoints[index + 1]!;
      expect(Math.hypot(to.x - from.x, to.y - from.y)).toBe(32);
    }

    renderer.destroy();
  });

  it("draws shared same-family route geometry only once", () => {
    const fake = fakeScene();
    const renderer = new ProsperityTrafficRouteDebugRenderer(fake.scene);
    const world = new WorldGrid(16, 8, 8, BOUNDED_WORLD_TOPOLOGY, 32);
    const segmentCount = buildVoyageSenseThread(
      world,
      PATH_EDGES,
      32,
      prototypeConfig.overlays.returnThreadCurveRadius,
      4.5,
    ).segments.length;
    renderer.applyActiveChunks(ACTIVE_CHUNKS);

    renderer.sync(
      fishingOnlyRoutes([fishingRoute(1), fishingRoute(2)]),
      world,
      32,
      true,
      false,
    );

    expect(renderer.getTelemetry()).toMatchObject({
      routeCount: 2,
      drawnSegments: segmentCount,
    });
    expect(fake.graphics.lineStyles).toHaveLength(2);
    expect(fake.graphics.lineStyles.every(
      ({ color }) => color === PROSPERITY_FISHING_ROUTE_DEBUG_COLOR,
    )).toBe(true);

    renderer.destroy();
  });
});
