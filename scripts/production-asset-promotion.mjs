import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_PREPARATION_PIPELINE_VERSION,
  canonicalJson,
} from "./production-asset-pipeline.mjs";
import { validateProductionReviewStore } from "./production-asset-review.mjs";
import {
  commitAtomicFileTransaction,
  withCollisionIntakeLock,
} from "./repository-collision-transaction.mjs";
import { validateProductionAssetRecipeManifest } from "../src/wayfinders/assets/ProductionAssetRecipe.ts";

export const PRODUCTION_PROMOTION_FORMAT_VERSION = 1;
export const PRODUCTION_PROMOTION_PIPELINE_VERSION = 1;

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^[a-f0-9]{64}$/u;
const MINIMUM_REFERENCE_ISLANDS = 20;
const MAX_THUMBNAIL_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_SELECTED_DECODED_BYTES = 16 * 1024 * 1024;

export class ProductionAssetPromotionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionAssetPromotionError";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repositoryFile(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new ProductionAssetPromotionError(`${label} must be a repository-relative POSIX path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new ProductionAssetPromotionError(`${label} escapes the repository`);
  }
  return value;
}

function fingerprint(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new ProductionAssetPromotionError(`${label} must be a lowercase SHA-256 fingerprint`);
  }
  return value;
}

export function productionManifestFingerprint(manifest) {
  return sha256(Buffer.from(canonicalJson(manifest), "utf8"));
}

function validateIndex(value, manifest) {
  if (
    !isRecord(value)
    || value.formatVersion !== 1
    || value.pipelineVersion !== PRODUCTION_PREPARATION_PIPELINE_VERSION
    || !Array.isArray(value.entries)
  ) {
    throw new ProductionAssetPromotionError(
      `Generated production index must use formatVersion 1 and pipelineVersion ${PRODUCTION_PREPARATION_PIPELINE_VERSION}`,
    );
  }
  const expectedManifestHash = productionManifestFingerprint(manifest);
  if (value.manifestSha256 !== expectedManifestHash) {
    throw new ProductionAssetPromotionError("Generated production index is stale for the current recipe manifest; run assets:prepare");
  }
  const recipes = new Map(manifest.recipes.map((recipe) => [recipe.id, recipe]));
  const entries = new Map();
  for (const raw of value.entries) {
    if (!isRecord(raw) || typeof raw.id !== "string" || entries.has(raw.id)) {
      throw new ProductionAssetPromotionError("Generated production index contains an invalid or repeated candidate ID");
    }
    const recipe = recipes.get(raw.id);
    if (!recipe || recipe.lifecycle === "runtime" || recipe.lifecycle === "reference") {
      throw new ProductionAssetPromotionError(`Generated candidate ${raw.id} has no preparable recipe`);
    }
    if (!Array.isArray(raw.layers) || raw.layers.length === 0) {
      throw new ProductionAssetPromotionError(`Generated candidate ${raw.id} has no layers`);
    }
    const layerIds = new Set();
    const layers = raw.layers.map((layer) => {
      if (
        !isRecord(layer)
        || typeof layer.id !== "string"
        || layerIds.has(layer.id)
        || !Number.isInteger(layer.width)
        || layer.width < 1
        || !Number.isInteger(layer.height)
        || layer.height < 1
      ) {
        throw new ProductionAssetPromotionError(`Generated candidate ${raw.id} contains an invalid layer`);
      }
      layerIds.add(layer.id);
      return {
        id: layer.id,
        file: repositoryFile(layer.file, `${raw.id} layer file`),
        width: layer.width,
        height: layer.height,
        sha256: fingerprint(layer.sha256, `${raw.id} layer hash`),
      };
    });
    entries.set(raw.id, {
      id: raw.id,
      family: raw.family,
      jobKey: fingerprint(raw.jobKey, `${raw.id} job key`),
      sourceFiles: Array.isArray(raw.sourceFiles)
        ? raw.sourceFiles.map((file) => repositoryFile(file, `${raw.id} source file`))
        : [],
      layers,
      thumbnailFile: repositoryFile(raw.thumbnailFile, `${raw.id} thumbnail file`),
      collisionDraftFile: repositoryFile(raw.collisionDraftFile, `${raw.id} collision draft file`),
      runtimeBinding: raw.runtimeBinding,
    });
  }
  return entries;
}

