import { describe, expect, it } from "vitest";
import type { ShipwreckState } from "../src/wayfinders/core/types.ts";
import { createFishingShoalId } from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import { createIdolLocationId } from "../src/wayfinders/exploration/IdolLocationContracts.ts";
import { createSurveySiteId } from "../src/wayfinders/exploration/SurveySiteContracts.ts";
import {
  buildGreatHallChronicle,
  buildGreatHallVoyageAchievementPreview,
  type GreatHallChronicleSources,
} from "../src/wayfinders/lineage/GreatHallChronicle.ts";
import {
  NavigatorLineageSystem,
  type NavigatorVoyageAchievementInputV3,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";
import { adaptGreatHallChronicle } from "../src/wayfinders/rendering/greatHall/GreatHallPresentationAdapter.ts";

const FISHING_LEAD_ID = createFishingShoalId(0);
const FISHING_SURVEY_ID = createFishingShoalId(1);
const SECOND_FISHING_LEAD_ID = createFishingShoalId(2);
const SURVEY_SITE_ID = createSurveySiteId("historic-wreck", 0);
const ISLAND_IDOL_ID = createIdolLocationId(1);
const SURVEY_SITE_IDOL_ID = createIdolLocationId(2);
const THIRD_IDOL_ID = createIdolLocationId(3);
const NO_RETURNED_IDOLS = {
  total: 3,
  returned: [],
} as const;
const ISLAND_DOSSIER = {
  islandId: 7,
  name: "Amber Haven",
  dossier: {
    theme: "anchorage" as const,
    findingLabel: "sheltered anchorage",
    detail: "A sheltered place to anchor.",
    developerArtId: "developer:island-dossier:v1:anchorage",
  },
} as const;
const SURVEY_SITE = {
  id: SURVEY_SITE_ID,
  type: "historic-wreck" as const,
  typeLabel: "Historic wreck",
  clue: { id: "broken-mast", label: "A broken mast above the tide" },
  result: {
    id: "forgotten-route",
    label: "evidence of a forgotten route",
    detail: "The timbers carry marks from an older crossing.",
  },
} as const;

function voyage(
  expeditionId: number,
  overrides: Partial<NavigatorVoyageAchievementInputV3> = {},
): NavigatorVoyageAchievementInputV3 {
  return {
    expeditionId,
    supportedTileCount: 0,
    closedUnknownTileCount: 0,
    islandLeadIds: [],
    islandDossierIds: [],
    surveySiteLeadIds: [],
    surveySiteReportIds: [],
    fishingLeadIds: [],
    fishingSurveyIds: [],
    wreckIds: [],
    achievementOrder: [],
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
  lineage.completeSuccessfulVoyage(voyage(2, {
    islandLeadIds: [7],
    surveySiteLeadIds: [SURVEY_SITE_ID],
  }));
  lineage.completeSuccessfulVoyage(voyage(3, {
    fishingLeadIds: [FISHING_LEAD_ID, SECOND_FISHING_LEAD_ID],
  }));
  lineage.completeSuccessfulVoyage(voyage(4, {
    islandDossierIds: [7],
    surveySiteReportIds: [SURVEY_SITE_ID],
    fishingSurveyIds: [FISHING_SURVEY_ID],
  }));

  lineage.completeSuccessfulVoyage(voyage(5));
  const loss = lineage.beginSuccession("wreck", 31);
  lineage.completeSuccession(loss.transition.key);
  lineage.completeSuccessfulVoyage(voyage(7, { wreckIds: [31] }));

  return {
    lineage,
    sources: {
      islandDossiers: [ISLAND_DOSSIER],
      surveySites: [SURVEY_SITE],
      fishingShoals: [
        { id: FISHING_LEAD_ID, quality: "steady" },
        { id: FISHING_SURVEY_ID, quality: "rich" },
        { id: SECOND_FISHING_LEAD_ID, quality: "lean" },
      ],
      wrecks: [wreck(31, 2, { state: "returned", expeditionId: 7, generation: 3 })],
      idols: {
        total: 3,
        returned: [
          {
            id: ISLAND_IDOL_ID,
            ordinal: 1,
            displayLabel: "Lost Idol 1",
            host: { kind: "island-dossier", islandId: ISLAND_DOSSIER.islandId },
          },
          {
            id: SURVEY_SITE_IDOL_ID,
            ordinal: 2,
            displayLabel: "Lost Idol 2",
            host: { kind: "survey-site", surveySiteId: SURVEY_SITE_ID },
          },
        ],
      },
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
  it("preserves the order in which voyage achievements were found", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(voyage(1, {
      islandLeadIds: [ISLAND_DOSSIER.islandId],
      surveySiteLeadIds: [SURVEY_SITE_ID],
      achievementOrder: [
        { kind: "survey-site-lead", sourceId: SURVEY_SITE_ID },
        { kind: "island-lead", sourceId: ISLAND_DOSSIER.islandId },
      ],
    }));

    const chronicle = buildGreatHallChronicle(lineage.navigators, {
      islandDossiers: [ISLAND_DOSSIER],
      surveySites: [SURVEY_SITE],
      fishingShoals: [],
      wrecks: [],
      idols: NO_RETURNED_IDOLS,
    });

    expect(chronicle.navigators[0].voyages[0].achievements.map(({ kind }) => kind)).toEqual([
      "survey-site-lead",
      "island-lead",
    ]);
  });

  it("validates a provisional idol against the world total rather than this voyage's idol count", () => {
    const lineage = new NavigatorLineageSystem();
    const preview = buildGreatHallVoyageAchievementPreview(
      lineage.navigators,
      lineage.currentNavigator,
      1,
      voyage(1, { islandDossierIds: [ISLAND_DOSSIER.islandId] }),
      {
        islandDossiers: [ISLAND_DOSSIER],
        surveySites: [],
        fishingShoals: [],
        wrecks: [],
        idolTotal: 3,
        idolLocations: [{
          id: THIRD_IDOL_ID,
          ordinal: 3,
          displayLabel: "Lost Idol 3",
          host: { kind: "island-dossier", islandId: ISLAND_DOSSIER.islandId },
        }],
      },
    );

    expect(preview.at(-1)).toMatchObject({
      kind: "idol-location",
      ordinal: 3,
      label: "Lost Idol 3 located — Amber Haven",
    });
  });

  it("projects provisional voyage credits through the exact returned achievement language", () => {
    const lineage = new NavigatorLineageSystem();
    const credits = voyage(1, {
      supportedTileCount: 5,
      islandDossierIds: [ISLAND_DOSSIER.islandId],
      surveySiteReportIds: [SURVEY_SITE_ID],
      fishingLeadIds: [FISHING_LEAD_ID, SECOND_FISHING_LEAD_ID],
      fishingSurveyIds: [FISHING_SURVEY_ID],
    });
    const idolLocations = [
      {
        id: ISLAND_IDOL_ID,
        ordinal: 1,
        displayLabel: "Lost Idol 1",
        host: { kind: "island-dossier" as const, islandId: ISLAND_DOSSIER.islandId },
      },
      {
        id: SURVEY_SITE_IDOL_ID,
        ordinal: 2,
        displayLabel: "Lost Idol 2",
        host: { kind: "survey-site" as const, surveySiteId: SURVEY_SITE_ID },
      },
    ];
    const sharedSources = {
      islandDossiers: [ISLAND_DOSSIER],
      surveySites: [SURVEY_SITE],
      fishingShoals: [
        { id: FISHING_LEAD_ID, quality: "steady" as const },
        { id: FISHING_SURVEY_ID, quality: "rich" as const },
        { id: SECOND_FISHING_LEAD_ID, quality: "lean" as const },
      ],
      wrecks: [],
    };
    const preview = buildGreatHallVoyageAchievementPreview(
      lineage.navigators,
      lineage.currentNavigator,
      1,
      credits,
      { ...sharedSources, idolTotal: 3, idolLocations },
    );

    lineage.completeSuccessfulVoyage(credits);
    const returned = buildGreatHallChronicle(lineage.navigators, {
      ...sharedSources,
      idols: { total: 3, returned: idolLocations },
    }).navigators[0].voyages[0];

    expect(returned.outcome).toBe("returned");
    expect(preview.map(({ kind, label }) => ({ kind, label }))).toEqual(
      returned.achievements.map(({ kind, label }) => ({ kind, label })),
    );
  });

  it("adapts structured chronicle fields into the shared four-band graphical contract", () => {
    const { lineage, sources } = threeGenerationHistory();
    const chronicle = buildGreatHallChronicle(lineage.navigators, sources);
    const model = adaptGreatHallChronicle(chronicle, {
      mode: "home",
      selectedNavigatorId: chronicle.navigators[1].navigatorId,
    });

    expect(model.version).toBe(1);
    expect(model.selectedGeneration).toBe(2);
    expect(model.navigators.map(({ portraitUrl }) => portraitUrl)).toEqual([
      "/assets/gr5/great-hall/portraits/navigator-01.png",
      "/assets/gr5/great-hall/portraits/navigator-02.png",
      "/assets/gr5/great-hall/portraits/navigator-03.png",
    ]);
    expect(model.navigators[1].state).toBe("lost-confirmed");
    expect(model.navigators[1].voyages.map(({ state }) => state)).toEqual(["returned", "lost", "closed", "closed"]);
    expect(model.navigators[1].voyages[1].achievements).toEqual([]);
    expect(model.navigators[2].voyages.map(({ state }) => state)).toEqual(["returned", "awaiting", "unsailed", "unsailed"]);
    expect(model.navigators[0].voyages[0].achievements).toEqual([]);
  });

  it("accepts a death handover after the successor is already the current navigator", () => {
    const { lineage, sources } = threeGenerationHistory();
    const chronicle = buildGreatHallChronicle(lineage.navigators, sources);
    const lost = chronicle.navigators[1];

    const model = adaptGreatHallChronicle(chronicle, {
      mode: "handover",
      selectedNavigatorId: lost.navigatorId,
      nextGeneration: 3,
    });

    expect(model.selectedGeneration).toBe(2);
    expect(model.currentGeneration).toBe(3);
    expect(model.nextGeneration).toBe(3);
    expect(model.navigators[1].state).toBe("lost-confirmed");
  });

  it("derives completed, lost, and active entries with structured committed achievements", () => {
    const { lineage, sources } = threeGenerationHistory();

    const chronicle = buildGreatHallChronicle(lineage.navigators, sources);

    expect(chronicle.readModelVersion).toBe(4);
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

    expect(chronicle.navigators[0].voyages[0].achievements).toEqual([]);
    expect(chronicle.navigators[0].voyages[1].achievements).toEqual([
      expect.objectContaining({
        key: "great-hall:v4:navigator:v1:g1:voyage:2:achievement:island-lead:7",
        kind: "island-lead",
        islandId: 7,
        name: "Amber Haven",
        label: "Recorded a lead for Amber Haven",
      }),
      expect.objectContaining({
        key: `great-hall:v4:navigator:v1:g1:voyage:2:achievement:survey-site-lead:${SURVEY_SITE_ID}`,
        kind: "survey-site-lead",
        surveySiteId: SURVEY_SITE_ID,
        siteType: "historic-wreck",
        typeLabel: "Historic wreck",
        clueLabel: "A broken mast above the tide",
        label: "Recorded a historic wreck lead — A broken mast above the tide",
      }),
    ]);
    expect(chronicle.navigators[0].voyages[2].achievements).toEqual([
      expect.objectContaining({
        key: "great-hall:v4:navigator:v1:g1:voyage:3:achievement:fishing-leads",
        kind: "fishing-leads",
        fishingShoalIds: [FISHING_LEAD_ID, SECOND_FISHING_LEAD_ID],
        leadCount: 2,
        label: "Recorded 2 fishing leads",
      }),
    ]);
    expect(chronicle.navigators[0].voyages[3].achievements).toEqual([
      expect.objectContaining({
        key: "great-hall:v4:navigator:v1:g1:voyage:4:achievement:island-dossier:7",
        kind: "island-dossier",
        islandId: 7,
        name: "Amber Haven",
        findingLabel: "sheltered anchorage",
        label: "Surveyed Amber Haven — sheltered anchorage",
      }),
      expect.objectContaining({
        key: `great-hall:v4:navigator:v1:g1:voyage:4:achievement:idol-location:${ISLAND_IDOL_ID}`,
        kind: "idol-location",
        idolLocationId: ISLAND_IDOL_ID,
        ordinal: 1,
        displayLabel: "Lost Idol 1",
        host: { kind: "island-dossier", islandId: 7 },
        locationLabel: "Amber Haven",
      }),
      expect.objectContaining({
        key: `great-hall:v4:navigator:v1:g1:voyage:4:achievement:survey-site-report:${SURVEY_SITE_ID}`,
        kind: "survey-site-report",
        surveySiteId: SURVEY_SITE_ID,
        siteType: "historic-wreck",
        typeLabel: "Historic wreck",
        resultLabel: "evidence of a forgotten route",
        label: "Surveyed historic wreck — evidence of a forgotten route",
      }),
      expect.objectContaining({
        key: `great-hall:v4:navigator:v1:g1:voyage:4:achievement:idol-location:${SURVEY_SITE_IDOL_ID}`,
        kind: "idol-location",
        idolLocationId: SURVEY_SITE_IDOL_ID,
        ordinal: 2,
        displayLabel: "Lost Idol 2",
        host: { kind: "survey-site", surveySiteId: SURVEY_SITE_ID },
      }),
      expect.objectContaining({
        kind: "fishing-survey",
        fishingShoalId: FISHING_SURVEY_ID,
        quality: "rich",
      }),
    ]);
    expect(chronicle.navigators[2].voyages[0].achievements).toEqual([
      expect.objectContaining({
        key: "great-hall:v4:navigator:v1:g3:voyage:1:achievement:wreck-report:31",
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
      returnedVoyageKey: "great-hall:v4:navigator:v1:g3:voyage:1",
      achievementKey: "great-hall:v4:navigator:v1:g3:voyage:1:achievement:wreck-report:31",
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
      islandDossiers: [{
        ...ISLAND_DOSSIER,
        islandId: 99,
        name: "Provisional Secret",
      }],
      surveySites: [],
      fishingShoals: [],
      wrecks: [wreck(12, 1, survey)],
      idols: NO_RETURNED_IDOLS,
    });
    const lostNavigator = chronicle.navigators[0];
    const fatalVoyage = lostNavigator.voyages[1];

    expect(lostNavigator.wreckFate).toEqual({ state: "unlocated" });
    expect("wreckId" in (lostNavigator.wreckFate ?? {})).toBe(false);
    expect(fatalVoyage).toEqual({
      key: "great-hall:v4:navigator:v1:g1:voyage:2",
      voyageNumber: 2,
      outcome: "lost-at-sea",
      achievements: [],
    });
    expect(chronicle.totals).toMatchObject({
      returnedVoyages: 1,
      lostVoyages: 1,
      islandLeads: 0,
      islandDossiers: 0,
      surveySiteLeads: 0,
      surveySiteReports: 0,
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
        islandDossiers: [],
        surveySites: [],
        fishingShoals: [],
        wrecks: [wreck(wreckId, 1, { state: "unexamined" })],
        idols: NO_RETURNED_IDOLS,
      });
      const lostNavigator = chronicle.navigators[0];

      expect(lostNavigator.voyages).toHaveLength(completedVoyages + 1);
      expect(lostNavigator.voyages.slice(0, completedVoyages).every(
        ({ outcome }) => outcome === "returned",
      )).toBe(true);
      expect(lostNavigator.voyages.at(-1)).toEqual({
        key: `great-hall:v4:navigator:v1:g1:voyage:${completedVoyages + 1}`,
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
      islandLeads: 1,
      islandDossiers: 1,
      surveySiteLeads: 1,
      surveySiteReports: 1,
      fishingLeads: 2,
      fishingSurveys: 1,
      wreckReports: 1,
      idolLocations: 2,
      navigators: 3,
      activeNavigators: 1,
      completedNavigators: 1,
      lostNavigators: 1,
      confirmedWreckFates: 1,
      unlocatedWreckFates: 0,
    });
    expect(chronicle.idolProgress).toEqual({
      found: 2,
      total: 3,
      complete: false,
    });
    for (const field of [
      "returnedVoyages",
      "lostVoyages",
      "islandLeads",
      "islandDossiers",
      "surveySiteLeads",
      "surveySiteReports",
      "fishingLeads",
      "fishingSurveys",
      "wreckReports",
      "idolLocations",
    ] as const) {
      expect(chronicle.navigators.reduce((sum, entry) => sum + entry.totals[field], 0))
        .toBe(chronicle.totals[field]);
    }
  });

  it("marks the count-only idol goal complete from exact-dock host credits", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(voyage(1, {
      islandDossierIds: [ISLAND_DOSSIER.islandId],
      surveySiteReportIds: [SURVEY_SITE_ID],
    }));

    const chronicle = buildGreatHallChronicle(lineage.navigators, {
      islandDossiers: [ISLAND_DOSSIER],
      surveySites: [SURVEY_SITE],
      fishingShoals: [],
      wrecks: [],
      idols: {
        total: 2,
        returned: [
          {
            id: ISLAND_IDOL_ID,
            ordinal: 1,
            displayLabel: "Lost Idol 1",
            host: { kind: "island-dossier", islandId: ISLAND_DOSSIER.islandId },
          },
          {
            id: SURVEY_SITE_IDOL_ID,
            ordinal: 2,
            displayLabel: "Lost Idol 2",
            host: { kind: "survey-site", surveySiteId: SURVEY_SITE_ID },
          },
        ],
      },
    });

    expect(chronicle.idolProgress).toEqual({ found: 2, total: 2, complete: true });
    expect(Object.keys(chronicle.idolProgress).sort()).toEqual(["complete", "found", "total"]);
    expect(chronicle.totals.idolLocations).toBe(2);
    expect(chronicle.navigators[0].voyages[0].achievements
      .filter(({ kind }) => kind === "idol-location")
      .map(({ key }) => key)).toEqual([
      `great-hall:v4:navigator:v1:g1:voyage:1:achievement:idol-location:${ISLAND_IDOL_ID}`,
      `great-hall:v4:navigator:v1:g1:voyage:1:achievement:idol-location:${SURVEY_SITE_IDOL_ID}`,
    ]);
  });

  it("requires every safe returned idol source to have one exact-dock host credit", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(voyage(1, {
      islandLeadIds: [ISLAND_DOSSIER.islandId],
    }));

    expect(() => buildGreatHallChronicle(lineage.navigators, {
      islandDossiers: [ISLAND_DOSSIER],
      surveySites: [],
      fishingShoals: [],
      wrecks: [],
      idols: {
        total: 1,
        returned: [{
          id: ISLAND_IDOL_ID,
          ordinal: 1,
          displayLabel: "Lost Idol 1",
          host: { kind: "island-dossier", islandId: ISLAND_DOSSIER.islandId },
        }],
      },
    })).toThrow(/not credited by an exact-dock voyage/);
  });

  it("rejects duplicate returned idol identities and hosts before deriving the Hall", () => {
    const lineage = new NavigatorLineageSystem();
    const islandSource = {
      id: ISLAND_IDOL_ID,
      ordinal: 1,
      displayLabel: "Lost Idol 1",
      host: { kind: "island-dossier" as const, islandId: ISLAND_DOSSIER.islandId },
    };
    const surveySource = {
      id: SURVEY_SITE_IDOL_ID,
      ordinal: 2,
      displayLabel: "Lost Idol 2",
      host: { kind: "survey-site" as const, surveySiteId: SURVEY_SITE_ID },
    };
    const baseSources = {
      islandDossiers: [ISLAND_DOSSIER],
      surveySites: [SURVEY_SITE],
      fishingShoals: [],
      wrecks: [],
    } as const;

    expect(() => buildGreatHallChronicle(lineage.navigators, {
      ...baseSources,
      idols: {
        total: 2,
        returned: [islandSource, { ...surveySource, id: ISLAND_IDOL_ID }],
      },
    })).toThrow(/Duplicate returned idol location source/);
    expect(() => buildGreatHallChronicle(lineage.navigators, {
      ...baseSources,
      idols: {
        total: 2,
        returned: [islandSource, { ...surveySource, host: islandSource.host }],
      },
    })).toThrow(/Duplicate returned idol host source/);
  });

  it("rejects returned idol hosts outside the safe deterministic source catalogs", () => {
    const lineage = new NavigatorLineageSystem();
    expect(() => buildGreatHallChronicle(lineage.navigators, {
      islandDossiers: [],
      surveySites: [],
      fishingShoals: [],
      wrecks: [],
      idols: {
        total: 1,
        returned: [{
          id: ISLAND_IDOL_ID,
          ordinal: 1,
          displayLabel: "Lost Idol 1",
          host: { kind: "island-dossier", islandId: 77 },
        }],
      },
    })).toThrow(/unknown island dossier 77/);
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

  it("requires one deterministic source for every credited survey site", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(voyage(1, { surveySiteReportIds: [SURVEY_SITE_ID] }));
    const baseSources = {
      islandDossiers: [],
      fishingShoals: [],
      wrecks: [],
      idols: NO_RETURNED_IDOLS,
    } as const;

    expect(() => buildGreatHallChronicle(lineage.navigators, {
      ...baseSources,
      surveySites: [],
    })).toThrow(/unknown survey site/);
    expect(() => buildGreatHallChronicle(lineage.navigators, {
      ...baseSources,
      surveySites: [SURVEY_SITE, SURVEY_SITE],
    })).toThrow(/Duplicate survey site source/);
  });

  it("rejects a wreck-report achievement unless that exact voyage returned it", () => {
    const lineage = new NavigatorLineageSystem();
    const loss = lineage.beginSuccession("wreck", 1);
    lineage.completeSuccession(loss.transition.key);
    lineage.completeSuccessfulVoyage(voyage(2, { wreckIds: [1] }));

    const baseSources = {
      islandDossiers: [],
      surveySites: [],
      fishingShoals: [],
      idols: NO_RETURNED_IDOLS,
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
