import { describe, expect, it } from "vitest";
import {
  ChunkActivatedViewPool,
  ReferenceCountedResourceCache,
  presentationChunksForWorldBounds,
} from "../src/wayfinders/rendering/lifetime";

interface RecordFixture {
  readonly id: string;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly value: number;
}

interface ViewFixture {
  readonly serial: number;
  active: boolean;
  value: number;
  destroyed: boolean;
}

describe("chunk-activated presentation lifetime", () => {
  it("materializes only active chunks and never duplicates IDs under churn", () => {
    let serial = 0;
    const pool = new ChunkActivatedViewPool<string, RecordFixture, ViewFixture>({
      idOf: ({ id }) => id,
      chunkOf: ({ chunkX, chunkY }) => ({ x: chunkX, y: chunkY }),
      create: () => ({ serial: serial++, active: false, value: 0, destroyed: false }),
      update: (view, record) => { view.value = record.value; },
      activate: (view) => { view.active = true; },
      deactivate: (view) => { view.active = false; },
      destroy: (view) => { view.destroyed = true; },
      maxPooledViews: 2,
    });
    const records = Array.from({ length: 100 }, (_, index): RecordFixture => ({
      id: `marker-${index}`,
      chunkX: index,
      chunkY: 0,
      value: index,
    }));
    pool.sync(records);
    expect(pool.getTelemetry().createdViews).toBe(0);

    for (let x = 0; x < 100; x++) {
      pool.setActiveChunks([{ x, y: 0 }]);
      const telemetry = pool.getTelemetry();
      expect(telemetry.activeViews).toBe(1);
      expect(telemetry.retainedViews).toBeLessThanOrEqual(2);
    }

    expect(pool.getTelemetry()).toMatchObject({
      records: 100,
      activeChunks: 1,
      activeViews: 1,
      createdViews: 1,
      reusedViews: 99,
      activations: 100,
      deactivations: 99,
      peakActiveViews: 1,
      peakRetainedViews: 1,
    });
  });

  it("updates active records, releases removed records, and rejects duplicate identity", () => {
    const destroyed: number[] = [];
    let serial = 0;
    const pool = new ChunkActivatedViewPool<string, RecordFixture, ViewFixture>({
      idOf: ({ id }) => id,
      chunkOf: ({ chunkX, chunkY }) => ({ x: chunkX, y: chunkY }),
      create: () => ({ serial: serial++, active: false, value: 0, destroyed: false }),
      update: (view, record) => { view.value = record.value; },
      activate: (view) => { view.active = true; },
      deactivate: (view) => { view.active = false; },
      destroy: (view) => { view.destroyed = true; destroyed.push(view.serial); },
      maxPooledViews: 0,
    });
    pool.setActiveChunks([{ x: 2, y: 3 }]);
    pool.sync([{ id: "site", chunkX: 2, chunkY: 3, value: 1 }]);
    pool.sync([{ id: "site", chunkX: 2, chunkY: 3, value: 2 }]);
    expect(pool.getTelemetry()).toMatchObject({ activeViews: 1, createdViews: 1, activations: 1 });

    expect(() => pool.sync([
      { id: "site", chunkX: 2, chunkY: 3, value: 3 },
      { id: "site", chunkX: 2, chunkY: 3, value: 4 },
    ])).toThrow(/Duplicate presentation record ID/);
    expect(pool.getTelemetry().activeViews).toBe(1);

    pool.sync([]);
    expect(pool.getTelemetry()).toMatchObject({
      activeViews: 0,
      pooledViews: 0,
      deactivations: 1,
      destroyedViews: 1,
      poolEvictions: 1,
    });
    expect(destroyed).toEqual([0]);
  });

  it("maps camera bounds to stable inclusive chunk coordinates", () => {
    expect(presentationChunksForWorldBounds({
      minX: 1023,
      minY: 0,
      maxX: 2047,
      maxY: 1023,
    }, 1024)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });
});

describe("reference-counted presentation resources", () => {
  it("never evicts a leased resource and exposes a placeholder path when pinned", () => {
    const disposed: string[] = [];
    const cache = new ReferenceCountedResourceCache<string, { id: string }>({
      maxEntries: 1,
      maxWeight: 10,
      dispose: ({ id }) => disposed.push(id),
    });
    const first = cache.tryAcquire("island-a", 8, () => ({ id: "island-a" }));
    expect(first?.resource.id).toBe("island-a");
    expect(cache.tryAcquire("island-b", 8, () => ({ id: "island-b" }))).toBeUndefined();
    expect(disposed).toEqual([]);
    expect(cache.getTelemetry()).toMatchObject({ activeLeases: 1, deniedAcquisitions: 1 });

    first?.release();
    first?.release();
    const second = cache.tryAcquire("island-b", 8, () => ({ id: "island-b" }));
    expect(second?.resource.id).toBe("island-b");
    expect(disposed).toEqual(["island-a"]);
    expect(cache.getTelemetry()).toMatchObject({
      entries: 1,
      activeLeases: 1,
      evictions: 1,
      deniedAcquisitions: 1,
    });
  });

  it("shares one resource across leases and evicts idle entries by deterministic LRU", () => {
    const disposed: string[] = [];
    let creates = 0;
    const cache = new ReferenceCountedResourceCache<string, string>({
      maxEntries: 2,
      maxWeight: 20,
      dispose: (resource) => disposed.push(resource),
    });
    const a1 = cache.tryAcquire("a", 10, () => { creates++; return "a"; });
    const a2 = cache.tryAcquire("a", 10, () => { creates++; return "duplicate"; });
    expect(a2?.resource).toBe("a");
    expect(creates).toBe(1);
    a1?.release();
    a2?.release();
    const b = cache.tryAcquire("b", 10, () => "b");
    b?.release();
    cache.tryAcquire("c", 10, () => "c");

    expect(disposed).toEqual(["a"]);
    expect(cache.getTelemetry()).toMatchObject({
      entries: 2,
      retainedWeight: 20,
      cacheHits: 1,
      cacheMisses: 3,
      peakEntries: 2,
      peakWeight: 20,
    });
  });
});
