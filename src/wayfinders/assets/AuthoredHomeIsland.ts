import type { GridPoint } from "../core/types";
import type { WorldLandmarks } from "../world/WorldGenerator";
import type { WorldGrid } from "../world/WorldGrid";
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

function translate(point: Readonly<GridPoint>, topLeft: Readonly<GridPoint>): GridPoint {
  return { x: topLeft.x + point.x, y: topLeft.y + point.y };
}

/** Stamps one indivisible authored home layout at a procedural world anchor. */
export function stampAuthoredHomeIsland(
  grid: WorldGrid,
  placementAnchor: Readonly<GridPoint>,
  metadata: Readonly<AuthoredHomeIslandMetadata> = PILOT_HOME_ISLAND_METADATA,
): Readonly<AuthoredHomeIslandPlacement> {
  const topLeft = {
    x: placementAnchor.x - metadata.grid.placementOrigin.x,
    y: placementAnchor.y - metadata.grid.placementOrigin.y,
  };
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

  return Object.freeze({
    topLeft: Object.freeze(topLeft),
    landmarks: Object.freeze({
      homeCenter: Object.freeze(translate(metadata.anchors.homeCenter, topLeft)),
      harbour: Object.freeze(translate(metadata.anchors.harbour, topLeft)),
      dock: Object.freeze(translate(metadata.anchors.dock, topLeft)),
      homeReturnTile: Object.freeze(translate(metadata.anchors.homeReturn, topLeft)),
    }),
    service: Object.freeze(translate(metadata.anchors.service, topLeft)),
  });
}
