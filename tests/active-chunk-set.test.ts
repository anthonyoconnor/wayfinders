import { describe, expect, it } from "vitest";
import {
  ActiveChunkSet,
  type ActiveChunkEntry,
} from "../src/wayfinders/rendering/activation";

function keys(entries: readonly Readonly<ActiveChunkEntry>[]): string[] {
  return entries.map(({ key }) => key);
}

describe("ActiveChunkSet", () => {
  it("ranks visible chunks before a deterministic prefetch ring", () => {
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      prefetchRing: 1,
      maxActiveChunks: 9,
    });

    const delta = chunks.update({ minX: 1, minY: 1, maxX: 1, maxY: 1 });

    expect(keys(delta.active)).toEqual([
      "1,1",
      "1,0", "0,1", "2,1", "1,2",
      "0,0", "2,0", "0,2", "2,2",
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

  it("returns exact seam-crossing deltas without duplicate activation", () => {
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 4, maxY: 0 },
      prefetchRing: 1,
      maxActiveChunks: 3,
    });
    const first = chunks.update({ minX: 1, minY: 0, maxX: 1, maxY: 0 });
    const crossed = chunks.update({ minX: 2, minY: 0, maxX: 2, maxY: 0 });

    expect(keys(first.active)).toEqual(["1,0", "0,0", "2,0"]);
    expect(keys(crossed.active)).toEqual(["2,0", "1,0", "3,0"]);
    expect(keys(crossed.activated)).toEqual(["3,0"]);
    expect(crossed.deactivated.map(({ key, reason }) => ({ key, reason }))).toEqual([
      { key: "0,0", reason: "outside-prefetch" },
    ]);
    expect(keys(crossed.updated)).toEqual(["2,0", "1,0"]);
    expect(crossed.membershipRevision).toBe(2);
    expect(new Set(keys(crossed.active)).size).toBe(crossed.active.length);
  });

  it("enforces the hard budget and exposes visible placeholder demand", () => {
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      prefetchRing: 0,
      maxActiveChunks: 5,
    });
    const delta = chunks.update({ minX: 0, minY: 0, maxX: 2, maxY: 2 });

    expect(keys(delta.active)).toEqual(["1,1", "1,0", "0,1", "2,1", "1,2"]);
    expect(keys(delta.deferred)).toEqual(["0,0", "2,0", "0,2", "2,2"]);
    expect(delta.deferred.every(({ band }) => band === "visible")).toBe(true);
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

    const unchanged = chunks.update({ minX: 0, minY: 0, maxX: 2, maxY: 2 });
    expect(unchanged.revision).toBe(delta.revision);
    expect(unchanged.membershipRevision).toBe(delta.membershipRevision);
    expect(unchanged.activated).toEqual([]);
    expect(unchanged.deactivated).toEqual([]);
    expect(unchanged.updated).toEqual([]);
    expect(unchanged.telemetry.updateCount).toBe(2);
  });

  it("keeps active resources at capacity during rapid camera movement", () => {
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 99, maxY: 0 },
      prefetchRing: 1,
      maxActiveChunks: 3,
    });

    for (let x = 1; x < 99; x += 4) {
      const delta = chunks.update({ minX: x, minY: 0, maxX: x, maxY: 0 });
      expect(delta.active).toHaveLength(3);
      expect(new Set(keys(delta.active)).size).toBe(3);
      expect(delta.telemetry.activeChunks).toBeLessThanOrEqual(3);
    }

    const telemetry = chunks.getTelemetry();
    expect(telemetry.peakActiveChunks).toBe(3);
    expect(telemetry.totalActivations).toBe(75);
    expect(telemetry.totalDeactivations).toBe(72);
    expect(telemetry.totalViewportDeactivations).toBe(72);
    expect(telemetry.totalBudgetEvictions).toBe(0);
  });

  it("distinguishes budget eviction from leaving the prefetch region", () => {
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 3, maxY: 0 },
      prefetchRing: 1,
      maxActiveChunks: 1,
    });
    chunks.update({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

    const moved = chunks.update({ minX: 1, minY: 0, maxX: 1, maxY: 0 });
    expect(moved.deactivated.map(({ key, reason }) => ({ key, reason }))).toEqual([
      { key: "0,0", reason: "budget" },
    ]);
    expect(moved.telemetry.totalBudgetEvictions).toBe(1);
    expect(moved.telemetry.totalViewportDeactivations).toBe(0);
  });

  it("clips targets to world bounds, clears explicitly, and validates input", () => {
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      prefetchRing: 1,
      maxActiveChunks: 9,
    });
    const clipped = chunks.update({ minX: -2, minY: -2, maxX: 0, maxY: 0 });
    expect(clipped.visibleRegion).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(keys(clipped.active)).toEqual(["0,0", "1,0", "0,1", "1,1"]);
    expect(chunks.isActive(0, 0)).toBe(true);

    const cleared = chunks.clear();
    expect(cleared.active).toEqual([]);
    expect(cleared.deactivated).toHaveLength(4);
    expect(cleared.deactivated.every(({ reason }) => reason === "outside-prefetch")).toBe(true);
    expect(chunks.getVisibleRegion()).toBeNull();

    expect(() => new ActiveChunkSet({
      worldBounds: { minX: 2, minY: 0, maxX: 1, maxY: 0 },
      prefetchRing: 0,
      maxActiveChunks: 1,
    })).toThrow(/minimums cannot exceed/);
    expect(() => new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      prefetchRing: -1,
      maxActiveChunks: 1,
    })).toThrow(/non-negative integer/);
    expect(() => chunks.update({ minX: 0.5, minY: 0, maxX: 1, maxY: 1 })).toThrow(/safe integer/);
  });
});
