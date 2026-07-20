import { describe, expect, it, vi } from "vitest";
import type Phaser from "phaser";
import {
  PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
  type ProsperityFishingTrafficRouteV1,
  type ProsperityTradeTrafficRouteV1,
  type ProsperityTrafficRouteId,
  type ProsperityTrafficRouteReadModelV1,
  type ProsperityTrafficRouteV1,
} from "../src/wayfinders/features/prosperity/index.ts";
import { createFishingShoalId } from "../src/wayfinders/features/fishing/index.ts";
import {
  PROSPERITY_TRAFFIC_DEPTH,
  PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS,
  PROSPERITY_TRAFFIC_MAX_VISIBLE_VESSELS,
  ProsperityTrafficRenderer,
} from "../src/wayfinders/rendering/ProsperityTrafficRenderer.ts";
import { prosperityTrafficRouteTiming } from "../src/wayfinders/rendering/prosperity/index.ts";
import type { ActiveChunkEntry } from "../src/wayfinders/rendering/activation/index.ts";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  WorldTopology,
} from "../src/wayfinders/world/WorldTopology.ts";

vi.mock("phaser", () => ({
  default: {
    Math: {
      DegToRad: (degrees: number) => degrees * Math.PI / 180,
    },
  },
}));

class FakeGraphics {
  visible = true;
  destroyed = false;

  lineStyle(): this { return this; }
  beginPath(): this { return this; }
  moveTo(): this { return this; }
  lineTo(): this { return this; }
  strokePath(): this { return this; }
  fillStyle(): this { return this; }
  fillTriangle(): this { return this; }
  strokeTriangle(): this { return this; }
  lineBetween(): this { return this; }
  fillCircle(): this { return this; }
  strokeCircle(): this { return this; }
  fillRect(): this { return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  destroy(): void { this.destroyed = true; }
}

class FakeContainer {
  active = true;
  visible = true;
  destroyed = false;
  name = "";
  x = 0;
  y = 0;
  alpha = 1;
  rotation = 0;
  scale = 1;
  depth = 0;

  constructor(private readonly children: readonly FakeGraphics[]) {}

