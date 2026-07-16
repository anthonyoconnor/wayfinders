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

export interface CostSearchWorkBudget {
  readonly maxWorkUnits: number;
  /** Optional wall-clock guard. It is checked between bounded node operations. */
  readonly shouldYield?: () => boolean;
}

export type BucketedCostSearchStep =
  | {
      readonly status: "pending";
      readonly workUnits: number;
      readonly settledCount: number;
    }
  | {
      readonly status: "complete";
      readonly workUnits: number;
      readonly result: BucketedCostSearchResult;
    };

/**
 * Reusable decrease-key Dial queue for bounded non-negative integer costs.
 * Forward guidance validates an exact small integer scale before starting a
 * cooperative task. Synchronous oracle queries may still use generic Dijkstra
 * for unusually large cost horizons.
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
  private options?: BucketedCostSearchOptions;
  private phase: "idle" | "reset" | "buckets" | "seed" | "search" | "complete" = "idle";
  private resetPosition = 0;
  private bucketResetPosition = 0;
  private bucketResetLimit = -1;
  private previousMaxCostUnits = -1;
  private currentBucket = 0;
  private settledCount = 0;
  private activeNode = -1;
  private activeCost = 0;
  private readonly visitActiveNeighbor = (
    neighbor: number,
    traversalCostUnits: number,
  ): void => {
    const options = this.options;
    if (!options) throw new Error("Bucketed search is not active");
    if (!Number.isInteger(neighbor) || neighbor < 0 || neighbor >= options.nodeCount) {
      throw new RangeError("neighbor must identify a node");
    }
    if (!Number.isSafeInteger(traversalCostUnits) || traversalCostUnits < 0) {
      throw new RangeError("traversalCostUnits must be a non-negative safe integer");
    }
    const nextCost = this.activeCost + traversalCostUnits;
    if (nextCost > options.maxCostUnits || nextCost >= this.costUnits[neighbor]) return;
    this.touch(neighbor);
    if (this.bucketOf[neighbor] >= 0) this.removeFromBucket(neighbor);
    this.costUnits[neighbor] = nextCost;
    this.costs[neighbor] = nextCost / options.unitScale;
    this.addToBucket(neighbor, nextCost);
  };

  search(options: BucketedCostSearchOptions): BucketedCostSearchResult {
    this.begin(options);
    for (;;) {
      const step = this.step({ maxWorkUnits: Number.MAX_SAFE_INTEGER });
      if (step.status === "complete") return step.result;
    }
  }

  /** Preallocates graph-sized storage outside an interactive guidance slice. */
  reserve(nodeCount: number, maxCostUnits: number): void {
    if (this.phase !== "idle" && this.phase !== "complete") {
      throw new Error("Cannot resize an active bucketed search");
    }
    if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
      throw new RangeError("nodeCount must be a positive integer");
    }
    if (!Number.isSafeInteger(maxCostUnits) || maxCostUnits < 0) {
      throw new RangeError("maxCostUnits must be a non-negative safe integer");
    }
    this.ensureCapacity(nodeCount, maxCostUnits);
  }

  /** Starts a resumable Dial search without doing graph work. */
  begin(options: BucketedCostSearchOptions): void {
    const { nodeCount, start, maxCostUnits, unitScale } = options;
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
    this.ensureCapacity(nodeCount, maxCostUnits);
    this.previousMaxCostUnits = Math.max(this.previousMaxCostUnits, maxCostUnits);
    this.options = options;
    this.phase = "reset";
    this.resetPosition = 0;
    this.bucketResetPosition = 0;
    this.bucketResetLimit = this.previousMaxCostUnits;
    this.currentBucket = 0;
    this.settledCount = 0;
    this.activeNode = -1;
    this.activeCost = 0;
  }

  /**
   * Advances cleanup and search using deterministic work units. One settled
   * node (including its at-most-four cardinal relaxations) is atomic.
   */
  step(budget: CostSearchWorkBudget): BucketedCostSearchStep {
    if (!Number.isSafeInteger(budget.maxWorkUnits) || budget.maxWorkUnits <= 0) {
      throw new RangeError("maxWorkUnits must be a positive safe integer");
    }
    if (!this.options || this.phase === "idle") {
      throw new Error("Bucketed search has not been started");
    }
    if (this.phase === "complete") return this.completedStep(0);

    let workUnits = 0;
    const shouldStop = (): boolean => (
      workUnits >= budget.maxWorkUnits
      || (workUnits > 0 && workUnits % 32 === 0 && budget.shouldYield?.() === true)
    );

    while (!shouldStop()) {
      if (this.phase === "reset") {
        if (this.resetPosition < this.touchedCount) {
          const node = this.touchedIndices[this.resetPosition++];
          this.costUnits[node] = UNREACHED;
          this.costs[node] = Number.POSITIVE_INFINITY;
          this.bucketOf[node] = -1;
          this.touched[node] = 0;
          workUnits++;
          continue;
        }
        this.touchedCount = 0;
        this.phase = "buckets";
        continue;
      }

      if (this.phase === "buckets") {
        if (this.bucketResetPosition <= this.bucketResetLimit) {
          this.bucketHeads[this.bucketResetPosition++] = -1;
          workUnits++;
          continue;
        }
        this.phase = "seed";
        continue;
      }

      if (this.phase === "seed") {
        const { start } = this.options;
        this.touch(start);
        this.costUnits[start] = 0;
        this.costs[start] = 0;
        this.addToBucket(start, 0);
        this.phase = "search";
        workUnits++;
        continue;
      }

      if (this.phase === "search") {
        while (
          this.currentBucket <= this.options.maxCostUnits
          && this.bucketHeads[this.currentBucket] < 0
        ) {
          this.currentBucket++;
          workUnits++;
          if (shouldStop()) return this.pendingStep(workUnits);
        }
        if (this.currentBucket > this.options.maxCostUnits) {
          this.previousMaxCostUnits = this.options.maxCostUnits;
          this.phase = "complete";
          return this.completedStep(workUnits);
        }
        const node = this.bucketHeads[this.currentBucket];
        this.removeFromBucket(node);
        this.settledIndices[this.settledCount++] = node;
        this.activeNode = node;
        this.activeCost = this.currentBucket;
        this.options.forEachNeighbor(this.activeNode, this.visitActiveNeighbor);
        workUnits++;
        continue;
      }
    }

    return this.pendingStep(workUnits);
  }

  cancel(): void {
    if (this.phase === "idle" || this.phase === "complete") return;
    this.phase = "idle";
    this.options = undefined;
  }

  private ensureCapacity(nodeCount: number, maxCostUnits: number): void {
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
    }
    if (this.bucketHeads.length <= maxCostUnits) {
      this.bucketHeads = new Int32Array(maxCostUnits + 1);
      this.bucketHeads.fill(-1);
    }
  }

  private pendingStep(workUnits: number): BucketedCostSearchStep {
    return { status: "pending", workUnits, settledCount: this.settledCount };
  }

  private completedStep(workUnits: number): BucketedCostSearchStep {
    const nodeCount = this.options!.nodeCount;
    return {
      status: "complete",
      workUnits,
      result: {
        costs: this.costs.subarray(0, nodeCount),
        settledIndices: this.settledIndices.subarray(0, nodeCount),
        settledCount: this.settledCount,
      },
    };
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
