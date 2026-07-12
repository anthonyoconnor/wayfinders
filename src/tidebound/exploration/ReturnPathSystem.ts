import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, ShipState } from "../core/types";
import { dijkstra, type DijkstraResult } from "../navigation/Dijkstra";
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
}

export class ReturnPathSystem {
  private graph: GridGraph;

  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {
    this.graph = new GridGraph(world);
  }

  setWorld(world: WorldGrid): void {
    this.world = world;
    this.graph = new GridGraph(world);
  }

  calculate(ship: Pick<ShipState, "provisions" | "provisionAccumulator">): ReturnPathResult {
    const supportedBoundaryIndices = this.findSupportedBoundaryIndices();
    const search = dijkstra({
      nodeCount: this.world.tileCount,
      starts: supportedBoundaryIndices.map((node) => ({ node })),
      forEachNeighbor: (node, visit) => {
        this.graph.forEachCardinalNeighbor(node, (neighbor, x, y) => {
          if (this.world.isMovementBlocked(x, y)) return;
          const knowledge = this.world.getKnowledge(x, y);
          if (knowledge === KnowledgeState.Unknown) return;
          visit(neighbor, knowledgeTravelCost(knowledge, this.config));
        });
      },
    });

    const budget = availableProvisionUnits(ship);
    const margins = new Float64Array(this.world.tileCount);
    const risk = new Uint8Array(this.world.tileCount);
    margins.fill(Number.NaN);

    for (let index = 0; index < this.world.tileCount; index++) {
      const point = this.world.pointFromIndex(index);
      if (this.world.getKnowledge(point.x, point.y) !== KnowledgeState.Personal) continue;
      if (this.world.isMovementBlocked(point.x, point.y)) continue;
      const returnCost = search.costs[index];
      const margin = Number.isFinite(returnCost) ? budget - returnCost : Number.NEGATIVE_INFINITY;
      margins[index] = margin;
      risk[index] = this.classifyMargin(margin);
    }

    return { ...search, margins, risk, budget, supportedBoundaryIndices };
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
    result.budget = budget;
    let changed = false;
    for (let index = 0; index < this.world.tileCount; index++) {
      const point = this.world.pointFromIndex(index);
      if (
        this.world.getKnowledge(point.x, point.y) !== KnowledgeState.Personal
        || this.world.isMovementBlocked(point.x, point.y)
      ) continue;
      const returnCost = result.costs[index];
      const margin = Number.isFinite(returnCost) ? budget - returnCost : Number.NEGATIVE_INFINITY;
      const level = this.classifyMargin(margin);
      result.margins[index] = margin;
      if (result.risk[index] === level) continue;
      result.risk[index] = level;
      changed = true;
    }
    return changed;
  }

  private findSupportedBoundaryIndices(): number[] {
    const boundary: number[] = [];
    this.world.forEachTile((x, y, index) => {
      if (this.world.getKnowledge(x, y) !== KnowledgeState.Supported || this.world.isMovementBlocked(x, y)) return;
      let touchesPersonal = false;
      this.graph.forEachCardinalNeighbor(index, (_neighbor, neighborX, neighborY) => {
        if (
          this.world.getKnowledge(neighborX, neighborY) === KnowledgeState.Personal
          && !this.world.isMovementBlocked(neighborX, neighborY)
        ) {
          touchesPersonal = true;
        }
      });
      if (touchesPersonal) boundary.push(index);
    });
    return boundary;
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
}
