import type { FishingShoalDefinition, FishingShoalId, FishingShoalQuality } from "../fishing";
import type { IdolLocationDefinition, IdolLocationId } from "../../exploration/IdolLocationContracts";
import type { IslandDossierDefinitionV1 } from "../../exploration/IslandDossierContracts";
import type { SurveySiteDefinition, SurveySiteId } from "../../exploration/SurveySiteContracts";
import type { IslandSize } from "../../world/IslandGenerator";

export const PROSPERITY_SCORE_CONTRACT_VERSION = 1 as const;
export const PROSPERITY_SCORE_SCHEDULE_VERSION = 1 as const;

export const PROSPERITY_SCORE_SCHEDULE_V1 = Object.freeze({
  contractVersion: PROSPERITY_SCORE_SCHEDULE_VERSION,
  island: Object.freeze({
    lead: 1,
    dossierBySize: Object.freeze({
      small: 5,
      medium: 7,
      large: 9,
    }) satisfies Readonly<Record<IslandSize, 5 | 7 | 9>>,
  }),
  surveySite: Object.freeze({ lead: 1, report: 7 }),
  fishingShoal: Object.freeze({
    lead: 1,
    surveyByQuality: Object.freeze({
      lean: 5,
      steady: 7,
      rich: 9,
    }) satisfies Readonly<Record<FishingShoalQuality, 5 | 7 | 9>>,
  }),
  navigatorWreck: Object.freeze({ confirmedReport: 4 }),
  idolLocation: Object.freeze({ returned: 12 }),
} as const);

const prosperitySourceKeyBrand: unique symbol = Symbol("ProsperitySourceKey");

export type ProsperitySourceKey = string & { readonly [prosperitySourceKeyBrand]: true };
export type ProsperitySourceKind =
  | "island"
  | "survey-site"
  | "fishing-shoal"
  | "navigator-wreck"
  | "idol-location";

export type ProsperitySourceRefV1 =
  | Readonly<{ kind: "island"; sourceId: number }>
  | Readonly<{ kind: "survey-site"; sourceId: SurveySiteId }>
  | Readonly<{ kind: "fishing-shoal"; sourceId: FishingShoalId }>
  | Readonly<{ kind: "navigator-wreck"; sourceId: number }>
  | Readonly<{ kind: "idol-location"; sourceId: IdolLocationId }>;

/** Static returned-content catalogs supplied by the composition root. */
export interface ProsperityScoreCatalogV1 {
  readonly islandDossiers: readonly Readonly<Pick<IslandDossierDefinitionV1, "islandId" | "size">>[];
  readonly surveySites: readonly Readonly<Pick<SurveySiteDefinition, "id">>[];
  readonly fishingShoals: readonly Readonly<Pick<FishingShoalDefinition, "id" | "quality">>[];
  readonly idolLocations: readonly Readonly<Pick<IdolLocationDefinition, "id">>[];
}

/**
 * Exact-return feature facts only. Tile counts, route lengths, map coverage,
 * voyage completion, provisions, and traffic are structurally absent.
 */
export interface ProsperitySettlementInputV1 {
  readonly contractVersion: typeof PROSPERITY_SCORE_CONTRACT_VERSION;
  readonly islandLeadIds: readonly number[];
  readonly islandDossierIds: readonly number[];
  readonly surveySiteLeadIds: readonly SurveySiteId[];
  readonly surveySiteReportIds: readonly SurveySiteId[];
  readonly fishingLeadIds: readonly FishingShoalId[];
  readonly fishingSurveyIds: readonly FishingShoalId[];
  readonly confirmedWreckIds: readonly number[];
  readonly idolLocationIds: readonly IdolLocationId[];
}

export type ProsperityLedgerEntryV1 = ProsperitySourceRefV1 & Readonly<{
  key: ProsperitySourceKey;
  /** Current cumulative value for this stable returned source. */
  value: number;
}>;

export interface ProsperityScoreSnapshotV1 {
  readonly contractVersion: typeof PROSPERITY_SCORE_CONTRACT_VERSION;
  readonly scheduleVersion: typeof PROSPERITY_SCORE_SCHEDULE_VERSION;
  readonly score: number;
  readonly revision: number;
  readonly ledger: readonly Readonly<ProsperityLedgerEntryV1>[];
}

export type PreparedProsperitySourceV1 = ProsperitySourceRefV1 & Readonly<{
  key: ProsperitySourceKey;
  previousValue: number;
  targetValue: number;
  delta: number;
}>;

/** Immutable, validated plan. Preparing it never mutates score authority. */
export interface PreparedProsperitySettlementV1 {
  readonly contractVersion: typeof PROSPERITY_SCORE_CONTRACT_VERSION;
  readonly scheduleVersion: typeof PROSPERITY_SCORE_SCHEDULE_VERSION;
  readonly baseRevision: number;
  readonly previousScore: number;
  readonly score: number;
  readonly delta: number;
  readonly sources: readonly Readonly<PreparedProsperitySourceV1>[];
}

export interface ProsperityCommitResultV1 {
  readonly status: "applied" | "unchanged";
  readonly previousScore: number;
  readonly score: number;
  readonly delta: number;
  readonly revision: number;
  readonly changedSources: readonly Readonly<ProsperityLedgerEntryV1>[];
  readonly snapshot: Readonly<ProsperityScoreSnapshotV1>;
}
