import type { PrototypeConfig } from "../config/prototypeConfig";
import { prototypeConfig } from "../config/prototypeConfig";
import { isShipCenterCollisionFree } from "../navigation/CollisionGeometry";
import { gridToWorld } from "../world/CoordinateSystem";
import {
  COLLISION_SUBCELL_SIZE,
  COLLISION_SUBCELLS_PER_TILE,
  collisionSubcellBit,
  EMPTY_COLLISION_MASK,
  type CollisionSubcellMask,
} from "../world/CollisionMask";
import { KnowledgeState, TerrainType } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";
import type {
  AssetLibraryImageLayer,
  ProductionCandidateCollisionDraft,
  ProductionCandidateHybridCollisionDraft,
  ProductionCandidateLibraryEntry,
} from "./AssetLibraryCatalog";
import type { ProductionAssetFamily } from "./ProductionAssetRecipe";

const FINGERPRINT = /^[a-f0-9]{64}$/u;
const MINIMUM_WATER_MARGIN_TILES = 4;

export type ProductionAssetTrialConfig = Pick<PrototypeConfig, "navigation" | "movement">;

export type ProductionAssetTrialLayer = Readonly<Pick<
  AssetLibraryImageLayer,
  | "id"
  | "name"
  | "order"
  | "url"
  | "defaultVisible"
  | "opacity"
  | "blendMode"
  | "pixelSize"
>>;

/** The narrow candidate seam consumed by the isolated sea trial. */
export interface ProductionAssetTrialCandidate {
  readonly id: string;
  readonly entryType: "production-candidate";
  readonly lifecycle: "candidate";
  readonly fingerprint: string;
  readonly reviewState: ProductionCandidateLibraryEntry["reviewState"];
  readonly recipe: Readonly<{ readonly family: ProductionAssetFamily }>;
  readonly candidateLayers: readonly ProductionAssetTrialLayer[];
  readonly collisionDraft: Readonly<ProductionCandidateCollisionDraft>;
}

export interface ProductionAssetTrialIslandPlacement {
  readonly tileX: number;
  readonly tileY: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly topLeftWorldX: number;
  readonly topLeftWorldY: number;
  /** Prepared canvases use one candidate-owned, normalized centre origin. */
  readonly origin: Readonly<{
    normalizedX: 0.5;
    normalizedY: 0.5;
    worldX: number;
    worldY: number;
  }>;
}

export interface ProductionAssetTrialBoatPosition {
  readonly id: "west" | "east" | "north" | "south";
  readonly tile: Readonly<{ x: number; y: number }>;
  readonly world: Readonly<{ x: number; y: number }>;
  readonly heading: number;
}

