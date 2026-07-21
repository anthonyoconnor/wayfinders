import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  availableAuthoredIslandCatalog,
  buildAssetLibraryCatalog,
} from "../src/wayfinders/assets/AssetLibraryCatalog.ts";

/**
 * Reads the island availability and prepared collision inputs from disk for one
 * repository transaction. This deliberately bypasses the browser module's
 * eager JSON/import-glob snapshots.
 */
export async function readFreshAvailableAuthoredIslandCatalog(repositoryRoot) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  const gr3Root = path.join(repositoryRoot, "assets-src", "gr3");
  const manifest = await readJson(
    path.join(gr3Root, "production-recipes.json"),
    "Production recipe manifest",
  );
  const index = await readJson(
    path.join(gr3Root, "generated", "production-index.json"),
    "Generated production index",
  );
  const reviews = await readJson(path.join(gr3Root, "reviews.json"), "Production review store");

  const sourceImages = Object.create(null);
  for (const recipe of arrayField(manifest, "recipes", "Production recipe manifest")) {
    for (const layer of arrayField(recipe, "layers", `Production recipe ${String(recipe?.id ?? "unknown")}`)) {
      if (typeof layer?.sourceFile === "string") sourceImages[layer.sourceFile] = `/${layer.sourceFile}`;
    }
  }

  const candidateImages = Object.create(null);
  const collisionDrafts = Object.create(null);
  for (const entry of arrayField(index, "entries", "Generated production index")) {
    const label = `Generated production entry ${String(entry?.id ?? "unknown")}`;
    for (const layer of arrayField(entry, "layers", label)) {
      if (typeof layer?.file === "string") candidateImages[layer.file] = `/${layer.file}`;
    }
    if (typeof entry?.thumbnailFile === "string") {
      candidateImages[entry.thumbnailFile] = `/${entry.thumbnailFile}`;
    }
    if (typeof entry?.collisionDraftFile !== "string") {
      throw new TypeError(`${label} requires collisionDraftFile`);
    }
    const collisionPath = resolveRepositoryFile(
      repositoryRoot,
      entry.collisionDraftFile,
      `${label}.collisionDraftFile`,
    );
    collisionDrafts[entry.collisionDraftFile] = await readJson(collisionPath, `${label} collision draft`);
  }

  const entries = buildAssetLibraryCatalog({}, {
    productionRecipeManifest: manifest,
    productionIndex: index,
    productionReviews: reviews,
    productionSourceImages: sourceImages,
    productionCandidateImages: candidateImages,
    productionCollisionDrafts: collisionDrafts,
  });
  return availableAuthoredIslandCatalog(entries);
}

async function readJson(filename, label) {
  let source;
  try {
    source = await readFile(filename, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read: ${errorMessage(error)}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function arrayField(value, field, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const result = value[field];
  if (!Array.isArray(result)) throw new TypeError(`${label}.${field} must be an array`);
  return result;
}

function resolveRepositoryFile(repositoryRoot, relativeFile, label) {
  const portable = relativeFile.replaceAll("\\", "/");
  if (
    portable.startsWith("/")
    || /^[a-z]:/iu.test(portable)
    || portable.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new RangeError(`${label} must be a safe repository-relative path`);
  }
  const resolved = path.resolve(repositoryRoot, ...portable.split("/"));
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new RangeError(`${label} resolves outside the repository`);
  }
  return resolved;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
