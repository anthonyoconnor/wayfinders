import { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";
import type { VisibilityUpdate } from "./VisibilitySystem";

export interface KnowledgeUpdate {
  changedIndices: readonly number[];
  changedCount: number;
}

/** Converts observed Unknown tiles into expedition-stamped Personal knowledge. */
export class KnowledgeSystem {
  constructor(private world: WorldGrid) {}

  setWorld(world: WorldGrid): void {
    this.world = world;
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
      const point = this.world.pointFromIndex(index);
      if (this.world.getKnowledge(point.x, point.y) !== KnowledgeState.Unknown) continue;
      this.world.setKnowledge(point.x, point.y, KnowledgeState.Personal, expeditionId);
      changedIndices.push(index);
    }
    return { changedIndices, changedCount: changedIndices.length };
  }

  commitExpedition(expeditionId: number): KnowledgeUpdate {
    return this.resolveExpedition(expeditionId, KnowledgeState.Supported);
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
    this.world.forEachTile((x, y, index) => {
      if (
        this.world.getKnowledge(x, y) !== KnowledgeState.Personal
        || this.world.getExpeditionStamp(x, y) !== expeditionId
      ) return;
      this.world.setKnowledge(x, y, target, 0);
      changedIndices.push(index);
    });
    return { changedIndices, changedCount: changedIndices.length };
  }
}
