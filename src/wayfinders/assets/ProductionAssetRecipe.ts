import {
  AUTHORED_ASSET_IDS,
  type AuthoredAssetId,
} from "./AuthoredAssetContracts";

export const PRODUCTION_ASSET_RECIPE_FORMAT_VERSION = 1 as const;

export type ProductionAssetFamily =
  | "island"
  | "vessel"
  | "shoal"
  | "world-feature"
  | "environment";
export type ProductionAssetLifecycle =
  | "reference"
  | "source"
  | "candidate"
  | "accepted"
  | "runtime";
export type ProductionAssetProvenanceKind =
  | "reference"
  | "selected-source"
  | "runtime-package";
export type ProductionAssetLayerRole = "base" | "overlay" | "effect" | "reference";
export type ProductionAssetBlendMode = "normal" | "multiply" | "screen" | "add";

export interface ProductionAssetPreparation {
  readonly mode: "preserve" | "connected-border";
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly thumbnailMaximum: number;
  readonly matteColor?: readonly [number, number, number];
  readonly innerTolerance?: number;
  readonly outerTolerance?: number;
  readonly trimAlphaThreshold?: number;
  readonly padding?: number;
}

export interface ProductionAssetLayerRecipe {
  readonly id: string;
  readonly name: string;
  readonly role: ProductionAssetLayerRole;
  readonly sourceFile: string;
  readonly defaultVisible: boolean;
  readonly opacity: number;
  readonly blendMode: ProductionAssetBlendMode;
  readonly preparation: Readonly<ProductionAssetPreparation>;
}

export interface ProductionAssetAnimationRecipe {
  readonly id: string;
  readonly name: string;
  readonly kind: "sprite-sheet" | "rotation";
  readonly layerId: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly framesPerSecond: number;
  readonly directionCount: number;
}

export type ProductionAssetCollisionRecipe =
  | Readonly<{ mode: "preserve" }>
  | Readonly<{ mode: "blank-draft"; tileSize: number; subcellSize: number }>
  | Readonly<{ mode: "empty"; reason: string }>
  | Readonly<{ mode: "mask-file"; maskFile: string; tileSize: number; subcellSize: number }>
  | Readonly<{
      mode: "alpha";
      alphaMeansSolid: true;
      tileSize: number;
      subcellSize: number;
    }>;

export interface ProductionAssetRecipe {
  readonly id: string;
  readonly name: string;
  readonly family: ProductionAssetFamily;
  readonly lifecycle: ProductionAssetLifecycle;
  readonly collection: string;
  readonly sortOrder: number;
  readonly tags: readonly string[];
  readonly provenance: Readonly<{
    kind: ProductionAssetProvenanceKind;
    sourceFile: string;
  }>;
  readonly layers: readonly Readonly<ProductionAssetLayerRecipe>[];
  readonly animations: readonly Readonly<ProductionAssetAnimationRecipe>[];
  readonly collision: Readonly<ProductionAssetCollisionRecipe>;
  readonly runtimeBinding?: Readonly<{
    assetId: AuthoredAssetId;
    collisionIntent: "preserve";
  }>;
}

export interface ProductionAssetRecipeManifest {
  readonly formatVersion: typeof PRODUCTION_ASSET_RECIPE_FORMAT_VERSION;
  readonly recipes: readonly Readonly<ProductionAssetRecipe>[];
}

const FAMILIES = new Set<ProductionAssetFamily>([
  "island",
  "vessel",
  "shoal",
  "world-feature",
  "environment",
]);
const LIFECYCLES = new Set<ProductionAssetLifecycle>([
  "reference",
  "source",
  "candidate",
  "accepted",
  "runtime",
]);
const PROVENANCE_KINDS = new Set<ProductionAssetProvenanceKind>([
  "reference",
  "selected-source",
  "runtime-package",
]);
const LAYER_ROLES = new Set<ProductionAssetLayerRole>(["base", "overlay", "effect", "reference"]);
const BLEND_MODES = new Set<ProductionAssetBlendMode>(["normal", "multiply", "screen", "add"]);
const PILOT_RUNTIME_IDS = new Set<AuthoredAssetId>(Object.values(AUTHORED_ASSET_IDS));
const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = finiteNumber(value, label, minimum, maximum);
  if (!Number.isInteger(result)) throw new RangeError(`${label} must be an integer`);
  return result;
}

