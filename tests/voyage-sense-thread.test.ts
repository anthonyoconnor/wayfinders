import { describe, expect, it } from "vitest";
import { buildVoyageSenseThread } from "../src/wayfinders/rendering/VoyageSenseThread";
import type { ReturnPathEdge } from "../src/wayfinders/exploration/ReturnPathSystem";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  type CardinalDirection,
} from "../src/wayfinders/world/WorldTopology";

function edgesForPath(world: WorldGrid, path: readonly number[]): ReturnPathEdge[] {
  const edges: ReturnPathEdge[] = [];
  let imageOffset = { x: 0, y: 0 };
  for (let index = 1; index < path.length; index++) {
    const fromIndex = path[index - 1]!;
    const toIndex = path[index]!;
    const from = world.pointFromIndex(fromIndex);
    const to = world.pointFromIndex(toIndex);
    const step = world.topology.cardinalSteps(from).find(({ point }) => (
      point.x === to.x && point.y === to.y
    ));
    if (!step) throw new Error("test path must use cardinal topology edges");
    const destinationImageOffset = {
      x: imageOffset.x + step.imageOffset.x,
      y: imageOffset.y + step.imageOffset.y,
    };
    edges.push({
      fromIndex,
      toIndex,
      direction: step.direction,
      imageOffset: step.imageOffset,
      destinationImageOffset,
      liftedFrom: { x: from.x + imageOffset.x, y: from.y + imageOffset.y },
      liftedTo: { x: to.x + destinationImageOffset.x, y: to.y + destinationImageOffset.y },
    });
    imageOffset = destinationImageOffset;
  }
  return edges;
}

describe("Voyage Sense thread geometry", () => {
  it("rounds cardinal turns within half an adjacent tile", () => {
    const world = new WorldGrid(4, 2, 2, BOUNDED_WORLD_TOPOLOGY);
    const geometry = buildVoyageSenseThread(
      world,
      edgesForPath(world, [world.index(0, 0), world.index(1, 0), world.index(1, 1)]),
      32,
      10,
      5,
    );

    expect(geometry.segments).toEqual([
      { kind: "line", from: { x: 16, y: 16 }, to: { x: 38, y: 16 } },
      {
        kind: "curve",
        from: { x: 38, y: 16 },
        control: { x: 48, y: 16 },
        to: { x: 48, y: 26 },
      },
      { kind: "line", from: { x: 48, y: 26 }, to: { x: 48, y: 48 } },
    ]);
  });

  it("indexes seam-crossing segments into both bounded chunk buckets", () => {
    const world = new WorldGrid(4, 1, 2, BOUNDED_WORLD_TOPOLOGY);
    const geometry = buildVoyageSenseThread(
      world,
      edgesForPath(world, [0, 1, 2, 3].map((x) => world.index(x, 0))),
      32,
      10,
      5,
    );

    expect(geometry.segments).toHaveLength(3);
    expect(geometry.segmentsByChunk.get("0,0")?.length).toBeGreaterThan(0);
    expect(geometry.segmentsByChunk.get("1,0")?.length).toBeGreaterThan(0);
    expect([...geometry.segmentsByChunk.keys()].sort()).toEqual(["0,0", "1,0"]);
  });

  it("produces no geometry for already-safe or unreachable empty routes", () => {
    const world = new WorldGrid(2, 2, 2, BOUNDED_WORLD_TOPOLOGY);
    expect(buildVoyageSenseThread(world, [], 32, 10, 5).segments).toEqual([]);
  });

  it("keeps width-two directional winding as adjacent image-local edges", () => {
    const world = new WorldGrid(2, 1, 1, WRAPPING_WORLD_TOPOLOGY);
    const first = world.index(0, 0);
    const second = world.index(1, 0);
    const east = 1 satisfies CardinalDirection;
    const edges: ReturnPathEdge[] = [{
      fromIndex: first,
      toIndex: second,
      direction: east,
      imageOffset: { x: 0, y: 0 },
      destinationImageOffset: { x: 0, y: 0 },
      liftedFrom: { x: 0, y: 0 },
      liftedTo: { x: 1, y: 0 },
    }, {
      fromIndex: second,
      toIndex: first,
      direction: east,
      imageOffset: { x: 2, y: 0 },
      destinationImageOffset: { x: 2, y: 0 },
      liftedFrom: { x: 1, y: 0 },
      liftedTo: { x: 2, y: 0 },
    }];

    const geometry = buildVoyageSenseThread(world, edges, 32, 10, 5);

    expect(geometry.segments).toHaveLength(2);
    expect(geometry.segments.every(({ from, to }) => Math.hypot(to.x - from.x, to.y - from.y) === 32))
      .toBe(true);
    expect([...geometry.segmentsByChunk.keys()].sort()).toEqual(["0,0", "1,0"]);
  });
});
