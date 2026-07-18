import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, ShipState } from "../core/types";
import {
  dijkstra,
  DijkstraWorkspace,
  reconstructDijkstraEdges,
  reconstructDijkstraPath,
  type DijkstraNeighborVisitor,
  type DijkstraResult,
} from "../navigation/Dijkstra";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import { CARDINAL_DIRECTIONS, type CardinalDirection } from "../world/WorldTopology";
import { availableProvisionUnits, knowledgeTravelCost } from "./ProvisionSystem";
import type { ReturnQuery } from "./ReturnQuery";

export enum ReturnRiskLevel {
  Hidden = 0,
  Comfortable = 1,
  Warning = 2,
  Critical = 3,
  Impossible = 4,
}

export interface ReturnPathResult extends DijkstraResult {
  /** Hidden everywhere except the padded minimum-cost return corridor. */
  risk: Uint8Array;
  budget: number;
  originIndex: number;
  supportedBoundaryIndices: readonly number[];
  /** Minimum-cost path ordered from the ship through the first Supported tile. */
  pathIndices: readonly number[];
  /** Direction-preserving lifted edges for the same ship-to-Supported path. */
  pathEdges: readonly ReturnPathEdge[];
  /** Passable Personal/currently-visible cells within configured padding of the path. */
  corridorIndices: readonly number[];
  returnCost: number;
  returnMargin: number;
  riskLevel: ReturnRiskLevel;
  riskCounts: ReturnRiskCounts;
}

export interface ReturnPathEdge {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly direction: CardinalDirection;
  /** Edge-local tile offset selecting the adjacent image of `toIndex`. */
  readonly imageOffset: Readonly<GridPoint>;
  /** Accumulated tile offset selecting the destination image for the path so far. */
  readonly destinationImageOffset: Readonly<GridPoint>;
  /** Short, physically adjacent tile-centre coordinates anchored at the canonical origin. */
  readonly liftedFrom: Readonly<GridPoint>;
  readonly liftedTo: Readonly<GridPoint>;
}

export interface ReturnRiskCounts {
  comfortable: number;
  warning: number;
  critical: number;
  impossible: number;
}

export function classifyReturnRiskMargin(
  margin: number,
  thresholds: Readonly<PrototypeConfig["returnRisk"]>,
): ReturnRiskLevel {
  if (![thresholds.comfortable, thresholds.warning, thresholds.critical].every(Number.isFinite)) {
    throw new RangeError("Return-risk thresholds must be finite");
  }
  if (margin >= thresholds.comfortable) return ReturnRiskLevel.Comfortable;
  if (margin >= thresholds.warning) return ReturnRiskLevel.Warning;
  if (margin >= thresholds.critical) return ReturnRiskLevel.Critical;
  return ReturnRiskLevel.Impossible;
}

interface ReturnBudgetCache {
  corridorIndices: readonly number[];
  returnCost: number;
  showRisk: boolean;
}

export class ReturnPathSystem implements ReturnQuery {
  private graph: GridGraph;
  private budgetCaches = new WeakMap<ReturnPathResult, ReturnBudgetCache>();
  private readonly searchWorkspace = new DijkstraWorkspace();
  private readonly boundaryWorkspace = new Set<number>();
  private relaxNeighbor: DijkstraNeighborVisitor = () => undefined;
  private readonly visitGraphNeighbor = (
    neighbor: number,
    _x: number,
    _y: number,
    direction: CardinalDirection,
    _reverseDirection: CardinalDirection,
    imageOffsetX: number,
    imageOffsetY: number,
  ): void => {
    const knowledge = this.world.getKnowledgeAtIndex(neighbor);
    // Supported boundary cells are the search roots. There is no reason to
    // flood the interior zero-cost Supported component after leaving a root.
    if (knowledge === KnowledgeState.Supported) return;
    // Current sight is known to the player even though outward-travel water is
    // intentionally not committed to Personal until it falls behind the ship.
    if (knowledge === KnowledgeState.Unknown && !this.world.isVisibleNowAtIndex(neighbor)) return;
    this.relaxNeighbor(
      neighbor,
      knowledgeTravelCost(knowledge, this.config),
      direction,
      imageOffsetX,
      imageOffsetY,
    );
  };
  private readonly forEachSearchNeighbor = (
    node: number,
    visit: DijkstraNeighborVisitor,
  ): void => {
    this.relaxNeighbor = visit;
    this.graph.forEachTraversableCardinalEdge(node, this.visitGraphNeighbor);
  };
  private readonly collectSupportedNeighbor = (neighbor: number): void => {
    if (
      this.world.getKnowledgeAtIndex(neighbor) === KnowledgeState.Supported
      && this.graph.isNavigationNodePassable(neighbor)
    ) this.boundaryWorkspace.add(neighbor);
  };

  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {
    this.graph = new GridGraph(world, config);
  }