  setDepth(depth: number): this { this.depth = depth; return this; }
  setActive(active: boolean): this { this.active = active; return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  setName(name: string): this { this.name = name; return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setRotation(rotation: number): this { this.rotation = rotation; return this; }
  setScale(scale: number): this { this.scale = scale; return this; }
  setAlpha(alpha: number): this { this.alpha = alpha; return this; }
  destroy(destroyChildren?: boolean): void {
    this.destroyed = true;
    if (destroyChildren) for (const child of this.children) child.destroy();
  }
}

function fakeScene(): {
  readonly scene: Phaser.Scene;
  readonly graphics: FakeGraphics[];
  readonly containers: FakeContainer[];
} {
  const graphics: FakeGraphics[] = [];
  const containers: FakeContainer[] = [];
  const scene = {
    add: {
      graphics: () => {
        const value = new FakeGraphics();
        graphics.push(value);
        return value;
      },
      container: (_x: number, _y: number, children: readonly FakeGraphics[]) => {
        const value = new FakeContainer(children);
        containers.push(value);
        return value;
      },
    },
  } as unknown as Phaser.Scene;
  return { scene, graphics, containers };
}

function routeId(value: string): ProsperityTrafficRouteId {
  return value as ProsperityTrafficRouteId;
}

function baseRoute(
  id: ProsperityTrafficRouteId,
  row: number,
): Pick<ProsperityTrafficRouteV1, "contractVersion" | "id" | "destinationIndex" | "destinationTile" | "pathIndices" | "pathEdges"> {
  return {
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    id,
    destinationIndex: row * 16 + 4,
    destinationTile: Object.freeze({ x: 4, y: row }),
    pathIndices: Object.freeze([0, 1, 2, 3, 4].map((x) => row * 16 + x)),
    pathEdges: Object.freeze([0, 1, 2, 3].map((x) => Object.freeze({
      fromIndex: row * 16 + x,
      toIndex: row * 16 + x + 1,
      direction: 1 as const,
      imageOffset: Object.freeze({ x: 0, y: 0 }),
      destinationImageOffset: Object.freeze({ x: 0, y: 0 }),
      liftedFrom: Object.freeze({ x, y: row }),
      liftedTo: Object.freeze({ x: x + 1, y: row }),
    }))),
  };
}

function fishingRoute(ordinal: number, row: number): Readonly<ProsperityFishingTrafficRouteV1> {
  const id = routeId(`prosperity-traffic:v1:fishing:test:${ordinal}`);
  return Object.freeze({
    ...baseRoute(id, row),
    kind: "fishing",
    fishingShoalId: createFishingShoalId(ordinal),
    shoalTile: Object.freeze({ x: 4, y: row }),
    quality: "steady",
  });
}

function tradeRoute(islandId: number, row: number): Readonly<ProsperityTradeTrafficRouteV1> {
  const id = routeId(`prosperity-traffic:v1:trade:test:${islandId}`);
  return Object.freeze({
    ...baseRoute(id, row),
    kind: "trade",
    islandId,
    islandName: `Island ${islandId}`,
    dossierTheme: "community",
  });
}

function routes(): Readonly<ProsperityTrafficRouteReadModelV1> {
  const fishingRoutes = Object.freeze([fishingRoute(0, 0), fishingRoute(1, 1)]);
  const tradeRoutes = Object.freeze([tradeRoute(1, 2), tradeRoute(2, 3)]);
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    revision: 3,
    routes: Object.freeze<Readonly<ProsperityTrafficRouteV1>[]>([
      ...fishingRoutes,
      ...tradeRoutes,
    ]),
    fishingRoutes,
    tradeRoutes,
  });
}

function readModel(
  fishingRoutes: readonly Readonly<ProsperityFishingTrafficRouteV1>[],
  tradeRoutes: readonly Readonly<ProsperityTradeTrafficRouteV1>[] = [],
  revision = 1,
): Readonly<ProsperityTrafficRouteReadModelV1> {
  return Object.freeze({
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    revision,
    routes: Object.freeze<Readonly<ProsperityTrafficRouteV1>[]>([
      ...fishingRoutes,
      ...tradeRoutes,
    ]),
    fishingRoutes: Object.freeze([...fishingRoutes]),
    tradeRoutes: Object.freeze([...tradeRoutes]),
  });
}

function loopingRoute(
  kind: "fishing" | "trade",
  ordinal: number,
): Readonly<ProsperityFishingTrafficRouteV1 | ProsperityTradeTrafficRouteV1> {
  const id = routeId(`prosperity-traffic:v1:${kind}:loop:${ordinal}`);
  const pathEdges = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze({
    fromIndex: index % 16,
    toIndex: (index + 1) % 16,
    direction: 1 as const,
    imageOffset: Object.freeze({ x: index === 15 ? 16 : 0, y: 0 }),
    destinationImageOffset: Object.freeze({ x: index === 15 ? 16 : 0, y: 0 }),
    liftedFrom: Object.freeze({ x: index, y: 0 }),
    liftedTo: Object.freeze({ x: index + 1, y: 0 }),
  })));
  const common = {
    contractVersion: PROSPERITY_TRAFFIC_ROUTE_CONTRACT_VERSION,
    id,
    destinationIndex: 0,
    destinationTile: Object.freeze({ x: 0, y: 0 }),
    pathIndices: Object.freeze(Array.from({ length: 17 }, (_, index) => index % 16)),
    pathEdges,
  } as const;
  return kind === "fishing"
    ? Object.freeze({
      ...common,
      kind,
      fishingShoalId: createFishingShoalId(ordinal),
      shoalTile: Object.freeze({ x: 0, y: 0 }),
      quality: "steady" as const,
    })
    : Object.freeze({
      ...common,
      kind,
      islandId: ordinal,
      islandName: `Loop Island ${ordinal}`,
      dossierTheme: "community" as const,
    });
}

const ACTIVE_CHUNK = Object.freeze({
  viewKey: "0,0@0,0",
  canonicalChunk: Object.freeze({ x: 0, y: 0 }),
  imageOffset: Object.freeze({ x: 0, y: 0 }),
  band: "visible",
  ringDistance: 0,
  loadPriority: 0,
}) satisfies Readonly<ActiveChunkEntry>;

