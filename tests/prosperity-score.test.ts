import { describe, expect, it } from "vitest";
import { createFishingShoalId } from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import { createIdolLocationId } from "../src/wayfinders/exploration/IdolLocationContracts.ts";
import { createSurveySiteId } from "../src/wayfinders/exploration/SurveySiteContracts.ts";
import {
  PROSPERITY_SCORE_CONTRACT_VERSION,
  PROSPERITY_SCORE_SCHEDULE_V1,
  ProsperityScoreSystem,
  ProsperityScoreValidationError,
  type PreparedProsperitySettlementV1,
  type ProsperityScoreCatalogV1,
  type ProsperitySettlementInputV1,
} from "../src/wayfinders/features/prosperity/index.ts";
import { IslandSize } from "../src/wayfinders/world/IslandGenerator.ts";

const HISTORIC_WRECK = createSurveySiteId("historic-wreck", 0);
const COASTAL_RUIN = createSurveySiteId("coastal-ruin", 0);
const TIDAL_CAVE = createSurveySiteId("tidal-cave", 0);
const LEAN_SHOAL = createFishingShoalId(0);
const STEADY_SHOAL = createFishingShoalId(1);
const RICH_SHOAL = createFishingShoalId(2);
const IDOL = createIdolLocationId(1);

const CATALOG = Object.freeze({
  islandDossiers: Object.freeze([
    Object.freeze({ islandId: 1, size: IslandSize.Small }),
    Object.freeze({ islandId: 2, size: IslandSize.Medium }),
    Object.freeze({ islandId: 3, size: IslandSize.Large }),
  ]),
  surveySites: Object.freeze([
    Object.freeze({ id: HISTORIC_WRECK }),
    Object.freeze({ id: COASTAL_RUIN }),
    Object.freeze({ id: TIDAL_CAVE }),
  ]),
  fishingShoals: Object.freeze([
    Object.freeze({ id: LEAN_SHOAL, quality: "lean" as const }),
    Object.freeze({ id: STEADY_SHOAL, quality: "steady" as const }),
    Object.freeze({ id: RICH_SHOAL, quality: "rich" as const }),
  ]),
  idolLocations: Object.freeze([Object.freeze({ id: IDOL })]),
}) satisfies Readonly<ProsperityScoreCatalogV1>;

function input(
  overrides: Partial<Omit<ProsperitySettlementInputV1, "contractVersion">> = {},
): ProsperitySettlementInputV1 {
  return {
    contractVersion: PROSPERITY_SCORE_CONTRACT_VERSION,
    islandLeadIds: [],
    islandDossierIds: [],
    surveySiteLeadIds: [],
    surveySiteReportIds: [],
    fishingLeadIds: [],
    fishingSurveyIds: [],
    confirmedWreckIds: [],
    idolLocationIds: [],
    ...overrides,
  };
}

function valuesBySource(system: ProsperityScoreSystem): Record<string, number> {
  return Object.fromEntries(system.snapshot().ledger.map((entry) => [
    `${entry.kind}:${entry.sourceId}`,
    entry.value,
  ]));
}

