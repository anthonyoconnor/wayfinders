import { describe, expect, it } from "vitest";

import {
  ActiveChunkSet,
  DEFAULT_ACTIVE_CHUNK_BUDGET,
} from "../../src/wayfinders/rendering/activation";
import { WorldTopology, WRAPPING_WORLD_TOPOLOGY } from "../../src/wayfinders/world/WorldTopology";

describe("P2 periodic active-chunk presentation budget", () => {
  it("enumerates local image demand without scanning a multi-billion-chunk world", () => {
    const topology = new WorldTopology(2_000_003, 1_500_001, 1, 32, WRAPPING_WORLD_TOPOLOGY);
    expect(topology.chunkColumns * topology.chunkRows).toBeGreaterThan(2_000_000_000);

    const images = topology.periodicChunkImagesForBounds({
      minX: topology.tileWidth - 1,
      minY: topology.tileHeight - 1,
      maxX: topology.tileWidth,
      maxY: topology.tileHeight,
    });
    expect(images).toEqual([
      { canonicalChunk: { x: topology.chunkColumns - 1, y: topology.chunkRows - 1 }, imageOffset: { x: 0, y: 0 } },
      { canonicalChunk: { x: 0, y: topology.chunkRows - 1 }, imageOffset: { x: topology.pixelWidth, y: 0 } },
      { canonicalChunk: { x: topology.chunkColumns - 1, y: 0 }, imageOffset: { x: 0, y: topology.pixelHeight } },
      { canonicalChunk: { x: 0, y: 0 }, imageOffset: { x: topology.pixelWidth, y: topology.pixelHeight } },
    ]);
  });

  it("plateaus across repeated lifted circumnavigations", () => {
    const topology = new WorldTopology(384, 384, 32, 32, WRAPPING_WORLD_TOPOLOGY);
    const chunks = new ActiveChunkSet({
      topology,
      prefetchRing: 1,
      maxActiveChunks: DEFAULT_ACTIVE_CHUNK_BUDGET,
    });
    const resources = new Map<string, Set<string>>([
      ["terrain-aliases", new Set()],
      ["knowledge-aliases", new Set()],
      ["forward-risk-aliases", new Set()],
      ["return-risk-aliases", new Set()],
      ["markers", new Set()],
      ["island-art-aliases", new Set()],
    ]);

    for (let liftedChunkX = -24; liftedChunkX <= 36; liftedChunkX++) {
      const minX = liftedChunkX * topology.chunkSize;
      const delta = chunks.update({
        minX,
        minY: 4 * topology.chunkSize,
        maxX: minX + 3 * topology.chunkSize - 1,
        maxY: 7 * topology.chunkSize - 1,
      });
      for (const entry of delta.deactivated) {
        for (const resident of resources.values()) resident.delete(entry.viewKey);
      }
      for (const entry of delta.activated) {
        for (const resident of resources.values()) resident.add(entry.viewKey);
      }
      expect(delta.active).toHaveLength(DEFAULT_ACTIVE_CHUNK_BUDGET);
      expect(delta.deferred.filter(({ band }) => band === "visible")).toEqual([]);
      expect(new Set(delta.active.map(({ viewKey }) => viewKey)).size).toBe(delta.active.length);
      for (const resident of resources.values()) {
        expect(resident.size).toBe(delta.active.length);
        expect(resident.size).toBeLessThanOrEqual(DEFAULT_ACTIVE_CHUNK_BUDGET);
      }
    }

    expect(chunks.getTelemetry()).toMatchObject({
      capacity: 25,
      activeChunks: 25,
      peakActiveChunks: 25,
      visibleBudgetDeferredChunks: 0,
    });
    for (const resident of resources.values()) expect(resident.size).toBe(25);
  });

  it("caps many aliases of one tiny canonical chunk", () => {
    const topology = new WorldTopology(1, 1, 32, 32, WRAPPING_WORLD_TOPOLOGY);
    const chunks = new ActiveChunkSet({
      topology,
      prefetchRing: 1,
      maxActiveChunks: DEFAULT_ACTIVE_CHUNK_BUDGET,
    });
    const delta = chunks.update({ minX: -2, minY: -2, maxX: 2, maxY: 2 });

    expect(delta.active).toHaveLength(25);
    expect(delta.deferred.length).toBeGreaterThan(0);
    expect(new Set(delta.active.map(({ viewKey }) => viewKey)).size).toBe(25);
    expect(new Set(delta.active.map(({ canonicalChunk }) => `${canonicalChunk.x},${canonicalChunk.y}`))).toEqual(
      new Set(["0,0"]),
    );
    expect(delta.telemetry.peakActiveChunks).toBe(DEFAULT_ACTIVE_CHUNK_BUDGET);
  });
});
