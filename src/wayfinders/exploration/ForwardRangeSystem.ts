import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { ShipState } from "../core/types";
import {
  BucketedCostSearchWorkspace,
  type BucketedCostSearchResult,
} from "../navigation/BucketedCostSearch";
import { dijkstra, DijkstraWorkspace } from "../navigation/Dijkstra";
import { GridGraph } from "../navigation/GridGraph";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import { availableProvisionUnits, knowledgeTravelCost } from "./ProvisionSystem";
import type {
  ForwardGuidance,
  ForwardGuidanceShip,
  ForwardGuidanceTask,
  ForwardGuidanceTaskStep,
  ForwardGuidanceWorkBudget,
} from "./ForwardGuidance";

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

interface ForwardBudgetCache {
  groupCosts: number[];
  /** Exclusive candidateIndices end position for each corresponding cost group. */
  groupEnds: number[];
  activeGroupCount: number;
  maximumComputedBudget: number;
  originX: number;
  originY: number;
  presentationHeading: number;
  headingCosine: number;
  headingSine: number;
  coneCosine: number;
  spareCandidateIndices: number[];
  sparePresentationIndices: number[];
}

interface ForwardResultBuffers {
  mask: Uint8Array;
  presentationMask: Uint8Array;
  costs: Float64Array;
  candidateIndices: number[];
  presentationCandidateIndices: number[];
  finiteCostIndices: number[];
}

type IncrementalForwardStage =
  | "clear-mask"
  | "clear-presentation"
  | "clear-costs"
  | "search"
  | "collect"
  | "compare-previous"
  | "frontier"
  | "complete";

interface IncrementalForwardState {
  readonly published: ForwardRangeResult;
  readonly ship: ForwardGuidanceShip;
  readonly buffer: ForwardResultBuffers;
  readonly budget: number;
  readonly presentationHeading: number;
  readonly groupCosts: number[];
  readonly groupEnds: number[];
  stage: IncrementalForwardStage;
  cancelled: boolean;
  bufferReleased: boolean;
  maskClearPosition: number;
  presentationClearPosition: number;
  costClearPosition: number;
  collectPosition: number;
  comparePosition: number;
  frontierPosition: number;
  frontierEnd: number;
  previousCost?: number;
  logicalChanged: boolean;
  searchResult?: Pick<BucketedCostSearchResult, "costs" | "settledIndices" | "settledCount">;
  cache?: ForwardBudgetCache;
  result?: ForwardRangeResult;
}

export class ForwardRangeSystem implements ForwardGuidance {
  private graph: GridGraph;
  private budgetCaches = new WeakMap<ForwardRangeResult, ForwardBudgetCache>();
  private readonly searchWorkspace = new DijkstraWorkspace();
  private readonly bucketedSearchWorkspace = new BucketedCostSearchWorkspace();
  private incrementalSearchWorkspace = new BucketedCostSearchWorkspace();
  private integerCostScale = 1;
  private readonly integerTravelCosts = new Int32Array(3);
  private readonly startNodes = [0];
  private activeIncrementalTask?: IncrementalForwardState;
  private readonly incrementalBufferPool: ForwardResultBuffers[] = [];
  private readonly resultBuffers = new WeakMap<ForwardRangeResult, ForwardResultBuffers>();
  private incrementalBuffersAllocated = 0;
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
  private relaxIntegerNeighbor: (neighbor: number, traversalCostUnits: number) => void = () => undefined;
  private readonly visitIntegerGraphNeighbor = (neighbor: number): void => {
    const knowledge = this.world.getKnowledgeAtIndex(neighbor);
    this.relaxIntegerNeighbor(neighbor, this.integerTravelCosts[knowledge]);
  };
  private readonly forEachIntegerSearchNeighbor = (
    node: number,
    visit: (neighbor: number, traversalCostUnits: number) => void,
  ): void => {
    this.relaxIntegerNeighbor = visit;
    this.graph.forEachKnownTraversableCardinalNeighbor(node, this.visitIntegerGraphNeighbor);
  };

  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {
    this.graph = new GridGraph(world, config);
    this.refreshIntegerTravelCosts();
    this.prewarmIncrementalResources();
  }

