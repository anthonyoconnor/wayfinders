import type { PrototypeConfig } from "../../config/prototypeConfig";
import type { GridPoint } from "../../core/types";
import type {
  GeneratedIsland,
  IslandKind,
  IslandSize,
  IslandBounds,
  IslandPlacementRejection,
} from "../IslandGenerator";
import type { AuthoredIslandCatalogEntry } from "../AuthoredIslandCatalog";
import type { IslandPlacementIndex } from "../IslandPlacementIndex";
import type { WorldTopology } from "../WorldTopology";

export interface IslandPlacementProfile extends Omit<GeneratedIsland, "center" | "bounds"> {}

export interface AuthoredStarterLaneBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Stable FNV-1a identity used by existing authored-island shelf generation. */
export function stableIslandAssetHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function createAuthoredIslandPlacementProfile(
  sourceId: number,
  entry: Readonly<AuthoredIslandCatalogEntry>,
  config: Pick<PrototypeConfig, "islands">,
): IslandPlacementProfile {
  const radiusX = entry.gridWidth / 2;
  const radiusY = entry.gridHeight / 2;
  const major = Math.max(radiusX, radiusY);
  return {
    id: sourceId,
    kind: "low-cay" as IslandKind,
    size: major <= config.islands.minRadius
      ? "small" as IslandSize
      : major >= config.islands.maxRadius * 0.75 ? "large" as IslandSize : "medium" as IslandSize,
    radiusX,
    radiusY,
    outerRadius: Math.hypot(Math.ceil(radiusX), Math.ceil(radiusY)) + config.islands.apronWidth,
    rotation: 0,
    shapeSeed: stableIslandAssetHash(entry.assetId),
    sourceKind: "authored",
    authoredAssetId: entry.assetId,
    authoredCollision: {
      gridWidth: entry.gridWidth,
      gridHeight: entry.gridHeight,
      solidSubcells: entry.solidSubcells,
    },
  };
}

/** Exact finite lifted opening corridor used by periodic island placement. */
export function intersectsPeriodicStarterLane(
  topology: Readonly<WorldTopology>,
  dock: Readonly<GridPoint>,
  center: Readonly<GridPoint>,
  outerRadius: number,
  corridorHalfWidth: number,
): boolean {
  const lane = authoredStarterLaneBounds(topology, dock, corridorHalfWidth);
  const imageXs = topology.wrapsX ? [-topology.tileWidth, 0, topology.tileWidth] : [0];
  const imageYs = topology.wrapsY ? [-topology.tileHeight, 0, topology.tileHeight] : [0];
  for (const imageY of imageYs) {
    for (const imageX of imageXs) {
      const liftedX = center.x + imageX;
      const liftedY = center.y + imageY;
      const closestX = Math.max(lane.minX, Math.min(lane.maxX, liftedX));
      const closestY = Math.max(lane.minY, Math.min(lane.maxY, liftedY));
      if (Math.hypot(liftedX - closestX, liftedY - closestY) <= outerRadius) return true;
    }
  }
  return false;
}

/** Exact lifted bounds shared by starter-lane validation and editor presentation. */
export function authoredStarterLaneBounds(
  topology: Readonly<WorldTopology>,
  dock: Readonly<GridPoint>,
  corridorHalfWidth: number,
): Readonly<AuthoredStarterLaneBounds> {
  if (!Number.isFinite(corridorHalfWidth) || corridorHalfWidth < 0) {
    throw new RangeError("Starter-lane half-width must be non-negative");
  }
  return Object.freeze({
    minX: dock.x,
    minY: dock.y - corridorHalfWidth,
    maxX: dock.x + Math.floor(topology.tileWidth / 2),
    maxY: dock.y + corridorHalfWidth,
  });
}

export function minimumIslandHomeDistance(
  profile: Readonly<IslandPlacementProfile>,
  config: Pick<PrototypeConfig, "world" | "islands">,
): number {
  return config.world.supportedWaterRadius
    + config.world.supportedBoundaryNoise
    + config.islands.homeClearance
    + profile.outerRadius;
}

/** Equal half-channel halos overlap exactly when two island placements conflict. */
export function islandPlacementChannelHaloRadius(
  profile: Readonly<IslandPlacementProfile>,
  config: Pick<PrototypeConfig, "islands">,
): number {
  return profile.outerRadius + config.islands.minimumChannelWidth / 2;
}

export function islandPlacementProfileExtent(
  profile: Readonly<IslandPlacementProfile>,
): Readonly<{ width: number; height: number }> {
  if (profile.sourceKind === "authored" && profile.authoredCollision) {
    return Object.freeze({
      width: profile.authoredCollision.gridWidth,
      height: profile.authoredCollision.gridHeight,
    });
  }
  const extent = Math.ceil(profile.outerRadius);
  return Object.freeze({ width: extent * 2 + 1, height: extent * 2 + 1 });
}

export function islandPlacementRejection(
  topology: Readonly<WorldTopology>,
  home: Readonly<GridPoint>,
  dock: Readonly<GridPoint>,
  profile: Readonly<IslandPlacementProfile>,
  center: Readonly<GridPoint>,
  placementIndex: IslandPlacementIndex,
  config: Pick<PrototypeConfig, "world" | "islands">,
): IslandPlacementRejection | undefined {
  const homeDisplacement = topology.minimumImageTileDisplacement(home, center);
  if (Math.hypot(homeDisplacement.x, homeDisplacement.y) < minimumIslandHomeDistance(profile, config)) {
    return "home-clearance";
  }
  if (intersectsPeriodicStarterLane(
    topology,
    dock,
    center,
    profile.outerRadius,
    config.islands.safeCorridorHalfWidth,
  )) return "starter-lane";
  if (placementIndex.findConflict(center, profile.outerRadius)) return "island-channel";
  return undefined;
}

export function finishIslandPlacement(
  profile: Readonly<IslandPlacementProfile>,
  center: Readonly<GridPoint>,
): GeneratedIsland {
  let bounds: IslandBounds;
  if (profile.sourceKind === "authored" && profile.authoredCollision) {
    const minX = center.x - Math.floor(profile.authoredCollision.gridWidth / 2);
    const minY = center.y - Math.floor(profile.authoredCollision.gridHeight / 2);
    bounds = {
      minX,
      minY,
      maxX: minX + profile.authoredCollision.gridWidth - 1,
      maxY: minY + profile.authoredCollision.gridHeight - 1,
    };
  } else {
    const extent = Math.ceil(profile.outerRadius);
    bounds = {
      minX: center.x - extent,
      minY: center.y - extent,
      maxX: center.x + extent,
      maxY: center.y + extent,
    };
  }
  return {
    ...profile,
    center: { ...center },
    bounds,
  };
}
