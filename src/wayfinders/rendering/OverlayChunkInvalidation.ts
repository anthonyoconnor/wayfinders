import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";

/** Marks a changed chunk and every chunk sampled by tile padding around it. */
export function addPaddedChunkNeighbours(
  world: WorldGrid,
  changed: WorldChunk,
  paddingTiles: number,
  dirtyChunks: Set<WorldChunk>,
): void {
  const padding = Math.max(0, Math.ceil(paddingTiles));
  const minX = changed.chunkX * world.chunkSize;
  const minY = changed.chunkY * world.chunkSize;
  const maxX = Math.min(world.width, minX + world.chunkSize) - 1;
  const maxY = Math.min(world.height, minY + world.chunkSize) - 1;
  for (const piece of world.topology.decomposeTileBounds({
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  })) {
    const minimumChunkX = Math.floor(piece.minX / world.chunkSize);
    const maximumChunkX = Math.floor(piece.maxX / world.chunkSize);
    const minimumChunkY = Math.floor(piece.minY / world.chunkSize);
    const maximumChunkY = Math.floor(piece.maxY / world.chunkSize);
    for (let chunkY = minimumChunkY; chunkY <= maximumChunkY; chunkY++) {
      for (let chunkX = minimumChunkX; chunkX <= maximumChunkX; chunkX++) {
        const neighbour = world.getChunk(chunkX, chunkY);
        if (neighbour) dirtyChunks.add(neighbour);
      }
    }
  }
}

/**
 * Marks the tile's chunk plus an adjacent chunk when a cardinal-neighbour
 * pattern in that chunk samples this tile across their shared boundary.
 */
export function addCardinalChunkDependents(
  world: WorldGrid,
  worldIndex: number,
  dirtyChunks: Set<WorldChunk>,
): void {
  const x = worldIndex % world.width;
  const y = Math.floor(worldIndex / world.width);
  addTileOwnerChunkIfLoaded(world, x, y, dirtyChunks);
  for (const neighbour of world.topology.uniqueCardinalNeighbors({ x, y })) {
    addTileOwnerChunkIfLoaded(world, neighbour.x, neighbour.y, dirtyChunks);
  }
}

function addTileOwnerChunkIfLoaded(
  world: WorldGrid,
  tileX: number,
  tileY: number,
  dirtyChunks: Set<WorldChunk>,
): void {
  const chunk = world.getChunk(
    Math.floor(tileX / world.chunkSize),
    Math.floor(tileY / world.chunkSize),
  );
  if (chunk) dirtyChunks.add(chunk);
}
