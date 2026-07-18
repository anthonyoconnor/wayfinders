import { NumericMinPriorityQueue } from "./PriorityQueue";

export interface DijkstraStart {
  node: number;
  cost?: number;
}

export type DijkstraNeighborVisitor = (
  neighbor: number,
  traversalCost: number,
  direction?: number,
  imageOffsetX?: number,
  imageOffsetY?: number,
) => void;

export interface DijkstraOptions {
  nodeCount: number;
  starts: readonly (DijkstraStart | number)[];
  maxCost?: number;
  /** Stop once this node is settled; its shortest cost and parent chain are then final. */
  target?: number;
  forEachNeighbor: (node: number, visit: DijkstraNeighborVisitor) => void;
  workspace?: DijkstraWorkspace;
}

export interface DijkstraResult {
  costs: Float64Array;
  parents: Int32Array;
  /** Direction selected from each parent to its child, or -1 without provenance. */
  parentDirections: Int8Array;
  /** Edge-local tile-coordinate offset selecting the child image next to its parent. */
  parentImageOffsetX: Int32Array;
  parentImageOffsetY: Int32Array;
  visited: Uint8Array;
  /** Settled nodes, packed into the first `settledCount` slots. */
  settledIndices: Int32Array;
  settledCount: number;
}

interface DijkstraBuffers {
  costs: Float64Array;
  parents: Int32Array;
  parentDirections: Int8Array;
  parentImageOffsetX: Int32Array;
  parentImageOffsetY: Int32Array;
  visited: Uint8Array;
  settledIndices: Int32Array;
}

/**
 * Retains the numeric heap and graph-sized typed buffers across searches.
 * Results backed by a workspace remain valid only until that workspace is
 * used again; callers that need longer-lived results should omit `workspace`.
 */
export class DijkstraWorkspace {
  readonly queue = new NumericMinPriorityQueue();
  private costs = new Float64Array(0);
  private parents = new Int32Array(0);
  private parentDirections = new Int8Array(0);
  private parentImageOffsetX = new Int32Array(0);
  private parentImageOffsetY = new Int32Array(0);
  private visited = new Uint8Array(0);
  private settledIndices = new Int32Array(0);
  private touched = new Uint8Array(0);
  private touchedIndices = new Int32Array(0);
  private touchedCount = 0;

  prepare(nodeCount: number): DijkstraBuffers {
    if (this.costs.length < nodeCount) {
      this.costs = new Float64Array(nodeCount);
      this.parents = new Int32Array(nodeCount);
      this.parentDirections = new Int8Array(nodeCount);
      this.parentImageOffsetX = new Int32Array(nodeCount);
      this.parentImageOffsetY = new Int32Array(nodeCount);
      this.visited = new Uint8Array(nodeCount);
      this.settledIndices = new Int32Array(nodeCount);
      this.touched = new Uint8Array(nodeCount);
      this.touchedIndices = new Int32Array(nodeCount);
      this.costs.fill(Number.POSITIVE_INFINITY);
      this.parents.fill(-1);
      this.parentDirections.fill(-1);
      this.touchedCount = 0;
    } else {
      for (let offset = 0; offset < this.touchedCount; offset++) {
        const index = this.touchedIndices[offset];
        this.costs[index] = Number.POSITIVE_INFINITY;
        this.parents[index] = -1;
        this.parentDirections[index] = -1;
        this.parentImageOffsetX[index] = 0;
        this.parentImageOffsetY[index] = 0;
        this.visited[index] = 0;
        this.touched[index] = 0;
      }
      this.touchedCount = 0;
    }

    return {
      costs: this.costs.subarray(0, nodeCount),
      parents: this.parents.subarray(0, nodeCount),
      parentDirections: this.parentDirections.subarray(0, nodeCount),
      parentImageOffsetX: this.parentImageOffsetX.subarray(0, nodeCount),
      parentImageOffsetY: this.parentImageOffsetY.subarray(0, nodeCount),
      visited: this.visited.subarray(0, nodeCount),
      settledIndices: this.settledIndices.subarray(0, nodeCount),
    };
  }

  markTouched(index: number): void {
    if (this.touched[index]) return;
    this.touched[index] = 1;
    this.touchedIndices[this.touchedCount++] = index;
  }
}

