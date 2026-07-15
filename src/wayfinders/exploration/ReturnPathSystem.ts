import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, ShipState } from "../core/types";
import {
  dijkstra,
  DijkstraWorkspace,
  reconstructDijkstraPath,
  type DijkstraResult,
} from "../navigation/Dijkstra";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import { availableProvisionUnits, knowledgeTravelCost } from "./ProvisionSystem";

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
  /** Passable Personal/currently-visible cells within configured padding of the path. */
  corridorIndices: readonly number[];
  returnCost: number;
  returnMargin: number;
  riskLevel: ReturnRiskLevel;
  riskCounts: ReturnRiskCounts;
}

export interface ReturnRiskCounts {
  comfortable: number;
  warning: number;
  critical: number;
  impossible: number;
}

interface ReturnBudgetCache {
  corridorIndices: readonly number[];
  returnCost: number;
  showRisk: boolean;
}

export class ReturnPathSystem {
  private graph: GridGraph;
  private budgetCaches = new WeakMap<ReturnPathResult, ReturnBudgetCache>();
  private readonly searchWorkspace = new DijkstraWorkspace();
  private readonly boundaryWorkspace = new Set<number>();
  private relaxNeighbor: (neighbor: number, traversalCost: number) => void = () => undefined;
  private readonly visitGraphNeighbor = (neighbor: number): void => {
    const knowledge = this.world.getKnowledgeAtIndex(neighbor);
    // Supported boundary cells are the search roots. There is no reason to
    // flood the interior zero-cost Supported component after leaving a root.
    if (knowledge === KnowledgeState.Supported) return;
    // Current sight is known to the player even though outward-travel water is
    // intentionally not committed to Personal until it falls behind the ship.
    if (knowledge === KnowledgeState.Unknown && !this.world.isVisibleNowAtIndex(neighbor)) return;
    this.relaxNeighbor(neighbor, knowledgeTravelCost(knowledge, this.config));
  };
  private readonly forEachSearchNeighbor = (
    node: number,
    visit: (neighbor: number, traversalCost: number) => void,
  ): void => {
    this.relaxNeighbor = visit;
    this.graph.forEachTraversableCardinalNeighbor(node, this.visitGraphNeighbor);
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
    const pathIndices = this.pathIndicesToSupported(search, originIndex);
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

  private pathIndicesToSupported(
    result: Pick<DijkstraResult, "visited" | "parents">,
    originIndex: number,
  ): number[] {
    if (!result.visited[originIndex]) return [];
    const path = reconstructDijkstraPath(result, originIndex).reverse();
    const destination = path[path.length - 1];
    if (destination === undefined || this.world.getKnowledgeAtIndex(destination) !== KnowledgeState.Supported) {
      return [];
    }
    return path;
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
      this.graph.forEachTraversableCardinalNeighbor(queue[head], (neighbor) => tryAdd(neighbor, depth + 1));
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
        this.graph.forEachTraversableCardinalNeighbor(index, this.collectSupportedNeighbor);
      }
    });
    for (const visibleIndex of this.world.getVisibleIndices()) {
      if (
        this.world.getKnowledgeAtIndex(visibleIndex) !== KnowledgeState.Unknown
        || !this.graph.isNavigationNodePassable(visibleIndex)
      ) continue;
      this.graph.forEachTraversableCardinalNeighbor(visibleIndex, this.collectSupportedNeighbor);
    }
    return [...this.boundaryWorkspace].sort((left, right) => left - right);
  }

  private hasTraversablePersonalNeighbor(supportedIndex: number): boolean {
    let found = false;
    this.graph.forEachTraversableCardinalNeighbor(supportedIndex, (neighbor) => {
      if (this.world.getKnowledgeAtIndex(neighbor) === KnowledgeState.Personal) found = true;
    });
    return found;
  }

  private classifyMargin(margin: number): ReturnRiskLevel {
    const thresholds = this.config.returnRisk;
    if (![thresholds.comfortable, thresholds.warning, thresholds.critical].every(Number.isFinite)) {
      throw new RangeError("Return-risk thresholds must be finite");
    }
    if (margin >= thresholds.comfortable) return ReturnRiskLevel.Comfortable;
    if (margin >= thresholds.warning) return ReturnRiskLevel.Warning;
    if (margin >= thresholds.critical) return ReturnRiskLevel.Critical;
    return ReturnRiskLevel.Impossible;
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
