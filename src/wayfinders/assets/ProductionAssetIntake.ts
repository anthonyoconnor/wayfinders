import {
  type ProductionAssetFamily,
  type ProductionAssetLayerRole,
} from "./ProductionAssetRecipe.ts";

export const PRODUCTION_ASSET_INTAKE_ROUTE = "/__wayfinders/assets/intake";
export const PRODUCTION_ASSET_INTAKE_FORMAT_VERSION = 1 as const;

export type ProductionAssetCollisionSemantics = "passable" | "solid";
export type ProductionAssetCanvasSizing = "native" | "resize";
export type ProductionAssetRuntimeCategory =
  | "none"
  | "home-island"
  | "player-boat"
  | "fishing-shoal";

export type ProductionAssetIntakeSource =
  | Readonly<{ kind: "reference"; repositoryPath: string }>
  | Readonly<{ kind: "upload"; fileName: string; pngBase64: string }>;

export interface ProductionAssetIntakeRequest {
  readonly formatVersion: typeof PRODUCTION_ASSET_INTAKE_FORMAT_VERSION;
  readonly source: ProductionAssetIntakeSource;
  readonly name: string;
  readonly id: string;
  readonly family: ProductionAssetFamily;
  readonly targetWidth: number;
  readonly targetHeight: number;
  /** Native keeps source pixels 1:1 and permits only transparent canvas expansion. */
  readonly canvasSizing: ProductionAssetCanvasSizing;
  readonly layerRole: ProductionAssetLayerRole;
  readonly collisionSemantics: ProductionAssetCollisionSemantics;
  readonly runtimeCategory: ProductionAssetRuntimeCategory;
}

export interface ProductionAssetFamilyDefaults {
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly layerRole: ProductionAssetLayerRole;
  readonly collisionSemantics: ProductionAssetCollisionSemantics;
  readonly runtimeCategory: ProductionAssetRuntimeCategory;
  readonly summary: string;
}

export interface ProductionAssetDimensions {
  readonly width: number;
  readonly height: number;
}

export type ProductionAssetDimensionAxis = "width" | "height";

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

/** Reads the authoritative canvas size from a PNG IHDR without decoding pixels. */
export function productionAssetPngDimensions(bytes: Uint8Array): Readonly<ProductionAssetDimensions> {
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new RangeError("The selected file is not a PNG");
  }
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") {
    throw new RangeError("The selected PNG has no IHDR header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 4_096 || height > 4_096) {
    throw new RangeError("PNG dimensions must be between 1 and 4096 pixels");
  }
  return Object.freeze({ width, height });
}

/** Returns the smallest transparent canvas aligned to the collision grid. */
export function gridPaddedProductionAssetDimensions(
  dimensions: Readonly<ProductionAssetDimensions>,
  gridSize = 32,
): Readonly<ProductionAssetDimensions> {
  if (!Number.isInteger(gridSize) || gridSize < 1) throw new RangeError("Grid size must be a positive integer");
  const width = boundedInteger(dimensions.width);
  const height = boundedInteger(dimensions.height);
  if (!width || !height) throw new RangeError("Asset dimensions must be whole numbers from 1 to 4096");
  const paddedWidth = Math.ceil(width / gridSize) * gridSize;
  const paddedHeight = Math.ceil(height / gridSize) * gridSize;
  if (paddedWidth > 4_096 || paddedHeight > 4_096) {
    throw new RangeError("Grid padding would exceed the 4096 pixel texture limit");
  }
  return Object.freeze({ width: paddedWidth, height: paddedHeight });
}

/** Uses the local upload filename as the initial editable display name. */
export function productionAssetNameFromFileName(fileName: string): string {
  const normalized = fileName.replaceAll("\\", "/");
  const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const extension = baseName.lastIndexOf(".");
  return (extension > 0 ? baseName.slice(0, extension) : baseName).trim();
}

/** Projects one edited canvas dimension through the source PNG aspect ratio. */
export function aspectLockedProductionAssetDimensions(
  source: Readonly<ProductionAssetDimensions>,
  axis: ProductionAssetDimensionAxis,
  value: number,
): Readonly<ProductionAssetDimensions> {
  const sourceWidth = boundedInteger(source.width);
  const sourceHeight = boundedInteger(source.height);
  const changed = boundedInteger(value);
  if (!sourceWidth || !sourceHeight || !changed) {
    throw new RangeError("Aspect-locked dimensions must be whole numbers from 1 to 4096");
  }
  return Object.freeze(axis === "width"
    ? { width: changed, height: Math.max(1, Math.round(changed * sourceHeight / sourceWidth)) }
    : { width: Math.max(1, Math.round(changed * sourceWidth / sourceHeight)), height: changed });
}

