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
   * ship has actually left. Crossed centres remain lifted so seam traversal
   * retains its physical direction. Water at/ahead remains visible but Unknown,
   * so its first traversal pays outward cost without turns pre-charting untouched sea.
   */
  applyTrailingVisibility(
    update: Pick<VisibilityUpdate, "observedIndices" | "crossedCenters">,
    expeditionId: number,
  ): KnowledgeUpdate {
    if (update.crossedCenters.length < 2) return { changedIndices: [], changedCount: 0 };
    const trailingIndices: number[] = [];
    for (const index of update.observedIndices) {
      // Remember visible physical landmarks even when they are ahead; they are
      // never traversable and therefore cannot discount outward water travel.
      if (
        this.world.isMovementBlockedAtIndex(index)
        && this.world.getFineCollisionMaskAtIndex(index) === undefined
      ) {
        trailingIndices.push(index);
        continue;
      }
      for (let segment = 0; segment + 1 < update.crossedCenters.length; segment++) {
        const center = update.crossedCenters[segment];
        const next = update.crossedCenters[segment + 1];
        const directionX = next.x - center.x;
        const directionY = next.y - center.y;
        const segmentLengthSquared = directionX * directionX + directionY * directionY;
        if (segmentLengthSquared === 0) continue;
        const canonicalCenter = this.world.topology.normalizeTile(center.x, center.y);
        const candidate = { x: index % this.world.width, y: Math.floor(index / this.world.width) };
        const displacement = this.world.topology.minimumImageTileDisplacement(canonicalCenter, candidate);
        const displacementX = this.directionalTiedDisplacement(
          displacement.x,
          this.world.width,
          this.world.topology.wrapsX,
          directionX,
        );
        const displacementY = this.directionalTiedDisplacement(
          displacement.y,
          this.world.height,
          this.world.topology.wrapsY,
          directionY,
        );
        const along = displacementX * directionX + displacementY * directionY;
        if (along >= 0 && along < segmentLengthSquared) {
          trailingIndices.push(index);
          break;
        }
      }
    }
    return this.revealIndices(trailingIndices, expeditionId);
  }

  revealIndices(indices: Iterable<number>, expeditionId: number): KnowledgeUpdate {
    if (!Number.isInteger(expeditionId) || expeditionId <= 0 || expeditionId > 0xffff_ffff) {
      throw new RangeError("expeditionId must be a non-zero unsigned 32-bit integer");
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
      if (
        (!this.world.topology.wrapsX && (x === 0 || x + 1 === this.world.width))
        || (!this.world.topology.wrapsY && (y === 0 || y + 1 === this.world.height))
      ) {
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
    for (const neighbor of this.world.topology.uniqueEightNeighbors({ x: originX, y: originY })) {
      visitor(neighbor.y * this.world.width + neighbor.x);
    }
  }

  private directionalTiedDisplacement(
    displacement: number,
    span: number,
    wraps: boolean,
    direction: number,
  ): number {
    if (wraps && direction !== 0 && displacement !== 0 && Math.abs(displacement) * 2 === span) {
      return Math.sign(direction) * Math.abs(displacement);
    }
    return displacement;
  }
}
