import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PROTOTYPE_CONFIG,
  onPrototypeConfigChanged,
  patchPrototypeConfig,
  prototypeConfig,
  resetPrototypeConfig,
  validatePrototypeConfig,
} from "../src/tidebound/config/prototypeConfig";
import { dijkstra, DijkstraWorkspace, reconstructDijkstraPath } from "../src/tidebound/navigation/Dijkstra";
import { createShipStateAtGrid, MovementSystem } from "../src/tidebound/navigation/MovementSystem";
import { gridToArt, gridToWorld, worldToGrid } from "../src/tidebound/world/CoordinateSystem";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData";
import { WorldGenerator } from "../src/tidebound/world/WorldGenerator";
import { WorldGrid } from "../src/tidebound/world/WorldGrid";
import { makeConfig } from "./helpers";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

describe("prototype configuration", () => {
  it("keeps defaults deeply frozen and resets the mutable live copy", () => {
    expect(Object.isFrozen(DEFAULT_PROTOTYPE_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PROTOTYPE_CONFIG.navigation)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PROTOTYPE_CONFIG.islands)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PROTOTYPE_CONFIG.movement)).toBe(true);

    const defaultSpeed = DEFAULT_PROTOTYPE_CONFIG.movement.shipSpeed;
    prototypeConfig.movement.shipSpeed = defaultSpeed + 10;
    resetPrototypeConfig();

    expect(prototypeConfig.movement.shipSpeed).toBe(defaultSpeed);
    expect(DEFAULT_PROTOTYPE_CONFIG.movement.shipSpeed).toBe(defaultSpeed);
  });

  it("applies valid patches atomically and rejects invalid patches without notifying", () => {
    const notifications: string[][] = [];
    const unsubscribe = onPrototypeConfigChanged((sections) => {
      notifications.push([...sections]);
    });

    try {
      const changed = patchPrototypeConfig({ movement: { shipSpeed: 4 } });
      expect([...changed]).toEqual(["movement"]);
      expect(prototypeConfig.movement.shipSpeed).toBe(4);
      expect(notifications).toEqual([["movement"]]);

      const startingBundles = prototypeConfig.provisions.startingBundles;
      expect(() => patchPrototypeConfig({
        navigation: { tileSize: 0 },
        provisions: { startingBundles: startingBundles + 3 },
      })).toThrow(RangeError);

      expect(prototypeConfig.navigation.tileSize).toBe(DEFAULT_PROTOTYPE_CONFIG.navigation.tileSize);
      expect(prototypeConfig.provisions.startingBundles).toBe(startingBundles);
      expect(notifications).toEqual([["movement"]]);
    } finally {
      unsubscribe();
    }
  });

  it("validates island tuning atomically", () => {
    const changed = patchPrototypeConfig({ islands: { count: 9, minimumChannelWidth: 10 } });
    expect([...changed]).toEqual(["islands"]);
    expect(prototypeConfig.islands.count).toBe(9);
    expect(prototypeConfig.islands.minimumChannelWidth).toBe(10);

    expect(() => patchPrototypeConfig({ islands: { maxRadius: 1 } })).toThrow(
      "islands.maxRadius must be at least islands.minRadius",
    );
    expect(prototypeConfig.islands.maxRadius).toBe(DEFAULT_PROTOTYPE_CONFIG.islands.maxRadius);

    const legacyEnvelopeDoesNotFit = makeConfig({
      world: { width: 30, height: 30, hiddenObstacleRadius: 10 },
      islands: { count: 1, minRadius: 2, maxRadius: 2 },
    });
    expect(() => validatePrototypeConfig(legacyEnvelopeDoesNotFit)).toThrow(
      "world dimensions are too small for the configured scattered islands",
    );
  });

  it("rejects a non-positive wreck presentation duration", () => {
    expect(() => patchPrototypeConfig({ simulation: { wreckPresentationSeconds: 0 } })).toThrow(
      "simulation.wreckPresentationSeconds must be positive",
    );
    expect(prototypeConfig.simulation.wreckPresentationSeconds).toBe(4);
  });
});

