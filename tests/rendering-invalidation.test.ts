import { describe, expect, it } from "vitest";
import {
  addCardinalChunkDependents,
  addPaddedChunkNeighbours,
} from "../src/tidebound/rendering/OverlayChunkInvalidation";
import type { WorldChunk } from "../src/tidebound/world/WorldChunk";
import { WorldGrid } from "../src/tidebound/world/WorldGrid";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData";

function keys(chunks: ReadonlySet<WorldChunk>): string[] {
  return [...chunks]
    .map(({ chunkX, chunkY }) => `${chunkX},${chunkY}`)
    .sort();
}

describe("overlay chunk invalidation", () => {
  it("invalidates every chunk sampled by a padded knowledge-mask chunk", () => {
    const world = new WorldGrid(12, 12, 4);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const dirty = new Set<WorldChunk>();

    addPaddedChunkNeighbours(world, world.getChunk(1, 1)!, 1, dirty);

    expect(keys(dirty)).toEqual([
      "0,0", "0,1", "0,2",
      "1,0", "1,1", "1,2",
      "2,0", "2,1", "2,2",
    ]);
  });

  it("invalidates only cardinal chunk dependents for a boundary-dot change", () => {
    const world = new WorldGrid(12, 12, 4);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const dirty = new Set<WorldChunk>();

    addCardinalChunkDependents(world, world.index(4, 4), dirty);

    expect(keys(dirty)).toEqual(["0,1", "1,0", "1,1"]);
  });

  it("keeps an interior boundary-dot change local to its owning chunk", () => {
    const world = new WorldGrid(12, 12, 4);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const dirty = new Set<WorldChunk>();

    addCardinalChunkDependents(world, world.index(5, 6), dirty);

    expect(keys(dirty)).toEqual(["1,1"]);
  });
});
