import { describe, expect, it } from "vitest";
import {
  GREAT_HALL_ERA_SIZE,
  GREAT_HALL_PREVIEW_MAX_GENERATIONS,
  GREAT_HALL_PREVIEW_ROSTER,
  buildGreatHallPreviewModel,
} from "../src/wayfinders/assets/greatHall/GreatHallPreviewModel";

describe("GR-5.1 Great Hall approval fixtures", () => {
  it("owns exactly twenty fixed portrait assignments", () => {
    expect(GREAT_HALL_PREVIEW_MAX_GENERATIONS).toBe(20);
    expect(GREAT_HALL_PREVIEW_ROSTER).toHaveLength(20);
    expect(new Set(GREAT_HALL_PREVIEW_ROSTER.map(({ portraitUrl }) => portraitUrl)).size).toBe(20);
    for (const [index, navigator] of GREAT_HALL_PREVIEW_ROSTER.entries()) {
      const generation = index + 1;
      expect(navigator.generation).toBe(generation);
      expect(navigator.portraitUrl).toBe(
        `/assets/gr5/great-hall/portraits/navigator-${String(generation).padStart(2, "0")}.png`,
      );
    }
  });

  it.each([1, 12, 13, 20])("bounds the era presentation for %i generations", (navigatorCount) => {
    const selected = buildGreatHallPreviewModel({ navigatorCount });
    expect(selected.navigatorCount).toBe(navigatorCount);
    expect(selected.visibleNavigators.length).toBeLessThanOrEqual(GREAT_HALL_ERA_SIZE);
    expect(selected.selectedNavigator.generation).toBe(navigatorCount);
    expect(selected.selectedNavigator.state).toBe("active");
    expect(selected.selectedNavigator.voyages).toHaveLength(4);
    expect(selected.eraCount).toBe(Math.ceil(navigatorCount / GREAT_HALL_ERA_SIZE));
  });

  it("does not reveal a wreck confirmation before its confirming generation", () => {
    const beforeConfirmation = buildGreatHallPreviewModel({ navigatorCount: 8, selectedGeneration: 5 });
    const afterConfirmation = buildGreatHallPreviewModel({ navigatorCount: 9, selectedGeneration: 5 });

    expect(beforeConfirmation.selectedNavigator.state).toBe("lost-unlocated");
    expect(beforeConfirmation.selectedNavigator.confirmedByGeneration).toBeUndefined();
    expect(afterConfirmation.selectedNavigator.state).toBe("lost-confirmed");
    expect(afterConfirmation.selectedNavigator.confirmedByGeneration).toBe(9);
  });

  it("keeps all fatal voyages free of provisional achievements", () => {
    for (const navigator of GREAT_HALL_PREVIEW_ROSTER) {
      for (const voyage of navigator.voyages) {
        if (voyage.state !== "returned") expect(voyage.achievements).toEqual([]);
      }
    }
  });

  it("covers every required state and achievement kind in the fixed roster", () => {
    expect(new Set(GREAT_HALL_PREVIEW_ROSTER.map(({ state }) => state))).toEqual(new Set([
      "active",
      "completed",
      "lost-unlocated",
      "lost-confirmed",
    ]));
    const achievements = new Set(GREAT_HALL_PREVIEW_ROSTER.flatMap(({ voyages }) =>
      voyages.flatMap(({ achievements: voyageAchievements }) => voyageAchievements.map(({ kind }) => kind))));
    expect(achievements).toEqual(new Set([
      "supported-route",
      "mapped-water",
      "island-lead",
      "island-dossier",
      "survey-lead",
      "survey-report",
      "fishing-lead",
      "fishing-survey",
      "wreck-report",
      "idol-location",
    ]));
  });

  it("shows every achievement asset across dense returned voyages in the default memorial", () => {
    const current = buildGreatHallPreviewModel({ navigatorCount: 20 }).selectedNavigator;
    const returnedVoyages = current.voyages.filter(({ state }) => state === "returned");

    expect(returnedVoyages).toHaveLength(3);
    expect(returnedVoyages.every(({ achievements }) => achievements.length > 1)).toBe(true);
    expect(new Set(returnedVoyages.flatMap(({ achievements }) =>
      achievements.map(({ kind }) => kind)))).toEqual(new Set([
      "supported-route",
      "mapped-water",
      "island-lead",
      "island-dossier",
      "survey-lead",
      "survey-report",
      "fishing-lead",
      "fishing-survey",
      "wreck-report",
      "idol-location",
    ]));
    expect(current.voyages[3]?.state).toBe("awaiting");
  });
});
