import type { PrototypeConfig } from "../../config/prototypeConfig";
import type { GridPoint } from "../../core/types";
import type {
  FishingShoalDefinition,
  FishingShoalId,
  FishingShoalInteractionCommandV1,
  FishingShoalInteractionResultV1,
  FishingShoalProvisionalRecordV1,
  FishingShoalReadModel,
  FishingShoalReturnedRecordV1,
} from "../../exploration/FishingShoalContracts";
import type { SurveyBudgetReadModel } from "../../exploration/SurveyContracts";
import type { WorldGrid } from "../../world/WorldGrid";

/** Dependencies supplied once by the application composition root. */
export interface FishingFeatureDependencies {
  readonly world: WorldGrid;
  readonly definitions: readonly Readonly<FishingShoalDefinition>[];
  readonly homeReturnTile: Readonly<GridPoint>;
  /** Pass a session-owned config. The legacy default remains available during migration. */
  readonly config?: Pick<PrototypeConfig, "navigation" | "movement">;
}

/** Inputs that are authoritative at the instant a player command is handled. */
export interface FishingCommandContext {
  readonly shipTile: Readonly<GridPoint>;
  readonly expeditionId: number;
  readonly generation: number;
  readonly surveyBudget: Readonly<SurveyBudgetReadModel>;
}

/** Typed invalidation produced by a fishing command. */
export interface FishingMutation {
  readonly recordsChanged: boolean;
  readonly presentationChanged: boolean;
  readonly recordsRevision: number;
  readonly changedShoalIds: readonly FishingShoalId[];
}

export interface FishingCommandResult {
  readonly outcome: Readonly<FishingShoalInteractionResultV1>;
  readonly mutation: Readonly<FishingMutation>;
}

/** Immutable, on-demand authority snapshot for tools and non-frame-loop consumers. */
export interface FishingFeatureState {
  readonly recordsRevision: number;
  readonly definitions: readonly Readonly<FishingShoalDefinition>[];
  readonly provisional: readonly Readonly<FishingShoalProvisionalRecordV1>[];
  readonly returned: readonly Readonly<FishingShoalReturnedRecordV1>[];
  readonly activationEligible: readonly Readonly<FishingShoalReturnedRecordV1>[];
}

/** Revisions whose changes can alter the renderer-safe fishing read model. */
export interface FishingPresentationRevision {
  readonly records: number;
  readonly knowledge: number;
  readonly visibility: number;
  readonly supportedTopology: number;
}

export interface FishingPresentationReadModel {
  readonly revision: Readonly<FishingPresentationRevision>;
  readonly shoals: readonly Readonly<FishingShoalReadModel>[];
}

export interface FishingPresentationSource {
  readonly presentationRevision: Readonly<FishingPresentationRevision>;
  createPresentationReadModel(): Readonly<FishingPresentationReadModel>;
}

export interface FishingPresentationPort {
  syncFishing(model: Readonly<FishingPresentationReadModel>): void;
}

/** Public command union; legacy V1 payloads remain valid during incremental migration. */
export type FishingCommand = FishingShoalInteractionCommandV1;
