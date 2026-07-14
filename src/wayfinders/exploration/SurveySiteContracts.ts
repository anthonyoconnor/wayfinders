import type { GridPoint } from "../core/types";
import type { IslandKind } from "../world/IslandGenerator";
import type { TerrainType } from "../world/TileData";
import type { SurveyBudgetReadModel } from "./SurveyContracts";

export const SURVEY_SITE_CONTRACT_VERSION = 1 as const;
export const SURVEY_SITE_CONTENT_VERSION = 1 as const;
export const SURVEY_SITE_PERSISTENCE_OWNER = "survey-sites" as const;
export const SURVEY_SITE_INTERACTION_RANGE_TILES = 1.5 as const;
export const SURVEY_SITE_PRESENTATION_MS = 1_600 as const;

export const SURVEY_SITE_TYPES = [
  "historic-wreck",
  "coastal-ruin",
  "tidal-cave",
] as const;

export type SurveySiteType = (typeof SURVEY_SITE_TYPES)[number];

const SURVEY_SITE_ID_PATTERN = /^survey-site:v([1-9]\d*):([a-z][a-z0-9]*(?:-[a-z0-9]+)*):(\d{4})$/;
const surveySiteIdBrand: unique symbol = Symbol("SurveySiteId");

export type SurveySiteId = string & { readonly [surveySiteIdBrand]: true };

export interface ParsedSurveySiteId {
  readonly contentVersion: number;
  readonly type: string;
  readonly ordinal: number;
}

function isTypeId(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

export function createSurveySiteId(type: string, ordinal: number): SurveySiteId {
  if (!isTypeId(type)) {
    throw new RangeError("Survey-site type must be a lowercase hyphenated identifier");
  }
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 9_999) {
    throw new RangeError("Survey-site ordinal must be an integer from 0 through 9999");
  }
  return `survey-site:v${SURVEY_SITE_CONTENT_VERSION}:${type}:${ordinal.toString().padStart(4, "0")}` as SurveySiteId;
}

export function parseSurveySiteId(value: unknown): ParsedSurveySiteId | undefined {
  if (typeof value !== "string") return undefined;
  const match = SURVEY_SITE_ID_PATTERN.exec(value);
  if (!match) return undefined;
  const contentVersion = Number(match[1]);
  const ordinal = Number(match[3]);
  if (!Number.isSafeInteger(contentVersion) || !Number.isSafeInteger(ordinal)) return undefined;
  if (value !== `survey-site:v${contentVersion}:${match[2]}:${ordinal.toString().padStart(4, "0")}`) {
    return undefined;
  }
  return { contentVersion, type: match[2], ordinal };
}

export function isCurrentSurveySiteId(value: unknown): value is SurveySiteId {
  return parseSurveySiteId(value)?.contentVersion === SURVEY_SITE_CONTENT_VERSION;
}

/** Canonical save/lineage order: JavaScript binary UTF-16 code-unit order. */
export function compareSurveySiteIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface SurveySiteClue {
  readonly id: string;
  readonly label: string;
}