function stableId(value: unknown, label: string): string {
  const result = string(value, label);
  if (!STABLE_ID.test(result)) throw new RangeError(`${label} must be a stable lowercase ID`);
  return result;
}

function repositoryFile(value: unknown, label: string): string {
  const result = string(value, label).replaceAll("\\", "/");
  const pieces = result.split("/");
  if (
    result.startsWith("/")
    || /^[a-z]:/iu.test(result)
    || pieces.includes("")
    || pieces.includes(".")
    || pieces.includes("..")
    || result.includes("\0")
  ) {
    throw new RangeError(`${label} must be a safe repository-relative path`);
  }
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new RangeError(`${label} is not supported`);
  }
  return value as T;
}

function validatePreparation(input: unknown, label: string): ProductionAssetPreparation {
  const parsed = record(input, label);
  const mode = enumValue(parsed.mode, new Set(["preserve", "connected-border"] as const), `${label}.mode`);
  const targetWidth = integer(parsed.targetWidth, `${label}.targetWidth`, 1, 4_096);
  const targetHeight = integer(parsed.targetHeight, `${label}.targetHeight`, 1, 4_096);
  const thumbnailMaximum = integer(parsed.thumbnailMaximum, `${label}.thumbnailMaximum`, 32, 512);
  if (mode === "preserve") return { mode, targetWidth, targetHeight, thumbnailMaximum };

  if (!Array.isArray(parsed.matteColor) || parsed.matteColor.length !== 3) {
    throw new RangeError(`${label}.matteColor must contain three RGB channels`);
  }
  const matteColor = Object.freeze(parsed.matteColor.map((channel, index) =>
    integer(channel, `${label}.matteColor[${index}]`, 0, 255),
  )) as unknown as readonly [number, number, number];
  const innerTolerance = finiteNumber(parsed.innerTolerance, `${label}.innerTolerance`, 0, 442);
  const outerTolerance = finiteNumber(parsed.outerTolerance, `${label}.outerTolerance`, 0, 442);
  if (innerTolerance > outerTolerance) {
    throw new RangeError(`${label}.innerTolerance cannot exceed outerTolerance`);
  }
  return {
    mode,
    targetWidth,
    targetHeight,
    thumbnailMaximum,
    matteColor,
    innerTolerance,
    outerTolerance,
    trimAlphaThreshold: integer(parsed.trimAlphaThreshold, `${label}.trimAlphaThreshold`, 0, 255),
    padding: integer(parsed.padding, `${label}.padding`, 0, 512),
  };
}

function validateCollision(input: unknown, label: string): ProductionAssetCollisionRecipe {
  const parsed = record(input, label);
  const mode = enumValue(
    parsed.mode,
    new Set(["preserve", "blank-draft", "empty", "mask-file", "alpha"] as const),
    `${label}.mode`,
  );
  if (mode === "preserve") return { mode };
  if (mode === "empty") return { mode, reason: string(parsed.reason, `${label}.reason`) };
  const tileSize = integer(parsed.tileSize, `${label}.tileSize`, 1, 512);
  const subcellSize = integer(parsed.subcellSize, `${label}.subcellSize`, 1, tileSize);
  if (tileSize % subcellSize !== 0) throw new RangeError(`${label}.subcellSize must divide tileSize exactly`);
  if (mode === "blank-draft") return { mode, tileSize, subcellSize };
  if (mode === "mask-file") {
    return { mode, maskFile: repositoryFile(parsed.maskFile, `${label}.maskFile`), tileSize, subcellSize };
  }
  if (parsed.alphaMeansSolid !== true) {
    throw new RangeError(`${label}.alphaMeansSolid must be explicitly true`);
  }
  return { mode, alphaMeansSolid: true, tileSize, subcellSize };
}

