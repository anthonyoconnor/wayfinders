import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import { firstShipCollisionTime, isShipCenterCollisionFree } from "./CollisionGeometry";
import {
  STATIC_EDGE_BLOCKER,
  StaticEdgeTopologyCache,
  type StaticEdgeTopologyStats,
} from "./StaticEdgeTopologyCache";

export type NeighborVisitor = (neighborIndex: number, x: number, y: number) => void;

export class GridGraph {
  private readonly topology: StaticEdgeTopologyCache;

  constructor(
    readonly world: WorldGrid,
    private readonly config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
  ) {
    this.topology = new StaticEdgeTopologyCache(world, config);
  }

  index(point: GridPoint): number {
    return this.world.index(point.x, point.y);
  }

  point(index: number): GridPoint {
    return this.world.pointFromIndex(index);
  }

  isNavigationNodePassable(index: number): boolean {
    const cached = this.topology.nodeState(index);
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
    this.topology.setNodeState(index, passable);
    return passable;
  }

  canTraverseCardinalEdge(from: number, to: number): boolean {
    const direction = this.edgeDirection(from, to);
    if (direction < 0) return false;
    return this.staticEdgeBlockers(from, to, direction, direction ^ 1) === 0;
  }

  /** Exact geometry for known routes and supported-water connectivity. */
  forEachTraversableCardinalNeighbor(index: number, visitor: NeighborVisitor): void {
    this.forEachClassifiedCardinalNeighbor(index, false, visitor);
  }

  /**
   * Clearance-tests only discovered/currently visible geometry, preserving the
   * forward estimate's contract that hidden obstacles do not leak information.
   */
  forEachKnownTraversableCardinalNeighbor(index: number, visitor: NeighborVisitor): void {
    this.forEachClassifiedCardinalNeighbor(index, true, visitor);
  }

  canTraverseKnownCardinalEdge(from: number, to: number): boolean {
    const direction = this.edgeDirection(from, to);
    if (direction < 0) return false;
    return this.canTraverseKnownDirection(from, to, direction, direction ^ 1);
  }

  private canTraverseKnownDirection(
    from: number,
    to: number,
    direction: number,
    reverseDirection: number,
  ): boolean {
    const blockers = this.staticEdgeBlockers(from, to, direction, reverseDirection);
    if ((blockers & STATIC_EDGE_BLOCKER.worldBounds) !== 0) return false;
    if (
      (blockers & STATIC_EDGE_BLOCKER.source) !== 0
      && this.isKnownOrVisible(from)
    ) return false;
    if (
      (blockers & STATIC_EDGE_BLOCKER.destination) !== 0
      && this.isKnownOrVisible(to)
    ) return false;
    if ((blockers & STATIC_EDGE_BLOCKER.otherTile) === 0) return true;

    // A hull wider than the current prototype can touch collision outside the
    // two edge endpoints. Preserve the filtered reference query for that rare
    // case instead of treating hidden third-party geometry as known.
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

  staticTopologyStats(): StaticEdgeTopologyStats {
    return this.topology.stats();
  }

  private edgeDirection(from: number, to: number): number {
    if (
      !Number.isInteger(from)
      || !Number.isInteger(to)
      || from < 0
      || to < 0
      || from >= this.world.tileCount
      || to >= this.world.tileCount
    ) return -1;
    const difference = to - from;
    if (difference === -1 && from % this.world.width > 0) return 0;
    if (difference === 1 && from % this.world.width + 1 < this.world.width) return 1;
    if (difference === -this.world.width) return 2;
    if (difference === this.world.width) return 3;
    return -1;
  }

  private isKnownOrVisible(index: number): boolean {
    return (
      this.world.getKnowledgeAtIndex(index) !== KnowledgeState.Unknown
      || this.world.isVisibleNowAtIndex(index)
    );
  }

  private staticEdgeBlockers(
    from: number,
    to: number,
    direction: number,
    reverseDirection: number,
  ): number {
    const cached = this.topology.edgeBlockersAt(from, direction);
    if (cached !== undefined) return cached;
    const tileSize = this.config.navigation.tileSize;
    const fromX = (from % this.world.width + 0.5) * tileSize;
    const fromY = (Math.floor(from / this.world.width) + 0.5) * tileSize;
    const toX = (to % this.world.width + 0.5) * tileSize;
    const toY = (Math.floor(to / this.world.width) + 0.5) * tileSize;
    let blockers = 0;
    firstShipCollisionTime(this.world, fromX, fromY, toX, toY, this.config, {
      onCollisionTile: (worldIndex) => {
        if (worldIndex === undefined) blockers |= STATIC_EDGE_BLOCKER.worldBounds;
        else if (worldIndex === from) blockers |= STATIC_EDGE_BLOCKER.source;
        else if (worldIndex === to) blockers |= STATIC_EDGE_BLOCKER.destination;
        else blockers |= STATIC_EDGE_BLOCKER.otherTile;
      },
    });
    this.topology.setEdgeBlockersAt(from, direction, to, reverseDirection, blockers);
    return blockers;
  }

  private forEachClassifiedCardinalNeighbor(
    index: number,
    knowledgeFiltered: boolean,
    visitor: NeighborVisitor,
  ): void {
    const x = index % this.world.width;
    const y = Math.floor(index / this.world.width);
    if (x > 0) {
      const neighbor = index - 1;
      const passable = knowledgeFiltered
        ? this.canTraverseKnownDirection(index, neighbor, 0, 1)
        : this.staticEdgeBlockers(index, neighbor, 0, 1) === 0;
      if (passable) visitor(neighbor, x - 1, y);
    }
    if (x + 1 < this.world.width) {
      const neighbor = index + 1;
      const passable = knowledgeFiltered
        ? this.canTraverseKnownDirection(index, neighbor, 1, 0)
        : this.staticEdgeBlockers(index, neighbor, 1, 0) === 0;
      if (passable) visitor(neighbor, x + 1, y);
    }
    if (y > 0) {
      const neighbor = index - this.world.width;
      const passable = knowledgeFiltered
        ? this.canTraverseKnownDirection(index, neighbor, 2, 3)
        : this.staticEdgeBlockers(index, neighbor, 2, 3) === 0;
      if (passable) visitor(neighbor, x, y - 1);
    }
    if (y + 1 < this.world.height) {
      const neighbor = index + this.world.width;
      const passable = knowledgeFiltered
        ? this.canTraverseKnownDirection(index, neighbor, 3, 2)
        : this.staticEdgeBlockers(index, neighbor, 3, 2) === 0;
      if (passable) visitor(neighbor, x, y + 1);
    }
  }
}
