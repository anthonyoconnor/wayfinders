import type { GridPoint } from "../core/types.ts";
import {
  TerrainType,
  terrainBlocksMovement,
  terrainBlocksSight,
} from "../world/TileData.ts";

export const AUTHORED_ASSET_CONTRACT_VERSION = 1 as const;
export const AUTHORED_COLLISION_SUBCELL_SIZE = 8 as const;

export const AUTHORED_ASSET_IDS = Object.freeze({
  homeIsland: "home.island.primary",
  playerBoat: "player.boat.primary",
  fishingShoal: "shoal.fishing.primary",
} as const);

export type AuthoredAssetId = (typeof AUTHORED_ASSET_IDS)[keyof typeof AUTHORED_ASSET_IDS];
export type AuthoredAssetKind = "home-island" | "player-boat" | "fishing-shoal";

export const AUTHORED_TERRAINS = Object.freeze({
  deepOcean: "deep-ocean",
  shallowOcean: "shallow-ocean",
  reef: "reef",
  rock: "rock",
  land: "land",
} as const);

export type AuthoredTerrain = (typeof AUTHORED_TERRAINS)[keyof typeof AUTHORED_TERRAINS];

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

export interface GridRect extends GridPoint {
  width: number;
  height: number;
}

/**
 * One optional 8-pixel collision refinement inside an authored navigation cell.
 * Rows are north-to-south, characters are west-to-east, and `1` means solid.
 * When present, the patch replaces the coarse terrain collision for that cell.
 */
export type AuthoredCollisionSolidRows = readonly [string, string, string, string];

export interface AuthoredMixedCollisionCell extends GridPoint {
  solidRows: AuthoredCollisionSolidRows;
}

export interface AuthoredHybridGridCollision {
  kind: "hybrid-grid";
  subcellSize: typeof AUTHORED_COLLISION_SUBCELL_SIZE;
  mixedCells: readonly Readonly<AuthoredMixedCollisionCell>[];
}

export interface AuthoredBoxCollision {
  kind: "box";
  /** Pixel offset from the authored object's placement point. */
  offset: Readonly<PixelPoint>;
  /** Positive half-width and half-height in world pixels. */
  halfSize: Readonly<PixelSize>;
}

export interface AuthoredEmptyCollision {
  kind: "empty";
}

export type AuthoredCollisionProfile =
  | AuthoredHybridGridCollision
  | AuthoredBoxCollision
  | AuthoredEmptyCollision;

export interface AuthoredRenderSlice {
  id: string;
  imageId: string;
  gridBounds: Readonly<GridRect>;
  pixelOffset: Readonly<PixelPoint>;
  pixelSize: Readonly<PixelSize>;
  scale: number;
  depth: number;
}

export type AuthoredHomePresentationPlane = "land" | "island-composite";

export interface AuthoredAssetMetadataBase {
  contractVersion: typeof AUTHORED_ASSET_CONTRACT_VERSION;
  assetId: AuthoredAssetId;
  kind: AuthoredAssetKind;
  sourceAssetId: string;
  runtimeRevision: number;
  tileSize: number;
}

export interface AuthoredHomeCell extends GridPoint {
  terrain: AuthoredTerrain;
  belongsToHomeIsland: boolean;
}

export interface AuthoredHomeIslandMetadata extends AuthoredAssetMetadataBase {
  assetId: typeof AUTHORED_ASSET_IDS.homeIsland;
  kind: "home-island";
  /** Omission is the V1 legacy coarse-terrain collision contract. */
  collision?: Readonly<AuthoredHybridGridCollision>;
  grid: {
    width: number;
    height: number;
    placementOrigin: Readonly<GridPoint>;
    cells: readonly Readonly<AuthoredHomeCell>[];
  };
  anchors: {
    homeCenter: Readonly<GridPoint>;
    harbour: Readonly<GridPoint>;
    dock: Readonly<GridPoint>;
    homeReturn: Readonly<GridPoint>;
    service: Readonly<GridPoint>;
  };
  render: {
    plane: AuthoredHomePresentationPlane;
    pixelSize: Readonly<PixelSize>;
    slices: readonly Readonly<AuthoredRenderSlice>[];
  };
}