export interface SurveySiteResult {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface SurveySitePresentation {
  /** Future semantic asset identity; GP-3.3 initially renders developer art. */
  readonly id: string;
  readonly badge: string;
  readonly color: number;
}

export interface SurveySitePlacementRule {
  readonly terrain: readonly TerrainType[];
  readonly islandKinds: readonly IslandKind[];
}

/**
 * All content variation lives here. The catalog and lifecycle are generic in
 * the type string, so adding a later non-idol type does not add a command,
 * reducer, or persistence fragment.
 */
export interface SurveySiteTypeDescriptor<TType extends string = string> {
  readonly type: TType;
  readonly label: string;
  readonly namespace: number;
  readonly count: number;
  readonly placement: Readonly<SurveySitePlacementRule>;
  readonly clues: readonly Readonly<SurveySiteClue>[];
  readonly results: readonly Readonly<SurveySiteResult>[];
  readonly presentation: Readonly<SurveySitePresentation>;
}

/** Seed-derived content. Definitions are regenerated and never serialized. */
export interface SurveySiteDefinition<TType extends string = SurveySiteType> {
  readonly id: SurveySiteId;
  readonly contentVersion: typeof SURVEY_SITE_CONTENT_VERSION;
  readonly type: TType;
  readonly typeLabel: string;
  readonly islandId: number;
  /** Visual/clue location. It may be blocked land or rock. */
  readonly tile: Readonly<GridPoint>;
  /** Passable, dock-reachable point used for interaction and developer travel. */
  readonly serviceAnchor: Readonly<GridPoint>;
  readonly clue: Readonly<SurveySiteClue>;
  readonly result: Readonly<SurveySiteResult>;
  readonly presentation: Readonly<SurveySitePresentation>;
}

export type SurveySiteProvisionalState = "sighted" | "surveyed";
export type SurveySiteReturnedState = "lead" | "report";

export interface SurveySiteProvisionalRecord {
  readonly id: SurveySiteId;
  readonly state: SurveySiteProvisionalState;
  readonly expeditionId: number;
  readonly generation: number;
}

export interface SurveySiteReturnedRecord {
  readonly id: SurveySiteId;
  readonly state: SurveySiteReturnedState;
  readonly expeditionId: number;
  readonly generation: number;
}

interface SurveySiteReadModelBase<TType extends string = SurveySiteType> {
  readonly contractVersion: typeof SURVEY_SITE_CONTRACT_VERSION;
  readonly id: SurveySiteId;
  readonly type: TType;
  readonly typeLabel: string;
  readonly tile: Readonly<GridPoint>;
  readonly serviceAnchor: Readonly<GridPoint>;
  readonly clue: Readonly<SurveySiteClue>;
  readonly presentation: Readonly<SurveySitePresentation>;
}

/** Hidden states cannot structurally expose the deterministic result. */
export interface SurveySiteHiddenReadModel<TType extends string = SurveySiteType>
  extends SurveySiteReadModelBase<TType> {
  readonly state: "clue" | "sighted" | "returned-lead";
  readonly result?: never;
}

export interface SurveySiteSurveyedReadModel<TType extends string = SurveySiteType>
  extends SurveySiteReadModelBase<TType> {
  readonly state: "surveyed" | "returned-report";
  readonly result: Readonly<SurveySiteResult>;
}

export type SurveySiteReadModel<TType extends string = SurveySiteType> =
  | SurveySiteHiddenReadModel<TType>
  | SurveySiteSurveyedReadModel<TType>;

export interface SurveySiteInteractionReadModel<TType extends string = SurveySiteType>
  extends SurveyBudgetReadModel {
  readonly contractVersion: typeof SURVEY_SITE_CONTRACT_VERSION;
  readonly id: SurveySiteId;
  readonly type: TType;
  readonly typeLabel: string;
  readonly tile: Readonly<GridPoint>;
  readonly serviceAnchor: Readonly<GridPoint>;
  readonly state: "sighted" | "returned-lead";
  readonly clueLabel: string;
  readonly distanceTiles: number;
}

export interface SurveySiteInteractionCommand {
  readonly contractVersion: typeof SURVEY_SITE_CONTRACT_VERSION;
  readonly type: "survey";
  readonly id: SurveySiteId;
}

export type SurveySiteRejectionReason =
  | "unsupported-contract"
  | "invalid-command"
  | "unknown-site"
  | "out-of-range"
  | "not-sighted"
  | "insufficient-provisions"
  | "already-surveyed"
  | "wreck-hold"
  | "interaction-busy"
  | "generation-handover";

export interface SurveySiteSurveyedResult<TType extends string = SurveySiteType> {
  readonly contractVersion: typeof SURVEY_SITE_CONTRACT_VERSION;
  readonly status: "surveyed";
  readonly id: SurveySiteId;
  readonly type: TType;
  readonly result: Readonly<SurveySiteResult>;
  readonly provisionsSpent: number;
  readonly availableProvisionUnitsRemaining: number;
  readonly presentationMs: typeof SURVEY_SITE_PRESENTATION_MS;
}

export interface SurveySiteRejectedResult {
  readonly contractVersion: typeof SURVEY_SITE_CONTRACT_VERSION;
  readonly status: "rejected";
  readonly id?: SurveySiteId;
  readonly reason: SurveySiteRejectionReason;
}

export type SurveySiteInteractionResult<TType extends string = SurveySiteType> =
  | SurveySiteSurveyedResult<TType>
  | SurveySiteRejectedResult;
