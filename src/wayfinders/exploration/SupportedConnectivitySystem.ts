import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";

const UNREACHED = -2;
const ROOT = -1;

export interface SupportedConnectivityResult {
  readonly topologyRevision: number;
  readonly homeReturnIndex: number;
  readonly serviceAnchorIndex: number;
  /** Exact cardinal route from homeReturnTile through serviceAnchor, inclusive. */
  readonly pathIndices: readonly number[];
  readonly connected: boolean;
}

/**
 * Caches one deterministic Supported-water flood from the exact home return tile.
 * The caller owns topology revisioning; changing the world without changing that
 * revision intentionally leaves this cache untouched.
 */
export class SupportedConnectivitySystem {
  readonly homeReturnTile: Readonly<GridPoint>;

  private readonly homeReturnIndex: number;
  private readonly parents: Int32Array;
  private readonly queue: Int32Array;
  private readonly resultsByAnchor = new Map<number, SupportedConnectivityResult>();
  private readonly graph: GridGraph;
  private cachedTopologyRevision: number | undefined;
  private buildCountValue = 0;

  constructor(
    private readonly world: WorldGrid,
    homeReturnTile: GridPoint,
    config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
  ) {
    this.homeReturnIndex = world.index(homeReturnTile.x, homeReturnTile.y);
    this.homeReturnTile = Object.freeze({ x: homeReturnTile.x, y: homeReturnTile.y });
    this.parents = new Int32Array(world.tileCount);
    this.queue = new Int32Array(world.tileCount);
    this.parents.fill(UNREACHED);
    this.graph = new GridGraph(world, config);
  }

  /** Number of BFS trees built, exposed for cache-boundary instrumentation. */
  get buildCount(): number {
    return this.buildCountValue;
  }

  connectivityTo(
    serviceAnchor: GridPoint,
    topologyRevision: number,
  ): SupportedConnectivityResult {
    this.assertTopologyRevision(topologyRevision);
    const serviceAnchorIndex = this.world.index(serviceAnchor.x, serviceAnchor.y);
    this.ensureCache(topologyRevision);

    const cached = this.resultsByAnchor.get(serviceAnchorIndex);
    if (cached) return cached;

    const pathIndices = this.pathIndicesTo(serviceAnchorIndex);
    const result = Object.freeze({
      topologyRevision,
      homeReturnIndex: this.homeReturnIndex,
      serviceAnchorIndex,
      pathIndices,
      connected: pathIndices.length > 0,
    });
    this.resultsByAnchor.set(serviceAnchorIndex, result);
    return result;
  }

  isConnected(serviceAnchor: GridPoint, topologyRevision: number): boolean {
    return this.connectivityTo(serviceAnchor, topologyRevision).connected;
  }

  pathTo(serviceAnchor: GridPoint, topologyRevision: number): readonly number[] {
    return this.connectivityTo(serviceAnchor, topologyRevision).pathIndices;
  }

  private ensureCache(topologyRevision: number): void {
    if (this.cachedTopologyRevision === topologyRevision) return;

    this.cachedTopologyRevision = topologyRevision;
    this.resultsByAnchor.clear();
    this.parents.fill(UNREACHED);
    this.buildCountValue++;

    if (!this.isPassableSupported(this.homeReturnIndex)) return;

    let head = 0;
    let tail = 0;
    this.parents[this.homeReturnIndex] = ROOT;
    this.queue[tail++] = this.homeReturnIndex;

    while (head < tail) {
      const current = this.queue[head++];
      const x = current % this.world.width;
      const y = Math.floor(current / this.world.width);

      // Fixed north, east, south, west order is the path tie-break contract.
      if (y > 0) tail = this.tryEnqueue(current - this.world.width, current, tail);
      if (x + 1 < this.world.width) tail = this.tryEnqueue(current + 1, current, tail);
      if (y + 1 < this.world.height) tail = this.tryEnqueue(current + this.world.width, current, tail);
      if (x > 0) tail = this.tryEnqueue(current - 1, current, tail);
    }
  }

  private tryEnqueue(index: number, parent: number, tail: number): number {
    if (
      this.parents[index] !== UNREACHED
      || !this.isPassableSupported(index)
      || !this.graph.canTraverseCardinalEdge(parent, index)
    ) return tail;
    this.parents[index] = parent;
    this.queue[tail] = index;
    return tail + 1;
  }

  private isPassableSupported(index: number): boolean {
    return this.world.getKnowledgeAtIndex(index) === KnowledgeState.Supported
      && this.graph.isNavigationNodePassable(index);
  }

  private pathIndicesTo(serviceAnchorIndex: number): readonly number[] {
    if (this.parents[serviceAnchorIndex] === UNREACHED) return Object.freeze([]);

    const reversed: number[] = [];
    for (let index = serviceAnchorIndex; index !== ROOT; index = this.parents[index]) {
      reversed.push(index);
    }
    reversed.reverse();
    return Object.freeze(reversed);
  }

  private assertTopologyRevision(topologyRevision: number): void {
    if (!Number.isSafeInteger(topologyRevision) || topologyRevision < 0) {
      throw new RangeError("Supported topology revision must be a non-negative safe integer");
    }
  }
}
