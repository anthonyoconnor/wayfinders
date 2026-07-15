import fishingShoalPackage from "./packages/fishing-shoal.json";
import homeIslandPackage from "./packages/home-island.json";
import playerBoatPackage from "./packages/player-boat.json";
import productionIndexJson from "../../../assets-src/gr3/generated/production-index.json";
import productionRecipesJson from "../../../assets-src/gr3/production-recipes.json";
import productionReviewsJson from "../../../assets-src/gr3/reviews.json";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredAssetMetadata,
  type AuthoredFishingShoalMetadata,
  type AuthoredHomeIslandMetadata,
  type AuthoredPlayerBoatMetadata,
  validateAuthoredAssetMetadata,
} from "./AuthoredAssetContracts";
import {
  PILOT_ASSET_CATALOG,
  type PilotPackageCatalogEntry,
} from "./PilotAssetCatalog";
import {
  type ProductionAssetFamily,
  type ProductionAssetRecipe,
  type ProductionAssetRecipeManifest,
  validateProductionAssetRecipeManifest,
} from "./ProductionAssetRecipe";

/** Stable browser sections. Their order is deliberately independent of labels. */
export const ASSET_LIBRARY_CATEGORIES = Object.freeze([
  Object.freeze({ id: "islands", name: "Islands", order: 10 }),
  Object.freeze({ id: "vessels", name: "Vessels", order: 20 }),
  Object.freeze({ id: "world-features", name: "World features", order: 30 }),
] as const);

export type AssetLibraryCategoryId = (typeof ASSET_LIBRARY_CATEGORIES)[number]["id"];
export type AssetLibraryEntryType = "authored-package" | "production-candidate" | "reference-image";
export type AssetLibraryLayerRole = "base" | "overlay" | "effect" | "reference";
export type AssetLibraryAnimationKind = "sprite-sheet" | "rotation";

export type AssetLibraryDetailValue = string | number | boolean;

export interface AssetLibraryDetailField {
  readonly id: string;
  readonly name: string;
  readonly value: AssetLibraryDetailValue;
  readonly unit?: string;
}

export interface AssetLibraryDetailSection {
  readonly id: string;
  readonly name: string;
  readonly fields: readonly Readonly<AssetLibraryDetailField>[];
}

/**
 * A composable visual plane. More image, procedural or animation-backed layer
 * sources can be added to this union without changing the library entry shape.
 */
export interface AssetLibraryImageLayer {
  readonly sourceKind: "image";
  readonly id: string;
  readonly name: string;
  readonly role: AssetLibraryLayerRole;
  readonly order: number;
  readonly url: string;
  readonly imageId?: string;
  readonly defaultVisible: boolean;
  readonly opacity: number;
  readonly blendMode: "normal" | "multiply" | "screen" | "add";
  readonly pixelSize?: Readonly<{ width: number; height: number }>;
  readonly frameSize?: Readonly<{ width: number; height: number }>;
}

export type AssetLibraryLayer = AssetLibraryImageLayer;

export interface AssetLibraryAnimationDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: AssetLibraryAnimationKind;
  readonly layerId: string;
  readonly playback: "loop" | "state-driven";
  readonly frameSize: Readonly<{ width: number; height: number }>;
  readonly frameCount: number;
  readonly framesPerSecond: number;
  readonly directionCount: number;
  readonly sourceHeadingDegrees?: number;
}

export interface AssetLibraryEntryBase {
  readonly id: string;
  readonly entryType: AssetLibraryEntryType;
  readonly name: string;
  readonly subtitle: string;
  readonly categoryId: AssetLibraryCategoryId;
  readonly collection: string;
  readonly sortOrder: number;
  /** Small browser image. Full-resolution layers remain unloaded until selected. */
  readonly thumbnailUrl: string;
  readonly tags: readonly string[];
  readonly layers: readonly Readonly<AssetLibraryLayer>[];
  readonly animations: readonly Readonly<AssetLibraryAnimationDescriptor>[];
  readonly details: readonly Readonly<AssetLibraryDetailSection>[];
}

export interface AuthoredPackageLibraryEntry extends AssetLibraryEntryBase {
  readonly entryType: "authored-package";
  readonly package: Readonly<{
    metadataKey: string;
    metadataUrl: string;
    runtimeRevision: number;
    sourceAssetId: string;
    metadata: Readonly<AuthoredAssetMetadata>;
  }>;
}

export interface ProductionCandidateLibraryEntry extends AssetLibraryEntryBase {
  readonly entryType: "production-candidate";
  readonly recipe: Readonly<ProductionAssetRecipe>;
  readonly fingerprint: string;
  readonly sourceLayers: readonly Readonly<AssetLibraryImageLayer>[];
  readonly candidateLayers: readonly Readonly<AssetLibraryImageLayer>[];
  readonly collisionDraftFile: string;
  readonly collisionDraft: Readonly<ProductionCandidateCollisionDraft>;
  readonly lifecycle: "candidate";
  readonly reviewState: "pending" | "approved" | "rejected";
}

export interface ProductionCandidateCollisionDraft {
  readonly kind: "hybrid-grid-draft";
  readonly tileSize: number;
  readonly subcellSize: number;
  readonly grid: Readonly<{
    width: number;
    height: number;
    subcellColumns: number;
    subcellRows: number;
  }>;
  readonly solidSubcells: readonly Readonly<{ x: number; y: number }>[];
}

export type AssetLibraryReferenceKind = "island" | "shoal" | "environment";

