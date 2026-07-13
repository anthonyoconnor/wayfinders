import type { GridPoint } from "../core/types";

export const FISHING_SHOAL_CONTRACT_VERSION = 1 as const;
export const FISHING_SHOAL_CONTENT_VERSION = 1 as const;
export const FISHING_SHOAL_PERSISTENCE_OWNER = "fishing-shoals" as const;
export const FISHING_SHOAL_SURVEY_PRESENTATION_MS = 1_200 as const;
export const FISHING_SHOAL_INTERACTION_RANGE_TILES = 1.5 as const;

const FISHING_SHOAL_ID_PREFIX = `fishing-shoal:v${FISHING_SHOAL_CONTENT_VERSION}:`;
const FISHING_SHOAL_ID_PATTERN = /^fishing-shoal:v([1-9]\d*):(\d{4})$/;
const fishingShoalIdBrand: unique symbol = Symbol("FishingShoalId");

export type FishingShoalId = string & { readonly [fishingShoalIdBrand]: true };

export interface ParsedFishingShoalId {
  contentVersion: number;
  ordinal: number;
}

export function createFishingShoalId(ordinal: number): FishingShoalId {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 9_999) {
    throw new RangeError("Fishing shoal ordinal must be an integer from 0 through 9999");
  }
  return `${FISHING_SHOAL_ID_PREFIX}${ordinal.toString().padStart(4, "0")}` as FishingShoalId;
}

export function parseFishingShoalId(value: unknown): ParsedFishingShoalId | undefined {
  if (typeof value !== "string") return undefined;
  const match = FISHING_SHOAL_ID_PATTERN.exec(value);
  if (!match) return undefined;
  const contentVersion = Number(match[1]);
  const ordinal = Number(match[2]);
  if (!Number.isSafeInteger(contentVersion) || !Number.isSafeInteger(ordinal)) return undefined;
  if (value !== `fishing-shoal:v${contentVersion}:${ordinal.toString().padStart(4, "0")}`) return undefined;
  return { contentVersion, ordinal };
}

export function isCurrentFishingShoalId(value: unknown): value is FishingShoalId {
  return parseFishingShoalId(value)?.contentVersion === FISHING_SHOAL_CONTENT_VERSION;
}

export const FISHING_SHOAL_QUALITIES = ["lean", "steady", "rich"] as const;
export type FishingShoalQuality = (typeof FISHING_SHOAL_QUALITIES)[number];

export const FISHING_SHOAL_CLUE_KINDS = ["seabirds", "surface-breaks", "water-colour"] as const;
export type FishingShoalClueKind = (typeof FISHING_SHOAL_CLUE_KINDS)[number];
export type FishingShoalClueIntensity = 1 | 2 | 3;

export interface FishingShoalClue {
  kind: FishingShoalClueKind;
  intensity: FishingShoalClueIntensity;
  label: string;
}

/** Authoritative seed-derived content. It is regenerated, never serialized. */
export interface FishingShoalDefinition {
  id: FishingShoalId;
  contentVersion: typeof FISHING_SHOAL_CONTENT_VERSION;
  tile: Readonly<GridPoint>;
  serviceAnchor: Readonly<GridPoint>;
  quality: FishingShoalQuality;
  clue: Readonly<FishingShoalClue>;
}

export type FishingShoalProvisionalState = "sighted" | "surveyed";
export type FishingShoalReturnedState = "lead" | "survey";

/** Mutable authoritative state owned only by the fishing-shoal system. */
export interface FishingShoalProvisionalRecordV1 {
  id: FishingShoalId;
  state: FishingShoalProvisionalState;
  expeditionId: number;
  generation: number;
}

export interface FishingShoalSightedSaveRecordV1 extends FishingShoalProvisionalRecordV1 {
  state: "sighted";
}

/** Mutable authoritative state owned only by the fishing-shoal system. */
export interface FishingShoalReturnedRecordV1 {
  id: FishingShoalId;
  state: FishingShoalReturnedState;
  expeditionId: number;
  generation: number;
}

interface FishingShoalReadModelBase {
  contractVersion: typeof FISHING_SHOAL_CONTRACT_VERSION;
  id: FishingShoalId;
  tile: Readonly<GridPoint>;
  clue: Readonly<FishingShoalClue>;
}

/** Hidden-quality states cannot structurally expose the deterministic outcome. */
export interface FishingShoalHiddenReadModel extends FishingShoalReadModelBase {
  state: "clue" | "sighted" | "returned-lead";
  quality?: never;
  homeConnected?: never;
}

export interface FishingShoalSurveyedReadModel extends FishingShoalReadModelBase {
  state: "surveyed";
  quality: FishingShoalQuality;
  homeConnected?: never;
}

export interface FishingShoalReturnedSurveyReadModel extends FishingShoalReadModelBase {
  state: "returned-survey";
  quality: FishingShoalQuality;
  /** Derived GP-1.4 proof; never serialized. */
  homeConnected: boolean;
}

export type FishingShoalReadModel =
  | FishingShoalHiddenReadModel
  | FishingShoalSurveyedReadModel
  | FishingShoalReturnedSurveyReadModel;

export interface FishingShoalInteractionReadModel {
  contractVersion: typeof FISHING_SHOAL_CONTRACT_VERSION;
  id: FishingShoalId;
  tile: Readonly<GridPoint>;
  state: "sighted" | "returned-lead";
  clueLabel: string;
  surveyCasesRemaining: 0 | 1;
}

export interface SurveyFishingShoalCommandV1 {
  contractVersion: typeof FISHING_SHOAL_CONTRACT_VERSION;
  type: "survey";
  id: FishingShoalId;
}

export interface LeaveFishingShoalCommandV1 {
  contractVersion: typeof FISHING_SHOAL_CONTRACT_VERSION;
  type: "leave";
  id: FishingShoalId;
}

export type FishingShoalInteractionCommandV1 = SurveyFishingShoalCommandV1 | LeaveFishingShoalCommandV1;

export type FishingShoalSurveyRejectionReason =
  | "unknown-opportunity"
  | "out-of-range"
  | "not-sighted"
  | "no-survey-case"
  | "already-surveyed"
  | "wreck-hold";

export interface FishingShoalSurveyedResultV1 {
  contractVersion: typeof FISHING_SHOAL_CONTRACT_VERSION;
  status: "surveyed";
  id: FishingShoalId;
  quality: FishingShoalQuality;
  casesRemaining: 0;
  presentationMs: typeof FISHING_SHOAL_SURVEY_PRESENTATION_MS;
}

export interface FishingShoalLeftResultV1 {
  contractVersion: typeof FISHING_SHOAL_CONTRACT_VERSION;
  status: "left";
  id: FishingShoalId;
}

export interface FishingShoalRejectedResultV1 {
  contractVersion: typeof FISHING_SHOAL_CONTRACT_VERSION;
  status: "rejected";
  id?: FishingShoalId;
  reason: FishingShoalSurveyRejectionReason;
}

export type FishingShoalInteractionResultV1 =
  | FishingShoalSurveyedResultV1
  | FishingShoalLeftResultV1
  | FishingShoalRejectedResultV1;
