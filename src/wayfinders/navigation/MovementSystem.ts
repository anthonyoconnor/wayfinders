import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, MovementInput, MovementResult, ShipState, TravelSegment } from "../core/types";
import { gridToWorld, worldToGrid } from "../world/CoordinateSystem";
import { WorldGrid } from "../world/WorldGrid";

interface GridTraversalEntry extends GridPoint {
  tEnter: number;
}

interface AxisAlignedBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

const NO_MOVEMENT_RESULT: MovementResult = Object.freeze({
  movedDistancePixels: 0,
  collided: false,
  enteredTiles: Object.freeze([]) as unknown as GridPoint[],
  segments: Object.freeze([]) as unknown as TravelSegment[],
  tileChanged: false,
});

/** Returns every centre-point tile entered by a continuous world-space line. */
export function traceWorldGridLine(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  tileSize = prototypeConfig.navigation.tileSize,
): GridTraversalEntry[] {
  const start = worldToGrid(fromX, fromY, tileSize);
  const end = worldToGrid(toX, toY, tileSize);
  const entries: GridTraversalEntry[] = [{ ...start, tEnter: 0 }];
  if (start.x === end.x && start.y === end.y) return entries;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : tileSize / Math.abs(dx);
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : tileSize / Math.abs(dy);
  const nextBoundaryX = stepX > 0 ? (start.x + 1) * tileSize : start.x * tileSize;
  const nextBoundaryY = stepY > 0 ? (start.y + 1) * tileSize : start.y * tileSize;
  let tMaxX = stepX === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryX - fromX) / dx;
  let tMaxY = stepY === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryY - fromY) / dy;
  let x = start.x;
  let y = start.y;

  const maximumEntries = Math.abs(end.x - start.x) + Math.abs(end.y - start.y) + 2;
  while ((x !== end.x || y !== end.y) && entries.length <= maximumEntries) {
    let tEnter: number;
    if (Math.abs(tMaxX - tMaxY) < Number.EPSILON * 8) {
      x += stepX;
      y += stepY;
      tEnter = tMaxX;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      x += stepX;
      tEnter = tMaxX;
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      tEnter = tMaxY;
      tMaxY += tDeltaY;
    }
    entries.push({ x, y, tEnter: clamp(tEnter, 0, 1) });
  }

  return entries;
}

export function createShipStateAtGrid(
  tile: GridPoint,
  provisions = prototypeConfig.provisions.startingBundles,
  heading = 0,
  config: PrototypeConfig = prototypeConfig,
): ShipState {
  const world = gridToWorld(tile, config.navigation.tileSize);
  return {
    worldX: world.x,
    worldY: world.y,
    heading: wrapDegrees(heading),
    speed: 0,
    currentTileX: tile.x,
    currentTileY: tile.y,
    provisions: Math.max(0, Math.floor(provisions)),
    provisionAccumulator: 0,
  };
}

