import fishingShoalPackage from "./packages/fishing-shoal.json";
import homeIslandPackage from "./packages/home-island.json";
import playerBoatPackage from "./packages/player-boat.json";
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

/** Stable browser sections. Their order is deliberately independent of labels. */
export const ASSET_LIBRARY_CATEGORIES = Object.freeze([
  Object.freeze({ id: "islands", name: "Islands", order: 10 }),
  Object.freeze({ id: "vessels", name: "Vessels", order: 20 }),
  Object.freeze({ id: "world-features", name: "World features", order: 30 }),
] as const);

export type AssetLibraryCategoryId = (typeof ASSET_LIBRARY_CATEGORIES)[number]["id"];
export type AssetLibraryEntryType = "authored-package" | "reference-image";
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
  readonly blendMode: "normal";
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

interface AssetLibraryEntryBase {
  readonly id: string;
  readonly entryType: AssetLibraryEntryType;
  readonly name: string;
  readonly subtitle: string;
  readonly categoryId: AssetLibraryCategoryId;
  readonly collection: string;
  readonly sortOrder: number;
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

export interface IslandReferenceLibraryEntry extends AssetLibraryEntryBase {
  readonly entryType: "reference-image";
  readonly categoryId: "islands";
  readonly reference: Readonly<{
    collectionId: "gr1-island-examples";
    relativePath: string;
    fileName: string;
    sequence: number;
    shapeSlug: string;
    settlement: "inhabited" | "uninhabited";
    /** Examples are visual references only; they have no runtime package contract. */
    runtimeStatus: "reference-only";
  }>;
}

export type AssetLibraryEntry = AuthoredPackageLibraryEntry | IslandReferenceLibraryEntry;

export interface AssetLibraryGroup {
  readonly id: AssetLibraryCategoryId;
  readonly name: string;
  readonly entries: readonly Readonly<AssetLibraryEntry>[];
}

const ISLAND_EXAMPLE_IMAGE_URLS = import.meta.glob<string>(
  "../../../assets-src/gr1/island-examples/*.png",
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
      relativePath,
      fileName,
      sequence,
      shapeSlug,
      settlement,
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
): readonly Readonly<AssetLibraryEntry>[] {
  const examples = Object.entries(islandExampleImages)
    .map(([path, url]) => islandReferenceEntry(path, url));
  const entries = [...authoredEntries(), ...examples].sort(compareAssetLibraryEntries);
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