export type BoatHeadingMode = "rotate" | "directional";

export interface AuthoredPlayerBoatMetadata extends AuthoredAssetMetadataBase {
  assetId: typeof AUTHORED_ASSET_IDS.playerBoat;
  kind: "player-boat";
  /** Omission preserves the legacy configured ship footprint. */
  collision?: Readonly<AuthoredBoxCollision>;
  visual: {
    imageId: string;
    frameSize: Readonly<PixelSize>;
    origin: Readonly<PixelPoint>;
    sourceHeadingDegrees: number;
    headingMode: BoatHeadingMode;
    directionCount: 1 | 8 | 16;
    motionFramesPerDirection: number;
    framesPerSecond: number;
    scale: number;
    depth: number;
  };
  wake: {
    imageId: string;
    frameSize: Readonly<PixelSize>;
    origin: Readonly<PixelPoint>;
    offset: Readonly<PixelPoint>;
    frameCount: number;
    framesPerSecond: number;
    sourceHeadingDegrees: number;
    minimumSpeedPixelsPerSecond: number;
    fullSpeedPixelsPerSecond: number;
    scale: number;
    depth: number;
  };
}

export interface AuthoredFishingShoalMetadata extends AuthoredAssetMetadataBase {
  assetId: typeof AUTHORED_ASSET_IDS.fishingShoal;
  kind: "fishing-shoal";
  /** Omission preserves the legacy passable shoal contract. */
  collision?: Readonly<AuthoredEmptyCollision>;
  grid: {
    width: number;
    height: number;
    placementOrigin: Readonly<GridPoint>;
    serviceAnchor: Readonly<GridPoint>;
    passable: true;
  };
  visual: {
    imageId: string;
    pixelSize: Readonly<PixelSize>;
    origin: Readonly<PixelPoint>;
    scale: number;
    depth: number;
  };
  visibilitySource: "fishing-shoal-read-model";
}

