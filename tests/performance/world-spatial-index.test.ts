import { describe, expect, it } from "vitest";
import {
  WorldSpatialIndex,
  type SpatialEntityDescriptor,
} from "../../src/wayfinders/world/spatial";

interface StressDescriptor extends SpatialEntityDescriptor<string> {
  readonly ordinal: number;
}

describe("WorldSpatialIndex bounded nearby work", () => {
  it("keeps local-query work independent of a 500-descriptor world total", () => {
    const descriptors: StressDescriptor[] = [];
    for (let row = 0; row < 20; row++) {
      for (let column = 0; column < 25; column++) {
        const ordinal = row * 25 + column;
        const x = column * 32 + 4;
        const y = row * 32 + 4;
        descriptors.push({
          id: `site-${String(ordinal).padStart(3, "0")}`,
          ordinal,
          bounds: { minX: x, minY: y, maxX: x, maxY: y },
        });
      }
    }

    const index = new WorldSpatialIndex<StressDescriptor>({ chunkSize: 16 });
    index.build([...descriptors].reverse());
    expect(index.size).toBe(500);
    index.resetQueryTotals();

    let maximumBucketsExamined = 0;
    let maximumEntitiesExamined = 0;
    for (let sample = 0; sample < 100; sample++) {
      const ordinal = (sample * 137) % descriptors.length;
      const target = descriptors[ordinal];
      const result = index.queryNearby(
        { x: target.bounds.minX, y: target.bounds.minY },
        6,
        4,
      );
      expect(result.entities.map(({ id }) => id)).toEqual([target.id]);
      maximumBucketsExamined = Math.max(maximumBucketsExamined, result.counters.bucketsExamined);
      maximumEntitiesExamined = Math.max(maximumEntitiesExamined, result.counters.entitiesExamined);
    }

    expect(maximumBucketsExamined).toBeLessThanOrEqual(4);
    expect(maximumEntitiesExamined).toBeLessThanOrEqual(1);
    expect(index.getQueryTotals()).toMatchObject({
      queryCount: 100,
      entitiesExamined: 100,
      entitiesMatched: 100,
    });
  });
});
