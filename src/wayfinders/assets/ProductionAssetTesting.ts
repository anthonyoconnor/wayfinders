import type Phaser from "phaser";
import productionIndexJson from "../../../assets-src/gr3/generated/production-index.json";
import productionRecipesJson from "../../../assets-src/gr3/production-recipes.json";
import productionReviewsJson from "../../../assets-src/gr3/reviews.json";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredAssetId,
} from "./AuthoredAssetContracts";
import {
  validateProductionAssetRecipeManifest,
} from "./ProductionAssetRecipe";
import type { PilotAssetTextureOverride } from "./PilotAssetRuntime";

const PRODUCTION_CANDIDATE_IMAGE_URLS = import.meta.glob<string>(
  "../../../assets-src/gr3/candidates/*/*.png",
  { eager: true, query: "?url", import: "default" },
);

const TEST_IMAGE_ID_BY_RUNTIME_ASSET: Readonly<Record<AuthoredAssetId, string>> = Object.freeze({
  [AUTHORED_ASSET_IDS.homeIsland]: "home.island.primary.complete",
  [AUTHORED_ASSET_IDS.playerBoat]: "player.boat.primary.frames",
  [AUTHORED_ASSET_IDS.fishingShoal]: "shoal.fishing.primary.complete",
});

export interface ProductionAssetTestOverride extends PilotAssetTextureOverride {
  readonly recipeId: string;
  readonly recipeName: string;
  readonly candidateFingerprint: string;
  readonly url: string;
  readonly collisionNotice: string;
}

interface ProductionTestIndexEntry {
  readonly id: string;
  readonly jobKey: string;
  readonly layers: readonly Readonly<{ id: string; file: string }>[];
}

interface ProductionTestDecision {
  readonly recipeId: string;
  readonly candidateFingerprint: string;
  readonly decision: "approved" | "rejected";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseIndex(value: unknown): readonly ProductionTestIndexEntry[] {
  const parsed = record(value);
  if (parsed?.formatVersion !== 1 || !Array.isArray(parsed.entries)) return [];
  return parsed.entries.flatMap((entryInput) => {
    const entry = record(entryInput);
    if (typeof entry?.id !== "string" || typeof entry.jobKey !== "string" || !Array.isArray(entry.layers)) return [];
    const layers = entry.layers.flatMap((layerInput) => {
      const layer = record(layerInput);
      return typeof layer?.id === "string" && typeof layer.file === "string"
        ? [{ id: layer.id, file: layer.file }]
        : [];
    });
    return layers.length > 0 ? [{ id: entry.id, jobKey: entry.jobKey, layers }] : [];
  });
}

function parseDecisions(value: unknown): readonly ProductionTestDecision[] {
  const parsed = record(value);
  if (parsed?.formatVersion !== 1 || !Array.isArray(parsed.decisions)) return [];
  return parsed.decisions.flatMap((decisionInput) => {
    const decision = record(decisionInput);
    if (
      typeof decision?.recipeId !== "string"
      || typeof decision.candidateFingerprint !== "string"
      || (decision.decision !== "approved" && decision.decision !== "rejected")
    ) return [];
    return [{
      recipeId: decision.recipeId,
      candidateFingerprint: decision.candidateFingerprint,
      decision: decision.decision,
    }];
  });
}

/** Resolves only a currently fingerprinted, explicitly approved visual test. */
export function resolveProductionAssetTestOverride(
  search: string,
  recipesInput: unknown = productionRecipesJson,
  indexInput: unknown = productionIndexJson,
  reviewsInput: unknown = productionReviewsJson,
  imageUrls: Readonly<Record<string, string>> = PRODUCTION_CANDIDATE_IMAGE_URLS,
): Readonly<ProductionAssetTestOverride> | undefined {
  const recipeId = new URLSearchParams(search).get("testAsset");
  if (!recipeId) return undefined;
  const recipes = validateProductionAssetRecipeManifest(recipesInput);
  const recipe = recipes.recipes.find((candidate) => candidate.id === recipeId);
  const runtimeBinding = recipe?.runtimeBinding;
  if (!recipe || !runtimeBinding) return undefined;
  const index = parseIndex(indexInput).find((candidate) => candidate.id === recipeId);
  if (!index) return undefined;
  const approved = parseDecisions(reviewsInput).some((decision) =>
    decision.recipeId === recipeId
    && decision.candidateFingerprint === index.jobKey
    && decision.decision === "approved");
  if (!approved) return undefined;
  const layer = index.layers.find((candidate) => candidate.id === recipe.layers[0]?.id) ?? index.layers[0];
  const url = imageUrls[`../../../${layer.file}`];
  if (!url) return undefined;
  return Object.freeze({
    recipeId,
    recipeName: recipe.name,
    candidateFingerprint: index.jobKey,
    assetId: runtimeBinding.assetId,
    imageId: TEST_IMAGE_ID_BY_RUNTIME_ASSET[runtimeBinding.assetId],
    textureKey: `wayfinders:production-test:${recipeId.replaceAll(".", "-")}`,
    url,
    collisionNotice: `${recipe.name} is a visual test only; ${runtimeBinding.assetId} keeps its accepted collision and gameplay metadata.`,
  });
}

export function preloadProductionAssetTestOverride(
  scene: Phaser.Scene,
  override: Readonly<ProductionAssetTestOverride> | undefined,
): void {
  if (override) scene.load.image(override.textureKey, override.url);
}
