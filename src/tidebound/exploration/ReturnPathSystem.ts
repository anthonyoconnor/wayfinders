import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, ShipState } from "../core/types";
import { dijkstra, DijkstraWorkspace, type DijkstraResult } from "../navigation/Dijkstra";
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
  margins: Float64Array;
  risk: Uint8Array;
  budget: number;
  supportedBoundaryIndices: readonly number[];
  riskCounts: ReturnRiskCounts;
  /** Unblocked Personal cells represented by the margin/risk arrays. */
  personalIndices: readonly number[];
}

export interface ReturnRiskCounts {
  comfortable: number;
  warning: number;
  critical: number;
  impossible: number;
}

interface ReturnBudgetCache {
  personalIndices: readonly number[];
}

export class ReturnPathSystem {
  private graph: GridGraph;
  private budgetCaches = new WeakMap<ReturnPathResult, ReturnBudgetCache>();
  private readonly searchWorkspace = new DijkstraWorkspace();
  private readonly boundaryWorkspace = new Set<number>();
  private relaxNeighbor: (neighbor: number, traversalCost: number) => void = () => undefined;
  private readonly visitGraphNeighbor = (neighbor: number): void => {
    if (this.world.isMovementBlockedAtIndex(neighbor)) return;
    const knowledge = this.world.getKnowledgeAtIndex(neighbor);
    if (knowledge === KnowledgeState.Unknown) return;
    this.relaxNeighbor(neighbor, knowledgeTravelCost(knowledge, this.config));
  };
  private readonly forEachSearchNeighbor = (
    node: number,
    visit: (neighbor: number, traversalCost: number) => void,
  ): void => {
    this.relaxNeighbor = visit;
    this.graph.forEachCardinalNeighbor(node, this.visitGraphNeighbor);
  };
  private readonly collectSupportedNeighbor = (neighbor: number): void => {
    if (
      this.world.getKnowledgeAtIndex(neighbor) === KnowledgeState.Supported
      && !this.world.isMovementBlockedAtIndex(neighbor)
    ) this.boundaryWorkspace.add(neighbor);
  };

  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {
    this.graph = new GridGraph(world);
  }

  setWorld(world: WorldGrid): void {
    this.world = world;
    this.graph = new GridGraph(world);
    this.budgetCaches = new WeakMap();
  }

  calculate(ship: Pick<ShipState, "provisions" | "provisionAccumulator">): ReturnPathResult {
    const supportedBoundaryIndices = this.findSupportedBoundaryIndices();
    const search = dijkstra({
      nodeCount: this.world.tileCount,
      starts: supportedBoundaryIndices,
      workspace: this.searchWorkspace,
      forEachNeighbor: this.forEachSearchNeighbor,
    });

    const budget = availableProvisionUnits(ship);
    const margins = new Float64Array(this.world.tileCount);
    const risk = new Uint8Array(this.world.tileCount);
    const riskCounts: ReturnRiskCounts = { comfortable: 0, warning: 0, critical: 0, impossible: 0 };
    const personalIndices: number[] = [];
    margins.fill(Number.NaN);

    for (const index of this.world.getPersonalKnowledgeIndices()) {
      if (this.world.isMovementBlockedAtIndex(index)) continue;
      personalIndices.push(index);
      const returnCost = search.costs[index];
      const margin = Number.isFinite(returnCost) ? budget - returnCost : Number.NEGATIVE_INFINITY;
      const level = this.classifyMargin(margin);
      margins[index] = margin;
      risk[index] = level;
      this.incrementRiskCount(riskCounts, level);
    }

    const returnResult = {
      ...search,
      margins,
      risk,
      budget,
      supportedBoundaryIndices,
      riskCounts,
      personalIndices,
    };
    this.budgetCaches.set(returnResult, { personalIndices });
    return returnResult;
  }

  pathToSupported(result: Pick<ReturnPathResult, "visited" | "parents">, from: GridPoint): GridPoint[] {
    if (!this.world.inBounds(from.x, from.y)) throw new RangeError("Return path origin is outside the world");
    if (this.world.getKnowledge(from.x, from.y) === KnowledgeState.Unknown) return [];
    if (this.world.isMovementBlocked(from.x, from.y)) return [];
    if (this.world.getKnowledge(from.x, from.y) === KnowledgeState.Supported) return [{ ...from }];

    let index = this.world.index(from.x, from.y);
    if (!result.visited[index]) return [];
    const path: GridPoint[] = [];
    const seen = new Uint8Array(this.world.tileCount);

    while (!seen[index]) {
      seen[index] = 1;
      const point = this.world.pointFromIndex(index);
      path.push(point);
      if (this.world.getKnowledge(point.x, point.y) === KnowledgeState.Supported) return path;
      const parent = result.parents[index];
      if (parent < 0) break;
      index = parent;
    }
    return [];
  }

  /** Reclassifies existing known-water costs without rerunning Dijkstra. */
  updateBudget(
    result: ReturnPathResult,
    ship: Pick<ShipState, "provisions" | "provisionAccumulator">,
  ): boolean {
    const budget = availableProvisionUnits(ship);
    const cache = this.budgetCaches.get(result);
    if (!cache) throw new Error("Return path result was not calculated by this system");
    result.budget = budget;
    let changed = false;
    for (const index of cache.personalIndices) {
      const returnCost = result.costs[index];
      const margin = Number.isFinite(returnCost) ? budget - returnCost : Number.NEGATIVE_INFINITY;
      const level = this.classifyMargin(margin);
      result.margins[index] = margin;
      if (result.risk[index] === level) continue;
      this.decrementRiskCount(result.riskCounts, result.risk[index]);
      result.risk[index] = level;
      this.incrementRiskCount(result.riskCounts, level);
      changed = true;
    }
    return changed;
  }

  private findSupportedBoundaryIndices(): number[] {
    this.boundaryWorkspace.clear();
    for (const personalIndex of this.world.getPersonalKnowledgeIndices()) {
      if (this.world.isMovementBlockedAtIndex(personalIndex)) continue;
      this.graph.forEachCardinalNeighbor(personalIndex, this.collectSupportedNeighbor);
    }
    return [...this.boundaryWorkspace].sort((left, right) => left - right);
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

  private incrementRiskCount(counts: ReturnRiskCounts, level: ReturnRiskLevel): void {
    switch (level) {
      case ReturnRiskLevel.Comfortable: counts.comfortable++; break;
      case ReturnRiskLevel.Warning: counts.warning++; break;
      case ReturnRiskLevel.Critical: counts.critical++; break;
      case ReturnRiskLevel.Impossible: counts.impossible++; break;
    }
  }

  private decrementRiskCount(counts: ReturnRiskCounts, level: ReturnRiskLevel): void {
    switch (level) {
      case ReturnRiskLevel.Comfortable: counts.comfortable--; break;
      case ReturnRiskLevel.Warning: counts.warning--; break;
      case ReturnRiskLevel.Critical: counts.critical--; break;
      case ReturnRiskLevel.Impossible: counts.impossible--; break;
    }
  }
}
