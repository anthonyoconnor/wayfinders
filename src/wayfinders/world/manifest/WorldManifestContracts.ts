import type { GridPoint } from "../../core/types";

export const WORLD_MANIFEST_SCHEMA_VERSION = 1 as const;

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

export interface WorldManifestDimensionsV1 {
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
}

export interface WorldManifestBoundsV1 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface WorldManifestLandmarkV1 {
  readonly id: StableLandmarkId;
  readonly kind: WorldManifestLandmarkKind;
  readonly position: Readonly<GridPoint>;
}

/** Durable island facts. Runtime state and generated tile data do not belong here. */
export interface WorldManifestIslandV1 {
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
  readonly bounds: Readonly<WorldManifestBoundsV1>;
  readonly sourceKind: "authored" | "procedural";
  readonly authoredAssetId?: string;
}

export interface WorldManifestV1 {
  readonly schemaVersion: typeof WORLD_MANIFEST_SCHEMA_VERSION;
  /** Version of the deterministic generation algorithm, independent of schema. */
  readonly generatorVersion: string;
  readonly seed: number;
  /** Named density/settings profile, for example P2-normal. */
  readonly settingsProfileId: string;
  /** Optional build-produced hash of all generator settings. */
  readonly settingsFingerprint?: string;
  readonly authoredIslandCatalogRevision: string;
  readonly dimensions: Readonly<WorldManifestDimensionsV1>;
  readonly landmarks: readonly Readonly<WorldManifestLandmarkV1>[];
  readonly islands: readonly Readonly<WorldManifestIslandV1>[];
}

export type WorldManifestInputV1 = Omit<WorldManifestV1, "schemaVersion">;

export function stableIslandId(sourceId: number): StableIslandId {
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw new RangeError(`Island source ID must be a positive safe integer; received ${String(sourceId)}`);
  }
  return `island:${sourceId.toString().padStart(6, "0")}`;
}

export function stableLandmarkId(kind: WorldManifestLandmarkKind): StableLandmarkId {
  return `landmark:${kind}`;
}
