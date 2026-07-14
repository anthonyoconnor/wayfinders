import type { GridPoint } from "../core/types";
import type { NavigatorId } from "../lineage/NavigatorLineageSystem";
import type { SurveyBudgetReadModel } from "./SurveyContracts";

export const WRECK_SURVEY_CONTRACT_VERSION = 2 as const;
export const WRECK_SURVEY_INTERACTION_RANGE_TILES = 1.5 as const;
export const WRECK_SURVEY_PRESENTATION_MS = 4_000 as const;

export interface WreckSurveyInteractionReadModelV1 extends SurveyBudgetReadModel {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  wreckId: number;
  tile: Readonly<GridPoint>;
}

export interface SurveyWreckCommandV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  type: "survey";
  wreckId: number;
}

export type WreckSurveyInteractionCommandV1 = SurveyWreckCommandV1;

export type WreckSurveyRejectionReasonV1 =
  | "unsupported-contract"
  | "invalid-command"
  | "interaction-busy"
  | "unknown-wreck"
  | "not-discovered"
  | "out-of-range"
  | "current-generation"
  | "already-surveyed"
  | "insufficient-provisions"
  | "wreck-hold"
  | "generation-handover";

export interface WreckSurveyedResultV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  status: "surveyed";
  wreckId: number;
  navigatorId: NavigatorId;
  lostGeneration: number;
  provisionsSpent: number;
  availableProvisionUnitsRemaining: number;
  presentationMs: typeof WRECK_SURVEY_PRESENTATION_MS;
}

export interface WreckSurveyRejectedResultV1 {
  contractVersion: typeof WRECK_SURVEY_CONTRACT_VERSION;
  status: "rejected";
  wreckId: number;
  reason: WreckSurveyRejectionReasonV1;
}

export type WreckSurveyInteractionResultV1 =
  | WreckSurveyedResultV1
  | WreckSurveyRejectedResultV1;

export interface WreckSurveyReportV1 {
  wreckId: number;
  navigatorId: NavigatorId;
  lostGeneration: number;
  surveyExpeditionId: number;
  surveyGeneration: number;
}
