import { describe, expect, it } from "vitest";
import {
  WorldSpatialIndex,
  type SpatialBounds,
  type SpatialEntityDescriptor,
} from "../../src/wayfinders/world/spatial";
import {
  WRAPPING_WORLD_TOPOLOGY,
  WorldTopology,
} from "../../src/wayfinders/world/WorldTopology";

interface PointDescriptor extends SpatialEntityDescriptor<string> {
  readonly pointX: number;
  readonly pointY: number;
}

function pointDescriptor(x: number, y: number): PointDescriptor {
  const id = `${y.toString().padStart(3, "0")}:${x.toString().padStart(3, "0")}`;
  return Object.freeze({
    id,
    pointX: x,
    pointY: y,
    bounds: Object.freeze({ minX: x, minY: y, maxX: x, maxY: y }),
  });
}

function minimumImageAxis(delta: number, span: number): number {
  let result = delta % span;
  if (Math.abs(result) > span / 2) result += result > 0 ? -span : span;
  return result;
}

function distanceSquared(
  centre: Readonly<{ x: number; y: number }>,
  descriptor: PointDescriptor,
  topology: WorldTopology,
): number {
  const dx = minimumImageAxis(descriptor.pointX - centre.x, topology.tileWidth);
  const dy = minimumImageAxis(descriptor.pointY - centre.y, topology.tileHeight);
  return dx * dx + dy * dy;
}

function periodicAxisContains(
  point: number,
  minimum: number,
  maximum: number,
  span: number,
): boolean {
  if (maximum - minimum >= span) return true;
  return Math.ceil((minimum - point) / span) <= Math.floor((maximum - point) / span);
}

function periodicBoundsContains(
  descriptor: PointDescriptor,
  bounds: Readonly<SpatialBounds>,
  topology: WorldTopology,
): boolean {
  return periodicAxisContains(descriptor.pointX, bounds.minX, bounds.maxX, topology.tileWidth)
    && periodicAxisContains(descriptor.pointY, bounds.minY, bounds.maxY, topology.tileHeight);
}

describe("WorldSpatialIndex periodic scale oracle", () => {
  it("matches brute force while local seam work stays bounded by local buckets", () => {
    const topology = new WorldTopology(128, 96, 1, 8, WRAPPING_WORLD_TOPOLOGY);
    const descriptors: PointDescriptor[] = [];
    for (let y = 0; y < topology.tileHeight; y += 4) {
      for (let x = 0; x < topology.tileWidth; x += 4) descriptors.push(pointDescriptor(x, y));
    }
    const index = new WorldSpatialIndex<PointDescriptor>({ topology });
    index.build(descriptors.slice().reverse());

    const seam = index.queryRadius({ x: 0, y: 0 }, 2);
    expect(seam.counters.bucketsExamined).toBe(4);
    expect(seam.counters.entitiesExamined).toBeLessThanOrEqual(16);
    expect(seam.counters.entitiesExamined).toBeLessThan(descriptors.length / 16);

    for (let queryIndex = 0; queryIndex < 64; queryIndex++) {
      const centre = {
        x: (queryIndex * 37 + 0.25) % topology.tileWidth,
        y: (queryIndex * 29 + 0.75) % topology.tileHeight,
      };
      const radius = 1 + (queryIndex % 11);
      const expectedRadius = descriptors
        .filter((descriptor) => distanceSquared(centre, descriptor, topology) <= radius * radius)
        .map(({ id }) => id)
        .sort();
      expect(index.queryRadius(centre, radius).entities.map(({ id }) => id)).toEqual(expectedRadius);

      const expectedNearby = descriptors
        .map((descriptor) => ({ descriptor, distance: distanceSquared(centre, descriptor, topology) }))
        .filter(({ distance }) => distance <= radius * radius)
        .sort((left, right) => left.distance - right.distance || left.descriptor.id.localeCompare(right.descriptor.id))
        .slice(0, 7)
        .map(({ descriptor }) => descriptor.id);
      expect(index.queryNearby(centre, radius, 7).entities.map(({ id }) => id)).toEqual(expectedNearby);

      const bounds = {
        minX: centre.x - 3,
        minY: centre.y - 2,
        maxX: centre.x + 3,
        maxY: centre.y + 2,
      };
      const expectedBounds = descriptors
        .filter((descriptor) => periodicBoundsContains(descriptor, bounds, topology))
        .map(({ id }) => id)
        .sort();
      expect(index.queryBounds(bounds).entities.map(({ id }) => id)).toEqual(expectedBounds);
    }

    const overImage = index.queryBounds({ minX: -256, minY: -192, maxX: 256, maxY: 192 });
    expect(overImage.entities).toHaveLength(descriptors.length);
    expect(overImage.counters).toEqual({
      bucketsExamined: topology.chunkColumns * topology.chunkRows,
      bucketEntriesExamined: descriptors.length,
      entitiesExamined: descriptors.length,
      entitiesMatched: descriptors.length,
    });
  });
});
