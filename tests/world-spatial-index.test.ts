import { describe, expect, it } from "vitest";
import {
  WorldSpatialIndex,
  type SpatialBounds,
  type SpatialEntityDescriptor,
} from "../src/wayfinders/world/spatial";

interface TestDescriptor extends SpatialEntityDescriptor<string> {
  readonly label: string;
}

function descriptor(id: string, bounds: SpatialBounds, label = id): TestDescriptor {
  return Object.freeze({ id, bounds: Object.freeze(bounds), label });
}

describe("WorldSpatialIndex", () => {
  it("bulk-builds deterministic point, bounds, radius, and nearby queries", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({ chunkSize: 10 });
    const built = index.build([
      descriptor("z-far", { minX: 18, minY: 0, maxX: 20, maxY: 2 }),
      descriptor("c-wide", { minX: 9, minY: 9, maxX: 11, maxY: 11 }),
      descriptor("b-near", { minX: 6, minY: 0, maxX: 6, maxY: 0 }),
      descriptor("a-near", { minX: 0, minY: 6, maxX: 0, maxY: 6 }),
      descriptor("origin", { minX: 0, minY: 0, maxX: 0, maxY: 0 }),
    ]);

    expect(built.kind).toBe("built");
    expect(built.previousRevision).toBe(0);
    expect(built.revision).toBe(1);
    expect(built.changedEntityIds).toEqual(["a-near", "b-near", "c-wide", "origin", "z-far"]);
    expect(index.getAll().map(({ id }) => id)).toEqual([
      "a-near",
      "b-near",
      "c-wide",
      "origin",
      "z-far",
    ]);

    expect(index.queryPoint({ x: 10, y: 10 }).entities.map(({ id }) => id)).toEqual(["c-wide"]);
    expect(index.queryBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }).entities.map(({ id }) => id))
      .toEqual(["a-near", "b-near", "c-wide", "origin"]);
    expect(index.queryRadius({ x: 0, y: 0 }, 6).entities.map(({ id }) => id))
      .toEqual(["a-near", "b-near", "origin"]);
    expect(index.queryNearby({ x: 0, y: 0 }, 20, 3).entities.map(({ id }) => id))
      .toEqual(["origin", "a-near", "b-near"]);
  });

  it("publishes stable home and intersecting chunk membership", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({ chunkSize: 10 });
    index.add(descriptor("crossing", { minX: 9, minY: 9, maxX: 11, maxY: 11 }));

    expect(index.getMembership("crossing")).toEqual({
      entityId: "crossing",
      homeChunk: { x: 1, y: 1 },
      chunks: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    });
    expect(index.queryChunk({ x: 0, y: 1 }).entities.map(({ id }) => id)).toEqual(["crossing"]);
    expect(index.queryChunk({ x: 2, y: 1 }).entities).toEqual([]);
  });

  it("adds, updates, and removes with revisioned entity and chunk invalidation", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({ chunkSize: 10 });
    const first = descriptor("site", { minX: 1, minY: 1, maxX: 1, maxY: 1 }, "first");
    const added = index.add(first);
    expect(added).toMatchObject({
      kind: "added",
      previousRevision: 0,
      revision: 1,
      changedEntityIds: ["site"],
      changedChunks: [{ x: 0, y: 0 }],
    });

    const unchanged = index.update(first);
    expect(unchanged).toEqual({
      kind: "none",
      previousRevision: 1,
      revision: 1,
      changedEntityIds: [],
      changedChunks: [],
    });

    const moved = descriptor("site", { minX: 21, minY: 1, maxX: 21, maxY: 1 }, "moved");
    const updated = index.update("site", moved);
    expect(updated).toMatchObject({
      kind: "updated",
      previousRevision: 1,
      revision: 2,
      changedEntityIds: ["site"],
      changedChunks: [{ x: 0, y: 0 }, { x: 2, y: 0 }],
    });
    expect(index.queryPoint({ x: 1, y: 1 }).entities).toEqual([]);
    expect(index.queryPoint({ x: 21, y: 1 }).entities).toEqual([moved]);

    const removed = index.remove("site");
    expect(removed).toMatchObject({
      kind: "removed",
      previousRevision: 2,
      revision: 3,
      changedEntityIds: ["site"],
      changedChunks: [{ x: 2, y: 0 }],
    });
    expect(index.remove("site").kind).toBe("none");
    expect(index.revision).toBe(3);
  });

  it("validates bulk builds transactionally and keeps IDs stable", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({ chunkSize: 8 });
    const retained = descriptor("retained", { minX: 2, minY: 2, maxX: 2, maxY: 2 });
    index.build([retained]);

    expect(() => index.build([
      descriptor("duplicate", { minX: 0, minY: 0, maxX: 0, maxY: 0 }),
      descriptor("duplicate", { minX: 8, minY: 8, maxX: 8, maxY: 8 }),
    ])).toThrow("Duplicate spatial entity ID duplicate");
    expect(index.revision).toBe(1);
    expect(index.getAll()).toEqual([retained]);

    expect(() => index.update(
      "retained",
      descriptor("replacement-id", { minX: 2, minY: 2, maxX: 2, maxY: 2 }),
    )).toThrow("ID cannot change");
    expect(() => index.add(descriptor("retained", retained.bounds))).toThrow("Duplicate spatial entity ID retained");
    expect(index.revision).toBe(1);
  });

  it("reports per-query and resettable aggregate work counters", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({ chunkSize: 10 });
    index.build([
      descriptor("wide", { minX: 5, minY: 5, maxX: 15, maxY: 15 }),
      descriptor("point", { minX: 7, minY: 7, maxX: 7, maxY: 7 }),
    ]);
    index.resetQueryTotals();

    const result = index.queryRadius({ x: 10, y: 10 }, 1);
    expect(result.entities.map(({ id }) => id)).toEqual(["wide"]);
    expect(result.counters).toEqual({
      bucketsExamined: 4,
      bucketEntriesExamined: 5,
      entitiesExamined: 2,
      entitiesMatched: 1,
    });
    expect(index.getQueryTotals()).toEqual({ queryCount: 1, ...result.counters });

    index.queryChunk({ x: 9, y: 9 });
    expect(index.getQueryTotals().queryCount).toBe(2);
    index.resetQueryTotals();
    expect(index.getQueryTotals()).toEqual({
      queryCount: 0,
      bucketsExamined: 0,
      bucketEntriesExamined: 0,
      entitiesExamined: 0,
      entitiesMatched: 0,
    });
  });

  it("rejects invalid coordinates, IDs, bounds, and unsafe membership spans", () => {
    expect(() => new WorldSpatialIndex<TestDescriptor>({ chunkSize: 0 })).toThrow("greater than zero");
    const index = new WorldSpatialIndex<TestDescriptor>({ chunkSize: 10, maxChunksPerEntity: 4 });
    expect(() => index.add(descriptor("", { minX: 0, minY: 0, maxX: 0, maxY: 0 })))
      .toThrow("cannot be empty");
    expect(() => index.add(descriptor("backward", { minX: 2, minY: 0, maxX: 1, maxY: 0 })))
      .toThrow("minimums cannot exceed");
    expect(() => index.add(descriptor("huge", { minX: 0, minY: 0, maxX: 20, maxY: 20 })))
      .toThrow("intersects 9 chunks");
    expect(() => index.queryRadius({ x: 0, y: 0 }, -1)).toThrow("cannot be negative");
  });
});
