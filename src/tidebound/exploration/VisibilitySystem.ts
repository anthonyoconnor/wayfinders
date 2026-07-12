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
  private observedStamps = new Uint32Array(0);
  private observationStamp = 0;

  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {}

  setWorld(world: WorldGrid): void {
    this.world = world;
    this.observedStamps = new Uint32Array(0);
    this.observationStamp = 0;
  }

  getVisibleIndices(origin: GridPoint): number[] {
    this.assertTile(origin, "Visibility origin");
    this.ensureOffsets();

    const visible: number[] = [];
    this.appendVisibleIndices(origin, visible);
    return visible;
  }

  /**
   * Updates current LOS at the destination while also returning the observation
   * union from every crossed tile centre. KnowledgeSystem consumes that union.
   */
  updateForMovement(from: GridPoint, to: GridPoint): VisibilityUpdate {
    this.assertTile(from, "Visibility start");
    this.assertTile(to, "Visibility destination");
    this.ensureOffsets();

    const crossedCenters = traceGridCenters(from, to);
    const observedIndices: number[] = [];
    const currentVisibleIndices: number[] = [];
    const stamp = this.nextObservationStamp();
    const finalCenterIndex = crossedCenters.length - 1;
    for (let centerIndex = 0; centerIndex < crossedCenters.length; centerIndex++) {
      this.appendMovementVisibility(
        crossedCenters[centerIndex],
        observedIndices,
        stamp,
        centerIndex === finalCenterIndex ? currentVisibleIndices : undefined,
      );
    }

    this.world.clearVisibility();
    for (const index of currentVisibleIndices) this.world.setVisibleNowAtIndex(index, true);

    // The former full-mask scan produced ascending world indices. Preserve that
    // observable ordering while sorting only the radius-bounded observation set.
    observedIndices.sort((left, right) => left - right);
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

  private appendVisibleIndices(origin: GridPoint, output: number[]): void {
    for (const offset of this.offsets) {
      const targetX = origin.x + offset.dx;
      const targetY = origin.y + offset.dy;
      if (!this.world.inBounds(targetX, targetY)) continue;
      if (this.hasLineOfSight(origin.x, origin.y, targetX, targetY)) {
        output.push(this.world.index(targetX, targetY));
      }
    }
  }

  private appendMovementVisibility(
    origin: GridPoint,
    observedIndices: number[],
    stamp: number,
    currentVisibleIndices?: number[],
  ): void {
    for (const offset of this.offsets) {
      const targetX = origin.x + offset.dx;
      const targetY = origin.y + offset.dy;
      if (!this.world.inBounds(targetX, targetY)) continue;
      if (!this.hasLineOfSight(origin.x, origin.y, targetX, targetY)) continue;

      const index = this.world.index(targetX, targetY);
      currentVisibleIndices?.push(index);
      if (this.observedStamps[index] === stamp) continue;
      this.observedStamps[index] = stamp;
      observedIndices.push(index);
    }
  }

  private nextObservationStamp(): number {
    if (this.observedStamps.length !== this.world.tileCount) {
      this.observedStamps = new Uint32Array(this.world.tileCount);
      this.observationStamp = 0;
    }

    this.observationStamp = (this.observationStamp + 1) >>> 0;
    if (this.observationStamp === 0) {
      this.observedStamps.fill(0);
      this.observationStamp = 1;
    }
    return this.observationStamp;
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
