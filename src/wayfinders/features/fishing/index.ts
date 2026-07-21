// Public feature surface. External code should import this barrel, not private files.
export {
  FISHING_SHOAL_CLUE_KINDS,
  FISHING_SHOAL_CONTENT_VERSION,
  FISHING_SHOAL_CONTRACT_VERSION,
  FISHING_SHOAL_INTERACTION_RANGE_TILES,
  FISHING_SHOAL_MAX_ORDINAL,
  FISHING_SHOAL_QUALITIES,
  FISHING_SHOAL_SURVEY_PRESENTATION_MS,
  createFishingShoalId,
  isCurrentFishingShoalId,
  parseFishingShoalId,
} from "../../exploration/FishingShoalContracts";
export {
  AUTHORED_FISHING_LAYOUT_CONTRACT_VERSION,
  type AuthoredFishingCompileResultV1,
  type AuthoredFishingDiagnosticCode,
  type AuthoredFishingDiagnosticV1,
  type AuthoredFishingLayoutV1,
  type AuthoredFishingShoalV1,
} from "./AuthoredFishingLayoutContracts";
export {
  FISHING_SHOAL_HOME_EXCLUSION_TILES,
  FISHING_SHOAL_MINIMUM_SEPARATION_TILES,
  AuthoredFishingSeparationIndexV1,
  authoredFishingCapacityProofV1,
  authoredFishingShoalPlacementRejectionV1,
  compileAuthoredFishingLayoutV1,
  createAuthoredFishingShoalClueV1,
  createAuthoredFishingShoalV1,
  createCurrentAuthoredFishingLayoutV1,
  type AuthoredFishingCapacityProofV1,
} from "./AuthoredFishingLayout";
export type {
  FishingShoalClue,
  FishingShoalDefinition,
  FishingShoalId,
  FishingShoalInteractionCommandV1,
  FishingShoalInteractionReadModel,
  FishingShoalInteractionResultV1,
  FishingShoalProvisionalRecordV1,
  FishingShoalQuality,
  FishingShoalReadModel,
  FishingShoalReturnedRecordV1,
  FishingShoalSurveyRejectionReason,
  SurveyFishingShoalCommandV1,
} from "../../exploration/FishingShoalContracts";
export type {
  FishingCommand,
  FishingCommandContext,
  FishingCommandResult,
  FishingFeatureDependencies,
  FishingMutation,
} from "./FishingFeatureContracts";
export {
  FishingFeatureSystem,
  createFishingFeature,
  createGeneratedFishingFeature,
  type GeneratedFishingFeatureDependencies,
} from "./FishingFeatureSystem";
export { surveyFishingShoal } from "./FishingCommands";
