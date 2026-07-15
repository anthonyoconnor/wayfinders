import { describe, expect, it } from "vitest";
import { SupportedConnectivitySystem } from "../src/wayfinders/exploration/SupportedConnectivitySystem.ts";
import { solidRowsToCollisionMask } from "../src/wayfinders/world/CollisionMask.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { makeConfig } from "./helpers.ts";

function supportedWorld(width: number, height: number): WorldGrid {
  const world = new WorldGrid(width, height, Math.max(width, height));
  world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
  return world;
}

describe("SupportedConnectivitySystem", () => {
  it("returns the inclusive exact-endpoint path through cardinal passable Supported water", () => {
    const world = supportedWorld(4, 2);
    const homeReturnTile = { x: 0, y: 0 };
    const serviceAnchor = { x: 3, y: 0 };
    const system = new SupportedConnectivitySystem(world, homeReturnTile);

    const result = system.connectivityTo(serviceAnchor, 1);

    expect(result).toEqual({
      topologyRevision: 1,
      homeReturnIndex: world.index(0, 0),
      serviceAnchorIndex: world.index(3, 0),
      pathIndices: [0, 1, 2, 3].map((x) => world.index(x, 0)),
      connected: true,
    });
    expect(system.isConnected(serviceAnchor, 1)).toBe(true);
    expect(system.pathTo(serviceAnchor, 1)).toBe(result.pathIndices);
    expect(system.buildCount).toBe(1);
  });

  it("requires both exact endpoints rather than substituting adjacent Supported tiles", () => {
    const world = supportedWorld(4, 2);
    const home = { x: 0, y: 0 };
    const anchor = { x: 3, y: 0 };

    world.setKnowledge(3, 0, KnowledgeState.Unknown);
    const unsupportedAnchor = new SupportedConnectivitySystem(world, home).connectivityTo(anchor, 1);
    expect(unsupportedAnchor.connected).toBe(false);
    expect(unsupportedAnchor.pathIndices).toEqual([]);

    world.setKnowledge(3, 0, KnowledgeState.Supported);
    world.setMovementBlocked(0, 0, true);
    const blockedHome = new SupportedConnectivitySystem(world, home).connectivityTo(anchor, 2);
    expect(blockedHome.connected).toBe(false);
    expect(blockedHome.pathIndices).toEqual([]);
  });

  it("does not connect diagonally adjacent Supported tiles", () => {
    const world = new WorldGrid(2, 2, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setKnowledge(0, 0, KnowledgeState.Supported);
    world.setKnowledge(1, 1, KnowledgeState.Supported);
    const system = new SupportedConnectivitySystem(world, { x: 0, y: 0 });

    expect(system.isConnected({ x: 1, y: 1 }, 1)).toBe(false);
    expect(system.pathTo({ x: 1, y: 1 }, 1)).toEqual([]);
  });

  it("uses north, east, south, west order to break equal-length route ties", () => {
    const world = supportedWorld(3, 3);
    world.setMovementBlocked(1, 1, true);
    const system = new SupportedConnectivitySystem(world, { x: 0, y: 1 });

    expect(system.pathTo({ x: 2, y: 1 }, 1)).toEqual([
      world.index(0, 1),
      world.index(0, 0),
      world.index(1, 0),
      world.index(2, 0),
      world.index(2, 1),
    ]);
  });

  it("keeps a cached BFS until the caller changes the topology revision", () => {
    const world = supportedWorld(3, 1);
    const anchor = { x: 2, y: 0 };
    const system = new SupportedConnectivitySystem(world, { x: 0, y: 0 });

    const initial = system.connectivityTo(anchor, 7);
    expect(initial.connected).toBe(true);
    expect(system.buildCount).toBe(1);

    world.setMovementBlocked(1, 0, true);
    expect(system.connectivityTo(anchor, 7)).toBe(initial);
    expect(system.isConnected(anchor, 7)).toBe(true);
    expect(system.buildCount).toBe(1);

    const invalidated = system.connectivityTo(anchor, 8);
    expect(invalidated.connected).toBe(false);
    expect(invalidated.pathIndices).toEqual([]);
    expect(invalidated).not.toBe(initial);
    expect(system.buildCount).toBe(2);

    expect(system.isConnected(anchor, 9)).toBe(false);
    expect(system.buildCount).toBe(3);
  });

  it("invalidates and restores Supported connectivity across a fine collision barrier", () => {
    const world = supportedWorld(3, 1);
    const anchor = { x: 2, y: 0 };
    const system = new SupportedConnectivitySystem(world, { x: 0, y: 0 });
    const initialRevision = world.supportedTopologyVersion;

    expect(system.pathTo(anchor, initialRevision)).toEqual([
      world.index(0, 0),
      world.index(1, 0),
      world.index(2, 0),
    ]);

    world.setFineCollisionMask(1, 0, solidRowsToCollisionMask([
      "1000",
      "0000",
      "0000",
      "0000",
    ]));
    expect(world.supportedTopologyVersion).toBe(initialRevision + 1);
    expect(system.pathTo(anchor, world.supportedTopologyVersion)).toEqual([]);
    expect(system.isConnected(anchor, world.supportedTopologyVersion)).toBe(false);

    world.clearFineCollisionMask(1, 0);
    expect(world.supportedTopologyVersion).toBe(initialRevision + 2);
    expect(system.pathTo(anchor, world.supportedTopologyVersion)).toEqual([
      world.index(0, 0),
      world.index(1, 0),
      world.index(2, 0),
    ]);
    expect(system.buildCount).toBe(3);
  });

  it("invalidates Supported connectivity when knowledge changes on a fine-overridden coarse-solid cell", () => {
    const world = supportedWorld(3, 1);
    world.setTerrain(1, 0, TerrainType.Land);
    world.setFineCollisionMask(1, 0, solidRowsToCollisionMask([
      "1000",
      "0000",
      "0000",
      "0000",
    ]));
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const system = new SupportedConnectivitySystem(world, { x: 0, y: 0 }, config);
    const anchor = { x: 2, y: 0 };
    const initialRevision = world.supportedTopologyVersion;

    expect(system.isConnected(anchor, initialRevision)).toBe(true);

    world.setKnowledge(1, 0, KnowledgeState.Personal, 4);
    expect(world.supportedTopologyVersion).toBe(initialRevision + 1);
    expect(system.isConnected(anchor, world.supportedTopologyVersion)).toBe(false);

    world.setKnowledge(1, 0, KnowledgeState.Supported);
    expect(world.supportedTopologyVersion).toBe(initialRevision + 2);
    expect(system.isConnected(anchor, world.supportedTopologyVersion)).toBe(true);
  });
});
