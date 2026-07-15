import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitAtomicFileTransaction,
  withCollisionIntakeLock,
} from "./repository-collision-transaction.mjs";

export const PRODUCTION_REVIEW_FORMAT_VERSION = 1;
export const PRODUCTION_REVIEW_DECISIONS = Object.freeze(["approved", "rejected"]);

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fingerprintPattern = /^[a-f0-9]{64}$/u;

export class ProductionAssetReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionAssetReviewError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain only ${expected.join(", ")}`);
  }
}

function validateRecipeId(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("Review recipeId must be a non-empty exact recipe ID");
  }
  return value;
}

function validateCandidateFingerprint(value) {
  if (typeof value !== "string" || !fingerprintPattern.test(value)) {
    throw new TypeError("Review candidateFingerprint must be a 64-character lowercase SHA-256 fingerprint");
  }
  return value;
}

function validateDecision(value) {
  if (!PRODUCTION_REVIEW_DECISIONS.includes(value)) {
    throw new TypeError("Review decision must be approved or rejected");
  }
  return value;
}

export function validateProductionReviewRequest(value) {
  if (!isRecord(value)) throw new TypeError("Review request must be a JSON object");
  assertExactKeys(value, ["recipeId", "candidateFingerprint", "decision"], "Review request");
  return {
    recipeId: validateRecipeId(value.recipeId),
    candidateFingerprint: validateCandidateFingerprint(value.candidateFingerprint),
    decision: validateDecision(value.decision),
  };
}

function compareDecisions(left, right) {
  return left.recipeId.localeCompare(right.recipeId, "en")
    || left.candidateFingerprint.localeCompare(right.candidateFingerprint, "en");
}

export function validateProductionReviewStore(value) {
  if (!isRecord(value)) throw new TypeError("Production review store must be a JSON object");
  assertExactKeys(value, ["formatVersion", "decisions"], "Production review store");
  if (value.formatVersion !== PRODUCTION_REVIEW_FORMAT_VERSION) {
    throw new RangeError(`Production review store formatVersion must be ${PRODUCTION_REVIEW_FORMAT_VERSION}`);
  }
  if (!Array.isArray(value.decisions)) throw new TypeError("Production review store decisions must be an array");

  const decisions = value.decisions.map((decision) => validateProductionReviewRequest(decision));
  const recipeIds = new Set();
  for (const decision of decisions) {
    if (recipeIds.has(decision.recipeId)) {
      throw new RangeError(`Production review store has more than one decision for ${decision.recipeId}`);
    }
    recipeIds.add(decision.recipeId);
  }
  decisions.sort(compareDecisions);
  return { formatVersion: PRODUCTION_REVIEW_FORMAT_VERSION, decisions };
}

function validateRecipeManifest(value) {
  if (!isRecord(value) || value.formatVersion !== 1 || !Array.isArray(value.recipes)) {
    throw new ProductionAssetReviewError("Production recipe manifest is not a supported formatVersion 1 manifest");
  }
  const ids = new Set();
  for (const recipe of value.recipes) {
    if (!isRecord(recipe) || typeof recipe.id !== "string" || recipe.id.length === 0) {
      throw new ProductionAssetReviewError("Production recipe manifest contains a recipe without an ID");
    }
    if (ids.has(recipe.id)) throw new ProductionAssetReviewError(`Production recipe manifest repeats ${recipe.id}`);
    ids.add(recipe.id);
  }
  return ids;
}

function validateProductionIndex(value) {
  if (!isRecord(value) || value.formatVersion !== 1 || !Array.isArray(value.entries)) {
    throw new ProductionAssetReviewError("Generated production index is not a supported formatVersion 1 index");
  }
  const entries = new Map();
  for (const entry of value.entries) {
    if (
      !isRecord(entry)
      || typeof entry.id !== "string"
      || entry.id.length === 0
      || typeof entry.jobKey !== "string"
      || !fingerprintPattern.test(entry.jobKey)
    ) {
      throw new ProductionAssetReviewError("Generated production index contains an invalid candidate entry");
    }
    if (entries.has(entry.id)) throw new ProductionAssetReviewError(`Generated production index repeats ${entry.id}`);
    entries.set(entry.id, entry);
  }
  return entries;
}

async function readJson(filename, label) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProductionAssetReviewError(`${label} is not valid JSON`);
    throw error;
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function reviewProductionCandidateUnlocked(request, repositoryRoot) {
  const recipePath = path.join(repositoryRoot, "assets-src", "gr3", "production-recipes.json");
  const indexPath = path.join(repositoryRoot, "assets-src", "gr3", "generated", "production-index.json");
  const reviewPath = path.join(repositoryRoot, "assets-src", "gr3", "reviews.json");
  const [manifestValue, indexValue, storeValue] = await Promise.all([
    readJson(recipePath, "Production recipe manifest"),
    readJson(indexPath, "Generated production index"),
    readJson(reviewPath, "Production review store"),
  ]);
  const recipeIds = validateRecipeManifest(manifestValue);
  const candidates = validateProductionIndex(indexValue);
  const store = validateProductionReviewStore(storeValue);

  if (!recipeIds.has(request.recipeId)) {
    throw new ProductionAssetReviewError(`Unknown production recipe ${request.recipeId}`);
  }
  const candidate = candidates.get(request.recipeId);
  if (!candidate) {
    throw new ProductionAssetReviewError(
      `${request.recipeId} has no prepared candidate; run the production preparation pipeline first`,
    );
  }
  if (candidate.jobKey !== request.candidateFingerprint) {
    throw new ProductionAssetReviewError(
      `Stale candidate fingerprint for ${request.recipeId}; refresh the asset library before reviewing`,
    );
  }

  const nextStore = {
    formatVersion: PRODUCTION_REVIEW_FORMAT_VERSION,
    decisions: [
      ...store.decisions.filter((decision) => decision.recipeId !== request.recipeId),
      request,
    ].sort(compareDecisions),
  };
  const bytes = jsonBytes(nextStore);
  const currentBytes = jsonBytes(store);
  if (!bytes.equals(currentBytes)) {
    await commitAtomicFileTransaction(
      [{ targetPath: reviewPath, bytes }],
      async () => {
        const persisted = validateProductionReviewStore(await readJson(reviewPath, "Production review store"));
        if (!jsonBytes(persisted).equals(bytes)) {
          throw new Error("Production review store did not persist the requested decision");
        }
      },
    );
  }
  return {
    ...request,
    message: `${request.recipeId} ${request.decision} for its current candidate`,
  };
}

export async function reviewProductionCandidate(value, { repositoryRoot = moduleRoot } = {}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  const request = validateProductionReviewRequest(value);
  return withCollisionIntakeLock(
    repositoryRoot,
    () => reviewProductionCandidateUnlocked(request, repositoryRoot),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, recipeId, candidateFingerprint, ...rest] = process.argv.slice(2);
  if ((command !== "approve" && command !== "reject") || !recipeId || !candidateFingerprint || rest.length > 0) {
    throw new Error("Usage: production-asset-review.mjs <approve|reject> <recipe-id> <candidate-fingerprint>");
  }
  const result = await reviewProductionCandidate({
    recipeId,
    candidateFingerprint,
    decision: command === "approve" ? "approved" : "rejected",
  });
  console.log(result.message);
}
