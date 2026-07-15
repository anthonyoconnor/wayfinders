import type {
  FishingShoalDefinition,
  FishingShoalProvisionalRecordV1,
  FishingShoalReturnedRecordV1,
} from "../../exploration/FishingShoalContracts";
import type { FishingFeatureState } from "./FishingFeatureContracts";

export interface FishingStateSource {
  readonly definitions: readonly Readonly<FishingShoalDefinition>[];
  readonly provisional: readonly Readonly<FishingShoalProvisionalRecordV1>[];
  readonly returned: readonly Readonly<FishingShoalReturnedRecordV1>[];
  readonly activationEligible: readonly Readonly<FishingShoalReturnedRecordV1>[];
  readonly recordsRevision: number;
}

function freezeDefinition(definition: Readonly<FishingShoalDefinition>): Readonly<FishingShoalDefinition> {
  const tile = Object.freeze({ ...definition.tile });
  const serviceAnchor = definition.serviceAnchor.x === definition.tile.x
    && definition.serviceAnchor.y === definition.tile.y
    ? tile
    : Object.freeze({ ...definition.serviceAnchor });
  return Object.freeze({
    ...definition,
    tile,
    serviceAnchor,
    clue: Object.freeze({ ...definition.clue }),
  });
}
function freezeRecord<T extends FishingShoalProvisionalRecordV1 | FishingShoalReturnedRecordV1>(
  record: Readonly<T>,
): Readonly<T> {
  return Object.freeze({ ...record });
}

function freezeRecords<T extends FishingShoalProvisionalRecordV1 | FishingShoalReturnedRecordV1>(
  records: readonly Readonly<T>[],
): readonly Readonly<T>[] {
  return Object.freeze(records.map(freezeRecord));
}

/** Copies authority into a runtime-immutable snapshot so consumers cannot mutate the system. */
export function createFishingFeatureState(source: FishingStateSource): Readonly<FishingFeatureState> {
  return Object.freeze({
    recordsRevision: source.recordsRevision,
    definitions: Object.freeze(source.definitions.map(freezeDefinition)),
    provisional: freezeRecords(source.provisional),
    returned: freezeRecords(source.returned),
    activationEligible: freezeRecords(source.activationEligible),
  });
}