describe("world foundations", () => {
  it("converts consistently between navigation, world, and art coordinates", () => {
    expect(gridToWorld({ x: 3, y: 4 })).toEqual({ x: 112, y: 144 });
    expect(worldToGrid(112, 144)).toEqual({ x: 3, y: 4 });
    expect(worldToGrid(127.999, 159.999)).toEqual({ x: 3, y: 4 });
    expect(gridToArt({ x: 3, y: 4 })).toEqual({ x: 6, y: 8 });
  });

  it("generates identical terrain, knowledge, and landmarks from the same seed", () => {
    const generator = new WorldGenerator();
    const first = generator.generate(42_424);
    const second = generator.generate(42_424);
    const firstTiles: unknown[] = [];
    const secondTiles: unknown[] = [];

    first.grid.forEachTile((x, y) => firstTiles.push(first.grid.getTile(x, y)));
    second.grid.forEachTile((x, y) => secondTiles.push(second.grid.getTile(x, y)));

    expect(second.landmarks).toEqual(first.landmarks);
    expect(second.islands).toEqual(first.islands);
    expect(secondTiles).toEqual(firstTiles);
  });

  it("keeps collision and sight flags synchronized with terrain", () => {
    const world = new WorldGrid(4, 4, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);

    world.setTerrain(1, 1, TerrainType.Land);
    expect(world.isMovementBlocked(1, 1)).toBe(true);
    expect(world.isSightBlocked(1, 1)).toBe(true);

    world.setMovementBlocked(1, 1, false);
    expect(world.setTerrain(1, 1, TerrainType.Land)).toBe(true);
    expect(world.isMovementBlocked(1, 1)).toBe(true);

    world.setTerrain(1, 1, TerrainType.Reef);
    expect(world.isMovementBlocked(1, 1)).toBe(true);
    expect(world.isSightBlocked(1, 1)).toBe(false);

    world.fill(TerrainType.Land, KnowledgeState.Unknown);
    expect(world.isMovementBlocked(3, 3)).toBe(true);
    expect(world.isSightBlocked(3, 3)).toBe(true);
  });

  it("creates a passable home dock, protected harbour approach, and supported home waters", () => {
    const generated = new WorldGenerator().generate(13_371);
    const { grid, landmarks } = generated;

    expect(grid.getTerrain(landmarks.homeCenter.x, landmarks.homeCenter.y)).toBe(TerrainType.Land);
    expect(grid.isMovementBlocked(landmarks.homeCenter.x, landmarks.homeCenter.y)).toBe(true);
    expect(grid.getTerrain(landmarks.dock.x, landmarks.dock.y)).toBe(TerrainType.ShallowOcean);
    expect(grid.isMovementBlocked(landmarks.dock.x, landmarks.dock.y)).toBe(false);
    expect(grid.getKnowledge(landmarks.dock.x, landmarks.dock.y)).toBe(KnowledgeState.Supported);

    for (let x = landmarks.harbour.x - 1; x <= landmarks.dock.x; x++) {
      expect(grid.isMovementBlocked(x, landmarks.harbour.y)).toBe(false);
    }

    const openHomeWaterX = landmarks.homeCenter.x + 10;
    expect(grid.getKnowledge(openHomeWaterX, landmarks.homeCenter.y)).toBe(KnowledgeState.Supported);
    expect(grid.isMovementBlocked(openHomeWaterX, landmarks.homeCenter.y)).toBe(false);
  });
});

describe("navigation foundations", () => {
  it("stops the ship immediately before blocking terrain and clears its speed", () => {
    const world = new WorldGrid(5, 3, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setTerrain(2, 1, TerrainType.Land);
    const ship = createShipStateAtGrid({ x: 1, y: 1 }, 12, 0);
    const movement = new MovementSystem(world);

    const result = movement.update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(true);
    expect(ship.currentTileX).toBe(1);
    expect(ship.currentTileY).toBe(1);
    expect(ship.worldX).toBeCloseTo(64 - prototypeConfig.movement.collisionEpsilon, 6);
    expect(ship.speed).toBe(0);
    expect(result.enteredTiles).toEqual([]);
  });

  it("rejects non-finite movement input before mutating ship state", () => {
    const world = new WorldGrid(3, 3, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const movement = new MovementSystem(world);
    const ship = createShipStateAtGrid({ x: 1, y: 1 });
    const before = { ...ship };

    expect(() => movement.update(ship, { turn: Number.NaN, throttle: 1 }, 1)).toThrow(RangeError);
    expect(ship).toEqual(before);
    expect(() => movement.update(ship, { turn: 0, throttle: Number.POSITIVE_INFINITY }, 1)).toThrow(RangeError);
    expect(ship).toEqual(before);
  });

  it("finds the least-cost Dijkstra path", () => {
    const edges: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
      [[1, 2], [2, 1]],
      [[3, 1]],
      [[1, 0.5], [3, 5]],
      [],
    ];
    const result = dijkstra({
      nodeCount: edges.length,
      starts: [{ node: 0 }],
      forEachNeighbor: (node, visit) => {
        for (const [neighbor, cost] of edges[node]) visit(neighbor, cost);
      },
    });

    expect(result.costs[3]).toBe(2.5);
    expect(reconstructDijkstraPath(result, 3)).toEqual([0, 2, 1, 3]);
  });

  it("reuses numeric heap capacity and exposes sparse settled nodes", () => {
    const workspace = new DijkstraWorkspace();
    const first = dijkstra({
      nodeCount: 130,
      starts: Array.from({ length: 130 }, (_, node) => node),
      workspace,
      forEachNeighbor: () => undefined,
    });
    const expandedCapacity = workspace.queue.capacity;

    expect(first.settledCount).toBe(130);
    expect(new Set(first.settledIndices.slice(0, first.settledCount)).size).toBe(130);
    expect(expandedCapacity).toBeGreaterThanOrEqual(130);
    const firstBuffers = [
      first.costs.buffer,
      first.parents.buffer,
      first.visited.buffer,
      first.settledIndices.buffer,
    ];

    const second = dijkstra({
      nodeCount: 2,
      starts: [0],
      workspace,
      forEachNeighbor: () => undefined,
    });
    expect(second.settledIndices.slice(0, second.settledCount)).toEqual(new Int32Array([0]));
    expect(workspace.queue.capacity).toBe(expandedCapacity);
    expect(second.costs.buffer).toBe(firstBuffers[0]);
    expect(second.parents.buffer).toBe(firstBuffers[1]);
    expect(second.visited.buffer).toBe(firstBuffers[2]);
    expect(second.settledIndices.buffer).toBe(firstBuffers[3]);
  });
});
