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
  /** Reachable Unknown cells inside the ship-local presentation focus. */
  presentationMask: Uint8Array;
  costs: Float64Array;
  budget: number;
  reachableCount: number;
  /** Active reachable candidates inside the focus, before current-sight suppression. */
  focusCount: number;
  /** Unknown cells settled within the search's maximum computed budget. */
  candidateIndices: readonly number[];
  /** Candidate subset inside sight radius plus configured focus padding. */
  presentationCandidateIndices: readonly number[];
  focusRadius: number;
}

interface ForwardBudgetGroup {
  cost: number;
  indices: readonly number[];
  presentationIndices: readonly number[];
}

interface ForwardBudgetCache {
  groups: readonly ForwardBudgetGroup[];
  activeGroupCount: number;
  maximumComputedBudget: number;
  originX: number;
  originY: number;
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

  calculate(ship: Pick<ShipState, "currentTileX" | "currentTileY" | "provisions" | "provisionAccumulator">): ForwardRangeResult {
    if (!this.world.inBounds(ship.currentTileX, ship.currentTileY)) {
      throw new RangeError("Ship tile is outside the world");
    }

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
    const indicesByCost = new Map<number, { indices: number[]; presentationIndices: number[] }>();
    const candidateIndices: number[] = [];
    const presentationCandidateIndices: number[] = [];
    const focusRadius = this.config.navigation.sightRadius + this.config.overlays.forwardFocusPadding;
    const focusRadiusSquared = focusRadius * focusRadius;
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
        group = { indices: [], presentationIndices: [] };
        indicesByCost.set(cost, group);
      }
      group.indices.push(index);

      const x = index % this.world.width;
      const y = Math.floor(index / this.world.width);
      const dx = x - ship.currentTileX;
      const dy = y - ship.currentTileY;
      if (dx * dx + dy * dy <= focusRadiusSquared) {
        presentationMask[index] = 1;
        presentationCandidateIndices.push(index);
        group.presentationIndices.push(index);
      }
    }
    const groups = [...indicesByCost]
      .sort(([leftCost], [rightCost]) => leftCost - rightCost)
      .map(([cost, group]) => ({ cost, ...group }));
    const forwardResult = {
      mask,
      presentationMask,
      costs: result.costs,
      budget,
      reachableCount,
      focusCount: presentationCandidateIndices.length,
      candidateIndices,
      presentationCandidateIndices,
      focusRadius,
    };
    this.budgetCaches.set(forwardResult, {
      groups,
      activeGroupCount: groups.length,
      maximumComputedBudget: budget,
      originX: ship.currentTileX,
      originY: ship.currentTileY,
    });
    return forwardResult;
  }

  /** Reuses costs while the logical start tile is unchanged and only cargo has changed. */
  updateBudget(
    result: ForwardRangeResult,
    ship: Pick<ShipState, "provisions" | "provisionAccumulator">,
  ): boolean {
    const budget = availableProvisionUnits(ship);
    const cache = this.budgetCaches.get(result);
    if (!cache) throw new Error("Forward range result was not calculated by this system");
    if (budget > cache.maximumComputedBudget) {
      return this.expandComputedBudget(result, cache, ship);
    }

    result.budget = budget;
    let changed = false;

    while (cache.activeGroupCount > 0 && cache.groups[cache.activeGroupCount - 1].cost > budget) {
      const group = cache.groups[--cache.activeGroupCount];
      for (const index of group.indices) {
        if (result.mask[index] === 0) continue;
        result.mask[index] = 0;
        result.reachableCount--;
        changed = true;
      }
      for (const index of group.presentationIndices) {
        if (result.presentationMask[index] === 0) continue;
        result.presentationMask[index] = 0;
        result.focusCount--;
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
      for (const index of group.presentationIndices) {
        if (result.presentationMask[index] === 1) continue;
        result.presentationMask[index] = 1;
        result.focusCount++;
      }
    }
    return changed;
  }

  /** A provision increase beyond the cost horizon needs one fresh search, but never occurs during normal consumption. */
  private expandComputedBudget(
    result: ForwardRangeResult,
    cache: ForwardBudgetCache,
    ship: Pick<ShipState, "provisions" | "provisionAccumulator">,
  ): boolean {
    const refreshed = this.calculate({
      currentTileX: cache.originX,
      currentTileY: cache.originY,
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
    for (const index of result.presentationCandidateIndices) result.presentationMask[index] = 0;
    for (const index of refreshed.presentationCandidateIndices) {
      if (result.presentationMask[index] !== refreshed.presentationMask[index]) changed = true;
      result.presentationMask[index] = refreshed.presentationMask[index];
    }

    result.costs.set(refreshed.costs);
    result.budget = refreshed.budget;
    result.reachableCount = refreshed.reachableCount;
    result.focusCount = refreshed.focusCount;
    result.candidateIndices = refreshed.candidateIndices;
    result.presentationCandidateIndices = refreshed.presentationCandidateIndices;
    result.focusRadius = refreshed.focusRadius;
    const refreshedCache = this.budgetCaches.get(refreshed)!;
    this.budgetCaches.set(result, refreshedCache);
    this.budgetCaches.delete(refreshed);
    return changed;
  }
}
