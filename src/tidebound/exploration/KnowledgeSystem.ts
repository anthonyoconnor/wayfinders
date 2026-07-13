import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";
import type { VisibilityUpdate } from "./VisibilitySystem";

export interface KnowledgeUpdate {
  changedIndices: readonly number[];
  changedCount: number;
  /** Unknown pinholes inferred as Supported by successful-return cleanup. */
  closedUnknownIndices?: readonly number[];
  closedUnknownCount?: number;
}

/** Converts observed Unknown tiles into expedition-stamped Personal knowledge. */
export class KnowledgeSystem {
  private readonly indicesByExpedition = new Map<number, Set<number>>();

  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {
    this.indexExistingPersonalKnowledge();
  }

  setWorld(world: WorldGrid): void {
    this.world = world;
    this.indicesByExpedition.clear();
    this.indexExistingPersonalKnowledge();
  }

  applyVisibility(update: Pick<VisibilityUpdate, "observedIndices">, expeditionId: number): KnowledgeUpdate {
    return this.revealIndices(update.observedIndices, expeditionId);
  }

  /**
   * Commits broad perpendicular strips around navigation-tile centres the
   * ship has actually left. Water at/ahead remains visible but Unknown, so its
   * first traversal pays outward cost without turns pre-charting untouched sea.
   */
  applyTrailingVisibility(
    update: Pick<VisibilityUpdate, "observedIndices" | "crossedCenters">,
    expeditionId: number,
  ): KnowledgeUpdate {
    if (update.crossedCenters.length < 2) return { changedIndices: [], changedCount: 0 };
    const departedStrips = update.crossedCenters.slice(0, -1).map((center, index) => {
      const next = update.crossedCenters[index + 1];
      return { center, directionX: next.x - center.x, directionY: next.y - center.y };
    });
    const trailingIndices = update.observedIndices.filter((index) => {
      const point = this.world.pointFromIndex(index);
      // Remember visible physical landmarks even when they are ahead; they are
      // never traversable and therefore cannot discount outward water travel.
      if (this.world.isMovementBlocked(point.x, point.y)) return true;
      return departedStrips.some(({ center, directionX, directionY }) => {
        const along = (point.x - center.x) * directionX + (point.y - center.y) * directionY;
        const segmentLengthSquared = directionX * directionX + directionY * directionY;
        return along >= 0 && along < segmentLengthSquared;
      });
    });
    return this.revealIndices(trailingIndices, expeditionId);
  }

  revealIndices(indices: Iterable<number>, expeditionId: number): KnowledgeUpdate {
    if (!Number.isInteger(expeditionId) || expeditionId < 0 || expeditionId > 0xffff_ffff) {
      throw new RangeError("expeditionId must be an unsigned 32-bit integer");
    }

    const changedIndices: number[] = [];
    for (const index of indices) {
      if (this.world.getKnowledgeAtIndex(index) !== KnowledgeState.Unknown) continue;
      this.world.setKnowledgeAtIndex(index, KnowledgeState.Personal, expeditionId);
      this.getExpeditionIndices(expeditionId).add(index);
      changedIndices.push(index);
    }
    return { changedIndices, changedCount: changedIndices.length };
  }

  commitExpedition(expeditionId: number): KnowledgeUpdate {
    const committed = this.resolveExpedition(expeditionId, KnowledgeState.Supported);
    const enclosed = this.closeEnclosedUnknownPockets(committed.changedIndices);
    const changedIndices = [...committed.changedIndices, ...enclosed];
    return {
      changedIndices,
      changedCount: changedIndices.length,
      closedUnknownIndices: enclosed,
      closedUnknownCount: enclosed.length,
    };
  }

  revertExpedition(expeditionId: number): KnowledgeUpdate {
    return this.resolveExpedition(expeditionId, KnowledgeState.Unknown);
  }

