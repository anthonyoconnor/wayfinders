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
}
