import type { ForwardRangeResult } from "../exploration/ForwardRangeSystem";
import type { ReturnPathResult } from "../exploration/ReturnPathSystem";
import { KnowledgeState } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";

export interface SimulationDiagnosticsRevision {
  readonly knowledge: number;
  readonly visibility: number;
  readonly overlays: number;
}

export interface SimulationDiagnosticsReadModel {
  readonly revision: Readonly<SimulationDiagnosticsRevision>;
  readonly knowledge: Readonly<{
    supported: number;
    personal: number;
    unknown: number;
    visibleNow: number;
  }>;
  readonly risk: Readonly<{
    forwardReachable: number;
    forwardFrontier: number;
    forwardHeading: number;
    forwardConeHalfAngleDegrees: number;
    comfortable: number;
    warning: number;
    critical: number;
    impossible: number;
    returnPathTiles: number;
    returnCorridorTiles: number;
    returnLevel: ReturnPathResult["riskLevel"];
    returnCost: number | null;
    returnMargin: number | null;
  }>;
}

export interface SimulationDiagnosticsSource {
  readonly overlaysRevision: number;
  readonly world: Pick<
    WorldGrid,
    "knowledgeVersion" | "visibilityVersion" | "currentVisibleCount" | "getKnowledgeCount"
  >;
  readonly forwardRange: Pick<
    ForwardRangeResult,
    "reachableCount" | "frontierCount" | "presentationHeading" | "coneHalfAngleDegrees"
  >;
  readonly returnPaths: Pick<
    ReturnPathResult,
    "riskCounts" | "pathIndices" | "corridorIndices" | "riskLevel" | "returnCost" | "returnMargin"
  >;
}

/**
 * Produces the small projection used by browser diagnostics.
 *
 * The adapter deliberately caches by the authority revisions that can change
 * this projection. Calling it while the ship is moving inside one tile does
 * not allocate or clone unrelated simulation collections.
 */
export class SimulationDiagnosticsAdapter {
  private cached?: Readonly<SimulationDiagnosticsReadModel>;

  read(source: Readonly<SimulationDiagnosticsSource>): Readonly<SimulationDiagnosticsReadModel> {
    const cached = this.cached;
    if (
      cached
      && cached.revision.knowledge === source.world.knowledgeVersion
      && cached.revision.visibility === source.world.visibilityVersion
      && cached.revision.overlays === source.overlaysRevision
    ) return cached;

    const revision = Object.freeze({
      knowledge: source.world.knowledgeVersion,
      visibility: source.world.visibilityVersion,
      overlays: source.overlaysRevision,
    });
    const knowledge = Object.freeze({
      supported: source.world.getKnowledgeCount(KnowledgeState.Supported),
      personal: source.world.getKnowledgeCount(KnowledgeState.Personal),
      unknown: source.world.getKnowledgeCount(KnowledgeState.Unknown),
      visibleNow: source.world.currentVisibleCount,
    });
    const risk = Object.freeze({
      forwardReachable: source.forwardRange.reachableCount,
      forwardFrontier: source.forwardRange.frontierCount,
      forwardHeading: source.forwardRange.presentationHeading,
      forwardConeHalfAngleDegrees: source.forwardRange.coneHalfAngleDegrees,
      comfortable: source.returnPaths.riskCounts.comfortable,
      warning: source.returnPaths.riskCounts.warning,
      critical: source.returnPaths.riskCounts.critical,
      impossible: source.returnPaths.riskCounts.impossible,
      returnPathTiles: source.returnPaths.pathIndices.length,
      returnCorridorTiles: source.returnPaths.corridorIndices.length,
      returnLevel: source.returnPaths.riskLevel,
      returnCost: Number.isFinite(source.returnPaths.returnCost) ? source.returnPaths.returnCost : null,
      returnMargin: Number.isFinite(source.returnPaths.returnMargin) ? source.returnPaths.returnMargin : null,
    });
    const next = Object.freeze({ revision, knowledge, risk });
    this.cached = next;
    return next;
  }
}
