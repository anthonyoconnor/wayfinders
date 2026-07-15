import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import { firstShipCollisionTime, isShipCenterCollisionFree } from "./CollisionGeometry";

export type NeighborVisitor = (neighborIndex: number, x: number, y: number) => void;

const EDGE_WEST = 1 << 0;
const EDGE_EAST = 1 << 1;
const EDGE_NORTH = 1 << 2;
const EDGE_SOUTH = 1 << 3;

interface CollisionTopology {
  readonly collisionVersion: number;
  /** 0 unknown, 1 blocked, 2 passable. */
  readonly nodeStates: Uint8Array;
  readonly knownEdgeMasks: Uint8Array;
  readonly edgeMasks: Uint8Array;
}

const topologyCaches = new WeakMap<WorldGrid, Map<string, CollisionTopology>>();

function cacheKey(config: Pick<PrototypeConfig, "navigation" | "movement">): string {
  return `${config.navigation.tileSize}:${config.movement.shipCollisionHalfExtent}`;
}

function topologyFor(
  world: WorldGrid,
  config: Pick<PrototypeConfig, "navigation" | "movement">,
): CollisionTopology {
  let byConfig = topologyCaches.get(world);
  if (!byConfig) {
    byConfig = new Map();
    topologyCaches.set(world, byConfig);
  }
  const key = cacheKey(config);
  let topology = byConfig.get(key);
  if (!topology || topology.collisionVersion !== world.collisionVersion) {
    topology = {
      collisionVersion: world.collisionVersion,
      nodeStates: new Uint8Array(world.tileCount),
      knownEdgeMasks: new Uint8Array(world.tileCount),
      edgeMasks: new Uint8Array(world.tileCount),
    };
    byConfig.set(key, topology);
  }
  return topology;
}

export class GridGraph {
  constructor(
    readonly world: WorldGrid,
    private readonly config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
  ) {}

  index(point: GridPoint): number {
    return this.world.index(point.x, point.y);
  }

  point(index: number): GridPoint {
    return this.world.pointFromIndex(index);
  }

  isNavigationNodePassable(index: number): boolean {
    const topology = topologyFor(this.world, this.config);
    const cached = topology.nodeStates[index];
    if (cached !== 0) return cached === 2;
    const tileSize = this.config.navigation.tileSize;
    const x = index % this.world.width;
    const y = Math.floor(index / this.world.width);
    const passable = isShipCenterCollisionFree(
      this.world,
      (x + 0.5) * tileSize,
      (y + 0.5) * tileSize,
      this.config,
    );
    topology.nodeStates[index] = passable ? 2 : 1;
    return passable;
  }

  canTraverseCardinalEdge(from: number, to: number): boolean {
    const bit = this.edgeBit(from, to);
    if (bit === 0) return false;
    const topology = topologyFor(this.world, this.config);
    if ((topology.knownEdgeMasks[from] & bit) !== 0) {
      return (topology.edgeMasks[from] & bit) !== 0;
    }

    const oppositeBit = this.edgeBit(to, from);
    topology.knownEdgeMasks[from] |= bit;
    topology.knownEdgeMasks[to] |= oppositeBit;
    if (!this.isNavigationNodePassable(from) || !this.isNavigationNodePassable(to)) return false;

    const tileSize = this.config.navigation.tileSize;
    const fromX = (from % this.world.width + 0.5) * tileSize;
    const fromY = (Math.floor(from / this.world.width) + 0.5) * tileSize;
    const toX = (to % this.world.width + 0.5) * tileSize;
    const toY = (Math.floor(to / this.world.width) + 0.5) * tileSize;
    if (firstShipCollisionTime(this.world, fromX, fromY, toX, toY, this.config) !== undefined) {
      return false;
    }
    topology.edgeMasks[from] |= bit;
    topology.edgeMasks[to] |= oppositeBit;
    return true;
  }

  /** Exact geometry for known routes and supported-water connectivity. */
  forEachTraversableCardinalNeighbor(index: number, visitor: NeighborVisitor): void {
    this.forEachCardinalNeighbor(index, (neighbor, x, y) => {
      if (this.canTraverseCardinalEdge(index, neighbor)) visitor(neighbor, x, y);
    });
  }

  /**
   * Clearance-tests only discovered/currently visible geometry, preserving the
   * forward estimate's contract that hidden obstacles do not leak information.
   */
  forEachKnownTraversableCardinalNeighbor(index: number, visitor: NeighborVisitor): void {
    this.forEachCardinalNeighbor(index, (neighbor, x, y) => {
      if (this.canTraverseKnownCardinalEdge(index, neighbor)) visitor(neighbor, x, y);
    });
  }

  canTraverseKnownCardinalEdge(from: number, to: number): boolean {
    if (this.edgeBit(from, to) === 0) return false;
    const tileSize = this.config.navigation.tileSize;
    const fromX = (from % this.world.width + 0.5) * tileSize;
    const fromY = (Math.floor(from / this.world.width) + 0.5) * tileSize;
    const toX = (to % this.world.width + 0.5) * tileSize;
    const toY = (Math.floor(to / this.world.width) + 0.5) * tileSize;
    return firstShipCollisionTime(this.world, fromX, fromY, toX, toY, this.config, {
      includeTile: (_x, _y, worldIndex) => (
        this.world.getKnowledgeAtIndex(worldIndex) !== KnowledgeState.Unknown
        || this.world.isVisibleNowAtIndex(worldIndex)
      ),
    }) === undefined;
  }

  /** Raw topology only; callers must deliberately choose this over collision edges. */
  forEachCardinalNeighbor(index: number, visitor: NeighborVisitor): void {
    const x = index % this.world.width;
    const y = Math.floor(index / this.world.width);
    if (x > 0) visitor(index - 1, x - 1, y);
    if (x + 1 < this.world.width) visitor(index + 1, x + 1, y);
    if (y > 0) visitor(index - this.world.width, x, y - 1);
    if (y + 1 < this.world.height) visitor(index + this.world.width, x, y + 1);
  }

  private edgeBit(from: number, to: number): number {
    if (
      !Number.isInteger(from)
      || !Number.isInteger(to)
      || from < 0
      || to < 0
      || from >= this.world.tileCount
      || to >= this.world.tileCount
    ) return 0;
    const difference = to - from;
    if (difference === -1 && from % this.world.width > 0) return EDGE_WEST;
    if (difference === 1 && from % this.world.width + 1 < this.world.width) return EDGE_EAST;
    if (difference === -this.world.width) return EDGE_NORTH;
    if (difference === this.world.width) return EDGE_SOUTH;
    return 0;
  }
}
