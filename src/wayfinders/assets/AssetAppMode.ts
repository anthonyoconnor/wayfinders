export type WayfindersApplicationMode = "game" | "assets" | "asset-trial";

export interface AssetTrialApplicationRequest {
  readonly candidateId: string;
  readonly candidateFingerprint: string;
}

const STABLE_CANDIDATE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const CANDIDATE_FINGERPRINT = /^[a-f0-9]{64}$/u;

function validateAssetTrialApplicationRequest(
  request: Readonly<AssetTrialApplicationRequest>,
): Readonly<AssetTrialApplicationRequest> {
  if (!STABLE_CANDIDATE_ID.test(request.candidateId)) {
    throw new RangeError("Asset trial requires a stable candidate ID");
  }
  if (!CANDIDATE_FINGERPRINT.test(request.candidateFingerprint)) {
    throw new RangeError("Asset trial requires the current candidate fingerprint");
  }
  return Object.freeze({ ...request });
}

export function resolveWayfindersApplicationMode(search: string): WayfindersApplicationMode {
  const mode = new URLSearchParams(search).get("mode");
  if (mode === "assets" || mode === "asset-trial") return mode;
  return "game";
}

export function applicationModeHref(mode: WayfindersApplicationMode): string {
  return mode === "game" ? "?mode=assets" : mode === "assets" ? "./" : "?mode=assets";
}

export function assetTrialApplicationHref(
  request: Readonly<AssetTrialApplicationRequest>,
): string {
  const validated = validateAssetTrialApplicationRequest(request);
  const parameters = new URLSearchParams({
    mode: "asset-trial",
    candidate: validated.candidateId,
    fingerprint: validated.candidateFingerprint,
  });
  return `?${parameters.toString()}`;
}

export function resolveAssetTrialApplicationRequest(
  search: string,
): Readonly<AssetTrialApplicationRequest> | undefined {
  const parameters = new URLSearchParams(search);
  if (parameters.get("mode") !== "asset-trial") return undefined;
  const candidateId = parameters.get("candidate") ?? "";
  const candidateFingerprint = parameters.get("fingerprint") ?? "";
  return validateAssetTrialApplicationRequest({ candidateId, candidateFingerprint });
}
