import {
  validateAuthoredMapContentFingerprint,
  validateAuthoredMapStableId,
} from "./AuthoredMapRepositoryContracts";

export type AuthoredMapLaunchRequestV1 =
  | Readonly<{ readonly kind: "procedural" }>
  | Readonly<{
      readonly kind: "authored-map";
      readonly mapId: string;
      readonly contentFingerprint: string;
    }>;

/**
 * Resolves the URL source selector before any live game state exists. An
 * explicit authored selection is all-or-nothing; malformed, partial, or
 * duplicated parameters never fall back to procedural generation.
 */
export function resolveAuthoredMapLaunchRequestV1(
  search: string,
): AuthoredMapLaunchRequestV1 {
  const params = new URLSearchParams(search);
  const mapIds = params.getAll("map");
  const fingerprints = params.getAll("mapFingerprint");
  if (mapIds.length === 0 && fingerprints.length === 0) {
    return Object.freeze({ kind: "procedural" });
  }
  if (mapIds.length !== 1 || fingerprints.length !== 1) {
    throw new RangeError(
      "Authored map launch requires exactly one map and one mapFingerprint parameter",
    );
  }
  return Object.freeze({
    kind: "authored-map",
    mapId: validateAuthoredMapStableId(mapIds[0], "Authored map URL map"),
    contentFingerprint: validateAuthoredMapContentFingerprint(
      fingerprints[0],
      "Authored map URL mapFingerprint",
    ),
  });
}

export function proceduralGameHref(location: Pick<Location, "pathname" | "hash">): string {
  return `${location.pathname}${location.hash}`;
}
