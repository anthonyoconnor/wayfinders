import { describe, expect, it } from "vitest";
import {
  BOUNDED_WORLD_TOPOLOGY,
  CARDINAL_DIRECTIONS,
  WRAPPING_WORLD_TOPOLOGY,
  WorldTopology,
  type CanonicalTileBounds,
  type PeriodicChunkImage,
} from "../src/wayfinders/world/WorldTopology";

function tileKeysFromBounds(bounds: readonly Readonly<CanonicalTileBounds>[]): string[] {
  const keys: string[] = [];
  for (const piece of bounds) {
    for (let y = piece.minY; y <= piece.maxY; y++) {
      for (let x = piece.minX; x <= piece.maxX; x++) keys.push(`${x},${y}`);
    }
  }
  return keys;
}

function expectedWrappedTileKeys(
  topology: WorldTopology,
  bounds: Readonly<CanonicalTileBounds>,
): string[] {
  const keys = new Set<string>();
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const point = topology.normalizeTile(x, y);
      keys.add(`${point.x},${point.y}`);
    }
  }
  return [...keys].sort();
}

function imageKey(image: Readonly<PeriodicChunkImage>): string {
  return `${image.canonicalChunk.x},${image.canonicalChunk.y}`
    + `@${image.imageOffset.x},${image.imageOffset.y}`;
}

