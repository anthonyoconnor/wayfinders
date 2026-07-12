import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { WorldGrid } from "../world/WorldGrid";

export interface VisibilityOffset {
  dx: number;
  dy: number;
  distanceSquared: number;
}

export interface VisibilityUpdate {
  /** Tiles visible from the ship's final logical tile. */
  currentVisibleIndices: readonly number[];
  /** Union of visible tiles at every navigation-tile centre crossed this update. */
  observedIndices: readonly number[];
  crossedCenters: readonly GridPoint[];
}

/** Bresenham traversal of every logical tile centre crossed between two tiles. */
export function traceGridCenters(from: GridPoint, to: GridPoint): GridPoint[] {
  for (const [value, label] of [
    [from.x, "from.x"],
    [from.y, "from.y"],
    [to.x, "to.x"],
    [to.y, "to.y"],
  ] as const) {
    if (!Number.isInteger(value)) throw new RangeError(`${label} must be an integer`);
  }

  const points: GridPoint[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : from.x > to.x ? -1 : 0;
  const stepY = from.y < to.y ? 1 : from.y > to.y ? -1 : 0;
  let error = dx - dy;

  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const doubledError = error * 2;
    if (doubledError > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubledError < dx) {
      error += dx;
      y += stepY;
    }
  }

  return points;
}

/** Pure grid visibility; Phaser is deliberately kept out of this layer. */
export class VisibilitySystem {
  private offsets: VisibilityOffset[] = [];
  private offsetRadius = -1;

  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {}

  setWorld(world: WorldGrid): void {
    this.world = world;
  }

  getVisibleIndices(origin: GridPoint): number[] {
    this.assertTile(origin, "Visibility origin");
    this.ensureOffsets();

    const visible: number[] = [];
    for (const offset of this.offsets) {
      const targetX = origin.x + offset.dx;
      const targetY = origin.y + offset.dy;
      if (!this.world.inBounds(targetX, targetY)) continue;
      if (this.hasLineOfSight(origin.x, origin.y, targetX, targetY)) {
        visible.push(this.world.index(targetX, targetY));
      }
    }
    return visible;
  }

  /**
   * Updates current LOS at the destination while also returning the observation
   * union from every crossed tile centre. KnowledgeSystem consumes that union.
   */
  updateForMovement(from: GridPoint, to: GridPoint): VisibilityUpdate {
    this.assertTile(from, "Visibility start");
    this.assertTile(to, "Visibility destination");

    const crossedCenters = traceGridCenters(from, to);
    const observedMask = new Uint8Array(this.world.tileCount);
    for (const center of crossedCenters) {
      for (const index of this.getVisibleIndices(center)) observedMask[index] = 1;
    }

    const currentVisibleIndices = this.getVisibleIndices(to);
    this.world.clearVisibility();
    for (const index of currentVisibleIndices) {
      const point = this.world.pointFromIndex(index);
      this.world.setVisibleNow(point.x, point.y, true);
    }

    const observedIndices: number[] = [];
    for (let index = 0; index < observedMask.length; index++) {
      if (observedMask[index]) observedIndices.push(index);
    }

    return { currentVisibleIndices, observedIndices, crossedCenters };
  }

  updateAt(tile: GridPoint): VisibilityUpdate {
    return this.updateForMovement(tile, tile);
  }

  private ensureOffsets(): void {
    const radius = this.config.navigation.sightRadius;
    if (!Number.isInteger(radius) || radius < 0) {
      throw new RangeError("navigation.sightRadius must be a non-negative integer");
    }
    if (radius === this.offsetRadius) return;

    const offsets: VisibilityOffset[] = [];
    const radiusSquared = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= radiusSquared) offsets.push({ dx, dy, distanceSquared });
      }
    }
    offsets.sort((left, right) => left.distanceSquared - right.distanceSquared || left.dy - right.dy || left.dx - right.dx);
    this.offsets = offsets;
    this.offsetRadius = radius;
  }

  private hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    let x = fromX;
    let y = fromY;
    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    const stepX = fromX < toX ? 1 : fromX > toX ? -1 : 0;
    const stepY = fromY < toY ? 1 : fromY > toY ? -1 : 0;
    let error = dx - dy;

    while (x !== toX || y !== toY) {
      const doubledError = error * 2;
      if (doubledError > -dy) {
        error -= dy;
        x += stepX;
      }
      if (doubledError < dx) {
        error += dx;
        y += stepY;
      }

      // A blocking target is visible itself, but hides every tile behind it.
      if (x === toX && y === toY) return true;
      if (this.world.isSightBlocked(x, y)) return false;
    }

    return true;
  }

  private assertTile(point: GridPoint, label: string): void {
    if (!this.world.inBounds(point.x, point.y)) {
      throw new RangeError(`${label} (${point.x}, ${point.y}) is outside the world`);
    }
  }
}
