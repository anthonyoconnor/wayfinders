import type { GridPoint } from "../../core/types";
import type { WorldTopologyDefinition } from "../WorldTopology";
import {
  stableIslandId,
  stableLandmarkId,
  type WorldManifestBoundsV2,
  type WorldManifestIslandKind,
  type WorldManifestIslandSize,
  type WorldManifestIslandV2,
  type WorldManifestLandmarkV2,
  type WorldManifestWaterLayoutV2,
  type WorldManifestV2,
} from "./WorldManifestContracts";
import { createWorldManifestV2 } from "./WorldManifestCodec";

/** Structural input implemented by today's GeneratedIsland without importing its generator. */
export interface PlannedIslandFactsV2 {
  readonly id: number;
  readonly kind: WorldManifestIslandKind;
  readonly size: WorldManifestIslandSize;
  readonly center: Readonly<GridPoint>;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly outerRadius: number;
  readonly rotation: number;
  readonly shapeSeed: number;
  /** One island-local lifted rectangle; the manifest derives canonical pieces. */
  readonly bounds: Readonly<WorldManifestBoundsV2>;
  readonly sourceKind: "authored" | "procedural";
  readonly authoredAssetId?: string;
}

/** Structural form of the current fixed landmark inventory. */
export interface PlannedLandmarkFactsV2 {
  readonly homeCenter: Readonly<GridPoint>;
  readonly harbour: Readonly<GridPoint>;
  readonly dock: Readonly<GridPoint>;
  readonly homeReturnTile: Readonly<GridPoint>;
  readonly hiddenObstacleCenter: Readonly<GridPoint>;
  readonly hiddenResource: Readonly<GridPoint>;
}

export interface PlannedWorldFactsV2 {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
  readonly topology: Readonly<WorldTopologyDefinition>;
  readonly landmarks: Readonly<PlannedLandmarkFactsV2>;
  readonly islands: readonly Readonly<PlannedIslandFactsV2>[];
}

export interface PlannedWorldManifestMetadataV2 {
  readonly generatorVersion: string;
  readonly settingsProfileId: string;
  readonly settingsFingerprint?: string;
  readonly authoredIslandCatalogRevision: string;
  readonly waterLayout: Readonly<WorldManifestWaterLayoutV2>;
}

/**
 * Turns generator planning facts into a durable manifest. The generator may
 * call this between descriptor planning and tile rasterization without either
 * package importing the other.
 */
export function createManifestFromPlannedWorldV2(
  world: Readonly<PlannedWorldFactsV2>,
  metadata: Readonly<PlannedWorldManifestMetadataV2>,
): WorldManifestV2 {
  return createWorldManifestV2({
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
    topology: { ...world.topology },
    landmarks: landmarkDescriptors(world.landmarks),
    islands: world.islands.map((island) => islandDescriptor(island, world)),
    waterLayout: metadata.waterLayout,
  });
}

function islandDescriptor(
  island: Readonly<PlannedIslandFactsV2>,
  world: Pick<PlannedWorldFactsV2, "width" | "height" | "topology">,
): WorldManifestIslandV2 {
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
    footprint: {
      liftedBounds: { ...island.bounds },
      pieces: footprintPieces(island.bounds, world),
    },
    sourceKind: island.sourceKind,
    ...(island.authoredAssetId === undefined ? {} : { authoredAssetId: island.authoredAssetId }),
  };
}

function landmarkDescriptors(
  landmarks: Readonly<PlannedLandmarkFactsV2>,
): WorldManifestLandmarkV2[] {
  return [
    landmarkDescriptor("home-center", landmarks.homeCenter),
    landmarkDescriptor("harbour", landmarks.harbour),
    landmarkDescriptor("dock", landmarks.dock),
    landmarkDescriptor("home-return", landmarks.homeReturnTile),
    landmarkDescriptor("hidden-obstacle-center", landmarks.hiddenObstacleCenter),
    landmarkDescriptor("hidden-resource", landmarks.hiddenResource),
  ];
}

function landmarkDescriptor<K extends WorldManifestLandmarkV2["kind"]>(
  kind: K,
  position: Readonly<GridPoint>,
): WorldManifestLandmarkV2 & { readonly id: `landmark:${K}`; readonly kind: K } {
  return {
    id: stableLandmarkId(kind),
    kind,
    position: { ...position },
  } as WorldManifestLandmarkV2 & { readonly id: `landmark:${K}`; readonly kind: K };
}

function footprintPieces(
  bounds: Readonly<WorldManifestBoundsV2>,
  world: Pick<PlannedWorldFactsV2, "width" | "height" | "topology">,
): WorldManifestBoundsV2[] {
  const xPieces = axisPieces(bounds.minX, bounds.maxX, world.width, world.topology.x);
  const yPieces = axisPieces(bounds.minY, bounds.maxY, world.height, world.topology.y);
  const pieces: WorldManifestBoundsV2[] = [];
  for (const y of yPieces) {
    for (const x of xPieces) {
      pieces.push({ minX: x.min, minY: y.min, maxX: x.max, maxY: y.max });
    }
  }
  return pieces.sort((left, right) => left.minY - right.minY || left.minX - right.minX);
}

function axisPieces(
  minimum: number,
  maximum: number,
  span: number,
  topology: WorldTopologyDefinition["x"],
): Array<{ min: number; max: number }> {
  if (topology === "bounded") return [{ min: minimum, max: maximum }];
  const start = ((minimum % span) + span) % span;
  const end = start + maximum - minimum;
  return end < span
    ? [{ min: start, max: end }]
    : [{ min: start, max: span - 1 }, { min: 0, max: end - span }];
}
