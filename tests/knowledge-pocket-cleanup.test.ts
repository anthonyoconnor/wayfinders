import { describe, expect, it } from "vitest";
import { KnowledgeSystem } from "../src/tidebound/exploration/KnowledgeSystem.ts";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData.ts";
import { WorldGrid } from "../src/tidebound/world/WorldGrid.ts";
import { makeConfig } from "./helpers.ts";

function supportedWorld(width = 7, height = 7): WorldGrid {
  const world = new WorldGrid(width, height, Math.min(width, height));
  world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
  return world;
}

function prepareReturn(
  world: WorldGrid,
  unknown: readonly [number, number][],
  committed: [number, number],
  expeditionId = 7,
): KnowledgeSystem {
  for (const [x, y] of unknown) world.setKnowledge(x, y, KnowledgeState.Unknown, 0);
  world.setKnowledge(committed[0], committed[1], KnowledgeState.Personal, expeditionId);
  return new KnowledgeSystem(world, makeConfig());
}

describe("successful-return Unknown pocket cleanup", () => {
  it.each([
    [[[3, 3]] as [number, number][]],
    [[[3, 3], [4, 3]] as [number, number][]],
  ])("fills an enclosed one- or two-tile component", (unknown) => {
    const world = supportedWorld();
    const knowledge = prepareReturn(world, unknown, [2, 3]);

    const update = knowledge.commitExpedition(7);

    expect(update.changedCount).toBe(unknown.length + 1);
    for (const [x, y] of unknown) {
      expect(world.getKnowledge(x, y)).toBe(KnowledgeState.Supported);
      expect(world.getExpeditionStamp(x, y)).toBe(0);
    }
  });

  it("keeps a component larger than the configured limit Unknown", () => {
    const world = supportedWorld();
    const unknown = [[3, 3], [4, 3], [5, 3]] as [number, number][];
    const knowledge = prepareReturn(world, unknown, [2, 3]);

    expect(knowledge.commitExpedition(7).changedCount).toBe(1);
    for (const [x, y] of unknown) expect(world.getKnowledge(x, y)).toBe(KnowledgeState.Unknown);
  });

  it("preserves a diagonally connected component which reaches the world edge", () => {
    const world = supportedWorld();
    const unknown = [[3, 3], [2, 2], [1, 1], [0, 0]] as [number, number][];
    const knowledge = prepareReturn(world, unknown, [4, 3]);

    expect(knowledge.commitExpedition(7).changedCount).toBe(1);
    for (const [x, y] of unknown) expect(world.getKnowledge(x, y)).toBe(KnowledgeState.Unknown);
  });

  it("does not fill across a non-Supported boundary tile", () => {
    const world = supportedWorld();
    const knowledge = prepareReturn(world, [[3, 3]], [2, 3]);
    world.setKnowledge(4, 3, KnowledgeState.Personal, 11);

    expect(knowledge.commitExpedition(7).changedCount).toBe(1);
    expect(world.getKnowledge(3, 3)).toBe(KnowledgeState.Unknown);
  });

  it("allows a zero limit to disable cleanup", () => {
    const world = supportedWorld();
    for (const [x, y] of [[3, 3]] as [number, number][]) {
      world.setKnowledge(x, y, KnowledgeState.Unknown, 0);
    }
    world.setKnowledge(2, 3, KnowledgeState.Personal, 7);
    const config = makeConfig({ world: { maxEnclosedUnknownTiles: 0 } });
    const knowledge = new KnowledgeSystem(world, config);

    expect(knowledge.commitExpedition(7).changedCount).toBe(1);
    expect(world.getKnowledge(3, 3)).toBe(KnowledgeState.Unknown);
  });

  it("keeps counts, sparse indices, stamps, and returned changes exact", () => {
    const world = supportedWorld(5, 5);
    const hole = world.index(2, 2);
    const route = world.index(1, 2);
    const knowledge = prepareReturn(world, [[2, 2]], [1, 2]);

    const update = knowledge.commitExpedition(7);

    expect(new Set(update.changedIndices)).toEqual(new Set([route, hole]));
    expect(update.changedCount).toBe(2);
    expect(update.closedUnknownIndices).toEqual([hole]);
    expect(update.closedUnknownCount).toBe(1);
    expect(world.getKnowledgeCount(KnowledgeState.Unknown)).toBe(0);
    expect(world.getKnowledgeCount(KnowledgeState.Personal)).toBe(0);
    expect(world.getKnowledgeCount(KnowledgeState.Supported)).toBe(world.tileCount);
    expect(world.getPersonalKnowledgeIndices()).toEqual(new Set());
    expect(world.getSupportedKnowledgeIndices().size).toBe(world.tileCount);
    expect(world.getExpeditionStampAtIndex(route)).toBe(0);
    expect(world.getExpeditionStampAtIndex(hole)).toBe(0);
  });

  it("never performs pocket cleanup while reverting a failed expedition", () => {
    const world = supportedWorld(5, 5);
    world.setKnowledge(2, 2, KnowledgeState.Unknown, 0);
    world.setKnowledge(1, 2, KnowledgeState.Personal, 7);
    const knowledge = new KnowledgeSystem(world, makeConfig());

    const update = knowledge.revertExpedition(7);

    expect(update.changedIndices).toEqual([world.index(1, 2)]);
    expect(update.changedCount).toBe(1);
    expect(world.getKnowledge(1, 2)).toBe(KnowledgeState.Unknown);
    expect(world.getKnowledge(2, 2)).toBe(KnowledgeState.Unknown);
  });
});
