import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { ShipState } from "../core/types";
import { dijkstra } from "../navigation/Dijkstra";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import { availableProvisionUnits, knowledgeTravelCost } from "./ProvisionSystem";

export interface ForwardRangeResult {
  /** 1 only for reachable cells which are currently Unknown. */
  mask: Uint8Array;
  costs: Float64Array;
  budget: number;
}

export class ForwardRangeSystem {
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

  calculate(ship: Pick<ShipState, "currentTileX" | "currentTileY" | "provisions" | "provisionAccumulator">): ForwardRangeResult {
    if (!this.world.inBounds(ship.currentTileX, ship.currentTileY)) {
      throw new RangeError("Ship tile is outside the world");
    }

    const budget = availableProvisionUnits(ship);
    const result = dijkstra({
      nodeCount: this.world.tileCount,
      starts: [{ node: this.world.index(ship.currentTileX, ship.currentTileY) }],
      maxCost: budget,
      forEachNeighbor: (node, visit) => {
        this.graph.forEachCardinalNeighbor(node, (neighbor, x, y) => {
          const knowledge = this.world.getKnowledge(x, y);
          // Hidden obstacles must not leak through the range overlay. Unknown
          // cells always use the configured Unknown cost and remain traversable
          // to this estimate until observed.
          if (
            (knowledge !== KnowledgeState.Unknown || this.world.isVisibleNow(x, y))
            && this.world.isMovementBlocked(x, y)
          ) return;
          visit(neighbor, knowledgeTravelCost(knowledge, this.config));
        });
      },
    });

    const mask = new Uint8Array(this.world.tileCount);
    for (let index = 0; index < mask.length; index++) {
      if (!result.visited[index]) continue;
      const point = this.world.pointFromIndex(index);
      if (this.world.getKnowledge(point.x, point.y) === KnowledgeState.Unknown) mask[index] = 1;
    }
    return { mask, costs: result.costs, budget };
  }

  /** Reuses costs while the logical start tile is unchanged and only cargo has changed. */
  updateBudget(
    result: ForwardRangeResult,
    ship: Pick<ShipState, "provisions" | "provisionAccumulator">,
  ): boolean {
    const budget = availableProvisionUnits(ship);
    result.budget = budget;
    let changed = false;
    for (let index = 0; index < result.mask.length; index++) {
      const point = this.world.pointFromIndex(index);
      const next = result.costs[index] <= budget
        && this.world.getKnowledge(point.x, point.y) === KnowledgeState.Unknown
        ? 1
        : 0;
      if (result.mask[index] === next) continue;
      result.mask[index] = next;
      changed = true;
    }
    return changed;
  }
}
