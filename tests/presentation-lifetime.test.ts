import { describe, expect, it } from "vitest";
import { ChunkActivatedViewPool } from "../src/wayfinders/rendering/lifetime";

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
});