export interface ReferenceImageLibraryEntry extends AssetLibraryEntryBase {
  readonly entryType: "reference-image";
  readonly categoryId: "islands" | "world-features";
  readonly reference: Readonly<{
    collectionId:
      | "gr1-island-examples"
      | "concept-example-islands"
      | "concept-example-shoals"
      | "gr1-water-reference";
    kind: AssetLibraryReferenceKind;
    relativePath: string;
    fileName: string;
    sequence?: number;
    shapeSlug: string;
    settlement?: "inhabited" | "uninhabited";
    /** Examples are visual references only; they have no runtime package contract. */
    runtimeStatus: "reference-only";
  }>;
}

/** Backwards-compatible name retained for the viewer while references expand beyond islands. */
export type IslandReferenceLibraryEntry = ReferenceImageLibraryEntry;

export type AssetLibraryEntry =
  | AuthoredPackageLibraryEntry
  | ProductionCandidateLibraryEntry
  | ReferenceImageLibraryEntry;

export interface AssetLibraryGroup {
  readonly id: AssetLibraryCategoryId;
  readonly name: string;
  readonly entries: readonly Readonly<AssetLibraryEntry>[];
}

const ISLAND_EXAMPLE_IMAGE_URLS = import.meta.glob<string>(
  "../../../assets-src/gr1/island-examples/*.png",
  { eager: true, query: "?url", import: "default" },
);

const PRODUCTION_SOURCE_IMAGE_URLS = import.meta.glob<string>(
  "../../../assets-src/gr1/island-*-source.png",
  { eager: true, query: "?url", import: "default" },
);

const PRODUCTION_CANDIDATE_IMAGE_URLS = import.meta.glob<string>(
  "../../../assets-src/gr3/candidates/*/*.png",
  { eager: true, query: "?url", import: "default" },
);

const PRODUCTION_COLLISION_DRAFTS = import.meta.glob<unknown>(
  "../../../assets-src/gr3/candidates/*/collision-draft.json",
  { eager: true, import: "default" },
);

const CONCEPT_ISLAND_IMAGE_URLS = import.meta.glob<string>(
  "../../../concept_art/example assets/islands/*.png",
  { eager: true, query: "?url", import: "default" },
);

const CONCEPT_SHOAL_IMAGE_URLS = import.meta.glob<string>(
  "../../../concept_art/example assets/shoals/*.png",
  { eager: true, query: "?url", import: "default" },
);

const WATER_REFERENCE_IMAGE_URLS = import.meta.glob<string>(
  "../../../assets-src/gr1/water/runtime/water-contact-sheet.png",
  { eager: true, query: "?url", import: "default" },
);

const VALIDATED_AUTHORED_METADATA = Object.freeze([
  validateAuthoredAssetMetadata(homeIslandPackage),
  validateAuthoredAssetMetadata(playerBoatPackage),
  validateAuthoredAssetMetadata(fishingShoalPackage),
]);

const CATEGORY_ORDER = new Map(
  ASSET_LIBRARY_CATEGORIES.map((category) => [category.id, category.order]),
);

function titleFromSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function packageCatalogEntry(assetId: AuthoredAssetMetadata["assetId"]): PilotPackageCatalogEntry {
  const entry = PILOT_ASSET_CATALOG.find((candidate) => candidate.assetId === assetId);
  if (!entry) throw new Error(`Asset library is missing the generated catalog entry for ${assetId}`);
  return entry;
}

function packageImageUrl(entry: PilotPackageCatalogEntry, imageId: string): string {
  const image = entry.images.find((candidate) => candidate.imageId === imageId);
  if (!image) throw new Error(`Asset package ${entry.assetId} is missing image ${imageId}`);
  return image.url;
}

function commonPackageDetails(metadata: AuthoredAssetMetadata): AssetLibraryDetailSection {
  return {
    id: "package",
    name: "Package",
    fields: [
      { id: "asset-id", name: "Asset ID", value: metadata.assetId },
      { id: "source-asset-id", name: "Source asset ID", value: metadata.sourceAssetId },
      { id: "runtime-revision", name: "Runtime revision", value: metadata.runtimeRevision },
      { id: "contract-version", name: "Contract version", value: metadata.contractVersion },
      { id: "tile-size", name: "Navigation cell", value: metadata.tileSize, unit: "px" },
    ],
  };
}

function authoredPackageShell(
  metadata: AuthoredAssetMetadata,
  catalog: PilotPackageCatalogEntry,
): AuthoredPackageLibraryEntry["package"] {
  return {
    metadataKey: catalog.metadataKey,
    metadataUrl: catalog.metadataUrl,
    runtimeRevision: metadata.runtimeRevision,
    sourceAssetId: metadata.sourceAssetId,
    metadata,
  };
}

