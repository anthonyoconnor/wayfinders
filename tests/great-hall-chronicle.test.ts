import { describe, expect, it } from "vitest";
import type { ShipwreckState } from "../src/wayfinders/core/types.ts";
import { createFishingShoalId } from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import {
  buildGreatHallChronicle,
  type GreatHallChronicleSources,
} from "../src/wayfinders/lineage/GreatHallChronicle.ts";
import {
  NavigatorLineageSystem,
  type NavigatorVoyageAchievementInputV1,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";

const FISHING_LEAD_ID = createFishingShoalId(0);
const FISHING_SURVEY_ID = createFishingShoalId(1);
const SECOND_FISHING_LEAD_ID = createFishingShoalId(2);

function voyage(
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

function wreck(
  id: number,
  generation: number,
  survey: ShipwreckState["survey"],
): Pick<ShipwreckState, "id" | "generation" | "survey"> {
  return { id, generation, survey };
}

function threeGenerationHistory(): {
  lineage: NavigatorLineageSystem;
  sources: GreatHallChronicleSources;
} {
  const lineage = new NavigatorLineageSystem();
  lineage.completeSuccessfulVoyage(voyage(1, {
    supportedTileCount: 5,
    closedUnknownTileCount: 2,
  }));
  lineage.completeSuccessfulVoyage(voyage(2, { discoveryIds: [7] }));
  lineage.completeSuccessfulVoyage(voyage(3, {
    fishingLeadIds: [FISHING_LEAD_ID, SECOND_FISHING_LEAD_ID],
  }));
  lineage.completeSuccessfulVoyage(voyage(4, { fishingSurveyIds: [FISHING_SURVEY_ID] }));

  lineage.completeSuccessfulVoyage(voyage(5));
  const loss = lineage.beginSuccession("wreck", 31);
  lineage.completeSuccession(loss.transition.key);
  lineage.completeSuccessfulVoyage(voyage(7, { wreckIds: [31] }));

  return {
    lineage,
    sources: {
      discoveries: [{ id: 7, name: "Amber Haven" }],
      fishingShoals: [
        { id: FISHING_LEAD_ID, quality: "steady" },
        { id: FISHING_SURVEY_ID, quality: "rich" },
        { id: SECOND_FISHING_LEAD_ID, quality: "lean" },
      ],
      wrecks: [wreck(31, 2, { state: "returned", expeditionId: 7, generation: 3 })],
    },
  };
}

function allStableKeys(chronicle: ReturnType<typeof buildGreatHallChronicle>): string[] {
  return chronicle.navigators.flatMap((navigator) => [
    navigator.key,
    ...navigator.voyages.flatMap((voyageRecord) => [
      voyageRecord.key,
      ...voyageRecord.achievements.map(({ key }) => key),
    ]),
  ]);
}

describe("Great Hall chronicle read model", () => {
  it("derives completed, lost, and active entries with structured committed achievements", () => {
    const { lineage, sources } = threeGenerationHistory();

    const chronicle = buildGreatHallChronicle(lineage.navigators, sources);

    expect(chronicle.readModelVersion).toBe(1);
    expect(chronicle.navigators.map(({ generation, state, completedVoyages }) => ({
      generation,
      state,
      completedVoyages,
    }))).toEqual([
      { generation: 1, state: "completed", completedVoyages: 4 },
      { generation: 2, state: "lost", completedVoyages: 1 },
      { generation: 3, state: "active", completedVoyages: 1 },
    ]);
    expect(chronicle.navigators[0].voyages.map(({ voyageNumber, outcome }) => ({
      voyageNumber,
      outcome,
    }))).toEqual([
      { voyageNumber: 1, outcome: "returned" },
      { voyageNumber: 2, outcome: "returned" },
      { voyageNumber: 3, outcome: "returned" },
      { voyageNumber: 4, outcome: "returned" },
    ]);
    expect(chronicle.navigators[1].voyages.map(({ voyageNumber, outcome }) => ({
      voyageNumber,
      outcome,
    }))).toEqual([
      { voyageNumber: 1, outcome: "returned" },
      { voyageNumber: 2, outcome: "lost-at-sea" },
    ]);
    expect(chronicle.navigators[2].voyages.map(({ voyageNumber, outcome }) => ({
      voyageNumber,
      outcome,
    }))).toEqual([{ voyageNumber: 1, outcome: "returned" }]);

    expect(chronicle.navigators[0].voyages[0].achievements).toEqual([
      {
        key: "great-hall:v1:navigator:v1:g1:voyage:1:achievement:supported-route-tiles",
        kind: "supported-route-tiles",
        tileCount: 5,
        label: "Supported 5 route tiles",
      },
      {
        key: "great-hall:v1:navigator:v1:g1:voyage:1:achievement:mapped-enclosed-water-tiles",
        kind: "mapped-enclosed-water-tiles",
        tileCount: 2,
        label: "Mapped 2 enclosed water tiles",
      },
    ]);
    expect(chronicle.navigators[0].voyages[1].achievements).toEqual([
      expect.objectContaining({
        kind: "discovery",
        discoveryId: 7,
        name: "Amber Haven",
        label: "Discovered Amber Haven",
      }),
    ]);
    expect(chronicle.navigators[0].voyages[2].achievements).toEqual([
      expect.objectContaining({
        key: "great-hall:v1:navigator:v1:g1:voyage:3:achievement:fishing-leads",
        kind: "fishing-leads",
        fishingShoalIds: [FISHING_LEAD_ID, SECOND_FISHING_LEAD_ID],
        leadCount: 2,
        label: "Recorded 2 fishing leads",
      }),
    ]);
    expect(chronicle.navigators[0].voyages[3].achievements).toEqual([
      expect.objectContaining({
        kind: "fishing-survey",
        fishingShoalId: FISHING_SURVEY_ID,
        quality: "rich",
      }),
    ]);
    expect(chronicle.navigators[2].voyages[0].achievements).toEqual([
      expect.objectContaining({
        key: "great-hall:v1:navigator:v1:g3:voyage:1:achievement:wreck-report:31",
        kind: "wreck-report",
        wreckId: 31,
        lostNavigatorId: "navigator:v1:g2",
        lostGeneration: 2,
      }),
    ]);
  });

  it("attaches a returned wreck report to the lost navigator while preserving surveyor credit", () => {
    const { lineage, sources } = threeGenerationHistory();

    const chronicle = buildGreatHallChronicle(lineage.navigators, sources);
    const lostNavigator = chronicle.navigators[1];

    expect(lostNavigator.wreckFate).toEqual({
      state: "confirmed",
      wreckId: 31,
      returnedByNavigatorId: "navigator:v1:g3",
      returnedByGeneration: 3,
      returnedOnVoyage: 1,
      returnedVoyageKey: "great-hall:v1:navigator:v1:g3:voyage:1",
      achievementKey: "great-hall:v1:navigator:v1:g3:voyage:1:achievement:wreck-report:31",
    });
    expect(lostNavigator.totals.wreckReports).toBe(0);
    expect(chronicle.navigators[2].totals.wreckReports).toBe(1);
  });

  it.each([
    { state: "unexamined" as const },
    { state: "provisional" as const, expeditionId: 2, generation: 2 },
  ])("keeps a $state wreck unlocated and gives the fatal voyage no provisional credit", (survey) => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(voyage(1, { supportedTileCount: 3 }));
    lineage.beginSuccession("wreck", 12);

    const chronicle = buildGreatHallChronicle(lineage.navigators, {
      discoveries: [{ id: 99, name: "Provisional Secret" }],
      fishingShoals: [],
      wrecks: [wreck(12, 1, survey)],
    });
    const lostNavigator = chronicle.navigators[0];
    const fatalVoyage = lostNavigator.voyages[1];

    expect(lostNavigator.wreckFate).toEqual({ state: "unlocated" });
    expect("wreckId" in (lostNavigator.wreckFate ?? {})).toBe(false);
    expect(fatalVoyage).toEqual({
      key: "great-hall:v1:navigator:v1:g1:voyage:2",
      voyageNumber: 2,
      outcome: "lost-at-sea",
      achievements: [],
    });
    expect(chronicle.totals).toMatchObject({
      returnedVoyages: 1,
      lostVoyages: 1,
      discoveries: 0,
      confirmedWreckFates: 0,
      unlocatedWreckFates: 1,
    });
  });

  it.each([0, 1, 2, 3])(
    "records a fatal journey after %i successful returns",
    (completedVoyages) => {
      const lineage = new NavigatorLineageSystem();
      for (let expeditionId = 1; expeditionId <= completedVoyages; expeditionId += 1) {
        lineage.completeSuccessfulVoyage(voyage(expeditionId));
      }
      const wreckId = 40 + completedVoyages;
      lineage.beginSuccession("wreck", wreckId);

      const chronicle = buildGreatHallChronicle(lineage.navigators, {
        discoveries: [],
        fishingShoals: [],
        wrecks: [wreck(wreckId, 1, { state: "unexamined" })],
      });
      const lostNavigator = chronicle.navigators[0];

      expect(lostNavigator.voyages).toHaveLength(completedVoyages + 1);
      expect(lostNavigator.voyages.slice(0, completedVoyages).every(
        ({ outcome }) => outcome === "returned",
      )).toBe(true);
      expect(lostNavigator.voyages.at(-1)).toEqual({
        key: `great-hall:v1:navigator:v1:g1:voyage:${completedVoyages + 1}`,
        voyageNumber: completedVoyages + 1,
        outcome: "lost-at-sea",
        achievements: [],
      });
      expect(lostNavigator.completedVoyages).toBe(completedVoyages);
      expect(lostNavigator.wreckFate).toEqual({ state: "unlocated" });
    },
  );

  it("derives reconciling non-secret totals without a duplicate aggregate authority", () => {
    const { lineage, sources } = threeGenerationHistory();

    const chronicle = buildGreatHallChronicle(lineage.navigators, sources);

    expect(chronicle.totals).toEqual({
      returnedVoyages: 6,
      lostVoyages: 1,
      supportedRouteTiles: 5,
      mappedEnclosedWaterTiles: 2,
      discoveries: 1,
      fishingLeads: 2,
      fishingSurveys: 1,
      wreckReports: 1,
      navigators: 3,
      activeNavigators: 1,
      completedNavigators: 1,
      lostNavigators: 1,
      confirmedWreckFates: 1,
      unlocatedWreckFates: 0,
    });
    for (const field of [
      "returnedVoyages",
      "lostVoyages",
      "supportedRouteTiles",
      "mappedEnclosedWaterTiles",
      "discoveries",
      "fishingLeads",
      "fishingSurveys",
      "wreckReports",
    ] as const) {
      expect(chronicle.navigators.reduce((sum, entry) => sum + entry.totals[field], 0))
        .toBe(chronicle.totals[field]);
    }
  });

  it("keeps all keys unique and stable across a current-lineage replay", () => {
    const { lineage, sources } = threeGenerationHistory();
    const first = buildGreatHallChronicle(lineage.navigators, sources);
    const restored = NavigatorLineageSystem.fromSnapshot(structuredClone(lineage.snapshot()));
    const replayed = buildGreatHallChronicle(restored.navigators, structuredClone(sources));
    const keys = allStableKeys(first);

    expect(new Set(keys).size).toBe(keys.length);
    expect(allStableKeys(replayed)).toEqual(keys);
    expect(replayed).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.navigators)).toBe(true);
    expect(first.navigators.every(Object.isFrozen)).toBe(true);
    expect(first.navigators.every(({ voyages, totals }) => (
      Object.isFrozen(voyages) && Object.isFrozen(totals)
    ))).toBe(true);
    expect(first.navigators.flatMap(({ voyages }) => voyages).every(Object.isFrozen)).toBe(true);
  });

  it("rejects a wreck-report achievement unless that exact voyage returned it", () => {
    const lineage = new NavigatorLineageSystem();
    const loss = lineage.beginSuccession("wreck", 1);
    lineage.completeSuccession(loss.transition.key);
    lineage.completeSuccessfulVoyage(voyage(2, { wreckIds: [1] }));

    const baseSources = {
      discoveries: [],
      fishingShoals: [],
    } as const;
    expect(() => buildGreatHallChronicle(lineage.navigators, {
      ...baseSources,
      wrecks: [wreck(1, 1, { state: "provisional", expeditionId: 2, generation: 2 })],
    })).toThrow(/not returned by it/);
    expect(() => buildGreatHallChronicle(lineage.navigators, {
      ...baseSources,
      wrecks: [wreck(1, 1, { state: "returned", expeditionId: 99, generation: 2 })],
    })).toThrow(/not returned by it/);
  });
});
