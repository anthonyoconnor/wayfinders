import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import { solidRowsToCollisionMask } from "../world/CollisionMask";
import { KnowledgeState, TerrainType } from "../world/TileData";
import type { WorldLandmarks } from "../world/WorldGenerator";
import { WorldGrid } from "../world/WorldGrid";
import { BOUNDED_WORLD_TOPOLOGY } from "../world/WorldTopology";
import {
  authoredTerrainToTerrainType,
  validateAuthoredAssetMetadata,
  type AuthoredHomeIslandMetadata,
} from "./AuthoredAssetContracts";
import homeIslandPackage from "./packages/home-island.json";

function validatedHomeIslandPackage(): Readonly<AuthoredHomeIslandMetadata> {
  const metadata = validateAuthoredAssetMetadata(homeIslandPackage);
  if (metadata.kind !== "home-island") throw new TypeError("Pilot home package is not a home-island asset");
  return metadata;
}

export const PILOT_HOME_ISLAND_METADATA = validatedHomeIslandPackage();

export interface AuthoredHomeIslandPlacement {
  topLeft: Readonly<GridPoint>;
  landmarks: Pick<WorldLandmarks, "homeCenter" | "harbour" | "dock" | "homeReturnTile">;
  service: Readonly<GridPoint>;
}

/**
 * Resolves the authored package anchors without touching world storage. World
 * manifest planning uses this to establish stable landmark facts before the
 * logical rasterization phase begins.
 */
export function resolveAuthoredHomeIslandPlacement(
  placementAnchor: Readonly<GridPoint>,
  metadata: Readonly<AuthoredHomeIslandMetadata> = PILOT_HOME_ISLAND_METADATA,
): Readonly<AuthoredHomeIslandPlacement> {
  const topLeft = Object.freeze({
    x: placementAnchor.x - metadata.grid.placementOrigin.x,
    y: placementAnchor.y - metadata.grid.placementOrigin.y,
  });
  return Object.freeze({
    topLeft,
    landmarks: Object.freeze({
      homeCenter: Object.freeze(translate(metadata.anchors.homeCenter, topLeft)),
      harbour: Object.freeze(translate(metadata.anchors.harbour, topLeft)),
      dock: Object.freeze(translate(metadata.anchors.dock, topLeft)),
      homeReturnTile: Object.freeze(translate(metadata.anchors.homeReturn, topLeft)),
    }),
    service: Object.freeze(translate(metadata.anchors.service, topLeft)),
  });
}

/**
 * Runs package collision through the same exact ship-clearance checks used by
 * world generation without mutating a live world. Intended for candidate
 * validation before an authored package can be exported or accepted.
 */
export function validateAuthoredHomeIslandCollision(
  metadata: Readonly<AuthoredHomeIslandMetadata>,
  config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
): Readonly<AuthoredHomeIslandMetadata> {
  const localGrid = new WorldGrid(
    metadata.grid.width,
    metadata.grid.height,
    config.navigation.chunkSize,
    BOUNDED_WORLD_TOPOLOGY,
    config.navigation.tileSize,
  );
  localGrid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  stampAuthoredHomeIsland(localGrid, metadata.grid.placementOrigin, metadata, config);
  return metadata;
}

function translate(point: Readonly<GridPoint>, topLeft: Readonly<GridPoint>): GridPoint {
  return { x: topLeft.x + point.x, y: topLeft.y + point.y };
}

/** Stamps one indivisible authored home layout at a procedural world anchor. */
export function stampAuthoredHomeIsland(
  grid: WorldGrid,
  placementAnchor: Readonly<GridPoint>,
  metadata: Readonly<AuthoredHomeIslandMetadata> = PILOT_HOME_ISLAND_METADATA,
  config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
): Readonly<AuthoredHomeIslandPlacement> {
  const placement = resolveAuthoredHomeIslandPlacement(placementAnchor, metadata);
  const { topLeft } = placement;
  if (
    topLeft.x < 0
    || topLeft.y < 0
    || topLeft.x + metadata.grid.width > grid.width
    || topLeft.y + metadata.grid.height > grid.height
  ) {
    throw new RangeError(
      `Authored home island ${metadata.grid.width}x${metadata.grid.height} does not fit at (${placementAnchor.x}, ${placementAnchor.y})`,
    );
  }

  for (const cell of metadata.grid.cells) {
    const x = topLeft.x + cell.x;
    const y = topLeft.y + cell.y;
    grid.setTerrain(x, y, authoredTerrainToTerrainType(cell.terrain));
    grid.setIslandId(x, y, cell.belongsToHomeIsland ? 0 : -1);
  }
  if (metadata.collision) {
    for (const cell of metadata.collision.mixedCells) {
      grid.setFineCollisionMask(
        topLeft.x + cell.x,
        topLeft.y + cell.y,
        solidRowsToCollisionMask(cell.solidRows),
      );
    }
  }

  assertRequiredWaterConnectivity(grid, topLeft, metadata, config);

  return placement;
}

function assertRequiredWaterConnectivity(
  grid: WorldGrid,
  topLeft: Readonly<GridPoint>,
  metadata: Readonly<AuthoredHomeIslandMetadata>,
  config: Pick<PrototypeConfig, "navigation" | "movement">,
): void {
  const graph = new GridGraph(grid, config);
  for (const name of ["harbour", "dock", "homeReturn", "service"] as const) {
    const anchor = translate(metadata.anchors[name], topLeft);
    if (!graph.isNavigationNodePassable(grid.index(anchor.x, anchor.y))) {
      throw new RangeError(`Authored home anchors.${name} lacks ship clearance`);
    }
  }

  const dock = translate(metadata.anchors.dock, topLeft);
  const queue = [grid.index(dock.x, dock.y)];
  const visited = new Set<number>(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    const point = grid.pointFromIndex(index);
    const localX = point.x - topLeft.x;
    const localY = point.y - topLeft.y;
    if (
      localX === 0
      || localY === 0
      || localX === metadata.grid.width - 1
      || localY === metadata.grid.height - 1
    ) return;
    graph.forEachTraversableCardinalEdge(index, (neighbor, x, y) => {
      if (
        visited.has(neighbor)
        || x < topLeft.x
        || y < topLeft.y
        || x >= topLeft.x + metadata.grid.width
        || y >= topLeft.y + metadata.grid.height
      ) return;
      visited.add(neighbor);
      queue.push(neighbor);
    });
  }
  throw new RangeError("Authored home dock has no ship-clearance-safe path to the asset-grid edge");
}