  setWorld(world: WorldGrid): void {
    this.world = world;
    this.graph = new GridGraph(world, this.config);
    this.budgetCaches = new WeakMap();
  }

  calculate(
    ship: Pick<
      ShipState,
      "currentTileX" | "currentTileY" | "provisions" | "provisionAccumulator"
    >,
  ): ReturnPathResult {
    return this.calculateResult(ship);
  }

  /** Recalculates a changed route while retaining its world-sized risk mask. */
  recalculate(
    result: ReturnPathResult,
    ship: Pick<
      ShipState,
      "currentTileX" | "currentTileY" | "provisions" | "provisionAccumulator"
    >,
  ): ReturnPathResult {
    if (!this.budgetCaches.has(result)) {
      throw new Error("Return path result was not calculated by this system");
    }
    return this.calculateResult(ship, result);
  }

  private calculateResult(
    ship: Pick<
      ShipState,
      "currentTileX" | "currentTileY" | "provisions" | "provisionAccumulator"
    >,
    reusable?: ReturnPathResult,
  ): ReturnPathResult {
    if (!this.world.inBounds(ship.currentTileX, ship.currentTileY)) {
      throw new RangeError("Ship tile is outside the world");
    }
    const coarseBlocked = this.world.isMovementBlocked(ship.currentTileX, ship.currentTileY);
    const hasMixedOverride = this.world.getFineCollisionMask(ship.currentTileX, ship.currentTileY) !== undefined;
    if (coarseBlocked && !hasMixedOverride) {
      throw new RangeError("Ship tile is blocked");
    }

    const originIndex = this.world.index(ship.currentTileX, ship.currentTileY);
    const originKnowledge = this.world.getKnowledgeAtIndex(originIndex);
    const supportedBoundaryIndices = originKnowledge === KnowledgeState.Supported
      ? [originIndex]
      : this.findSupportedBoundaryIndices();
    const search = dijkstra({
      nodeCount: this.world.tileCount,
      starts: supportedBoundaryIndices,
      target: originIndex,
      workspace: this.searchWorkspace,
      forEachNeighbor: this.forEachSearchNeighbor,
    });

    const budget = availableProvisionUnits(ship);
    const path = this.pathToSupportedResult(search, originIndex);
    const pathIndices = path.indices;
    const pathEdges = path.edges;
    const hasKnownReturn = pathIndices.length > 0;
    const returnCost = hasKnownReturn ? search.costs[originIndex] : Number.POSITIVE_INFINITY;
    const returnMargin = Number.isFinite(returnCost) ? budget - returnCost : Number.NEGATIVE_INFINITY;
    const showRisk = originKnowledge !== KnowledgeState.Supported;
    const riskLevel = showRisk ? this.classifyMargin(returnMargin) : ReturnRiskLevel.Hidden;
    const corridorIndices = hasKnownReturn && showRisk ? this.buildCorridor(pathIndices) : [];
    const risk = reusable?.risk.length === this.world.tileCount
      ? reusable.risk
      : new Uint8Array(this.world.tileCount);
    if (reusable && risk === reusable.risk) {
      for (const index of reusable.corridorIndices) risk[index] = ReturnRiskLevel.Hidden;
    }
    for (const index of corridorIndices) risk[index] = riskLevel;
    const riskCounts = this.countsFor(riskLevel, corridorIndices.length);

    const nextValues: ReturnPathResult = {
      ...search,
      risk,
      budget,
      originIndex,
      supportedBoundaryIndices,
      pathIndices,
      pathEdges,
      corridorIndices,
      returnCost,
      returnMargin,
      riskLevel,
      riskCounts,
    };
    const returnResult = reusable ?? nextValues;
    if (reusable) Object.assign(reusable, nextValues);
    this.budgetCaches.set(returnResult, { corridorIndices, returnCost, showRisk });
    return returnResult;
  }

