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
  /** Advances only when the logical reachable mask changes. */
  logicalRevision: number;
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
  headingCosine: number;
  headingSine: number;
  coneCosine: number;
}

export class ForwardRangeSystem {
  private graph: GridGraph;
  private budgetCaches = new WeakMap<ForwardRangeResult, ForwardBudgetCache>();
  private readonly searchWorkspace = new DijkstraWorkspace();
  private readonly startNodes = [0];
  private relaxNeighbor: (neighbor: number, traversalCost: number) => void = () => undefined;
  private readonly visitGraphNeighbor = (neighbor: number): void => {
    const knowledge = this.world.getKnowledgeAtIndex(neighbor);
    // The known-edge sweep already rejects discovered collision while filtering
    // geometry in unseen Unknown cells so this overlay cannot leak obstacles.
    this.relaxNeighbor(neighbor, knowledgeTravelCost(knowledge, this.config));
  };
  private readonly forEachSearchNeighbor = (
    node: number,
    visit: (neighbor: number, traversalCost: number) => void,
  ): void => {
    this.relaxNeighbor = visit;
    this.graph.forEachKnownTraversableCardinalNeighbor(node, this.visitGraphNeighbor);
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

  calculate(ship: Pick<ShipState, "currentTileX" | "currentTileY" | "heading" | "provisions" | "provisionAccumulator">): ForwardRangeResult {
    return this.calculateResult(ship);
  }

  /**
   * Recalculates after a tile/knowledge change while retaining the two
   * world-sized masks. This is the hot-path counterpart to `calculate` for
   * long-lived simulations.
   */
  recalculate(
    result: ForwardRangeResult,
    ship: Pick<ShipState, "currentTileX" | "currentTileY" | "heading" | "provisions" | "provisionAccumulator">,
  ): ForwardRangeResult {
    if (!this.budgetCaches.has(result)) {
      throw new Error("Forward range result was not calculated by this system");
    }
    return this.calculateResult(ship, result);
  }

  private calculateResult(
    ship: Pick<ShipState, "currentTileX" | "currentTileY" | "heading" | "provisions" | "provisionAccumulator">,
    reusable?: ForwardRangeResult,
  ): ForwardRangeResult {
    if (!this.world.inBounds(ship.currentTileX, ship.currentTileY)) {
      throw new RangeError("Ship tile is outside the world");
    }
    // A zero Unknown cost intentionally exposes every connected reachable tile and produces no
    // finite outer provision band; this supports testing with consumption disabled.
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

    const mask = reusable?.mask.length === this.world.tileCount
      ? reusable.mask
      : new Uint8Array(this.world.tileCount);
    const presentationMask = reusable?.presentationMask.length === this.world.tileCount
      ? reusable.presentationMask
      : new Uint8Array(this.world.tileCount);
    if (reusable && mask === reusable.mask) {
      for (const index of reusable.candidateIndices) mask[index] = 0;
    }
    if (reusable && presentationMask === reusable.presentationMask) {
      for (const index of reusable.presentationCandidateIndices) presentationMask[index] = 0;
    }
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
    const nextValues: ForwardRangeResult = {
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
      logicalRevision: reusable ? reusable.logicalRevision + 1 : 1,
    };
    const forwardResult = reusable ?? nextValues;
    if (reusable) Object.assign(reusable, nextValues);
    const radians = presentationHeading * Math.PI / 180;
    this.budgetCaches.set(forwardResult, {
      groups,
      activeGroupCount: groups.length,
      maximumComputedBudget: budget,
      originX: ship.currentTileX,
      originY: ship.currentTileY,
      presentationHeading,
      headingCosine: Math.cos(radians),
      headingSine: Math.sin(radians),
      coneCosine: Math.cos(this.config.overlays.forwardConeHalfAngleDegrees * Math.PI / 180),
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
    this.setPresentationHeading(cache, this.normalizeHeading(ship.heading));
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
    const presentationChanged = this.refreshPresentationFrontier(result, cache);
    if (changed) result.logicalRevision++;
    return presentationChanged || changed;
  }

  /** Reclips only the sparse terminal band; turning never reruns Dijkstra. */
  updateHeading(result: ForwardRangeResult, ship: Pick<ShipState, "heading">): boolean {
    const cache = this.budgetCaches.get(result);
    if (!cache) throw new Error("Forward range result was not calculated by this system");
    const heading = this.normalizeHeading(ship.heading);
    if (heading === cache.presentationHeading) return false;
    this.setPresentationHeading(cache, heading);
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
    let changed = result.reachableCount !== refreshed.reachableCount;
    if (!changed) {
      for (const index of result.candidateIndices) {
        if (result.mask[index] === refreshed.mask[index]) continue;
        changed = true;
        break;
      }
    }
    // Clear the previous sparse domain before applying the new one. In
    // particular, cells which became known or unreachable must not survive an
    // expansion merely because they are absent from the refreshed candidates.
    for (const index of result.candidateIndices) result.mask[index] = 0;
    for (const index of refreshed.candidateIndices) result.mask[index] = 1;
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
    for (const index of refreshed.presentationCandidateIndices) result.presentationMask[index] = 1;

    result.costs.set(refreshed.costs);
    result.budget = refreshed.budget;
    result.reachableCount = refreshed.reachableCount;
    result.frontierCount = refreshed.frontierCount;
    result.presentationHeading = refreshed.presentationHeading;
    result.coneHalfAngleDegrees = refreshed.coneHalfAngleDegrees;
    result.candidateIndices = refreshed.candidateIndices;
    result.presentationCandidateIndices = refreshed.presentationCandidateIndices;
    if (changed) result.logicalRevision++;
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

    let lower = 0;
    let upper = cache.activeGroupCount;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (cache.groups[middle].cost <= minimumCost) lower = middle + 1;
      else upper = middle;
    }

    for (let groupIndex = lower; groupIndex < cache.activeGroupCount; groupIndex++) {
      const group = cache.groups[groupIndex];
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
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared === 0) return true;
    const forwardDot = dx * cache.headingCosine + dy * cache.headingSine;
    const thresholdSquared = distanceSquared * cache.coneCosine * cache.coneCosine;
    if (cache.coneCosine >= 0) {
      return forwardDot >= -1e-10 && forwardDot * forwardDot >= thresholdSquared - 1e-10;
    }
    return forwardDot >= -1e-10 || forwardDot * forwardDot <= thresholdSquared + 1e-10;
  }

  private setPresentationHeading(cache: ForwardBudgetCache, heading: number): void {
    cache.presentationHeading = heading;
    const radians = heading * Math.PI / 180;
    cache.headingCosine = Math.cos(radians);
    cache.headingSine = Math.sin(radians);
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
