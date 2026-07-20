import { describe, expect, it } from "vitest";
import { buildGreatHallFixture, GREAT_HALL_FIXTURE } from "../src/wayfinders/assets/greatHall/GreatHallFixture";
import { buildGreatHallPreviewWorkbenchMarkup } from "../src/wayfinders/assets/greatHall/GreatHallPreviewWorkbench";
import {
  ACHIEVEMENT_ICON_KINDS,
  achievementIconRowPositionPercent,
} from "../src/wayfinders/assets/achievementIcons";
import { GreatHallRenderer } from "../src/wayfinders/rendering/greatHall/GreatHallRenderer";
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
      "island-lead", "island-dossier", "survey-lead",
      "survey-report", "fishing-lead", "fishing-survey", "wreck-report", "idol-location",
    ]));
  });

  it("binds every Great Hall achievement kind to the shared animated sprite row", () => {
    const root = {
      addEventListener: () => undefined,
      innerHTML: "",
      querySelectorAll: () => [],
      replaceChildren: () => undefined,
    } as unknown as HTMLElement;
    const renderer = new GreatHallRenderer(root);
    let renderedMarkup = "";

    for (let selectedGeneration = 1; selectedGeneration <= GREAT_HALL_MAX_GENERATIONS; selectedGeneration += 1) {
      renderer.update(buildGreatHallFixture({
        navigatorCount: GREAT_HALL_MAX_GENERATIONS,
        selectedGeneration,
      }));
      renderedMarkup += root.innerHTML;
    }

    for (const kind of ACHIEVEMENT_ICON_KINDS) {
      expect(renderedMarkup).toContain(
        `class="achievement-icon gh-symbol" data-achievement-icon-kind="${kind}" `
        + `style="--achievement-icon-row-position:${achievementIconRowPositionPercent(kind)}%"`,
      );
    }
    expect(renderedMarkup).toContain("data-gh-voyage-position=\"1\"");
    expect(renderedMarkup).toContain("--gh-log-index:0");
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

  it.each([3, 12, 20].flatMap((navigatorCount) =>
    Array.from({ length: navigatorCount }, (_, index) => ({
      navigatorCount,
      requestedSelection: index + 1,
    }))))(
    "normalizes handover selection $requestedSelection at count $navigatorCount to the immediate predecessor",
    ({ navigatorCount, requestedSelection }) => {
      const model = buildGreatHallFixture({
        navigatorCount,
        selectedGeneration: requestedSelection,
        mode: "handover",
      });

      expect(model.selectedGeneration).toBe(navigatorCount - 1);
      expect(model.nextGeneration).toBe(navigatorCount);
      expect(model.navigators[model.selectedGeneration - 1]?.state).not.toBe("active");
    },
  );

  it("uses the normalized handover memorial in the preview workbench", () => {
    const model = buildGreatHallFixture({
      navigatorCount: 12,
      selectedGeneration: 2,
      mode: "handover",
    });

    const markup = buildGreatHallPreviewWorkbenchMarkup(model, "desktop");
    expect(markup).toContain("Generation 11");
    expect(markup).toContain("navigator-11.png");
    expect(markup).not.toContain("Generation 2<");
  });
});