  private resolveExpedition(
    expeditionId: number,
    target: KnowledgeState.Supported | KnowledgeState.Unknown,
  ): KnowledgeUpdate {
    if (!Number.isInteger(expeditionId) || expeditionId <= 0 || expeditionId > 0xffff_ffff) {
      throw new RangeError("expeditionId must be a non-zero unsigned 32-bit integer");
    }

    const changedIndices: number[] = [];
    const expeditionIndices = this.indicesByExpedition.get(expeditionId);
    if (!expeditionIndices) return { changedIndices, changedCount: 0 };

    for (const index of expeditionIndices) {
      if (
        this.world.getKnowledgeAtIndex(index) !== KnowledgeState.Personal
        || this.world.getExpeditionStampAtIndex(index) !== expeditionId
      ) continue;
      this.world.setKnowledgeAtIndex(index, target, 0);
      changedIndices.push(index);
    }
    this.indicesByExpedition.delete(expeditionId);
    return { changedIndices, changedCount: changedIndices.length };
  }

  private getExpeditionIndices(expeditionId: number): Set<number> {
    let indices = this.indicesByExpedition.get(expeditionId);
    if (!indices) {
      indices = new Set<number>();
      this.indicesByExpedition.set(expeditionId, indices);
    }
    return indices;
  }

  private indexExistingPersonalKnowledge(): void {
    for (const index of this.world.getPersonalKnowledgeIndices()) {
      this.getExpeditionIndices(this.world.getExpeditionStampAtIndex(index)).add(index);
    }
  }

  /**
   * Removes only tiny Unknown pinholes closed by this successful return.
   * Component and boundary decisions use knowledge topology exclusively, so
   * hidden terrain cannot influence whether fog is removed.
   */
  private closeEnclosedUnknownPockets(committedIndices: readonly number[]): number[] {
    const maximumSize = this.config.world.maxEnclosedUnknownTiles;
    if (!Number.isInteger(maximumSize) || maximumSize < 0) {
      throw new RangeError("world.maxEnclosedUnknownTiles must be a non-negative integer");
    }
    if (maximumSize === 0 || committedIndices.length === 0) return [];

    const candidates = new Set<number>();
    for (const index of committedIndices) {
      this.forEachEightNeighbor(index, (neighbor) => {
        if (this.world.getKnowledgeAtIndex(neighbor) === KnowledgeState.Unknown) candidates.add(neighbor);
      });
    }

    const closed: number[] = [];
    for (const seed of candidates) {
      if (this.world.getKnowledgeAtIndex(seed) !== KnowledgeState.Unknown) continue;
      const component = this.collectClosableUnknownComponent(seed, maximumSize);
      if (!component) continue;
      for (const index of component) {
        this.world.setKnowledgeAtIndex(index, KnowledgeState.Supported, 0);
        closed.push(index);
      }
    }
    return closed;
  }

  private collectClosableUnknownComponent(seed: number, maximumSize: number): number[] | undefined {
    const component: number[] = [seed];
    const queued = new Set<number>([seed]);
    let head = 0;

    while (head < component.length) {
      const index = component[head++];
      if (component.length > maximumSize) return undefined;

      const x = index % this.world.width;
      const y = Math.floor(index / this.world.width);
      if (x === 0 || y === 0 || x + 1 === this.world.width || y + 1 === this.world.height) {
        return undefined;
      }

      let supportedBoundary = true;
      this.forEachEightNeighbor(index, (neighbor) => {
        const knowledge = this.world.getKnowledgeAtIndex(neighbor);
        if (knowledge === KnowledgeState.Unknown) {
          if (!queued.has(neighbor)) {
            queued.add(neighbor);
            component.push(neighbor);
          }
        } else if (knowledge !== KnowledgeState.Supported) {
          supportedBoundary = false;
        }
      });
      if (!supportedBoundary) return undefined;
    }

    return component.length <= maximumSize ? component : undefined;
  }

  private forEachEightNeighbor(index: number, visitor: (neighbor: number) => void): void {
    const originX = index % this.world.width;
    const originY = Math.floor(index / this.world.width);
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const y = originY + offsetY;
      if (y < 0 || y >= this.world.height) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (offsetX === 0 && offsetY === 0) continue;
        const x = originX + offsetX;
        if (x < 0 || x >= this.world.width) continue;
        visitor(y * this.world.width + x);
      }
    }
  }
}
