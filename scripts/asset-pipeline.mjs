import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidateImageRequirements,
  validateAssetCandidateBundle,
} from "../src/wayfinders/assets/AssetCandidate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "assets-src", "gr2", "asset-catalog.json");
const generatedPath = path.join(root, "src", "wayfinders", "assets", "generated", "AssetCatalog.generated.ts");
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

async function buildCatalog(checkOnly = false) {
  const manifest = await readManifest();
  await validateManifest(manifest);
  const generated = renderCatalog(manifest);
  if (checkOnly) {
    const current = await readFile(generatedPath, "utf8").catch(() => "");
    if (current !== generated) throw new Error("Generated asset catalog is stale; run npm.cmd run assets:build");
  } else {
    await mkdir(path.dirname(generatedPath), { recursive: true });
    await writeFile(generatedPath, generated, "utf8");
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

const [command = "build", ...args] = process.argv.slice(2);
if (command === "build") await buildCatalog(false);
else if (command === "check") await buildCatalog(true);
else if (command === "intake") await intakeCandidate(
  args.find((arg) => !arg.startsWith("--")),
  args.includes("--replace"),
  args.includes("--dry-run"),
);
else throw new Error(`Unknown asset pipeline command ${command}`);