export function dijkstra(options: DijkstraOptions): DijkstraResult {
  const { nodeCount, starts, forEachNeighbor } = options;
  if (!Number.isInteger(nodeCount) || nodeCount <= 0) throw new RangeError("nodeCount must be a positive integer");
  if (
    options.target !== undefined
    && (!Number.isInteger(options.target) || options.target < 0 || options.target >= nodeCount)
  ) {
    throw new RangeError(`Target node ${options.target} is outside graph`);
  }

  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;
  if (Number.isNaN(maxCost) || maxCost < 0) {
    throw new RangeError("maxCost must be non-negative");
  }
  const workspace = options.workspace;
  const buffers = workspace?.prepare(nodeCount);
  const costs = buffers?.costs ?? new Float64Array(nodeCount);
  const parents = buffers?.parents ?? new Int32Array(nodeCount);
  const parentDirections = buffers?.parentDirections ?? new Int8Array(nodeCount);
  const parentImageOffsetX = buffers?.parentImageOffsetX ?? new Int32Array(nodeCount);
  const parentImageOffsetY = buffers?.parentImageOffsetY ?? new Int32Array(nodeCount);
  const visited = buffers?.visited ?? new Uint8Array(nodeCount);
  const settledIndices = buffers?.settledIndices ?? new Int32Array(nodeCount);
  let settledCount = 0;
  if (!buffers) {
    costs.fill(Number.POSITIVE_INFINITY);
    parents.fill(-1);
    parentDirections.fill(-1);
  }

  const queue = workspace?.queue ?? new NumericMinPriorityQueue();
  queue.clear();
  for (const start of starts) {
    const node = typeof start === "number" ? start : start.node;
    const cost = typeof start === "number" ? 0 : start.cost ?? 0;
    if (!Number.isInteger(node) || node < 0 || node >= nodeCount) {
      throw new RangeError(`Start node ${node} is outside graph`);
    }
    if (!Number.isFinite(cost) || cost < 0) throw new RangeError("Start costs must be finite and non-negative");
    if (cost > maxCost || cost >= costs[node]) continue;
    workspace?.markTouched(node);
    costs[node] = cost;
    queue.enqueue(node, cost);
  }

  let activeNode = -1;
  let activePriority = 0;
  const visit: DijkstraNeighborVisitor = (
    neighbor,
    traversalCost,
    direction,
    imageOffsetX = 0,
    imageOffsetY = 0,
  ): void => {
    if (!Number.isInteger(neighbor) || neighbor < 0 || neighbor >= nodeCount) {
      throw new RangeError(`Neighbor node ${neighbor} is outside graph`);
    }
    if (!Number.isFinite(traversalCost) || traversalCost < 0) {
      throw new RangeError("Dijkstra traversal costs must be finite and non-negative");
    }
    if (
      direction !== undefined
      && (!Number.isSafeInteger(direction) || direction < 0 || direction > 127)
    ) throw new RangeError("Dijkstra edge direction must fit in a non-negative Int8");
    if (!Number.isSafeInteger(imageOffsetX) || !Number.isSafeInteger(imageOffsetY)) {
      throw new RangeError("Dijkstra image offsets must be safe integers");
    }

    const nextCost = activePriority + traversalCost;
    if (nextCost > maxCost || nextCost >= costs[neighbor]) return;
    workspace?.markTouched(neighbor);
    costs[neighbor] = nextCost;
    parents[neighbor] = activeNode;
    parentDirections[neighbor] = direction ?? -1;
    parentImageOffsetX[neighbor] = imageOffsetX;
    parentImageOffsetY[neighbor] = imageOffsetY;
    queue.enqueue(neighbor, nextCost);
  };

  while (!queue.empty) {
    const node = queue.dequeueNode()!;
    const priority = queue.dequeuedPriority;
    if (priority !== costs[node]) continue;
    if (priority > maxCost) break;
    visited[node] = 1;
    settledIndices[settledCount++] = node;
    if (node === options.target) break;

    activeNode = node;
    activePriority = priority;
    forEachNeighbor(node, visit);
  }

  return {
    costs,
    parents,
    parentDirections,
    parentImageOffsetX,
    parentImageOffsetY,
    visited,
    settledIndices,
    settledCount,
  };
}

export function reconstructDijkstraPath(
  result: Pick<DijkstraResult, "visited" | "parents">,
  destination: number,
): number[] {
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

export interface ReconstructedDijkstraEdge {
  readonly from: number;
  readonly to: number;
  /** -1 when the caller used the endpoint-only Dijkstra API. */
  readonly direction: number;
  readonly imageOffsetX: number;
  readonly imageOffsetY: number;
}

/** Reconstructs the selected root-to-destination edges with exact provenance. */
export function reconstructDijkstraEdges(
  result: Pick<
    DijkstraResult,
    | "visited"
    | "parents"
    | "parentDirections"
    | "parentImageOffsetX"
    | "parentImageOffsetY"
  >,
  destination: number,
): ReconstructedDijkstraEdge[] {
  if (!result.visited[destination]) return [];
  const reversed: ReconstructedDijkstraEdge[] = [];
  const seen = new Set<number>();
  let child = destination;
  while (child >= 0 && !seen.has(child)) {
    seen.add(child);
    const parent = result.parents[child];
    if (parent < 0) break;
    reversed.push({
      from: parent,
      to: child,
      direction: result.parentDirections[child],
      imageOffsetX: result.parentImageOffsetX[child],
      imageOffsetY: result.parentImageOffsetY[child],
    });
    child = parent;
  }
  reversed.reverse();
  return reversed;
}