function homeIslandEntry(metadata: AuthoredHomeIslandMetadata): AuthoredPackageLibraryEntry {
  const catalog = packageCatalogEntry(metadata.assetId);
  const layers = [...metadata.render.slices]
    .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id))
    .map((slice, index): AssetLibraryImageLayer => ({
      sourceKind: "image",
      id: `layer.${slice.id}`,
      name: titleFromSlug(slice.id),
      role: index === 0 ? "base" : "overlay",
      order: slice.depth,
      url: packageImageUrl(catalog, slice.imageId),
      imageId: slice.imageId,
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
      pixelSize: slice.pixelSize,
    }));
  return {
    id: metadata.assetId,
    entryType: "authored-package",
    name: "Home Island",
    subtitle: "Authored runtime island",
    categoryId: "islands",
    collection: "Runtime assets",
    sortOrder: 0,
    thumbnailUrl: packageImageUrl(catalog, metadata.render.slices[0].imageId),
    tags: ["island", "home", "runtime", "authored"],
    layers,
    animations: [],
    details: [
      commonPackageDetails(metadata),
      {
        id: "geometry",
        name: "Geometry",
        fields: [
          { id: "grid-width", name: "Grid width", value: metadata.grid.width, unit: "cells" },
          { id: "grid-height", name: "Grid height", value: metadata.grid.height, unit: "cells" },
          { id: "image-width", name: "Image width", value: metadata.render.pixelSize.width, unit: "px" },
          { id: "image-height", name: "Image height", value: metadata.render.pixelSize.height, unit: "px" },
          { id: "render-slices", name: "Render layers", value: metadata.render.slices.length },
          {
            id: "collision",
            name: "Collision",
            value: metadata.collision
              ? `Hybrid grid (${metadata.collision.subcellSize} px shoreline cells)`
              : "Coarse terrain grid",
          },
        ],
      },
      {
        id: "anchors",
        name: "Anchors",
        fields: Object.entries(metadata.anchors).map(([id, point]) => ({
          id,
          name: titleFromSlug(id.replace(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase()),
          value: `${point.x}, ${point.y}`,
          unit: "cell",
        })),
      },
    ],
    package: authoredPackageShell(metadata, catalog),
  };
}

function playerBoatEntry(metadata: AuthoredPlayerBoatMetadata): AuthoredPackageLibraryEntry {
  const catalog = packageCatalogEntry(metadata.assetId);
  const movementFrames = metadata.visual.directionCount * metadata.visual.motionFramesPerDirection;
  return {
    id: metadata.assetId,
    entryType: "authored-package",
    name: "Player Boat",
    subtitle: "Authored player vessel",
    categoryId: "vessels",
    collection: "Runtime assets",
    sortOrder: 0,
    thumbnailUrl: packageImageUrl(catalog, metadata.visual.imageId),
    tags: ["boat", "ship", "player", "runtime", "animated"],
    layers: [
      {
        sourceKind: "image",
        id: "layer.boat",
        name: "Boat",
        role: "base",
        order: metadata.visual.depth,
        url: packageImageUrl(catalog, metadata.visual.imageId),
        imageId: metadata.visual.imageId,
        defaultVisible: true,
        opacity: 1,
        blendMode: "normal",
        frameSize: metadata.visual.frameSize,
      },
      {
        sourceKind: "image",
        id: "layer.wake",
        name: "Wake",
        role: "effect",
        order: metadata.wake.depth,
        url: packageImageUrl(catalog, metadata.wake.imageId),
        imageId: metadata.wake.imageId,
        defaultVisible: true,
        opacity: 1,
        blendMode: "normal",
        frameSize: metadata.wake.frameSize,
      },
    ],
    animations: [
      {
        id: "animation.movement",
        name: "Movement",
        kind: metadata.visual.headingMode === "rotate" ? "rotation" : "sprite-sheet",
        layerId: "layer.boat",
        playback: "state-driven",
        frameSize: metadata.visual.frameSize,
        frameCount: movementFrames,
        framesPerSecond: metadata.visual.framesPerSecond,
        directionCount: metadata.visual.directionCount,
        sourceHeadingDegrees: metadata.visual.sourceHeadingDegrees,
      },
      {
        id: "animation.wake",
        name: "Wake",
        kind: "sprite-sheet",
        layerId: "layer.wake",
        playback: "state-driven",
        frameSize: metadata.wake.frameSize,
        frameCount: metadata.wake.frameCount,
        framesPerSecond: metadata.wake.framesPerSecond,
        directionCount: 1,
        sourceHeadingDegrees: metadata.wake.sourceHeadingDegrees,
      },
    ],
    details: [
      commonPackageDetails(metadata),
      {
        id: "visual",
        name: "Visual",
        fields: [
          { id: "heading-mode", name: "Heading mode", value: metadata.visual.headingMode },
          { id: "directions", name: "Directions", value: metadata.visual.directionCount },
          { id: "movement-frames", name: "Movement frames", value: movementFrames },
          { id: "movement-fps", name: "Movement speed", value: metadata.visual.framesPerSecond, unit: "fps" },
          { id: "scale", name: "Scale", value: metadata.visual.scale },
          { id: "wake-frames", name: "Wake frames", value: metadata.wake.frameCount },
          { id: "wake-fps", name: "Wake speed", value: metadata.wake.framesPerSecond, unit: "fps" },
        ],
      },
      {
        id: "collision",
        name: "Collision",
        fields: metadata.collision
          ? [
              { id: "kind", name: "Profile", value: "Centered box" },
              { id: "half-width", name: "Half width", value: metadata.collision.halfSize.width, unit: "px" },
              { id: "half-height", name: "Half height", value: metadata.collision.halfSize.height, unit: "px" },
            ]
          : [{ id: "kind", name: "Profile", value: "Configured runtime hull" }],
      },
    ],
    package: authoredPackageShell(metadata, catalog),
  };
}

