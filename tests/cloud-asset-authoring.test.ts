import { describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_AUTHORING_ASSET_ID,
  CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
  validateCloudAssetIdentityRequest,
  validateCloudAssetSaveRequest,
} from "../src/wayfinders/assets/CloudAssetAuthoring.ts";

function identityRequest() {
  return {
    formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
    assetId: CLOUD_ASSET_AUTHORING_ASSET_ID,
    runtimeRevision: 6,
    variantId: "long-broken-wisp",
  };
}

describe("cloud asset authoring requests", () => {
  it("normalizes immutable identity and activation requests", () => {
    const identity = validateCloudAssetIdentityRequest(identityRequest());
    expect(identity).toEqual(identityRequest());
    expect(Object.isFrozen(identity)).toBe(true);

    const save = validateCloudAssetSaveRequest({
      ...identityRequest(),
      activeInGame: false,
    });
    expect(save).toEqual({ ...identityRequest(), activeInGame: false });
    expect(Object.isFrozen(save)).toBe(true);
  });

  it("requires exact request fields and the one cloud package identity", () => {
    expect(() => validateCloudAssetIdentityRequest({
      ...identityRequest(),
      outputPath: "C:/outside.json",
    })).toThrow(/must contain only/);
    expect(() => validateCloudAssetIdentityRequest({
      ...identityRequest(),
      assetId: "presentation.clouds.other",
    })).toThrow(/assetId must be presentation\.clouds\.primary/);
    expect(() => validateCloudAssetSaveRequest(identityRequest())).toThrow(/must contain only/);
  });

  it("accepts only positive revisions, stable lowercase IDs, and a boolean active state", () => {
    expect(() => validateCloudAssetIdentityRequest({
      ...identityRequest(),
      runtimeRevision: 0,
    })).toThrow(/positive integer/);
    expect(() => validateCloudAssetIdentityRequest({
      ...identityRequest(),
      variantId: "Long Wisp",
    })).toThrow(/stable lowercase ID/);
    expect(() => validateCloudAssetSaveRequest({
      ...identityRequest(),
      activeInGame: "true",
    })).toThrow(/must be a boolean/);
  });
});
