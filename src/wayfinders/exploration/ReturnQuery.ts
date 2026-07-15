import type { ShipState } from "../core/types";
import type { WorldGrid } from "../world/WorldGrid";
import type { ReturnPathResult } from "./ReturnPathSystem";

export type ReturnQueryShip = Pick<
  ShipState,
  "currentTileX" | "currentTileY" | "provisions" | "provisionAccumulator"
>;

/** Authoritative return-safety query. This remains synchronous with movement. */
export interface ReturnQuery {
  setWorld(world: WorldGrid): void;
  calculate(ship: ReturnQueryShip): ReturnPathResult;
  recalculate(result: ReturnPathResult, ship: ReturnQueryShip): ReturnPathResult;
  updateBudget(
    result: ReturnPathResult,
    ship: Pick<ShipState, "provisions" | "provisionAccumulator">,
  ): boolean;
}
