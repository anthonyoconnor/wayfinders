import { readFile, readdir, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyProductionCandidateAuthoringRequest,
  productionCandidateMaskFile,
  productionCandidateMaskPixels,
  validateProductionCandidateAuthoringRequest,
  validateProductionCandidateIdentityRequest,
} from "../src/wayfinders/assets/ProductionCandidateAuthoring.ts";
import {
  validateProductionAssetRecipeManifest,
} from "../src/wayfinders/assets/ProductionAssetRecipe.ts";
import { encodePng } from "./asset-pipeline.mjs";
import { prepareProductionRecipe } from "./production-asset-pipeline.mjs";
import { validateProductionReviewStore } from "./production-asset-review.mjs";
import {
  commitAtomicFileTransaction,
  withCollisionIntakeLock,
} from "./repository-collision-transaction.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FINGERPRINT = /^[a-f0-9]{64}$/u;

export class ProductionCandidateAuthoringError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionCandidateAuthoringError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filename, label) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProductionCandidateAuthoringError(`${label} is not valid JSON`);
    throw error;
  }
}

async function optionalBytes(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function safeRepositoryPath(repositoryRoot, value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.startsWith("/")
    || /^[a-z]:/iu.test(value)
    || value.replaceAll("\\", "/").split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) throw new ProductionCandidateAuthoringError(`${label} must be a safe repository-relative path`);
  const resolved = path.resolve(repositoryRoot, ...value.replaceAll("\\", "/").split("/"));
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProductionCandidateAuthoringError(`${label} escapes the repository`);
  }
  return resolved;
}

function productionIndexEntry(index, recipeId) {
  if (!isRecord(index) || index.formatVersion !== 1 || !Array.isArray(index.entries)) {
    throw new ProductionCandidateAuthoringError("Generated production index is not a formatVersion 1 index");
  }
  const matches = index.entries.filter((entry) => isRecord(entry) && entry.id === recipeId);
  if (matches.length !== 1) {
    throw new ProductionCandidateAuthoringError(
      matches.length === 0
        ? `${recipeId} has no prepared candidate`
        : `Generated production index repeats ${recipeId}`,
    );
  }
  const entry = matches[0];
  if (typeof entry.jobKey !== "string" || !FINGERPRINT.test(entry.jobKey)) {
    throw new ProductionCandidateAuthoringError(`${recipeId} has an invalid candidate fingerprint`);
  }
  if (typeof entry.collisionDraftFile !== "string") {
    throw new ProductionCandidateAuthoringError(`${recipeId} has no collision draft file`);
  }
  return entry;
}

function recipeSettings(recipe) {
  const firstLayer = recipe.layers[0];
  if (!firstLayer) throw new ProductionCandidateAuthoringError(`${recipe.id} has no authorable layers`);
  const targetWidth = firstLayer.preparation.targetWidth;
  const targetHeight = firstLayer.preparation.targetHeight;
  if (recipe.layers.some((layer) =>
    layer.preparation.targetWidth !== targetWidth || layer.preparation.targetHeight !== targetHeight)) {
    throw new ProductionCandidateAuthoringError(`${recipe.id} layers do not share one candidate canvas`);
  }
  return {
    name: recipe.name,
    family: recipe.family,
    targetWidth,
    targetHeight,
    layers: recipe.layers.map((layer) => ({
      id: layer.id,
      defaultVisible: layer.defaultVisible,
      opacity: layer.opacity,
    })),
    runtimeBindingAssetId: recipe.runtimeBinding?.assetId ?? null,
    availableInGame: recipe.family === "island" && recipe.availableInGame === true,
  };
}

function normalizedDraft(draft, recipeId, fingerprint) {
  if (!isRecord(draft)
    || draft.formatVersion !== 1
    || draft.recipeId !== recipeId
    || draft.candidateFingerprint !== fingerprint) {
    throw new ProductionCandidateAuthoringError(`${recipeId} collision draft is stale for its candidate`);
  }
  if (draft.kind === "empty") {
    if (draft.passable !== true || typeof draft.reason !== "string") {
      throw new ProductionCandidateAuthoringError(`${recipeId} does not have an explicitly passable collision draft`);
    }
    return {
      kind: "empty",
      passable: true,
      reason: draft.reason,
    };
  }
  if (draft.kind !== "hybrid-grid-draft" || !isRecord(draft.grid) || !Array.isArray(draft.solidSubcells)) {
    throw new ProductionCandidateAuthoringError(`${recipeId} does not have an authorable collision draft`);
  }
  return {
    kind: draft.kind,
    tileSize: draft.tileSize,
    subcellSize: draft.subcellSize,
    grid: {
      width: draft.grid.width,
      height: draft.grid.height,
      subcellColumns: draft.grid.subcellColumns,
      subcellRows: draft.grid.subcellRows,
    },
    solidSubcells: draft.solidSubcells.map((point) => ({ x: point?.x, y: point?.y })),
  };
}

