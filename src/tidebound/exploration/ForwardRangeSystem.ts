import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { ShipState } from "../core/types";
import { dijkstra, DijkstraWorkspace } from "../navigation/Dijkstra";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import { availableProvisionUnits, knowledgeTravelCost } from "./ProvisionSystem";

export interface ForwardRangeResult {
  /** 1 only for reachable cells which are currently Unknown. */
  mask: Uint8Array;
  /** Reachable Unknown cells in the outermost provision-cost band. */
  presentationMask: Uint8Array;
  costs: Float64Array;
  budget: number;
  reachableCount: number;
  /** Active cells at the true forward exploration limit. */
  frontierCount: number;
  /** Heading used to clip the presentation frontier, in degrees. */
  presentationHeading: number;
  coneHalfAngleDegrees: number;
  /** Unknown cells settled within the search's maximum computed budget. */
  candidateIndices: readonly number[];
  /** Active cells in the outermost Unknown-water cost band. */
  presentationCandidateIndices: readonly number[];
}

interface ForwardBudgetGroup {
  cost: number;
  indices: readonly number[];
}

interface ForwardBudgetCache {
  groups: readonly ForwardBudgetGroup[];
  activeGroupCount: number;
  maximumComputedBudget: number;
  originX: number;
  originY: number;
  presentationHeading: number;
}

