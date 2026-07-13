import { describe, expect, it } from "vitest";
import {
  NavigatorLineageSystem,
  type NavigatorRecordV3,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";
import { buildNavigatorGenerationSummary } from "../src/wayfinders/rendering/NavigatorGenerationSummary.ts";

function completeVoyages(lineage: NavigatorLineageSystem, count: number): void {
  for (let voyage = 0; voyage < count; voyage++) lineage.completeSuccessfulVoyage();
}

describe("navigator generation summary", () => {
  it("builds four returned rows for a completed tenure", () => {
    const lineage = new NavigatorLineageSystem();
    completeVoyages(lineage, 4);

    const summary = buildNavigatorGenerationSummary(lineage.navigators[0]);

    expect(summary).toEqual({
      generation: 1,
      navigatorId: "navigator:v1:g1",
      outcome: "tenure-completed",
      nextGeneration: 2,
      journeys: [
        { voyageNumber: 1, outcome: "returned" },
        { voyageNumber: 2, outcome: "returned" },
        { voyageNumber: 3, outcome: "returned" },
        { voyageNumber: 4, outcome: "returned" },
      ],
    });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.journeys)).toBe(true);
    expect(summary.journeys.every(Object.isFrozen)).toBe(true);
  });

  it.each([0, 1, 2, 3])(
    "shows %i returned voyages followed by the voyage where the navigator was lost",
    (completedVoyages) => {
      const lineage = new NavigatorLineageSystem();
      completeVoyages(lineage, completedVoyages);
      lineage.beginSuccession("wreck", 20 + completedVoyages);

      const summary = buildNavigatorGenerationSummary(lineage.currentNavigator);

      expect(summary).toMatchObject({
        generation: 1,
        navigatorId: "navigator:v1:g1",
        outcome: "lost-at-sea",
        nextGeneration: 2,
      });
      expect(summary.journeys).toEqual([
        ...Array.from({ length: completedVoyages }, (_, index) => ({
          voyageNumber: index + 1,
          outcome: "returned",
        })),
        { voyageNumber: completedVoyages + 1, outcome: "lost-at-sea" },
      ]);
    },
  );

  it("rejects an active navigator", () => {
    const navigator = new NavigatorLineageSystem().currentNavigator;

    expect(() => buildNavigatorGenerationSummary(navigator)).toThrow(/terminal navigator/);
  });

  it("guards the terminal voyage-count assumptions used by the read model", () => {
    const completedLineage = new NavigatorLineageSystem();
    completeVoyages(completedLineage, 4);
    const invalidCompleted = {
      ...completedLineage.navigators[0],
      completedVoyages: 3,
    } as NavigatorRecordV3;
    expect(() => buildNavigatorGenerationSummary(invalidCompleted)).toThrow(/must have 4 returned voyages/);

    const lostLineage = new NavigatorLineageSystem();
    lostLineage.beginSuccession("wreck", 1);
    const invalidLost = {
      ...lostLineage.currentNavigator,
      completedVoyages: 4,
    } as NavigatorRecordV3;
    expect(() => buildNavigatorGenerationSummary(invalidLost)).toThrow(/fewer than 4 returned voyages/);
  });
});
