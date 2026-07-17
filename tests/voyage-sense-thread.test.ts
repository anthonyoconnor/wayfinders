import { describe, expect, it } from "vitest";
import { buildVoyageSenseThread } from "../src/wayfinders/rendering/VoyageSenseThread";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";

describe("Voyage Sense thread geometry", () => {
  it("rounds cardinal turns within half an adjacent tile", () => {
    const world = new WorldGrid(4, 2, 2);
    const geometry = buildVoyageSenseThread(
      world,
      [world.index(0, 0), world.index(1, 0), world.index(1, 1)],
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
    const world = new WorldGrid(4, 1, 2);
    const geometry = buildVoyageSenseThread(
      world,
      [0, 1, 2, 3].map((x) => world.index(x, 0)),
      32,
      10,
      5,
    );

    expect(geometry.segments).toHaveLength(1);
    expect(geometry.segmentsByChunk.get("0,0")?.length).toBeGreaterThan(0);
    expect(geometry.segmentsByChunk.get("1,0")?.length).toBeGreaterThan(0);
    expect([...geometry.segmentsByChunk.keys()].sort()).toEqual(["0,0", "1,0"]);
  });

  it("produces no geometry for already-safe or unreachable empty routes", () => {
    const world = new WorldGrid(2, 2, 2);
    expect(buildVoyageSenseThread(world, [], 32, 10, 5).segments).toEqual([]);
    expect(buildVoyageSenseThread(world, [world.index(0, 0)], 32, 10, 5).segments).toEqual([]);
  });
});