  /** Returns the already calculated ship-origin route; other origins require a fresh calculation. */
  pathToSupported(
    result: Pick<ReturnPathResult, "originIndex" | "pathIndices">,
    from: GridPoint,
  ): GridPoint[] {
    if (!this.world.inBounds(from.x, from.y)) throw new RangeError("Return path origin is outside the world");
    const index = this.world.index(from.x, from.y);
    if (index !== result.originIndex) return [];
    return result.pathIndices.map((pathIndex) => this.world.pointFromIndex(pathIndex));
  }

  /** Reclassifies the whole existing corridor without rerunning pathfinding. */
  updateBudget(
    result: ReturnPathResult,
    ship: Pick<ShipState, "provisions" | "provisionAccumulator">,
  ): boolean {
    const budget = availableProvisionUnits(ship);
    const cache = this.budgetCaches.get(result);
    if (!cache) throw new Error("Return path result was not calculated by this system");

    const returnMargin = Number.isFinite(cache.returnCost)
      ? budget - cache.returnCost
      : Number.NEGATIVE_INFINITY;
    const riskLevel = cache.showRisk ? this.classifyMargin(returnMargin) : ReturnRiskLevel.Hidden;
    result.budget = budget;
    result.returnMargin = returnMargin;
    if (riskLevel === result.riskLevel) return false;

    result.riskLevel = riskLevel;
    for (const index of cache.corridorIndices) result.risk[index] = riskLevel;
    result.riskCounts = this.countsFor(riskLevel, cache.corridorIndices.length);
    return true;
  }

  private pathToSupportedResult(
    result: Pick<
      DijkstraResult,
      | "visited"
      | "parents"
      | "parentDirections"
      | "parentImageOffsetX"
      | "parentImageOffsetY"
    >,
    originIndex: number,
  ): { indices: number[]; edges: ReturnPathEdge[] } {
    if (!result.visited[originIndex]) return { indices: [], edges: [] };
    const path = reconstructDijkstraPath(result, originIndex).reverse();
    const destination = path[path.length - 1];
    if (destination === undefined || this.world.getKnowledgeAtIndex(destination) !== KnowledgeState.Supported) {
      return { indices: [], edges: [] };
    }

    const outwardEdges = reconstructDijkstraEdges(result, originIndex);
    const edges: ReturnPathEdge[] = [];
    let cumulativeOffsetX = 0;
    let cumulativeOffsetY = 0;
    for (let position = outwardEdges.length - 1; position >= 0; position--) {
      const outward = outwardEdges[position];
      const outwardDirection = CARDINAL_DIRECTIONS[outward.direction as CardinalDirection];
      if (!outwardDirection) throw new Error("Return path is missing cardinal edge provenance");
      const direction = outwardDirection.reverseDirection;
      const imageOffsetX = outward.imageOffsetX === 0 ? 0 : -outward.imageOffsetX;
      const imageOffsetY = outward.imageOffsetY === 0 ? 0 : -outward.imageOffsetY;
      const from = {
        x: outward.to % this.world.width,
        y: Math.floor(outward.to / this.world.width),
      };
      const to = {
        x: outward.from % this.world.width,
        y: Math.floor(outward.from / this.world.width),
      };
      const liftedFrom = {
        x: from.x + cumulativeOffsetX,
        y: from.y + cumulativeOffsetY,
      };
      cumulativeOffsetX += imageOffsetX;
      cumulativeOffsetY += imageOffsetY;
      const liftedTo = {
        x: to.x + cumulativeOffsetX,
        y: to.y + cumulativeOffsetY,
      };
      edges.push({
        fromIndex: outward.to,
        toIndex: outward.from,
        direction,
        imageOffset: { x: imageOffsetX, y: imageOffsetY },
        destinationImageOffset: { x: cumulativeOffsetX, y: cumulativeOffsetY },
        liftedFrom,
        liftedTo,
      });
    }
    return { indices: path, edges };
  }

