import { describe, expect, it } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";

describe("GameSimulation spatial descriptor integration", () => {
  it("coalesces all interaction getters into one query per ship tile and spatial revision", () => {
    const simulation = new GameSimulation();
    const before = simulation.descriptorSpatialQueryTotals;

    void simulation.fishingShoalInteraction;
    void simulation.surveySiteInteraction;
    void simulation.islandDossierInteraction;
    void simulation.wreckSurveyInteraction;
    const afterFirstRead = simulation.descriptorSpatialQueryTotals;
    expect(afterFirstRead.queryCount - before.queryCount).toBe(1);

    void simulation.wreckSurveyInteraction;
    void simulation.fishingShoalInteraction;
    expect(simulation.descriptorSpatialQueryTotals).toEqual(afterFirstRead);
  });

  it("reuses sparse read models and one visible-candidate query while revisions are stable", () => {
    const simulation = new GameSimulation();
    const before = simulation.descriptorSpatialQueryTotals;
    const firstFishing = simulation.fishingShoalReadModels;
    const firstSurveys = simulation.surveySiteReadModels;
    const firstDossiers = simulation.islandDossierReadModels;
    const afterFirstRead = simulation.descriptorSpatialQueryTotals;

    expect(afterFirstRead.queryCount - before.queryCount).toBe(1);
    expect(simulation.fishingShoalReadModels).toBe(firstFishing);
    expect(simulation.surveySiteReadModels).toBe(firstSurveys);
    expect(simulation.islandDossierReadModels).toBe(firstDossiers);
    expect(simulation.descriptorSpatialQueryTotals).toEqual(afterFirstRead);

    simulation.update({ turn: 0, throttle: 0 }, 1 / 30);
    expect(simulation.fishingShoalReadModels).toBe(firstFishing);
    expect(simulation.surveySiteReadModels).toBe(firstSurveys);
    expect(simulation.descriptorSpatialQueryTotals).toEqual(afterFirstRead);
  });
});
