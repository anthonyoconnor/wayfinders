import { describe, expect, it } from "vitest";
import { createSurveyBudget } from "../src/wayfinders/exploration/SurveyContracts";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  FishingPresentationAdapter,
  createFishingFeature,
  createFishingShoalId,
  selectFishingDefinition,
  selectFishingPresentation,
  selectReturnedFishingSurveys,
  surveyFishingShoal,
  type FishingPresentationPort,
  type FishingPresentationReadModel,
  type FishingShoalDefinition,
} from "../src/wayfinders/features/fishing";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";

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

class RecordingFishingPort implements FishingPresentationPort {
  readonly models: FishingPresentationReadModel[] = [];

  syncFishing(model: Readonly<FishingPresentationReadModel>): void {
    this.models.push(model);
  }
}

describe("fishing feature vertical slice", () => {
  it("handles a survey through commands and exposes immutable state through selectors", () => {
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
    });

    const first = definitions[0];
    const firstIndex = world.index(first.tile.x, first.tile.y);
    expect(feature.observeCurrentSight(7, 3, [firstIndex]).found).toEqual([{
      id: first.id,
      state: "sighted",
      expeditionId: 7,
      generation: 3,
    }]);

    const before = feature.stateSnapshot();
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.provisional[0])).toBe(true);
    expect(selectFishingDefinition(before, first.id)).toMatchObject({ quality: "rich" });

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
    const returned = feature.stateSnapshot();
    expect(selectReturnedFishingSurveys(returned)).toEqual([expect.objectContaining({
      id: first.id,
      state: "survey",
    })]);
  });

  it("updates a renderer-neutral port only when presentation revisions change", () => {
    const world = new WorldGrid(5, 2, 5);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const target = definition(0, 2, "lean");
    const feature = createFishingFeature({
      world,
      definitions: [target],
      homeReturnTile: { x: 0, y: 0 },
    });
    const adapter = new FishingPresentationAdapter();
    const port = new RecordingFishingPort();

    expect(adapter.sync(feature, port)).toBe(true);
    expect(adapter.sync(feature, port)).toBe(false);
    expect(port.models).toHaveLength(1);
    expect(port.models[0].shoals).toHaveLength(0);

    const targetIndex = world.index(target.tile.x, target.tile.y);
    world.setVisibleNowAtIndex(targetIndex, true);
    feature.observeCurrentSight(2, 1, [targetIndex]);

    expect(adapter.sync(feature, port)).toBe(true);
    expect(port.models).toHaveLength(2);
    const presented = selectFishingPresentation(port.models[1], target.id);
    expect(presented).toMatchObject({ state: "sighted", clue: target.clue });
    expect(presented).not.toHaveProperty("quality");
    expect(Object.isFrozen(port.models[1])).toBe(true);
    expect(Object.isFrozen(presented)).toBe(true);

    adapter.invalidate();
    expect(adapter.sync(feature, port)).toBe(true);
    expect(port.models).toHaveLength(3);
  });
});
