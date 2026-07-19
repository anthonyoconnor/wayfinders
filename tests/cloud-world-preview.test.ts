import { describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_PACKAGE,
  validateCloudAssetPackage,
} from "../src/wayfinders/assets/CloudAssetCatalog.ts";
import {
  applyCloudAssetAuthoringSettings,
  cloudAssetAuthoringSettingsFromPackage,
} from "../src/wayfinders/assets/CloudAssetAuthoring.ts";
import {
  generateCloudWorldPreview,
  resolveCloudWorldPreviewDescriptors,
} from "../src/wayfinders/assets/cloudPreview/CloudWorldPreview.ts";

function settingsSnapshot() {
  return JSON.parse(JSON.stringify(
    cloudAssetAuthoringSettingsFromPackage(CLOUD_ASSET_PACKAGE),
  ));
}

function packageWithSettings(settings: ReturnType<typeof settingsSnapshot>) {
  return validateCloudAssetPackage({
    ...CLOUD_ASSET_PACKAGE,
    presentation: applyCloudAssetAuthoringSettings(CLOUD_ASSET_PACKAGE.presentation, settings),
  });
}

const previewModel = generateCloudWorldPreview(84_221);

describe("cloud world asset preview", () => {
  it("uses the generated runtime world and resolves every chunk deterministically", () => {
    expect(previewModel.generated.grid.width).toBe(96);
    expect(previewModel.generated.grid.height).toBe(96);
    const firstDescriptors = resolveCloudWorldPreviewDescriptors(previewModel, CLOUD_ASSET_PACKAGE);
    const secondDescriptors = resolveCloudWorldPreviewDescriptors(previewModel, CLOUD_ASSET_PACKAGE);
    expect(firstDescriptors).toHaveLength(54);
    expect(secondDescriptors).toEqual(firstDescriptors);
  });

  it("updates world density and frequency without replacing the generated layout model", () => {
    const sparse = settingsSnapshot();
    sparse.candidatesPerChunk = 3;
    sparse.chunkDensity = 0;
    const sparseDescriptors = resolveCloudWorldPreviewDescriptors(previewModel, packageWithSettings(sparse));
    expect(sparseDescriptors).toHaveLength(0);

    const full = settingsSnapshot();
    full.candidatesPerChunk = 12;
    full.chunkDensity = 1;
    expect(resolveCloudWorldPreviewDescriptors(previewModel, packageWithSettings(full))).toHaveLength(108);
  });

  it("uses ordinary seeded descriptors for every chunk, including the starting chunk", () => {
    const descriptors = resolveCloudWorldPreviewDescriptors(previewModel, CLOUD_ASSET_PACKAGE);
    expect(descriptors.every(({ id }) => /^cloud:\d+,\d+:\d+$/u.test(id))).toBe(true);
  });
});