describe("ProsperityScoreSystem", () => {
  it("owns the exact cumulative V1 valuation schedule", () => {
    expect(PROSPERITY_SCORE_SCHEDULE_V1).toEqual({
      contractVersion: 1,
      island: { lead: 1, dossierBySize: { small: 5, medium: 7, large: 9 } },
      surveySite: { lead: 1, report: 7 },
      fishingShoal: { lead: 1, surveyByQuality: { lean: 5, steady: 7, rich: 9 } },
      navigatorWreck: { confirmedReport: 4 },
      idolLocation: { returned: 12 },
    });
    expect(Object.isFrozen(PROSPERITY_SCORE_SCHEDULE_V1)).toBe(true);
    expect(Object.isFrozen(PROSPERITY_SCORE_SCHEDULE_V1.island.dossierBySize)).toBe(true);
    expect(Object.isFrozen(PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.surveyByQuality)).toBe(true);
  });

  it("scores every island size, fishing quality, site report, unique wreck and idol", () => {
    const system = new ProsperityScoreSystem(CATALOG);
    const prepared = system.prepareSettlement(input({
      islandLeadIds: [3, 1, 2],
      islandDossierIds: [2, 3, 1],
      surveySiteLeadIds: [TIDAL_CAVE, HISTORIC_WRECK, COASTAL_RUIN],
      surveySiteReportIds: [COASTAL_RUIN, TIDAL_CAVE, HISTORIC_WRECK],
      fishingLeadIds: [RICH_SHOAL, LEAN_SHOAL, STEADY_SHOAL],
      fishingSurveyIds: [STEADY_SHOAL, RICH_SHOAL, LEAN_SHOAL],
      confirmedWreckIds: [41, 41],
      idolLocationIds: [IDOL],
    }));

    expect(prepared.delta).toBe(79);
    expect(system.score).toBe(0);
    const committed = system.commitSettlement(prepared);
    expect(committed).toMatchObject({ status: "applied", previousScore: 0, score: 79, delta: 79, revision: 1 });
    expect(valuesBySource(system)).toEqual({
      [`island:1`]: 5,
      [`island:2`]: 7,
      [`island:3`]: 9,
      [`survey-site:${HISTORIC_WRECK}`]: 7,
      [`survey-site:${COASTAL_RUIN}`]: 7,
      [`survey-site:${TIDAL_CAVE}`]: 7,
      [`fishing-shoal:${LEAN_SHOAL}`]: 5,
      [`fishing-shoal:${STEADY_SHOAL}`]: 7,
      [`fishing-shoal:${RICH_SHOAL}`]: 9,
      "navigator-wreck:41": 4,
      [`idol-location:${IDOL}`]: 12,
    });
  });

  it("makes direct completed returns equal lead-then-upgrade returns", () => {
    const direct = new ProsperityScoreSystem(CATALOG);
    direct.commitSettlement(direct.prepareSettlement(input({
      islandLeadIds: [2],
      islandDossierIds: [2],
      surveySiteLeadIds: [HISTORIC_WRECK],
      surveySiteReportIds: [HISTORIC_WRECK],
      fishingLeadIds: [STEADY_SHOAL],
      fishingSurveyIds: [STEADY_SHOAL],
    })));

    const finalOnly = new ProsperityScoreSystem(CATALOG);
    finalOnly.commitSettlement(finalOnly.prepareSettlement(input({
      islandDossierIds: [2],
      surveySiteReportIds: [HISTORIC_WRECK],
      fishingSurveyIds: [STEADY_SHOAL],
    })));

    const staged = new ProsperityScoreSystem(CATALOG);
    staged.commitSettlement(staged.prepareSettlement(input({
      islandLeadIds: [2],
      surveySiteLeadIds: [HISTORIC_WRECK],
      fishingLeadIds: [STEADY_SHOAL],
    })));
    expect(staged.snapshot()).toMatchObject({ score: 3, revision: 1 });
    staged.commitSettlement(staged.prepareSettlement(input({
      islandDossierIds: [2],
      surveySiteReportIds: [HISTORIC_WRECK],
      fishingSurveyIds: [STEADY_SHOAL],
    })));

    expect(direct.score).toBe(21);
    expect(finalOnly.score).toBe(21);
    expect(staged.score).toBe(21);
    expect(valuesBySource(direct)).toEqual(valuesBySource(staged));
    expect(valuesBySource(finalOnly)).toEqual(valuesBySource(staged));
    expect(direct.revision).toBe(1);
    expect(staged.revision).toBe(2);
  });

  it("is idempotent across replay, duplicate IDs, lower states, and input permutations", () => {
    const system = new ProsperityScoreSystem(CATALOG);
    const firstPlan = system.prepareSettlement(input({
      islandLeadIds: [1, 1],
      islandDossierIds: [1],
      fishingLeadIds: [RICH_SHOAL],
      fishingSurveyIds: [RICH_SHOAL, RICH_SHOAL],
    }));
    const first = system.commitSettlement(firstPlan);
    expect(first).toMatchObject({ status: "applied", score: 14, delta: 14, revision: 1 });
    const snapshot = system.snapshot();

    expect(system.commitSettlement(firstPlan)).toMatchObject({
      status: "unchanged", score: 14, delta: 0, revision: 1,
    });
    const reordered = system.prepareSettlement(input({
      fishingSurveyIds: [RICH_SHOAL],
      fishingLeadIds: [RICH_SHOAL, RICH_SHOAL],
      islandDossierIds: [1, 1],
      islandLeadIds: [1],
    }));
    expect(reordered.delta).toBe(0);
    expect(reordered.sources.map(({ key }) => key)).toEqual(
      [...reordered.sources].map(({ key }) => key).sort(),
    );
    expect(system.commitSettlement(reordered).status).toBe("unchanged");
    expect(system.commitSettlement(system.prepareSettlement(input({
      islandLeadIds: [1],
      fishingLeadIds: [RICH_SHOAL],
    }))).status).toBe("unchanged");
    expect(system.snapshot()).toBe(snapshot);
  });

  it("prepares without mutation and returns deeply immutable authority", () => {
    const system = new ProsperityScoreSystem(CATALOG);
    const initial = system.snapshot();
    expect(initial).toEqual({
      contractVersion: 1,
      scheduleVersion: 1,
      score: 0,
      revision: 0,
      ledger: [],
    });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.ledger)).toBe(true);

    const prepared = system.prepareSettlement(input({ islandLeadIds: [1] }));
    expect(system.snapshot()).toBe(initial);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.sources)).toBe(true);
    expect(Object.isFrozen(prepared.sources[0])).toBe(true);

    const result = system.commitSettlement(prepared);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.changedSources)).toBe(true);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.ledger)).toBe(true);
    expect(Object.isFrozen(result.snapshot.ledger[0])).toBe(true);
    expect(result.snapshot).toBe(system.snapshot());
  });

  it("changes revision only when the score changes", () => {
    const system = new ProsperityScoreSystem(CATALOG);
    const empty = system.prepareSettlement(input());
    expect(system.commitSettlement(empty)).toMatchObject({ status: "unchanged", score: 0, revision: 0 });

    system.commitSettlement(system.prepareSettlement(input({ confirmedWreckIds: [7] })));
    expect(system.snapshot()).toMatchObject({ score: 4, revision: 1 });
    system.commitSettlement(system.prepareSettlement(input({ confirmedWreckIds: [7, 7] })));
    expect(system.snapshot()).toMatchObject({ score: 4, revision: 1 });
  });

  it("rejects a stale unapplied plan without partially changing the ledger", () => {
    const system = new ProsperityScoreSystem(CATALOG);
    const islandPlan = system.prepareSettlement(input({ islandLeadIds: [1] }));
    const fishingPlan = system.prepareSettlement(input({ fishingLeadIds: [LEAN_SHOAL] }));
    system.commitSettlement(islandPlan);

    expect(() => system.commitSettlement(fishingPlan)).toThrow(/stale Prosperity authority/);
    expect(system.snapshot()).toMatchObject({ score: 1, revision: 1 });
    expect(valuesBySource(system)).toEqual({ "island:1": 1 });
    expect(system.commitSettlement(islandPlan).status).toBe("unchanged");
  });

  it("validates catalogs, IDs, canonical values, overflow, and atomic preparation", () => {
    expect(() => new ProsperityScoreSystem({
      ...CATALOG,
      islandDossiers: [CATALOG.islandDossiers[0], CATALOG.islandDossiers[0]],
    })).toThrow(/duplicates island 1/);

    const system = new ProsperityScoreSystem(CATALOG);
    expect(() => system.prepareSettlement(input({
      islandLeadIds: [1],
      islandDossierIds: [99],
    }))).toThrow(ProsperityScoreValidationError);
    expect(system.snapshot()).toMatchObject({ score: 0, revision: 0, ledger: [] });

    const valid = system.prepareSettlement(input({ islandDossierIds: [1] }));
    const invalidTarget = {
      ...valid,
      sources: valid.sources.map((source) => ({
        ...source,
        targetValue: 6,
        delta: 6,
      })),
      delta: 6,
      score: 6,
    } as unknown as PreparedProsperitySettlementV1;
    expect(() => system.commitSettlement(invalidTarget)).toThrow(/canonical cumulative source value/);
    const overflow = {
      ...valid,
      score: Number.MAX_SAFE_INTEGER + 1,
    } as unknown as PreparedProsperitySettlementV1;
    expect(() => system.commitSettlement(overflow)).toThrow(/non-negative safe integer/);
    expect(system.snapshot()).toMatchObject({ score: 0, revision: 0, ledger: [] });
  });

  it("structurally excludes route and mapped-water telemetry", () => {
    type ForbiddenSettlementKey = Extract<
      keyof ProsperitySettlementInputV1,
      "supportedTileCount" | "closedUnknownTileCount" | "routeLength" | "mappedWaterCount"
    >;
    const hasNoForbiddenKeys: [ForbiddenSettlementKey] extends [never] ? true : false = true;
    expect(hasNoForbiddenKeys).toBe(true);

    const system = new ProsperityScoreSystem(CATALOG);
    const withRawTileTelemetry = {
      ...input(),
      supportedTileCount: 50_000,
    } as unknown as ProsperitySettlementInputV1;
    expect(() => system.prepareSettlement(withRawTileTelemetry)).toThrow(/unsupported field supportedTileCount/);
    expect(system.snapshot()).toMatchObject({ score: 0, revision: 0, ledger: [] });
  });

  it("is independent of catalog and settlement iteration order", () => {
    const forward = new ProsperityScoreSystem(CATALOG);
    const reversed = new ProsperityScoreSystem({
      islandDossiers: [...CATALOG.islandDossiers].reverse(),
      surveySites: [...CATALOG.surveySites].reverse(),
      fishingShoals: [...CATALOG.fishingShoals].reverse(),
      idolLocations: [...CATALOG.idolLocations].reverse(),
    });
    forward.commitSettlement(forward.prepareSettlement(input({
      islandDossierIds: [1, 2, 3],
      surveySiteReportIds: [HISTORIC_WRECK, COASTAL_RUIN, TIDAL_CAVE],
      fishingSurveyIds: [LEAN_SHOAL, STEADY_SHOAL, RICH_SHOAL],
      idolLocationIds: [IDOL],
    })));
    reversed.commitSettlement(reversed.prepareSettlement(input({
      idolLocationIds: [IDOL],
      fishingSurveyIds: [RICH_SHOAL, STEADY_SHOAL, LEAN_SHOAL],
      surveySiteReportIds: [TIDAL_CAVE, COASTAL_RUIN, HISTORIC_WRECK],
      islandDossierIds: [3, 2, 1],
    })));

    expect(reversed.snapshot()).toEqual(forward.snapshot());
  });
});
