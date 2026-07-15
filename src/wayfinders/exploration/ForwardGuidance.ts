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
  recalculate(result: ForwardRangeResult, ship: ForwardGuidanceShip): ForwardRangeResult;
  updateBudget(
    result: ForwardRangeResult,
    ship: Pick<ShipState, "heading" | "provisions" | "provisionAccumulator">,
  ): boolean;
  updateHeading(result: ForwardRangeResult, ship: Pick<ShipState, "heading">): boolean;
}

/** Revisioned input captured when a derived-guidance refresh is requested. */
export interface ForwardGuidanceSource {
  readonly requestId: number;
  readonly worldRevision: number;
  readonly knowledgeRevision: number;
  readonly originX: number;
  readonly originY: number;
  readonly provisionUnits: number;
}

export interface ForwardGuidanceStatus {
  readonly deferred: boolean;
  readonly pending: boolean;
  readonly requestedId: number;
  readonly appliedId: number;
  readonly source: ForwardGuidanceSource;
}
