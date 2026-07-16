export interface ResourceLease<TKey, TResource> {
  readonly key: TKey;
  readonly resource: TResource;
  release(): void;
}

export interface ResourceCacheTelemetry {
  readonly maxEntries: number;
  readonly maxWeight: number;
  readonly entries: number;
  readonly activeEntries: number;
  readonly idleEntries: number;
  readonly activeLeases: number;
  readonly retainedWeight: number;
  readonly peakEntries: number;
  readonly peakWeight: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly evictions: number;
  readonly deniedAcquisitions: number;
}

interface ResourceEntry<TResource> {
  readonly resource: TResource;
  readonly weight: number;
  readonly sequence: number;
  references: number;
  lastUsed: number;
}

/**
 * A small synchronous lease cache for decoded assets and shared textures.
 * Referenced entries are never evicted; callers can use an undefined result to
 * render a low-detail placeholder while the resource budget is saturated.
 */
export class ReferenceCountedResourceCache<TKey, TResource> {
  private readonly entries = new Map<TKey, ResourceEntry<TResource>>();
  private tick = 0;
  private sequence = 0;
  private activeLeases = 0;
  private retainedWeight = 0;
  private peakEntries = 0;
  private peakWeight = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private evictions = 0;
  private deniedAcquisitions = 0;

  constructor(
    private readonly options: Readonly<{
      maxEntries: number;
      maxWeight: number;
      dispose: (resource: TResource, key: TKey) => void;
    }>,
  ) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new RangeError("maxEntries must be a positive safe integer");
    }
    if (!Number.isFinite(options.maxWeight) || options.maxWeight <= 0) {
      throw new RangeError("maxWeight must be positive and finite");
    }
  }

  tryAcquire(
    key: TKey,
    weight: number,
    create: () => TResource,
  ): ResourceLease<TKey, TResource> | undefined {
    if (!Number.isFinite(weight) || weight <= 0) throw new RangeError("resource weight must be positive and finite");
    this.tick++;
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.weight !== weight) throw new RangeError("resource weight changed for an existing key");
      existing.references++;
      existing.lastUsed = this.tick;
      this.activeLeases++;
      this.cacheHits++;
      return this.createLease(key, existing);
    }

    this.cacheMisses++;
    if (weight > this.options.maxWeight) {
      this.deniedAcquisitions++;
      return undefined;
    }
    this.evictUntilFits(weight);
    if (
      this.entries.size >= this.options.maxEntries
      || this.retainedWeight + weight > this.options.maxWeight
    ) {
      this.deniedAcquisitions++;
      return undefined;
    }

    const entry: ResourceEntry<TResource> = {
      resource: create(),
      weight,
      sequence: this.sequence++,
      references: 1,
      lastUsed: this.tick,
    };
    this.entries.set(key, entry);
    this.activeLeases++;
    this.retainedWeight += weight;
    this.peakEntries = Math.max(this.peakEntries, this.entries.size);
    this.peakWeight = Math.max(this.peakWeight, this.retainedWeight);
    return this.createLease(key, entry);
  }

  /** Evicts every currently unreferenced entry, useful at scene shutdown. */
  trimIdle(): void {
    const idle = [...this.entries.entries()]
      .filter(([, entry]) => entry.references === 0)
      .sort(compareResourceEntries);
    for (const [key, entry] of idle) this.evict(key, entry);
  }

  getTelemetry(): Readonly<ResourceCacheTelemetry> {
    let activeEntries = 0;
    for (const entry of this.entries.values()) if (entry.references > 0) activeEntries++;
    return Object.freeze({
      maxEntries: this.options.maxEntries,
      maxWeight: this.options.maxWeight,
      entries: this.entries.size,
      activeEntries,
      idleEntries: this.entries.size - activeEntries,
      activeLeases: this.activeLeases,
      retainedWeight: this.retainedWeight,
      peakEntries: this.peakEntries,
      peakWeight: this.peakWeight,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      evictions: this.evictions,
      deniedAcquisitions: this.deniedAcquisitions,
    });
  }

  private createLease(key: TKey, entry: ResourceEntry<TResource>): ResourceLease<TKey, TResource> {
    let released = false;
    return Object.freeze({
      key,
      resource: entry.resource,
      release: () => {
        if (released) return;
        released = true;
        entry.references--;
        entry.lastUsed = ++this.tick;
        this.activeLeases--;
      },
    });
  }

  private evictUntilFits(incomingWeight: number): void {
    while (
      this.entries.size >= this.options.maxEntries
      || this.retainedWeight + incomingWeight > this.options.maxWeight
    ) {
      const candidate = [...this.entries.entries()]
        .filter(([, entry]) => entry.references === 0)
        .sort(compareResourceEntries)[0];
      if (!candidate) return;
      this.evict(candidate[0], candidate[1]);
    }
  }

  private evict(key: TKey, entry: ResourceEntry<TResource>): void {
    this.entries.delete(key);
    this.retainedWeight -= entry.weight;
    this.evictions++;
    this.options.dispose(entry.resource, key);
  }
}

function compareResourceEntries<TKey, TResource>(
  left: readonly [TKey, ResourceEntry<TResource>],
  right: readonly [TKey, ResourceEntry<TResource>],
): number {
  return left[1].lastUsed - right[1].lastUsed || left[1].sequence - right[1].sequence;
}
