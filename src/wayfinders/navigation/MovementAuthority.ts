import type { GridPoint, MovementInput, MovementResult, ShipState } from "../core/types";
import type { WorldGrid } from "../world/WorldGrid";

/**
 * Authoritative movement boundary. Rendering and derived guidance may observe
 * its output, but they must not independently mutate the ship pose.
 */
export interface MovementAuthority {
  setWorld(world: WorldGrid): void;
  update(ship: ShipState, input: MovementInput, deltaSeconds: number): MovementResult;
  teleport(ship: ShipState, tile: GridPoint): void;
}