function validateRecipe(input: unknown, index: number): ProductionAssetRecipe {
  const label = `recipes[${index}]`;
  const parsed = record(input, label);
  const id = stableId(parsed.id, `${label}.id`);
  const family = enumValue(parsed.family, FAMILIES, `${label}.family`);
  const lifecycle = enumValue(parsed.lifecycle, LIFECYCLES, `${label}.lifecycle`);
  const provenanceInput = record(parsed.provenance, `${label}.provenance`);
  const provenance = {
    kind: enumValue(provenanceInput.kind, PROVENANCE_KINDS, `${label}.provenance.kind`),
    sourceFile: repositoryFile(provenanceInput.sourceFile, `${label}.provenance.sourceFile`),
  } as const;
  if (lifecycle === "runtime" && provenance.kind !== "runtime-package") {
    throw new RangeError(`${label} runtime lifecycle requires runtime-package provenance`);
  }
  if (lifecycle === "source" && provenance.kind !== "selected-source") {
    throw new RangeError(`${label} source lifecycle requires selected-source provenance`);
  }
  if (lifecycle === "reference" && provenance.kind !== "reference") {
    throw new RangeError(`${label} reference lifecycle requires reference provenance`);
  }
  if (provenance.kind === "runtime-package" && !provenance.sourceFile.startsWith("public/")) {
    throw new RangeError(`${label} runtime-package provenance must use a public runtime file`);
  }
  if (provenance.kind !== "runtime-package" && provenance.sourceFile.startsWith("public/")) {
    throw new RangeError(`${label} source/reference provenance cannot use a public runtime file`);
  }

  if (!Array.isArray(parsed.tags) || parsed.tags.length === 0) {
    throw new RangeError(`${label}.tags must contain at least one tag`);
  }
  const tags = parsed.tags.map((tag, tagIndex) => {
    const result = string(tag, `${label}.tags[${tagIndex}]`);
    if (!TAG.test(result)) throw new RangeError(`${label}.tags[${tagIndex}] must be a lowercase tag`);
    return result;
  });
  if (new Set(tags).size !== tags.length) throw new RangeError(`${label}.tags contains duplicates`);

  if (!Array.isArray(parsed.layers) || parsed.layers.length === 0) {
    throw new RangeError(`${label}.layers must contain at least one layer`);
  }
  const layerIds = new Set<string>();
  const layers = parsed.layers.map((layerInput, layerIndex): ProductionAssetLayerRecipe => {
    const layerLabel = `${label}.layers[${layerIndex}]`;
    const layer = record(layerInput, layerLabel);
    const layerId = stableId(layer.id, `${layerLabel}.id`);
    if (layerIds.has(layerId)) throw new RangeError(`${label} contains duplicate layer ID ${layerId}`);
    layerIds.add(layerId);
    return {
      id: layerId,
      name: string(layer.name, `${layerLabel}.name`),
      role: enumValue(layer.role, LAYER_ROLES, `${layerLabel}.role`),
      sourceFile: repositoryFile(layer.sourceFile, `${layerLabel}.sourceFile`),
      defaultVisible: boolean(layer.defaultVisible, `${layerLabel}.defaultVisible`),
      opacity: finiteNumber(layer.opacity, `${layerLabel}.opacity`, 0, 1),
      blendMode: enumValue(layer.blendMode, BLEND_MODES, `${layerLabel}.blendMode`),
      preparation: validatePreparation(layer.preparation, `${layerLabel}.preparation`),
    };
  });

  const animationsInput = parsed.animations ?? [];
  if (!Array.isArray(animationsInput)) throw new TypeError(`${label}.animations must be an array`);
  const animationIds = new Set<string>();
  const animations = animationsInput.map((animationInput, animationIndex): ProductionAssetAnimationRecipe => {
    const animationLabel = `${label}.animations[${animationIndex}]`;
    const animation = record(animationInput, animationLabel);
    const animationId = stableId(animation.id, `${animationLabel}.id`);
    if (animationIds.has(animationId)) throw new RangeError(`${label} contains duplicate animation ID ${animationId}`);
    animationIds.add(animationId);
    const layerId = stableId(animation.layerId, `${animationLabel}.layerId`);
    if (!layerIds.has(layerId)) throw new RangeError(`${animationLabel}.layerId does not name a recipe layer`);
    return {
      id: animationId,
      name: string(animation.name, `${animationLabel}.name`),
      kind: enumValue(animation.kind, new Set(["sprite-sheet", "rotation"] as const), `${animationLabel}.kind`),
      layerId,
      frameWidth: integer(animation.frameWidth, `${animationLabel}.frameWidth`, 1, 4_096),
      frameHeight: integer(animation.frameHeight, `${animationLabel}.frameHeight`, 1, 4_096),
      frameCount: integer(animation.frameCount, `${animationLabel}.frameCount`, 1, 4_096),
      framesPerSecond: finiteNumber(animation.framesPerSecond, `${animationLabel}.framesPerSecond`, 0.1, 120),
      directionCount: integer(animation.directionCount, `${animationLabel}.directionCount`, 1, 360),
    };
  });

  const collision = validateCollision(parsed.collision, `${label}.collision`);
  let runtimeBinding: ProductionAssetRecipe["runtimeBinding"];
  if (parsed.runtimeBinding !== undefined) {
    const binding = record(parsed.runtimeBinding, `${label}.runtimeBinding`);
    if (typeof binding.assetId !== "string" || !PILOT_RUNTIME_IDS.has(binding.assetId as AuthoredAssetId)) {
      throw new RangeError(`${label}.runtimeBinding.assetId must name an existing pilot runtime package`);
    }
    if (binding.collisionIntent !== "preserve") {
      throw new RangeError(`${label}.runtimeBinding.collisionIntent must preserve accepted collision`);
    }
    runtimeBinding = { assetId: binding.assetId as AuthoredAssetId, collisionIntent: "preserve" };
  }

  if (lifecycle === "runtime" && runtimeBinding === undefined) {
    throw new RangeError(`${label} runtime lifecycle requires a runtimeBinding`);
  }
  if (lifecycle === "runtime" && runtimeBinding?.assetId !== id) {
    throw new RangeError(`${label} runtime lifecycle ID must match its runtimeBinding assetId`);
  }
  if (lifecycle === "reference" && runtimeBinding !== undefined) {
    throw new RangeError(`${label} reference lifecycle cannot have a runtimeBinding`);
  }
  if (collision.mode === "preserve" && runtimeBinding === undefined) {
    throw new RangeError(`${label} preserve collision requires a runtimeBinding`);
  }
  if (family === "shoal" && collision.mode !== "empty" && collision.mode !== "preserve") {
    throw new RangeError(`${label} shoals must remain explicitly empty or preserve an accepted profile`);
  }
  if (family === "island" && collision.mode === "empty") {
    throw new RangeError(`${label} islands require an authored collision draft or preserved profile`);
  }
  if (family === "environment" && collision.mode !== "empty") {
    throw new RangeError(`${label} environment visuals must be explicitly passable`);
  }
  if (collision.mode === "alpha" && lifecycle === "reference") {
    throw new RangeError(`${label} reference art cannot assert alpha collision authority`);
  }

  return {
    id,
    name: string(parsed.name, `${label}.name`),
    family,
    lifecycle,
    collection: string(parsed.collection, `${label}.collection`),
    sortOrder: integer(parsed.sortOrder, `${label}.sortOrder`, 0, 1_000_000),
    tags,
    provenance,
    layers,
    animations,
    collision,
    ...(runtimeBinding ? { runtimeBinding } : {}),
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateProductionAssetRecipeManifest(input: unknown): Readonly<ProductionAssetRecipeManifest> {
  const parsed = record(input, "Production asset recipe manifest");
  if (parsed.formatVersion !== PRODUCTION_ASSET_RECIPE_FORMAT_VERSION) {
    throw new RangeError(`Production asset recipe manifest must use formatVersion ${PRODUCTION_ASSET_RECIPE_FORMAT_VERSION}`);
  }
  if (!Array.isArray(parsed.recipes)) throw new TypeError("Production asset recipe manifest recipes must be an array");
  const recipes = parsed.recipes.map(validateRecipe);
  const ids = new Set<string>();
  for (const recipe of recipes) {
    if (ids.has(recipe.id)) throw new RangeError(`Duplicate production asset recipe ID ${recipe.id}`);
    ids.add(recipe.id);
  }
  return deepFreeze({ formatVersion: PRODUCTION_ASSET_RECIPE_FORMAT_VERSION, recipes });
}
