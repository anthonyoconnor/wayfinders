import type { GridPoint } from "../core/types";
import type { IslandKind, IslandSize } from "../world/IslandGenerator";
import type { SurveyBudgetReadModel } from "./SurveyContracts";

export const ISLAND_DOSSIER_CONTRACT_VERSION = 1 as const;
export const ISLAND_DOSSIER_CONTENT_VERSION = 1 as const;
export const ISLAND_DOSSIER_PERSISTENCE_OWNER = "island-dossiers" as const;
export const ISLAND_DOSSIER_INTERACTION_RANGE_TILES = 1.5 as const;
export const ISLAND_DOSSIER_SURVEY_PRESENTATION_MS = 1_800 as const;

export const ISLAND_DOSSIER_THEMES = [
  "community",
  "resource",
  "anchorage",
  "reef-passage",
  "weather-watch",
] as const;

export type IslandDossierTheme = (typeof ISLAND_DOSSIER_THEMES)[number];

/** Hidden until the island is surveyed. */
export interface IslandDossierResultV1 {
  readonly theme: IslandDossierTheme;
  readonly findingLabel: string;
  readonly detail: string;
  /** Placeholder presentation key; production art may replace its resolver later. */
  readonly developerArtId: string;
}

/** Seed-derived authority. Definitions and their geometry are never serialized. */
export interface IslandDossierDefinitionV1 {
  readonly contentVersion: typeof ISLAND_DOSSIER_CONTENT_VERSION;
  /** The stable generated island ID is also the single-dossier identity. */
  readonly islandId: number;
  readonly name: string;
  readonly kind: IslandKind;
  readonly size: IslandSize;
  readonly center: Readonly<GridPoint>;
  /** Every world index whose exact generated island ID matches `islandId`. */
  readonly footprintIndices: readonly number[];
  /** Every passable, dock-reachable cell within the interaction range of the footprint. */
  readonly approachIndices: readonly number[];
  /** Deterministic debug/presentation convenience; never the sole valid interaction point. */
  readonly canonicalApproach: Readonly<GridPoint>;
  readonly dossier: Readonly<IslandDossierResultV1>;
}

export type IslandDossierProvisionalStateV1 = "sighted" | "surveyed";
export type IslandDossierReturnedStateV1 = "lead" | "dossier";

export interface IslandDossierProvisionalRecordV1 {
  readonly islandId: number;
  state: IslandDossierProvisionalStateV1;
  readonly expeditionId: number;
  readonly generation: number;
}

export interface IslandDossierReturnedRecordV1 {
  readonly islandId: number;
  readonly state: IslandDossierReturnedStateV1;
  readonly expeditionId: number;
  readonly generation: number;
}

interface IslandDossierReadModelBaseV1 {
  readonly contractVersion: typeof ISLAND_DOSSIER_CONTRACT_VERSION;
  readonly islandId: number;
  readonly name: string;
  readonly canonicalApproach: Readonly<GridPoint>;
}

/** A lead deliberately cannot expose any field from the hidden dossier result. */
export interface IslandDossierLeadReadModelV1 extends IslandDossierReadModelBaseV1 {
  readonly state: "sighted" | "returned-lead";
  readonly dossier?: never;
}

export interface IslandDossierSurveyedReadModelV1 extends IslandDossierReadModelBaseV1 {
  readonly state: "surveyed" | "returned-dossier";
  readonly dossier: Readonly<IslandDossierResultV1>;
}

export type IslandDossierReadModelV1 =
  | IslandDossierLeadReadModelV1
  | IslandDossierSurveyedReadModelV1;

export interface IslandDossierInteractionReadModelV1 extends SurveyBudgetReadModel {
  readonly contractVersion: typeof ISLAND_DOSSIER_CONTRACT_VERSION;
  readonly islandId: number;
  readonly name: string;
  readonly state: "sighted" | "returned-lead";
  /** The actual valid approach occupied by the ship. */
  readonly approachTile: Readonly<GridPoint>;
  readonly canonicalApproach: Readonly<GridPoint>;
}

export interface SurveyIslandDossierCommandV1 {
  readonly contractVersion: typeof ISLAND_DOSSIER_CONTRACT_VERSION;
  readonly type: "survey";
  readonly islandId: number;
}

export type IslandDossierInteractionCommandV1 = SurveyIslandDossierCommandV1;

export type IslandDossierSurveyRejectionReasonV1 =
  | "unsupported-contract"
  | "invalid-command"
  | "unknown-island"
  | "out-of-range"
  | "not-sighted"
  | "insufficient-provisions"
  | "already-surveyed"
  | "wreck-hold"
  | "interaction-busy"
  | "generation-handover";

export interface IslandDossierSurveyedResultV1 {
  readonly contractVersion: typeof ISLAND_DOSSIER_CONTRACT_VERSION;
  readonly status: "surveyed";
  readonly islandId: number;
  readonly name: string;
  readonly dossier: Readonly<IslandDossierResultV1>;
  readonly provisionsSpent: number;
  readonly availableProvisionUnitsRemaining: number;
  readonly presentationMs: typeof ISLAND_DOSSIER_SURVEY_PRESENTATION_MS;
}

export interface IslandDossierRejectedResultV1 {
  readonly contractVersion: typeof ISLAND_DOSSIER_CONTRACT_VERSION;
  readonly status: "rejected";
  readonly islandId?: number;
  readonly reason: IslandDossierSurveyRejectionReasonV1;
}

export type IslandDossierInteractionResultV1 =
  | IslandDossierSurveyedResultV1
  | IslandDossierRejectedResultV1;

export interface IslandDossierObservationV1 {
  readonly found: readonly Readonly<IslandDossierProvisionalRecordV1>[];
}

export interface IslandDossierCommitResultV1 {
  readonly leads: readonly Readonly<IslandDossierReturnedRecordV1>[];
  readonly dossiers: readonly Readonly<IslandDossierReturnedRecordV1>[];
}

export function isIslandDossierProvisionalStateV1(
  value: unknown,
): value is IslandDossierProvisionalStateV1 {
  return value === "sighted" || value === "surveyed";
}

export function isIslandDossierReturnedStateV1(
  value: unknown,
): value is IslandDossierReturnedStateV1 {
  return value === "lead" || value === "dossier";
}
