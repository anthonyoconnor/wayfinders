import { describe, expect, it } from "vitest";
import { createSurveyBudget } from "../src/wayfinders/exploration/SurveyContracts";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  createFishingFeature,
  createFishingShoalId,
  surveyFishingShoal,
  type FishingShoalDefinition,
} from "../src/wayfinders/features/fishing";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { makeConfig } from "./helpers";

function definition(
  ordinal: number,
  x: number,
  quality: FishingShoalDefinition["quality"],
): Readonly<FishingShoalDefinition> {
  const tile = Object.freeze({ x, y: 0 });
  return Object.freeze({
    id: createFishingShoalId(ordinal),
    contentVersion: FISHING_SHOAL_CONTENT_VERSION,
    tile,
    serviceAnchor: tile,
    quality,
    clue: Object.freeze({
      kind: "seabirds",
      intensity: 2,
      label: `Seabirds near ${x}`,
    }),
  });
}

describe("fishing feature vertical slice", () => {
  it("handles a survey through the command boundary and returns typed mutation effects", () => {
    const world = new WorldGrid(5, 2, 5);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const definitions = Object.freeze([
      definition(0, 1, "rich"),
      definition(1, 4, "steady"),
    ]);
    const feature = createFishingFeature({
      world,
      definitions,
      homeReturnTile: { x: 0, y: 0 },
      config: makeConfig(),
    });

    const first = definitions[0];
    const firstIndex = world.index(first.tile.x, first.tile.y);
    expect(feature.observeCurrentSight(7, 3, [firstIndex]).found).toEqual([{
      id: first.id,
      state: "sighted",
      expeditionId: 7,
      generation: 3,
    }]);

    const budget = createSurveyBudget(2, 12, 3);
    expect(feature.interactionNear(first.tile, budget)).toMatchObject({
      id: first.id,
      state: "sighted",
      canAfford: true,
    });
    const result = feature.execute(surveyFishingShoal(first.id), {
      shipTile: first.tile,
      expeditionId: 7,
      generation: 3,
      surveyBudget: budget,
    });

    expect(result.outcome).toMatchObject({
      status: "surveyed",
      id: first.id,
      quality: "rich",
    });
    expect(result.mutation).toEqual({
      recordsChanged: true,
      presentationChanged: true,
      recordsRevision: 2,
      changedShoalIds: [first.id],
    });

    const rejected = feature.execute(surveyFishingShoal(first.id), {
      shipTile: first.tile,
      expeditionId: 7,
      generation: 3,
      surveyBudget: budget,
    });
    expect(rejected.outcome).toMatchObject({ status: "rejected", reason: "already-surveyed" });
    expect(rejected.mutation).toMatchObject({
      recordsChanged: false,
      presentationChanged: false,
      recordsRevision: 2,
      changedShoalIds: [],
    });

    expect(feature.commitExpedition(7).surveys).toHaveLength(1);
    expect(feature.returned).toEqual([expect.objectContaining({
      id: first.id,
      state: "survey",
    })]);
  });
});