export type AuthoredAssetMetadata =
  | AuthoredHomeIslandMetadata
  | AuthoredPlayerBoatMetadata
  | AuthoredFishingShoalMetadata;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function positive(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (parsed <= 0) throw new RangeError(`${label} must be positive`);
  return parsed;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = finite(value, label);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new RangeError(`${label} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function point(value: unknown, label: string, integerOnly: boolean): GridPoint {
  const parsed = record(value, label);
  const read = integerOnly ? integer : finite;
  return {
    x: read(parsed.x, `${label}.x`),
    y: read(parsed.y, `${label}.y`),
  };
}

function size(value: unknown, label: string): PixelSize {
  const parsed = record(value, label);
  return {
    width: positive(parsed.width, `${label}.width`),
    height: positive(parsed.height, `${label}.height`),
  };
}

function normalizedOrigin(value: unknown, label: string): PixelPoint {
  const parsed = point(value, label, false);
  if (parsed.x < 0 || parsed.x > 1 || parsed.y < 0 || parsed.y > 1) {
    throw new RangeError(`${label} must use normalized coordinates from 0 through 1`);
  }
  return parsed;
}

function assertPointInGrid(value: GridPoint, width: number, height: number, label: string): void {
  if (value.x >= width || value.y >= height) {
    throw new RangeError(`${label} is outside the ${width}x${height} asset grid`);
  }
}

function optionalHybridGridCollision(
  value: unknown,
  tileSize: number,
  width: number,
  height: number,
): AuthoredHybridGridCollision | undefined {
  if (value === undefined) return undefined;
  const parsed = record(value, "collision");
  if (parsed.kind !== "hybrid-grid") {
    throw new RangeError("home-island collision.kind must be hybrid-grid");
  }
  const subcellSize = integer(parsed.subcellSize, "collision.subcellSize", 1);
  if (
    tileSize !== 32
    || subcellSize !== AUTHORED_COLLISION_SUBCELL_SIZE
    || tileSize % subcellSize !== 0
  ) {
    throw new RangeError("hybrid-grid collision requires 32-pixel navigation cells and 8-pixel subcells");
  }
  if (!Array.isArray(parsed.mixedCells)) {
    throw new TypeError("collision.mixedCells must be an array");
  }

  const subcellsPerAxis = tileSize / subcellSize;
  const occupied = new Set<string>();
  const mixedCells = parsed.mixedCells.map((value, index): AuthoredMixedCollisionCell => {
    const label = `collision.mixedCells[${index}]`;
    const cellInput = record(value, label);
    const cellPoint = point(cellInput, label, true);
    assertPointInGrid(cellPoint, width, height, label);
    const key = `${cellPoint.x},${cellPoint.y}`;
    if (occupied.has(key)) throw new RangeError(`collision.mixedCells contains duplicate cell ${key}`);
    occupied.add(key);

    if (!Array.isArray(cellInput.solidRows) || cellInput.solidRows.length !== subcellsPerAxis) {
      throw new RangeError(`${label}.solidRows must contain exactly ${subcellsPerAxis} rows`);
    }
    const solidRows = cellInput.solidRows.map((row, rowIndex) => {
      if (typeof row !== "string" || row.length !== subcellsPerAxis || !/^[01]+$/u.test(row)) {
        throw new RangeError(
          `${label}.solidRows[${rowIndex}] must contain exactly ${subcellsPerAxis} zero-or-one values`,
        );
      }
      return row;
    }) as unknown as AuthoredCollisionSolidRows;
    return { ...cellPoint, solidRows };
  });

  return {
    kind: "hybrid-grid",
    subcellSize: AUTHORED_COLLISION_SUBCELL_SIZE,
    mixedCells,
  };
}

function optionalBoxCollision(value: unknown, tileSize: number): AuthoredBoxCollision | undefined {
  if (value === undefined) return undefined;
  const parsed = record(value, "collision");
  if (parsed.kind !== "box") throw new RangeError("player-boat collision.kind must be box");
  const offset = point(parsed.offset, "collision.offset", false);
  if (offset.x !== 0 || offset.y !== 0) {
    throw new RangeError("player-boat collision box must be centered at offset 0,0");
  }
  const halfSize = size(parsed.halfSize, "collision.halfSize");
  if (halfSize.width >= tileSize / 2 || halfSize.height >= tileSize / 2) {
    throw new RangeError("player-boat collision halfSize must be smaller than half tileSize");
  }
  if (halfSize.width !== halfSize.height) {
    throw new RangeError("player-boat collision halfSize must define a square runtime hull");
  }
  return { kind: "box", offset, halfSize };
}

function optionalEmptyCollision(value: unknown): AuthoredEmptyCollision | undefined {
  if (value === undefined) return undefined;
  const parsed = record(value, "collision");
  if (parsed.kind !== "empty") throw new RangeError("fishing-shoal collision.kind must be empty");
  return { kind: "empty" };
}

function authoredTerrain(value: unknown, label: string): AuthoredTerrain {
  if (!Object.values(AUTHORED_TERRAINS).includes(value as AuthoredTerrain)) {
    throw new RangeError(`${label} is not a supported terrain value`);
  }
  return value as AuthoredTerrain;
}

function heading(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (parsed < 0 || parsed >= 360) throw new RangeError(`${label} must be from 0 up to but not including 360`);
  return parsed;
}

function validateBase(
  parsed: Record<string, unknown>,
  assetId: AuthoredAssetId,
  kind: AuthoredAssetKind,
): AuthoredAssetMetadataBase {
  if (parsed.contractVersion !== AUTHORED_ASSET_CONTRACT_VERSION) {
    throw new RangeError(`Unsupported authored asset contract version ${String(parsed.contractVersion)}`);
  }
  if (parsed.assetId !== assetId) throw new RangeError(`Expected authored asset ID ${assetId}`);
  if (parsed.kind !== kind) throw new RangeError(`Expected authored asset kind ${kind}`);
  return {
    contractVersion: AUTHORED_ASSET_CONTRACT_VERSION,
    assetId,
    kind,
    sourceAssetId: nonEmptyString(parsed.sourceAssetId, "sourceAssetId"),
    runtimeRevision: integer(parsed.runtimeRevision, "runtimeRevision", 1),
    tileSize: positive(parsed.tileSize, "tileSize"),
  };
}

function validateHomeIsland(parsed: Record<string, unknown>): AuthoredHomeIslandMetadata {
  const base = validateBase(parsed, AUTHORED_ASSET_IDS.homeIsland, "home-island");
  const gridInput = record(parsed.grid, "grid");
  const width = integer(gridInput.width, "grid.width", 1);
  const height = integer(gridInput.height, "grid.height", 1);
  const placementOrigin = point(gridInput.placementOrigin, "grid.placementOrigin", true);
  assertPointInGrid(placementOrigin, width, height, "grid.placementOrigin");

  const sourceCells = Array.isArray(gridInput.cells)
    ? gridInput.cells
    : authoredCellsFromRows(gridInput.cellRows, width, height);
  const cellKeys = new Set<string>();
  const cells = sourceCells.map((value, index): AuthoredHomeCell => {
    const cellInput = record(value, `grid.cells[${index}]`);
    const cellPoint = point(cellInput, `grid.cells[${index}]`, true);
    assertPointInGrid(cellPoint, width, height, `grid.cells[${index}]`);
    const key = `${cellPoint.x},${cellPoint.y}`;
    if (cellKeys.has(key)) throw new RangeError(`grid.cells contains duplicate cell ${key}`);
    cellKeys.add(key);
    if (typeof cellInput.belongsToHomeIsland !== "boolean") {
      throw new TypeError(`grid.cells[${index}].belongsToHomeIsland must be boolean`);
    }
    const cellTerrain = authoredTerrain(cellInput.terrain, `grid.cells[${index}].terrain`);
    if (cellInput.belongsToHomeIsland && cellTerrain === AUTHORED_TERRAINS.deepOcean) {
      throw new RangeError(`grid.cells[${index}] cannot mark deep ocean as home island`);
    }
    return { ...cellPoint, terrain: cellTerrain, belongsToHomeIsland: cellInput.belongsToHomeIsland };
  });
  if (cells.length !== width * height) {
    throw new RangeError(`grid.cells must define every cell in the ${width}x${height} asset grid`);
  }
  const collision = optionalHybridGridCollision(parsed.collision, base.tileSize, width, height);

  const anchorInput = record(parsed.anchors, "anchors");
  const anchors = {
    homeCenter: point(anchorInput.homeCenter, "anchors.homeCenter", true),
    harbour: point(anchorInput.harbour, "anchors.harbour", true),
    dock: point(anchorInput.dock, "anchors.dock", true),
    homeReturn: point(anchorInput.homeReturn, "anchors.homeReturn", true),
    service: point(anchorInput.service, "anchors.service", true),
  };
  for (const [name, anchor] of Object.entries(anchors)) {
    assertPointInGrid(anchor, width, height, `anchors.${name}`);
  }

  const byCell = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
  for (const name of ["harbour", "dock", "homeReturn", "service"] as const) {
    const anchor = anchors[name];
    const cell = byCell.get(`${anchor.x},${anchor.y}`);
    if (!cell || terrainBlocksMovement(authoredTerrainToTerrainType(cell.terrain))) {
      throw new RangeError(`anchors.${name} must be on passable terrain`);
    }
  }
  for (const name of ["harbour", "dock"] as const) {
    const anchor = anchors[name];
    const cell = byCell.get(`${anchor.x},${anchor.y}`);
    if (cell?.terrain !== AUTHORED_TERRAINS.shallowOcean) {
      throw new RangeError(`anchors.${name} must be on authored shallow ocean`);
    }
  }
  if (
    anchors.dock.x !== anchors.homeReturn.x
    || anchors.dock.y !== anchors.homeReturn.y
    || anchors.dock.x !== anchors.service.x
    || anchors.dock.y !== anchors.service.y
  ) {
    throw new RangeError("anchors.dock, anchors.homeReturn and anchors.service must match in contract V1");
  }
  assertDockPathToEdge(cells, width, height, anchors.dock);

  const renderInput = record(parsed.render, "render");
  const presentationPlane = renderInput.plane;
  if (presentationPlane !== "land" && presentationPlane !== "island-composite") {
    throw new RangeError("render.plane must be land or island-composite");
  }
  const pixelSize = size(renderInput.pixelSize, "render.pixelSize");
  if (!Array.isArray(renderInput.slices) || renderInput.slices.length === 0) {
    throw new TypeError("render.slices must be a non-empty array");
  }
  const occupied = new Set<string>();
  const sliceIds = new Set<string>();
  const slices = renderInput.slices.map((value, index): AuthoredRenderSlice => {
    const sliceInput = record(value, `render.slices[${index}]`);
    const id = nonEmptyString(sliceInput.id, `render.slices[${index}].id`);
    if (sliceIds.has(id)) throw new RangeError(`render.slices contains duplicate ID ${id}`);
    sliceIds.add(id);
    const boundsInput = record(sliceInput.gridBounds, `render.slices[${index}].gridBounds`);
    const gridBounds = {
      ...point(boundsInput, `render.slices[${index}].gridBounds`, true),
      width: integer(boundsInput.width, `render.slices[${index}].gridBounds.width`, 1),
      height: integer(boundsInput.height, `render.slices[${index}].gridBounds.height`, 1),
    };
    if (gridBounds.x + gridBounds.width > width || gridBounds.y + gridBounds.height > height) {
      throw new RangeError(`render.slices[${index}].gridBounds exceeds the asset grid`);
    }
    for (let y = gridBounds.y; y < gridBounds.y + gridBounds.height; y++) {
      for (let x = gridBounds.x; x < gridBounds.x + gridBounds.width; x++) {
        const key = `${x},${y}`;
        if (occupied.has(key)) throw new RangeError(`render slices overlap at grid cell ${key}`);
        occupied.add(key);
      }
    }
    const pixelOffset = point(sliceInput.pixelOffset, `render.slices[${index}].pixelOffset`, false);
    const slicePixelSize = size(sliceInput.pixelSize, `render.slices[${index}].pixelSize`);
    if (
      pixelOffset.x < 0
      || pixelOffset.y < 0
      || pixelOffset.x + slicePixelSize.width > pixelSize.width
      || pixelOffset.y + slicePixelSize.height > pixelSize.height
    ) {
      throw new RangeError(`render.slices[${index}] exceeds render.pixelSize`);
    }
    return {
      id,
      imageId: nonEmptyString(sliceInput.imageId, `render.slices[${index}].imageId`),
      gridBounds,
      pixelOffset,
      pixelSize: slicePixelSize,
      scale: positive(sliceInput.scale, `render.slices[${index}].scale`),
      depth: finite(sliceInput.depth, `render.slices[${index}].depth`),
    };
  });

  return {
    ...base,
    assetId: AUTHORED_ASSET_IDS.homeIsland,
    kind: "home-island",
    ...(collision ? { collision } : {}),
    grid: { width, height, placementOrigin, cells },
    anchors,
    render: { plane: presentationPlane, pixelSize, slices },
  };
}

function authoredCellsFromRows(value: unknown, width: number, height: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== height) {
    throw new TypeError("grid must provide cells or one cellRows string per grid row");
  }
  const terrainByCode: Readonly<Record<string, AuthoredTerrain>> = {
    D: AUTHORED_TERRAINS.deepOcean,
    S: AUTHORED_TERRAINS.shallowOcean,
    F: AUTHORED_TERRAINS.reef,
    R: AUTHORED_TERRAINS.rock,
    L: AUTHORED_TERRAINS.land,
  };
  const cells: AuthoredHomeCell[] = [];
  for (let y = 0; y < value.length; y++) {
    const row = value[y];
    if (typeof row !== "string" || row.length !== width) {
      throw new RangeError(`grid.cellRows[${y}] must contain exactly ${width} terrain codes`);
    }
    for (let x = 0; x < row.length; x++) {
      const cellTerrain = terrainByCode[row[x]];
      if (!cellTerrain) throw new RangeError(`grid.cellRows[${y}] contains unsupported terrain code ${row[x]}`);
      cells.push({
        x,
        y,
        terrain: cellTerrain,
        belongsToHomeIsland: cellTerrain === AUTHORED_TERRAINS.land || cellTerrain === AUTHORED_TERRAINS.rock,
      });
    }
  }
  return cells;
}

function assertDockPathToEdge(
  cells: readonly AuthoredHomeCell[],
  width: number,
  height: number,
  dock: GridPoint,
): void {
  const passable = new Set(cells
    .filter((cell) => !terrainBlocksMovement(authoredTerrainToTerrainType(cell.terrain)))
    .map((cell) => `${cell.x},${cell.y}`));
  const queue: GridPoint[] = [{ ...dock }];
  const visited = new Set<string>([`${dock.x},${dock.y}`]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current.x === 0 || current.y === 0 || current.x === width - 1 || current.y === height - 1) return;
    for (const neighbor of [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 },
    ]) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (passable.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(neighbor);
      }
    }
  }
  throw new RangeError("authored home dock has no passable cardinal path to the asset-grid edge");
}

function validatePlayerBoat(parsed: Record<string, unknown>): AuthoredPlayerBoatMetadata {
  const base = validateBase(parsed, AUTHORED_ASSET_IDS.playerBoat, "player-boat");
  const collision = optionalBoxCollision(parsed.collision, base.tileSize);
  const visualInput = record(parsed.visual, "visual");
  const headingMode = visualInput.headingMode;
  if (headingMode !== "rotate" && headingMode !== "directional") {
    throw new RangeError("visual.headingMode must be rotate or directional");
  }
  const directionCount = integer(visualInput.directionCount, "visual.directionCount", 1);
  if (![1, 8, 16].includes(directionCount)) {
    throw new RangeError("visual.directionCount must be 1, 8 or 16");
  }
  if (headingMode === "rotate" && directionCount !== 1) {
    throw new RangeError("rotate boat metadata must use one direction");
  }
  if (headingMode === "directional" && directionCount === 1) {
    throw new RangeError("directional boat metadata must use 8 or 16 directions");
  }
  const visual = {
    imageId: nonEmptyString(visualInput.imageId, "visual.imageId"),
    frameSize: size(visualInput.frameSize, "visual.frameSize"),
    origin: normalizedOrigin(visualInput.origin, "visual.origin"),
    sourceHeadingDegrees: heading(visualInput.sourceHeadingDegrees, "visual.sourceHeadingDegrees"),
    headingMode: headingMode as BoatHeadingMode,
    directionCount: directionCount as 1 | 8 | 16,
    motionFramesPerDirection: integer(visualInput.motionFramesPerDirection, "visual.motionFramesPerDirection", 1),
    framesPerSecond: positive(visualInput.framesPerSecond, "visual.framesPerSecond"),
    scale: positive(visualInput.scale, "visual.scale"),
    depth: finite(visualInput.depth, "visual.depth"),
  };

  const wakeInput = record(parsed.wake, "wake");
  const wake = {
    imageId: nonEmptyString(wakeInput.imageId, "wake.imageId"),
    frameSize: size(wakeInput.frameSize, "wake.frameSize"),
    origin: normalizedOrigin(wakeInput.origin, "wake.origin"),
    offset: point(wakeInput.offset, "wake.offset", false),
    frameCount: integer(wakeInput.frameCount, "wake.frameCount", 1),
    framesPerSecond: positive(wakeInput.framesPerSecond, "wake.framesPerSecond"),
    sourceHeadingDegrees: heading(wakeInput.sourceHeadingDegrees, "wake.sourceHeadingDegrees"),
    minimumSpeedPixelsPerSecond: integer(wakeInput.minimumSpeedPixelsPerSecond, "wake.minimumSpeedPixelsPerSecond"),
    fullSpeedPixelsPerSecond: positive(wakeInput.fullSpeedPixelsPerSecond, "wake.fullSpeedPixelsPerSecond"),
    scale: positive(wakeInput.scale, "wake.scale"),
    depth: finite(wakeInput.depth, "wake.depth"),
  };
  if (wake.fullSpeedPixelsPerSecond <= wake.minimumSpeedPixelsPerSecond) {
    throw new RangeError("wake.fullSpeedPixelsPerSecond must exceed wake.minimumSpeedPixelsPerSecond");
  }
  if (wake.depth >= visual.depth) throw new RangeError("wake.depth must be below visual.depth");
  return {
    ...base,
    assetId: AUTHORED_ASSET_IDS.playerBoat,
    kind: "player-boat",
    ...(collision ? { collision } : {}),
    visual,
    wake,
  };
}

function validateFishingShoal(parsed: Record<string, unknown>): AuthoredFishingShoalMetadata {
  const base = validateBase(parsed, AUTHORED_ASSET_IDS.fishingShoal, "fishing-shoal");
  const collision = optionalEmptyCollision(parsed.collision);
  const gridInput = record(parsed.grid, "grid");
  const width = integer(gridInput.width, "grid.width", 1);
  const height = integer(gridInput.height, "grid.height", 1);
  const placementOrigin = point(gridInput.placementOrigin, "grid.placementOrigin", true);
  const serviceAnchor = point(gridInput.serviceAnchor, "grid.serviceAnchor", true);
  if (width !== 1 || height !== 1) throw new RangeError("fishing-shoal logical grid must remain 1x1");
  assertPointInGrid(placementOrigin, width, height, "grid.placementOrigin");
  assertPointInGrid(serviceAnchor, width, height, "grid.serviceAnchor");
  if (gridInput.passable !== true) throw new RangeError("grid.passable must remain true for fishing shoals");
  if (parsed.visibilitySource !== "fishing-shoal-read-model") {
    throw new RangeError("visibilitySource must be fishing-shoal-read-model");
  }
  const visualInput = record(parsed.visual, "visual");
  const visual = {
    imageId: nonEmptyString(visualInput.imageId, "visual.imageId"),
    pixelSize: size(visualInput.pixelSize, "visual.pixelSize"),
    origin: normalizedOrigin(visualInput.origin, "visual.origin"),
    scale: positive(visualInput.scale, "visual.scale"),
    depth: finite(visualInput.depth, "visual.depth"),
  };
  return {
    ...base,
    assetId: AUTHORED_ASSET_IDS.fishingShoal,
    kind: "fishing-shoal",
    ...(collision ? { collision } : {}),
    grid: { width, height, placementOrigin, serviceAnchor, passable: true },
    visual,
    visibilitySource: "fishing-shoal-read-model",
  };
}

export function validateAuthoredAssetMetadata(value: unknown): AuthoredAssetMetadata {
  const parsed = record(value, "authored asset metadata");
  switch (parsed.kind) {
    case "home-island": return validateHomeIsland(parsed);
    case "player-boat": return validatePlayerBoat(parsed);
    case "fishing-shoal": return validateFishingShoal(parsed);
    default: throw new RangeError(`Unsupported authored asset kind ${String(parsed.kind)}`);
  }
}

export function authoredCellBlocksMovement(cell: Readonly<AuthoredHomeCell>): boolean {
  return terrainBlocksMovement(authoredTerrainToTerrainType(cell.terrain));
}

export function authoredCellBlocksSight(cell: Readonly<AuthoredHomeCell>): boolean {
  return terrainBlocksSight(authoredTerrainToTerrainType(cell.terrain));
}

export function authoredTerrainToTerrainType(value: AuthoredTerrain): TerrainType {
  switch (value) {
    case AUTHORED_TERRAINS.deepOcean: return TerrainType.DeepOcean;
    case AUTHORED_TERRAINS.shallowOcean: return TerrainType.ShallowOcean;
    case AUTHORED_TERRAINS.reef: return TerrainType.Reef;
    case AUTHORED_TERRAINS.rock: return TerrainType.Rock;
    case AUTHORED_TERRAINS.land: return TerrainType.Land;
  }
}
