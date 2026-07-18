import { describe, expect, it } from "vitest";

import {
  ActiveChunkSet,
  type ActiveChunkEntry,
} from "../src/wayfinders/rendering/activation";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WorldTopology,
  WRAPPING_WORLD_TOPOLOGY,
  type WorldTopologyDefinition,
} from "../src/wayfinders/world/WorldTopology";

function topology(
  width = 12,
  height = 12,
  chunkSize = 4,
  tileSize = 10,
  definition: Readonly<WorldTopologyDefinition> = WRAPPING_WORLD_TOPOLOGY,
): WorldTopology {
  return new WorldTopology(width, height, tileSize, chunkSize, definition);
}

function viewKeys(entries: readonly Readonly<ActiveChunkEntry>[]): string[] {
  return entries.map(({ viewKey }) => viewKey);
}

function createSet(
  world = topology(),
  prefetchRing = 1,
  maxActiveChunks = 25,
): ActiveChunkSet {
  return new ActiveChunkSet({ topology: world, prefetchRing, maxActiveChunks });
}

describe("ActiveChunkSet", () => {
  it("ranks visible chunk images before a deterministic prefetch ring", () => {
    const chunks = createSet(topology(), 1, 9);
    const delta = chunks.update({ minX: 4, minY: 4, maxX: 7, maxY: 7 });

    expect(viewKeys(delta.active)).toEqual([
      "1,1@0,0",
      "1,0@0,0", "0,1@0,0", "2,1@0,0", "1,2@0,0",
      "0,0@0,0", "2,0@0,0", "0,2@0,0", "2,2@0,0",
    ]);
    expect(delta.active.map(({ band }) => band)).toEqual([
      "visible",
      "prefetch", "prefetch", "prefetch", "prefetch",
      "prefetch", "prefetch", "prefetch", "prefetch",
    ]);
    expect(delta.active.map(({ loadPriority }) => loadPriority)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(delta.deferred).toEqual([]);
    expect(delta.telemetry).toMatchObject({
      activeChunks: 9,
      visibleActiveChunks: 1,
      prefetchedActiveChunks: 8,
      desiredChunks: 9,
      budgetSaturated: false,
    });
  });

  it("requests canonical images across all four seams and corners", () => {
    const chunks = createSet(topology(10, 6, 4), 0, 25);
    const cases = [
      [{ minX: -1, minY: 2, maxX: 0, maxY: 2 }, ["2,0@-100,0", "0,0@0,0"]],
      [{ minX: 9, minY: 2, maxX: 10, maxY: 2 }, ["2,0@0,0", "0,0@100,0"]],
      [{ minX: 2, minY: -1, maxX: 2, maxY: 0 }, ["0,1@0,-60", "0,0@0,0"]],
      [{ minX: 2, minY: 5, maxX: 2, maxY: 6 }, ["0,1@0,0", "0,0@0,60"]],
    ] as const;

    for (const [bounds, expected] of cases) {
      expect(viewKeys(chunks.update(bounds).active)).toEqual(expected);
    }

    const corners = [
      [{ minX: -1, minY: -1, maxX: 0, maxY: 0 }, [
        "2,1@-100,-60", "0,1@0,-60", "2,0@-100,0", "0,0@0,0",
      ]],
      [{ minX: 9, minY: -1, maxX: 10, maxY: 0 }, [
        "2,1@0,-60", "0,1@100,-60", "2,0@0,0", "0,0@100,0",
      ]],
      [{ minX: -1, minY: 5, maxX: 0, maxY: 6 }, [
        "2,1@-100,0", "0,1@0,0", "2,0@-100,60", "0,0@0,60",
      ]],
      [{ minX: 9, minY: 5, maxX: 10, maxY: 6 }, [
        "2,1@0,0", "0,1@100,0", "2,0@0,60", "0,0@100,60",
      ]],
    ] as const;
    for (const [bounds, expected] of corners) {
      const corner = chunks.update(bounds);
      expect(viewKeys(corner.active)).toEqual(expected);
      expect(new Set(viewKeys(corner.active)).size).toBe(corner.active.length);
    }

    expect(viewKeys(chunks.update({ minX: -21, minY: 2, maxX: -20, maxY: 2 }).active)).toEqual([
      "2,0@-300,0", "0,0@-200,0",
    ]);
    expect(viewKeys(chunks.update({ minX: 29, minY: 2, maxX: 30, maxY: 2 }).active)).toEqual([
      "2,0@200,0", "0,0@300,0",
    ]);
  });

  it("uses exact world spans for partial-final-chunk images", () => {
    const chunks = createSet(topology(10, 7, 4, 32), 0, 25);
    const delta = chunks.update({ minX: 9, minY: 6, maxX: 10, maxY: 7 });

    expect(delta.active.map(({ canonicalChunk, imageOffset, viewKey }) => ({
      canonicalChunk,
      imageOffset,
      viewKey,
    }))).toEqual([
      { canonicalChunk: { x: 2, y: 1 }, imageOffset: { x: 0, y: 0 }, viewKey: "2,1@0,0" },
      { canonicalChunk: { x: 2, y: 0 }, imageOffset: { x: 0, y: 224 }, viewKey: "2,0@0,224" },
      { canonicalChunk: { x: 0, y: 1 }, imageOffset: { x: 320, y: 0 }, viewKey: "0,1@320,0" },
      { canonicalChunk: { x: 0, y: 0 }, imageOffset: { x: 320, y: 224 }, viewKey: "0,0@320,224" },
    ]);
    expect(delta.active.some(({ imageOffset }) => imageOffset.x === 384 || imageOffset.y === 256)).toBe(false);
  });

  it("keeps duplicate canonical chunks as distinct tiny-world images", () => {
    const chunks = createSet(topology(1, 1, 4, 16), 0, 25);
    const delta = chunks.update({ minX: -1, minY: -1, maxX: 1, maxY: 1 });

    expect(delta.active).toHaveLength(9);
    expect(new Set(delta.active.map(({ canonicalChunk }) => `${canonicalChunk.x},${canonicalChunk.y}`))).toEqual(
      new Set(["0,0"]),
    );
    expect(new Set(viewKeys(delta.active)).size).toBe(9);
    expect(new Set(delta.active.map(({ imageOffset }) => `${imageOffset.x},${imageOffset.y}`))).toEqual(new Set([
      "-16,-16", "0,-16", "16,-16",
      "-16,0", "0,0", "16,0",
      "-16,16", "0,16", "16,16",
    ]));
  });

  it("returns exact seam-crossing deltas and stable repeated updates", () => {
    const chunks = createSet(topology(20, 4, 4, 10, { x: "wrap", y: "bounded" }), 1, 3);
    const first = chunks.update({ minX: 4, minY: 0, maxX: 7, maxY: 3 });
    const crossed = chunks.update({ minX: 8, minY: 0, maxX: 11, maxY: 3 });

    expect(viewKeys(first.active)).toEqual(["1,0@0,0", "0,0@0,0", "2,0@0,0"]);
    expect(viewKeys(crossed.active)).toEqual(["2,0@0,0", "1,0@0,0", "3,0@0,0"]);
    expect(viewKeys(crossed.activated)).toEqual(["3,0@0,0"]);
    expect(crossed.deactivated.map(({ viewKey, reason }) => ({ viewKey, reason }))).toEqual([
      { viewKey: "0,0@0,0", reason: "outside-prefetch" },
    ]);
    expect(viewKeys(crossed.updated)).toEqual(["2,0@0,0", "1,0@0,0"]);

    const unchanged = chunks.update({ minX: 8, minY: 0, maxX: 11, maxY: 3 });
    expect(unchanged.revision).toBe(crossed.revision);
    expect(unchanged.membershipRevision).toBe(crossed.membershipRevision);
    expect(unchanged.activated).toEqual([]);
    expect(unchanged.deactivated).toEqual([]);
    expect(unchanged.updated).toEqual([]);
  });

  it("caps periodic image demand and exposes visible placeholder entries", () => {
    const chunks = createSet(topology(1, 1, 4, 8), 0, 5);
    const delta = chunks.update({ minX: -1, minY: -1, maxX: 1, maxY: 1 });

    expect(delta.active).toHaveLength(5);
    expect(delta.deferred).toHaveLength(4);
    expect(delta.deferred.every(({ band }) => band === "visible")).toBe(true);
    expect(new Set([...viewKeys(delta.active), ...viewKeys(delta.deferred)]).size).toBe(9);
    expect(delta.telemetry).toMatchObject({
      capacity: 5,
      activeChunks: 5,
      desiredChunks: 9,
      budgetDeferredChunks: 4,
      visibleBudgetDeferredChunks: 4,
      budgetSaturated: true,
      peakActiveChunks: 5,
      peakBudgetDeferredChunks: 4,
    });
  });

  it("distinguishes budget eviction from leaving periodic prefetch demand", () => {
    const chunks = createSet(topology(16, 4, 4), 1, 1);
    chunks.update({ minX: 0, minY: 0, maxX: 3, maxY: 3 });

    const moved = chunks.update({ minX: 4, minY: 0, maxX: 7, maxY: 3 });
    expect(moved.deactivated.map(({ viewKey, reason }) => ({ viewKey, reason }))).toEqual([
      { viewKey: "0,0@0,0", reason: "budget" },
    ]);
    expect(moved.telemetry.totalBudgetEvictions).toBe(1);
    expect(moved.telemetry.totalViewportDeactivations).toBe(0);
  });

  it("clips only bounded topology and validates lifted bounds", () => {
    const chunks = createSet(topology(8, 8, 4, 10, BOUNDED_WORLD_TOPOLOGY), 1, 9);
    const edge = chunks.update({ minX: -2, minY: -2, maxX: 0, maxY: 0 });
    expect(viewKeys(edge.active)).toEqual(["0,0@0,0", "1,0@0,0", "0,1@0,0", "1,1@0,0"]);

    const outside = chunks.update({ minX: -20, minY: -20, maxX: -10, maxY: -10 });
    expect(outside.active).toEqual([]);
    expect(outside.visibleTileBounds).toEqual({ minX: -20, minY: -20, maxX: -10, maxY: -10 });

    const cleared = chunks.update(null);
    expect(cleared.active).toEqual([]);
    expect(cleared.visibleTileBounds).toBeNull();
    expect(() => chunks.update({ minX: 1, minY: 0, maxX: 0, maxY: 1 })).toThrow(/minimums cannot exceed/);
    expect(() => chunks.update({ minX: 0.5, minY: 0, maxX: 1, maxY: 1 })).toThrow(/safe integer/);
    expect(() => createSet(topology(), -1, 1)).toThrow(/non-negative integer/);
    expect(() => createSet(topology(), 0, 0)).toThrow(/positive integer/);
  });
});
