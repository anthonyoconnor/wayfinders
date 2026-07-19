import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, MovementInput, MovementResult, ShipState, TravelSegment, WorldPoint } from "../core/types";
import { gridToWorld, worldToGrid } from "../world/CoordinateSystem";
import { WorldGrid } from "../world/WorldGrid";
import { firstShipCollisionTime } from "./CollisionGeometry";
import type { MovementAuthority } from "./MovementAuthority";

interface GridTraversalEntry extends GridPoint {
  tEnter: number;
}

interface MovementLeg {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

const ZERO_WORLD_POINT: Readonly<WorldPoint> = Object.freeze({ x: 0, y: 0 });

const NO_MOVEMENT_RESULT: MovementResult = Object.freeze({
  movedDistancePixels: 0,
  liftedDisplacement: ZERO_WORLD_POINT,
  worldImageOffset: ZERO_WORLD_POINT,
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

export class MovementSystem implements MovementAuthority {
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
    if (proposedDistance === 0) {
      return NO_MOVEMENT_RESULT;
    }

    const legs: MovementLeg[] = [];
    const firstLeg = this.sweepLeg(fromX, fromY, proposedX, proposedY);
    legs.push(firstLeg);

    let actualX = firstLeg.toX;
    let actualY = firstLeg.toY;
    let slideDistance = 0;
    const collided = actualX !== proposedX || actualY !== proposedY;
    if (collided) {
      const remainingX = proposedX - actualX;
      const remainingY = proposedY - actualY;
      const slideCandidates = [
        this.sweepLeg(actualX, actualY, actualX + remainingX, actualY),
        this.sweepLeg(actualX, actualY, actualX, actualY + remainingY),
      ];
      const slide = slideCandidates.reduce((best, candidate) => (
        this.legDistance(candidate) > this.legDistance(best) ? candidate : best
      ));
      slideDistance = this.legDistance(slide);
      if (slideDistance > 0) {
        legs.push(slide);
        actualX = slide.toX;
        actualY = slide.toY;
      }
    }

    const enteredTiles: GridPoint[] = [];
    const segments: TravelSegment[] = [];
    let actualDistance = 0;
    for (const leg of legs) {
      const distance = this.legDistance(leg);
      if (distance === 0) continue;
      actualDistance += distance;
      const traversal = traceWorldGridLine(leg.fromX, leg.fromY, leg.toX, leg.toY, this.config.navigation.tileSize);
      segments.push(...this.buildSegments(traversal, 1, leg.fromX, leg.fromY, leg.toX, leg.toY, distance));
      for (let index = 1; index < traversal.length; index++) {
        const canonical = this.world.topology.canonicalizeTile(traversal[index].x, traversal[index].y);
        if (canonical) enteredTiles.push(canonical);
      }
    }
    const canonicalFinal = this.world.topology.canonicalizeWorld(actualX, actualY);
    if (!canonicalFinal) {
      throw new RangeError("Bounded movement escaped the synthetic world collision boundary");
    }
    const finalTile = worldToGrid(canonicalFinal.x, canonicalFinal.y, this.config.navigation.tileSize);
    const liftedDisplacement = {
      x: actualX - fromX,
      y: actualY - fromY,
    };
    const worldImageOffset = {
      x: this.world.topology.wrapsX
        ? Math.round((actualX - canonicalFinal.x) / this.world.topology.pixelWidth) * this.world.topology.pixelWidth
        : 0,
      y: this.world.topology.wrapsY
        ? Math.round((actualY - canonicalFinal.y) / this.world.topology.pixelHeight) * this.world.topology.pixelHeight
        : 0,
    };

    ship.worldX = canonicalFinal.x;
    ship.worldY = canonicalFinal.y;
    ship.currentTileX = finalTile.x;
    ship.currentTileY = finalTile.y;
    if (collided) {
      ship.speed = deltaSeconds === 0 ? 0 : Math.sign(throttle) * slideDistance / deltaSeconds;
    }

    return {
      movedDistancePixels: actualDistance,
      liftedDisplacement,
      worldImageOffset,
      collided,
      enteredTiles,
      segments,
      tileChanged: enteredTiles.length > 0,
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

  private sweepLeg(fromX: number, fromY: number, toX: number, toY: number): MovementLeg {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (distance === 0) return { fromX, fromY, toX: fromX, toY: fromY };
    const collisionT = firstShipCollisionTime(this.world, fromX, fromY, toX, toY, this.config);
    const acceptedT = collisionT === undefined
      ? 1
      : Math.max(0, collisionT - this.config.movement.collisionEpsilon / distance);
    return {
      fromX,
      fromY,
      toX: fromX + (toX - fromX) * acceptedT,
      toY: fromY + (toY - fromY) * acceptedT,
    };
  }

  private legDistance(leg: Readonly<MovementLeg>): number {
    return Math.hypot(leg.toX - leg.fromX, leg.toY - leg.fromY);
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
      const tile = this.world.topology.canonicalizeTile(traversal[index].x, traversal[index].y);
      if (!tile) {
        throw new RangeError("Bounded movement produced a segment outside the world");
      }
      segments.push({
        fromWorldX: fromX + (toX - fromX) * startT,
        fromWorldY: fromY + (toY - fromY) * startT,
        toWorldX: fromX + (toX - fromX) * endT,
        toWorldY: fromY + (toY - fromY) * endT,
        distancePixels: distance * (endT - startT),
        tileX: tile.x,
        tileY: tile.y,
      });
    }
    return segments;
  }
}
