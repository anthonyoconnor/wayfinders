import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateProductionCandidateIdentityRequest,
} from "../src/wayfinders/assets/ProductionCandidateAuthoring.ts";
import { runProductionPromotion } from "./production-asset-promotion.mjs";
import { validateProductionReviewStore } from "./production-asset-review.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class ProductionCandidatePromotionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionCandidatePromotionError";
  }
}

async function readJson(filename, label) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProductionCandidatePromotionError(`${label} is not valid JSON`);
    throw error;
  }
}

function currentIndexEntry(index, recipeId) {
  if (typeof index !== "object" || index === null || index.formatVersion !== 1 || !Array.isArray(index.entries)) {
    throw new ProductionCandidatePromotionError("Generated production index is not a formatVersion 1 index");
  }
  const entries = index.entries.filter((entry) => entry?.id === recipeId);
  if (entries.length !== 1 || typeof entries[0].jobKey !== "string") {
    throw new ProductionCandidatePromotionError(`${recipeId} does not have one current prepared candidate`);
  }
  return entries[0];
}

export function createProductionCandidatePromoter({
  repositoryRoot = moduleRoot,
  promote = (recipeId) => runProductionPromotion("promote", { repositoryRoot, selectedId: recipeId }),
} = {}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  if (typeof promote !== "function") throw new TypeError("promote must be a function");
  const gr3 = path.join(repositoryRoot, "assets-src", "gr3");

  return async (input) => {
    const request = validateProductionCandidateIdentityRequest(input);
    const [manifestInput, index, reviewsInput] = await Promise.all([
      readJson(path.join(gr3, "production-recipes.json"), "Production recipe manifest"),
      readJson(path.join(gr3, "generated", "production-index.json"), "Generated production index"),
      readJson(path.join(gr3, "reviews.json"), "Production review store"),
    ]);
    const recipe = Array.isArray(manifestInput?.recipes)
      ? manifestInput.recipes.find((candidate) => candidate?.id === request.recipeId)
      : undefined;
    if (recipe?.family === "island") {
      throw new ProductionCandidatePromotionError(
        `${request.recipeId} uses Available in game instead of promotion`,
      );
    }
    const entry = currentIndexEntry(index, request.recipeId);
    if (entry.jobKey !== request.candidateFingerprint) {
      throw new ProductionCandidatePromotionError(
        `Stale candidate fingerprint for ${request.recipeId}; refresh before promotion`,
      );
    }
    const reviews = validateProductionReviewStore(reviewsInput);
    const decision = reviews.decisions.find((candidate) => candidate.recipeId === request.recipeId);
    if (decision && decision.candidateFingerprint !== request.candidateFingerprint) {
      throw new ProductionCandidatePromotionError(
        `Review decision for ${request.recipeId} is stale; review the current candidate again`,
      );
    }
    if (decision?.decision !== "approved") {
      throw new ProductionCandidatePromotionError(`${request.recipeId} must be currently approved`);
    }

    const summary = await promote(request.recipeId);
    const selected = Array.isArray(summary?.queue)
      ? summary.queue.find((candidate) => candidate.id === request.recipeId)
      : undefined;
    if (
      selected?.candidateFingerprint !== request.candidateFingerprint
      || selected.promotionState !== "published"
    ) {
      throw new ProductionCandidatePromotionError(
        `${request.recipeId} promotion did not publish the requested current fingerprint`,
      );
    }
    return {
      recipeId: request.recipeId,
      candidateFingerprint: request.candidateFingerprint,
      promotionState: "published",
      counts: summary.counts,
      message: `${request.recipeId} published for its current approved fingerprint`,
    };
  };
}
