import type { GridPoint } from "../core/types";
import type { NavigatorId } from "../lineage/NavigatorLineageSystem";

export const WRECK_SURVEY_CONTRACT_VERSION = 1 as const;
export const WRECK_SURVEY_INTERACTION_RANGE_TILES = 1.5 as const;
export const WRECK_SURVEY_PRESENTATION_MS = 4_000 as const;

export interface WreckSurveyInteractionReadModelV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  wreckId: number;
  tile: Readonly<GridPoint>;
  surveyCasesRemaining: 0 | 1;
}

export interface SurveyWreckCommandV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  type: "survey";
  wreckId: number;
}

export interface LeaveWreckCommandV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  type: "leave";
  wreckId: number;
}

export type WreckSurveyInteractionCommandV1 = SurveyWreckCommandV1 | LeaveWreckCommandV1;

export type WreckSurveyRejectionReasonV1 =
  | "unsupported-contract"
  | "invalid-command"
  | "interaction-busy"
  | "unknown-wreck"
  | "not-discovered"
  | "out-of-range"
  | "current-generation"
  | "already-surveyed"
  | "no-survey-case"
  | "wreck-hold"
  | "generation-handover";

export interface WreckSurveyedResultV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  status: "surveyed";
  wreckId: number;
  navigatorId: NavigatorId;
  lostGeneration: number;
  casesRemaining: 0;
  presentationMs: typeof WRECK_SURVEY_PRESENTATION_MS;
}

export interface WreckSurveyLeftResultV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  status: "left";
  wreckId: number;
}

export interface WreckSurveyRejectedResultV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  status: "rejected";
  wreckId: number;
  reason: WreckSurveyRejectionReasonV1;
}

export type WreckSurveyInteractionResultV1 =
  | WreckSurveyedResultV1
  | WreckSurveyLeftResultV1
  | WreckSurveyRejectedResultV1;

export interface WreckSurveyReportV1 {
  wreckId: number;
  navigatorId: NavigatorId;
  lostGeneration: number;
  surveyExpeditionId: number;
  surveyGeneration: number;
}
