import { prototypeConfig, type PrototypeConfig } from "../../config/prototypeConfig";
import type { GridPoint } from "../../core/types";
import { generateFishingShoalCatalog } from "../../exploration/FishingShoalCatalog";
import type {
  FishingShoalDefinition,
  FishingShoalId,
  FishingShoalInteractionCommandV1,
  FishingShoalInteractionReadModel,
  FishingShoalInteractionResultV1,
  FishingShoalProvisionalRecordV1,
  FishingShoalReadModel,
  FishingShoalReturnedRecordV1,
} from "../../exploration/FishingShoalContracts";
import {
  FishingShoalSystem,
  type FishingShoalCommitResult,
  type FishingShoalObservation,
} from "../../exploration/FishingShoalSystem";
import type { SurveyBudgetReadModel } from "../../exploration/SurveyContracts";
import type { WorldGrid } from "../../world/WorldGrid";
import type { WorldAnalysisIndex } from "../../world/analysis";
import type {
  FishingCommand,
  FishingCommandContext,
  FishingCommandResult,
  FishingFeatureDependencies,
  FishingFeatureState,
  FishingMutation,
  FishingPresentationReadModel,
  FishingPresentationRevision,
  FishingPresentationSource,
} from "./FishingFeatureContracts";
import { createFishingFeatureState } from "./FishingFeatureState";
import { createFishingPresentationReadModel } from "./FishingPresentationAdapter";

/**
 * Feature-owned facade. It delegates gameplay authority to FishingShoalSystem
 * while giving new callers command, state and presentation boundaries.
 */
export class FishingFeatureSystem implements FishingPresentationSource {
  private readonly system: FishingShoalSystem;

  constructor(
    private readonly world: WorldGrid,
    readonly definitions: readonly Readonly<FishingShoalDefinition>[],
    homeReturnTile: Readonly<GridPoint>,
    config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
  ) {
    this.system = new FishingShoalSystem(world, definitions, homeReturnTile, config);
  }

  get provisional(): readonly Readonly<FishingShoalProvisionalRecordV1>[] {
    return this.system.provisional;
  }

  get returned(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    return this.system.returned;
  }

  get activationEligible(): readonly Readonly<FishingShoalReturnedRecordV1>[] {
    return this.system.activationEligible;
  }

  get connectivityBuildCount(): number {
    return this.system.connectivityBuildCount;
  }

  get recordsRevision(): number {
    return this.system.recordsRevision;
  }

  get presentationRevision(): Readonly<FishingPresentationRevision> {
    return Object.freeze({
      records: this.system.recordsRevision,
      knowledge: this.world.knowledgeVersion,
      visibility: this.world.visibilityVersion,
      supportedTopology: this.world.supportedTopologyVersion,
    });
  }

  definitionFor(id: string): Readonly<FishingShoalDefinition> | undefined {
    return this.system.definitionFor(id);
  }

  interactionNear(
    tile: Readonly<GridPoint>,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
    candidateIds?: Iterable<string>,
  ): FishingShoalInteractionReadModel | undefined {
    return this.system.interactionNear(tile, surveyBudget, candidateIds);
  }

  /** New command boundary with typed mutation effects. */
  execute(command: Readonly<FishingCommand>, context: Readonly<FishingCommandContext>): FishingCommandResult {
    const beforeRevision = this.system.recordsRevision;
    const outcome = this.system.applyInteraction(
      command,
      context.shipTile,
      context.expeditionId,
      context.generation,
      context.surveyBudget,
    );
    const recordsChanged = this.system.recordsRevision !== beforeRevision;
    const changedShoalIds = recordsChanged && outcome.status === "surveyed"
      ? Object.freeze([outcome.id])
      : Object.freeze([] as FishingShoalId[]);
    const mutation: Readonly<FishingMutation> = Object.freeze({
      recordsChanged,
      presentationChanged: recordsChanged,
      recordsRevision: this.system.recordsRevision,
      changedShoalIds,
    });
    return Object.freeze({ outcome: Object.freeze({ ...outcome }), mutation });
  }

  stateSnapshot(): Readonly<FishingFeatureState> {
    return createFishingFeatureState(this);
  }

  createPresentationReadModel(): Readonly<FishingPresentationReadModel> {
    return createFishingPresentationReadModel(this.presentationRevision, this.system.readModels());
  }

  // Compatibility delegates keep GameSimulation migration mechanical and recoverable.
  applyInteraction(
    command: Readonly<FishingShoalInteractionCommandV1>,
    shipTile: Readonly<GridPoint>,
    expeditionId: number,
    generation: number,
    surveyBudget: Readonly<SurveyBudgetReadModel>,
  ): FishingShoalInteractionResultV1 {
    return this.system.applyInteraction(command, shipTile, expeditionId, generation, surveyBudget);
  }

  observeCurrentSight(
    expeditionId: number,
    generation: number,
    visibleIndices: Iterable<number> = this.world.getVisibleIndices(),
    candidateIds?: Iterable<string>,
  ): FishingShoalObservation {
    return this.system.observeCurrentSight(
      expeditionId,
      generation,
      visibleIndices,
      candidateIds,
    );
  }

  commitExpedition(expeditionId: number): FishingShoalCommitResult {
    return this.system.commitExpedition(expeditionId);
  }

  revertExpedition(expeditionId: number): readonly Readonly<FishingShoalProvisionalRecordV1>[] {
    return this.system.revertExpedition(expeditionId);
  }

  readModels(candidateIds?: Iterable<string>): readonly Readonly<FishingShoalReadModel>[] {
    return this.system.readModels(candidateIds);
  }
}

export function createFishingFeature(dependencies: FishingFeatureDependencies): FishingFeatureSystem {
  return new FishingFeatureSystem(
    dependencies.world,
    dependencies.definitions,
    dependencies.homeReturnTile,
    dependencies.config ?? prototypeConfig,
  );
}

export interface GeneratedFishingFeatureDependencies {
  readonly world: WorldGrid;
  readonly seed: number;
  readonly homeReturnTile: Readonly<GridPoint>;
  readonly config?: Pick<PrototypeConfig, "navigation" | "movement">;
  readonly analysis?: WorldAnalysisIndex;
}

/** Composition helper for production sessions; tests can inject tiny definitions directly. */
export function createGeneratedFishingFeature(
  dependencies: GeneratedFishingFeatureDependencies,
): FishingFeatureSystem {
  const config = dependencies.config ?? prototypeConfig;
  const definitions = generateFishingShoalCatalog(
    dependencies.world,
    dependencies.seed,
    dependencies.homeReturnTile,
    undefined,
    config,
    dependencies.analysis,
  );
  return new FishingFeatureSystem(
    dependencies.world,
    definitions,
    dependencies.homeReturnTile,
    config,
  );
}
