export interface PriorityQueueEntry<T> {
  value: T;
  priority: number;
}

/** A small binary min-heap that permits duplicate values for cheap Dijkstra updates. */
export class MinPriorityQueue<T> {
  private readonly heap: PriorityQueueEntry<T>[] = [];

  get size(): number {
    return this.heap.length;
  }

  get empty(): boolean {
    return this.heap.length === 0;
  }

  clear(): void {
    this.heap.length = 0;
  }

  enqueue(value: T, priority: number): void {
    if (!Number.isFinite(priority)) throw new RangeError("Priority must be finite");
    const entry = { value, priority };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  peek(): PriorityQueueEntry<T> | undefined {
    return this.heap[0];
  }

  dequeue(): PriorityQueueEntry<T> | undefined {
    if (this.heap.length === 0) return undefined;
    const minimum = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return minimum;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[parent].priority <= this.heap[index].priority) return;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.heap.length && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < this.heap.length && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === index) return;
      [this.heap[smallest], this.heap[index]] = [this.heap[index], this.heap[smallest]];
      index = smallest;
    }
  }
}

/**
 * Allocation-free numeric heap for pathfinding. Entries are stored in parallel
 * typed arrays and dequeue exposes the priority through `dequeuedPriority`, so
 * Dijkstra does not create one short-lived object per relaxation or visit.
 */
export class NumericMinPriorityQueue {
  private nodes: Int32Array;
  private priorities: Float64Array;
  private length = 0;

  dequeuedPriority = Number.NaN;

  constructor(initialCapacity = 64) {
    if (!Number.isInteger(initialCapacity) || initialCapacity <= 0) {
      throw new RangeError("initialCapacity must be a positive integer");
    }
    this.nodes = new Int32Array(initialCapacity);
    this.priorities = new Float64Array(initialCapacity);
  }

  get size(): number {
    return this.length;
  }

  get empty(): boolean {
    return this.length === 0;
  }

  get capacity(): number {
    return this.nodes.length;
  }

  clear(): void {
    this.length = 0;
    this.dequeuedPriority = Number.NaN;
  }

  enqueue(node: number, priority: number): void {
    if (!Number.isInteger(node)) throw new RangeError("Queue node must be an integer");
    if (!Number.isFinite(priority)) throw new RangeError("Priority must be finite");
    this.ensureCapacity(this.length + 1);

    let index = this.length++;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.priorities[parent] <= priority) break;
      this.nodes[index] = this.nodes[parent];
      this.priorities[index] = this.priorities[parent];
      index = parent;
    }
    this.nodes[index] = node;
    this.priorities[index] = priority;
  }

  dequeueNode(): number | undefined {
    if (this.length === 0) {
      this.dequeuedPriority = Number.NaN;
      return undefined;
    }

    const minimumNode = this.nodes[0];
    this.dequeuedPriority = this.priorities[0];
    const nextLength = --this.length;
    if (nextLength === 0) return minimumNode;

    const lastNode = this.nodes[nextLength];
    const lastPriority = this.priorities[nextLength];
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= nextLength) break;
      const right = left + 1;
      let child = left;
      if (right < nextLength && this.priorities[right] < this.priorities[left]) child = right;
      if (this.priorities[child] >= lastPriority) break;
      this.nodes[index] = this.nodes[child];
      this.priorities[index] = this.priorities[child];
      index = child;
    }
    this.nodes[index] = lastNode;
    this.priorities[index] = lastPriority;
    return minimumNode;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.nodes.length) return;
    let capacity = this.nodes.length;
    while (capacity < required) capacity *= 2;
    const nodes = new Int32Array(capacity);
    const priorities = new Float64Array(capacity);
    nodes.set(this.nodes);
    priorities.set(this.priorities);
    this.nodes = nodes;
    this.priorities = priorities;
  }
}
