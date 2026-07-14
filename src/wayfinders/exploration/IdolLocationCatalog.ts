import type { IslandDossierDefinitionV1 } from "./IslandDossierContracts";
import {
  IDOL_LOCATION_CONTENT_VERSION,
  compareIdolLocationHostRefs,
  compareIdolLocationIds,
  createIdolLocationHostKey,
  createIdolLocationId,
  type IdolLocationDefinition,
  type IdolLocationHostRef,
} from "./IdolLocationContracts";
import type {
  SurveySiteDefinition,
} from "./SurveySiteContracts";
import { seededValue } from "../world/SeededRandom";

const IDOL_LOCATION_RANK_NAMESPACE = 1_401_091;

type IslandDossierHostSource = Readonly<Pick<IslandDossierDefinitionV1, "islandId">>;
type SurveySiteHostSource = Readonly<Pick<SurveySiteDefinition<string>, "id">>;

interface RankedIdolLocationHost {
  readonly host: Readonly<IdolLocationHostRef>;
  readonly rank: number;
}

/**
 * Selects exactly `idolCount` unique survey hosts without owning discovery state.
 * Candidate canonicalization makes the result independent of both input arrays'
 * enumeration order. Content changes must increment the idol content version.
 */
export function generateIdolLocationCatalog(
  worldSeed: number,
  idolCount: number,
  islandDossiers: readonly IslandDossierHostSource[],
  surveySites: readonly SurveySiteHostSource[],
  contentVersion: number = IDOL_LOCATION_CONTENT_VERSION,
): readonly Readonly<IdolLocationDefinition>[] {
  if (contentVersion !== IDOL_LOCATION_CONTENT_VERSION) {
    throw new RangeError(`Unsupported idol-location content version ${contentVersion}`);
  }
  if (!Number.isSafeInteger(worldSeed)) {
    throw new RangeError("Idol-location world seed must be a safe integer");
  }
  if (!Number.isInteger(idolCount) || idolCount <= 0) {
    throw new RangeError("Idol-location count must be a positive integer");
  }
  if (idolCount > 9_999) {
    throw new RangeError("Idol-location count cannot exceed 9999 versioned IDs");
  }

  const canonicalHosts = canonicalEligibleHosts(islandDossiers, surveySites);
  if (idolCount > canonicalHosts.length) {
    throw new RangeError(
      `Configured idol-location count ${idolCount} exceeds ${canonicalHosts.length} eligible survey hosts`,
    );
  }

  const ranked: RankedIdolLocationHost[] = canonicalHosts.map((host, index) => ({
    host,
    rank: seededValue(
      worldSeed,
      index + 1,
      IDOL_LOCATION_RANK_NAMESPACE + IDOL_LOCATION_CONTENT_VERSION,
    ),
  }));
  ranked.sort((left, right) => (
    left.rank - right.rank || compareIdolLocationHostRefs(left.host, right.host)
  ));

  const definitions = ranked.slice(0, idolCount).map(({ host }, index) => {
    const ordinal = index + 1;
    return Object.freeze({
      id: createIdolLocationId(ordinal),
      contentVersion: IDOL_LOCATION_CONTENT_VERSION,
      ordinal,
      displayLabel: `Lost Idol ${ordinal}`,
      host,
    }) satisfies Readonly<IdolLocationDefinition>;
  });
  definitions.sort((left, right) => compareIdolLocationIds(left.id, right.id));
  return Object.freeze(definitions);
}

function canonicalEligibleHosts(
  islandDossiers: readonly IslandDossierHostSource[],
  surveySites: readonly SurveySiteHostSource[],
): readonly Readonly<IdolLocationHostRef>[] {
  const byKey = new Map<string, Readonly<IdolLocationHostRef>>();
  const register = (host: Readonly<IdolLocationHostRef>): void => {
    const key = createIdolLocationHostKey(host);
    if (byKey.has(key)) throw new RangeError(`Duplicate eligible idol-location host ${key}`);
    byKey.set(key, host);
  };

  for (const { islandId } of islandDossiers) {
    register(Object.freeze({ kind: "island-dossier", islandId }));
  }
  for (const { id: surveySiteId } of surveySites) {
    register(Object.freeze({ kind: "survey-site", surveySiteId }));
  }

  return Object.freeze([...byKey.values()].sort(compareIdolLocationHostRefs));
}
