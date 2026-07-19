export const CLOUD_ASSET_AUTHORING_FORMAT_VERSION = 1 as const;
export const CLOUD_ASSET_AUTHORING_ASSET_ID = "presentation.clouds.primary" as const;

const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

export interface CloudAssetIdentityRequest {
  readonly formatVersion: typeof CLOUD_ASSET_AUTHORING_FORMAT_VERSION;
  readonly assetId: typeof CLOUD_ASSET_AUTHORING_ASSET_ID;
  readonly runtimeRevision: number;
  readonly variantId: string;
}

export interface CloudAssetSaveRequest extends CloudAssetIdentityRequest {
  readonly activeInGame: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} must contain only ${sortedExpected.join(", ")}`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value as number;
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== "string" || !STABLE_ID.test(value)) {
    throw new RangeError(`${label} must be a stable lowercase ID`);
  }
  return value;
}

export function validateCloudAssetIdentityRequest(
  input: unknown,
): Readonly<CloudAssetIdentityRequest> {
  const parsed = record(input, "Cloud asset identity request");
  exactKeys(
    parsed,
    ["formatVersion", "assetId", "runtimeRevision", "variantId"],
    "Cloud asset identity request",
  );
  if (parsed.formatVersion !== CLOUD_ASSET_AUTHORING_FORMAT_VERSION) {
    throw new RangeError(
      `Cloud asset identity request formatVersion must be ${CLOUD_ASSET_AUTHORING_FORMAT_VERSION}`,
    );
  }
  if (parsed.assetId !== CLOUD_ASSET_AUTHORING_ASSET_ID) {
    throw new RangeError(`Cloud asset identity request assetId must be ${CLOUD_ASSET_AUTHORING_ASSET_ID}`);
  }
  return Object.freeze({
    formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
    assetId: CLOUD_ASSET_AUTHORING_ASSET_ID,
    runtimeRevision: positiveInteger(parsed.runtimeRevision, "runtimeRevision"),
    variantId: stableId(parsed.variantId, "variantId"),
  });
}

export function validateCloudAssetSaveRequest(
  input: unknown,
): Readonly<CloudAssetSaveRequest> {
  const parsed = record(input, "Cloud asset save request");
  exactKeys(
    parsed,
    ["formatVersion", "assetId", "runtimeRevision", "variantId", "activeInGame"],
    "Cloud asset save request",
  );
  const identity = validateCloudAssetIdentityRequest({
    formatVersion: parsed.formatVersion,
    assetId: parsed.assetId,
    runtimeRevision: parsed.runtimeRevision,
    variantId: parsed.variantId,
  });
  if (typeof parsed.activeInGame !== "boolean") {
    throw new TypeError("activeInGame must be a boolean");
  }
  return Object.freeze({
    ...identity,
    activeInGame: parsed.activeInGame,
  });
}
