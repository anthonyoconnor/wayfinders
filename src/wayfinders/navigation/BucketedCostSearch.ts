const UNREACHED = 0x7fff_ffff;

export interface BucketedCostSearchOptions {
  readonly nodeCount: number;
  readonly start: number;
  readonly maxCostUnits: number;
  readonly unitScale: number;
  readonly forEachNeighbor: (
    node: number,
    visit: (neighbor: number, traversalCostUnits: number) => void,
  ) => void;
}

export interface BucketedCostSearchResult {
  readonly costs: Float64Array;
  readonly settledIndices: Int32Array;
  readonly settledCount: number;
}

/**
 * Reusable decrease-key Dial queue for bounded non-negative integer costs.
 * Forward guidance uses this only when all configured provision costs have an
 * exact small integer scale; arbitrary costs retain the generic Dijkstra path.
 */
export class BucketedCostSearchWorkspace {
  private costUnits = new Int32Array(0);
  private costs = new Float64Array(0);
  private settledIndices = new Int32Array(0);
  private next = new Int32Array(0);
  private previous = new Int32Array(0);
  private bucketOf = new Int32Array(0);
  private touched = new Uint8Array(0);
  private touchedIndices = new Int32Array(0);
  private touchedCount = 0;
  private bucketHeads = new Int32Array(0);

  search(options: BucketedCostSearchOptions): BucketedCostSearchResult {
    const { nodeCount, start, maxCostUnits, unitScale, forEachNeighbor } = options;
    if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
      throw new RangeError("nodeCount must be a positive integer");
    }
    if (!Number.isInteger(start) || start < 0 || start >= nodeCount) {
      throw new RangeError("start must identify a node");
    }
    if (!Number.isSafeInteger(maxCostUnits) || maxCostUnits < 0) {
      throw new RangeError("maxCostUnits must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(unitScale) || unitScale <= 0) {
      throw new RangeError("unitScale must be a positive safe integer");
    }
    this.prepare(nodeCount, maxCostUnits);
    this.touch(start);
    this.costUnits[start] = 0;
    this.costs[start] = 0;
    this.addToBucket(start, 0);

    let settledCount = 0;
    let activeNode = -1;
    let activeCost = 0;
    const visit = (neighbor: number, traversalCostUnits: number): void => {
      if (!Number.isInteger(neighbor) || neighbor < 0 || neighbor >= nodeCount) {
        throw new RangeError("neighbor must identify a node");
      }
      if (!Number.isSafeInteger(traversalCostUnits) || traversalCostUnits < 0) {
        throw new RangeError("traversalCostUnits must be a non-negative safe integer");
      }
      const nextCost = activeCost + traversalCostUnits;
      if (nextCost > maxCostUnits || nextCost >= this.costUnits[neighbor]) return;
      this.touch(neighbor);
      if (this.bucketOf[neighbor] >= 0) this.removeFromBucket(neighbor);
      this.costUnits[neighbor] = nextCost;
      this.costs[neighbor] = nextCost / unitScale;
      this.addToBucket(neighbor, nextCost);
    };

    for (let bucket = 0; bucket <= maxCostUnits; bucket++) {
      while (this.bucketHeads[bucket] >= 0) {
        const node = this.bucketHeads[bucket];
        this.removeFromBucket(node);
        this.settledIndices[settledCount++] = node;
        activeNode = node;
        activeCost = bucket;
        forEachNeighbor(activeNode, visit);
      }
    }

    return {
      costs: this.costs.subarray(0, nodeCount),
      settledIndices: this.settledIndices.subarray(0, nodeCount),
      settledCount,
    };
  }

  private prepare(nodeCount: number, maxCostUnits: number): void {
    if (this.costUnits.length < nodeCount) {
      this.costUnits = new Int32Array(nodeCount);
      this.costUnits.fill(UNREACHED);
      this.costs = new Float64Array(nodeCount);
      this.costs.fill(Number.POSITIVE_INFINITY);
      this.settledIndices = new Int32Array(nodeCount);
      this.next = new Int32Array(nodeCount);
      this.previous = new Int32Array(nodeCount);
      this.bucketOf = new Int32Array(nodeCount);
      this.bucketOf.fill(-1);
      this.touched = new Uint8Array(nodeCount);
      this.touchedIndices = new Int32Array(nodeCount);
      this.touchedCount = 0;
    } else {
      for (let position = 0; position < this.touchedCount; position++) {
        const node = this.touchedIndices[position];
        this.costUnits[node] = UNREACHED;
        this.costs[node] = Number.POSITIVE_INFINITY;
        this.bucketOf[node] = -1;
        this.touched[node] = 0;
      }
      this.touchedCount = 0;
    }
    if (this.bucketHeads.length <= maxCostUnits) {
      this.bucketHeads = new Int32Array(maxCostUnits + 1);
    }
    this.bucketHeads.subarray(0, maxCostUnits + 1).fill(-1);
  }

  private touch(node: number): void {
    if (this.touched[node] !== 0) return;
    this.touched[node] = 1;
    this.touchedIndices[this.touchedCount++] = node;
  }

  private addToBucket(node: number, bucket: number): void {
    const head = this.bucketHeads[bucket];
    this.bucketOf[node] = bucket;
    this.previous[node] = -1;
    this.next[node] = head;
    if (head >= 0) this.previous[head] = node;
    this.bucketHeads[bucket] = node;
  }

  private removeFromBucket(node: number): void {
    const bucket = this.bucketOf[node];
    if (bucket < 0) return;
    const previous = this.previous[node];
    const next = this.next[node];
    if (previous >= 0) this.next[previous] = next;
    else this.bucketHeads[bucket] = next;
    if (next >= 0) this.previous[next] = previous;
    this.bucketOf[node] = -1;
  }
}
