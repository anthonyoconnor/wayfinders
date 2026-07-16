import { describe, expect, it } from "vitest";

import {
  ActiveChunkSet,
  DEFAULT_ACTIVE_CHUNK_BUDGET,
} from "../../src/wayfinders/rendering/activation";

describe("P2 active-chunk presentation budget", () => {
  it("plateaus across a coast-to-coast viewport journey", () => {
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 11, maxY: 11 },
      prefetchRing: 1,
      maxActiveChunks: DEFAULT_ACTIVE_CHUNK_BUDGET,
    });
    const resources = new Map<string, Set<string>>([
      ["terrain", new Set()],
      ["knowledge", new Set()],
      ["forward-risk", new Set()],
      ["return-risk", new Set()],
      ["markers", new Set()],
      ["island-art", new Set()],
    ]);

    for (let x = 0; x <= 9; x++) {
      const delta = chunks.update({ minX: x, minY: 4, maxX: x + 2, maxY: 6 });
      for (const entry of delta.deactivated) {
        for (const resident of resources.values()) resident.delete(entry.key);
      }
      for (const entry of delta.activated) {
        for (const resident of resources.values()) resident.add(entry.key);
      }
      expect(delta.active.length).toBeLessThanOrEqual(DEFAULT_ACTIVE_CHUNK_BUDGET);
      expect(delta.deferred.filter(({ band }) => band === "visible")).toEqual([]);
      for (const resident of resources.values()) {
        expect(resident.size).toBe(delta.active.length);
        expect(resident.size).toBeLessThanOrEqual(DEFAULT_ACTIVE_CHUNK_BUDGET);
      }
    }

    expect(chunks.getTelemetry()).toMatchObject({
      capacity: 25,
      activeChunks: 20,
      peakActiveChunks: 25,
      visibleBudgetDeferredChunks: 0,
    });
  });
});
