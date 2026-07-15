import {
  FISHING_SHOAL_CONTRACT_VERSION,
  type FishingShoalId,
  type SurveyFishingShoalCommandV1,
} from "../../exploration/FishingShoalContracts";

/** The single construction point for the current player-facing fishing command. */
export function surveyFishingShoal(id: FishingShoalId): Readonly<SurveyFishingShoalCommandV1> {
  return Object.freeze({
    contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
    type: "survey",
    id,
  });
}
