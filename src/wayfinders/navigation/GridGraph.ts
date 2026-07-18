import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import {
  CARDINAL_DIRECTIONS,
  type CardinalDirection,
} from "../world/WorldTopology";
import { firstShipCollisionTime, isShipCenterCollisionFree } from "./CollisionGeometry";
import {
  STATIC_EDGE_BLOCKER,
  StaticEdgeTopologyCache,
  type StaticEdgeTopologyStats,
} from "./StaticEdgeTopologyCache";

/**
 * Allocation-free direction-preserving graph edge visitor. `imageOffsetX/Y`
 * are tile-coordinate offsets applied to the canonical destination image.
 */
export type CardinalEdgeVisitor = (
  neighborIndex: number,
  x: number,
  y: number,
  direction: CardinalDirection,
  reverseDirection: CardinalDirection,
  imageOffsetX: number,
  imageOffsetY: number,
) => void;

export interface GridCardinalEdge {
  readonly neighborIndex: number;
  readonly x: number;
  readonly y: number;
  readonly direction: CardinalDirection;
  readonly reverseDirection: CardinalDirection;
  /** Tile-coordinate offset selecting the destination image adjacent to the source. */
  readonly imageOffsetX: number;
  readonly imageOffsetY: number;
}

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

  /**
   * Endpoint convenience for worlds where one endpoint pair identifies one
   * edge. On a two-cell wrapping axis it reports whether either directional
   * edge is traversable; use canTraverseCardinalDirection to select one slot.
   */
  canTraverseCardinalEdge(from: number, to: number): boolean {
    return this.canTraverseEndpoint(from, to, false);
  }

  /** Exact direction-tagged edge query, including distinct width-two slots. */
  canTraverseCardinalDirection(from: number, direction: CardinalDirection): boolean {
    const edge = this.cardinalEdge(from, direction);
    return edge !== undefined && this.staticEdgeBlockers(from, edge) === 0;
  }

  /** Returns one topological cardinal edge even when collision blocks traversal. */
  cardinalEdge(from: number, direction: CardinalDirection): GridCardinalEdge | undefined {
    this.assertNodeIndex(from);
    const point = {
      x: from % this.world.width,
      y: Math.floor(from / this.world.width),
    };
    const step = this.world.topology.stepCardinal(point, direction);
    if (!step) return undefined;
    return {
      neighborIndex: step.point.y * this.world.width + step.point.x,
      x: step.point.x,
      y: step.point.y,
      direction: step.direction,
      reverseDirection: step.reverseDirection,
      imageOffsetX: step.imageOffset.x,
      imageOffsetY: step.imageOffset.y,
    };
  }

  /** Exact geometry for known routes and supported-water connectivity. */
  forEachTraversableCardinalEdge(index: number, visitor: CardinalEdgeVisitor): void {
    this.forEachClassifiedCardinalEdge(index, false, visitor);
  }

  /**
   * Clearance-tests only discovered/currently visible geometry, preserving the
   * forward estimate's contract that hidden obstacles do not leak information.
   */
  forEachKnownTraversableCardinalEdge(index: number, visitor: CardinalEdgeVisitor): void {
    this.forEachClassifiedCardinalEdge(index, true, visitor);
  }

  /**
   * Endpoint convenience matching canTraverseCardinalEdge. Width-two callers
   * that need a stable direction must use canTraverseKnownCardinalDirection.
   */
  canTraverseKnownCardinalEdge(from: number, to: number): boolean {
    return this.canTraverseEndpoint(from, to, true);
  }

  canTraverseKnownCardinalDirection(from: number, direction: CardinalDirection): boolean {
    const edge = this.cardinalEdge(from, direction);
    return edge !== undefined && this.canTraverseKnownDirection(from, edge);
  }

  staticTopologyStats(): StaticEdgeTopologyStats {
    return this.topology.stats();
  }

  private canTraverseEndpoint(from: number, to: number, knowledgeFiltered: boolean): boolean {
    if (
      !Number.isInteger(from)
      || !Number.isInteger(to)
      || from < 0
      || to < 0
      || from >= this.world.tileCount
      || to >= this.world.tileCount
    ) return false;
    for (const cardinal of CARDINAL_DIRECTIONS) {
      const edge = this.cardinalEdge(from, cardinal.direction);
      if (!edge || edge.neighborIndex !== to) continue;
      const passable = knowledgeFiltered
        ? this.canTraverseKnownDirection(from, edge)
        : this.staticEdgeBlockers(from, edge) === 0;
      if (passable) return true;
    }
    return false;
  }

  private canTraverseKnownDirection(from: number, edge: Readonly<GridCardinalEdge>): boolean {
    return this.canTraverseKnownEdge(
      from,
      edge.neighborIndex,
      edge.x,
      edge.y,
      edge.direction,
      edge.reverseDirection,
      edge.imageOffsetX,
      edge.imageOffsetY,
    );
  }

  private canTraverseKnownEdge(
    from: number,
    neighborIndex: number,
    x: number,
    y: number,
    direction: CardinalDirection,
    reverseDirection: CardinalDirection,
    imageOffsetX: number,
    imageOffsetY: number,
  ): boolean {
    const blockers = this.staticEdgeBlockersFor(
      from,
      neighborIndex,
      x,
      y,
      direction,
      reverseDirection,
      imageOffsetX,
      imageOffsetY,
    );
    if ((blockers & STATIC_EDGE_BLOCKER.worldBounds) !== 0) return false;
    if (
      (blockers & STATIC_EDGE_BLOCKER.source) !== 0
      && this.isKnownOrVisible(from)
    ) return false;
    if (
      (blockers & STATIC_EDGE_BLOCKER.destination) !== 0
      && this.isKnownOrVisible(neighborIndex)
    ) return false;
    if ((blockers & STATIC_EDGE_BLOCKER.otherTile) === 0) return true;

    // A hull wider than the current prototype can touch collision outside the
    // two edge endpoints. Preserve the filtered reference query for that rare
    // case instead of treating hidden third-party geometry as known.
    const tileSize = this.config.navigation.tileSize;
    const fromX = (from % this.world.width + 0.5) * tileSize;
    const fromY = (Math.floor(from / this.world.width) + 0.5) * tileSize;
    const toX = (x + imageOffsetX + 0.5) * tileSize;
    const toY = (y + imageOffsetY + 0.5) * tileSize;
    return firstShipCollisionTime(this.world, fromX, fromY, toX, toY, this.config, {
      includeTile: (_x, _y, worldIndex) => (
        this.world.getKnowledgeAtIndex(worldIndex) !== KnowledgeState.Unknown
        || this.world.isVisibleNowAtIndex(worldIndex)
      ),
    }) === undefined;
  }

  private isKnownOrVisible(index: number): boolean {
    return (
      this.world.getKnowledgeAtIndex(index) !== KnowledgeState.Unknown
      || this.world.isVisibleNowAtIndex(index)
    );
  }

  private staticEdgeBlockers(from: number, edge: Readonly<GridCardinalEdge>): number {
    return this.staticEdgeBlockersFor(
      from,
      edge.neighborIndex,
      edge.x,
      edge.y,
      edge.direction,
      edge.reverseDirection,
      edge.imageOffsetX,
      edge.imageOffsetY,
    );
  }

  private staticEdgeBlockersFor(
    from: number,
    neighborIndex: number,
    x: number,
    y: number,
    direction: CardinalDirection,
    reverseDirection: CardinalDirection,
    imageOffsetX: number,
    imageOffsetY: number,
  ): number {
    const cached = this.topology.edgeBlockersAt(from, direction);
    if (cached !== undefined) return cached;
    const tileSize = this.config.navigation.tileSize;
    const fromX = (from % this.world.width + 0.5) * tileSize;
    const fromY = (Math.floor(from / this.world.width) + 0.5) * tileSize;
    const toX = (x + imageOffsetX + 0.5) * tileSize;
    const toY = (y + imageOffsetY + 0.5) * tileSize;
    let blockers = 0;
    firstShipCollisionTime(this.world, fromX, fromY, toX, toY, this.config, {
      onCollisionTile: (worldIndex) => {
        if (worldIndex === undefined) blockers |= STATIC_EDGE_BLOCKER.worldBounds;
        else if (worldIndex === from) blockers |= STATIC_EDGE_BLOCKER.source;
        else if (worldIndex === neighborIndex) blockers |= STATIC_EDGE_BLOCKER.destination;
        else blockers |= STATIC_EDGE_BLOCKER.otherTile;
      },
    });
    this.topology.setEdgeBlockersAt(
      from,
      direction,
      neighborIndex,
      reverseDirection,
      blockers,
    );
    return blockers;
  }

  private forEachClassifiedCardinalEdge(
    index: number,
    knowledgeFiltered: boolean,
    visitor: CardinalEdgeVisitor,
  ): void {
    this.assertNodeIndex(index);
    const width = this.world.width;
    const height = this.world.height;
    const sourceX = index % width;
    const sourceY = Math.floor(index / width);
    const wrapsX = this.world.topology.wrapsX;
    const wrapsY = this.world.topology.wrapsY;

    // Keep the public object-returning cardinalEdge convenience, but enumerate
    // this hot traversal path entirely with primitives. This avoids allocating
    // a source point, DirectionalTileStep, destination point/image offset, and
    // GridCardinalEdge for every direction of every visited node.
    for (let slot = 0; slot < CARDINAL_DIRECTIONS.length; slot++) {
      const cardinal = CARDINAL_DIRECTIONS[slot]!;
      const direction = cardinal.direction;
      const reverseDirection = cardinal.reverseDirection;
      let x = sourceX + cardinal.x;
      let y = sourceY + cardinal.y;
      let imageOffsetX = 0;
      let imageOffsetY = 0;

      if (x < 0) {
        if (!wrapsX) continue;
        x = width - 1;
        imageOffsetX = -width;
      } else if (x >= width) {
        if (!wrapsX) continue;
        x = 0;
        imageOffsetX = width;
      }
      if (y < 0) {
        if (!wrapsY) continue;
        y = height - 1;
        imageOffsetY = -height;
      } else if (y >= height) {
        if (!wrapsY) continue;
        y = 0;
        imageOffsetY = height;
      }
      // A wrapped one-cell axis has no edge. Width/height two deliberately
      // retains its two direction-tagged slots even though endpoints coincide.
      if (x === sourceX && y === sourceY) continue;

      const neighborIndex = y * width + x;
      const passable = knowledgeFiltered
        ? this.canTraverseKnownEdge(
          index,
          neighborIndex,
          x,
          y,
          direction,
          reverseDirection,
          imageOffsetX,
          imageOffsetY,
        )
        : this.staticEdgeBlockersFor(
          index,
          neighborIndex,
          x,
          y,
          direction,
          reverseDirection,
          imageOffsetX,
          imageOffsetY,
        ) === 0;
      if (!passable) continue;
      visitor(
        neighborIndex,
        x,
        y,
        direction,
        reverseDirection,
        imageOffsetX,
        imageOffsetY,
      );
    }
  }

  private assertNodeIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.world.tileCount) {
      throw new RangeError(`Invalid world index ${index}`);
    }
  }
}