export class ForwardRangeSystem {
  private graph: GridGraph;
  private budgetCaches = new WeakMap<ForwardRangeResult, ForwardBudgetCache>();
  private readonly searchWorkspace = new DijkstraWorkspace();
  private readonly startNodes = [0];
  private relaxNeighbor: (neighbor: number, traversalCost: number) => void = () => undefined;
  private readonly visitGraphNeighbor = (neighbor: number): void => {
    const knowledge = this.world.getKnowledgeAtIndex(neighbor);
    // Hidden obstacles must not leak through the range overlay. Unknown cells
    // remain traversable at the configured estimate until they are observed.
    if (
      (knowledge !== KnowledgeState.Unknown || this.world.isVisibleNowAtIndex(neighbor))
      && this.world.isMovementBlockedAtIndex(neighbor)
    ) return;
    this.relaxNeighbor(neighbor, knowledgeTravelCost(knowledge, this.config));
  };
  private readonly forEachSearchNeighbor = (
    node: number,
    visit: (neighbor: number, traversalCost: number) => void,
  ): void => {
    this.relaxNeighbor = visit;
    this.graph.forEachCardinalNeighbor(node, this.visitGraphNeighbor);
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

  calculate(ship: Pick<ShipState, "currentTileX" | "currentTileY" | "heading" | "provisions" | "provisionAccumulator">): ForwardRangeResult {
    if (!this.world.inBounds(ship.currentTileX, ship.currentTileY)) {
      throw new RangeError("Ship tile is outside the world");
    }
    if (!Number.isFinite(this.config.provisions.unknownCost) || this.config.provisions.unknownCost <= 0) {
      throw new RangeError("provisions.unknownCost must be positive to define a forward frontier");
    }
    this.validateCone();
    const presentationHeading = this.normalizeHeading(ship.heading);

    const budget = availableProvisionUnits(ship);
    this.startNodes[0] = this.world.index(ship.currentTileX, ship.currentTileY);
    const result = dijkstra({
      nodeCount: this.world.tileCount,
      starts: this.startNodes,
      maxCost: budget,
      workspace: this.searchWorkspace,
      forEachNeighbor: this.forEachSearchNeighbor,
    });

    const mask = new Uint8Array(this.world.tileCount);
    const presentationMask = new Uint8Array(this.world.tileCount);
    const indicesByCost = new Map<number, number[]>();
    const candidateIndices: number[] = [];
    let reachableCount = 0;
    for (let settled = 0; settled < result.settledCount; settled++) {
      const index = result.settledIndices[settled];
      if (this.world.getKnowledgeAtIndex(index) !== KnowledgeState.Unknown) continue;
      mask[index] = 1;
      candidateIndices.push(index);
      reachableCount++;
      const cost = result.costs[index];
      let group = indicesByCost.get(cost);
      if (!group) {
        group = [];
        indicesByCost.set(cost, group);
      }
      group.push(index);
    }
    const groups = [...indicesByCost]
      .sort(([leftCost], [rightCost]) => leftCost - rightCost)
      .map(([cost, indices]) => ({ cost, indices }));
    const forwardResult: ForwardRangeResult = {
      mask,
      presentationMask,
      costs: result.costs,
      budget,
      reachableCount,
      frontierCount: 0,
      presentationHeading,
      coneHalfAngleDegrees: this.config.overlays.forwardConeHalfAngleDegrees,
      candidateIndices,
      presentationCandidateIndices: [],
    };
    this.budgetCaches.set(forwardResult, {
      groups,
      activeGroupCount: groups.length,
      maximumComputedBudget: budget,
      originX: ship.currentTileX,
      originY: ship.currentTileY,
      presentationHeading,
    });
    this.refreshPresentationFrontier(forwardResult, this.budgetCaches.get(forwardResult)!);
    return forwardResult;
  }

  /** Reuses costs while the logical start tile is unchanged and only cargo has changed. */
  updateBudget(
    result: ForwardRangeResult,
    ship: Pick<ShipState, "heading" | "provisions" | "provisionAccumulator">,
  ): boolean {
    const budget = availableProvisionUnits(ship);
    const cache = this.budgetCaches.get(result);
    if (!cache) throw new Error("Forward range result was not calculated by this system");
    if (budget > cache.maximumComputedBudget) {
      return this.expandComputedBudget(result, cache, ship);
    }

    result.budget = budget;
    cache.presentationHeading = this.normalizeHeading(ship.heading);
    result.presentationHeading = cache.presentationHeading;
    let changed = false;

    while (cache.activeGroupCount > 0 && cache.groups[cache.activeGroupCount - 1].cost > budget) {
      const group = cache.groups[--cache.activeGroupCount];
      for (const index of group.indices) {
        if (result.mask[index] === 0) continue;
        result.mask[index] = 0;
        result.reachableCount--;
        changed = true;
      }
    }
    while (
      cache.activeGroupCount < cache.groups.length
      && cache.groups[cache.activeGroupCount].cost <= budget
    ) {
      const group = cache.groups[cache.activeGroupCount++];
      for (const index of group.indices) {
        if (result.mask[index] === 1) continue;
        result.mask[index] = 1;
        result.reachableCount++;
        changed = true;
      }
    }
    return this.refreshPresentationFrontier(result, cache) || changed;
  }

  /** Reclips only the sparse terminal band; turning never reruns Dijkstra. */
  updateHeading(result: ForwardRangeResult, ship: Pick<ShipState, "heading">): boolean {
    const cache = this.budgetCaches.get(result);
    if (!cache) throw new Error("Forward range result was not calculated by this system");
    const heading = this.normalizeHeading(ship.heading);
    if (heading === cache.presentationHeading) return false;
    cache.presentationHeading = heading;
    result.presentationHeading = heading;
    return this.refreshPresentationFrontier(result, cache);
  }

  /** A provision increase beyond the cost horizon needs one fresh search, but never occurs during normal consumption. */
  private expandComputedBudget(
    result: ForwardRangeResult,
    cache: ForwardBudgetCache,
    ship: Pick<ShipState, "heading" | "provisions" | "provisionAccumulator">,
  ): boolean {
    const refreshed = this.calculate({
      currentTileX: cache.originX,
      currentTileY: cache.originY,
      heading: ship.heading,
      provisions: ship.provisions,
      provisionAccumulator: ship.provisionAccumulator,
    });
    let changed = false;
    for (const index of result.candidateIndices) {
      if (result.mask[index] !== refreshed.mask[index]) changed = true;
      result.mask[index] = refreshed.mask[index];
    }
    for (const index of refreshed.candidateIndices) {
      if (result.mask[index] !== refreshed.mask[index]) changed = true;
      result.mask[index] = refreshed.mask[index];
    }
    if (result.presentationCandidateIndices.length !== refreshed.presentationCandidateIndices.length) {
      changed = true;
    } else {
      for (let position = 0; position < result.presentationCandidateIndices.length; position++) {
        if (result.presentationCandidateIndices[position] === refreshed.presentationCandidateIndices[position]) continue;
        changed = true;
        break;
      }
    }
    for (const index of result.presentationCandidateIndices) result.presentationMask[index] = 0;
    for (const index of refreshed.presentationCandidateIndices) {
      result.presentationMask[index] = refreshed.presentationMask[index];
    }

    result.costs.set(refreshed.costs);
    result.budget = refreshed.budget;
    result.reachableCount = refreshed.reachableCount;
    result.frontierCount = refreshed.frontierCount;
    result.presentationHeading = refreshed.presentationHeading;
    result.coneHalfAngleDegrees = refreshed.coneHalfAngleDegrees;
    result.candidateIndices = refreshed.candidateIndices;
    result.presentationCandidateIndices = refreshed.presentationCandidateIndices;
    const refreshedCache = this.budgetCaches.get(refreshed)!;
    this.budgetCaches.set(result, refreshedCache);
    this.budgetCaches.delete(refreshed);
    return changed;
  }

  /**
   * Present only the final Unknown-water cost band. Unlike a ship-centred clip,
   * this contour is already at the voyage limit when the ship first leaves
   * Supported water and stays world-anchored as equal-cost Unknown travel is
   * exchanged for remaining provisions.
   */
  private refreshPresentationFrontier(
    result: ForwardRangeResult,
    cache: ForwardBudgetCache,
  ): boolean {
    const previous = result.presentationCandidateIndices;
    const next: number[] = [];
    const bandWidth = this.config.provisions.unknownCost;
    const minimumCost = result.budget - bandWidth;

    for (const group of cache.groups) {
      if (group.cost > result.budget) break;
      if (group.cost <= minimumCost) continue;
      for (const index of group.indices) {
        if (this.isInsidePresentationCone(index, cache)) next.push(index);
      }
    }

    let changed = previous.length !== next.length;
    if (!changed) {
      for (let index = 0; index < next.length; index++) {
        if (previous[index] === next[index]) continue;
        changed = true;
        break;
      }
    }

    for (const index of previous) result.presentationMask[index] = 0;
    for (const index of next) result.presentationMask[index] = 1;
    result.presentationCandidateIndices = next;
    result.frontierCount = next.length;
    return changed;
  }

  private isInsidePresentationCone(index: number, cache: ForwardBudgetCache): boolean {
    const x = index % this.world.width;
    const y = Math.floor(index / this.world.width);
    const dx = x - cache.originX;
    const dy = y - cache.originY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return true;
    const radians = cache.presentationHeading * Math.PI / 180;
    const forwardDot = dx * Math.cos(radians) + dy * Math.sin(radians);
    const minimumDot = distance * Math.cos(this.config.overlays.forwardConeHalfAngleDegrees * Math.PI / 180);
    return forwardDot >= minimumDot - 1e-10;
  }

  private validateCone(): void {
    const halfAngle = this.config.overlays.forwardConeHalfAngleDegrees;
    if (!Number.isFinite(halfAngle) || halfAngle <= 0 || halfAngle > 180) {
      throw new RangeError("overlays.forwardConeHalfAngleDegrees must be greater than 0 and at most 180");
    }
  }

  private normalizeHeading(heading: number): number {
    if (!Number.isFinite(heading)) throw new RangeError("Ship heading must be finite");
    return ((heading % 360) + 360) % 360;
  }
}