describe("WorldTopology", () => {
  it("normalizes negative, exact-span, and over-range coordinates on both non-square axes", () => {
    const topology = new WorldTopology(7, 5, 10, 3, WRAPPING_WORLD_TOPOLOGY);

    expect(topology.normalizeTile(-1, -1)).toEqual({ x: 6, y: 4 });
    expect(topology.normalizeTile(7, 5)).toEqual({ x: 0, y: 0 });
    expect(topology.normalizeTile(15, 12)).toEqual({ x: 1, y: 2 });
    expect(topology.normalizeTile(-15, -12)).toEqual({ x: 6, y: 3 });
    expect(topology.normalizeTile(-21, -10)).toEqual({ x: 0, y: 0 });
    expect(topology.normalizeWorld(-0.5, -0.25)).toEqual({ x: 69.5, y: 49.75 });
    expect(topology.normalizeWorld(-Number.EPSILON, -Number.EPSILON)).toEqual({ x: 0, y: 0 });
    expect(topology.normalizeWorld(70, 50)).toEqual({ x: 0, y: 0 });
    expect(topology.normalizeWorld(141.25, -101.5)).toEqual({ x: 1.25, y: 48.5 });

    for (let y = -17; y <= 17; y++) {
      for (let x = -23; x <= 23; x++) {
        const once = topology.normalizeTile(x, y);
        expect(topology.normalizeTile(once.x, once.y)).toEqual(once);
        expect(topology.isCanonicalTile(once.x, once.y)).toBe(true);
      }
    }
    for (const [x, y] of [
      [-210.5, -100.25],
      [-70, -50],
      [0, 0],
      [69.999, 49.999],
      [210.5, 100.25],
    ] as const) {
      const once = topology.normalizeWorld(x, y);
      expect(topology.normalizeWorld(once.x, once.y)).toEqual(once);
      expect(topology.isCanonicalWorld(once.x, once.y)).toBe(true);
    }
  });

  it("keeps bounded coordinates bounded instead of silently normalizing them", () => {
    const topology = new WorldTopology(7, 5, 10, 3, BOUNDED_WORLD_TOPOLOGY);

    expect(topology.canonicalizeTile(0, 0)).toEqual({ x: 0, y: 0 });
    expect(topology.canonicalizeTile(6, 4)).toEqual({ x: 6, y: 4 });
    expect(topology.canonicalizeTile(-1, 0)).toBeUndefined();
    expect(topology.canonicalizeTile(7, 0)).toBeUndefined();
    expect(topology.canonicalizeWorld(0, -0.01)).toBeUndefined();
    expect(topology.canonicalizeWorld(70, 0)).toBeUndefined();
    expect(() => topology.normalizeTile(0, 5)).toThrow(/outside the bounded world/);
    expect(() => topology.normalizeWorld(-0.01, 0)).toThrow(/outside the bounded world/);
  });

  it("uses signed minimum images and retains raw signs at exact half-span ties", () => {
    const topology = new WorldTopology(8, 6, 10, 4, WRAPPING_WORLD_TOPOLOGY);

    expect(topology.minimumImageTileDisplacement({ x: 0, y: 0 }, { x: 7, y: 5 }))
      .toEqual({ x: -1, y: -1 });
    expect(topology.minimumImageTileDisplacement({ x: 7, y: 5 }, { x: 0, y: 0 }))
      .toEqual({ x: 1, y: 1 });
    expect(topology.minimumImageTileDisplacement({ x: 0, y: 0 }, { x: 4, y: 3 }))
      .toEqual({ x: 4, y: 3 });
    expect(topology.minimumImageTileDisplacement({ x: 4, y: 3 }, { x: 0, y: 0 }))
      .toEqual({ x: -4, y: -3 });
    expect(topology.minimumImageTileDistanceSquared({ x: 0, y: 0 }, { x: 7, y: 5 })).toBe(2);

    expect(topology.minimumImageWorldDisplacement({ x: 0, y: 0 }, { x: 79, y: 59 }))
      .toEqual({ x: -1, y: -1 });
    expect(topology.minimumImageWorldDisplacement({ x: 0, y: 0 }, { x: 40, y: 30 }))
      .toEqual({ x: 40, y: 30 });
    expect(topology.minimumImageWorldDisplacement({ x: 40, y: 30 }, { x: 0, y: 0 }))
      .toEqual({ x: -40, y: -30 });
    expect(topology.minimumImageWorldDistanceSquared({ x: 0, y: 0 }, { x: 79, y: 59 })).toBe(2);
    expect(topology.nearestWorldImageOffset({ x: 1, y: 1 }, { x: 79, y: 59 }))
      .toEqual({ x: -80, y: -60 });
  });

  it("keeps cardinal directions stable and makes every directional edge symmetric", () => {
    expect(CARDINAL_DIRECTIONS.map(({ name }) => name))
      .toEqual(["west", "east", "north", "south"]);

    for (const [width, height] of [[1, 1], [1, 2], [2, 1], [2, 2], [5, 4]] as const) {
      const topology = new WorldTopology(width, height, 8, 3, WRAPPING_WORLD_TOPOLOGY);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const origin = { x, y };
          const steps = topology.cardinalSteps(origin);
          const directions = steps.map(({ direction }) => direction);
          expect(directions).toEqual([...directions].sort((left, right) => left - right));
          for (const step of steps) {
            const reverse = topology.stepCardinal(step.point, step.reverseDirection);
            expect(reverse).toBeDefined();
            expect(reverse?.point).toEqual(origin);
            expect(reverse?.reverseDirection).toBe(step.direction);
            expect(reverse?.imageOffset).toEqual({
              x: step.imageOffset.x === 0 ? 0 : -step.imageOffset.x,
              y: step.imageOffset.y === 0 ? 0 : -step.imageOffset.y,
            });
          }
        }
      }
    }

    const corner = new WorldTopology(5, 4, 8, 3, WRAPPING_WORLD_TOPOLOGY);
    expect(corner.cardinalSteps({ x: 0, y: 0 })).toEqual([
      { direction: 0, reverseDirection: 1, point: { x: 4, y: 0 }, imageOffset: { x: -5, y: 0 } },
      { direction: 1, reverseDirection: 0, point: { x: 1, y: 0 }, imageOffset: { x: 0, y: 0 } },
      { direction: 2, reverseDirection: 3, point: { x: 0, y: 3 }, imageOffset: { x: 0, y: -4 } },
      { direction: 3, reverseDirection: 2, point: { x: 0, y: 1 }, imageOffset: { x: 0, y: 0 } },
    ]);
  });

  it("preserves width- and height-two directional slots while unique queries deduplicate endpoints", () => {
    const single = new WorldTopology(1, 1, 8, 3, WRAPPING_WORLD_TOPOLOGY);
    expect(single.cardinalSteps({ x: 0, y: 0 })).toEqual([]);
    expect(single.uniqueCardinalNeighbors({ x: 0, y: 0 })).toEqual([]);
    expect(single.uniqueEightNeighbors({ x: 0, y: 0 })).toEqual([]);

    const twoWide = new WorldTopology(2, 1, 8, 3, WRAPPING_WORLD_TOPOLOGY);
    expect(twoWide.cardinalSteps({ x: 0, y: 0 })).toEqual([
      { direction: 0, reverseDirection: 1, point: { x: 1, y: 0 }, imageOffset: { x: -2, y: 0 } },
      { direction: 1, reverseDirection: 0, point: { x: 1, y: 0 }, imageOffset: { x: 0, y: 0 } },
    ]);
    expect(twoWide.uniqueCardinalNeighbors({ x: 0, y: 0 })).toEqual([{ x: 1, y: 0 }]);
    expect(twoWide.uniqueEightNeighbors({ x: 0, y: 0 })).toEqual([{ x: 1, y: 0 }]);

    const twoHigh = new WorldTopology(1, 2, 8, 3, WRAPPING_WORLD_TOPOLOGY);
    expect(twoHigh.cardinalSteps({ x: 0, y: 0 })).toEqual([
      { direction: 2, reverseDirection: 3, point: { x: 0, y: 1 }, imageOffset: { x: 0, y: -2 } },
      { direction: 3, reverseDirection: 2, point: { x: 0, y: 1 }, imageOffset: { x: 0, y: 0 } },
    ]);
    expect(twoHigh.uniqueCardinalNeighbors({ x: 0, y: 0 })).toEqual([{ x: 0, y: 1 }]);

    const twoByTwo = new WorldTopology(2, 2, 8, 3, WRAPPING_WORLD_TOPOLOGY);
    expect(twoByTwo.cardinalSteps({ x: 0, y: 0 })).toHaveLength(4);
    expect(twoByTwo.uniqueCardinalNeighbors({ x: 0, y: 0 }))
      .toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }]);
    expect(twoByTwo.uniqueEightNeighbors({ x: 0, y: 0 }))
      .toEqual([{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }]);
  });

  it("decomposes inclusive wrapped bounds into exact duplicate-free canonical coverage", () => {
    const topology = new WorldTopology(5, 4, 8, 3, WRAPPING_WORLD_TOPOLOGY);
    const violations: Array<{ bounds: CanonicalTileBounds; actual: string[]; expected: string[] }> = [];

    for (let minY = -5; minY <= 4; minY++) {
      for (let height = 1; height <= 5; height++) {
        for (let minX = -6; minX <= 5; minX++) {
          for (let width = 1; width <= 6; width++) {
            const bounds = {
              minX,
              minY,
              maxX: minX + width - 1,
              maxY: minY + height - 1,
            };
            const actualKeys = tileKeysFromBounds(topology.decomposeTileBounds(bounds));
            const actual = [...actualKeys].sort();
            const expected = expectedWrappedTileKeys(topology, bounds);
            if (
              new Set(actualKeys).size !== actualKeys.length
              || actual.length !== expected.length
              || actual.some((key, index) => key !== expected[index])
            ) violations.push({ bounds, actual, expected });
          }
        }
      }
    }
    expect(violations).toEqual([]);

    expect(topology.decomposeTileBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 }))
      .toEqual([
        { minX: 4, minY: 3, maxX: 4, maxY: 3 },
        { minX: 0, minY: 3, maxX: 1, maxY: 3 },
        { minX: 4, minY: 0, maxX: 4, maxY: 1 },
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      ]);
    expect(topology.decomposeTileBounds({ minX: 2, minY: 2, maxX: 1, maxY: 3 })).toEqual([]);
  });

  it("clips bounded intervals and applies mixed-axis topology independently", () => {
    const bounded = new WorldTopology(5, 4, 8, 3, BOUNDED_WORLD_TOPOLOGY);
    expect(bounded.decomposeTileBounds({ minX: -2, minY: -3, maxX: 2, maxY: 1 }))
      .toEqual([{ minX: 0, minY: 0, maxX: 2, maxY: 1 }]);
    expect(bounded.decomposeTileBounds({ minX: -9, minY: -9, maxX: 9, maxY: 9 }))
      .toEqual([{ minX: 0, minY: 0, maxX: 4, maxY: 3 }]);
    expect(bounded.decomposeTileBounds({ minX: 5, minY: 0, maxX: 8, maxY: 3 })).toEqual([]);

    const mixed = new WorldTopology(5, 4, 8, 3, { x: "wrap", y: "bounded" });
    expect(mixed.decomposeTileBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 }))
      .toEqual([
        { minX: 4, minY: 0, maxX: 4, maxY: 1 },
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      ]);
  });

  it("uses whole-world image offsets for periodic partial edge chunks", () => {
    const topology = new WorldTopology(5, 4, 10, 3, WRAPPING_WORLD_TOPOLOGY);
    expect(topology.chunkColumns).toBe(2);
    expect(topology.chunkRows).toBe(2);

    const images = topology.periodicChunkImagesForBounds({ minX: 4, minY: 3, maxX: 6, maxY: 4 });
    expect(images.map(imageKey)).toEqual([
      "1,1@0,0",
      "0,1@50,0",
      "1,0@0,40",
      "0,0@50,40",
    ]);
    expect(new Set(images.map(imageKey)).size).toBe(images.length);
    expect(images.every(({ imageOffset }) => (
      imageOffset.x % topology.pixelWidth === 0
      && imageOffset.y % topology.pixelHeight === 0
    ))).toBe(true);
  });

  it("returns every periodic chunk image intersecting a wrapped corner in stable order", () => {
    const topology = new WorldTopology(8, 8, 10, 4, WRAPPING_WORLD_TOPOLOGY);
    const images = topology.periodicChunkImagesForBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 });

    expect(images.map(imageKey)).toEqual([
      "1,1@-80,-80",
      "0,1@0,-80",
      "1,0@-80,0",
      "0,0@0,0",
    ]);
    expect(new Set(images.map(imageKey)).size).toBe(images.length);
  });
});
