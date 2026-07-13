import type { GridPoint } from "../core/types";
import { WorldGrid } from "../world/WorldGrid";

export type NeighborVisitor = (neighborIndex: number, x: number, y: number) => void;

export class GridGraph {
  constructor(readonly world: WorldGrid) {}

  index(point: GridPoint): number {
    return this.world.index(point.x, point.y);
  }

  point(index: number): GridPoint {
    return this.world.pointFromIndex(index);
  }

  forEachCardinalNeighbor(index: number, visitor: NeighborVisitor): void {
    const x = index % this.world.width;
    const y = Math.floor(index / this.world.width);
    if (x > 0) visitor(index - 1, x - 1, y);
    if (x + 1 < this.world.width) visitor(index + 1, x + 1, y);
    if (y > 0) visitor(index - this.world.width, x, y - 1);
    if (y + 1 < this.world.height) visitor(index + this.world.width, x, y + 1);
  }
}
