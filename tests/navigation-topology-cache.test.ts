import { describe, expect, it } from "vitest";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { makeConfig } from "./helpers";

describe("knowledge-safe static edge topology cache", () => {
  it("reuses blocker provenance as hidden collision becomes visible and known", () => {
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const world = new WorldGrid(5, 3, 5);
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
    const world = new WorldGrid(5, 3, 5);
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
    const world = new WorldGrid(5, 3, 5);
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
});
