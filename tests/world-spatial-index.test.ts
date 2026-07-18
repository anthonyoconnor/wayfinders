import { describe, expect, it } from "vitest";
import {
  WorldSpatialIndex,
  type SpatialBounds,
  type SpatialEntityDescriptor,
} from "../src/wayfinders/world/spatial";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  WorldTopology,
} from "../src/wayfinders/world/WorldTopology";

interface TestDescriptor extends SpatialEntityDescriptor<string> {
  readonly label: string;
}

function descriptor(id: string, bounds: SpatialBounds, label = id): TestDescriptor {
  return Object.freeze({ id, bounds: Object.freeze(bounds), label });
}

function boundedTopology(chunkSize: number, width = 64, height = 64): WorldTopology {
  return new WorldTopology(width, height, 1, chunkSize, BOUNDED_WORLD_TOPOLOGY);
}

function wrappingTopology(chunkSize: number, width = 64, height = 64): WorldTopology {
  return new WorldTopology(width, height, 1, chunkSize, WRAPPING_WORLD_TOPOLOGY);
}

describe("WorldSpatialIndex", () => {
  it("bulk-builds deterministic point, bounds, radius, and nearby queries", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({ topology: boundedTopology(10) });
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
    const index = new WorldSpatialIndex<TestDescriptor>({ topology: boundedTopology(10) });
    index.add(descriptor("crossing", { minX: 9, minY: 9, maxX: 11, maxY: 11 }));

    expect(index.getMembership("crossing")).toEqual({
      entityId: "crossing",
      canonicalCentre: { x: 10, y: 10 },
      footprint: [{ minX: 9, minY: 9, maxX: 11, maxY: 11 }],
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
    const index = new WorldSpatialIndex<TestDescriptor>({ topology: boundedTopology(10) });
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
    const index = new WorldSpatialIndex<TestDescriptor>({ topology: boundedTopology(8) });
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
    const index = new WorldSpatialIndex<TestDescriptor>({ topology: boundedTopology(10) });
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

  it("splits seam and corner footprints and queries while returning one stable identity", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({
      topology: wrappingTopology(5, 20, 20),
    });
    index.build([
      descriptor("corner", { minX: 18, minY: 18, maxX: 21, maxY: 21 }),
      descriptor("east", { minX: 1, minY: 10, maxX: 1, maxY: 10 }),
      descriptor("west", { minX: 19, minY: 10, maxX: 19, maxY: 10 }),
    ]);

    expect(index.getMembership("corner")).toEqual({
      entityId: "corner",
      canonicalCentre: { x: 19.5, y: 19.5 },
      footprint: [
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        { minX: 18, minY: 0, maxX: 19, maxY: 1 },
        { minX: 0, minY: 18, maxX: 1, maxY: 19 },
        { minX: 18, minY: 18, maxX: 19, maxY: 19 },
      ],
      homeChunk: { x: 3, y: 3 },
      chunks: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
        { x: 3, y: 3 },
      ],
    });

    expect(index.queryPoint({ x: 20, y: 20 }).entities.map(({ id }) => id)).toEqual(["corner"]);
    const corner = index.queryBounds({ minX: -2, minY: -2, maxX: 1, maxY: 1 });
    expect(corner.entities.map(({ id }) => id)).toEqual(["corner"]);
    expect(corner.counters).toEqual({
      bucketsExamined: 4,
      bucketEntriesExamined: 4,
      entitiesExamined: 1,
      entitiesMatched: 1,
    });
    expect(index.queryRadius({ x: 0, y: 10 }, 1).entities.map(({ id }) => id))
      .toEqual(["east", "west"]);
    expect(index.queryNearby({ x: 0, y: 10 }, 1).entities.map(({ id }) => id))
      .toEqual(["east", "west"]);
    expect(index.queryChunk({ x: -1, y: -1 }).entities.map(({ id }) => id)).toEqual(["corner"]);
    expect(index.queryChunk({ x: 4, y: 4 }).entities.map(({ id }) => id)).toEqual(["corner"]);
  });

  it("normalizes negative sub-ulp point queries to the half-open wrapped seam", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({
      topology: wrappingTopology(5, 20, 20),
    });
    const seam = descriptor("seam", { minX: 0, minY: 7, maxX: 0, maxY: 7 });
    index.add(seam);

    expect(index.queryPoint({ x: -Number.EPSILON, y: 7 }).entities).toEqual([seam]);
  });

  it("deduplicates over-image queries and collapsed one- and two-cell axes", () => {
    const oneByTwo = new WorldSpatialIndex<TestDescriptor>({
      topology: wrappingTopology(1, 1, 2),
    });
    oneByTwo.build([
      descriptor("a", { minX: 0, minY: 0, maxX: 0, maxY: 0 }),
      descriptor("b", { minX: 0, minY: 1, maxX: 0, maxY: 1 }),
    ]);
    const overImage = oneByTwo.queryBounds({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(overImage.entities.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(overImage.counters).toEqual({
      bucketsExamined: 2,
      bucketEntriesExamined: 2,
      entitiesExamined: 2,
      entitiesMatched: 2,
    });
    expect(oneByTwo.queryChunk({ x: 12, y: -1 }).entities.map(({ id }) => id)).toEqual(["b"]);
    expect(() => oneByTwo.add(
      descriptor("oversized", { minX: 0, minY: 0, maxX: 1, maxY: 0 }),
    )).toThrow("strictly smaller");

    const twoByOne = new WorldSpatialIndex<TestDescriptor>({
      topology: wrappingTopology(1, 2, 1),
    });
    twoByOne.build([
      descriptor("left", { minX: 0, minY: 0, maxX: 0, maxY: 0 }),
      descriptor("right", { minX: 1, minY: 0, maxX: 1, maxY: 0 }),
    ]);
    expect(twoByOne.queryNearby({ x: 0, y: 0 }, 1).entities.map(({ id }) => id))
      .toEqual(["left", "right"]);
  });

  it("clips bounded regions without turning the asset context periodic", () => {
    const index = new WorldSpatialIndex<TestDescriptor>({
      topology: boundedTopology(5, 10, 10),
    });
    index.add(descriptor("edge", { minX: 0, minY: 0, maxX: 0, maxY: 0 }));

    expect(index.queryPoint({ x: -1, y: 0 }).entities).toEqual([]);
    expect(index.queryBounds({ minX: -2, minY: -2, maxX: 0, maxY: 0 }).entities)
      .toEqual([index.get("edge")]);
    expect(index.queryRadius({ x: -1, y: 0 }, 1).entities).toEqual([index.get("edge")]);
    expect(index.queryChunk({ x: -1, y: 0 }).entities).toEqual([]);
  });

  it("rejects invalid coordinates, IDs, bounds, and unsafe membership spans", () => {
    expect(() => boundedTopology(0)).toThrow("positive");
    const index = new WorldSpatialIndex<TestDescriptor>({
      topology: boundedTopology(10),
      maxChunksPerEntity: 4,
    });
    expect(() => index.add(descriptor("", { minX: 0, minY: 0, maxX: 0, maxY: 0 })))
      .toThrow("cannot be empty");
    expect(() => index.add(descriptor("backward", { minX: 2, minY: 0, maxX: 1, maxY: 0 })))
      .toThrow("minimums cannot exceed");
    expect(() => index.add(descriptor("huge", { minX: 0, minY: 0, maxX: 20, maxY: 20 })))
      .toThrow("intersects 9 chunks");
    expect(() => index.queryRadius({ x: 0, y: 0 }, -1)).toThrow("cannot be negative");
  });
});
