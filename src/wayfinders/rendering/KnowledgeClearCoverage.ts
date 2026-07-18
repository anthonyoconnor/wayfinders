import type { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";

/** Island dossiers reveal only the exact generated non-home island footprint. */
export function isExactIslandTileRevealed(
  islandId: number,
  revealedIslandIds: ReadonlySet<number>,
): boolean {
  return islandId > 0 && revealedIslandIds.has(islandId);
}

/** Canonical logical predicate for pixels where the knowledge overlay contributes no fog. */
export function isKnowledgeOverlayFullyClearAtTile(
  world: WorldGrid,
  x: number,
  y: number,
  revealedIslandIds: ReadonlySet<number>,
): boolean {
  const canonical = world.topology.canonicalizeTile(x, y);
  if (!canonical) return false;
  return world.isVisibleNow(canonical.x, canonical.y)
    || world.getKnowledge(canonical.x, canonical.y) === KnowledgeState.Supported
    || isExactIslandTileRevealed(
      world.getIslandId(canonical.x, canonical.y),
      revealedIslandIds,
    );
}

/**
 * Stable clear space for atmosphere. Transient line of sight is intentionally
 * excluded so moving the ship cannot create and remove short-lived clouds.
 */
export function isKnowledgeOverlayDurablyClearAtTile(
  world: WorldGrid,
  x: number,
  y: number,
  revealedIslandIds: ReadonlySet<number>,
): boolean {
  const canonical = world.topology.canonicalizeTile(x, y);
  if (!canonical) return false;
  return world.getKnowledge(canonical.x, canonical.y) === KnowledgeState.Supported
    || isExactIslandTileRevealed(
      world.getIslandId(canonical.x, canonical.y),
      revealedIslandIds,
    );
}

function isKnowledgeOverlayClearInBounds(
  world: WorldGrid,
  bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
  revealedIslandIds: ReadonlySet<number>,
  paddingTiles: number,
  isClearAtTile: (
    world: WorldGrid,
    x: number,
    y: number,
    revealedIslandIds: ReadonlySet<number>,
  ) => boolean,
): boolean {
  const minX = Math.floor(bounds.minX) - paddingTiles;
  const minY = Math.floor(bounds.minY) - paddingTiles;
  const maxX = Math.ceil(bounds.maxX) + paddingTiles;
  const maxY = Math.ceil(bounds.maxY) + paddingTiles;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isClearAtTile(world, x, y, revealedIslandIds)) return false;
    }
  }
  return true;
}

/**
 * Conservative clear-coverage query for independently rendered atmosphere.
 * Padding protects the fog mask's filtered tile edge without sharing renderer
 * internals or duplicating knowledge-state interpretation.
 */
export function isKnowledgeOverlayFullyClearInBounds(
  world: WorldGrid,
  bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
  revealedIslandIds: ReadonlySet<number>,
  paddingTiles = 0,
): boolean {
  return isKnowledgeOverlayClearInBounds(
    world,
    bounds,
    revealedIslandIds,
    paddingTiles,
    isKnowledgeOverlayFullyClearAtTile,
  );
}

/** Conservative stable-clear query used by long-lived atmosphere routes. */
export function isKnowledgeOverlayDurablyClearInBounds(
  world: WorldGrid,
  bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
  revealedIslandIds: ReadonlySet<number>,
  paddingTiles = 0,
): boolean {
  return isKnowledgeOverlayClearInBounds(
    world,
    bounds,
    revealedIslandIds,
    paddingTiles,
    isKnowledgeOverlayDurablyClearAtTile,
  );
}
