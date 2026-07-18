import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(root, "runtime");
const HOME_DEPTH_HANDOFF_ID = "world.water.home-depth-handoff";
const HOME_DEPTH_HANDOFF_FILE = "water-home-depth-handoff.png";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pngHeader(buffer, label) {
  assert(
    buffer.length >= 33
      && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      && buffer.readUInt32BE(8) === 13
      && buffer.subarray(12, 16).toString("ascii") === "IHDR",
    `${label} has an invalid PNG header`,
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  };
}

function frameCapacity(image, header) {
  const margin = image.margin ?? 0;
  const spacing = image.spacing ?? 0;
  const columns = (header.width - margin * 2 + spacing) / (image.frameSize.width + spacing);
  const rows = (header.height - margin * 2 + spacing) / (image.frameSize.height + spacing);
  assert(Number.isInteger(columns) && columns > 0, `${image.imageId} has invalid frame columns`);
  assert(Number.isInteger(rows) && rows > 0, `${image.imageId} has invalid frame rows`);
  return { columns, rows, frames: columns * rows };
}

const manifest = JSON.parse(await readFile(path.join(root, "water-package.json"), "utf8"));
const report = JSON.parse(await readFile(path.join(runtimeRoot, "build-report.json"), "utf8"));
assert(manifest.contractVersion === 1, "water package contractVersion must be 1");
assert(manifest.tileSize === 32 && manifest.artTileSize === 16, "water package grid must remain 32/16");
assert(report.tileSize === 32 && report.frameCount === 8 && report.variantCount === 4, "build report geometry mismatch");
assert(report.transitionMasks.length === 47 && new Set(report.transitionMasks).size === 47, "build report must contain 47 unique masks");
assert(JSON.stringify(report.transitionMasks) === JSON.stringify(manifest.images.find(({ imageId }) => imageId.endsWith("depth-transitions")).maskLookup), "manifest/report mask lookup mismatch");
assert(report.validation.checkedBaseFrames === 256, "builder did not validate all 256 base frames");
assert(
  report.validation.maximumWrapLumaDelta <= report.validation.maximumStepLumaDelta * 1.5 + 1,
  "animation wrap delta exceeds the normal step tolerance",
);
assert(report.validation.transparentOverlayPixels > 0, "overlay alpha validation did not run");
assert(report.validation.transparentHomeOverlayPixels > 0, "home-overlay alpha validation did not run");
assert(report.validation.transparentHomeHandoffPixels > 0, "home-depth-handoff alpha validation did not run");
assert(report.validation.homeHandoff?.alphaLevels >= 24, "home-depth-handoff must retain at least 24 alpha levels");
assert(report.validation.homeHandoff?.lumaBands >= 10, "home-depth-handoff must retain at least 10 luma bands");
assert(report.validation.homeHandoff?.maximumAxisRun < 32, "home-depth-handoff contour contains a long axis-aligned run");
assert(report.validation.homeHandoff?.shelfWidthRatio >= 3, "home-depth-handoff shelf width is too uniform");

const homeDepthHandoff = manifest.images.find(({ imageId }) => imageId === HOME_DEPTH_HANDOFF_ID);
assert(homeDepthHandoff, `${HOME_DEPTH_HANDOFF_ID} is missing from the manifest`);
assert(homeDepthHandoff.file === `runtime/${HOME_DEPTH_HANDOFF_FILE}`, `${HOME_DEPTH_HANDOFF_ID} file mismatch`);
assert(homeDepthHandoff.loader === "spritesheet", `${HOME_DEPTH_HANDOFF_ID} loader must be spritesheet`);
assert(homeDepthHandoff.pixelSize.width === 3216 && homeDepthHandoff.pixelSize.height === 1608, `${HOME_DEPTH_HANDOFF_ID} pixel size mismatch`);
assert(homeDepthHandoff.frameSize.width === 800 && homeDepthHandoff.frameSize.height === 800, `${HOME_DEPTH_HANDOFF_ID} frame size mismatch`);
assert(homeDepthHandoff.margin === 2 && homeDepthHandoff.spacing === 4, `${HOME_DEPTH_HANDOFF_ID} frame gutter mismatch`);
assert(homeDepthHandoff.frameCount === 8, `${HOME_DEPTH_HANDOFF_ID} frame count mismatch`);
assert(homeDepthHandoff.framesPerSecond === 5, `${HOME_DEPTH_HANDOFF_ID} playback rate mismatch`);
assert(homeDepthHandoff.origin.x === -160 && homeDepthHandoff.origin.y === -160, `${HOME_DEPTH_HANDOFF_ID} origin mismatch`);
assert(homeDepthHandoff.placement === "relative to the home top-left, above generic water and below the home island", `${HOME_DEPTH_HANDOFF_ID} placement mismatch`);
assert(homeDepthHandoff.role === "selected asymmetric Bahamian sand-shelf depth handoff; presentation-only", `${HOME_DEPTH_HANDOFF_ID} role mismatch`);
assert(homeDepthHandoff.alpha === true, `${HOME_DEPTH_HANDOFF_ID} must retain alpha`);

const reportByFile = new Map(report.outputs.map((output) => [output.filename, output]));
for (const output of report.outputs) {
  const buffer = await readFile(path.join(runtimeRoot, output.filename));
  const header = pngHeader(buffer, output.filename);
  assert(header.width === output.width && header.height === output.height, `${output.filename} dimensions differ from the build report`);
  assert(header.bitDepth === 8 && header.colorType === 6 && header.interlace === 0, `${output.filename} must be non-interlaced 8-bit RGBA`);
  assert(Math.max(header.width, header.height) <= 4096, `${output.filename} exceeds the 4096 px edge limit`);
  const digest = createHash("sha256").update(buffer).digest("hex");
  assert(digest === output.sha256, `${output.filename} SHA-256 differs from the build report`);
}

const expectedFrames = new Map([
  ["world.water.tiles.animated", 256],
  ["world.water.tiles.static", 32],
  ["world.water.depth-transitions", 188],
  ["world.water.surface-overlays", 32],
  ["world.water.home-shore-overlay", 8],
  [HOME_DEPTH_HANDOFF_ID, 8],
]);
for (const image of manifest.images) {
  const filename = image.file.replace(/^runtime\//u, "");
  const output = reportByFile.get(filename);
  assert(output, `${image.imageId} is missing from the build report`);
  assert(output.width === image.pixelSize.width && output.height === image.pixelSize.height, `${image.imageId} manifest dimensions mismatch`);
  const header = pngHeader(await readFile(path.join(root, image.file)), image.imageId);
  const capacity = frameCapacity(image, header);
  assert(capacity.frames === expectedFrames.get(image.imageId), `${image.imageId} frame capacity mismatch`);
  if (image.frameCount !== undefined) assert(image.frameCount === capacity.frames, `${image.imageId} frameCount mismatch`);
}

for (const sourceFile of manifest.sourceImages) {
  const header = pngHeader(await readFile(path.join(root, sourceFile)), sourceFile);
  assert(header.bitDepth === 8 && header.colorType === 6 && header.interlace === 0, `${sourceFile} must be normalized RGBA`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  package: manifest.assetId,
  profiles: manifest.profiles.length,
  canonicalMasks: report.transitionMasks.length,
  validatedRuntimePngs: report.outputs.length,
  validatedBaseFrames: report.validation.checkedBaseFrames,
  maximumStepLumaDelta: report.validation.maximumStepLumaDelta,
  maximumWrapLumaDelta: report.validation.maximumWrapLumaDelta,
}, null, 2));
process.stdout.write("\n");
