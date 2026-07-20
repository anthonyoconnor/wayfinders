import { describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_PACKAGE,
  cloudAssetVariantEntries,
  validateCloudAssetPackage,
  type CloudAssetPackage,
} from "../src/wayfinders/assets/CloudAssetCatalog";
import { resolveCloudDescriptorsForChunk } from "../src/wayfinders/rendering/CloudLayerRenderer";

describe("CLD-3 cloud asset workspace", () => {
  it("lists every stored frame in stable atlas order with saved availability", () => {
    expect(cloudAssetVariantEntries().map(({ id, frame, activeInGame }) => ({
      id,
      frame,
      activeInGame,
    }))).toEqual([
      { id: "long-broken-wisp", frame: 0, activeInGame: true },
      { id: "compact-uneven-cluster", frame: 1, activeInGame: true },
      { id: "split-trailing-wisps", frame: 2, activeInGame: true },
      { id: "shallow-crescent-bank", frame: 3, activeInGame: true },
      { id: "twin-crowned-cluster", frame: 4, activeInGame: true },
      { id: "notched-broad-bank", frame: 5, activeInGame: true },
      { id: "tapered-wedge-bank", frame: 6, activeInGame: true },
      { id: "three-tower-shelf", frame: 7, activeInGame: true },
      { id: "bow-tie-bank", frame: 8, activeInGame: true },
      { id: "forked-drift", frame: 9, activeInGame: true },
      { id: "three-finger-fan", frame: 10, activeInGame: true },
      { id: "crooked-crossbank", frame: 11, activeInGame: true },
      { id: "hook-and-beads", frame: 12, activeInGame: true },
      { id: "serpentine-ribbon", frame: 13, activeInGame: true },
      { id: "open-ring-bank", frame: 14, activeInGame: true },
      { id: "double-window-bank", frame: 15, activeInGame: true },
      { id: "triangular-hollow-bank", frame: 16, activeInGame: true },
      { id: "braided-channel-bank", frame: 17, activeInGame: true },
      { id: "curled-three-arm-cluster", frame: 18, activeInGame: true },
      { id: "stepped-trio", frame: 19, activeInGame: true },
      { id: "paired-islands", frame: 20, activeInGame: true },
      { id: "parallel-broken-bands", frame: 21, activeInGame: true },
      { id: "arc-scatter", frame: 22, activeInGame: true },
      { id: "staggered-front", frame: 23, activeInGame: true },
    ]);
    expect(CLOUD_ASSET_PACKAGE.variants).toHaveLength(CLOUD_ASSET_PACKAGE.image.frameCount);
  });

  it("produces no runtime cloud views when every fixed atlas slot has been deleted", () => {
    const deleted = {
      ...CLOUD_ASSET_PACKAGE,
      variants: CLOUD_ASSET_PACKAGE.variants.map(() => null),
    } satisfies CloudAssetPackage;
    expect(validateCloudAssetPackage(deleted)).toBe(deleted);
    expect(cloudAssetVariantEntries(deleted)).toEqual([]);
    expect(resolveCloudDescriptorsForChunk(
      84_221,
      {
        viewKey: "test:0,0",
        canonicalChunk: { x: 0, y: 0 },
        imageOffset: { x: 0, y: 0 },
        band: "visible",
        ringDistance: 0,
        loadPriority: 0,
      },
      512,
      deleted.presentation.candidatesPerChunk,
      deleted,
    )).toEqual([]);
  });
});
