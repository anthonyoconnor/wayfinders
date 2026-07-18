import type { GridPoint } from "../../core/types";
import type { WorldTopologyDefinition } from "../WorldTopology";

export const WORLD_MANIFEST_SCHEMA_VERSION = 2 as const;

export const WORLD_MANIFEST_LANDMARK_KINDS = Object.freeze([
  "dock",
  "harbour",
  "hidden-obstacle-center",
  "hidden-resource",
  "home-center",
  "home-return",
] as const);

export const WORLD_MANIFEST_ISLAND_KINDS = Object.freeze([
  "atoll",
  "high-island",
  "low-cay",
  "rocky-skerry",
] as const);

export const WORLD_MANIFEST_ISLAND_SIZES = Object.freeze([
  "large",
  "medium",
  "small",
] as const);

export type WorldManifestLandmarkKind = typeof WORLD_MANIFEST_LANDMARK_KINDS[number];
export type WorldManifestIslandKind = typeof WORLD_MANIFEST_ISLAND_KINDS[number];
export type WorldManifestIslandSize = typeof WORLD_MANIFEST_ISLAND_SIZES[number];

export type StableIslandId = `island:${string}`;
export type StableLandmarkId = `landmark:${WorldManifestLandmarkKind}`;
export type StableWaterRegionId = `water:${string}`;

export interface WorldManifestDimensionsV2 {
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
}

export interface WorldManifestBoundsV2 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface WorldManifestLandmarkV2 {
  readonly id: StableLandmarkId;
  readonly kind: WorldManifestLandmarkKind;
  readonly position: Readonly<GridPoint>;
}

interface WorldManifestWaterRegionBaseV2 {
  readonly id: StableWaterRegionId;
  readonly typeId: string;
  readonly seed: number;
}

export interface WorldManifestWaterEllipseRegionV2 extends WorldManifestWaterRegionBaseV2 {
  readonly strategy: "ellipse";
  readonly typeId: string;
  readonly center: Readonly<{ x: number; y: number }>;
  readonly radiusX: number;
  readonly radiusY: number;
}

export interface WorldManifestWaterRibbonRegionV2 extends WorldManifestWaterRegionBaseV2 {
  readonly strategy: "ribbon";
  readonly typeId: string;
  readonly start: Readonly<{ x: number; y: number }>;
  readonly end: Readonly<{ x: number; y: number }>;
  /** Whole-world offsets applied to `end` before measuring the ribbon. */
  readonly imageOffset: Readonly<{ x: number; y: number }>;
  readonly width: number;
}

export type WorldManifestWaterRegionV2 =
  | WorldManifestWaterEllipseRegionV2
  | WorldManifestWaterRibbonRegionV2;

export interface WorldManifestWaterLayoutV2 {
  readonly version: string;
  readonly catalogFingerprint: string;
  readonly regions: readonly Readonly<WorldManifestWaterRegionV2>[];
}

/**
 * One island-local lifted rectangle and its exact canonical decomposition.
 * The lifted bounds preserve local geometry while the at-most-four pieces are
 * the only rectangles used for canonical indexing and presentation lookup.
 */
export interface WorldManifestWrappedFootprintV2 {
  readonly liftedBounds: Readonly<WorldManifestBoundsV2>;
  readonly pieces: readonly Readonly<WorldManifestBoundsV2>[];
}

/** Durable island facts. Runtime state and generated tile data do not belong here. */
export interface WorldManifestIslandV2 {
  /** Stable across traversal-order changes; derived from sourceId, never array position. */
  readonly id: StableIslandId;
  /** Existing numeric island identity used by the prototype grid and feature systems. */
  readonly sourceId: number;
  readonly kind: WorldManifestIslandKind;
  readonly size: WorldManifestIslandSize;
  readonly center: Readonly<GridPoint>;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly outerRadius: number;
  readonly rotation: number;
  readonly shapeSeed: number;
  readonly footprint: Readonly<WorldManifestWrappedFootprintV2>;
  readonly sourceKind: "authored" | "procedural";
  readonly authoredAssetId?: string;
}

export interface WorldManifestV2 {
  readonly schemaVersion: typeof WORLD_MANIFEST_SCHEMA_VERSION;
  /** Version of the deterministic generation algorithm, independent of schema. */
  readonly generatorVersion: string;
  readonly seed: number;
  /** Named density/settings profile, for example P2-normal. */
  readonly settingsProfileId: string;
  /** Optional build-produced hash of all generator settings. */
  readonly settingsFingerprint?: string;
  readonly authoredIslandCatalogRevision: string;
  readonly dimensions: Readonly<WorldManifestDimensionsV2>;
  readonly topology: Readonly<WorldTopologyDefinition>;
  readonly landmarks: readonly Readonly<WorldManifestLandmarkV2>[];
  readonly islands: readonly Readonly<WorldManifestIslandV2>[];
  readonly waterLayout: Readonly<WorldManifestWaterLayoutV2>;
}

export type WorldManifestInputV2 = Omit<WorldManifestV2, "schemaVersion">;

export function stableIslandId(sourceId: number): StableIslandId {
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw new RangeError(`Island source ID must be a positive safe integer; received ${String(sourceId)}`);
  }
  return `island:${sourceId.toString().padStart(6, "0")}`;
}

export function stableLandmarkId(kind: WorldManifestLandmarkKind): StableLandmarkId {
  return `landmark:${kind}`;
}
