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
  imageOffsetX: number;
  imageOffsetY: number;
}

describe("chunk-activated presentation lifetime", () => {
  it("materializes only active chunks and never duplicates IDs under churn", () => {
    let serial = 0;
    const pool = new ChunkActivatedViewPool<string, RecordFixture, ViewFixture>({
      idOf: ({ id }) => id,
      chunkOf: ({ chunkX, chunkY }) => ({ x: chunkX, y: chunkY }),
      create: () => ({
        serial: serial++, active: false, value: 0, destroyed: false, imageOffsetX: 0, imageOffsetY: 0,
      }),
      update: (view, record, image) => {
        view.value = record.value;
        view.imageOffsetX = image.imageOffset.x;
        view.imageOffsetY = image.imageOffset.y;
      },
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
      pool.setActiveChunkImages([{
        viewKey: `${x},0@0,0`,
        canonicalChunk: { x, y: 0 },
        imageOffset: { x: 0, y: 0 },
      }]);
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
      create: () => ({
        serial: serial++, active: false, value: 0, destroyed: false, imageOffsetX: 0, imageOffsetY: 0,
      }),
      update: (view, record) => { view.value = record.value; },
      activate: (view) => { view.active = true; },
      deactivate: (view) => { view.active = false; },
      destroy: (view) => { view.destroyed = true; destroyed.push(view.serial); },
      maxPooledViews: 0,
    });
    pool.setActiveChunkImages([{
      viewKey: "2,3@0,0",
      canonicalChunk: { x: 2, y: 3 },
      imageOffset: { x: 0, y: 0 },
    }]);
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

  it("materializes independent aliases for one canonical record and releases them by view identity", () => {
    const activeOffsets: number[] = [];
    const pool = new ChunkActivatedViewPool<string, RecordFixture, ViewFixture>({
      idOf: ({ id }) => id,
      chunkOf: ({ chunkX, chunkY }) => ({ x: chunkX, y: chunkY }),
      create: () => ({
        serial: activeOffsets.length,
        active: false,
        value: 0,
        destroyed: false,
        imageOffsetX: 0,
        imageOffsetY: 0,
      }),
      update: (view, record, image) => {
        view.value = record.value;
        view.imageOffsetX = image.imageOffset.x;
        view.imageOffsetY = image.imageOffset.y;
      },
      activate: (view) => { view.active = true; },
      deactivate: (view) => { view.active = false; },
      destroy: (view) => { view.destroyed = true; },
      maxPooledViews: 2,
    });
    pool.sync([{ id: "seam-marker", chunkX: 0, chunkY: 0, value: 7 }]);
    pool.setActiveChunkImages([{
      viewKey: "0,0@0,0",
      canonicalChunk: { x: 0, y: 0 },
      imageOffset: { x: 0, y: 0 },
    }, {
      viewKey: "0,0@128,-96",
      canonicalChunk: { x: 0, y: 0 },
      imageOffset: { x: 128, y: -96 },
    }]);
    pool.forEachActive((view) => activeOffsets.push(view.imageOffsetX, view.imageOffsetY));

    expect(activeOffsets).toEqual([0, 0, 128, -96]);
    expect(pool.getTelemetry()).toMatchObject({ records: 1, activeChunks: 2, activeViews: 2 });

    pool.setActiveChunkImages([{
      viewKey: "0,0@128,-96",
      canonicalChunk: { x: 0, y: 0 },
      imageOffset: { x: 128, y: -96 },
    }]);
    expect(pool.getTelemetry()).toMatchObject({
      records: 1,
      activeChunks: 1,
      activeViews: 1,
      pooledViews: 1,
      deactivations: 1,
    });
  });
});
