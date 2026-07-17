import { describe, expect, it } from "vitest";
import { buildGreatHallFixture, GREAT_HALL_FIXTURE } from "../src/wayfinders/assets/greatHall/GreatHallFixture";
import {
  GREAT_HALL_ERA_SIZE,
  GREAT_HALL_MAX_GENERATIONS,
  validateGreatHallPresentationModel,
} from "../src/wayfinders/rendering/greatHall/GreatHallPresentationModel";

describe("GR-5.3 Great Hall presentation contract", () => {
  it("validates one checked-in V1 fixture with twenty stable portrait assignments", () => {
    expect(GREAT_HALL_FIXTURE.version).toBe(1);
    expect(GREAT_HALL_FIXTURE.navigators).toHaveLength(GREAT_HALL_MAX_GENERATIONS);
    expect(new Set(GREAT_HALL_FIXTURE.navigators.map(({ portraitUrl }) => portraitUrl)).size).toBe(20);
    for (const [index, navigator] of GREAT_HALL_FIXTURE.navigators.entries()) {
      const generation = index + 1;
      expect(navigator.generation).toBe(generation);
      expect(navigator.portraitUrl).toBe(`/assets/gr5/great-hall/portraits/navigator-${String(generation).padStart(2, "0")}.png`);
      expect(navigator.voyages).toHaveLength(4);
    }
  });

  it.each([1, 12, 13, 20])("derives bounded in-memory fixture variation for %i generations", (navigatorCount) => {
    const model = buildGreatHallFixture({ navigatorCount });
    const selectedEra = Math.floor((model.selectedGeneration - 1) / GREAT_HALL_ERA_SIZE);
    expect(model.navigators).toHaveLength(navigatorCount);
    expect(model.currentGeneration).toBe(navigatorCount);
    expect(model.navigators.at(-1)?.state).toBe("active");
    expect(model.navigators.slice(selectedEra * GREAT_HALL_ERA_SIZE, (selectedEra + 1) * GREAT_HALL_ERA_SIZE).length)
      .toBeLessThanOrEqual(GREAT_HALL_ERA_SIZE);
  });

  it("covers every graphical state and achievement mapping", () => {
    expect(new Set(GREAT_HALL_FIXTURE.navigators.map(({ state }) => state))).toEqual(new Set([
      "active", "completed", "lost-unlocated", "lost-confirmed",
    ]));
    expect(new Set(GREAT_HALL_FIXTURE.navigators.flatMap(({ voyages }) => voyages.flatMap(
      ({ achievements }) => achievements.map(({ kind }) => kind),
    )))).toEqual(new Set([
      "supported-route", "mapped-water", "island-lead", "island-dossier", "survey-lead",
      "survey-report", "fishing-lead", "fishing-survey", "wreck-report", "idol-location",
    ]));
  });

  it("rejects malformed fixture data before rendering", () => {
    expect(() => validateGreatHallPresentationModel({ ...GREAT_HALL_FIXTURE, version: 2 })).toThrow(/version/);
    expect(() => validateGreatHallPresentationModel({
      ...GREAT_HALL_FIXTURE,
      navigators: [{ ...GREAT_HALL_FIXTURE.navigators[0], voyages: [] }],
      currentGeneration: 1,
      selectedGeneration: 1,
    })).toThrow(/four voyage/);
  });

  it("keeps fatal and future voyages free of provisional achievements", () => {
    for (const navigator of GREAT_HALL_FIXTURE.navigators) {
      for (const voyage of navigator.voyages) {
        if (voyage.state !== "returned") expect(voyage.achievements).toEqual([]);
      }
    }
  });

  it.each([1, 2, 20])("models a handover from a terminal navigator to its immediate successor at count %i", (navigatorCount) => {
    const model = buildGreatHallFixture({ navigatorCount, mode: "handover" });
    const selected = model.navigators[model.selectedGeneration - 1]!;

    expect(selected.state).not.toBe("active");
    expect(model.nextGeneration).toBe(model.selectedGeneration + 1);
    expect([model.currentGeneration, model.currentGeneration + 1]).toContain(model.nextGeneration);
  });
});