  private buildCorridor(pathIndices: readonly number[]): number[] {
    const padding = this.config.overlays.returnPathPadding;
    if (!Number.isInteger(padding) || padding < 0) {
      throw new RangeError("overlays.returnPathPadding must be a non-negative integer");
    }

    const corridor = new Set<number>();
    const queue: number[] = [];
    const depths: number[] = [];
    const tryAdd = (index: number, depth: number): void => {
      if (corridor.has(index) || !this.graph.isNavigationNodePassable(index)) return;
      const knowledge = this.world.getKnowledgeAtIndex(index);
      const renderable = knowledge === KnowledgeState.Personal
        || (knowledge === KnowledgeState.Unknown && this.world.isVisibleNowAtIndex(index));
      if (!renderable) return;
      corridor.add(index);
      queue.push(index);
      depths.push(depth);
    };

    for (const index of pathIndices) tryAdd(index, 0);
    for (let head = 0; head < queue.length; head++) {
      const depth = depths[head];
      if (depth >= padding) continue;
      this.graph.forEachTraversableCardinalEdge(queue[head], (neighbor) => tryAdd(neighbor, depth + 1));
    }
    return [...corridor].sort((left, right) => left - right);
  }

  private findSupportedBoundaryIndices(): number[] {
    this.boundaryWorkspace.clear();
    for (const supportedIndex of this.world.getSupportedPersonalBoundaryIndices()) {
      if (this.hasTraversablePersonalNeighbor(supportedIndex)) {
        this.boundaryWorkspace.add(supportedIndex);
      }
    }
    // A mixed patch may carve a clearance-safe node out of a coarse solid cell,
    // which the legacy coarse boundary cache intentionally cannot represent.
    this.world.forEachFineCollisionMask((_x, _y, _mask, index) => {
      if (!this.graph.isNavigationNodePassable(index)) return;
      const knowledge = this.world.getKnowledgeAtIndex(index);
      if (knowledge === KnowledgeState.Supported && this.hasTraversablePersonalNeighbor(index)) {
        this.boundaryWorkspace.add(index);
      } else if (knowledge === KnowledgeState.Personal) {
        this.graph.forEachTraversableCardinalEdge(index, this.collectSupportedNeighbor);
      }
    });
    for (const visibleIndex of this.world.getVisibleIndices()) {
      if (
        this.world.getKnowledgeAtIndex(visibleIndex) !== KnowledgeState.Unknown
        || !this.graph.isNavigationNodePassable(visibleIndex)
      ) continue;
      this.graph.forEachTraversableCardinalEdge(visibleIndex, this.collectSupportedNeighbor);
    }
    return [...this.boundaryWorkspace].sort((left, right) => left - right);
  }

  private hasTraversablePersonalNeighbor(supportedIndex: number): boolean {
    let found = false;
    this.graph.forEachTraversableCardinalEdge(supportedIndex, (neighbor) => {
      if (this.world.getKnowledgeAtIndex(neighbor) === KnowledgeState.Personal) found = true;
    });
    return found;
  }

  private classifyMargin(margin: number): ReturnRiskLevel {
    return classifyReturnRiskMargin(margin, this.config.returnRisk);
  }

  private countsFor(level: ReturnRiskLevel, count: number): ReturnRiskCounts {
    return {
      comfortable: level === ReturnRiskLevel.Comfortable ? count : 0,
      warning: level === ReturnRiskLevel.Warning ? count : 0,
      critical: level === ReturnRiskLevel.Critical ? count : 0,
      impossible: level === ReturnRiskLevel.Impossible ? count : 0,
    };
  }
}
