import { describe, expect, it } from "vitest";
import playerBoat from "../src/wayfinders/assets/packages/player-boat.json";
import homeIsland from "../src/wayfinders/assets/packages/home-island.json";
import fishingShoal from "../src/wayfinders/assets/packages/fishing-shoal.json";
import {
  ASSET_CANDIDATE_BUNDLE_VERSION,
  candidateImageRequirements,
  validateAssetCandidateBundle,
} from "../src/wayfinders/assets/AssetCandidate";
import { validateAuthoredAssetMetadata } from "../src/wayfinders/assets/AuthoredAssetContracts";

function pngHeaderData(width: number, height: number): string {
  const header = Buffer.alloc(29);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  return `data:image/png;base64,${header.toString("base64")}`;
}

function bundle(metadataInput: unknown) {
  const metadata = validateAuthoredAssetMetadata(metadataInput);
  return {
    bundleVersion: ASSET_CANDIDATE_BUNDLE_VERSION,
    metadata: metadataInput,
    images: candidateImageRequirements(metadata).map((requirement, index) => ({
      imageId: requirement.imageId,
      filename: `candidate-${index}.png`,
      mimeType: "image/png",
      width: requirement.size.width,
      height: requirement.size.height,
      dataUrl: pngHeaderData(requirement.size.width, requirement.size.height),
    })),
  };
}

describe("GR-2.2 asset candidate validation", () => {
  it.each([homeIsland, playerBoat, fishingShoal])("accepts a complete package bundle", (metadata) => {
    expect(validateAssetCandidateBundle(bundle(metadata)).metadata.assetId).toBe(metadata.assetId);
  });

  it("round-trips explicit collision profiles through candidate normalization", () => {
    const home = validateAssetCandidateBundle(bundle(homeIsland)).metadata;
    const boat = validateAssetCandidateBundle(bundle(playerBoat)).metadata;
    const shoal = validateAssetCandidateBundle(bundle(fishingShoal)).metadata;
    expect(home.collision).toEqual(homeIsland.collision);
    expect(boat.collision).toEqual(playerBoat.collision);
    expect(shoal.collision).toEqual(fishingShoal.collision);
  });

  it("keeps a legacy candidate's omitted collision profile omitted", () => {
    const legacy = structuredClone(homeIsland) as Record<string, unknown>;
    delete legacy.collision;
    const metadata = validateAssetCandidateBundle(bundle(legacy)).metadata;
    expect(Object.hasOwn(metadata, "collision")).toBe(false);
  });

  it("rejects malformed collision metadata before accepting candidate images", () => {
    const malformed = structuredClone(homeIsland) as unknown as Record<string, unknown>;
    const collision = malformed.collision as { mixedCells: unknown[] };
    collision.mixedCells = [{
      x: 1,
      y: 1,
      solidRows: ["1111", "1111", "1111", "1111"],
    }];
    expect(() => bundle(malformed)).toThrow(/must be mixed/);
  });

  it("derives exact directional and wake sheet layouts", () => {
    const directional = {
      ...playerBoat,
      visual: { ...playerBoat.visual, headingMode: "directional", directionCount: 8, motionFramesPerDirection: 3 },
      wake: { ...playerBoat.wake, frameCount: 4 },
    };
    const metadata = validateAuthoredAssetMetadata(directional);
    const requirements = candidateImageRequirements(metadata);
    expect(requirements[0]).toMatchObject({ size: { width: 192, height: 512 }, frameCount: 24 });
    expect(requirements[1]).toMatchObject({ size: { width: 384, height: 64 }, frameCount: 4 });
  });

  it("rejects missing, incompatible and unreferenced images", () => {
    const missing = bundle(playerBoat);
    missing.images.pop();
    expect(() => validateAssetCandidateBundle(missing)).toThrow(/missing image/);

    const wrongSize = bundle(fishingShoal);
    wrongSize.images[0].width += 1;
    expect(() => validateAssetCandidateBundle(wrongSize)).toThrow(/PNG header disagrees/);

    const extra = bundle(homeIsland);
    extra.images.push({ ...extra.images[0], imageId: "unreferenced", filename: "extra.png" });
    expect(() => validateAssetCandidateBundle(extra)).toThrow(/unreferenced image/);
  });

  it("rejects malformed metadata, unsafe filenames and oversized textures", () => {
    const malformed = bundle(fishingShoal);
    malformed.metadata = { ...fishingShoal, contractVersion: 99 };
    expect(() => validateAssetCandidateBundle(malformed)).toThrow(/Unsupported authored asset contract/);

    const unsafe = bundle(fishingShoal);
    unsafe.images[0].filename = "../shoal.png";
    expect(() => validateAssetCandidateBundle(unsafe)).toThrow(/lowercase PNG basename/);

    const oversized = bundle(fishingShoal);
    oversized.images[0].width = 4_097;
    oversized.images[0].dataUrl = pngHeaderData(4_097, oversized.images[0].height);
    expect(() => validateAssetCandidateBundle(oversized)).toThrow(/texture limit/);
  });
});
