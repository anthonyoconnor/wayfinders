import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import type { CardinalDirection } from "../world/WorldTopology";

const UNREACHED = -2;
const ROOT = -1;
const UNREACHED_DISTANCE = -1;
const UNREACHED_DIRECTION = -1;
const CONNECTIVITY_TIE_DIRECTIONS = [2, 1, 3, 0] as const satisfies readonly CardinalDirection[];

export interface SupportedPathEdge {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly direction: CardinalDirection;
  /** Edge-local tile offset selecting the adjacent image of `toIndex`. */
  readonly imageOffset: Readonly<GridPoint>;
  /** Accumulated tile offset selecting the destination image for the path so far. */
  readonly destinationImageOffset: Readonly<GridPoint>;
  /** Short, physically adjacent tile-centre coordinates anchored at the canonical home tile. */
  readonly liftedFrom: Readonly<GridPoint>;
  readonly liftedTo: Readonly<GridPoint>;
}

export interface SupportedConnectivityResult {
  readonly topologyRevision: number;
  readonly homeReturnIndex: number;
  readonly serviceAnchorIndex: number;
  /** Exact cardinal route from homeReturnTile through serviceAnchor, inclusive. */
  readonly pathIndices: readonly number[];
  /** Direction-preserving lifted edges for the same home-to-anchor path. */
  readonly pathEdges: readonly Readonly<SupportedPathEdge>[];
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
  private readonly parentDirections: Int8Array;
  private readonly distances: Int32Array;
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
    this.parentDirections = new Int8Array(world.tileCount);
    this.distances = new Int32Array(world.tileCount);
    this.queue = new Int32Array(world.tileCount);
    this.parents.fill(UNREACHED);
    this.parentDirections.fill(UNREACHED_DIRECTION);
    this.distances.fill(UNREACHED_DISTANCE);
    this.graph = new GridGraph(world, config);
  }

  /** Number of BFS trees built, exposed for cache-boundary instrumentation. */
  get buildCount(): number {
    return this.buildCountValue;
  }

  isCompatibleWith(world: WorldGrid, homeReturnTile: Readonly<GridPoint>): boolean {
    return this.isCompatibleWithWorld(world)
      && this.homeReturnTile.x === homeReturnTile.x
      && this.homeReturnTile.y === homeReturnTile.y;
  }

  isCompatibleWithWorld(world: WorldGrid): boolean {
    return this.world === world;
  }

  connectivityTo(
    serviceAnchor: GridPoint,
    topologyRevision: number,
  ): SupportedConnectivityResult {
    this.assertTopologyRevision(topologyRevision);
    const serviceAnchorIndex = this.world.index(serviceAnchor.x, serviceAnchor.y);
    this.ensureCache(topologyRevision);

    return this.resultForAnchorIndex(serviceAnchorIndex, topologyRevision);
  }

  /**
   * Selects the connected candidate with the shortest Supported path, breaking
   * equal-length ties by canonical world index. Candidate order and duplicates
   * cannot change the result. The shared flood is still built at most once for
   * the supplied topology revision.
   */
  connectivityToAny(
    serviceAnchors: Iterable<Readonly<GridPoint>>,
    topologyRevision: number,
  ): SupportedConnectivityResult | undefined {
    this.assertTopologyRevision(topologyRevision);
    this.ensureCache(topologyRevision);

    const candidateIndices = new Set<number>();
    for (const serviceAnchor of serviceAnchors) {
      candidateIndices.add(this.world.index(serviceAnchor.x, serviceAnchor.y));
    }

    let selectedIndex: number | undefined;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (const candidateIndex of candidateIndices) {
      const distance = this.distances[candidateIndex] ?? UNREACHED_DISTANCE;
      if (distance === UNREACHED_DISTANCE) continue;
      if (
        distance < selectedDistance
        || (distance === selectedDistance && (selectedIndex === undefined || candidateIndex < selectedIndex))
      ) {
        selectedIndex = candidateIndex;
        selectedDistance = distance;
      }
    }
    return selectedIndex === undefined
      ? undefined
      : this.resultForAnchorIndex(selectedIndex, topologyRevision);
  }

  private resultForAnchorIndex(
    serviceAnchorIndex: number,
    topologyRevision: number,
  ): SupportedConnectivityResult {
    const cached = this.resultsByAnchor.get(serviceAnchorIndex);
    if (cached) return cached;

    const pathIndices = this.pathIndicesTo(serviceAnchorIndex);
    const pathEdges = this.pathEdgesFor(pathIndices);
    const result = Object.freeze({
      topologyRevision,
      homeReturnIndex: this.homeReturnIndex,
      serviceAnchorIndex,
      pathIndices,
      pathEdges,
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

  pathEdgesTo(serviceAnchor: GridPoint, topologyRevision: number): readonly Readonly<SupportedPathEdge>[] {
    return this.connectivityTo(serviceAnchor, topologyRevision).pathEdges;
  }

  private ensureCache(topologyRevision: number): void {
    if (this.cachedTopologyRevision === topologyRevision) return;

    this.cachedTopologyRevision = topologyRevision;
    this.resultsByAnchor.clear();
    this.parents.fill(UNREACHED);
    this.parentDirections.fill(UNREACHED_DIRECTION);
    this.distances.fill(UNREACHED_DISTANCE);
    this.buildCountValue++;

    if (!this.isPassableSupported(this.homeReturnIndex)) return;

    let head = 0;
    let tail = 0;
    this.parents[this.homeReturnIndex] = ROOT;
    this.distances[this.homeReturnIndex] = 0;
    this.queue[tail++] = this.homeReturnIndex;

    while (head < tail) {
      const current = this.queue[head++];
      // Fixed north, east, south, west order is the path tie-break contract.
      for (const direction of CONNECTIVITY_TIE_DIRECTIONS) {
        const edge = this.graph.cardinalEdge(current, direction);
        if (edge) tail = this.tryEnqueue(edge.neighborIndex, current, direction, tail);
      }
    }
  }

  private tryEnqueue(
    index: number,
    parent: number,
    direction: CardinalDirection,
    tail: number,
  ): number {
    if (
      this.parents[index] !== UNREACHED
      || !this.isPassableSupported(index)
      || !this.graph.canTraverseCardinalDirection(parent, direction)
    ) return tail;
    this.parents[index] = parent;
    this.parentDirections[index] = direction;
    this.distances[index] = this.distances[parent]! + 1;
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

  private pathEdgesFor(pathIndices: readonly number[]): readonly Readonly<SupportedPathEdge>[] {
    if (pathIndices.length < 2) return Object.freeze([]);

    const edges: Readonly<SupportedPathEdge>[] = [];
    let cumulativeOffsetX = 0;
    let cumulativeOffsetY = 0;
    for (let position = 1; position < pathIndices.length; position++) {
      const fromIndex = pathIndices[position - 1]!;
      const toIndex = pathIndices[position]!;
      const directionValue = this.parentDirections[toIndex];
      if (directionValue === undefined || directionValue < 0 || directionValue > 3) {
        throw new Error("Supported path is missing cardinal edge provenance");
      }
      const direction = directionValue as CardinalDirection;
      const cardinalEdge = this.graph.cardinalEdge(fromIndex, direction);
      if (!cardinalEdge || cardinalEdge.neighborIndex !== toIndex) {
        throw new Error("Supported path cardinal edge provenance is inconsistent");
      }

      const from = this.world.pointFromIndex(fromIndex);
      const to = this.world.pointFromIndex(toIndex);
      const liftedFrom = Object.freeze({
        x: from.x + cumulativeOffsetX,
        y: from.y + cumulativeOffsetY,
      });
      const imageOffset = Object.freeze({
        x: cardinalEdge.imageOffsetX,
        y: cardinalEdge.imageOffsetY,
      });
      cumulativeOffsetX += imageOffset.x;
      cumulativeOffsetY += imageOffset.y;
      const destinationImageOffset = Object.freeze({
        x: cumulativeOffsetX,
        y: cumulativeOffsetY,
      });
      const liftedTo = Object.freeze({
        x: to.x + cumulativeOffsetX,
        y: to.y + cumulativeOffsetY,
      });
      edges.push(Object.freeze({
        fromIndex,
        toIndex,
        direction,
        imageOffset,
        destinationImageOffset,
        liftedFrom,
        liftedTo,
      }));
    }
    return Object.freeze(edges);
  }

  private assertTopologyRevision(topologyRevision: number): void {
    if (!Number.isSafeInteger(topologyRevision) || topologyRevision < 0) {
      throw new RangeError("Supported topology revision must be a non-negative safe integer");
    }
  }
}
