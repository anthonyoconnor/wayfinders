import {
  authoredCellBlocksMovement,
  validateAuthoredAssetMetadata,
  type AuthoredAssetMetadata,
  type AuthoredFishingShoalMetadata,
  type AuthoredHomeIslandMetadata,
  type AuthoredPlayerBoatMetadata,
} from "./AuthoredAssetContracts.ts";
import { firstShipCollisionTime } from "../navigation/CollisionGeometry.ts";
import { solidRowsToCollisionMask } from "../world/CollisionMask.ts";
import type { WorldGrid } from "../world/WorldGrid.ts";

export const PILOT_COLLISION_VALIDATION_SHIP_HALF_EXTENT = 14;

export interface ExactCollisionValidationOptions {
  readonly shipHalfExtent?: number;
}

export interface ExactCollisionPackageSetInput {
  readonly homeIsland: unknown;
  readonly playerBoat: unknown;
  readonly fishingShoal?: unknown;
}

export interface ExactCollisionPackageSet {
  readonly homeIsland: Readonly<AuthoredHomeIslandMetadata>;
  readonly playerBoat: Readonly<AuthoredPlayerBoatMetadata>;
  readonly fishingShoal?: Readonly<AuthoredFishingShoalMetadata>;
}

interface CollisionGridView {
  readonly width: number;
  readonly height: number;
  readonly fineCollisionCellCount: number;
  inBounds(x: number, y: number): boolean;
  getFineCollisionMaskAtIndex(index: number): number | undefined;
  isMovementBlockedAtIndex(index: number): boolean;
}

function createCollisionGrid(metadata: Readonly<AuthoredHomeIslandMetadata>): CollisionGridView {
  const blocked = new Uint8Array(metadata.grid.width * metadata.grid.height);
  for (const cell of metadata.grid.cells) {
    blocked[cell.y * metadata.grid.width + cell.x] = authoredCellBlocksMovement(cell) ? 1 : 0;
  }
  const fineMasks = new Map<number, number>();
  for (const cell of metadata.collision?.mixedCells ?? []) {
    fineMasks.set(
      cell.y * metadata.grid.width + cell.x,
      solidRowsToCollisionMask(cell.solidRows),
    );
  }
  return Object.freeze({
    width: metadata.grid.width,
    height: metadata.grid.height,
    fineCollisionCellCount: fineMasks.size,
    inBounds: (x: number, y: number) => (
      Number.isInteger(x)
      && Number.isInteger(y)
      && x >= 0
      && y >= 0
      && x < metadata.grid.width
      && y < metadata.grid.height
    ),
    getFineCollisionMaskAtIndex: (index: number) => fineMasks.get(index),
    isMovementBlockedAtIndex: (index: number) => blocked[index] !== 0,
  });
}

/**
 * Exact package-local clearance validation shared by browser export and the
 * Node intake command. It deliberately calls the runtime sweep geometry rather
 * than approximating anchors from occupied navigation cells.
 */