async function readJson(filename, label) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProductionAssetPromotionError(`${label} is not valid JSON`);
    throw error;
  }
}

async function readOptional(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function absoluteRepositoryFile(repositoryRoot, filename) {
  const resolved = path.resolve(repositoryRoot, ...filename.split("/"));
  const prefix = `${path.resolve(repositoryRoot)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new ProductionAssetPromotionError(`${filename} escapes the repository`);
  return resolved;
}

function publicSlug(recipeId) {
  return recipeId.replaceAll(".", "-");
}

async function referenceBenchmark(repositoryRoot) {
  const directory = path.join(repositoryRoot, "assets-src", "gr1", "island-examples");
  let filenames;
  try {
    filenames = (await readdir(directory)).filter((filename) => filename.toLowerCase().endsWith(".png")).sort();
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") filenames = [];
    else throw error;
  }
  let sourceBytes = 0;
  for (const filename of filenames) sourceBytes += (await stat(path.join(directory, filename))).size;
  return { count: filenames.length, sourceBytes };
}

async function candidateArtifacts(repositoryRoot, recipe, entry) {
  const reportFile = path.posix.join(path.posix.dirname(entry.collisionDraftFile), "preparation-report.json");
  const report = await readJson(
    absoluteRepositoryFile(repositoryRoot, reportFile),
    `${entry.id} preparation report`,
  );
  if (
    report.pipelineVersion !== PRODUCTION_PREPARATION_PIPELINE_VERSION
    || report.recipeId !== entry.id
    || report.jobKey !== entry.jobKey
    || !isRecord(report.outputs)
  ) {
    throw new ProductionAssetPromotionError(`${entry.id} preparation report is stale for its candidate`);
  }
  const recipeHash = sha256(Buffer.from(canonicalJson(recipe), "utf8"));
  if (report.recipeHash !== recipeHash) {
    throw new ProductionAssetPromotionError(`${entry.id} preparation report is stale for its current recipe`);
  }
  if (!Array.isArray(report.sources)) {
    throw new ProductionAssetPromotionError(`${entry.id} preparation report has no source lineage`);
  }
  const sources = [];
  const jobSources = [];
  for (const source of report.sources) {
    if (typeof source?.layerId !== "string" || source.layerId.length === 0) {
      throw new ProductionAssetPromotionError(`${entry.id} reported source has no layer identity`);
    }
    const file = repositoryFile(source?.file, `${entry.id} reported source file`);
    const sourceHash = fingerprint(source?.sha256, `${entry.id} reported source hash`);
    const bytes = await readFile(absoluteRepositoryFile(repositoryRoot, file));
    if (sha256(bytes) !== sourceHash) {
      throw new ProductionAssetPromotionError(`${entry.id} source ${file} changed after preparation`);
    }
    sources.push({ file, sha256: sourceHash });
    jobSources.push({ layerId: source.layerId, file, sha256: sourceHash });
  }
  const expectedJobKey = sha256(Buffer.from(canonicalJson({
    pipelineVersion: PRODUCTION_PREPARATION_PIPELINE_VERSION,
    recipeHash,
    sourceHashes: jobSources,
  }), "utf8"));
  if (expectedJobKey !== entry.jobKey) {
    throw new ProductionAssetPromotionError(`${entry.id} candidate fingerprint is stale for its current recipe or sources`);
  }
  if (canonicalJson(sources.map(({ file }) => file)) !== canonicalJson(entry.sourceFiles)) {
    throw new ProductionAssetPromotionError(`${entry.id} source lineage disagrees with its generated index`);
  }
  const layers = [];
  for (const layer of entry.layers) {
    const bytes = await readFile(absoluteRepositoryFile(repositoryRoot, layer.file));
    if (sha256(bytes) !== layer.sha256) {
      throw new ProductionAssetPromotionError(`${entry.id} layer ${layer.id} is stale; run assets:prepare`);
    }
    const reportedLayer = Array.isArray(report.outputs.layers)
      ? report.outputs.layers.find((output) => output.id === layer.id)
      : undefined;
    if (reportedLayer?.file !== layer.file || reportedLayer.sha256 !== layer.sha256) {
      throw new ProductionAssetPromotionError(`${entry.id} layer ${layer.id} disagrees with its preparation report`);
    }
    layers.push({ ...layer, bytes });
  }
  const thumbnailBytes = await readFile(absoluteRepositoryFile(repositoryRoot, entry.thumbnailFile));
  if (
    report.outputs.thumbnail?.file !== entry.thumbnailFile
    || report.outputs.thumbnail.sha256 !== sha256(thumbnailBytes)
  ) {
    throw new ProductionAssetPromotionError(`${entry.id} thumbnail is stale for its preparation report`);
  }
  const collisionBytes = await readFile(absoluteRepositoryFile(repositoryRoot, entry.collisionDraftFile));
  let collisionDraft;
  try {
    collisionDraft = JSON.parse(collisionBytes.toString("utf8"));
  } catch {
    throw new ProductionAssetPromotionError(`${entry.id} collision draft is not valid JSON`);
  }
  if (collisionDraft.recipeId !== entry.id || collisionDraft.candidateFingerprint !== entry.jobKey) {
    throw new ProductionAssetPromotionError(`${entry.id} collision draft is stale for its candidate`);
  }
  if (
    report.outputs.collisionDraft?.file !== entry.collisionDraftFile
    || report.outputs.collisionDraft.sha256 !== sha256(collisionBytes)
  ) {
    throw new ProductionAssetPromotionError(`${entry.id} collision draft disagrees with its preparation report`);
  }
  return {
    sources,
    layers,
    thumbnailBytes,
    collisionDraft,
    collisionDraftSha256: sha256(collisionBytes),
  };
}

function exactPreserveBinding(recipe, entry) {
  const binding = recipe.runtimeBinding;
  if (!binding || binding.collisionIntent !== "preserve") {
    throw new ProductionAssetPromotionError(`${recipe.id} cannot be promoted without a collision-preserving runtime binding`);
  }
  if (
    !isRecord(entry.runtimeBinding)
    || entry.runtimeBinding.assetId !== binding.assetId
    || entry.runtimeBinding.collisionIntent !== "preserve"
  ) {
    throw new ProductionAssetPromotionError(`${recipe.id} generated runtime binding is stale or incompatible`);
  }
  return binding;
}

async function createPromotionPlan(repositoryRoot, selectedId) {
  const gr3 = path.join(repositoryRoot, "assets-src", "gr3");
  const [manifestInput, indexInput, reviewsInput, benchmark] = await Promise.all([
    readJson(path.join(gr3, "production-recipes.json"), "Production recipe manifest"),
    readJson(path.join(gr3, "generated", "production-index.json"), "Generated production index"),
    readJson(path.join(gr3, "reviews.json"), "Production review store"),
    referenceBenchmark(repositoryRoot),
  ]);
  const manifest = validateProductionAssetRecipeManifest(manifestInput);
  const entries = validateIndex(indexInput, manifest);
  const reviews = validateProductionReviewStore(reviewsInput);
  const recipes = new Map(manifest.recipes.map((recipe) => [recipe.id, recipe]));
  const decisions = new Map(reviews.decisions.map((decision) => [decision.recipeId, decision]));

  for (const decision of reviews.decisions) {
    const entry = entries.get(decision.recipeId);
    if (!entry) throw new ProductionAssetPromotionError(`Review decision names missing candidate ${decision.recipeId}`);
    if (decision.candidateFingerprint !== entry.jobKey) {
      throw new ProductionAssetPromotionError(`Review decision for ${decision.recipeId} is stale; review the current candidate again`);
    }
  }
  if (selectedId !== undefined) {
    const selected = entries.get(selectedId);
    if (!selected) throw new ProductionAssetPromotionError(`No prepared candidate matches ${selectedId}`);
    if (decisions.get(selectedId)?.decision !== "approved") {
      throw new ProductionAssetPromotionError(`${selectedId} must be approved before promotion`);
    }
  }

  const publicRoot = path.join(repositoryRoot, "public", "assets", "gr3", "production");
  const outputManifestPath = path.join(publicRoot, "production-assets.json");
  const summaryPath = path.join(gr3, "generated", "promotion-summary.json");
  const changes = [];
  const expectedPublicFiles = new Set([outputManifestPath]);
  const publicEntries = [];
  const queue = [];
  let thumbnailBytes = 0;
  let maxSelectedDecodedBytes = 0;
  let promotedPayloadBytes = 0;

  for (const entry of [...entries.values()].sort((left, right) => left.id.localeCompare(right.id, "en"))) {
    const recipe = recipes.get(entry.id);
    const artifacts = await candidateArtifacts(repositoryRoot, recipe, entry);
    thumbnailBytes += artifacts.thumbnailBytes.length;
    maxSelectedDecodedBytes = Math.max(
      maxSelectedDecodedBytes,
      entry.layers.reduce((total, layer) => total + layer.width * layer.height * 4, 0),
    );
    const reviewState = decisions.get(entry.id)?.decision ?? "pending";
    const promotionState = reviewState === "approved"
      ? "published"
      : reviewState === "rejected" ? "excluded" : "waiting-for-review";
    queue.push({
      id: entry.id,
      family: recipe.family,
      candidateFingerprint: entry.jobKey,
      reviewState,
      promotionState,
    });
    if (reviewState !== "approved") continue;

    const binding = exactPreserveBinding(recipe, entry);
    const directory = path.posix.join("assets/gr3/production", publicSlug(entry.id));
    const publicLayers = artifacts.layers.map((layer) => {
      const url = `/${path.posix.join(directory, `${layer.id}.png`)}`;
      const targetPath = path.join(repositoryRoot, "public", ...url.slice(1).split("/"));
      changes.push({ targetPath, bytes: layer.bytes });
      expectedPublicFiles.add(targetPath);
      promotedPayloadBytes += layer.bytes.length;
      return {
        id: layer.id,
        url,
        width: layer.width,
        height: layer.height,
        sha256: layer.sha256,
      };
    });
    const thumbnailUrl = `/${path.posix.join(directory, "thumbnail.png")}`;
    const thumbnailTarget = path.join(repositoryRoot, "public", ...thumbnailUrl.slice(1).split("/"));
    changes.push({ targetPath: thumbnailTarget, bytes: artifacts.thumbnailBytes });
    expectedPublicFiles.add(thumbnailTarget);
    promotedPayloadBytes += artifacts.thumbnailBytes.length;
    publicEntries.push({
      id: entry.id,
      name: recipe.name,
      family: recipe.family,
      candidateFingerprint: entry.jobKey,
      sources: artifacts.sources,
      layers: publicLayers,
      thumbnailUrl,
      runtimeBinding: binding,
      collision: {
        mode: "preserve-runtime",
        runtimeAssetId: binding.assetId,
        candidateDraftFile: entry.collisionDraftFile,
        candidateDraftSha256: artifacts.collisionDraftSha256,
        candidateDraftPromoted: false,
      },
    });
  }

  const outputManifest = {
    formatVersion: PRODUCTION_PROMOTION_FORMAT_VERSION,
    pipelineVersion: PRODUCTION_PROMOTION_PIPELINE_VERSION,
    entries: publicEntries,
  };
  const counts = {
    candidates: queue.length,
    approved: queue.filter((entry) => entry.reviewState === "approved").length,
    rejected: queue.filter((entry) => entry.reviewState === "rejected").length,
    pending: queue.filter((entry) => entry.reviewState === "pending").length,
    published: publicEntries.length,
  };
  const budgets = {
    referenceIslandCount: {
      value: benchmark.count,
      minimum: MINIMUM_REFERENCE_ISLANDS,
      passed: benchmark.count >= MINIMUM_REFERENCE_ISLANDS,
    },
    candidateThumbnailPayloadBytes: {
      value: thumbnailBytes,
      maximum: MAX_THUMBNAIL_PAYLOAD_BYTES,
      passed: thumbnailBytes <= MAX_THUMBNAIL_PAYLOAD_BYTES,
    },
    maxSelectedCandidateDecodedBytes: {
      value: maxSelectedDecodedBytes,
      maximum: MAX_SELECTED_DECODED_BYTES,
      passed: maxSelectedDecodedBytes <= MAX_SELECTED_DECODED_BYTES,
    },
  };
  const summary = {
    formatVersion: PRODUCTION_PROMOTION_FORMAT_VERSION,
    pipelineVersion: PRODUCTION_PROMOTION_PIPELINE_VERSION,
    manifestSha256: productionManifestFingerprint(manifest),
    counts,
    queue,
    evidence: {
      referenceIslandSourceCount: benchmark.count,
      referenceIslandSourceBytes: benchmark.sourceBytes,
      preparedCandidateCount: entries.size,
      candidateThumbnailBytes: thumbnailBytes,
      maxSelectedCandidateDecodedBytes: maxSelectedDecodedBytes,
      promotedPayloadBytes,
    },
    budgets: {
      ...budgets,
      passed: Object.values(budgets).every((budget) => budget.passed),
    },
  };
  if (!summary.budgets.passed) {
    throw new ProductionAssetPromotionError("Production readiness budgets failed; inspect the generated promotion summary inputs");
  }
  changes.push({ targetPath: outputManifestPath, bytes: jsonBytes(outputManifest) });
  changes.push({ targetPath: summaryPath, bytes: jsonBytes(summary) });
  return { changes, expectedPublicFiles, outputManifestPath, summaryPath, outputManifest, summary };
}

async function listFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(filename));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

async function verifyChangedFiles(plan) {
  for (const change of plan.changes) {
    const current = await readOptional(change.targetPath);
    if (!current?.equals(change.bytes)) {
      throw new ProductionAssetPromotionError(
        `${path.basename(change.targetPath)} is stale; run npm.cmd run assets:promote`,
      );
    }
  }
}

async function verifyPlan(plan) {
  await verifyChangedFiles(plan);
  const publicFiles = await listFiles(path.dirname(plan.outputManifestPath));
  const unexpected = publicFiles.filter((filename) => !plan.expectedPublicFiles.has(filename));
  if (unexpected.length > 0) {
    throw new ProductionAssetPromotionError(`Stale public production output: ${unexpected[0]}`);
  }
}

async function removeUnexpectedPublicFiles(plan) {
  const publicFiles = await listFiles(path.dirname(plan.outputManifestPath));
  const unexpected = publicFiles.filter((filename) => !plan.expectedPublicFiles.has(filename));
  await Promise.all(unexpected.map((filename) => rm(filename, { force: true })));
}

export async function runProductionPromotion(
  command,
  { repositoryRoot = moduleRoot, selectedId } = {},
) {
  if (command !== "promote" && command !== "check") {
    throw new TypeError("Production promotion command must be promote or check");
  }
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  return withCollisionIntakeLock(repositoryRoot, async () => {
    const plan = await createPromotionPlan(repositoryRoot, selectedId);
    if (command === "check") await verifyPlan(plan);
    else {
      await commitAtomicFileTransaction(plan.changes, () => verifyChangedFiles(plan));
      await removeUnexpectedPublicFiles(plan);
      await verifyPlan(plan);
    }
    return plan.summary;
  });
}

function optionValue(args, name) {
  const equals = args.find((argument) => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = "promote", ...args] = process.argv.slice(2);
  const selectedId = optionValue(args, "--id");
  const expectedArgs = selectedId === undefined ? [] : args.some((argument) => argument.startsWith("--id="))
    ? [`--id=${selectedId}`]
    : ["--id", selectedId];
  if ((command !== "promote" && command !== "check") || JSON.stringify(args) !== JSON.stringify(expectedArgs)) {
    throw new Error("Usage: production-asset-promotion.mjs <promote|check> [--id RECIPE_ID]");
  }
  const summary = await runProductionPromotion(command, { selectedId });
  console.log(
    `${command === "promote" ? "published" : "verified"}: ${summary.counts.published} approved; `
    + `${summary.counts.pending} pending; ${summary.counts.rejected} rejected`,
  );
}
