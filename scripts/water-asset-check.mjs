import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagePath = resolve(root, "src/wayfinders/assets/packages/water.json");
const publicRoot = resolve(root, "public/assets/gr1/water");
const metadata = JSON.parse(await readFile(packagePath, "utf8"));
const requiredProfiles = ["abyss", "brackish", "coastal", "current", "deep", "lagoon", "reef", "rough"];
const pngSignature = "89504e470d0a1a0a";
const homeDepthHandoffId = "world.water.home-depth-handoff";

function pngHeader(bytes, label) {
  if (
    bytes.length < 33
    || bytes.subarray(0, 8).toString("hex") !== pngSignature
    || bytes.readUInt32BE(8) !== 13
    || bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error(`${label} has an invalid PNG header`);
  }
  const header = {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    interlace: bytes[28],
  };
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new Error(`${label} must be non-interlaced 8-bit RGBA`);
  }
  return header;
}

function frameCapacity(image, header) {
  const margin = image.margin ?? 0;
  const spacing = image.spacing ?? 0;
  const columns = (header.width - margin * 2 + spacing) / (image.frameSize.width + spacing);
  const rows = (header.height - margin * 2 + spacing) / (image.frameSize.height + spacing);
  if (!Number.isSafeInteger(columns) || columns <= 0 || !Number.isSafeInteger(rows) || rows <= 0) {
    throw new Error(`${image.imageId} frame geometry does not fit its PNG dimensions`);
  }
  return columns * rows;
}

if (metadata.contractVersion !== 1 || metadata.assetId !== "world.water.primary" || metadata.kind !== "water-tile-package") {
  throw new Error("Water package identity or contract is invalid");
}
const profileIds = [...metadata.profiles.map(({ id }) => id)].sort();
if (JSON.stringify(profileIds) !== JSON.stringify(requiredProfiles)) {
  throw new Error(`Water package profiles do not match the runtime catalog: ${profileIds.join(", ")}`);
}
const homeDepthHandoff = metadata.images.find(({ imageId }) => imageId === homeDepthHandoffId);
if (
  !homeDepthHandoff
  || homeDepthHandoff.file !== "water-home-depth-handoff.png"
  || homeDepthHandoff.loader !== "spritesheet"
  || homeDepthHandoff.pixelSize.width !== 3216
  || homeDepthHandoff.pixelSize.height !== 1608
  || homeDepthHandoff.frameSize.width !== 800
  || homeDepthHandoff.frameSize.height !== 800
  || homeDepthHandoff.margin !== 2
  || homeDepthHandoff.spacing !== 4
  || homeDepthHandoff.frameCount !== 8
  || homeDepthHandoff.framesPerSecond !== 5
  || homeDepthHandoff.origin?.x !== -160
  || homeDepthHandoff.origin?.y !== -160
  || homeDepthHandoff.placement !== "relative to the home top-left, above generic water and below the home island"
  || homeDepthHandoff.role !== "selected asymmetric Bahamian sand-shelf depth handoff; presentation-only"
  || homeDepthHandoff.alpha !== true
) {
  throw new Error("Home depth handoff metadata does not match the selected 8-frame runtime contract");
}
for (const image of metadata.images) {
  const bytes = await readFile(resolve(publicRoot, image.file));
  const header = pngHeader(bytes, image.file);
  if (header.width !== image.pixelSize.width || header.height !== image.pixelSize.height) {
    throw new Error(`${image.file} is ${header.width}x${header.height}; expected ${image.pixelSize.width}x${image.pixelSize.height}`);
  }
  if (image.frameSize !== undefined) {
    const frames = frameCapacity(image, header);
    if (image.frameCount !== undefined && frames !== image.frameCount) {
      throw new Error(`${image.file} has capacity for ${frames} frames; expected ${image.frameCount}`);
    }
  }
}
for (const shoal of metadata.shoals) {
  const bytes = await readFile(resolve(publicRoot, shoal.file));
  const header = pngHeader(bytes, shoal.file);
  if (header.width !== shoal.pixelSize.width || header.height !== shoal.pixelSize.height) {
    throw new Error(`${shoal.file} is ${header.width}x${header.height}; expected ${shoal.pixelSize.width}x${shoal.pixelSize.height}`);
  }
}
console.log(`Water assets: ${metadata.images.length} sheets, ${metadata.shoals.length} shoal strengths, ${metadata.profiles.length} profiles OK`);