export interface ProductionAssetTrial {
  readonly candidateId: string;
  readonly candidateFingerprint: string;
  readonly reviewState: ProductionCandidateLibraryEntry["reviewState"];
  readonly layers: readonly ProductionAssetTrialLayer[];
  readonly collisionDraft: Readonly<ProductionCandidateHybridCollisionDraft>;
  readonly world: WorldGrid;
  readonly worldPixelSize: Readonly<{ width: number; height: number }>;
  readonly island: Readonly<ProductionAssetTrialIslandPlacement>;
  readonly spawn: Readonly<ProductionAssetTrialBoatPosition>;
  readonly resetPositions: readonly Readonly<ProductionAssetTrialBoatPosition>[];
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function validateTrialCandidate(
  candidate: Readonly<ProductionAssetTrialCandidate>,
  expectedFingerprint: string,
  config: Readonly<ProductionAssetTrialConfig>,
): Readonly<{
  draft: Readonly<ProductionCandidateHybridCollisionDraft>;
  pixelWidth: number;
  pixelHeight: number;
}> {
  if (candidate.entryType !== "production-candidate" || candidate.lifecycle !== "candidate") {
    throw new RangeError("A production sea trial requires a prepared candidate record");
  }
  if (candidate.recipe.family !== "island") {
    throw new RangeError(`Production sea trials support island candidates, not ${candidate.recipe.family}`);
  }
  if (!FINGERPRINT.test(expectedFingerprint)) {
    throw new RangeError("The requested candidate fingerprint must be a SHA-256 fingerprint");
  }
  if (!FINGERPRINT.test(candidate.fingerprint)) {
    throw new RangeError(`Candidate ${candidate.id} has an invalid fingerprint`);
  }
  if (candidate.fingerprint !== expectedFingerprint) {
    throw new RangeError(`Candidate ${candidate.id} changed; reopen its current library record before trialing`);
  }
  if (candidate.collisionDraft.kind !== "hybrid-grid-draft") {
    throw new RangeError(`Candidate ${candidate.id} does not have an island collision draft`);
  }
  if (!["pending", "approved", "rejected", "stale"].includes(candidate.reviewState)) {
    throw new RangeError(`Candidate ${candidate.id} has an invalid review state`);
  }

  const draft = candidate.collisionDraft;
  const requiredTileSize = COLLISION_SUBCELL_SIZE * COLLISION_SUBCELLS_PER_TILE;
  if (
    draft.tileSize !== requiredTileSize
    || draft.subcellSize !== COLLISION_SUBCELL_SIZE
    || config.navigation.tileSize !== requiredTileSize
  ) {
    throw new RangeError("Production sea trials require the exact 32 px navigation / 8 px collision grid");
  }
  if (
    !Number.isFinite(config.movement.shipCollisionHalfExtent)
    || config.movement.shipCollisionHalfExtent <= 0
    || config.movement.shipCollisionHalfExtent >= draft.tileSize / 2
  ) {
    throw new RangeError("Production sea trials require a positive ship hull smaller than half a navigation cell");
  }
  positiveInteger(config.navigation.chunkSize, "Trial navigation chunk size");

  const widthTiles = positiveInteger(draft.grid.width, "Trial collision width");
  const heightTiles = positiveInteger(draft.grid.height, "Trial collision height");
  if (
    draft.grid.subcellColumns !== widthTiles * COLLISION_SUBCELLS_PER_TILE
    || draft.grid.subcellRows !== heightTiles * COLLISION_SUBCELLS_PER_TILE
  ) {
    throw new RangeError(`Candidate ${candidate.id} collision dimensions do not match its 32/8 grid`);
  }
  const pixelWidth = widthTiles * draft.tileSize;
  const pixelHeight = heightTiles * draft.tileSize;
  if (candidate.candidateLayers.length === 0) {
    throw new RangeError(`Candidate ${candidate.id} has no prepared layers to trial`);
  }
  for (const layer of candidate.candidateLayers) {
    if (layer.pixelSize?.width !== pixelWidth || layer.pixelSize.height !== pixelHeight) {
      throw new RangeError(
        `Candidate ${candidate.id} layer ${layer.id} must use the ${pixelWidth}x${pixelHeight} collision canvas`,
      );
    }
  }

  const coordinates = new Set<string>();
  for (const point of draft.solidSubcells) {
    if (
      !Number.isInteger(point.x)
      || !Number.isInteger(point.y)
      || point.x < 0
      || point.y < 0
      || point.x >= draft.grid.subcellColumns
      || point.y >= draft.grid.subcellRows
    ) {
      throw new RangeError(`Candidate ${candidate.id} collision subcell ${point.x},${point.y} is outside its grid`);
    }
    const key = `${point.x},${point.y}`;
    if (coordinates.has(key)) {
      throw new RangeError(`Candidate ${candidate.id} repeats collision subcell ${key}`);
    }
    coordinates.add(key);
  }

  return Object.freeze({ draft, pixelWidth, pixelHeight });
}

function candidateCollisionMasks(
  draft: Readonly<ProductionCandidateHybridCollisionDraft>,
): Uint16Array {
  const masks = new Uint16Array(draft.grid.width * draft.grid.height);
  for (const point of draft.solidSubcells) {
    const cellX = Math.floor(point.x / COLLISION_SUBCELLS_PER_TILE);
    const cellY = Math.floor(point.y / COLLISION_SUBCELLS_PER_TILE);
    const localX = point.x % COLLISION_SUBCELLS_PER_TILE;
    const localY = point.y % COLLISION_SUBCELLS_PER_TILE;
    const index = cellY * draft.grid.width + cellX;
    masks[index] |= collisionSubcellBit(localX, localY);
  }
  return masks;
}

function boatPosition(
  id: ProductionAssetTrialBoatPosition["id"],
  x: number,
  y: number,
  heading: number,
  tileSize: number,
): Readonly<ProductionAssetTrialBoatPosition> {
  return Object.freeze({
    id,
    tile: Object.freeze({ x, y }),
    world: Object.freeze(gridToWorld({ x, y }, tileSize)),
    heading,
  });
}

function safeBoatPositions(
  world: WorldGrid,
  island: Readonly<ProductionAssetTrialIslandPlacement>,
  config: Readonly<ProductionAssetTrialConfig>,
): readonly Readonly<ProductionAssetTrialBoatPosition>[] {
  const middleX = island.tileX + Math.floor(island.widthTiles / 2);
  const middleY = island.tileY + Math.floor(island.heightTiles / 2);
  const positions = [
    boatPosition("west", island.tileX - 2, middleY, 0, config.navigation.tileSize),
    boatPosition("east", island.tileX + island.widthTiles + 1, middleY, 180, config.navigation.tileSize),
    boatPosition("north", middleX, island.tileY - 2, 90, config.navigation.tileSize),
    boatPosition("south", middleX, island.tileY + island.heightTiles + 1, 270, config.navigation.tileSize),
  ];
  for (const position of positions) {
    if (
      !world.inBounds(position.tile.x, position.tile.y)
      || !isShipCenterCollisionFree(world, position.world.x, position.world.y, config)
    ) {
      throw new RangeError(`Candidate trial could not create a hull-safe ${position.id} reset position`);
    }
  }
  return Object.freeze(positions);
}

/**
 * Creates disposable navigation authority for one prepared island. The coarse
 * world remains open ocean; only the candidate's exact saved 32/8 masks add
 * collision, so no runtime island footprint can leak into the trial.
 */
export function createProductionAssetTrial(
  candidate: Readonly<ProductionAssetTrialCandidate>,
  expectedFingerprint: string,
  config: Readonly<ProductionAssetTrialConfig> = prototypeConfig,
): Readonly<ProductionAssetTrial> {
  const { draft, pixelWidth, pixelHeight } = validateTrialCandidate(candidate, expectedFingerprint, config);
  const marginTiles = MINIMUM_WATER_MARGIN_TILES;
  const worldWidth = draft.grid.width + marginTiles * 2;
  const worldHeight = draft.grid.height + marginTiles * 2;
  const world = new WorldGrid(worldWidth, worldHeight, config.navigation.chunkSize);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);