export const PRODUCTION_ASSET_FAMILY_DEFAULTS: Readonly<Record<ProductionAssetFamily, ProductionAssetFamilyDefaults>> =
  Object.freeze({
    island: Object.freeze({
      targetWidth: 480,
      targetHeight: 480,
      layerRole: "base",
      collisionSemantics: "solid",
      runtimeCategory: "home-island",
      summary: "480×480 base layer · editable solid collision draft · optional home-island visual test",
    }),
    vessel: Object.freeze({
      targetWidth: 96,
      targetHeight: 96,
      layerRole: "base",
      collisionSemantics: "solid",
      runtimeCategory: "player-boat",
      summary: "96×96 base layer · editable solid collision draft · optional player-boat visual test",
    }),
    shoal: Object.freeze({
      targetWidth: 96,
      targetHeight: 64,
      layerRole: "effect",
      collisionSemantics: "passable",
      runtimeCategory: "fishing-shoal",
      summary: "96×64 effect layer · explicitly passable · optional fishing-shoal visual test",
    }),
    "world-feature": Object.freeze({
      targetWidth: 128,
      targetHeight: 128,
      layerRole: "base",
      collisionSemantics: "solid",
      runtimeCategory: "none",
      summary: "128×128 base layer · editable solid collision draft · no runtime test binding",
    }),
    environment: Object.freeze({
      targetWidth: 512,
      targetHeight: 512,
      layerRole: "base",
      collisionSemantics: "passable",
      runtimeCategory: "none",
      summary: "512×512 base layer · explicitly passable · no runtime test binding",
    }),
  });

export class ProductionAssetIntakeValidationError extends Error {
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(fieldErrors: Readonly<Record<string, string>>) {
    super("Production asset intake contains invalid fields");
    this.name = "ProductionAssetIntakeValidationError";
    this.fieldErrors = Object.freeze({ ...fieldErrors });
  }
}

const FAMILIES = new Set<ProductionAssetFamily>(["island", "vessel", "shoal", "world-feature", "environment"]);
const LAYER_ROLES = new Set<ProductionAssetLayerRole>(["base", "overlay", "effect", "reference"]);
const COLLISION_SEMANTICS = new Set<ProductionAssetCollisionSemantics>(["passable", "solid"]);
const CANVAS_SIZING = new Set<ProductionAssetCanvasSizing>(["native", "resize"]);
const RUNTIME_CATEGORIES = new Set<ProductionAssetRuntimeCategory>([
  "none",
  "home-island",
  "player-boat",
  "fishing-shoal",
]);
const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const PNG_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4_096
    ? Number(value)
    : undefined;
}

function safeReferencePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replaceAll("\\", "/");
  const allowed = [
    "assets-src/gr1/island-examples/",
    "concept_art/example assets/islands/",
    "concept_art/example assets/shoals/",
    "assets-src/gr1/water/runtime/",
  ];
  if (!normalized.endsWith(".png") || !allowed.some((prefix) => normalized.startsWith(prefix))) return undefined;
  if (normalized.includes("/../") || normalized.includes("/./") || normalized.startsWith("/")) return undefined;
  return normalized;
}

export function suggestedProductionAssetId(name: string, family: ProductionAssetFamily): string {
  const slug = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72);
  return `production.${family}.${slug || "new-asset"}`;
}

