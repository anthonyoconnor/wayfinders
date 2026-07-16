import type { ShipState } from "../core/types";
import type { WorldGrid } from "../world/WorldGrid";
import type { ForwardRangeResult } from "./ForwardRangeSystem";

export type ForwardGuidanceShip = Pick<
  ShipState,
  "currentTileX" | "currentTileY" | "heading" | "provisions" | "provisionAccumulator"
>;

/** Expensive, derived player guidance. It is never movement authority. */
export interface ForwardGuidance {
  setWorld(world: WorldGrid): void;
  calculate(ship: ForwardGuidanceShip): ForwardRangeResult;
  beginTask(
    published: ForwardRangeResult,
    ship: ForwardGuidanceShip,
  ): ForwardGuidanceTask;
  releaseResult(result: ForwardRangeResult): void;
  updateBudget(
    result: ForwardRangeResult,
    ship: Pick<ShipState, "heading" | "provisions" | "provisionAccumulator">,
  ): boolean;
  updateHeading(result: ForwardRangeResult, ship: Pick<ShipState, "heading">): boolean;
}

/** Revisioned input captured when a derived-guidance refresh is requested. */
export interface ForwardGuidanceSource {
  readonly requestId: number;
  /** Monotonic across regenerations, including regeneration with the same seed. */
  readonly worldEpoch: number;
  readonly worldRevision: number;
  readonly knowledgeRevision: number;
  readonly visibilityRevision: number;
  readonly originX: number;
  readonly originY: number;
  readonly provisionUnits: number;
}

export interface ForwardGuidanceStatus {
  readonly pending: boolean;
  readonly requestedId: number;
  readonly appliedId: number;
  readonly activeId?: number;
  readonly telemetry: Readonly<ForwardGuidanceTelemetry>;
  readonly source: ForwardGuidanceSource;
}

export interface ForwardGuidanceWorkBudget {
  readonly maxWorkUnits: number;
  /** Called between bounded work batches; true yields the task. */
  readonly shouldYield?: () => boolean;
}

export type ForwardGuidanceTaskStep =
  | {
      readonly status: "pending";
      readonly workUnits: number;
    }
  | {
      readonly status: "complete";
      readonly workUnits: number;
      readonly result: ForwardRangeResult;
    }
  | {
      readonly status: "cancelled";
      readonly workUnits: 0;
    };

/** Cooperative, non-authoritative derived work. Publication is owned by GameSimulation. */
export interface ForwardGuidanceTask {
  step(budget: ForwardGuidanceWorkBudget): ForwardGuidanceTaskStep;
  cancel(): void;
}

export interface ForwardGuidanceTelemetry {
  readonly requests: number;
  readonly jobsStarted: number;
  readonly jobsCompleted: number;
  readonly jobsCancelled: number;
  readonly requestsCoalesced: number;
  readonly staleResultsDiscarded: number;
  readonly slices: number;
  readonly lastSliceWorkUnits: number;
  readonly maxSliceWorkUnits: number;
  readonly lastRequestSlices: number;
  readonly maxRequestSlices: number;
}
