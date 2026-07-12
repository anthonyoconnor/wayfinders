import { MinPriorityQueue } from "./PriorityQueue";

export interface DijkstraStart {
  node: number;
  cost?: number;
}

export interface DijkstraOptions {
  nodeCount: number;
  starts: readonly DijkstraStart[];
  maxCost?: number;
  forEachNeighbor: (node: number, visit: (neighbor: number, traversalCost: number) => void) => void;
}

export interface DijkstraResult {
  costs: Float64Array;
  parents: Int32Array;
  visited: Uint8Array;
}

export function dijkstra(options: DijkstraOptions): DijkstraResult {
  const { nodeCount, starts, forEachNeighbor } = options;
  if (!Number.isInteger(nodeCount) || nodeCount <= 0) throw new RangeError("nodeCount must be a positive integer");

  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;
  const costs = new Float64Array(nodeCount);
  const parents = new Int32Array(nodeCount);
  const visited = new Uint8Array(nodeCount);
  costs.fill(Number.POSITIVE_INFINITY);
  parents.fill(-1);

  const queue = new MinPriorityQueue<number>();
  for (const start of starts) {
    const cost = start.cost ?? 0;
    if (!Number.isInteger(start.node) || start.node < 0 || start.node >= nodeCount) {
      throw new RangeError(`Start node ${start.node} is outside graph`);
    }
    if (!Number.isFinite(cost) || cost < 0) throw new RangeError("Start costs must be finite and non-negative");
    if (cost > maxCost || cost >= costs[start.node]) continue;
    costs[start.node] = cost;
    queue.enqueue(start.node, cost);
  }

  while (!queue.empty) {
    const entry = queue.dequeue()!;
    const node = entry.value;
    if (entry.priority !== costs[node]) continue;
    if (entry.priority > maxCost) break;
    visited[node] = 1;

    forEachNeighbor(node, (neighbor, traversalCost) => {
      if (!Number.isInteger(neighbor) || neighbor < 0 || neighbor >= nodeCount) {
        throw new RangeError(`Neighbor node ${neighbor} is outside graph`);
      }
      if (!Number.isFinite(traversalCost) || traversalCost < 0) {
        throw new RangeError("Dijkstra traversal costs must be finite and non-negative");
      }

      const nextCost = entry.priority + traversalCost;
      if (nextCost > maxCost || nextCost >= costs[neighbor]) return;
      costs[neighbor] = nextCost;
      parents[neighbor] = node;
      queue.enqueue(neighbor, nextCost);
    });
  }

  return { costs, parents, visited };
}

export function reconstructDijkstraPath(result: DijkstraResult, destination: number): number[] {
  if (!result.visited[destination]) return [];
  const path: number[] = [];
  const seen = new Set<number>();
  let current = destination;
  while (current >= 0 && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    current = result.parents[current];
  }
  path.reverse();
  return path;
}
