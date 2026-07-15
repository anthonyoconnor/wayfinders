import type { PrototypeConfig } from "../config/prototypeConfig.ts";
import {
  COLLISION_SUBCELL_SIZE,
  COLLISION_SUBCELLS_PER_TILE,
  isCollisionSubcellSolid,
} from "../world/CollisionMask.ts";
import type { WorldGrid } from "../world/WorldGrid.ts";

export interface AxisAlignedBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface CollisionQueryStats {
  broadPhaseCells: number;
  narrowPhasePrimitives: number;
}

export type CollisionTileFilter = (x: number, y: number, worldIndex: number) => boolean;

export interface ShipCollisionQueryOptions {
  readonly includeTile?: CollisionTileFilter;
  readonly stats?: CollisionQueryStats;
}

/** Returns the first time a moving point enters the open interior of an AABB. */
export function segmentBoundsEntryTime(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  bounds: Readonly<AxisAlignedBounds>,
): number | undefined {
  const dx = toX - fromX;
  const dy = toY - fromY;
  let entry = 0;
  let exit = 1;

  for (const [origin, delta, minimum, maximum] of [
    [fromX, dx, bounds.left, bounds.right],
    [fromY, dy, bounds.top, bounds.bottom],
  ] as const) {
    if (delta === 0) {
      if (origin <= minimum || origin >= maximum) return undefined;
      continue;
    }

    let near = (minimum - origin) / delta;
    let far = (maximum - origin) / delta;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return undefined;
  }

  if (exit < 0 || entry > 1) return undefined;
  return Math.max(0, entry);
}

/**
 * Sweeps the configured square ship against static world collision. The 32 px
 * grid is the broad phase; a present mixed mask replaces that cell with only
 * its set 8 px subcells for the narrow phase.
 */
export function firstShipCollisionTime(
  world: WorldGrid,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  config: Pick<PrototypeConfig, "navigation" | "movement">,
  options: Readonly<ShipCollisionQueryOptions> = {},
): number | undefined {
  const tileSize = config.navigation.tileSize;
  const halfExtent = config.movement.shipCollisionHalfExtent;
  if (world.fineCollisionCellCount > 0 && tileSize !== COLLISION_SUBCELL_SIZE * COLLISION_SUBCELLS_PER_TILE) {
    throw new RangeError("Fine collision masks require 32 px navigation cells and 8 px subcells");
  }
  const minimumTileX = Math.floor((Math.min(fromX, toX) - halfExtent) / tileSize);
  const maximumTileX = Math.floor((Math.max(fromX, toX) + halfExtent) / tileSize);
  const minimumTileY = Math.floor((Math.min(fromY, toY) - halfExtent) / tileSize);
  const maximumTileY = Math.floor((Math.max(fromY, toY) + halfExtent) / tileSize);
  let first: number | undefined;

  const testPrimitive = (bounds: Readonly<AxisAlignedBounds>): void => {
    if (options.stats) options.stats.narrowPhasePrimitives++;
    const entry = segmentBoundsEntryTime(fromX, fromY, toX, toY, {
      left: bounds.left - halfExtent,
      right: bounds.right + halfExtent,
      top: bounds.top - halfExtent,
      bottom: bounds.bottom + halfExtent,
    });
    if (entry !== undefined && (first === undefined || entry < first)) first = entry;
  };

  for (let y = minimumTileY; y <= maximumTileY; y++) {
    for (let x = minimumTileX; x <= maximumTileX; x++) {
      if (options.stats) options.stats.broadPhaseCells++;
      if (!world.inBounds(x, y)) {
        testPrimitive({
          left: x * tileSize,
          right: (x + 1) * tileSize,
          top: y * tileSize,
          bottom: (y + 1) * tileSize,
        });
        continue;
      }

      const worldIndex = y * world.width + x;
      if (options.includeTile && !options.includeTile(x, y, worldIndex)) continue;
      const fineMask = world.getFineCollisionMaskAtIndex(worldIndex);
      if (fineMask !== undefined) {
        for (let subY = 0; subY < COLLISION_SUBCELLS_PER_TILE; subY++) {
          for (let subX = 0; subX < COLLISION_SUBCELLS_PER_TILE; subX++) {
            if (!isCollisionSubcellSolid(fineMask, subX, subY)) continue;
            const left = x * tileSize + subX * COLLISION_SUBCELL_SIZE;
            const top = y * tileSize + subY * COLLISION_SUBCELL_SIZE;
            testPrimitive({
              left,
              right: left + COLLISION_SUBCELL_SIZE,
              top,
              bottom: top + COLLISION_SUBCELL_SIZE,
            });
          }
        }
      } else if (world.isMovementBlockedAtIndex(worldIndex)) {
        testPrimitive({
          left: x * tileSize,
          right: (x + 1) * tileSize,
          top: y * tileSize,
          bottom: (y + 1) * tileSize,
        });
      }
    }
  }

  return first;
}

export function isShipCenterCollisionFree(
  world: WorldGrid,
  worldX: number,
  worldY: number,
  config: Pick<PrototypeConfig, "navigation" | "movement">,
  options?: Readonly<ShipCollisionQueryOptions>,
): boolean {
  return firstShipCollisionTime(world, worldX, worldY, worldX, worldY, config, options) === undefined;
}
