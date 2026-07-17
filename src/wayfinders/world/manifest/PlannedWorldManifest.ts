import type { GridPoint } from "../../core/types";
import {
  stableIslandId,
  stableLandmarkId,
  type WorldManifestBoundsV1,
  type WorldManifestIslandKind,
  type WorldManifestIslandSize,
  type WorldManifestIslandV1,
  type WorldManifestLandmarkV1,
  type WorldManifestWaterLayoutV1,
  type WorldManifestV1,
} from "./WorldManifestContracts";
import { createWorldManifestV1 } from "./WorldManifestCodec";

/** Structural input implemented by today's GeneratedIsland without importing its generator. */
export interface PlannedIslandFactsV1 {
  readonly id: number;
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

/** Structural form of the current fixed landmark inventory. */
export interface PlannedLandmarkFactsV1 {
  readonly homeCenter: Readonly<GridPoint>;
  readonly harbour: Readonly<GridPoint>;
  readonly dock: Readonly<GridPoint>;
  readonly homeReturnTile: Readonly<GridPoint>;
  readonly hiddenObstacleCenter: Readonly<GridPoint>;
  readonly hiddenResource: Readonly<GridPoint>;
}

export interface PlannedWorldFactsV1 {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
  readonly landmarks: Readonly<PlannedLandmarkFactsV1>;
  readonly islands: readonly Readonly<PlannedIslandFactsV1>[];
}

export interface PlannedWorldManifestMetadataV1 {
  readonly generatorVersion: string;
  readonly settingsProfileId: string;
  readonly settingsFingerprint?: string;
  readonly authoredIslandCatalogRevision: string;
  readonly waterLayout: Readonly<WorldManifestWaterLayoutV1>;
}

/**
 * Turns generator planning facts into a durable manifest. The generator may
 * call this between descriptor planning and tile rasterization without either
 * package importing the other.
 */
export function createManifestFromPlannedWorldV1(
  world: Readonly<PlannedWorldFactsV1>,
  metadata: Readonly<PlannedWorldManifestMetadataV1>,
): WorldManifestV1 {
  return createWorldManifestV1({
    generatorVersion: metadata.generatorVersion,
    seed: world.seed,
    settingsProfileId: metadata.settingsProfileId,
    authoredIslandCatalogRevision: metadata.authoredIslandCatalogRevision,
    ...(metadata.settingsFingerprint === undefined
      ? {}
      : { settingsFingerprint: metadata.settingsFingerprint }),
    dimensions: {
      width: world.width,
      height: world.height,
      chunkSize: world.chunkSize,
    },
    landmarks: landmarkDescriptors(world.landmarks),
    islands: world.islands.map(islandDescriptor),
    waterLayout: metadata.waterLayout,
  });
}

function islandDescriptor(island: Readonly<PlannedIslandFactsV1>): WorldManifestIslandV1 {
  return {
    id: stableIslandId(island.id),
    sourceId: island.id,
    kind: island.kind,
    size: island.size,
    center: { ...island.center },
    radiusX: island.radiusX,
    radiusY: island.radiusY,
    outerRadius: island.outerRadius,
    rotation: island.rotation,
    shapeSeed: island.shapeSeed,
    bounds: { ...island.bounds },
    sourceKind: island.sourceKind,
    ...(island.authoredAssetId === undefined ? {} : { authoredAssetId: island.authoredAssetId }),
  };
}

function landmarkDescriptors(
  landmarks: Readonly<PlannedLandmarkFactsV1>,
): WorldManifestLandmarkV1[] {
  return [
    landmarkDescriptor("home-center", landmarks.homeCenter),
    landmarkDescriptor("harbour", landmarks.harbour),
    landmarkDescriptor("dock", landmarks.dock),
    landmarkDescriptor("home-return", landmarks.homeReturnTile),
    landmarkDescriptor("hidden-obstacle-center", landmarks.hiddenObstacleCenter),
    landmarkDescriptor("hidden-resource", landmarks.hiddenResource),
  ];
}

function landmarkDescriptor<K extends WorldManifestLandmarkV1["kind"]>(
  kind: K,
  position: Readonly<GridPoint>,
): WorldManifestLandmarkV1 & { readonly id: `landmark:${K}`; readonly kind: K } {
  return {
    id: stableLandmarkId(kind),
    kind,
    position: { ...position },
  } as WorldManifestLandmarkV1 & { readonly id: `landmark:${K}`; readonly kind: K };
}