async function snapshotDirectory(directory) {
  const files = [];
  async function visit(current, relativeDirectory) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT" && relativeDirectory === "") return false;
      throw error;
    }
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files.push({ relative, bytes: await readFile(absolute) });
      else throw new ProductionCandidateAuthoringError(`Candidate output contains unsupported entry ${relative}`);
    }
    return true;
  }
  const existed = await visit(directory, "");
  return { existed, files };
}

async function restoreDirectory(directory, snapshot) {
  await rm(directory, { recursive: true, force: true });
  if (!snapshot.existed) return;
  await mkdir(directory, { recursive: true });
  for (const file of snapshot.files) {
    const target = path.join(directory, file.relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
}

async function restoreOptionalFile(filename, bytes) {
  if (bytes === undefined) {
    await rm(filename, { force: true });
    return;
  }
  await commitAtomicFileTransaction([{ targetPath: filename, bytes }]);
}

function sameCollision(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createProductionCandidateAuthoringService({
  repositoryRoot = moduleRoot,
  prepareRecipe = (recipe) => prepareProductionRecipe(recipe, { force: true }),
  validateRecipe = (recipe) => prepareProductionRecipe(recipe, { checkOnly: true }),
  removePath = (targetPath, options) => rm(targetPath, options),
} = {}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  if (typeof prepareRecipe !== "function") throw new TypeError("prepareRecipe must be a function");
  if (typeof validateRecipe !== "function") throw new TypeError("validateRecipe must be a function");
  if (typeof removePath !== "function") throw new TypeError("removePath must be a function");

  const gr3 = path.join(repositoryRoot, "assets-src", "gr3");
  const manifestPath = path.join(gr3, "production-recipes.json");
  const indexPath = path.join(gr3, "generated", "production-index.json");
  const reviewsPath = path.join(gr3, "reviews.json");

  async function currentState(identity, checkPreparedOutput = true) {
    const [manifestInput, index, reviewsInput] = await Promise.all([
      readJson(manifestPath, "Production recipe manifest"),
      readJson(indexPath, "Generated production index"),
      readJson(reviewsPath, "Production review store"),
    ]);
    const manifest = validateProductionAssetRecipeManifest(manifestInput);
    const recipe = manifest.recipes.find((candidate) => candidate.id === identity.recipeId);
    if (!recipe || recipe.lifecycle !== "source") {
      throw new ProductionCandidateAuthoringError(`Unknown pending production recipe ${identity.recipeId}`);
    }
    const entry = productionIndexEntry(index, recipe.id);
    if (identity.candidateFingerprint !== entry.jobKey) {
      throw new ProductionCandidateAuthoringError(
        `Stale candidate fingerprint for ${recipe.id}; refresh the asset library before continuing`,
      );
    }
    if (checkPreparedOutput) {
      try {
        await validateRecipe(recipe);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ProductionCandidateAuthoringError(
          `Prepared output for ${recipe.id} is stale or invalid: ${message}`,
        );
      }
    }
    const collisionPath = safeRepositoryPath(
      repositoryRoot,
      entry.collisionDraftFile,
      `${recipe.id} collision draft file`,
    );
    const draft = normalizedDraft(
      await readJson(collisionPath, `${recipe.id} collision draft`),
      recipe.id,
      entry.jobKey,
    );
    const settings = recipeSettings(recipe);
    const normalized = validateProductionCandidateAuthoringRequest({
      ...identity,
      settings,
      collision: draft,
    });
    const reviews = validateProductionReviewStore(reviewsInput);
    const decision = reviews.decisions.find((candidate) =>
      candidate.recipeId === recipe.id && candidate.candidateFingerprint === entry.jobKey);
    const staleDecision = decision === undefined
      && reviews.decisions.some((candidate) => candidate.recipeId === recipe.id);
    const reviewState = decision?.decision ?? (staleDecision ? "stale" : "pending");
    return {
      recipeId: recipe.id,
      fingerprint: entry.jobKey,
      validationState: "current",
      ...(recipe.family === "island" ? {} : { reviewState }),
      ...(recipe.family === "island" ? { availableInGame: recipe.availableInGame === true } : {}),
      settings: normalized.settings,
      collision: normalized.collision,
      recipe,
    };
  }

  async function validate(input) {
    const identity = validateProductionCandidateIdentityRequest(input);
    return withCollisionIntakeLock(repositoryRoot, () => currentState(identity));
  }

  async function save(input) {
    const request = validateProductionCandidateAuthoringRequest(input);
    return withCollisionIntakeLock(repositoryRoot, async () => {
      const previous = await currentState(request);
      const [manifestInput, reviewsInput] = await Promise.all([
        readJson(manifestPath, "Production recipe manifest"),
        readJson(reviewsPath, "Production review store"),
      ]);
      const manifest = validateProductionAssetRecipeManifest(manifestInput);
      const currentRecipe = manifest.recipes.find((recipe) => recipe.id === request.recipeId);
      if (!currentRecipe) throw new ProductionCandidateAuthoringError(`Unknown production recipe ${request.recipeId}`);
      const updatedRecipe = applyProductionCandidateAuthoringRequest(currentRecipe, request);
      const updatedManifest = validateProductionAssetRecipeManifest({
        formatVersion: manifest.formatVersion,
        recipes: manifest.recipes.map((recipe) => recipe.id === request.recipeId ? updatedRecipe : recipe),
      });
      const reviews = validateProductionReviewStore(reviewsInput);
      const updatedReviews = validateProductionReviewStore({
        formatVersion: reviews.formatVersion,
        decisions: reviews.decisions.filter((decision) => decision.recipeId !== request.recipeId),
      });
      const maskPath = safeRepositoryPath(
        repositoryRoot,
        productionCandidateMaskFile(request.recipeId),
        `${request.recipeId} mask file`,
      );
      const maskBytes = request.collision.kind === "hybrid-grid-draft"
        ? (() => {
          const mask = productionCandidateMaskPixels(request);
          return encodePng(mask.width, mask.height, Buffer.from(mask.pixels));
        })()
        : undefined;
      const maskSnapshot = await optionalBytes(maskPath);
      const candidateDirectory = path.join(gr3, "candidates", request.recipeId.replaceAll(".", "-"));
      const candidateSnapshot = await snapshotDirectory(candidateDirectory);
      const indexSnapshot = await optionalBytes(indexPath);
      let refreshed;
      try {
        const transaction = [
          { targetPath: manifestPath, bytes: jsonBytes(updatedManifest) },
          { targetPath: reviewsPath, bytes: jsonBytes(updatedReviews) },
          ...(maskBytes === undefined ? [] : [{ targetPath: maskPath, bytes: maskBytes }]),
        ];
        await commitAtomicFileTransaction(transaction, async () => {
          if (maskBytes === undefined) await rm(maskPath, { force: true });
          await prepareRecipe(updatedRecipe);
          const refreshedIndex = await readJson(indexPath, "Generated production index");
          const refreshedEntry = productionIndexEntry(refreshedIndex, request.recipeId);
          if (refreshedEntry.jobKey === request.candidateFingerprint) {
            throw new ProductionCandidateAuthoringError(
              `${request.recipeId} preparation did not issue a new candidate fingerprint`,
            );
          }
          refreshed = await currentState({
            formatVersion: request.formatVersion,
            recipeId: request.recipeId,
            candidateFingerprint: refreshedEntry.jobKey,
          });
          if (JSON.stringify(refreshed.settings) !== JSON.stringify(request.settings)) {
            throw new ProductionCandidateAuthoringError(
              `${request.recipeId} prepared settings do not match the authored candidate`,
            );
          }
          if (!sameCollision(refreshed.collision, request.collision)) {
            throw new ProductionCandidateAuthoringError(
              `${request.recipeId} prepared collision does not match the authored mask`,
            );
          }
          if (updatedRecipe.family !== "island" && refreshed.reviewState !== "pending") {
            throw new ProductionCandidateAuthoringError(`${request.recipeId} review was not invalidated`);
          }
        });
      } catch (cause) {
        const rollbackErrors = [];
        try {
          await restoreDirectory(candidateDirectory, candidateSnapshot);
        } catch (error) {
          rollbackErrors.push(error);
        }
        try {
          await restoreOptionalFile(indexPath, indexSnapshot);
        } catch (error) {
          rollbackErrors.push(error);
        }
        try {
          await restoreOptionalFile(maskPath, maskSnapshot);
        } catch (error) {
          rollbackErrors.push(error);
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [cause, ...rollbackErrors],
            `Candidate authoring failed and could not fully restore ${request.recipeId}`,
          );
        }
        throw cause;
      }
      if (!refreshed) throw new Error(`${request.recipeId} save completed without refreshed candidate state`);
      return {
        ...refreshed,
        previousFingerprint: previous.fingerprint,
        message: updatedRecipe.family === "island"
          ? `${request.recipeId} saved ${updatedRecipe.availableInGame ? "and made available in game" : "as unavailable in game"}`
          : `${request.recipeId} saved and returned to pending review`,
      };
    });
  }

  async function remove(input) {
    const identity = validateProductionCandidateIdentityRequest(input);
    return withCollisionIntakeLock(repositoryRoot, async () => {
      const [manifestInput, indexInput, reviewsInput] = await Promise.all([
        readJson(manifestPath, "Production recipe manifest"),
        readJson(indexPath, "Generated production index"),
        readJson(reviewsPath, "Production review store"),
      ]);
      const manifest = validateProductionAssetRecipeManifest(manifestInput);
      const recipe = manifest.recipes.find((candidate) => candidate.id === identity.recipeId);
      if (!recipe || recipe.lifecycle !== "source" || recipe.family !== "island") {
        throw new ProductionCandidateAuthoringError(`Unknown imported island ${identity.recipeId}`);
      }
      const entry = productionIndexEntry(indexInput, recipe.id);
      if (entry.jobKey !== identity.candidateFingerprint) {
        throw new ProductionCandidateAuthoringError(
          `Stale candidate fingerprint for ${recipe.id}; refresh the asset library before deleting it`,
        );
      }
      const reviews = validateProductionReviewStore(reviewsInput);
      const candidateDirectory = path.join(gr3, "candidates", recipe.id.replaceAll(".", "-"));
      const collisionDraftPath = safeRepositoryPath(
        repositoryRoot,
        entry.collisionDraftFile,
        `${recipe.id} collision draft file`,
      );
      const collisionRelative = path.relative(candidateDirectory, collisionDraftPath);
      if (collisionRelative.startsWith("..") || path.isAbsolute(collisionRelative)) {
        throw new ProductionCandidateAuthoringError(`${recipe.id} prepared output is outside its candidate directory`);
      }

      const otherRecipeFiles = new Set(manifest.recipes
        .filter((candidate) => candidate.id !== recipe.id)
        .flatMap((candidate) => [
          candidate.provenance.sourceFile,
          ...candidate.layers.map((layer) => layer.sourceFile),
          ...(candidate.collision.mode === "mask-file" ? [candidate.collision.maskFile] : []),
        ]));
      const ownedFiles = [...new Set([
        recipe.provenance.sourceFile,
        ...recipe.layers.map((layer) => layer.sourceFile),
        ...(recipe.collision.mode === "mask-file" ? [recipe.collision.maskFile] : []),
      ])]
        .filter((filename) => !otherRecipeFiles.has(filename))
        .map((filename) => safeRepositoryPath(repositoryRoot, filename, `${recipe.id} owned file`))
        .filter((filename) => {
          const relative = path.relative(candidateDirectory, filename);
          return relative.startsWith("..") || path.isAbsolute(relative);
        });
      const candidateSnapshot = await snapshotDirectory(candidateDirectory);
      const ownedSnapshots = new Map(await Promise.all(ownedFiles.map(async (filename) =>
        [filename, await optionalBytes(filename)])));
      const updatedManifest = validateProductionAssetRecipeManifest({
        formatVersion: manifest.formatVersion,
        recipes: manifest.recipes.filter((candidate) => candidate.id !== recipe.id),
      });
      const updatedIndex = {
        ...indexInput,
        entries: indexInput.entries.filter((candidate) => candidate.id !== recipe.id),
      };
      const updatedReviews = validateProductionReviewStore({
        formatVersion: reviews.formatVersion,
        decisions: reviews.decisions.filter((decision) => decision.recipeId !== recipe.id),
      });

      try {
        await commitAtomicFileTransaction([
          { targetPath: manifestPath, bytes: jsonBytes(updatedManifest) },
          { targetPath: indexPath, bytes: jsonBytes(updatedIndex) },
          { targetPath: reviewsPath, bytes: jsonBytes(updatedReviews) },
        ], async () => {
          await removePath(candidateDirectory, { recursive: true, force: true });
          for (const filename of ownedFiles) await removePath(filename, { force: true });
          const [writtenManifest, writtenIndex, writtenReviews] = await Promise.all([
            readJson(manifestPath, "Production recipe manifest"),
            readJson(indexPath, "Generated production index"),
            readJson(reviewsPath, "Production review store"),
          ]);
          if (writtenManifest.recipes.some((candidate) => candidate.id === recipe.id)
            || writtenIndex.entries.some((candidate) => candidate.id === recipe.id)
            || writtenReviews.decisions.some((decision) => decision.recipeId === recipe.id)) {
            throw new ProductionCandidateAuthoringError(`${recipe.id} deletion did not clear every repository record`);
          }
        });
      } catch (cause) {
        const rollbackErrors = [];
        try { await restoreDirectory(candidateDirectory, candidateSnapshot); }
        catch (error) { rollbackErrors.push(error); }
        for (const [filename, bytes] of ownedSnapshots) {
          try { await restoreOptionalFile(filename, bytes); }
          catch (error) { rollbackErrors.push(error); }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [cause, ...rollbackErrors],
            `Candidate deletion failed and could not fully restore ${recipe.id}`,
          );
        }
        throw cause;
      }
      return {
        recipeId: recipe.id,
        deletedFingerprint: entry.jobKey,
        message: `${recipe.name} was permanently deleted`,
      };
    });
  }

  return Object.freeze({ validate, save, remove });
}
