import type { PrototypeConfig } from "../../config/prototypeConfig";
import type { GridPoint } from "../../core/types";
import type {
  FishingShoalDefinition,
  FishingShoalId,
  FishingShoalInteractionCommandV1,
  FishingShoalInteractionResultV1,
} from "../../exploration/FishingShoalContracts";
import type { SurveyBudgetReadModel } from "../../exploration/SurveyContracts";
import type { WorldGrid } from "../../world/WorldGrid";

/** Dependencies supplied once by the application composition root. */
export interface FishingFeatureDependencies {
  readonly world: WorldGrid;
  readonly definitions: readonly Readonly<FishingShoalDefinition>[];
  readonly homeReturnTile: Readonly<GridPoint>;
  readonly config: Pick<PrototypeConfig, "navigation" | "movement">;
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

/** Current public command union. */
export type FishingCommand = FishingShoalInteractionCommandV1;
