import type { FishingShoalReadModel } from "../../exploration/FishingShoalContracts";
import type {
  FishingPresentationPort,
  FishingPresentationReadModel,
  FishingPresentationRevision,
  FishingPresentationSource,
} from "./FishingFeatureContracts";

function freezePresentationItem(model: Readonly<FishingShoalReadModel>): Readonly<FishingShoalReadModel> {
  const base = {
    ...model,
    tile: Object.freeze({ ...model.tile }),
    clue: Object.freeze({ ...model.clue }),
  };
  return Object.freeze(base) as Readonly<FishingShoalReadModel>;
}

export function freezeFishingPresentationRevision(
  revision: Readonly<FishingPresentationRevision>,
): Readonly<FishingPresentationRevision> {
  return Object.freeze({ ...revision });
}

export function sameFishingPresentationRevision(
  left: Readonly<FishingPresentationRevision> | undefined,
  right: Readonly<FishingPresentationRevision>,
): boolean {
  return left !== undefined
    && left.records === right.records
    && left.knowledge === right.knowledge
    && left.visibility === right.visibility
    && left.supportedTopology === right.supportedTopology;
}

export function createFishingPresentationReadModel(
  revision: Readonly<FishingPresentationRevision>,
  shoals: readonly Readonly<FishingShoalReadModel>[],
): Readonly<FishingPresentationReadModel> {
  return Object.freeze({
    revision: freezeFishingPresentationRevision(revision),
    shoals: Object.freeze(shoals.map(freezePresentationItem)),
  });
}

/**
 * Keeps Phaser (or any future UI) behind a tiny port and avoids rebuilding the
 * read model when none of its authority revisions changed.
 */
export class FishingPresentationAdapter {
  private appliedRevision?: Readonly<FishingPresentationRevision>;

  sync(source: FishingPresentationSource, port: FishingPresentationPort): boolean {
    const currentRevision = source.presentationRevision;
    if (sameFishingPresentationRevision(this.appliedRevision, currentRevision)) return false;
    const model = source.createPresentationReadModel();
    port.syncFishing(model);
    this.appliedRevision = model.revision;
    return true;
  }

  invalidate(): void {
    this.appliedRevision = undefined;
  }
}