/** Returns the first time a moving point enters the open interior of an axis-aligned box. */
function segmentBoundsEntryTime(
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

export class MovementSystem {
  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {}

  setWorld(world: WorldGrid): void {
    this.world = world;
  }

  update(ship: ShipState, input: MovementInput, deltaSeconds: number): MovementResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be finite and non-negative");
    if (!Number.isFinite(input.turn)) throw new RangeError("input.turn must be finite");
    if (!Number.isFinite(input.throttle)) throw new RangeError("input.throttle must be finite");

    const turn = clamp(input.turn, -1, 1);
    const throttle = clamp(input.throttle, -1, 1);
    ship.heading = wrapDegrees(ship.heading + turn * this.config.movement.turnRate * deltaSeconds);
    ship.speed = throttle * this.config.movement.shipSpeed * this.config.navigation.tileSize;

    const headingRadians = ship.heading * Math.PI / 180;
    const proposedDistance = ship.speed * deltaSeconds;
    const fromX = ship.worldX;
    const fromY = ship.worldY;
    const proposedX = fromX + Math.cos(headingRadians) * proposedDistance;
    const proposedY = fromY + Math.sin(headingRadians) * proposedDistance;
    const originalTile = { x: ship.currentTileX, y: ship.currentTileY };

    if (proposedDistance === 0) {
      return NO_MOVEMENT_RESULT;
    }

    const traversal = traceWorldGridLine(fromX, fromY, proposedX, proposedY, this.config.navigation.tileSize);
    const absoluteDistance = Math.abs(proposedDistance);
    let actualT = 1;
    let collided = false;

    const collisionT = this.firstCollisionTime(fromX, fromY, proposedX, proposedY);
    if (collisionT !== undefined) {
      const epsilonT = this.config.movement.collisionEpsilon / absoluteDistance;
      actualT = Math.max(0, collisionT - epsilonT);
      collided = true;
    }

    const actualX = fromX + (proposedX - fromX) * actualT;
    const actualY = fromY + (proposedY - fromY) * actualT;
    const actualDistance = absoluteDistance * actualT;
    const segments = this.buildSegments(traversal, actualT, fromX, fromY, proposedX, proposedY, absoluteDistance);
    const finalTile = worldToGrid(actualX, actualY, this.config.navigation.tileSize);
    const enteredTiles = traversal
      .slice(1)
      .filter((entry) => entry.tEnter <= actualT && this.world.inBounds(entry.x, entry.y))
      .map(({ x, y }) => ({ x, y }));

    ship.worldX = actualX;
    ship.worldY = actualY;
    ship.currentTileX = finalTile.x;
    ship.currentTileY = finalTile.y;
    if (collided) ship.speed = 0;

    return {
      movedDistancePixels: actualDistance,
      collided,
      enteredTiles,
      segments,
      tileChanged: originalTile.x !== finalTile.x || originalTile.y !== finalTile.y,
    };
  }

  teleport(ship: ShipState, tile: GridPoint): void {
    if (!this.world.inBounds(tile.x, tile.y)) throw new RangeError("Cannot teleport outside the world");
    const world = gridToWorld(tile, this.config.navigation.tileSize);
    ship.worldX = world.x;
    ship.worldY = world.y;
    ship.currentTileX = tile.x;
    ship.currentTileY = tile.y;
    ship.speed = 0;
  }

  /** Sweeps the ship's square footprint against terrain without tunnelling through a tile. */
  private firstCollisionTime(fromX: number, fromY: number, toX: number, toY: number): number | undefined {
    const tileSize = this.config.navigation.tileSize;
    const halfExtent = this.config.movement.shipCollisionHalfExtent;
    const minimumTileX = Math.floor((Math.min(fromX, toX) - halfExtent) / tileSize);
    const maximumTileX = Math.floor((Math.max(fromX, toX) + halfExtent) / tileSize);
    const minimumTileY = Math.floor((Math.min(fromY, toY) - halfExtent) / tileSize);
    const maximumTileY = Math.floor((Math.max(fromY, toY) + halfExtent) / tileSize);
    let first: number | undefined;

    for (let y = minimumTileY; y <= maximumTileY; y++) {
      for (let x = minimumTileX; x <= maximumTileX; x++) {
        if (!this.world.isMovementBlocked(x, y)) continue;
        const entry = segmentBoundsEntryTime(fromX, fromY, toX, toY, {
          left: x * tileSize - halfExtent,
          right: (x + 1) * tileSize + halfExtent,
          top: y * tileSize - halfExtent,
          bottom: (y + 1) * tileSize + halfExtent,
        });
        if (entry !== undefined && (first === undefined || entry < first)) first = entry;
      }
    }

    return first;
  }

  private buildSegments(
    traversal: readonly GridTraversalEntry[],
    actualT: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    distance: number,
  ): TravelSegment[] {
    const segments: TravelSegment[] = [];
    for (let index = 0; index < traversal.length; index++) {
      const startT = traversal[index].tEnter;
      if (startT >= actualT) break;
      const endT = Math.min(actualT, traversal[index + 1]?.tEnter ?? 1);
      if (endT <= startT) continue;
      segments.push({
        fromWorldX: fromX + (toX - fromX) * startT,
        fromWorldY: fromY + (toY - fromY) * startT,
        toWorldX: fromX + (toX - fromX) * endT,
        toWorldY: fromY + (toY - fromY) * endT,
        distancePixels: distance * (endT - startT),
        tileX: traversal[index].x,
        tileY: traversal[index].y,
      });
    }
    return segments;
  }
}
