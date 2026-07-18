import { describe, expect, it, vi } from "vitest";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph";
import { solidRowsToCollisionMask } from "../src/wayfinders/world/CollisionMask";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
} from "../src/wayfinders/world/WorldTopology";
import { makeConfig } from "./helpers";

describe("knowledge-safe static edge topology cache", () => {
  it("reuses blocker provenance as hidden collision becomes visible and known", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const world = new WorldGrid(5, 3, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setTerrain(2, 1, TerrainType.Land);
    const graph = new GridGraph(world, config);
    const left = world.index(1, 1);
    const right = world.index(2, 1);

    expect(graph.canTraverseKnownCardinalEdge(left, right)).toBe(true);
    const classified = graph.staticTopologyStats();
    expect(classified.classifiedEdges).toBe(1);
    expect(classified.cacheMisses).toBe(1);

    expect(graph.canTraverseKnownCardinalEdge(right, left)).toBe(true);
    expect(graph.staticTopologyStats().classifiedEdges).toBe(1);
    expect(graph.staticTopologyStats().cacheHits).toBeGreaterThan(0);

    world.setVisibleNowAtIndex(right, true);
    expect(graph.canTraverseKnownCardinalEdge(left, right)).toBe(false);
    expect(graph.staticTopologyStats().classifiedEdges).toBe(1);

    world.setVisibleNowAtIndex(right, false);
    world.setKnowledgeAtIndex(right, KnowledgeState.Personal, 1);
    expect(graph.canTraverseKnownCardinalEdge(left, right)).toBe(false);
    expect(graph.staticTopologyStats().classifiedEdges).toBe(1);
  });

  it("invalidates classifications only when collision topology changes", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const world = new WorldGrid(5, 3, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const graph = new GridGraph(world, config);
    const left = world.index(1, 1);
    const right = world.index(2, 1);

    expect(graph.canTraverseCardinalEdge(left, right)).toBe(true);
    const first = graph.staticTopologyStats();
    expect(graph.canTraverseCardinalEdge(left, right)).toBe(true);
    expect(graph.staticTopologyStats().classifiedEdges).toBe(first.classifiedEdges);

    expect(world.setTerrain(2, 1, TerrainType.Land)).toBe(true);
    expect(graph.canTraverseCardinalEdge(left, right)).toBe(false);
    const changed = graph.staticTopologyStats();
    expect(changed.collisionVersion).toBe(world.collisionVersion);
    expect(changed.classifiedEdges).toBe(1);

    expect(world.setTerrain(2, 1, TerrainType.Land)).toBe(false);
    expect(graph.canTraverseCardinalEdge(left, right)).toBe(false);
    expect(graph.staticTopologyStats().classifiedEdges).toBe(1);
  });

  it("isolates collision signatures while sharing matching graph instances", () => {
    const world = new WorldGrid(5, 3, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const small = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const large = makeConfig({ movement: { shipCollisionHalfExtent: 14 } });
    const left = world.index(1, 1);
    const right = world.index(2, 1);
    const first = new GridGraph(world, small);
    const matching = new GridGraph(world, small);
    const isolated = new GridGraph(world, large);

    expect(first.canTraverseCardinalEdge(left, right)).toBe(true);
    expect(matching.canTraverseCardinalEdge(left, right)).toBe(true);
    expect(matching.staticTopologyStats().cacheHits).toBeGreaterThan(0);
    expect(isolated.staticTopologyStats().classifiedEdges).toBe(0);
    expect(isolated.canTraverseCardinalEdge(left, right)).toBe(true);
    expect(isolated.staticTopologyStats().classifiedEdges).toBe(1);
  });

  it("exposes direction and destination image offsets without width-one self traversal", () => {
    const one = new WorldGrid(1, 1, 1, WRAPPING_WORLD_TOPOLOGY);
    one.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const selfEdges: number[] = [];
    new GridGraph(one).forEachTraversableCardinalEdge(0, (neighbor) => selfEdges.push(neighbor));
    expect(selfEdges).toEqual([]);

    const two = new WorldGrid(2, 1, 2, WRAPPING_WORLD_TOPOLOGY);
    two.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    const graph = new GridGraph(two, makeConfig({ movement: { shipCollisionHalfExtent: 1 } }));
    const edges: Array<readonly [number, number, number, number]> = [];
    graph.forEachTraversableCardinalEdge(
      two.index(0, 0),
      (neighbor, _x, _y, direction, _reverse, imageOffsetX, imageOffsetY) => {
        edges.push([neighbor, direction, imageOffsetX, imageOffsetY]);
      },
    );

    expect(edges).toEqual([
      [two.index(1, 0), 0, -2, 0],
      [two.index(1, 0), 1, 0, 0],
    ]);
    expect(graph.canTraverseCardinalDirection(two.index(0, 0), 0)).toBe(true);
    expect(graph.canTraverseCardinalDirection(two.index(0, 0), 1)).toBe(true);
    expect(graph.staticTopologyStats().classifiedEdges).toBe(2);
  });

  it("visits primitive edges in exact cardinalEdge order without step allocations", () => {
    const definitions = [
      BOUNDED_WORLD_TOPOLOGY,
      WRAPPING_WORLD_TOPOLOGY,
      { x: "wrap", y: "bounded" } as const,
      { x: "bounded", y: "wrap" } as const,
    ];
    const dimensions = [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
      [3, 4],
    ] as const;
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });

    for (const definition of definitions) {
      for (const [width, height] of dimensions) {
        const world = new WorldGrid(width, height, Math.max(width, height), definition);
        world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
        const graph = new GridGraph(world, config);
        const expectedByIndex: Array<Array<readonly [number, number, number, number, number, number, number]>> = [];
        for (let index = 0; index < world.tileCount; index++) {
          const expected: Array<readonly [number, number, number, number, number, number, number]> = [];
          for (let direction = 0 as 0 | 1 | 2 | 3; direction < 4; direction++) {
            const edge = graph.cardinalEdge(index, direction);
            if (!edge) continue;
            expected.push([
              edge.neighborIndex,
              edge.x,
              edge.y,
              edge.direction,
              edge.reverseDirection,
              edge.imageOffsetX,
              edge.imageOffsetY,
            ]);
          }
          expectedByIndex.push(expected);
        }

        const step = vi.spyOn(world.topology, "stepCardinal");
        for (let index = 0; index < world.tileCount; index++) {
          const actual: Array<readonly [number, number, number, number, number, number, number]> = [];
          graph.forEachTraversableCardinalEdge(index, (...edge) => actual.push(edge));
          expect(actual).toEqual(expectedByIndex[index]);

          const known: typeof actual = [];
          graph.forEachKnownTraversableCardinalEdge(index, (...edge) => known.push(edge));
          expect(known).toEqual(expectedByIndex[index]);
        }
        expect(step).not.toHaveBeenCalled();
        step.mockRestore();
      }
    }
  });

  it("classifies a seam edge against the short lifted destination image", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const world = new WorldGrid(4, 3, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
    world.setTerrain(3, 1, TerrainType.Land);
    const graph = new GridGraph(world, config);
    const westEdge = graph.cardinalEdge(world.index(0, 1), 0);

    expect(westEdge).toMatchObject({
      neighborIndex: world.index(3, 1),
      direction: 0,
      reverseDirection: 1,
      imageOffsetX: -4,
      imageOffsetY: 0,
    });
    expect(graph.canTraverseCardinalDirection(world.index(0, 1), 0)).toBe(false);

    world.setTerrain(3, 1, TerrainType.DeepOcean);
    expect(graph.canTraverseCardinalDirection(world.index(0, 1), 0)).toBe(true);

    world.setFineCollisionMask(3, 1, solidRowsToCollisionMask([
      "0000",
      "0100",
      "0000",
      "0000",
    ]));
    expect(graph.canTraverseCardinalDirection(world.index(0, 1), 0)).toBe(false);
    world.clearFineCollisionMask(3, 1);
    expect(graph.canTraverseCardinalDirection(world.index(0, 1), 0)).toBe(true);
    expect(graph.staticTopologyStats().collisionVersion).toBe(world.collisionVersion);
  });
});