function fishingShoalEntry(metadata: AuthoredFishingShoalMetadata): AuthoredPackageLibraryEntry {
  const catalog = packageCatalogEntry(metadata.assetId);
  return {
    id: metadata.assetId,
    entryType: "authored-package",
    name: "Fishing Shoal",
    subtitle: "Authored world feature",
    categoryId: "world-features",
    collection: "Runtime assets",
    sortOrder: 0,
    thumbnailUrl: packageImageUrl(catalog, metadata.visual.imageId),
    tags: ["shoal", "fishing", "resource", "runtime", "passable"],
    layers: [{
      sourceKind: "image",
      id: "layer.shoal",
      name: "Shoal",
      role: "base",
      order: metadata.visual.depth,
      url: packageImageUrl(catalog, metadata.visual.imageId),
      imageId: metadata.visual.imageId,
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
      pixelSize: metadata.visual.pixelSize,
    }],
    animations: [],
    details: [
      commonPackageDetails(metadata),
      {
        id: "visual",
        name: "Visual and behavior",
        fields: [
          { id: "image-width", name: "Image width", value: metadata.visual.pixelSize.width, unit: "px" },
          { id: "image-height", name: "Image height", value: metadata.visual.pixelSize.height, unit: "px" },
          { id: "grid-width", name: "Grid width", value: metadata.grid.width, unit: "cells" },
          { id: "grid-height", name: "Grid height", value: metadata.grid.height, unit: "cells" },
          { id: "passable", name: "Passable", value: metadata.grid.passable },
          { id: "collision", name: "Collision", value: metadata.collision ? "Explicitly empty" : "Legacy passable" },
          { id: "visibility-source", name: "Visibility source", value: metadata.visibilitySource },
        ],
      },
    ],
    package: authoredPackageShell(metadata, catalog),
  };
}

function authoredEntries(): AuthoredPackageLibraryEntry[] {
  return VALIDATED_AUTHORED_METADATA.map((metadata): AuthoredPackageLibraryEntry => {
    switch (metadata.assetId) {
      case AUTHORED_ASSET_IDS.homeIsland:
        return homeIslandEntry(metadata as AuthoredHomeIslandMetadata);
      case AUTHORED_ASSET_IDS.playerBoat:
        return playerBoatEntry(metadata as AuthoredPlayerBoatMetadata);
      case AUTHORED_ASSET_IDS.fishingShoal:
        return fishingShoalEntry(metadata as AuthoredFishingShoalMetadata);
    }
  });
}

/** Converts a Vite glob result into a strictly reference-only island entry. */
export function islandReferenceEntry(path: string, url: string): IslandReferenceLibraryEntry {
  const normalizedPath = path.replaceAll("\\", "/");
  const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;
  const match = /^island-(\d+)-(.+)-(uninhabited|inhabited)\.png$/u.exec(fileName);
  if (!match) {
    throw new RangeError(`Island example filename does not match the catalog convention: ${fileName}`);
  }
  const sequence = Number.parseInt(match[1], 10);
  const shapeSlug = match[2];
  const settlement = match[3] as "inhabited" | "uninhabited";
  const shapeName = titleFromSlug(shapeSlug);
  const relativePath = `assets-src/gr1/island-examples/${fileName}`;
  return {
    id: `reference.island.${sequence.toString().padStart(2, "0")}.${shapeSlug}`,
    entryType: "reference-image",
    name: shapeName,
    subtitle: `${titleFromSlug(settlement)} island example`,
    categoryId: "islands",
    collection: "Island examples",
    sortOrder: 100 + sequence,
    thumbnailUrl: url,
    tags: ["island", "reference", settlement, ...shapeSlug.split("-")],
    layers: [{
      sourceKind: "image",
      id: "layer.reference",
      name: "Reference image",
      role: "reference",
      order: 0,
      url,
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
    }],
    animations: [],
    details: [{
      id: "reference",
      name: "Reference",
      fields: [
        { id: "sequence", name: "Example number", value: sequence },
        { id: "shape", name: "Island form", value: shapeName },
        { id: "settlement", name: "Settlement", value: titleFromSlug(settlement) },
        { id: "runtime-status", name: "Runtime status", value: "Reference only" },
        { id: "file-name", name: "Source file", value: fileName },
      ],
    }],
    reference: {
      collectionId: "gr1-island-examples",
      kind: "island",
      relativePath,
      fileName,
      sequence,
      shapeSlug,
      settlement,
      runtimeStatus: "reference-only",
    },
  };
}