export function validateExactHomeIslandCollision(
  metadata: Readonly<AuthoredHomeIslandMetadata>,
  options: Readonly<ExactCollisionValidationOptions> = {},
): Readonly<AuthoredHomeIslandMetadata> {
  const shipHalfExtent = options.shipHalfExtent ?? PILOT_COLLISION_VALIDATION_SHIP_HALF_EXTENT;
  if (!Number.isFinite(shipHalfExtent) || shipHalfExtent <= 0 || shipHalfExtent >= metadata.tileSize / 2) {
    throw new RangeError("shipHalfExtent must be positive and smaller than half the authored tileSize");
  }
  const world = createCollisionGrid(metadata) as unknown as WorldGrid;
  const config = {
    navigation: { tileSize: metadata.tileSize },
    movement: { shipCollisionHalfExtent: shipHalfExtent },
  } as Parameters<typeof firstShipCollisionTime>[5];
  const index = (x: number, y: number): number => y * metadata.grid.width + x;
  const point = (cellIndex: number): Readonly<{ x: number; y: number }> => ({
    x: cellIndex % metadata.grid.width,
    y: Math.floor(cellIndex / metadata.grid.width),
  });
  const centre = (x: number, y: number): Readonly<{ x: number; y: number }> => ({
    x: (x + 0.5) * metadata.tileSize,
    y: (y + 0.5) * metadata.tileSize,
  });
  const isPassable = (x: number, y: number): boolean => {
    const value = centre(x, y);
    return firstShipCollisionTime(world, value.x, value.y, value.x, value.y, config) === undefined;
  };
  const canTraverse = (from: number, to: number): boolean => {
    const fromPoint = point(from);
    const toPoint = point(to);
    if (Math.abs(fromPoint.x - toPoint.x) + Math.abs(fromPoint.y - toPoint.y) !== 1) return false;
    if (!isPassable(fromPoint.x, fromPoint.y) || !isPassable(toPoint.x, toPoint.y)) return false;
    const fromCentre = centre(fromPoint.x, fromPoint.y);
    const toCentre = centre(toPoint.x, toPoint.y);
    return firstShipCollisionTime(
      world,
      fromCentre.x,
      fromCentre.y,
      toCentre.x,
      toCentre.y,
      config,
    ) === undefined;
  };

  for (const name of ["harbour", "dock", "homeReturn", "service"] as const) {
    const anchor = metadata.anchors[name];
    if (!isPassable(anchor.x, anchor.y)) {
      throw new RangeError(`Authored home anchors.${name} lacks ship clearance`);
    }
  }

  const dock = metadata.anchors.dock;
  const queue = [index(dock.x, dock.y)];
  const visited = new Set<number>(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = point(queue[cursor]);
    if (
      current.x === 0
      || current.y === 0
      || current.x === metadata.grid.width - 1
      || current.y === metadata.grid.height - 1
    ) return metadata;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= metadata.grid.width || y >= metadata.grid.height) continue;
      const candidate = index(x, y);
      if (visited.has(candidate) || !canTraverse(queue[cursor], candidate)) continue;
      visited.add(candidate);
      queue.push(candidate);
    }
  }
  throw new RangeError("Authored home dock has no ship-clearance-safe path to the asset-grid edge");
}

export function validateExactAuthoredAssetMetadata(
  value: unknown,
  options: Readonly<ExactCollisionValidationOptions> = {},
): Readonly<AuthoredAssetMetadata> {
  const metadata = validateAuthoredAssetMetadata(value);
  if (metadata.kind === "home-island") validateExactHomeIslandCollision(metadata, options);
  return metadata;
}

/**
 * Validates the package set as one collision authority. A player-hull edit can
 * otherwise be valid in isolation while making the already accepted home dock
 * unreachable, so intake must evaluate the home with the proposed hull size.
 */
export function validateExactCollisionPackageSet(
  input: Readonly<ExactCollisionPackageSetInput>,
  options: Readonly<ExactCollisionValidationOptions> = {},
): Readonly<ExactCollisionPackageSet> {
  const homeIsland = validateAuthoredAssetMetadata(input.homeIsland);
  if (homeIsland.kind !== "home-island") {
    throw new TypeError("Exact collision package set homeIsland must be a home-island package");
  }
  const playerBoat = validateAuthoredAssetMetadata(input.playerBoat);
  if (playerBoat.kind !== "player-boat") {
    throw new TypeError("Exact collision package set playerBoat must be a player-boat package");
  }
  let fishingShoal: Readonly<AuthoredFishingShoalMetadata> | undefined;
  if (input.fishingShoal !== undefined) {
    const validated = validateAuthoredAssetMetadata(input.fishingShoal);
    if (validated.kind !== "fishing-shoal") {
      throw new TypeError("Exact collision package set fishingShoal must be a fishing-shoal package");
    }
    fishingShoal = validated;
  }

  const shipHalfExtent = playerBoat.collision?.halfSize.width
    ?? options.shipHalfExtent
    ?? PILOT_COLLISION_VALIDATION_SHIP_HALF_EXTENT;
  validateExactHomeIslandCollision(homeIsland, { shipHalfExtent });
  return Object.freeze({
    homeIsland,
    playerBoat,
    ...(fishingShoal ? { fishingShoal } : {}),
  });
}