  setWorld(world: WorldGrid): void {
    this.cancelActiveIncrementalTask();
    this.world = world;
    this.graph = new GridGraph(world, this.config);
    this.budgetCaches = new WeakMap();
    this.incrementalSearchWorkspace = new BucketedCostSearchWorkspace();
    this.incrementalBufferPool.length = 0;
    this.incrementalBuffersAllocated = 0;
    this.refreshIntegerTravelCosts();
    this.prewarmIncrementalResources();
  }

  calculate(ship: Pick<ShipState, "currentTileX" | "currentTileY" | "heading" | "provisions" | "provisionAccumulator">): ForwardRangeResult {
    this.refreshIntegerTravelCosts();
    return this.calculateResult(ship);
  }

  /**
   * Starts exact forward guidance in an inactive buffer. The published result
   * is read-only until a completed task is atomically adopted by the caller.
   */
  beginTask(
    published: ForwardRangeResult,
    ship: ForwardGuidanceShip,
  ): ForwardGuidanceTask {
    this.cancelActiveIncrementalTask();
    this.refreshIntegerTravelCosts();
    if (!this.world.inBounds(ship.currentTileX, ship.currentTileY)) {
      throw new RangeError("Ship tile is outside the world");
    }
    this.validateCone();
    const snapshot: ForwardGuidanceShip = Object.freeze({
      currentTileX: ship.currentTileX,
      currentTileY: ship.currentTileY,
      heading: ship.heading,
      provisions: ship.provisions,
      provisionAccumulator: ship.provisionAccumulator,
    });

    const buffer = this.acquireIncrementalBuffer();
    const budget = availableProvisionUnits(snapshot);
    const state: IncrementalForwardState = {
      published,
      ship: snapshot,
      buffer,
      budget,
      presentationHeading: this.normalizeHeading(snapshot.heading),
      groupCosts: [],
      groupEnds: [],
      stage: "clear-mask",
      cancelled: false,
      bufferReleased: false,
      maskClearPosition: 0,
      presentationClearPosition: 0,
      costClearPosition: 0,
      collectPosition: 0,
      comparePosition: 0,
      frontierPosition: 0,
      frontierEnd: 0,
      logicalChanged: false,
    };
    this.startNodes[0] = this.world.index(snapshot.currentTileX, snapshot.currentTileY);
    this.incrementalSearchWorkspace.begin({
      nodeCount: this.world.tileCount,
      start: this.startNodes[0],
      maxCostUnits: Math.floor(budget * this.integerCostScale + 1e-9),
      unitScale: this.integerCostScale,
      forEachNeighbor: this.forEachIntegerSearchNeighbor,
    });
    this.activeIncrementalTask = state;
    return {
      cancel: () => this.cancelIncrementalTask(state),
      step: (workBudget) => this.stepIncrementalTask(state, workBudget),
    };
  }

  /** Returns an obsolete, unpublished buffer to the bounded two-slot pool. */
  releaseResult(result: ForwardRangeResult): void {
    const buffer = this.resultBuffers.get(result);
    if (!buffer) return;
    this.resultBuffers.delete(result);
    if (
      buffer.mask.length !== this.world.tileCount
      || buffer.costs.length !== this.world.tileCount
      || buffer.presentationMask.length !== this.world.tileCount
      || result.mask !== buffer.mask
      || result.presentationMask !== buffer.presentationMask
      || result.costs !== buffer.costs
      || result.candidateIndices !== buffer.candidateIndices
      || result.presentationCandidateIndices !== buffer.presentationCandidateIndices
    ) return;
    this.releaseIncrementalBuffer(buffer);
  }

