import { describe, expect, it } from "vitest";
import { BucketedCostSearchWorkspace } from "../src/wayfinders/navigation/BucketedCostSearch";
import { dijkstra } from "../src/wayfinders/navigation/Dijkstra";

describe("bucketed bounded-cost search", () => {
  it("matches generic Dijkstra with zero and fractional scaled costs", () => {
    const edges = new Map<number, Array<readonly [number, number]>>([
      [0, [[1, 0], [2, 2]]],
      [1, [[2, 1], [3, 2]]],
      [2, [[3, 1]]],
      [3, [[4, 2]]],
      [4, []],
    ]);
    const reference = dijkstra({
      nodeCount: 5,
      starts: [0],
      maxCost: 0.5,
      forEachNeighbor: (node, visit) => {
        for (const [neighbor, costUnits] of edges.get(node) ?? []) {
          visit(neighbor, costUnits / 10);
        }
      },
    });
    const actual = new BucketedCostSearchWorkspace().search({
      nodeCount: 5,
      start: 0,
      maxCostUnits: 5,
      unitScale: 10,
      forEachNeighbor: (node, visit) => {
        for (const [neighbor, costUnits] of edges.get(node) ?? []) {
          visit(neighbor, costUnits);
        }
      },
    });

    expect([...actual.costs]).toEqual([...reference.costs]);
    expect(new Set(actual.settledIndices.slice(0, actual.settledCount))).toEqual(
      new Set(reference.settledIndices.slice(0, reference.settledCount)),
    );
  });

  it("reuses its workspace without retaining the previous result", () => {
    const workspace = new BucketedCostSearchWorkspace();
    const run = (maximum: number) => workspace.search({
      nodeCount: 4,
      start: 0,
      maxCostUnits: maximum,
      unitScale: 1,
      forEachNeighbor: (node, visit) => {
        if (node + 1 < 4) visit(node + 1, 1);
      },
    });

    expect(run(3).settledCount).toBe(4);
    const limited = run(1);
    expect(limited.settledCount).toBe(2);
    expect(limited.costs[2]).toBe(Number.POSITIVE_INFINITY);
  });
});
