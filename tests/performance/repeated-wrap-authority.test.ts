import { describe, expect, it } from "vitest";

import { makeConfig } from "../helpers";
import { createShipStateAtGrid, MovementSystem } from "../../src/wayfinders/navigation/MovementSystem";
import { KnowledgeState, TerrainType } from "../../src/wayfinders/world/TileData";
import { WorldGrid } from "../../src/wayfinders/world/WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY, WorldTopology } from "../../src/wayfinders/world/WorldTopology";
import {
  WorldSpatialIndex,
  type SpatialEntityDescriptor,
} from "../../src/wayfinders/world/spatial";

interface PointDescriptor extends SpatialEntityDescriptor<string> {
  readonly x: number;
  readonly y: number;
}

function descriptor(x: number, y: number): PointDescriptor {
  return Object.freeze({
    id: `${y.toString().padStart(3, "0")}:${x.toString().padStart(3, "0")}`,
    x,
    y,
    bounds: Object.freeze({ minX: x, minY: y, maxX: x, maxY: y }),
  });
}

describe("repeated-wrap authoritative work", () => {
  it("keeps movement traversal work identical on every lap", () => {
    const width = 64;
    const height = 48;
    const tileSize = 32;
    const laps = 64;
    const config = makeConfig({
      navigation: { tileSize, chunkSize: 8 },
      movement: { shipSpeed: 8, shipCollisionHalfExtent: 1 },
    });
    const world = new WorldGrid(width, height, 8, WRAPPING_WORLD_TOPOLOGY, tileSize);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const movement = new MovementSystem(world, config);
    const ship = createShipStateAtGrid({ x: 0, y: 7 }, 5, 0, config);
    const firstLap: Array<{
      readonly entered: readonly Readonly<{ x: number; y: number }>[];
      readonly segmentCount: number;
      readonly movedDistancePixels: number;
    }> = [];

    world.forEachTile = () => {
      throw new Error("normal movement must not scan the complete world");
    };

    for (let lap = 0; lap < laps; lap++) {
      for (let step = 0; step < width; step++) {
        const result = movement.update(ship, { turn: 0, throttle: 1 }, 1 / 8);
        const work = {
          entered: structuredClone(result.enteredTiles),
          segmentCount: result.segments.length,
          movedDistancePixels: result.movedDistancePixels,
        };
        expect(result.collided).toBe(false);
        expect(result.liftedDisplacement).toEqual({ x: tileSize, y: 0 });
        expect(result.enteredTiles).toHaveLength(1);
        expect(result.segments).toHaveLength(2);
        if (lap === 0) firstLap.push(work);
        else expect(work).toEqual(firstLap[step]);
      }
      expect(ship.currentTileX).toBe(0);
      expect(ship.currentTileY).toBe(7);
    }
  });

  it("keeps lifted seam queries within four local buckets and stable candidates", () => {
    const topology = new WorldTopology(128, 96, 1, 8, WRAPPING_WORLD_TOPOLOGY);
    const descriptors: PointDescriptor[] = [];
    for (let y = 0; y < topology.tileHeight; y += 4) {
      for (let x = 0; x < topology.tileWidth; x += 4) descriptors.push(descriptor(x, y));
    }
    const index = new WorldSpatialIndex<PointDescriptor>({ topology });
    index.build(descriptors);
    const baseline = index.queryRadius({ x: -0.25, y: -0.25 }, 2);
    const expectedIds = baseline.entities.map(({ id }) => id);

    expect(baseline.counters.bucketsExamined).toBeLessThanOrEqual(4);
    expect(baseline.counters.entitiesExamined).toBeLessThanOrEqual(16);
    for (let lap = 1; lap <= 2_000; lap++) {
      const query = index.queryRadius({
        x: lap * topology.tileWidth - 0.25,
        y: -lap * topology.tileHeight - 0.25,
      }, 2);
      expect(query.entities.map(({ id }) => id)).toEqual(expectedIds);
      expect(query.counters).toEqual(baseline.counters);
      expect(query.counters.bucketsExamined).toBeLessThanOrEqual(4);
      expect(query.counters.entitiesExamined).toBeLessThanOrEqual(16);
    }
  });
});
