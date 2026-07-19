import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(root, "runtime");
const REQUIRED_IMAGE_IDS = [
  "world.water.depth-transitions",
  "world.water.surface-overlays",
  "world.water.tiles.animated",
  "world.water.tiles.static",
];

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
const imageIds = manifest.images.map(({ imageId }) => imageId).sort();
assert(JSON.stringify(imageIds) === JSON.stringify(REQUIRED_IMAGE_IDS), "water package must contain only the four generic runtime sheets");

const reportByFile = new Map(report.outputs.map((output) => [output.filename, output]));
const expectedOutputFiles = [
  ...manifest.images.map(({ file }) => file.replace(/^runtime\//u, "")),
  ...manifest.previewImages.map((file) => file.replace(/^runtime\//u, "")),
].sort();
assert(
  JSON.stringify([...reportByFile.keys()].sort()) === JSON.stringify(expectedOutputFiles),
  "build report outputs must match the generic runtime sheets and declared previews",
);
const actualRuntimePngs = (await readdir(runtimeRoot)).filter((file) => file.endsWith(".png")).sort();
assert(
  JSON.stringify(actualRuntimePngs) === JSON.stringify(expectedOutputFiles),
  "runtime output directory must not contain undeclared or retired water sheets",
);
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