  incrementalResourceStats(): {
    readonly buffersAllocated: number;
    readonly pooledBuffers: number;
    readonly taskActive: boolean;
  } {
    return {
      buffersAllocated: this.incrementalBuffersAllocated,
      pooledBuffers: this.incrementalBufferPool.length,
      taskActive: this.activeIncrementalTask !== undefined,
    };
  }

  private calculateResult(
    ship: Pick<ShipState, "currentTileX" | "currentTileY" | "heading" | "provisions" | "provisionAccumulator">,
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
    const result = this.search(budget);

    const mask = new Uint8Array(this.world.tileCount);
    const presentationMask = new Uint8Array(this.world.tileCount);
    const candidateIndices: number[] = [];
    const groupCosts: number[] = [];
    const groupEnds: number[] = [];
    let reachableCount = 0;
    let previousCost: number | undefined;
    for (let settled = 0; settled < result.settledCount; settled++) {
      const index = result.settledIndices[settled];
      if (this.world.getKnowledgeAtIndex(index) !== KnowledgeState.Unknown) continue;
      const cost = result.costs[index];
      if (previousCost !== undefined && cost !== previousCost) {
        groupEnds.push(candidateIndices.length);
      }
      if (previousCost === undefined || cost !== previousCost) {
        groupCosts.push(cost);
        previousCost = cost;
      }
      mask[index] = 1;
      candidateIndices.push(index);
      reachableCount++;
    }
    if (previousCost !== undefined) groupEnds.push(candidateIndices.length);
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
      logicalRevision: 1,
    };
    const radians = presentationHeading * Math.PI / 180;
    this.budgetCaches.set(forwardResult, {
      groupCosts,
      groupEnds,
      activeGroupCount: groupCosts.length,
      maximumComputedBudget: budget,
      originX: ship.currentTileX,
      originY: ship.currentTileY,
      presentationHeading,
      headingCosine: Math.cos(radians),
      headingSine: Math.sin(radians),
      coneCosine: Math.cos(this.config.overlays.forwardConeHalfAngleDegrees * Math.PI / 180),
      spareCandidateIndices: [],
      sparePresentationIndices: [],
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

    while (
      cache.activeGroupCount > 0
      && cache.groupCosts[cache.activeGroupCount - 1] > budget
    ) {
      const groupIndex = --cache.activeGroupCount;
      const start = groupIndex === 0 ? 0 : cache.groupEnds[groupIndex - 1];
      const end = cache.groupEnds[groupIndex];
      for (let position = start; position < end; position++) {
        const index = result.candidateIndices[position];
        if (result.mask[index] === 0) continue;
        result.mask[index] = 0;
        result.reachableCount--;
        changed = true;
      }
    }
    while (
      cache.activeGroupCount < cache.groupCosts.length
      && cache.groupCosts[cache.activeGroupCount] <= budget
    ) {
      const groupIndex = cache.activeGroupCount++;
      const start = groupIndex === 0 ? 0 : cache.groupEnds[groupIndex - 1];
      const end = cache.groupEnds[groupIndex];
      for (let position = start; position < end; position++) {
        const index = result.candidateIndices[position];
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
    const previousCandidates = result.candidateIndices as number[];
    const previousPresentation = result.presentationCandidateIndices as number[];
    result.candidateIndices = refreshed.candidateIndices;
    result.presentationCandidateIndices = refreshed.presentationCandidateIndices;
    if (changed) result.logicalRevision++;
    const refreshedCache = this.budgetCaches.get(refreshed)!;
    refreshedCache.spareCandidateIndices = previousCandidates;
    refreshedCache.sparePresentationIndices = previousPresentation;
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
    const next = cache.sparePresentationIndices;
    next.length = 0;
    const bandWidth = this.config.provisions.unknownCost;
    const minimumCost = result.budget - bandWidth;

    let lower = 0;
    let upper = cache.activeGroupCount;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (cache.groupCosts[middle] <= minimumCost) lower = middle + 1;
      else upper = middle;
    }

    for (let groupIndex = lower; groupIndex < cache.activeGroupCount; groupIndex++) {
      const start = groupIndex === 0 ? 0 : cache.groupEnds[groupIndex - 1];
      const end = cache.groupEnds[groupIndex];
      for (let position = start; position < end; position++) {
        const index = result.candidateIndices[position];
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
    cache.sparePresentationIndices = previous as number[];
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

  private stepIncrementalTask(
    state: IncrementalForwardState,
    budget: ForwardGuidanceWorkBudget,
  ): ForwardGuidanceTaskStep {
    if (!Number.isSafeInteger(budget.maxWorkUnits) || budget.maxWorkUnits <= 0) {
      throw new RangeError("maxWorkUnits must be a positive safe integer");
    }
    if (state.cancelled) return { status: "cancelled", workUnits: 0 };
    if (state.stage === "complete") {
      if (!state.result) throw new Error("Completed guidance task has no result");
      return { status: "complete", workUnits: 0, result: state.result };
    }
    if (this.activeIncrementalTask !== state) {
      return { status: "cancelled", workUnits: 0 };
    }

    let workUnits = 0;
    const shouldStop = (): boolean => (
      workUnits >= budget.maxWorkUnits
      || (workUnits > 0 && workUnits % 32 === 0 && budget.shouldYield?.() === true)
    );

    while (!shouldStop()) {
      if (state.stage === "clear-mask") {
        if (state.maskClearPosition < state.buffer.candidateIndices.length) {
          state.buffer.mask[state.buffer.candidateIndices[state.maskClearPosition++]] = 0;
          workUnits++;
          continue;
        }
        state.buffer.candidateIndices.length = 0;
        state.stage = "clear-presentation";
        continue;
      }

      if (state.stage === "clear-presentation") {
        if (
          state.presentationClearPosition
          < state.buffer.presentationCandidateIndices.length
        ) {
          state.buffer.presentationMask[
            state.buffer.presentationCandidateIndices[state.presentationClearPosition++]
          ] = 0;
          workUnits++;
          continue;
        }
        state.buffer.presentationCandidateIndices.length = 0;
        state.stage = "clear-costs";
        continue;
      }

      if (state.stage === "clear-costs") {
        if (state.costClearPosition < state.buffer.finiteCostIndices.length) {
          state.buffer.costs[
            state.buffer.finiteCostIndices[state.costClearPosition++]
          ] = Number.POSITIVE_INFINITY;
          workUnits++;
          continue;
        }
        state.buffer.finiteCostIndices.length = 0;
        state.stage = "search";
        continue;
      }

      if (state.stage === "search") {
        const searchStep = this.incrementalSearchWorkspace.step({
          maxWorkUnits: budget.maxWorkUnits - workUnits,
          shouldYield: budget.shouldYield,
        });
        workUnits += searchStep.workUnits;
        if (searchStep.status === "pending") {
          return { status: "pending", workUnits };
        }
        state.searchResult = searchStep.result;
        state.stage = "collect";
        if (shouldStop()) return { status: "pending", workUnits };
        continue;
      }

      if (state.stage === "collect") {
        const search = state.searchResult;
        if (!search) throw new Error("Guidance search completed without a result");
        if (state.collectPosition < search.settledCount) {
          const index = search.settledIndices[state.collectPosition++];
          const cost = search.costs[index];
          state.buffer.costs[index] = cost;
          state.buffer.finiteCostIndices.push(index);
          if (this.world.getKnowledgeAtIndex(index) === KnowledgeState.Unknown) {
            if (state.previousCost !== undefined && cost !== state.previousCost) {
              state.groupEnds.push(state.buffer.candidateIndices.length);
            }
            if (state.previousCost === undefined || cost !== state.previousCost) {
              state.groupCosts.push(cost);
              state.previousCost = cost;
            }
            if (state.published.mask[index] === 0) state.logicalChanged = true;
            state.buffer.mask[index] = 1;
            state.buffer.candidateIndices.push(index);
          }
          workUnits++;
          continue;
        }
        if (state.previousCost !== undefined) {
          state.groupEnds.push(state.buffer.candidateIndices.length);
        }
        if (state.published.reachableCount !== state.buffer.candidateIndices.length) {
          state.logicalChanged = true;
        }
        state.stage = "compare-previous";
        continue;
      }

      if (state.stage === "compare-previous") {
        if (state.comparePosition < state.published.candidateIndices.length) {
          const index = state.published.candidateIndices[state.comparePosition++];
          if (state.buffer.mask[index] === 0) state.logicalChanged = true;
          workUnits++;
          continue;
        }
        const radians = state.presentationHeading * Math.PI / 180;
        const cache: ForwardBudgetCache = {
          groupCosts: state.groupCosts,
          groupEnds: state.groupEnds,
          activeGroupCount: state.groupCosts.length,
          maximumComputedBudget: state.budget,
          originX: state.ship.currentTileX,
          originY: state.ship.currentTileY,
          presentationHeading: state.presentationHeading,
          headingCosine: Math.cos(radians),
          headingSine: Math.sin(radians),
          coneCosine: Math.cos(
            this.config.overlays.forwardConeHalfAngleDegrees * Math.PI / 180,
          ),
          spareCandidateIndices: [],
          sparePresentationIndices: [],
        };
        state.cache = cache;
        const minimumCost = state.budget - this.config.provisions.unknownCost;
        let lower = 0;
        let upper = cache.activeGroupCount;
        while (lower < upper) {
          const middle = (lower + upper) >>> 1;
          if (cache.groupCosts[middle] <= minimumCost) lower = middle + 1;
          else upper = middle;
        }
        state.frontierPosition = lower === 0 ? 0 : cache.groupEnds[lower - 1];
        state.frontierEnd = cache.activeGroupCount === 0
          ? 0
          : cache.groupEnds[cache.activeGroupCount - 1];
        state.stage = "frontier";
        continue;
      }

      if (state.stage === "frontier") {
        const cache = state.cache;
        if (!cache) throw new Error("Guidance frontier has no cache");
        if (state.frontierPosition < state.frontierEnd) {
          const index = state.buffer.candidateIndices[state.frontierPosition++];
          if (this.isInsidePresentationCone(index, cache)) {
            state.buffer.presentationMask[index] = 1;
            state.buffer.presentationCandidateIndices.push(index);
          }
          workUnits++;
          continue;
        }

        const result: ForwardRangeResult = {
          mask: state.buffer.mask,
          presentationMask: state.buffer.presentationMask,
          costs: state.buffer.costs,
          budget: state.budget,
          reachableCount: state.buffer.candidateIndices.length,
          frontierCount: state.buffer.presentationCandidateIndices.length,
          presentationHeading: state.presentationHeading,
          coneHalfAngleDegrees: this.config.overlays.forwardConeHalfAngleDegrees,
          candidateIndices: state.buffer.candidateIndices,
          presentationCandidateIndices: state.buffer.presentationCandidateIndices,
          logicalRevision: state.published.logicalRevision + (state.logicalChanged ? 1 : 0),
        };
        state.result = result;
        state.stage = "complete";
        this.budgetCaches.set(result, cache);
        this.resultBuffers.set(result, state.buffer);
        this.activeIncrementalTask = undefined;
        return { status: "complete", workUnits, result };
      }
    }

    return { status: "pending", workUnits };
  }

  private cancelActiveIncrementalTask(): void {
    if (this.activeIncrementalTask) this.cancelIncrementalTask(this.activeIncrementalTask);
  }

  private cancelIncrementalTask(state: IncrementalForwardState): void {
    if (state.cancelled || state.stage === "complete") return;
    state.cancelled = true;
    if (this.activeIncrementalTask === state) {
      this.incrementalSearchWorkspace.cancel();
      this.activeIncrementalTask = undefined;
    }
    if (!state.bufferReleased) {
      state.bufferReleased = true;
      this.releaseIncrementalBuffer(state.buffer);
    }
  }

  private acquireIncrementalBuffer(): ForwardResultBuffers {
    return this.incrementalBufferPool.pop() ?? this.createIncrementalBuffer();
  }

  private releaseIncrementalBuffer(buffer: ForwardResultBuffers): void {
    if (this.incrementalBufferPool.includes(buffer)) return;
    // Two alternating result slots are sufficient for one published and one
    // in-flight result. A third can appear only after exceptional misuse.
    if (this.incrementalBufferPool.length < 2) this.incrementalBufferPool.push(buffer);
  }

  private createIncrementalBuffer(): ForwardResultBuffers {
    this.incrementalBuffersAllocated++;
    const costs = new Float64Array(this.world.tileCount);
    costs.fill(Number.POSITIVE_INFINITY);
    return {
      mask: new Uint8Array(this.world.tileCount),
      presentationMask: new Uint8Array(this.world.tileCount),
      costs,
      candidateIndices: [],
      presentationCandidateIndices: [],
      finiteCostIndices: [],
    };
  }

  private prewarmIncrementalResources(): void {
    const initialMaxCostUnits = Math.min(
      1_000_000,
      Math.max(
        0,
        Math.ceil(this.config.provisions.startingBundles * this.integerCostScale),
      ),
    );
    this.incrementalSearchWorkspace.reserve(this.world.tileCount, initialMaxCostUnits);
    while (this.incrementalBufferPool.length < 2) {
      this.incrementalBufferPool.push(this.createIncrementalBuffer());
    }
  }

  private search(budget: number): Pick<
    BucketedCostSearchResult,
    "costs" | "settledIndices" | "settledCount"
  > {
    const maxCostUnits = Math.floor(budget * this.integerCostScale + 1e-9);
    // Protect developer tuning from constructing an unexpectedly giant
    // bucket array. The generic heap remains the synchronous exact oracle for
    // unusually large horizons.
    if (maxCostUnits <= 1_000_000) {
      return this.bucketedSearchWorkspace.search({
        nodeCount: this.world.tileCount,
        start: this.startNodes[0],
        maxCostUnits,
        unitScale: this.integerCostScale,
        forEachNeighbor: this.forEachIntegerSearchNeighbor,
      });
    }
    return dijkstra({
      nodeCount: this.world.tileCount,
      starts: this.startNodes,
      maxCost: budget,
      workspace: this.searchWorkspace,
      forEachNeighbor: this.forEachSearchNeighbor,
    });
  }

  private refreshIntegerTravelCosts(): void {
    this.integerCostScale = this.resolveIntegerCostScale();
    this.integerTravelCosts[KnowledgeState.Unknown] = Math.round(
      knowledgeTravelCost(KnowledgeState.Unknown, this.config) * this.integerCostScale,
    );
    this.integerTravelCosts[KnowledgeState.Personal] = Math.round(
      knowledgeTravelCost(KnowledgeState.Personal, this.config) * this.integerCostScale,
    );
    this.integerTravelCosts[KnowledgeState.Supported] = Math.round(
      knowledgeTravelCost(KnowledgeState.Supported, this.config) * this.integerCostScale,
    );
  }

  private resolveIntegerCostScale(): number {
    const costs = [
      knowledgeTravelCost(KnowledgeState.Unknown, this.config),
      knowledgeTravelCost(KnowledgeState.Personal, this.config),
      knowledgeTravelCost(KnowledgeState.Supported, this.config),
    ];
    for (const scale of [1, 10, 100, 1_000, 10_000]) {
      if (costs.every((cost) => Math.abs(cost * scale - Math.round(cost * scale)) <= 1e-9)) {
        return scale;
      }
    }
    throw new RangeError("Provision travel costs must use at most four decimal places");
  }
}
