import { describe, expect, it } from "vitest";
import { createFishingShoalId } from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import {
  NavigatorLineageSystem,
  type NavigatorRecordV4,
  type NavigatorVoyageAchievementInputV1,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";
import {
  buildNavigatorGenerationSummary,
  type NavigatorAchievementSources,
} from "../src/wayfinders/rendering/NavigatorGenerationSummary.ts";

const FISHING_LEAD_ID = createFishingShoalId(0);
const FISHING_SURVEY_ID = createFishingShoalId(1);
const SOURCES: NavigatorAchievementSources = {
  discoveries: [{ id: 17, name: "Amber Haven" }],
  fishingShoals: [
    { id: FISHING_LEAD_ID, quality: "steady" },
    { id: FISHING_SURVEY_ID, quality: "rich" },
  ],
  wrecks: [{ id: 9, generation: 3 }],
};

function achievements(
  expeditionId: number,
  overrides: Partial<NavigatorVoyageAchievementInputV1> = {},
): NavigatorVoyageAchievementInputV1 {
  return {
    expeditionId,
    supportedTileCount: 0,
    closedUnknownTileCount: 0,
    discoveryIds: [],
    fishingLeadIds: [],
    fishingSurveyIds: [],
    wreckIds: [],
    ...overrides,
  };
}

function completeVoyages(lineage: NavigatorLineageSystem, count: number): void {
  for (let voyage = 0; voyage < count; voyage++) {
    lineage.completeSuccessfulVoyage(achievements(voyage + 1));
  }
}

describe("navigator generation summary", () => {
  it("builds four returned rows with the achievements committed on each voyage", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(achievements(1, {
      supportedTileCount: 12,
      closedUnknownTileCount: 2,
    }));
    lineage.completeSuccessfulVoyage(achievements(2, {
      discoveryIds: [17],
      fishingLeadIds: [FISHING_LEAD_ID],
    }));
    lineage.completeSuccessfulVoyage(achievements(3, {
      fishingSurveyIds: [FISHING_SURVEY_ID],
    }));
    lineage.completeSuccessfulVoyage(achievements(4, {
      wreckIds: [9],
    }));

    const summary = buildNavigatorGenerationSummary(lineage.navigators[0], SOURCES);

    expect(summary).toEqual({
      generation: 1,
      navigatorId: "navigator:v1:g1",
      outcome: "tenure-completed",
      nextGeneration: 2,
      journeys: [
        {
          voyageNumber: 1,
          outcome: "returned",
          achievements: [
            "Supported 12 route tiles",
            "Mapped 2 enclosed water tiles",
          ],
        },
        {
          voyageNumber: 2,
          outcome: "returned",
          achievements: [
            "Discovered Amber Haven",
            "Recorded 1 fishing lead",
          ],
        },
        {
          voyageNumber: 3,
          outcome: "returned",
          achievements: ["Surveyed a rich fishing ground"],
        },
        {
          voyageNumber: 4,
          outcome: "returned",
          achievements: ["Identified the Generation 3 navigator's wreck"],
        },
      ],
    });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.journeys)).toBe(true);
    expect(summary.journeys.every(Object.isFrozen)).toBe(true);
    expect(summary.journeys.every(({ achievements }) => Object.isFrozen(achievements))).toBe(true);
  });

  it("labels a safe voyage with no committed achievements", () => {
    const lineage = new NavigatorLineageSystem();
    completeVoyages(lineage, 4);

    const summary = buildNavigatorGenerationSummary(lineage.navigators[0], SOURCES);

    expect(summary.journeys).toEqual(Array.from({ length: 4 }, (_, index) => ({
      voyageNumber: index + 1,
      outcome: "returned",
      achievements: ["No new findings returned."],
    })));
  });

  it.each([0, 1, 2, 3])(
    "shows %i returned voyages followed by the voyage where the navigator was lost",
    (completedVoyages) => {
      const lineage = new NavigatorLineageSystem();
      completeVoyages(lineage, completedVoyages);
      lineage.beginSuccession("wreck", 20 + completedVoyages);

      const summary = buildNavigatorGenerationSummary(lineage.currentNavigator, SOURCES);

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
          achievements: ["No new findings returned."],
        })),
        {
          voyageNumber: completedVoyages + 1,
          outcome: "lost-at-sea",
          achievements: ["No findings from this journey were returned."],
        },
      ]);
    },
  );

  it("rejects an active navigator", () => {
    const navigator = new NavigatorLineageSystem().currentNavigator;

    expect(() => buildNavigatorGenerationSummary(navigator, SOURCES)).toThrow(/terminal navigator/);
  });

  it("guards the terminal voyage-count assumptions used by the read model", () => {
    const completedLineage = new NavigatorLineageSystem();
    completeVoyages(completedLineage, 4);
    const invalidCompleted = {
      ...completedLineage.navigators[0],
      completedVoyages: 3,
    } as NavigatorRecordV4;
    expect(() => buildNavigatorGenerationSummary(invalidCompleted, SOURCES))
      .toThrow(/must have 4 returned voyages/);

    const lostLineage = new NavigatorLineageSystem();
    lostLineage.beginSuccession("wreck", 1);
    const invalidLost = {
      ...lostLineage.currentNavigator,
      completedVoyages: 4,
    } as NavigatorRecordV4;
    expect(() => buildNavigatorGenerationSummary(invalidLost, SOURCES))
      .toThrow(/fewer than 4 returned voyages/);
  });
});
