import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PROTOTYPE_CONFIG,
  onPrototypeConfigChanged,
  patchPrototypeConfig,
  prototypeConfig,
  resetPrototypeConfig,
  validatePrototypeConfig,
} from "../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import { dijkstra, DijkstraWorkspace, reconstructDijkstraPath } from "../src/wayfinders/navigation/Dijkstra";
import { createShipStateAtGrid, MovementSystem } from "../src/wayfinders/navigation/MovementSystem";
import { gridToArt, gridToWorld, worldToGrid } from "../src/wayfinders/world/CoordinateSystem";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
} from "../src/wayfinders/world/WorldTopology";
import { makeConfig } from "./helpers";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

describe("prototype configuration", () => {
  it("keeps regeneration isolated from both input and live configuration", () => {
    const liveSeed = prototypeConfig.world.seed;
    const detached = makeConfig();
    detached.world.seed = liveSeed + 1;
    const simulation = new GameSimulation(detached);

    expect(prototypeConfig.world.seed).toBe(liveSeed);
    simulation.regenerate(liveSeed + 2);
    expect(detached.world.seed).toBe(liveSeed + 1);
    expect(simulation.generated.seed).toBe(liveSeed + 2);
    expect(prototypeConfig.world.seed).toBe(liveSeed);
  });

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

    const periodicFootprintOverlapsItsOwnImage = makeConfig({
      world: { width: 27, height: 27, hiddenObstacleRadius: 10 },
      islands: { count: 1, minRadius: 2, maxRadius: 2 },
    });
    expect(() => validatePrototypeConfig(periodicFootprintOverlapsItsOwnImage)).toThrow(
      "world dimensions must exceed the largest configured island footprint",
    );
  });

  it("rejects a non-positive wreck presentation duration", () => {
    expect(() => patchPrototypeConfig({ simulation: { wreckPresentationSeconds: 0 } })).toThrow(
      "simulation.wreckPresentationSeconds must be positive",
    );
    expect(prototypeConfig.simulation.wreckPresentationSeconds).toBe(4);
  });

  it("keeps the ship collision footprint smaller than a passable navigation tile", () => {
    expect(DEFAULT_PROTOTYPE_CONFIG.movement.shipCollisionHalfExtent).toBe(14);
    expect(() => patchPrototypeConfig({ movement: { shipCollisionHalfExtent: 16 } })).toThrow(
      "movement.shipCollisionHalfExtent must be smaller than half navigation.tileSize",
    );
    expect(prototypeConfig.movement.shipCollisionHalfExtent).toBe(14);
  });

  it("allows zero Unknown travel cost for consumption-free testing", () => {
    patchPrototypeConfig({ provisions: { unknownCost: 0 } });
    expect(prototypeConfig.provisions.unknownCost).toBe(0);
    expect(() => patchPrototypeConfig({ provisions: { unknownCost: -0.1 } })).toThrow(
      "provisions.unknownCost must be non-negative",
    );
    expect(prototypeConfig.provisions.unknownCost).toBe(0);
  });

  it("keeps travel costs exactly scalable for cooperative guidance", () => {
    expect(() => patchPrototypeConfig({ provisions: { unknownCost: Math.PI } })).toThrow(
      "provision travel costs must use at most four decimal places",
    );
    expect(prototypeConfig.provisions.unknownCost).toBe(
      DEFAULT_PROTOTYPE_CONFIG.provisions.unknownCost,
    );
  });

  it("uses a configurable positive-integer two-bundle survey cost", () => {
    expect(DEFAULT_PROTOTYPE_CONFIG.provisions.surveyCost).toBe(2);
    patchPrototypeConfig({ provisions: { surveyCost: 3 } });
    expect(prototypeConfig.provisions.surveyCost).toBe(3);

    for (const value of [0, -1, 1.5]) {
      expect(() => patchPrototypeConfig({ provisions: { surveyCost: value } })).toThrow(
        "provisions.surveyCost must be a positive integer",
      );
      expect(prototypeConfig.provisions.surveyCost).toBe(3);
    }
  });

  it("uses three configurable idol locations by default and requires a positive integer", () => {
    expect(DEFAULT_PROTOTYPE_CONFIG.world.idolCount).toBe(3);
    patchPrototypeConfig({ world: { idolCount: 5 } });
    expect(prototypeConfig.world.idolCount).toBe(5);

    for (const value of [0, -1, 1.5]) {
      expect(() => patchPrototypeConfig({ world: { idolCount: value } })).toThrow(
        "world.idolCount must be a positive integer",
      );
      expect(prototypeConfig.world.idolCount).toBe(5);
    }
  });

  it("accepts forward cone half-angles from 1 through 180 degrees", () => {
    for (const value of [1, 60, 180]) {
      patchPrototypeConfig({ overlays: { forwardConeHalfAngleDegrees: value } });
      expect(prototypeConfig.overlays.forwardConeHalfAngleDegrees).toBe(value);
    }
    expect(() => patchPrototypeConfig({ overlays: { forwardConeHalfAngleDegrees: 0 } })).toThrow(
      "overlays.forwardConeHalfAngleDegrees must be positive",
    );
    expect(() => patchPrototypeConfig({ overlays: { forwardConeHalfAngleDegrees: 181 } })).toThrow(
      "overlays.forwardConeHalfAngleDegrees must be at most 180",
    );
  });

  it("accepts only non-negative integer Unknown cleanup limits and route padding", () => {
    patchPrototypeConfig({
      world: { maxEnclosedUnknownTiles: 0 },
      overlays: { returnPathPadding: 2 },
    });
    expect(prototypeConfig.world.maxEnclosedUnknownTiles).toBe(0);
    expect(prototypeConfig.overlays.returnPathPadding).toBe(2);

    patchPrototypeConfig({ world: { maxEnclosedUnknownTiles: 5 } });
    expect(prototypeConfig.world.maxEnclosedUnknownTiles).toBe(5);

    expect(() => patchPrototypeConfig({ world: { maxEnclosedUnknownTiles: -1 } })).toThrow(
      "world.maxEnclosedUnknownTiles must be a non-negative integer",
    );
    expect(() => patchPrototypeConfig({ world: { maxEnclosedUnknownTiles: 1.5 } })).toThrow(
      "world.maxEnclosedUnknownTiles must be a non-negative integer",
    );
    expect(() => patchPrototypeConfig({ overlays: { returnPathPadding: -1 } })).toThrow(
      "overlays.returnPathPadding must be a non-negative integer",
    );
  });

  it("validates Voyage Sense thread width and curve radius", () => {
    patchPrototypeConfig({ overlays: { returnThreadWidth: 7, returnThreadCurveRadius: 12 } });
    expect(prototypeConfig.overlays.returnThreadWidth).toBe(7);
    expect(prototypeConfig.overlays.returnThreadCurveRadius).toBe(12);

    expect(() => patchPrototypeConfig({ overlays: { returnThreadWidth: 0 } })).toThrow(
      "overlays.returnThreadWidth must be positive",
    );
    expect(() => patchPrototypeConfig({ overlays: { returnThreadCurveRadius: -1 } })).toThrow(
      "overlays.returnThreadCurveRadius must be non-negative",
    );
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
    const world = new WorldGrid(4, 4, 2, BOUNDED_WORLD_TOPOLOGY);
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

  it("tracks per-chunk knowledge revisions independently from terrain changes", () => {
    const world = new WorldGrid(4, 2, 2, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const left = world.getChunk(0, 0)!;
    const right = world.getChunk(1, 0)!;
    const leftKnowledgeRevision = left.knowledgeRevision;
    const rightKnowledgeRevision = right.knowledgeRevision;

    world.setTerrain(0, 0, TerrainType.ShallowOcean);
    expect(left.knowledgeRevision).toBe(leftKnowledgeRevision);
    expect(right.knowledgeRevision).toBe(rightKnowledgeRevision);

    world.setKnowledge(0, 0, KnowledgeState.Personal, 7);
    expect(left.knowledgeRevision).toBe(leftKnowledgeRevision + 1);
    expect(right.knowledgeRevision).toBe(rightKnowledgeRevision);

    const knowledge = new Uint8Array(world.tileCount);
    const stamps = new Uint32Array(world.tileCount);
    knowledge[world.index(2, 0)] = KnowledgeState.Personal;
    stamps[world.index(2, 0)] = 8;
    expect(world.replaceKnowledge(knowledge, stamps)).toBe(true);
    expect(left.knowledgeRevision).toBe(leftKnowledgeRevision + 2);
    expect(right.knowledgeRevision).toBe(rightKnowledgeRevision + 1);
  });

  it("rejects inconsistent knowledge and expedition-stamp combinations", () => {
    const world = new WorldGrid(2, 1, 2, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);

    expect(() => world.setKnowledge(0, 0, KnowledgeState.Personal)).toThrow(
      "Knowledge state 1 is incompatible with expedition stamp 0",
    );
    expect(() => world.setKnowledge(0, 0, KnowledgeState.Unknown, 7)).toThrow(
      "Knowledge state 0 is incompatible with expedition stamp 7",
    );
    expect(world.getKnowledge(0, 0)).toBe(KnowledgeState.Unknown);
    expect(world.getExpeditionStamp(0, 0)).toBe(0);
  });

  it("maintains the sparse Supported-to-Personal boundary through knowledge and collision changes", () => {
    const world = new WorldGrid(5, 1, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setKnowledge(0, 0, KnowledgeState.Supported);
    world.setKnowledge(1, 0, KnowledgeState.Personal, 3);
    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([world.index(0, 0)]);

    world.setMovementBlocked(0, 0, true);
    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([]);
    world.setMovementBlocked(0, 0, false);
    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([world.index(0, 0)]);

    world.setKnowledge(1, 0, KnowledgeState.Supported);
    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([]);
  });

  it("maintains the Supported-to-Personal boundary across wrapping seams while storage stays canonical", () => {
    const world = new WorldGrid(4, 2, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setKnowledge(0, 0, KnowledgeState.Supported);
    world.setKnowledge(3, 0, KnowledgeState.Personal, 3);

    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([world.index(0, 0)]);
    expect(world.topology.normalizeTile(-1, 0)).toEqual({ x: 3, y: 0 });
    expect(world.inBounds(-1, 0)).toBe(false);
    expect(() => world.getKnowledge(-1, 0)).toThrow("outside 4x2 world");

    world.setMovementBlocked(3, 0, true);
    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([]);
    world.setMovementBlocked(3, 0, false);
    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([world.index(0, 0)]);

    const knowledge = new Uint8Array(world.tileCount);
    const stamps = new Uint32Array(world.tileCount);
    knowledge[world.index(0, 0)] = KnowledgeState.Supported;
    knowledge[world.index(3, 0)] = KnowledgeState.Personal;
    stamps[world.index(3, 0)] = 4;
    expect(world.replaceKnowledge(knowledge, stamps)).toBe(true);
    expect([...world.getSupportedPersonalBoundaryIndices()]).toEqual([world.index(0, 0)]);
  });

  it("revisions only topology changes that can alter passable Supported connectivity", () => {
    const world = new WorldGrid(4, 1, 4, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const baseline = world.supportedTopologyVersion;

    world.setKnowledge(0, 0, KnowledgeState.Personal, 1);
    world.setExpeditionStamp(0, 0, 2);
    world.setTerrain(0, 0, TerrainType.ShallowOcean);
    world.setMovementBlocked(0, 0, true);
    expect(world.supportedTopologyVersion).toBe(baseline);
    world.setKnowledge(0, 0, KnowledgeState.Supported);
    world.setKnowledge(0, 0, KnowledgeState.Unknown);
    expect(world.supportedTopologyVersion).toBe(baseline);

    world.setKnowledge(1, 0, KnowledgeState.Supported);
    expect(world.supportedTopologyVersion).toBe(baseline + 1);
    world.setTerrain(1, 0, TerrainType.ShallowOcean);
    expect(world.supportedTopologyVersion).toBe(baseline + 1);
    world.setMovementBlocked(1, 0, true);
    expect(world.supportedTopologyVersion).toBe(baseline + 2);
    world.setMovementBlocked(1, 0, false);
    expect(world.supportedTopologyVersion).toBe(baseline + 3);
    world.setKnowledge(1, 0, KnowledgeState.Unknown);
    expect(world.supportedTopologyVersion).toBe(baseline + 4);

    const knowledge = new Uint8Array(world.tileCount);
    const stamps = new Uint32Array(world.tileCount);
    knowledge[world.index(2, 0)] = KnowledgeState.Supported;
    expect(world.replaceKnowledge(knowledge, stamps)).toBe(true);
    expect(world.supportedTopologyVersion).toBe(baseline + 5);

    world.setMovementBlocked(3, 0, true);
    knowledge[world.index(3, 0)] = KnowledgeState.Supported;
    expect(world.replaceKnowledge(knowledge, stamps)).toBe(true);
    expect(world.supportedTopologyVersion).toBe(baseline + 5);
    knowledge[world.index(3, 0)] = KnowledgeState.Unknown;
    expect(world.replaceKnowledge(knowledge, stamps)).toBe(true);
    expect(world.supportedTopologyVersion).toBe(baseline + 5);

    stamps[world.index(0, 0)] = 3;
    knowledge[world.index(0, 0)] = KnowledgeState.Personal;
    expect(world.replaceKnowledge(knowledge, stamps)).toBe(true);
    expect(world.supportedTopologyVersion).toBe(baseline + 5);
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
    const world = new WorldGrid(5, 3, 2, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setTerrain(2, 1, TerrainType.Land);
    const ship = createShipStateAtGrid({ x: 1, y: 1 }, 12, 0);
    const movement = new MovementSystem(world);

    const result = movement.update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(true);
    expect(ship.currentTileX).toBe(1);
    expect(ship.currentTileY).toBe(1);
    expect(ship.worldX).toBeCloseTo(
      64
      - prototypeConfig.movement.shipCollisionHalfExtent
      - prototypeConfig.movement.collisionEpsilon,
      6,
    );
    expect(ship.speed).toBe(0);
    expect(result.enteredTiles).toEqual([]);
  });

  it("slides a glancing ship along blocking terrain without entering it", () => {
    const config = makeConfig({
      movement: { shipCollisionHalfExtent: 1, shipSpeed: Math.SQRT2 },
    });
    const world = new WorldGrid(6, 6, 3, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setTerrain(3, 2, TerrainType.Land);
    const ship = createShipStateAtGrid({ x: 2, y: 2 }, 12, 45, config);

    const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(true);
    expect(ship.worldX).toBeCloseTo(
      96 - config.movement.shipCollisionHalfExtent - config.movement.collisionEpsilon / Math.SQRT2,
      6,
    );
    expect(ship.worldY).toBeCloseTo(112, 6);
    expect(ship.currentTileX).toBe(2);
    expect(ship.currentTileY).toBe(3);
    expect(ship.speed).toBeGreaterThan(0);
    expect(result.enteredTiles).toEqual([{ x: 2, y: 3 }]);
    expect(result.segments.reduce((total, segment) => total + segment.distancePixels, 0))
      .toBeCloseTo(result.movedDistancePixels, 10);
  });

  it("does not slide through a blocked inside corner", () => {
    const config = makeConfig({
      movement: { shipCollisionHalfExtent: 1, shipSpeed: Math.SQRT2 },
    });
    const world = new WorldGrid(6, 6, 3, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setTerrain(3, 2, TerrainType.Land);
    world.setTerrain(2, 3, TerrainType.Land);
    const ship = createShipStateAtGrid({ x: 2, y: 2 }, 12, 45, config);

    const result = new MovementSystem(world, config).update(ship, { turn: 0, throttle: 1 }, 1);

    expect(result.collided).toBe(true);
    expect(ship.currentTileX).toBe(2);
    expect(ship.currentTileY).toBe(2);
    expect(ship.worldX).toBeLessThan(96);
    expect(ship.worldY).toBeLessThan(96);
    expect(result.enteredTiles).toEqual([]);
  });

  it("reuses the immutable idle result instead of allocating every fixed step", () => {
    const world = new WorldGrid(3, 3, 2, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const movement = new MovementSystem(world);
    const ship = createShipStateAtGrid({ x: 1, y: 1 });

    const first = movement.update(ship, { turn: 0, throttle: 0 }, 1 / 30);
    const second = movement.update(ship, { turn: 0, throttle: 0 }, 1 / 30);

    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.liftedDisplacement).toEqual({ x: 0, y: 0 });
    expect(first.worldImageOffset).toEqual({ x: 0, y: 0 });
    expect(Object.isFrozen(first.liftedDisplacement)).toBe(true);
    expect(Object.isFrozen(first.worldImageOffset)).toBe(true);
    expect(Object.isFrozen(first.enteredTiles)).toBe(true);
    expect(Object.isFrozen(first.segments)).toBe(true);
  });

  it("rejects non-finite movement input before mutating ship state", () => {
    const world = new WorldGrid(3, 3, 2, BOUNDED_WORLD_TOPOLOGY);
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

  it("can stop after a requested target has its final shortest cost", () => {
    const result = dijkstra({
      nodeCount: 6,
      starts: [0],
      target: 2,
      forEachNeighbor: (node, visit) => {
        if (node > 0) visit(node - 1, 1);
        if (node + 1 < 6) visit(node + 1, 1);
      },
    });

    expect(result.costs[2]).toBe(2);
    expect(reconstructDijkstraPath(result, 2)).toEqual([0, 1, 2]);
    expect(result.visited[3]).toBe(0);
    expect(result.settledCount).toBe(3);
  });

  it("rejects invalid Dijkstra cost horizons", () => {
    const run = (maxCost: number) => dijkstra({
      nodeCount: 1,
      starts: [0],
      maxCost,
      forEachNeighbor: () => undefined,
    });

    expect(() => run(-1)).toThrow("maxCost must be non-negative");
    expect(() => run(Number.NaN)).toThrow("maxCost must be non-negative");
    expect(run(Number.POSITIVE_INFINITY).costs[0]).toBe(0);
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
