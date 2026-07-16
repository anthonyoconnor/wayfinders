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

  it("resumes with an exact work cap and preserves synchronous queue order", () => {
    const edges = new Map<number, Array<readonly [number, number]>>();
    for (let node = 0; node < 32; node++) {
      const neighbors: Array<readonly [number, number]> = [];
      if (node + 1 < 32) neighbors.push([node + 1, 1]);
      if (node + 5 < 32) neighbors.push([node + 5, 2]);
      edges.set(node, neighbors);
    }
    const options = {
      nodeCount: 32,
      start: 0,
      maxCostUnits: 12,
      unitScale: 1,
      forEachNeighbor: (
        node: number,
        visit: (neighbor: number, costUnits: number) => void,
      ) => {
        for (const [neighbor, costUnits] of edges.get(node) ?? []) {
          visit(neighbor, costUnits);
        }
      },
    };
    const expected = new BucketedCostSearchWorkspace().search(options);
    const workspace = new BucketedCostSearchWorkspace();
    workspace.reserve(32, 12);
    workspace.begin(options);

    let result;
    for (let stepCount = 0; stepCount < 1_000; stepCount++) {
      const step = workspace.step({ maxWorkUnits: 3 });
      expect(step.workUnits).toBeLessThanOrEqual(3);
      if (step.status === "complete") {
        result = step.result;
        break;
      }
    }

    expect(result).toBeDefined();
    expect(result!.settledCount).toBe(expected.settledCount);
    expect([...result!.settledIndices.slice(0, result!.settledCount)]).toEqual(
      [...expected.settledIndices.slice(0, expected.settledCount)],
    );
    expect([...result!.costs]).toEqual([...expected.costs]);
  });

  it("cleans a cancelled partial run before starting the newest run", () => {
    const workspace = new BucketedCostSearchWorkspace();
    const options = (start: number) => ({
      nodeCount: 12,
      start,
      maxCostUnits: 11,
      unitScale: 1,
      forEachNeighbor: (node: number, visit: (neighbor: number, cost: number) => void) => {
        if (node > 0) visit(node - 1, 1);
        if (node + 1 < 12) visit(node + 1, 1);
      },
    });
    workspace.begin(options(0));
    expect(workspace.step({ maxWorkUnits: 4 }).status).toBe("pending");
    workspace.cancel();
    workspace.begin(options(11));

    let actual;
    for (let index = 0; index < 100; index++) {
      const step = workspace.step({ maxWorkUnits: 2 });
      if (step.status === "complete") {
        actual = step.result;
        break;
      }
    }
    const expected = new BucketedCostSearchWorkspace().search(options(11));
    expect([...actual!.costs]).toEqual([...expected.costs]);
    expect([...actual!.settledIndices.slice(0, actual!.settledCount)]).toEqual(
      [...expected.settledIndices.slice(0, expected.settledCount)],
    );
  });
});
