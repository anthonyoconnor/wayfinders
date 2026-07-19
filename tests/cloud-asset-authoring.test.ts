import { describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_AUTHORING_ASSET_ID,
  CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
  CLOUD_ASSET_AUTHORING_SETTINGS_BOUNDS,
  applyCloudAssetAuthoringSettings,
  cloudAssetAuthoringSettingsFromPackage,
  validateCloudAssetAuthoringSettings,
  validateCloudAssetIdentityRequest,
  validateCloudAssetSaveRequest,
} from "../src/wayfinders/assets/CloudAssetAuthoring.ts";
import { CLOUD_ASSET_PACKAGE } from "../src/wayfinders/assets/CloudAssetCatalog.ts";

function identityRequest() {
  return {
    formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
    assetId: CLOUD_ASSET_AUTHORING_ASSET_ID,
    runtimeRevision: 6,
    variantId: "long-broken-wisp",
  };
}

function settingsSnapshot() {
  return JSON.parse(JSON.stringify(cloudAssetAuthoringSettingsFromPackage(CLOUD_ASSET_PACKAGE)));
}

function saveRequest() {
  return {
    ...identityRequest(),
    activeInGame: false,
    settings: settingsSnapshot(),
  };
}

describe("cloud asset authoring requests", () => {
  it("normalizes immutable identity, complete settings, and save requests", () => {
    const identity = validateCloudAssetIdentityRequest(identityRequest());
    expect(identity).toEqual(identityRequest());
    expect(Object.isFrozen(identity)).toBe(true);

    const settings = validateCloudAssetAuthoringSettings(settingsSnapshot());
    expect(settings).toEqual(settingsSnapshot());
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.opacity)).toBe(true);
    expect(Object.isFrozen(settings.shadow)).toBe(true);
    expect(Object.isFrozen(settings.shadow.offsetPixels)).toBe(true);

    const save = validateCloudAssetSaveRequest(saveRequest());
    expect(save).toEqual(saveRequest());
    expect(Object.isFrozen(save)).toBe(true);
    expect(Object.isFrozen(save.settings)).toBe(true);
  });

  it("derives only editable settings and applies them without changing package-owned presentation fields", () => {
    const settings = settingsSnapshot();
    settings.candidatesPerChunk = CLOUD_ASSET_AUTHORING_SETTINGS_BOUNDS.candidatesPerChunk.maximum;
    settings.chunkDensity = 0.45;
    settings.opacity = { minimum: 0.4, maximum: 0.75 };
    settings.scale = { minimum: 0.3, maximum: 0.9 };
    settings.driftAmplitudePixels = { minimum: 12, maximum: 240 };
    settings.driftPeriodSeconds = { minimum: 20, maximum: 360 };
    settings.fadeInSeconds = 8;
    settings.routeFadeFraction = 0.2;
    settings.shadow = {
      offsetPixels: { x: 80, y: 64 },
      opacityMultiplier: 0.5,
      scale: { x: 1.2, y: 0.4 },
    };

    const applied = applyCloudAssetAuthoringSettings(CLOUD_ASSET_PACKAGE.presentation, settings);
    expect(cloudAssetAuthoringSettingsFromPackage({
      ...CLOUD_ASSET_PACKAGE,
      presentation: applied,
    })).toEqual(settings);
    expect(applied.depth).toBe(CLOUD_ASSET_PACKAGE.presentation.depth);
    expect(applied.cloudTintsRgb).toBe(CLOUD_ASSET_PACKAGE.presentation.cloudTintsRgb);
    expect(applied.clearPaddingTiles).toBe(CLOUD_ASSET_PACKAGE.presentation.clearPaddingTiles);
    expect(applied.shadow.depth).toBe(CLOUD_ASSET_PACKAGE.presentation.shadow.depth);
    expect(applied.shadow.tintRgb).toBe(CLOUD_ASSET_PACKAGE.presentation.shadow.tintRgb);
  });

  it("requires exact request and nested settings fields for the one cloud package identity", () => {
    expect(() => validateCloudAssetIdentityRequest({
      ...identityRequest(),
      outputPath: "C:/outside.json",
    })).toThrow(/must contain only/);
    expect(() => validateCloudAssetIdentityRequest({
      ...identityRequest(),
      assetId: "presentation.clouds.other",
    })).toThrow(/assetId must be presentation\.clouds\.primary/);
    expect(() => validateCloudAssetIdentityRequest({
      ...identityRequest(),
      formatVersion: 1,
    })).toThrow(/formatVersion must be 3/);
    expect(() => validateCloudAssetSaveRequest({
      ...identityRequest(),
      activeInGame: false,
    })).toThrow(/must contain only/);
    expect(() => validateCloudAssetSaveRequest({
      ...saveRequest(),
      settings: { ...settingsSnapshot(), depth: 52 },
    })).toThrow(/must contain only/);
    expect(() => validateCloudAssetSaveRequest({
      ...saveRequest(),
      settings: {
        ...settingsSnapshot(),
        shadow: { ...settingsSnapshot().shadow, tintRgb: { red: 1, green: 2, blue: 3 } },
      },
    })).toThrow(/must contain only/);
  });

  it("rejects non-finite, out-of-bounds, unordered, and incomplete settings", () => {
    const settings = settingsSnapshot();
    expect(() => validateCloudAssetAuthoringSettings({ ...settings, candidatesPerChunk: 2 }))
      .toThrow(/integer from 3 through 12/);
    expect(() => validateCloudAssetAuthoringSettings({ ...settings, candidatesPerChunk: 13 }))
      .toThrow(/integer from 3 through 12/);
    expect(() => validateCloudAssetAuthoringSettings({ ...settings, chunkDensity: Number.NaN }))
      .toThrow(/must be finite/);
    expect(() => validateCloudAssetAuthoringSettings({
      ...settings,
      opacity: { minimum: 0.9, maximum: 0.2 },
    })).toThrow(/must be ordered/);
    expect(() => validateCloudAssetAuthoringSettings({
      ...settings,
      driftAmplitudePixels: { minimum: 0, maximum: 513 },
    })).toThrow(/between 0 and 512/);
    expect(() => validateCloudAssetAuthoringSettings({ ...settings, fadeInSeconds: 31 }))
      .toThrow(/between 0 and 30/);
    expect(() => validateCloudAssetAuthoringSettings({ ...settings, routeFadeFraction: 0.5 }))
      .toThrow(/between 0 and 0\.49/);
    expect(() => validateCloudAssetAuthoringSettings({
      ...settings,
      shadow: { ...settings.shadow, scale: { x: 4, y: 1 } },
    })).toThrow(/between 0\.05 and 3/);
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
      ...saveRequest(),
      activeInGame: "true",
    })).toThrow(/must be a boolean/);
  });
});