interface ProductionIndexLayer {
  readonly id: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

interface ProductionIndexEntry {
  readonly id: string;
  readonly family: ProductionAssetFamily;
  readonly lifecycle: "candidate";
  readonly jobKey: string;
  readonly sourceFiles: readonly string[];
  readonly layers: readonly Readonly<ProductionIndexLayer>[];
  readonly thumbnailFile: string;
  readonly collisionDraftFile: string;
}

interface ProductionIndex {
  readonly formatVersion: 1;
  readonly pipelineVersion: number;
  readonly manifestSha256: string;
  readonly entries: readonly Readonly<ProductionIndexEntry>[];
}

export interface AssetLibraryCatalogDependencies {
  readonly productionRecipeManifest?: unknown;
  readonly productionIndex?: unknown;
  readonly productionReviews?: unknown;
  readonly productionSourceImages?: Readonly<Record<string, string>>;
  readonly productionCandidateImages?: Readonly<Record<string, string>>;
  readonly productionCollisionDrafts?: Readonly<Record<string, unknown>>;
  readonly conceptIslandImages?: Readonly<Record<string, string>>;
  readonly conceptShoalImages?: Readonly<Record<string, string>>;
  readonly waterReferenceImages?: Readonly<Record<string, string>>;
}

function unknownRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  const minimum = allowZero ? 0 : 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function repositoryPath(value: unknown, label: string): string {
  const path = nonEmptyString(value, label).replaceAll("\\", "/");
  if (
    path.startsWith("/")
    || /^[a-z]:/iu.test(path)
    || path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new RangeError(`${label} must be a safe repository-relative path`);
  }
  return path;
}

function sha256(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new RangeError(`${label} must be a SHA-256 fingerprint`);
  return result;
}

function validateProductionIndex(input: unknown): Readonly<ProductionIndex> {
  const parsed = unknownRecord(input, "Production index");
  if (parsed.formatVersion !== 1) throw new RangeError("Production index must use formatVersion 1");
  const pipelineVersion = positiveInteger(parsed.pipelineVersion, "Production index pipelineVersion");
  const manifestSha256 = sha256(parsed.manifestSha256, "Production index manifestSha256");
  if (!Array.isArray(parsed.entries)) throw new TypeError("Production index entries must be an array");
  const ids = new Set<string>();
  const entries = parsed.entries.map((inputEntry, entryIndex): ProductionIndexEntry => {
    const label = `Production index entries[${entryIndex}]`;
    const entry = unknownRecord(inputEntry, label);
    const id = nonEmptyString(entry.id, `${label}.id`);
    if (ids.has(id)) throw new RangeError(`Duplicate production index ID ${id}`);
    ids.add(id);
    if (entry.lifecycle !== "candidate") throw new RangeError(`${label}.lifecycle must be candidate`);
    if (!Array.isArray(entry.sourceFiles) || entry.sourceFiles.length === 0) {
      throw new RangeError(`${label}.sourceFiles must contain at least one file`);
    }
    if (!Array.isArray(entry.layers) || entry.layers.length === 0) {
      throw new RangeError(`${label}.layers must contain at least one layer`);
    }
    const layerIds = new Set<string>();
    const layers = entry.layers.map((inputLayer, layerIndex): ProductionIndexLayer => {
      const layerLabel = `${label}.layers[${layerIndex}]`;
      const layer = unknownRecord(inputLayer, layerLabel);
      const layerId = nonEmptyString(layer.id, `${layerLabel}.id`);
      if (layerIds.has(layerId)) throw new RangeError(`${label} contains duplicate layer ID ${layerId}`);
      layerIds.add(layerId);
      return {
        id: layerId,
        file: repositoryPath(layer.file, `${layerLabel}.file`),
        width: positiveInteger(layer.width, `${layerLabel}.width`),
        height: positiveInteger(layer.height, `${layerLabel}.height`),
        sha256: sha256(layer.sha256, `${layerLabel}.sha256`),
      };
    });
    return {
      id,
      family: nonEmptyString(entry.family, `${label}.family`) as ProductionAssetFamily,
      lifecycle: "candidate",
      jobKey: sha256(entry.jobKey, `${label}.jobKey`),
      sourceFiles: entry.sourceFiles.map((file, sourceIndex) =>
        repositoryPath(file, `${label}.sourceFiles[${sourceIndex}]`)),
      layers,
      thumbnailFile: repositoryPath(entry.thumbnailFile, `${label}.thumbnailFile`),
      collisionDraftFile: repositoryPath(entry.collisionDraftFile, `${label}.collisionDraftFile`),
    };
  });
  return Object.freeze({ formatVersion: 1, pipelineVersion, manifestSha256, entries: Object.freeze(entries) });
}

function repositoryFileValue<T>(
  files: Readonly<Record<string, T>>,
  repositoryFile: string,
  label: string,
): T {
  const normalizedFile = repositoryFile.replaceAll("\\", "/");
  const matches = Object.entries(files).filter(([path]) => {
    const normalizedPath = path.replaceAll("\\", "/");
    return normalizedPath === normalizedFile || normalizedPath.endsWith(`/${normalizedFile}`);
  });
  if (matches.length !== 1) {
    throw new RangeError(`${label} expected exactly one Vite asset for ${repositoryFile}; found ${matches.length}`);
  }
  return matches[0][1];
}

function validateCandidateCollisionDraft(
  input: unknown,
  recipeId: string,
  fingerprint: string,
): Readonly<ProductionCandidateCollisionDraft> {
  const parsed = unknownRecord(input, `Collision draft for ${recipeId}`);
  if (parsed.recipeId !== recipeId) throw new RangeError(`Collision draft recipe ID does not match ${recipeId}`);
  if (parsed.candidateFingerprint !== fingerprint) {
    throw new RangeError(`Collision draft fingerprint does not match ${recipeId}`);
  }
  if (parsed.kind !== "hybrid-grid-draft") {
    throw new RangeError(`Collision draft for ${recipeId} must be a hybrid-grid-draft`);
  }
  const tileSize = positiveInteger(parsed.tileSize, `Collision draft ${recipeId}.tileSize`);
  const subcellSize = positiveInteger(parsed.subcellSize, `Collision draft ${recipeId}.subcellSize`);
  if (tileSize % subcellSize !== 0) throw new RangeError(`Collision draft ${recipeId} subcellSize must divide tileSize`);
  const inputGrid = unknownRecord(parsed.grid, `Collision draft ${recipeId}.grid`);
  const grid = Object.freeze({
    width: positiveInteger(inputGrid.width, `Collision draft ${recipeId}.grid.width`),
    height: positiveInteger(inputGrid.height, `Collision draft ${recipeId}.grid.height`),
    subcellColumns: positiveInteger(inputGrid.subcellColumns, `Collision draft ${recipeId}.grid.subcellColumns`),
    subcellRows: positiveInteger(inputGrid.subcellRows, `Collision draft ${recipeId}.grid.subcellRows`),
  });
  if (grid.subcellColumns !== grid.width * (tileSize / subcellSize)
    || grid.subcellRows !== grid.height * (tileSize / subcellSize)) {
    throw new RangeError(`Collision draft ${recipeId} grid dimensions do not match its cell sizes`);
  }
  if (!Array.isArray(parsed.solidSubcells)) {
    throw new TypeError(`Collision draft ${recipeId}.solidSubcells must be an array`);
  }
  const coordinates = new Set<string>();
  const solidSubcells = parsed.solidSubcells.map((inputPoint, pointIndex) => {
    const point = unknownRecord(inputPoint, `Collision draft ${recipeId}.solidSubcells[${pointIndex}]`);
    const x = positiveInteger(point.x, `Collision draft ${recipeId}.solidSubcells[${pointIndex}].x`, true);
    const y = positiveInteger(point.y, `Collision draft ${recipeId}.solidSubcells[${pointIndex}].y`, true);
    if (x >= grid.subcellColumns || y >= grid.subcellRows) {
      throw new RangeError(`Collision draft ${recipeId} solid subcell ${x},${y} is outside the grid`);
    }
    const key = `${x},${y}`;
    if (coordinates.has(key)) throw new RangeError(`Collision draft ${recipeId} repeats solid subcell ${key}`);
    coordinates.add(key);
    return Object.freeze({ x, y });
  });
  return Object.freeze({ kind: "hybrid-grid-draft", tileSize, subcellSize, grid, solidSubcells: Object.freeze(solidSubcells) });
}

function categoryForFamily(family: ProductionAssetFamily): AssetLibraryCategoryId {
  if (family === "island") return "islands";
  if (family === "vessel") return "vessels";
  return "world-features";
}

function productionReviewStates(input: unknown): ReadonlyMap<string, Readonly<{
  candidateFingerprint: string;
  decision: "approved" | "rejected";
}>> {
  const parsed = unknownRecord(input, "Production review store");
  if (parsed.formatVersion !== 1) throw new RangeError("Production review store must use formatVersion 1");
  if (!Array.isArray(parsed.decisions)) throw new TypeError("Production review store decisions must be an array");
  const decisions = new Map<string, Readonly<{
    candidateFingerprint: string;
    decision: "approved" | "rejected";
  }>>();
  for (const [index, inputDecision] of parsed.decisions.entries()) {
    const label = `Production review store decisions[${index}]`;
    const decision = unknownRecord(inputDecision, label);
    const recipeId = nonEmptyString(decision.recipeId, `${label}.recipeId`);
    if (decisions.has(recipeId)) throw new RangeError(`Production review store repeats ${recipeId}`);
    if (decision.decision !== "approved" && decision.decision !== "rejected") {
      throw new RangeError(`${label}.decision must be approved or rejected`);
    }
    decisions.set(recipeId, Object.freeze({
      candidateFingerprint: sha256(decision.candidateFingerprint, `${label}.candidateFingerprint`),
      decision: decision.decision,
    }));
  }
  return decisions;
}

function productionCandidateEntries(
  manifestInput: unknown,
  indexInput: unknown,
  reviewsInput: unknown,
  sourceImages: Readonly<Record<string, string>>,
  candidateImages: Readonly<Record<string, string>>,
  collisionDrafts: Readonly<Record<string, unknown>>,
): ProductionCandidateLibraryEntry[] {
  const manifest: Readonly<ProductionAssetRecipeManifest> = validateProductionAssetRecipeManifest(manifestInput);
  const index = validateProductionIndex(indexInput);
  const reviewStates = productionReviewStates(reviewsInput);
  const recipes = manifest.recipes.filter((recipe) => recipe.lifecycle === "source");
  const recipeIds = new Set(recipes.map((recipe) => recipe.id));
  const indexById = new Map(index.entries.map((entry) => [entry.id, entry]));
  for (const entry of index.entries) {
    if (!recipeIds.has(entry.id)) throw new RangeError(`Production index has no source recipe for ${entry.id}`);
  }
  return recipes.map((recipe): ProductionCandidateLibraryEntry => {
    const prepared = indexById.get(recipe.id);
    if (!prepared) throw new RangeError(`Production recipe ${recipe.id} has no prepared candidate`);
    if (prepared.family !== recipe.family) throw new RangeError(`Production candidate family does not match ${recipe.id}`);
    const recipeLayers = new Map(recipe.layers.map((layer) => [layer.id, layer]));
    const sourceLayers = recipe.layers.map((layer, order): AssetLibraryImageLayer => ({
      sourceKind: "image",
      id: `source.${layer.id}`,
      name: `${layer.name} source`,
      role: layer.role,
      order,
      url: repositoryFileValue(sourceImages, layer.sourceFile, `${recipe.id} source layer`),
      defaultVisible: layer.defaultVisible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
    }));
    const candidateLayers = prepared.layers.map((layer, order): AssetLibraryImageLayer => {
      const layerRecipe = recipeLayers.get(layer.id);
      if (!layerRecipe) throw new RangeError(`Production candidate ${recipe.id} has unknown layer ${layer.id}`);
      return {
        sourceKind: "image",
        id: `layer.${layer.id}`,
        name: layerRecipe.name,
        role: layerRecipe.role,
        order,
        url: repositoryFileValue(candidateImages, layer.file, `${recipe.id} candidate layer`),
        defaultVisible: layerRecipe.defaultVisible,
        opacity: layerRecipe.opacity,
        blendMode: layerRecipe.blendMode,
        pixelSize: { width: layer.width, height: layer.height },
      };
    });
    if (candidateLayers.length !== recipe.layers.length) {
      throw new RangeError(`Production candidate ${recipe.id} does not contain every recipe layer`);
    }
    const thumbnailUrl = repositoryFileValue(candidateImages, prepared.thumbnailFile, `${recipe.id} thumbnail`);
    const collisionDraftInput = repositoryFileValue(
      collisionDrafts,
      prepared.collisionDraftFile,
      `${recipe.id} collision draft`,
    );
    const collisionDraft = validateCandidateCollisionDraft(collisionDraftInput, recipe.id, prepared.jobKey);
    const currentReview = reviewStates.get(recipe.id);
    const reviewState = currentReview?.candidateFingerprint === prepared.jobKey
      ? currentReview.decision
      : "pending";
    return {
      id: recipe.id,
      entryType: "production-candidate",
      name: recipe.name,
      subtitle: "Prepared production candidate",
      categoryId: categoryForFamily(recipe.family),
      collection: recipe.collection,
      sortOrder: 25 + recipe.sortOrder,
      thumbnailUrl,
      tags: [...recipe.tags.filter((tag) => tag !== "source"), "candidate"],
      layers: candidateLayers,
      animations: recipe.animations.map((animation): AssetLibraryAnimationDescriptor => ({
        id: `animation.${animation.id}`,
        name: animation.name,
        kind: animation.kind,
        layerId: `layer.${animation.layerId}`,
        playback: "loop",
        frameSize: { width: animation.frameWidth, height: animation.frameHeight },
        frameCount: animation.frameCount,
        framesPerSecond: animation.framesPerSecond,
        directionCount: animation.directionCount,
      })),
      details: [
        {
          id: "production",
          name: "Production candidate",
          fields: [
            { id: "recipe-id", name: "Recipe ID", value: recipe.id },
            { id: "lifecycle", name: "Lifecycle", value: "Candidate" },
            { id: "review", name: "Review", value: titleFromSlug(reviewState) },
            { id: "fingerprint", name: "Fingerprint", value: prepared.jobKey },
            { id: "source", name: "Source", value: recipe.provenance.sourceFile },
          ],
        },
        {
          id: "collision",
          name: "Collision draft",
          fields: [
            { id: "profile", name: "Profile", value: "Hybrid grid draft" },
            { id: "tile-size", name: "Navigation cell", value: collisionDraft.tileSize, unit: "px" },
            { id: "subcell-size", name: "Collision subcell", value: collisionDraft.subcellSize, unit: "px" },
            { id: "solid-subcells", name: "Solid subcells", value: collisionDraft.solidSubcells.length },
          ],
        },
      ],
      recipe,
      fingerprint: prepared.jobKey,
      sourceLayers,
      candidateLayers,
      collisionDraftFile: prepared.collisionDraftFile,
      collisionDraft,
      lifecycle: "candidate",
      reviewState,
    };
  });
}

/** Converts a concept-art island filename into a reference-only library entry. */
export function conceptIslandReferenceEntry(path: string, url: string): ReferenceImageLibraryEntry {
  const fileName = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  const match = /^island_(.+)_(uninhabited|inhabited)_(\d+)\.png$/u.exec(fileName);
  if (!match) throw new RangeError(`Concept island filename does not match the catalog convention: ${fileName}`);
  const shapeSlug = match[1].replaceAll("_", "-");
  const settlement = match[2] as "inhabited" | "uninhabited";
  const sequence = Number.parseInt(match[3], 10);
  const name = titleFromSlug(shapeSlug);
  return {
    id: `reference.concept.island.${shapeSlug}.${sequence.toString().padStart(2, "0")}`,
    entryType: "reference-image",
    name,
    subtitle: `${titleFromSlug(settlement)} concept island`,
    categoryId: "islands",
    collection: "Concept example assets",
    sortOrder: 300 + sequence,
    thumbnailUrl: url,
    tags: ["island", "concept", "reference", settlement, ...shapeSlug.split("-")],
    layers: [{
      sourceKind: "image",
      id: "layer.reference",
      name: "Concept image",
      role: "reference",
      order: 0,
      url,
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
    }],
    animations: [],
    details: [{
      id: "reference",
      name: "Reference",
      fields: [
        { id: "shape", name: "Island form", value: name },
        { id: "settlement", name: "Settlement", value: titleFromSlug(settlement) },
        { id: "sequence", name: "Variant", value: sequence },
        { id: "runtime-status", name: "Runtime status", value: "Reference only" },
        { id: "file-name", name: "Source file", value: fileName },
      ],
    }],
    reference: {
      collectionId: "concept-example-islands",
      kind: "island",
      relativePath: `concept_art/example assets/islands/${fileName}`,
      fileName,
      sequence,
      shapeSlug,
      settlement,
      runtimeStatus: "reference-only",
    },
  };
}

/** Converts a concept-art shoal filename into a reference-only world-feature entry. */
export function conceptShoalReferenceEntry(path: string, url: string): ReferenceImageLibraryEntry {
  const fileName = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  const match = /^shoal_(.+)_(\d+)\.png$/u.exec(fileName);
  if (!match) throw new RangeError(`Concept shoal filename does not match the catalog convention: ${fileName}`);
  const shapeSlug = match[1].replaceAll("_", "-");
  const sequence = Number.parseInt(match[2], 10);
  const name = titleFromSlug(shapeSlug);
  return {
    id: `reference.concept.shoal.${shapeSlug}.${sequence.toString().padStart(2, "0")}`,
    entryType: "reference-image",
    name,
    subtitle: "Concept fishing shoal",
    categoryId: "world-features",
    collection: "Concept example assets",
    sortOrder: 300 + sequence,
    thumbnailUrl: url,
    tags: ["shoal", "concept", "reference", ...shapeSlug.split("-")],
    layers: [{
      sourceKind: "image",
      id: "layer.reference",
      name: "Concept image",
      role: "reference",
      order: 0,
      url,
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
    }],
    animations: [],
    details: [{
      id: "reference",
      name: "Reference",
      fields: [
        { id: "form", name: "Shoal form", value: name },
        { id: "sequence", name: "Variant", value: sequence },
        { id: "runtime-status", name: "Runtime status", value: "Reference only" },
        { id: "file-name", name: "Source file", value: fileName },
      ],
    }],
    reference: {
      collectionId: "concept-example-shoals",
      kind: "shoal",
      relativePath: `concept_art/example assets/shoals/${fileName}`,
      fileName,
      sequence,
      shapeSlug,
      runtimeStatus: "reference-only",
    },
  };
}

export function waterReferenceEntry(path: string, url: string): ReferenceImageLibraryEntry {
  const fileName = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  if (fileName !== "water-contact-sheet.png") {
    throw new RangeError(`Water reference filename does not match the catalog convention: ${fileName}`);
  }
  return {
    id: "reference.environment.water-contact-sheet",
    entryType: "reference-image",
    name: "Water Contact Sheet",
    subtitle: "Water environment reference",
    categoryId: "world-features",
    collection: "Water production references",
    sortOrder: 400,
    thumbnailUrl: url,
    tags: ["water", "environment", "reference", "tiles"],
    layers: [{
      sourceKind: "image",
      id: "layer.reference",
      name: "Water contact sheet",
      role: "reference",
      order: 0,
      url,
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
    }],
    animations: [],
    details: [{
      id: "reference",
      name: "Reference",
      fields: [
        { id: "kind", name: "Asset kind", value: "Environment" },
        { id: "runtime-status", name: "Runtime status", value: "Reference only" },
        { id: "file-name", name: "Source file", value: fileName },
      ],
    }],
    reference: {
      collectionId: "gr1-water-reference",
      kind: "environment",
      relativePath: "assets-src/gr1/water/runtime/water-contact-sheet.png",
      fileName,
      shapeSlug: "water-contact-sheet",
      runtimeStatus: "reference-only",
    },
  };
}

export function compareAssetLibraryEntries(
  left: Readonly<AssetLibraryEntry>,
  right: Readonly<AssetLibraryEntry>,
): number {
  return (CATEGORY_ORDER.get(left.categoryId) ?? Number.MAX_SAFE_INTEGER)
    - (CATEGORY_ORDER.get(right.categoryId) ?? Number.MAX_SAFE_INTEGER)
    || left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name, "en")
    || left.id.localeCompare(right.id, "en");
}

