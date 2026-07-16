// Public feature surface. External code should import this barrel, not private files.
export {
  FISHING_SHOAL_CLUE_KINDS,
  FISHING_SHOAL_CONTENT_VERSION,
  FISHING_SHOAL_CONTRACT_VERSION,
  FISHING_SHOAL_INTERACTION_RANGE_TILES,
  FISHING_SHOAL_QUALITIES,
  FISHING_SHOAL_SURVEY_PRESENTATION_MS,
  createFishingShoalId,
  isCurrentFishingShoalId,
  parseFishingShoalId,
} from "../../exploration/FishingShoalContracts";
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