  const masks = candidateCollisionMasks(draft);
  for (let y = 0; y < draft.grid.height; y++) {
    for (let x = 0; x < draft.grid.width; x++) {
      const mask = masks[y * draft.grid.width + x] as CollisionSubcellMask;
      if (mask !== EMPTY_COLLISION_MASK) {
        world.setFineCollisionMask(marginTiles + x, marginTiles + y, mask);
      }
    }
  }

  const topLeftWorldX = marginTiles * draft.tileSize;
  const topLeftWorldY = marginTiles * draft.tileSize;
  const island = Object.freeze({
    tileX: marginTiles,
    tileY: marginTiles,
    widthTiles: draft.grid.width,
    heightTiles: draft.grid.height,
    pixelWidth,
    pixelHeight,
    topLeftWorldX,
    topLeftWorldY,
    origin: Object.freeze({
      normalizedX: 0.5 as const,
      normalizedY: 0.5 as const,
      worldX: topLeftWorldX + pixelWidth / 2,
      worldY: topLeftWorldY + pixelHeight / 2,
    }),
  });
  const resetPositions = safeBoatPositions(world, island, config);

  return Object.freeze({
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    reviewState: candidate.reviewState,
    layers: Object.freeze([...candidate.candidateLayers]),
    collisionDraft: draft,
    world,
    worldPixelSize: Object.freeze({
      width: worldWidth * draft.tileSize,
      height: worldHeight * draft.tileSize,
    }),
    island,
    spawn: resetPositions[0],
    resetPositions,
  });
}
