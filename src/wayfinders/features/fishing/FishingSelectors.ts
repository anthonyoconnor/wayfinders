import type {
  FishingShoalDefinition,
  FishingShoalId,
  FishingShoalReadModel,
  FishingShoalReturnedRecordV1,
} from "../../exploration/FishingShoalContracts";
import type { FishingFeatureState, FishingPresentationReadModel } from "./FishingFeatureContracts";

export function selectFishingDefinition(
  state: Readonly<FishingFeatureState>,
  id: FishingShoalId,
): Readonly<FishingShoalDefinition> | undefined {
  return state.definitions.find((definition) => definition.id === id);
}

export function selectFishingPresentation(
  model: Readonly<FishingPresentationReadModel>,
  id: FishingShoalId,
): Readonly<FishingShoalReadModel> | undefined {
  return model.shoals.find((shoal) => shoal.id === id);
}

export function selectReturnedFishingSurveys(
  state: Readonly<FishingFeatureState>,
): readonly Readonly<FishingShoalReturnedRecordV1>[] {
  return Object.freeze(state.returned.filter((record) => record.state === "survey"));
}