export function buildAssetLibraryCatalog(
  islandExampleImages: Readonly<Record<string, string>> = ISLAND_EXAMPLE_IMAGE_URLS,
  dependencies: Readonly<AssetLibraryCatalogDependencies> = {},
): readonly Readonly<AssetLibraryEntry>[] {
  const examples = Object.entries(islandExampleImages)
    .map(([path, url]) => islandReferenceEntry(path, url));
  const candidates = productionCandidateEntries(
    dependencies.productionRecipeManifest ?? productionRecipesJson,
    dependencies.productionIndex ?? productionIndexJson,
    dependencies.productionReviews ?? productionReviewsJson,
    dependencies.productionSourceImages ?? PRODUCTION_SOURCE_IMAGE_URLS,
    dependencies.productionCandidateImages ?? PRODUCTION_CANDIDATE_IMAGE_URLS,
    dependencies.productionCollisionDrafts ?? PRODUCTION_COLLISION_DRAFTS,
  );
  const conceptIslands = Object.entries(dependencies.conceptIslandImages ?? CONCEPT_ISLAND_IMAGE_URLS)
    .map(([path, url]) => conceptIslandReferenceEntry(path, url));
  const conceptShoals = Object.entries(dependencies.conceptShoalImages ?? CONCEPT_SHOAL_IMAGE_URLS)
    .map(([path, url]) => conceptShoalReferenceEntry(path, url));
  const waterReferences = Object.entries(dependencies.waterReferenceImages ?? WATER_REFERENCE_IMAGE_URLS)
    .map(([path, url]) => waterReferenceEntry(path, url));
  const entries = [
    ...authoredEntries(),
    ...candidates,
    ...examples,
    ...conceptIslands,
    ...conceptShoals,
    ...waterReferences,
  ].sort(compareAssetLibraryEntries);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new RangeError(`Duplicate asset library ID ${entry.id}`);
    ids.add(entry.id);
  }
  return Object.freeze(entries);
}

export function groupAssetLibraryEntries(
  entries: readonly Readonly<AssetLibraryEntry>[],
): readonly Readonly<AssetLibraryGroup>[] {
  return Object.freeze(ASSET_LIBRARY_CATEGORIES
    .map((category): AssetLibraryGroup => ({
      id: category.id,
      name: category.name,
      entries: Object.freeze(entries
        .filter((entry) => entry.categoryId === category.id)
        .slice()
        .sort(compareAssetLibraryEntries)),
    }))
    .filter((group) => group.entries.length > 0));
}

export function assetLibraryEntryById(
  id: string,
  entries: readonly Readonly<AssetLibraryEntry>[] = ASSET_LIBRARY_CATALOG,
): Readonly<AssetLibraryEntry> | undefined {
  return entries.find((entry) => entry.id === id);
}

export const ASSET_LIBRARY_CATALOG = buildAssetLibraryCatalog();
export const ASSET_LIBRARY_GROUPS = groupAssetLibraryEntries(ASSET_LIBRARY_CATALOG);
