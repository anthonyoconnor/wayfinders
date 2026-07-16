import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  validateProductionAssetIntakeRequest,
  ProductionAssetIntakeValidationError,
} from "../src/wayfinders/assets/ProductionAssetIntake.ts";
import {
  validateProductionAssetRecipeManifest,
} from "../src/wayfinders/assets/ProductionAssetRecipe.ts";
import { decodePng } from "./asset-pipeline.mjs";
import { prepareProductionRecipe } from "./production-asset-pipeline.mjs";
import {
  commitAtomicFileTransaction,
  withCollisionIntakeLock,
} from "./repository-collision-transaction.mjs";

const RUNTIME_BINDINGS = Object.freeze({
  "home-island": "home.island.primary",
  "player-boat": "player.boat.primary",
  "fishing-shoal": "shoal.fishing.primary",
});

export class ProductionAssetIntakeCancelledError extends Error {
  constructor() {
    super("Production asset intake was cancelled");
    this.name = "ProductionAssetIntakeCancelledError";
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function optionalBytes(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(filename) {
  try {
    await stat(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertNotCancelled(signal) {
  if (signal?.aborted) throw new ProductionAssetIntakeCancelledError();
}

function sourceBytes(request, repositoryRoot) {
  if (request.source.kind === "upload") return Promise.resolve(Buffer.from(request.source.pngBase64, "base64"));
  return readFile(path.join(repositoryRoot, request.source.repositoryPath));
}

function preparationFor(image, request) {
  let hasTransparency = false;
  for (let offset = 3; offset < image.pixels.length; offset += 4) {
    if (image.pixels[offset] < 255) {
      hasTransparency = true;
      break;
    }
  }
  const common = {
    sizing: request.canvasSizing === "native" ? "native" : "contain",
    targetWidth: request.targetWidth,
    targetHeight: request.targetHeight,
    thumbnailMaximum: 192,
  };
  if (hasTransparency) return { mode: "preserve", ...common };
  return {
    mode: "connected-border",
    ...common,
    matteColor: [image.pixels[0], image.pixels[1], image.pixels[2]],
    innerTolerance: 32,
    outerTolerance: 80,
    trimAlphaThreshold: 8,
    padding: 8,
  };
}

function uniqueTags(request) {
  return [...new Set([
    request.family,
    ...request.id.split(/[.-]/u).filter((part) => part !== "production"),
    "source",
  ])];
}

function buildRecipe(request, image, sourceFile, manifest) {
  const sameFamily = manifest.recipes.filter((recipe) => recipe.family === request.family);
  const sortOrder = Math.max(0, ...sameFamily.map((recipe) => recipe.sortOrder)) + 10;
  const runtimeAssetId = RUNTIME_BINDINGS[request.runtimeCategory];
  return {
    id: request.id,
    name: request.name,
    family: request.family,
    lifecycle: "source",
    collection: `${request.family.replace("-", " ")} production sources`,
    sortOrder,
    tags: uniqueTags(request),
    provenance: { kind: "selected-source", sourceFile },
    layers: [{
      id: "base",
      name: request.layerRole === "effect" ? "Visual effect" : "Base visual",
      role: request.layerRole,
      sourceFile,
      defaultVisible: true,
      opacity: 1,
      blendMode: request.layerRole === "effect" ? "screen" : "normal",
      preparation: preparationFor(image, request),
    }],
    animations: [],
    collision: request.collisionSemantics === "passable"
      ? { mode: "empty", reason: `The ${request.family} family is explicitly passable` }
      : request.family === "island"
        ? { mode: "shoreline-seed", tileSize: 32, subcellSize: 8 }
        : { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
    ...(runtimeAssetId ? {
      runtimeBinding: { assetId: runtimeAssetId, collisionIntent: "preserve" },
    } : {}),
  };
}

function identityError(field, message) {
  return new ProductionAssetIntakeValidationError({ [field]: message });
}

export function createProductionAssetIntaker({
  repositoryRoot,
  prepareRecipe = (recipe) => prepareProductionRecipe(recipe),
} = {}) {
  if (!path.isAbsolute(repositoryRoot ?? "")) throw new TypeError("repositoryRoot must be absolute");
  const manifestPath = path.join(repositoryRoot, "assets-src", "gr3", "production-recipes.json");
  const generatedIndexPath = path.join(repositoryRoot, "assets-src", "gr3", "generated", "production-index.json");

  return async (input, { signal, onProgress = () => undefined } = {}) => {
    onProgress("validating", "Validating source and recipe fields");
    const request = validateProductionAssetIntakeRequest(input);
    assertNotCancelled(signal);
    const bytes = await sourceBytes(request, repositoryRoot);
    if (bytes.length > 32 * 1_048_576) throw identityError("source", "PNG files may not exceed 32 MiB");
    let image;
    try {
      image = decodePng(bytes, request.source.kind === "upload" ? request.source.fileName : request.source.repositoryPath);
    } catch (error) {
      throw identityError("source", error instanceof Error ? error.message : "The source is not a valid PNG");
    }
    assertNotCancelled(signal);

    return withCollisionIntakeLock(repositoryRoot, async () => {
      const manifest = validateProductionAssetRecipeManifest(JSON.parse(await readFile(manifestPath, "utf8")));
      if (manifest.recipes.some((recipe) => recipe.id === request.id)) {
        throw identityError("id", `Stable ID ${request.id} already exists; choose a new ID`);
      }
      const sourceFile = `assets-src/gr3/intake/${request.id.replaceAll(".", "-")}-source.png`;
      const sourcePath = path.join(repositoryRoot, sourceFile);
      const candidateDirectory = path.join(
        repositoryRoot,
        "assets-src",
        "gr3",
        "candidates",
        request.id.replaceAll(".", "-"),
      );
      if (await exists(sourcePath) || await exists(candidateDirectory)) {
        throw identityError("id", `Repository output for ${request.id} already exists and will not be overwritten`);
      }
      const recipe = buildRecipe(request, image, sourceFile, manifest);
      const updatedManifest = validateProductionAssetRecipeManifest({
        formatVersion: manifest.formatVersion,
        recipes: [...manifest.recipes, recipe],
      });
      const originalIndex = await optionalBytes(generatedIndexPath);
      assertNotCancelled(signal);
      onProgress("writing", "Creating the stable source and recipe transaction");
      try {
        await commitAtomicFileTransaction([
          { targetPath: sourcePath, bytes },
          { targetPath: manifestPath, bytes: jsonBytes(updatedManifest) },
        ], async () => {
          assertNotCancelled(signal);
          onProgress("preparing", "Preparing candidate layers, thumbnail, and collision semantics");
          await prepareRecipe(updatedManifest.recipes.at(-1), { signal });
          assertNotCancelled(signal);
        });
      } catch (error) {
        await rm(candidateDirectory, { recursive: true, force: true });
        if (originalIndex) {
          await commitAtomicFileTransaction([{ targetPath: generatedIndexPath, bytes: originalIndex }]);
        } else {
          await rm(generatedIndexPath, { force: true });
        }
        throw error;
      }
      onProgress("completed", "Pending candidate created");
      return {
        recipeId: request.id,
        message: `${request.name} is prepared as one stable pending candidate`,
      };
    });
  };
}
