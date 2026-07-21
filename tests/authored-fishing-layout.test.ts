import { describe, expect, it } from "vitest";

import {
  FISHING_SHOAL_MAX_ORDINAL,
  authoredFishingCapacityProofV1,
  compileAuthoredFishingLayoutV1,
  createAuthoredFishingShoalV1,
  createCurrentAuthoredFishingLayoutV1,
  createFishingShoalId,
} from "../src/wayfinders/features/fishing";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology";
import { WorldAnalysisIndex } from "../src/wayfinders/world/analysis";

function openOceanWorld(width = 64, height = 64): { world: WorldGrid; analysis: WorldAnalysisIndex } {
  const world = new WorldGrid(width, height, 16, WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  return {
    world,
    analysis: WorldAnalysisIndex.build(world, { sourceId: "authored-fishing-test" }),
  };
}

describe("MAP-1.1 authored fishing layout", () => {
  it("materializes exact anchors and preserves ID-keyed clues across position and quality edits", () => {
    const { world, analysis } = openOceanWorld();
    const seed = 91;
    const id = createFishingShoalId(17);
    const original = createAuthoredFishingShoalV1(seed, id, { x: 2, y: 2 }, "lean");
    const edited = createAuthoredFishingShoalV1(seed, id, { x: 18, y: 2 }, "rich");
    const result = compileAuthoredFishingLayoutV1(
      createCurrentAuthoredFishingLayoutV1([original, edited]),
      seed,
      world,
      analysis,
      { x: 32, y: 32 },
    );

    expect(original.clue).toEqual(edited.clue);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected duplicate stable ID rejection");
    expect(result.diagnostics.some(({ code }) => code === "duplicate-id")).toBe(true);

    const valid = compileAuthoredFishingLayoutV1(
      createCurrentAuthoredFishingLayoutV1([edited]),
      seed,
      world,
      analysis,
      { x: 32, y: 32 },
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error("Expected valid authored fishing layout");
    expect(valid.definitions[0].serviceAnchor).toBe(valid.definitions[0].tile);
  });

  it("enforces separation across a wrapped seam and proves the ID range exceeds geometric capacity", () => {
    const { world, analysis } = openOceanWorld();
    const seed = 92;
    const result = compileAuthoredFishingLayoutV1(
      createCurrentAuthoredFishingLayoutV1([
        createAuthoredFishingShoalV1(seed, createFishingShoalId(1), { x: 0, y: 0 }, "steady"),
        createAuthoredFishingShoalV1(seed, createFishingShoalId(2), { x: 63, y: 0 }, "steady"),
      ]),
      seed,
      world,
      analysis,
      { x: 32, y: 32 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected periodic separation rejection");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "shoal-separation" }),
    ]));
    const proof = authoredFishingCapacityProofV1(192, 192);
    expect(proof.maximumShoalCount).toBe(400);
    expect(FISHING_SHOAL_MAX_ORDINAL + 1).toBeGreaterThan(proof.maximumShoalCount);
  });

  it.each([
    ["x", { x: 0, y: 20 }, { x: 181, y: 20 }],
    ["y", { x: 20, y: 0 }, { x: 20, y: 181 }],
    ["corner", { x: 0, y: 0 }, { x: 181, y: 189 }],
  ] as const)("rejects a penultimate-bucket conflict across the wrapped %s seam", (
    _seam,
    first,
    second,
  ) => {
    const { world, analysis } = openOceanWorld(192, 192);
    const seed = 93;
    const result = compileAuthoredFishingLayoutV1(
      createCurrentAuthoredFishingLayoutV1([
        createAuthoredFishingShoalV1(seed, createFishingShoalId(1), first, "steady"),
        createAuthoredFishingShoalV1(seed, createFishingShoalId(2), second, "steady"),
      ]),
      seed,
      world,
      analysis,
      { x: 96, y: 96 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected periodic separation rejection");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "shoal-separation" }),
    ]));
  });
});