describe("ProsperityTrafficRenderer", () => {
  it("allocates one fixed pool and enforces canonical and periodic view caps", () => {
    const fake = fakeScene();
    const renderer = new ProsperityTrafficRenderer(fake.scene);
    const topology = new WorldTopology(16, 8, 32, 8, BOUNDED_WORLD_TOPOLOGY);
    const model = routes();
    renderer.applyActiveChunks([ACTIVE_CHUNK]);

    expect(fake.containers).toHaveLength(PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS);
    expect(fake.graphics).toHaveLength(PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS * 3);
    expect(fake.containers.every(({ depth }) => depth === PROSPERITY_TRAFFIC_DEPTH)).toBe(true);
    renderer.sync(model, topology, 32, 0, { x: 15.5 * 32, y: 7.5 * 32 });

    expect(renderer.getTelemetry()).toMatchObject({
      capacity: PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS,
      allocatedViews: PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS,
      routeRevision: 3,
      routeCount: 4,
      scheduledVessels: 4,
      visibleCanonicalVessels: PROSPERITY_TRAFFIC_MAX_VISIBLE_VESSELS,
      activeViews: PROSPERITY_TRAFFIC_MAX_VISIBLE_VESSELS,
      stableFrameGameObjectAllocations: 0,
    });
    expect(fake.containers.filter(({ visible }) => visible)).toHaveLength(
      PROSPERITY_TRAFFIC_MAX_VISIBLE_VESSELS,
    );
    const firstAdmission = fake.containers
      .filter(({ visible }) => visible)
      .map(({ name }) => name);
    expect(firstAdmission.some((name) => name.includes(model.tradeRoutes[1]!.id))).toBe(false);

    for (let frame = 1; frame <= 20; frame++) {
      renderer.sync(model, topology, 32, frame * 16, { x: 15.5 * 32, y: 7.5 * 32 });
    }
    expect(fake.containers).toHaveLength(PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS);
    expect(fake.graphics).toHaveLength(PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS * 3);
    expect(renderer.getTelemetry()).toMatchObject({
      frames: 21,
      peakActiveViews: PROSPERITY_TRAFFIC_MAX_VISIBLE_VESSELS,
      stableFrameGameObjectAllocations: 0,
    });

    const firstRoundSeconds = Math.max(...model.routes.map((route) => {
      const timing = prosperityTrafficRouteTiming(route);
      return timing.cycleSeconds - timing.phaseOffsetSeconds;
    }));
    renderer.sync(
      model,
      topology,
      32,
      (firstRoundSeconds + 3) * 1_000,
      { x: 15.5 * 32, y: 7.5 * 32 },
    );
    const secondAdmission = fake.containers
      .filter(({ visible }) => visible)
      .map(({ name }) => name);
    expect(renderer.getTelemetry().selectionEpoch).toBe(1);
    expect(secondAdmission.some((name) => name.includes(model.tradeRoutes[1]!.id))).toBe(true);
    expect(secondAdmission).not.toEqual(firstAdmission);

    renderer.destroy();
    expect(fake.containers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(fake.graphics.every(({ destroyed }) => destroyed)).toBe(true);
    expect(renderer.getTelemetry().activeViews).toBe(0);
  });

  it("holds a static no-wake craft for reduced motion and truly suppresses it near the player", () => {
    const fake = fakeScene();
    const renderer = new ProsperityTrafficRenderer(fake.scene);
    const topology = new WorldTopology(16, 8, 32, 8, BOUNDED_WORLD_TOPOLOGY);
    const model = readModel([fishingRoute(0, 0)]);
    renderer.applyActiveChunks([ACTIVE_CHUNK]);

    renderer.sync(model, topology, 32, 5_000, { x: 4.25 * 32, y: 0.5 * 32 }, true);
    expect(renderer.getTelemetry()).toMatchObject({ reducedMotion: true, activeViews: 0 });
    renderer.sync(model, topology, 32, 50_000, { x: 12.5 * 32, y: 7.5 * 32 }, true);
    expect(renderer.getTelemetry()).toMatchObject({
      reducedMotion: true,
      selectionEpoch: 0,
      activeViews: 1,
    });
    const activeIndex = fake.containers.findIndex(({ visible }) => visible);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(fake.graphics[activeIndex * 3]!.visible).toBe(false);
    expect(fake.graphics[activeIndex * 3 + 1]!.visible).toBe(true);
    expect(fake.graphics[activeIndex * 3 + 2]!.visible).toBe(false);

    renderer.destroy();
  });

  it("uses minimum-image Home density and shares one canonical craft across periodic aliases", () => {
    const fake = fakeScene();
    const renderer = new ProsperityTrafficRenderer(fake.scene);
    const topology = new WorldTopology(16, 8, 32, 8, WRAPPING_WORLD_TOPOLOGY);
    const fishing = loopingRoute("fishing", 20) as Readonly<ProsperityFishingTrafficRouteV1>;
    const trade = loopingRoute("trade", 20) as Readonly<ProsperityTradeTrafficRouteV1>;
    const model = readModel([fishing], [trade], 2);
    const alias = Object.freeze({
      ...ACTIVE_CHUNK,
      viewKey: "0,0@512,0",
      imageOffset: Object.freeze({ x: 512, y: 0 }),
    }) satisfies Readonly<ActiveChunkEntry>;
    renderer.applyActiveChunks([ACTIVE_CHUNK, alias]);

    renderer.sync(model, topology, 32, 0, { x: 8.5 * 32, y: 4.5 * 32 });

    expect(renderer.getTelemetry()).toMatchObject({
      scheduledVessels: 2,
      visibleCanonicalVessels: 1,
      activeViews: 2,
    });
    const active = fake.containers.filter(({ visible }) => visible);
    expect(active).toHaveLength(2);
    expect(active[1]!.x - active[0]!.x).toBe(512);
    expect(active[0]!.name.split("@")[0]).toBe(active[1]!.name.split("@")[0]);

    renderer.destroy();
  });
});
