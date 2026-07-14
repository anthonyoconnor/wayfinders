import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import {
  candidateImageRequirements,
  validateAssetCandidateBundle,
} from "../src/wayfinders/assets/AssetCandidate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "assets-src", "gr2", "asset-catalog.json");
const generatedPath = path.join(root, "src", "wayfinders", "assets", "generated", "AssetCatalog.generated.ts");
const reportPath = path.join(root, "assets-src", "gr2", "generated", "asset-report.json");
const thumbnailRoot = path.join(root, "public", "assets", "gr2", "thumbnails");
const packageRoot = path.join(root, "src", "wayfinders", "assets", "packages");
const knownPackageFiles = new Map([
  ["home.island.primary", "home-island.json"],
  ["player.boat.primary", "player-boat.json"],
  ["shoal.fishing.primary", "fishing-shoal.json"],
]);

function pngSize(buffer, label) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new RangeError(`${label} is not a PNG file`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function crc32(buffer) {
  let crc = 0xffff_ffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function decodePng(buffer, label = "PNG") {
  const size = pngSize(buffer, label);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new RangeError(`${label} must be a non-interlaced 8-bit RGB or RGBA PNG`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(idat));
  const stride = size.width * channels;
  if (filtered.length !== (stride + 1) * size.height) throw new RangeError(`${label} has invalid scanline data`);
  const pixels = Buffer.alloc(size.width * size.height * 4);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  for (let y = 0; y < size.height; y++) {
    const rowOffset = y * (stride + 1);
    const filter = filtered[rowOffset];
    for (let x = 0; x < stride; x++) {
      const source = filtered[rowOffset + 1 + x];
      const left = x >= channels ? current[x - channels] : 0;
      const above = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      switch (filter) {
        case 0: current[x] = source; break;
        case 1: current[x] = (source + left) & 0xff; break;
        case 2: current[x] = (source + above) & 0xff; break;
        case 3: current[x] = (source + Math.floor((left + above) / 2)) & 0xff; break;
        case 4: current[x] = (source + paeth(left, above, upperLeft)) & 0xff; break;
        default: throw new RangeError(`${label} uses unsupported PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < size.width; x++) {
      const sourceIndex = x * channels;
      const targetIndex = (y * size.width + x) * 4;
      pixels[targetIndex] = current[sourceIndex];
      pixels[targetIndex + 1] = current[sourceIndex + 1];
      pixels[targetIndex + 2] = current[sourceIndex + 2];
      pixels[targetIndex + 3] = channels === 4 ? current[sourceIndex + 3] : 255;
    }
    current.copy(previous);
  }
  return { ...size, pixels };
}

export function encodePng(width, height, pixels) {
  if (pixels.length !== width * height * 4) throw new RangeError("RGBA buffer length does not match PNG dimensions");
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createThumbnail(buffer, maximumSize = 192, label = "PNG") {
  const source = decodePng(buffer, label);
  const scale = Math.min(1, maximumSize / source.width, maximumSize / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / scale));
      source.pixels.copy(pixels, (y * width + x) * 4, (sourceY * source.width + sourceX) * 4, (sourceY * source.width + sourceX) * 4 + 4);
    }
  }
  return { width, height, buffer: encodePng(width, height, pixels) };
}

function assertRelativeFile(value, label) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    throw new RangeError(`${label} must be a repository-relative file path`);
  }
  return value.replaceAll("\\", "/");
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest?.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new RangeError("Asset catalog manifest must use version 1 with an entries array");
  }
  return manifest;
}

async function validateManifest(manifest) {
  const assetIds = new Set();
  const metadataKeys = new Set();
  const textureKeys = new Set();
  for (const [entryIndex, entry] of manifest.entries.entries()) {
    if (assetIds.has(entry.assetId)) throw new RangeError(`Catalog contains duplicate asset ID ${entry.assetId}`);
    if (metadataKeys.has(entry.metadataKey)) throw new RangeError(`Catalog contains duplicate metadata key ${entry.metadataKey}`);
    assetIds.add(entry.assetId);
    metadataKeys.add(entry.metadataKey);
    const metadataFile = assertRelativeFile(entry.metadataFile, `entries[${entryIndex}].metadataFile`);
    if (metadataFile.includes("/")) throw new RangeError("Catalog metadataFile must be a package basename");
    const metadata = JSON.parse(await readFile(path.join(packageRoot, metadataFile), "utf8"));
    if (!Array.isArray(entry.images) || entry.images.length === 0) {
      throw new RangeError(`${entry.assetId} must catalog at least one image`);
    }
    const candidateImages = [];
    for (const [imageIndex, image] of entry.images.entries()) {
      if (textureKeys.has(image.textureKey)) throw new RangeError(`Catalog contains duplicate texture key ${image.textureKey}`);
      textureKeys.add(image.textureKey);
      const runtimeFile = assertRelativeFile(image.runtimeFile, `entries[${entryIndex}].images[${imageIndex}].runtimeFile`);
      const buffer = await readFile(path.join(root, runtimeFile));
      const size = pngSize(buffer, runtimeFile);
      if (image.loader !== "image" && image.loader !== "spritesheet") {
        throw new RangeError(`${image.imageId} loader must be image or spritesheet`);
      }
      if (image.loader === "spritesheet") {
        if (!Number.isInteger(image.frameConfig?.frameWidth) || !Number.isInteger(image.frameConfig?.frameHeight)) {
          throw new RangeError(`${image.imageId} spritesheet requires integer frame dimensions`);
        }
      } else if (image.frameConfig !== undefined) {
        throw new RangeError(`${image.imageId} image loader cannot declare frameConfig`);
      }
      candidateImages.push({
        imageId: image.imageId,
        filename: path.basename(runtimeFile),
        mimeType: "image/png",
        ...size,
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      });
    }
    const bundle = validateAssetCandidateBundle({ bundleVersion: 1, metadata, images: candidateImages });
    if (bundle.metadata.assetId !== entry.assetId) {
      throw new RangeError(`${metadataFile} resolves ${bundle.metadata.assetId} instead of ${entry.assetId}`);
    }
    const requirements = candidateImageRequirements(bundle.metadata);
    for (const requirement of requirements) {
      const image = entry.images.find((candidate) => candidate.imageId === requirement.imageId);
      if (!image) throw new RangeError(`${entry.assetId} does not catalog ${requirement.imageId}`);
      if (requirement.role !== image.loader) throw new RangeError(`${requirement.imageId} must use the ${requirement.role} loader`);
      if (
        requirement.frameSize
        && (requirement.frameSize.width !== image.frameConfig?.frameWidth
          || requirement.frameSize.height !== image.frameConfig?.frameHeight)
      ) throw new RangeError(`${requirement.imageId} frameConfig disagrees with metadata`);
    }
  }
}

function renderCatalog(manifest) {
  const entries = manifest.entries.map((entry) => {
    const images = entry.images.map((image) => {
      const frameConfig = image.frameConfig
        ? `,\n          frameConfig: Object.freeze({ frameWidth: ${image.frameConfig.frameWidth}, frameHeight: ${image.frameConfig.frameHeight} })`
        : "";
      return `        Object.freeze({\n          imageId: ${JSON.stringify(image.imageId)},\n          textureKey: ${JSON.stringify(image.textureKey)},\n          url: ${JSON.stringify(image.url)}${frameConfig}\n        })`;
    }).join(",\n");
    return `  Object.freeze({\n    assetId: ${JSON.stringify(entry.assetId)},\n    metadataKey: ${JSON.stringify(entry.metadataKey)},\n    metadataUrl: new URL(${JSON.stringify(`../packages/${entry.metadataFile}`)}, import.meta.url).href,\n    images: Object.freeze([\n${images}\n    ])\n  })`;
  }).join(",\n");
  return `// Generated by scripts/asset-pipeline.mjs. Do not edit by hand.\nexport const GENERATED_ASSET_CATALOG = Object.freeze([\n${entries}\n]);\n`;
}

async function renderAutomationArtifacts(manifest) {
  const thumbnails = new Map();
  const entries = [];
  let totalSourceBytes = 0;
  let totalTextureBytes = 0;
  let imageCount = 0;
  for (const entry of manifest.entries) {
    const metadata = JSON.parse(await readFile(path.join(packageRoot, entry.metadataFile), "utf8"));
    const candidateImages = [];
    const imageBuffers = new Map();
    for (const image of entry.images) {
      const runtimeFile = assertRelativeFile(image.runtimeFile, `${entry.assetId}.${image.imageId}.runtimeFile`);
      const buffer = await readFile(path.join(root, runtimeFile));
      const size = pngSize(buffer, runtimeFile);
      candidateImages.push({
        imageId: image.imageId,
        filename: path.basename(runtimeFile),
        mimeType: "image/png",
        ...size,
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      });
      imageBuffers.set(image.imageId, { buffer, runtimeFile, ...size });
    }
    const bundle = validateAssetCandidateBundle({ bundleVersion: 1, metadata, images: candidateImages });
    const requirements = new Map(candidateImageRequirements(bundle.metadata).map((requirement) => [requirement.imageId, requirement]));
    const reportImages = [];
    for (const [index, image] of entry.images.entries()) {
      const source = imageBuffers.get(image.imageId);
      const requirement = requirements.get(image.imageId);
      const thumbnail = createThumbnail(source.buffer, 192, source.runtimeFile);
      const thumbnailName = `${entry.assetId.replaceAll(".", "-")}-${index + 1}.png`;
      thumbnails.set(thumbnailName, thumbnail.buffer);
      const sourceBytes = source.buffer.length;
      const textureBytes = source.width * source.height * 4;
      totalSourceBytes += sourceBytes;
      totalTextureBytes += textureBytes;
      imageCount++;
      reportImages.push({
        imageId: image.imageId,
        runtimeFile: source.runtimeFile,
        loader: image.loader,
        width: source.width,
        height: source.height,
        frameCount: requirement.frameCount,
        sourceBytes,
        estimatedTextureBytes: textureBytes,
        sha256: createHash("sha256").update(source.buffer).digest("hex"),
        thumbnailFile: `public/assets/gr2/thumbnails/${thumbnailName}`,
        thumbnailWidth: thumbnail.width,
        thumbnailHeight: thumbnail.height,
      });
    }
    entries.push({ assetId: entry.assetId, metadataFile: entry.metadataFile, images: reportImages });
  }
  const report = {
    formatVersion: 1,
    textureLimit: { width: 4_096, height: 4_096 },
    thumbnailMaximum: 192,
    totals: { packages: entries.length, images: imageCount, sourceBytes: totalSourceBytes, estimatedTextureBytes: totalTextureBytes },
    entries,
  };
  return { thumbnails, report: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8") };
}

async function assertArtifact(pathname, expected, label) {
  const current = await readFile(pathname).catch(() => Buffer.alloc(0));
  if (!current.equals(expected)) throw new Error(`${label} is stale; run npm.cmd run assets:build`);
}

async function buildCatalog(checkOnly = false) {
  const manifest = await readManifest();
  await validateManifest(manifest);
  const generated = Buffer.from(renderCatalog(manifest), "utf8");
  const automation = await renderAutomationArtifacts(manifest);
  if (checkOnly) {
    await assertArtifact(generatedPath, generated, "Generated asset catalog");
    await assertArtifact(reportPath, automation.report, "Generated asset report");
    const expectedNames = [...automation.thumbnails.keys()].sort();
    const currentNames = (await readdir(thumbnailRoot).catch(() => [])).filter((name) => name.endsWith(".png")).sort();
    if (currentNames.join("|") !== expectedNames.join("|")) {
      throw new Error("Generated asset thumbnail set is stale; run npm.cmd run assets:build");
    }
    for (const [name, thumbnail] of automation.thumbnails) {
      await assertArtifact(path.join(thumbnailRoot, name), thumbnail, `Generated thumbnail ${name}`);
    }
  } else {
    await mkdir(path.dirname(generatedPath), { recursive: true });
    await mkdir(path.dirname(reportPath), { recursive: true });
    await mkdir(thumbnailRoot, { recursive: true });
    await writeFile(generatedPath, generated);
    await writeFile(reportPath, automation.report);
    const expectedNames = new Set(automation.thumbnails.keys());
    for (const name of await readdir(thumbnailRoot)) {
      if (name.endsWith(".png") && !expectedNames.has(name)) await unlink(path.join(thumbnailRoot, name));
    }
    for (const [name, thumbnail] of automation.thumbnails) await writeFile(path.join(thumbnailRoot, name), thumbnail);
  }
  return manifest;
}

async function intakeCandidate(bundleFile, replace, dryRun) {
  if (!bundleFile) throw new Error("Usage: npm.cmd run assets:intake -- <candidate.json> [--replace]");
  const sourcePath = path.resolve(root, bundleFile);
  const bundle = validateAssetCandidateBundle(JSON.parse(await readFile(sourcePath, "utf8")));
  for (const image of bundle.images) {
    const buffer = Buffer.from(image.dataUrl.slice("data:image/png;base64,".length), "base64");
    const actual = pngSize(buffer, image.filename);
    if (actual.width !== image.width || actual.height !== image.height) {
      throw new RangeError(`${image.filename} PNG header disagrees with its candidate dimensions`);
    }
    decodePng(buffer, image.filename);
  }
  const manifest = await readManifest();
  const existingIndex = manifest.entries.findIndex((entry) => entry.assetId === bundle.metadata.assetId);
  if (existingIndex >= 0 && !replace) {
    throw new Error(`${bundle.metadata.assetId} already exists; review the candidate and rerun with --replace`);
  }
  const metadataFile = knownPackageFiles.get(bundle.metadata.assetId);
  if (!metadataFile) throw new RangeError(`No GR-2 intake target exists for ${bundle.metadata.assetId}`);
  const slug = bundle.metadata.assetId.replaceAll(".", "-");
  if (dryRun) {
    console.log(`Validated ${bundle.metadata.assetId}: ${bundle.images.length} PNG(s); intake would ${existingIndex >= 0 ? "replace" : "add"} ${metadataFile}.`);
    return;
  }
  const runtimeDirectory = path.join(root, "public", "assets", "gr2", "images");
  const candidateDirectory = path.join(root, "assets-src", "gr2", "candidates");
  await mkdir(runtimeDirectory, { recursive: true });
  await mkdir(candidateDirectory, { recursive: true });
  await writeFile(path.join(packageRoot, metadataFile), `${JSON.stringify(bundle.metadata, null, 2)}\n`, "utf8");
  await writeFile(path.join(candidateDirectory, `${slug}.candidate.json`), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  const requirements = new Map(candidateImageRequirements(bundle.metadata).map((requirement) => [requirement.imageId, requirement]));
  const images = [];
  for (const [index, image] of bundle.images.entries()) {
    const outputName = `${slug}-${index + 1}-${image.filename}`;
    const outputPath = path.join(runtimeDirectory, outputName);
    await writeFile(outputPath, Buffer.from(image.dataUrl.slice("data:image/png;base64,".length), "base64"));
    const requirement = requirements.get(image.imageId);
    images.push({
      imageId: image.imageId,
      textureKey: `wayfinders:image:${slug}:${index + 1}`,
      runtimeFile: path.relative(root, outputPath).replaceAll("\\", "/"),
      url: `./assets/gr2/images/${outputName}`,
      loader: requirement.role,
      ...(requirement.frameSize ? { frameConfig: {
        frameWidth: requirement.frameSize.width,
        frameHeight: requirement.frameSize.height,
      } } : {}),
    });
  }
  const nextEntry = {
    assetId: bundle.metadata.assetId,
    metadataFile,
    metadataKey: `wayfinders:metadata:${slug}`,
    images,
  };
  if (existingIndex >= 0) manifest.entries[existingIndex] = nextEntry;
  else manifest.entries.push(nextEntry);
  manifest.entries.sort((left, right) => left.assetId.localeCompare(right.assetId));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await buildCatalog(false);
  console.log(`Accepted ${bundle.metadata.assetId}: metadata, ${images.length} PNG(s), source bundle and catalog regenerated.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = "build", ...args] = process.argv.slice(2);
  if (command === "build") await buildCatalog(false);
  else if (command === "check") await buildCatalog(true);
  else if (command === "intake") await intakeCandidate(
    args.find((arg) => !arg.startsWith("--")),
    args.includes("--replace"),
    args.includes("--dry-run"),
  );
  else throw new Error(`Unknown asset pipeline command ${command}`);
}
