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
import { gridToWorld } from "../src/wayfinders/world/CoordinateSystem.ts";

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
    expect(firstDescriptors.filter(({ id }) => id.startsWith("cloud:home:"))).toHaveLength(3);
  });

  it("updates world density and frequency without replacing the generated layout model", () => {
    const sparse = settingsSnapshot();
    sparse.candidatesPerChunk = 3;
    sparse.chunkDensity = 0;
    const sparseDescriptors = resolveCloudWorldPreviewDescriptors(previewModel, packageWithSettings(sparse));
    expect(sparseDescriptors).toHaveLength(3);
    expect(sparseDescriptors.every(({ id }) => id.startsWith("cloud:home:"))).toBe(true);

    const full = settingsSnapshot();
    full.candidatesPerChunk = 12;
    full.chunkDensity = 1;
    expect(resolveCloudWorldPreviewDescriptors(previewModel, packageWithSettings(full))).toHaveLength(108);
  });

  it("applies opening position and size drafts through the shared runtime descriptor seam", () => {
    const settings = settingsSnapshot();
    settings.openingClouds.offsetPixels = [
      { x: -200, y: -120 },
      { x: 160, y: -40 },
      { x: 40, y: 180 },
    ];
    settings.openingClouds.scale = { minimum: 0.6, maximum: 0.6 };
    const descriptors = resolveCloudWorldPreviewDescriptors(previewModel, packageWithSettings(settings));
    const opening = descriptors.filter(({ id }) => id.startsWith("cloud:home:"));
    const home = gridToWorld(
      previewModel.generated.landmarks.homeCenter,
      previewModel.generated.grid.tileSize,
    );
    expect(opening.map(({ baseX, baseY }) => ({ x: baseX - home.x, y: baseY - home.y })))
      .toEqual(settings.openingClouds.offsetPixels);
    expect(opening.every(({ scale }) => scale === 0.6)).toBe(true);
  });
});
