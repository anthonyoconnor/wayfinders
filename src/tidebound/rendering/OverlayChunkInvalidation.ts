import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";

/** Marks a changed chunk and every chunk sampled by tile padding around it. */
export function addPaddedChunkNeighbours(
  world: WorldGrid,
  changed: WorldChunk,
  paddingTiles: number,
  dirtyChunks: Set<WorldChunk>,
): void {
  const chunkRadius = Math.ceil(Math.max(0, paddingTiles) / world.chunkSize);
  for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
    for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
      const neighbour = world.getChunk(changed.chunkX + dx, changed.chunkY + dy);
      if (neighbour) dirtyChunks.add(neighbour);
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
  const chunkX = Math.floor(x / world.chunkSize);
  const chunkY = Math.floor(y / world.chunkSize);
  const ownChunk = world.getChunk(chunkX, chunkY);
  if (!ownChunk) return;
  dirtyChunks.add(ownChunk);

  const localX = x - chunkX * world.chunkSize;
  const localY = y - chunkY * world.chunkSize;
  if (localX === 0) addChunkIfLoaded(world, chunkX - 1, chunkY, dirtyChunks);
  if (localX + 1 === world.chunkSize) addChunkIfLoaded(world, chunkX + 1, chunkY, dirtyChunks);
  if (localY === 0) addChunkIfLoaded(world, chunkX, chunkY - 1, dirtyChunks);
  if (localY + 1 === world.chunkSize) addChunkIfLoaded(world, chunkX, chunkY + 1, dirtyChunks);
}

function addChunkIfLoaded(
  world: WorldGrid,
  chunkX: number,
  chunkY: number,
  dirtyChunks: Set<WorldChunk>,
): void {
  const chunk = world.getChunk(chunkX, chunkY);
  if (chunk) dirtyChunks.add(chunk);
}
