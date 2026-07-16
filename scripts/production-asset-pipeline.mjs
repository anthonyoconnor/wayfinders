import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateProductionAssetRecipeManifest,
} from "../src/wayfinders/assets/ProductionAssetRecipe.ts";
import {
  createThumbnail,
  decodePng,
  encodePng,
} from "./asset-pipeline.mjs";
import { prepareProductionImage } from "./production-image-preparation.mjs";
import {
  seedPreparedShorelineCollision,
} from "./production-collision-seeding.mjs";
import { commitAtomicFileTransaction } from "./repository-collision-transaction.mjs";

export const PRODUCTION_PREPARATION_PIPELINE_VERSION = 2;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
const candidateRoot = path.join(root, "assets-src", "gr3", "candidates");
const generatedIndexPath = path.join(root, "assets-src", "gr3", "generated", "production-index.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function candidateSlug(recipeId) {
  return recipeId.replaceAll(".", "-");
}

function candidateDirectory(recipeId) {
  return path.join(candidateRoot, candidateSlug(recipeId));
}

function repositoryPath(absolutePath) {
  return path.relative(root, absolutePath).replaceAll("\\", "/");
}

function outputPath(recipeId, filename) {
  return path.join(candidateDirectory(recipeId), filename);
}

async function readManifest() {
  return validateProductionAssetRecipeManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

async function validateRuntimeRecipeFiles(recipe) {
  const images = new Map();
  for (const layer of recipe.layers) {
    const image = decodePng(await readFile(path.join(root, layer.sourceFile)), layer.sourceFile);
    images.set(layer.id, image);
    if (
      layer.preparation.mode === "preserve"
      && (image.width !== layer.preparation.targetWidth || image.height !== layer.preparation.targetHeight)
    ) {
      throw new RangeError(
        `${recipe.id} runtime layer ${layer.id} is ${image.width}x${image.height}, not its declared ${layer.preparation.targetWidth}x${layer.preparation.targetHeight}`,
      );
    }
  }
  for (const animation of recipe.animations) {
    const image = images.get(animation.layerId);
    if (!image) throw new RangeError(`${recipe.id} animation ${animation.id} is missing layer ${animation.layerId}`);
    if (image.width % animation.frameWidth !== 0 || image.height % animation.frameHeight !== 0) {
      throw new RangeError(`${recipe.id} animation ${animation.id} frame size does not divide its source sheet`);
    }
    const capacity = image.width / animation.frameWidth * image.height / animation.frameHeight;
    if (animation.frameCount > capacity) {
      throw new RangeError(`${recipe.id} animation ${animation.id} needs ${animation.frameCount} frames but its sheet holds ${capacity}`);
    }
  }
}

async function readOptionalJson(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readOptionalBytes(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function collisionGrid(collision, width, height) {
  if (
    width % collision.tileSize !== 0
    || height % collision.tileSize !== 0
    || width % collision.subcellSize !== 0
    || height % collision.subcellSize !== 0
  ) {
    throw new RangeError(
      `Prepared canvas ${width}x${height} must align to ${collision.tileSize}px cells and ${collision.subcellSize}px subcells`,
    );
  }
  return {
    width: width / collision.tileSize,
    height: height / collision.tileSize,
    subcellColumns: width / collision.subcellSize,
    subcellRows: height / collision.subcellSize,
  };
}

function sampledSolidSubcells(image, collision, predicate) {
  const grid = collisionGrid(collision, image.width, image.height);
  const solids = [];
  for (let y = 0; y < grid.subcellRows; y++) {
    for (let x = 0; x < grid.subcellColumns; x++) {
      const sampleX = Math.min(image.width - 1, x * collision.subcellSize + Math.floor(collision.subcellSize / 2));
      const sampleY = Math.min(image.height - 1, y * collision.subcellSize + Math.floor(collision.subcellSize / 2));
      const index = (sampleY * image.width + sampleX) * 4;
      if (predicate(image.pixels, index)) solids.push({ x, y });
    }
  }
  return { grid, solids };
}

export async function createCollisionDraft(recipe, preparedLayers, fingerprint) {
  const base = preparedLayers[0]?.image;
  if (!base) throw new RangeError(`${recipe.id} needs a prepared visual layer before collision drafting`);
  const common = {
    formatVersion: 1,
    recipeId: recipe.id,
    candidateFingerprint: fingerprint,
  };
  switch (recipe.collision.mode) {
    case "preserve":
      return {
        ...common,
        kind: "preserve-runtime-collision",
        runtimeAssetId: recipe.runtimeBinding.assetId,
      };
    case "empty":
      return { ...common, kind: "empty", passable: true, reason: recipe.collision.reason };
    case "blank-draft":
      return {
        ...common,
        kind: "hybrid-grid-draft",
        tileSize: recipe.collision.tileSize,
        subcellSize: recipe.collision.subcellSize,
        grid: collisionGrid(recipe.collision, base.width, base.height),
        solidSubcells: [],
        method: "manual-blank-draft",
        warnings: ["Collision is blank and requires manual authoring."],
      };
    case "shoreline-seed": {
      const seeded = seedPreparedShorelineCollision(base, recipe.collision);
      return {
        ...common,
        kind: "hybrid-grid-draft",
        tileSize: recipe.collision.tileSize,
        subcellSize: recipe.collision.subcellSize,
        grid: seeded.grid,
        solidSubcells: seeded.solidSubcells,
        method: seeded.method,
        warnings: seeded.warnings,
      };
    }
    case "alpha": {
      const sampled = sampledSolidSubcells(
        base,
        recipe.collision,
        (pixels, index) => pixels[index + 3] >= 128,
      );
      return {
        ...common,
        kind: "hybrid-grid-draft",
        tileSize: recipe.collision.tileSize,
        subcellSize: recipe.collision.subcellSize,
        grid: sampled.grid,
        solidSubcells: sampled.solids,
        method: "explicit-alpha-center-sample",
        warnings: ["Center sampling can miss thin or concave shoreline detail."],
        suggestedFrom: "explicit-alpha-solid-contract",
      };
    }
    case "mask-file": {
      const mask = decodePng(await readFile(path.join(root, recipe.collision.maskFile)), recipe.collision.maskFile);
      if (mask.width !== base.width || mask.height !== base.height) {
        throw new RangeError(`${recipe.id} semantic mask must match the prepared ${base.width}x${base.height} canvas`);
      }
      const sampled = sampledSolidSubcells(
        mask,
        recipe.collision,
        (pixels, index) => pixels[index + 3] >= 128
          && (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3 >= 128,
      );
      return {
        ...common,
        kind: "hybrid-grid-draft",
        tileSize: recipe.collision.tileSize,
        subcellSize: recipe.collision.subcellSize,
        grid: sampled.grid,
        solidSubcells: sampled.solids,
        method: "semantic-mask-center-sample",
        warnings: [],
        suggestedFrom: recipe.collision.maskFile,
      };
    }
  }
}

async function sourceInputs(recipe) {
  const layers = [];
  for (const layer of recipe.layers) {
    const absolutePath = path.join(root, layer.sourceFile);
    const buffer = await readFile(absolutePath);
    layers.push({ layer, buffer, sha256: sha256(buffer) });
  }
  let mask;
  if (recipe.collision.mode === "mask-file") {
    const buffer = await readFile(path.join(root, recipe.collision.maskFile));
    mask = { file: recipe.collision.maskFile, sha256: sha256(buffer) };
  }
  return { layers, mask };
}

function recipeJob(recipe, sources) {
  const recipeHash = sha256(Buffer.from(canonicalJson(recipe), "utf8"));
  const sourceHashes = sources.layers.map(({ layer, sha256: hash }) => ({
    layerId: layer.id,
    file: layer.sourceFile,
    sha256: hash,
  }));
  if (sources.mask) sourceHashes.push({ layerId: "collision-mask", ...sources.mask });
  const jobKey = sha256(Buffer.from(canonicalJson({
    pipelineVersion: PRODUCTION_PREPARATION_PIPELINE_VERSION,
    recipeHash,
    sourceHashes,
  }), "utf8"));
  return { recipeHash, sourceHashes, jobKey };
}

async function reportOutputsMatch(report) {
  const expected = new Map([
    ...report.outputs.layers.map((layer) => [layer.file, layer.sha256]),
    [report.outputs.thumbnail.file, report.outputs.thumbnail.sha256],
    [report.outputs.collisionDraft.file, report.outputs.collisionDraft.sha256],
  ]);
  for (const [filename, hash] of expected) {
    const bytes = await readOptionalBytes(path.join(root, filename));
    if (!bytes || sha256(bytes) !== hash) return false;
  }
  return true;
}

async function cachedReport(recipe, jobKey) {
  const report = await readOptionalJson(outputPath(recipe.id, "preparation-report.json"));
  if (
    report?.formatVersion !== 1
    || report?.pipelineVersion !== PRODUCTION_PREPARATION_PIPELINE_VERSION
    || report?.recipeId !== recipe.id
    || report?.jobKey !== jobKey
    || !await reportOutputsMatch(report)
  ) return undefined;
  return report;
}

function reportIndexEntry(report) {
  return {
    id: report.recipeId,
    family: report.family,
    lifecycle: report.lifecycle,
    jobKey: report.jobKey,
    sourceFiles: report.sources.map((source) => source.file),
    layers: report.outputs.layers.map((layer) => ({
      id: layer.id,
      file: layer.file,
      width: layer.width,
      height: layer.height,
      sha256: layer.sha256,
    })),
    thumbnailFile: report.outputs.thumbnail.file,
    collisionDraftFile: report.outputs.collisionDraft.file,
    ...(report.runtimeBinding ? { runtimeBinding: report.runtimeBinding } : {}),
  };
}

async function currentReports(replacement) {
  const manifest = await readManifest();
  const reports = [];
  for (const recipe of manifest.recipes) {
    if (recipe.lifecycle === "runtime" || recipe.lifecycle === "reference") continue;
    if (replacement?.recipeId === recipe.id) reports.push(replacement);
    else {
      // A manifest change must never re-stamp an old report into the new index.
      // Invalid/missing sources are isolated to their recipe; the final batch
      // error still reports them while successful jobs retain current outputs.
      try {
        const sources = await sourceInputs(recipe);
        const job = recipeJob(recipe, sources);
        const report = await cachedReport(recipe, job.jobKey);
        if (report) reports.push(report);
      } catch {
        // The recipe's own preparation result carries the actionable failure.
      }
    }
  }
  return reports.sort((left, right) => left.recipeId.localeCompare(right.recipeId, "en"));
}

async function indexBytes(replacement) {
  const manifest = await readManifest();
  const reports = await currentReports(replacement);
  return jsonBytes({
    formatVersion: 1,
    pipelineVersion: PRODUCTION_PREPARATION_PIPELINE_VERSION,
    manifestSha256: sha256(Buffer.from(canonicalJson(manifest), "utf8")),
    entries: reports.map(reportIndexEntry),
  });
}

async function buildRecipe(recipe, sources, job) {
  const preparedLayers = recipe.layers.map((layer, index) => {
    const source = decodePng(sources.layers[index].buffer, layer.sourceFile);
    return { layer, ...prepareProductionImage(source, layer.preparation) };
  });
  const layerOutputs = preparedLayers.map(({ layer, image, placement, sourceBounds }) => {
    const bytes = encodePng(image.width, image.height, image.pixels);
    const filename = `${layer.id}.png`;
    const absolutePath = outputPath(recipe.id, filename);
    return {
      bytes,
      absolutePath,
      report: {
        id: layer.id,
        file: repositoryPath(absolutePath),
        width: image.width,
        height: image.height,
        sha256: sha256(bytes),
        sourceBounds,
        placement,
      },
    };
  });
  const thumbnail = createThumbnail(
    layerOutputs[0].bytes,
    recipe.layers[0].preparation.thumbnailMaximum,
    `${recipe.id} prepared base layer`,
  );
  const thumbnailPath = outputPath(recipe.id, "thumbnail.png");
  const collisionDraft = await createCollisionDraft(recipe, preparedLayers, job.jobKey);
  const collisionBytes = jsonBytes(collisionDraft);
  const collisionPath = outputPath(recipe.id, "collision-draft.json");
  const report = {
    formatVersion: 1,
    pipelineVersion: PRODUCTION_PREPARATION_PIPELINE_VERSION,
    recipeId: recipe.id,
    family: recipe.family,
    lifecycle: "candidate",
    recipeHash: job.recipeHash,
    jobKey: job.jobKey,
    sources: job.sourceHashes,
    outputs: {
      layers: layerOutputs.map((output) => output.report),
      thumbnail: {
        file: repositoryPath(thumbnailPath),
        width: thumbnail.width,
        height: thumbnail.height,
        sha256: sha256(thumbnail.buffer),
      },
      collisionDraft: {
        file: repositoryPath(collisionPath),
        kind: collisionDraft.kind,
        sha256: sha256(collisionBytes),
      },
    },
    ...(recipe.runtimeBinding ? { runtimeBinding: recipe.runtimeBinding } : {}),
  };
  const reportPath = outputPath(recipe.id, "preparation-report.json");
  const changes = [
    ...layerOutputs.map((output) => ({ targetPath: output.absolutePath, bytes: output.bytes })),
    { targetPath: thumbnailPath, bytes: thumbnail.buffer },
    { targetPath: collisionPath, bytes: collisionBytes },
    { targetPath: reportPath, bytes: jsonBytes(report) },
    { targetPath: generatedIndexPath, bytes: await indexBytes(report) },
  ];
  await commitAtomicFileTransaction(changes);
  return report;
}

export async function prepareProductionRecipe(recipe, { checkOnly = false, force = false } = {}) {
  if (recipe.lifecycle === "runtime" || recipe.lifecycle === "reference") {
    for (const layer of recipe.layers) decodePng(await readFile(path.join(root, layer.sourceFile)), layer.sourceFile);
    return { status: "validated", recipeId: recipe.id };
  }
  const sources = await sourceInputs(recipe);
  const job = recipeJob(recipe, sources);
  const cached = await cachedReport(recipe, job.jobKey);
  if (cached && !force) return { status: "cached", recipeId: recipe.id, report: cached };
  if (checkOnly) throw new Error(`${recipe.id} preparation output is stale; run npm.cmd run assets:prepare -- --id ${recipe.id}`);
  return { status: "prepared", recipeId: recipe.id, report: await buildRecipe(recipe, sources, job) };
}

function optionValue(args, name) {
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function selectProductionRecipes(manifest, args) {
  const id = optionValue(args, "--id");
  const family = optionValue(args, "--family");
  if (id && family) throw new Error("Choose either --id or --family, not both");
  let recipes = manifest.recipes;
  if (id) recipes = recipes.filter((recipe) => recipe.id === id);
  else if (family) recipes = recipes.filter((recipe) => recipe.family === family);
  else recipes = recipes.filter((recipe) => recipe.lifecycle !== "runtime" && recipe.lifecycle !== "reference");
  if (recipes.length === 0 && (id !== undefined || family !== undefined)) {
    throw new RangeError(`No production recipes matched ${id ?? family}`);
  }
  return recipes;
}

export class ProductionPreparationBatchError extends AggregateError {
  constructor(failures, results) {
    super(
      failures.map(({ error }) => error),
      `Production preparation failed for ${failures.map(({ recipeId }) => recipeId).join(", ")}`,
    );
    this.name = "ProductionPreparationBatchError";
    this.failures = failures;
    this.results = results;
  }
}

export async function runIsolatedProductionJobs(recipes, execute) {
  const results = [];
  const failures = [];
  for (const recipe of recipes) {
    try {
      results.push(await execute(recipe));
    } catch (error) {
      failures.push({ recipeId: recipe.id, error });
    }
  }
  return { results, failures };
}

export async function runProductionPreparation(command, args = []) {
  const manifest = await readManifest();
  for (const recipe of manifest.recipes) {
    if (recipe.lifecycle === "runtime") await validateRuntimeRecipeFiles(recipe);
  }
  const recipes = selectProductionRecipes(manifest, args);
  const checkOnly = command === "check";
  const force = args.includes("--force");
  const { results, failures } = await runIsolatedProductionJobs(
    recipes,
    (recipe) => prepareProductionRecipe(recipe, { checkOnly, force }),
  );
  if (checkOnly) {
    const expectedIndex = await indexBytes();
    const currentIndex = await readOptionalBytes(generatedIndexPath);
    if (!currentIndex?.equals(expectedIndex)) {
      throw new Error("Generated production index is stale; run npm.cmd run assets:prepare");
    }
  } else {
    const expectedIndex = await indexBytes();
    const currentIndex = await readOptionalBytes(generatedIndexPath);
    if (!currentIndex?.equals(expectedIndex)) {
      await commitAtomicFileTransaction([{ targetPath: generatedIndexPath, bytes: expectedIndex }]);
    }
  }
  if (failures.length > 0) throw new ProductionPreparationBatchError(failures, results);
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = "prepare", ...args] = process.argv.slice(2);
  if (command !== "prepare" && command !== "check") {
    throw new Error("Usage: production-asset-pipeline.mjs <prepare|check> [--id ID|--family FAMILY|--all] [--force]");
  }
  const results = await runProductionPreparation(command, args);
  for (const result of results) console.log(`${result.status}: ${result.recipeId}`);
}