export function validateProductionAssetIntakeRequest(input: unknown): Readonly<ProductionAssetIntakeRequest> {
  const parsed = record(input);
  const errors: Record<string, string> = {};
  if (!parsed) throw new ProductionAssetIntakeValidationError({ form: "Intake request must be an object" });
  if (parsed.formatVersion !== PRODUCTION_ASSET_INTAKE_FORMAT_VERSION) errors.form = "Unsupported intake format";

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (name.length < 2 || name.length > 80) errors.name = "Enter an asset name from 2 to 80 characters";
  const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
  if (!STABLE_ID.test(id) || id.length > 96) errors.id = "Use a lowercase stable ID with dots or hyphens";

  const family = typeof parsed.family === "string" && FAMILIES.has(parsed.family as ProductionAssetFamily)
    ? parsed.family as ProductionAssetFamily
    : undefined;
  if (!family) errors.family = "Choose a supported asset family";
  const targetWidth = boundedInteger(parsed.targetWidth);
  const targetHeight = boundedInteger(parsed.targetHeight);
  if (!targetWidth) errors.targetWidth = "Width must be a whole number from 1 to 4096";
  if (!targetHeight) errors.targetHeight = "Height must be a whole number from 1 to 4096";
  const canvasSizing = typeof parsed.canvasSizing === "string"
    && CANVAS_SIZING.has(parsed.canvasSizing as ProductionAssetCanvasSizing)
    ? parsed.canvasSizing as ProductionAssetCanvasSizing
    : undefined;
  if (!canvasSizing) errors.canvasSizing = "Choose native canvas placement or intentional resizing";
  const layerRole = typeof parsed.layerRole === "string" && LAYER_ROLES.has(parsed.layerRole as ProductionAssetLayerRole)
    ? parsed.layerRole as ProductionAssetLayerRole
    : undefined;
  if (!layerRole) errors.layerRole = "Choose a supported layer role";
  const collisionSemantics = typeof parsed.collisionSemantics === "string"
    && COLLISION_SEMANTICS.has(parsed.collisionSemantics as ProductionAssetCollisionSemantics)
    ? parsed.collisionSemantics as ProductionAssetCollisionSemantics
    : undefined;
  if (!collisionSemantics) errors.collisionSemantics = "Choose passable or solid collision semantics";
  const runtimeCategory = typeof parsed.runtimeCategory === "string"
    && RUNTIME_CATEGORIES.has(parsed.runtimeCategory as ProductionAssetRuntimeCategory)
    ? parsed.runtimeCategory as ProductionAssetRuntimeCategory
    : undefined;
  if (!runtimeCategory) errors.runtimeCategory = "Choose a supported runtime/test category";

  if (family === "shoal" && collisionSemantics !== "passable") {
    errors.collisionSemantics = "Shoals must remain explicitly passable";
  }
  if (family === "environment" && collisionSemantics !== "passable") {
    errors.collisionSemantics = "Environment visuals must remain explicitly passable";
  }
  if (collisionSemantics === "solid" && targetWidth && targetHeight
    && (targetWidth % 32 !== 0 || targetHeight % 32 !== 0)) {
    errors.targetWidth = targetWidth % 32 === 0 ? errors.targetWidth : "Solid assets must align to 32 px cells";
    errors.targetHeight = targetHeight % 32 === 0 ? errors.targetHeight : "Solid assets must align to 32 px cells";
  }
  const categoryFamily: Partial<Record<ProductionAssetRuntimeCategory, ProductionAssetFamily>> = {
    "home-island": "island",
    "player-boat": "vessel",
    "fishing-shoal": "shoal",
  };
  if (family && runtimeCategory && runtimeCategory !== "none" && categoryFamily[runtimeCategory] !== family) {
    errors.runtimeCategory = `The ${runtimeCategory} test category does not match the ${family} family`;
  }

  const sourceInput = record(parsed.source);
  let source: ProductionAssetIntakeSource | undefined;
  if (sourceInput?.kind === "reference") {
    const repositoryPath = safeReferencePath(sourceInput.repositoryPath);
    if (!repositoryPath) errors.source = "Choose a supported repository reference PNG";
    else source = { kind: "reference", repositoryPath };
  } else if (sourceInput?.kind === "upload") {
    const fileName = typeof sourceInput.fileName === "string" ? sourceInput.fileName.trim() : "";
    const pngBase64 = typeof sourceInput.pngBase64 === "string" ? sourceInput.pngBase64 : "";
    if (!/^[^\\/:*?"<>|]{1,128}\.png$/iu.test(fileName)) errors.source = "Choose one PNG file with a safe filename";
    else if (pngBase64.length === 0 || !PNG_BASE64.test(pngBase64)) errors.source = "The selected PNG could not be read";
    else source = { kind: "upload", fileName, pngBase64 };
  } else {
    errors.source = "Choose a repository reference or a new local PNG";
  }

  if (Object.keys(errors).length > 0 || !family || !targetWidth || !targetHeight || !layerRole
    || !canvasSizing || !collisionSemantics || !runtimeCategory || !source) {
    throw new ProductionAssetIntakeValidationError(errors);
  }
  return Object.freeze({
    formatVersion: PRODUCTION_ASSET_INTAKE_FORMAT_VERSION,
    source: Object.freeze(source),
    name,
    id,
    family,
    targetWidth,
    targetHeight,
    canvasSizing,
    layerRole,
    collisionSemantics,
    runtimeCategory,
  });
}
