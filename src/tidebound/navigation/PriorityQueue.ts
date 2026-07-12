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
