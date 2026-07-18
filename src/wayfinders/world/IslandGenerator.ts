import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import {
  IslandPlacementIndex,
  type IslandPlacementIndexStats,
} from "./IslandPlacementIndex";
import { KnowledgeState, TerrainType } from "./TileData";
import { seededValue } from "./SeededRandom";
import {
  EMPTY_AUTHORED_ISLAND_CATALOG,
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalog,
  type AuthoredIslandCatalogEntry,
} from "./AuthoredIslandCatalog";
import { collisionSubcellBit } from "./CollisionMask";
import type { WorldGrid } from "./WorldGrid";
import type { WorldTopology } from "./WorldTopology";

export enum IslandKind {
  HighIsland = "high-island",
  LowCay = "low-cay",
  Atoll = "atoll",
  RockySkerry = "rocky-skerry",
}

export enum IslandSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

export interface IslandBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GeneratedIsland {
  id: number;
  kind: IslandKind;
  size: IslandSize;
  center: GridPoint;
  radiusX: number;
  radiusY: number;
  outerRadius: number;
  rotation: number;
  shapeSeed: number;
  bounds: IslandBounds;
  sourceKind: "authored" | "procedural";
  authoredAssetId?: string;
  authoredCollision?: Readonly<{
    gridWidth: number;
    gridHeight: number;
    solidSubcells: readonly Readonly<{ x: number; y: number }>[];
  }>;
}

interface IslandProfile extends Omit<GeneratedIsland, "center" | "bounds"> {}

export type IslandPlacementRejection = "home-clearance" | "starter-lane" | "island-channel";

export interface IslandPlacementFailureDiagnostics {
  readonly seed: number;
  readonly islandId: number;
  readonly sourceKind: GeneratedIsland["sourceKind"];
  readonly authoredAssetId?: string;
  readonly placedIslandCount: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly outerRadius: number;
  readonly randomAttemptLimit: number;
  readonly fallbackScanLimit: number;
  readonly candidatesEvaluated: number;
  readonly rejectionCounts: Readonly<Record<IslandPlacementRejection, number>>;
  readonly spatialIndex: IslandPlacementIndexStats;
}

/** Structured, deterministic failure that points directly at density constraints. */
export class IslandPlacementError extends RangeError {
  readonly diagnostics: IslandPlacementFailureDiagnostics;

  constructor(diagnostics: IslandPlacementFailureDiagnostics) {
    const rejected = diagnostics.rejectionCounts;
    const authoredAsset = diagnostics.authoredAssetId
      ? ` (asset ${diagnostics.authoredAssetId})`
      : "";
    super(
      `Unable to place configured ${diagnostics.sourceKind} island ${diagnostics.islandId}${authoredAsset} `
      + `for seed ${diagnostics.seed} `
      + `after ${diagnostics.candidatesEvaluated} bounded candidates in `
      + `${diagnostics.worldWidth}x${diagnostics.worldHeight}; rejected `
      + `home-clearance=${rejected["home-clearance"]}, `
      + `starter-lane=${rejected["starter-lane"]}, island-channel=${rejected["island-channel"]}. `
      + `Reduce island count/radii, home clearance, or minimum channel width.`,
    );
    this.name = "IslandPlacementError";
    this.diagnostics = diagnostics;
  }
}

interface PlacementAttemptDiagnostics {
  candidatesEvaluated: number;
  readonly rejectionCounts: Record<IslandPlacementRejection, number>;
}

const PLACEMENT_NAMESPACE = 2_003;
const PROFILE_NAMESPACE = 3_011;
const SHAPE_NAMESPACE = 5_009;
const TERRAIN_NAMESPACE = 7_001;
const AUTHORED_SELECTION_NAMESPACE = 8_191;
const AUTHORED_SHELF_NAMESPACE = 9_173;
const TWO_PI = Math.PI * 2;

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function angularDistance(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI);
}

/** Exact finite lifted opening corridor used by periodic island placement. */
export function intersectsPeriodicStarterLane(
  topology: Readonly<WorldTopology>,
  dock: Readonly<GridPoint>,
  center: Readonly<GridPoint>,
  outerRadius: number,
  corridorHalfWidth: number,
): boolean {
  const minimumX = dock.x;
  const maximumX = dock.x + Math.floor(topology.tileWidth / 2);
  const minimumY = dock.y - corridorHalfWidth;
  const maximumY = dock.y + corridorHalfWidth;
  const imageXs = topology.wrapsX ? [-topology.tileWidth, 0, topology.tileWidth] : [0];
  const imageYs = topology.wrapsY ? [-topology.tileHeight, 0, topology.tileHeight] : [0];
  for (const imageY of imageYs) {
    for (const imageX of imageXs) {
      const liftedX = center.x + imageX;
      const liftedY = center.y + imageY;
      const closestX = Math.max(minimumX, Math.min(maximumX, liftedX));
      const closestY = Math.max(minimumY, Math.min(maximumY, liftedY));
      if (Math.hypot(liftedX - closestX, liftedY - closestY) <= outerRadius) return true;
    }
  }
  return false;
}

/** Deterministic, bounded scatter and terrain painter for non-home islands. */
export class IslandGenerator {
  constructor(private readonly config: PrototypeConfig = prototypeConfig) {}

  /** Deterministically lays out descriptors without touching logical tile state. */
  plan(
    grid: WorldGrid,
    seed: number,
    home: GridPoint,
    dock: GridPoint,
    authoredCatalog: Readonly<AuthoredIslandCatalog> = EMPTY_AUTHORED_ISLAND_CATALOG,
  ): GeneratedIsland[] {
    const profiles = this.buildProfiles(seed, validateAuthoredIslandCatalog(authoredCatalog));
    for (const profile of profiles) {
      const extent = this.profileExtent(profile);
      if (extent.width >= grid.width || extent.height >= grid.height) {
        throw new RangeError(
          `Island ${profile.id} footprint ${extent.width}x${extent.height} must be strictly smaller than `
          + `${grid.width}x${grid.height} gameplay world`,
        );
      }
    }
    const placed: GeneratedIsland[] = [];
    const maximumOuterRadius = profiles.reduce(
      (maximum, profile) => Math.max(maximum, profile.outerRadius),
      0,
    );
    const placementIndex = new IslandPlacementIndex(
      grid.topology,
      maximumOuterRadius,
      this.config.islands.minimumChannelWidth,
    );

    const starterProfile = profiles.find(({ id }) => id === 1);
    if (!starterProfile) throw new RangeError("Scattered island generation requires starter island profile 1");
    try {
      const starterIsland = this.placeStarterIsland(grid, seed, home, dock, starterProfile, placementIndex);
      placed.push(starterIsland);
      placementIndex.add(starterIsland);
    } catch (error) {
      if (!(error instanceof IslandPlacementError)) throw error;
    }

    const remaining = profiles
      .filter(({ id }) => id !== 1)
      .sort((a, b) => b.outerRadius - a.outerRadius || a.id - b.id);
    for (const profile of remaining) {
      try {
        const island = this.placeIsland(grid, seed, home, dock, profile, placementIndex);
        placed.push(island);
        placementIndex.add(island);
      } catch (error) {
        if (!(error instanceof IslandPlacementError)) throw error;
      }
    }

    placed.sort((a, b) => a.id - b.id);
    return placed;
  }

  /** Paints a previously planned layout and validates its ocean connectivity. */
  rasterize(
    grid: WorldGrid,
    seed: number,
    islands: readonly GeneratedIsland[],
    dock: GridPoint,
  ): void {
    for (const island of islands) {
      if (island.sourceKind === "authored") this.paintAuthoredIsland(grid, island);
      else {
        this.paintIsland(grid, seed, island);
        if (island.kind === IslandKind.Atoll) this.carveAtollPassage(grid, seed, island);
      }
    }
    this.assertOpenOcean(grid, dock, islands);
  }

  private buildProfiles(seed: number, catalog: Readonly<AuthoredIslandCatalog>): IslandProfile[] {
    const selectedAuthored = this.selectAuthoredIslands(seed, catalog.islands);
    const profiles: IslandProfile[] = selectedAuthored.map((entry, index) => {
      const radiusX = entry.gridWidth / 2;
      const radiusY = entry.gridHeight / 2;
      const major = Math.max(radiusX, radiusY);
      return {
        id: index + 1,
        kind: IslandKind.LowCay,
        size: major <= this.config.islands.minRadius ? IslandSize.Small
          : major >= this.config.islands.maxRadius * 0.75 ? IslandSize.Large : IslandSize.Medium,
        radiusX,
        radiusY,
        outerRadius: Math.hypot(Math.ceil(radiusX), Math.ceil(radiusY)) + this.config.islands.apronWidth,
        rotation: 0,
        shapeSeed: this.stableStringHash(entry.assetId),
        sourceKind: "authored",
        authoredAssetId: entry.assetId,
        authoredCollision: {
          gridWidth: entry.gridWidth,
          gridHeight: entry.gridHeight,
          solidSubcells: entry.solidSubcells,
        },
      };
    });
    for (let index = selectedAuthored.length; index < this.config.islands.count; index++) {
      const id = index + 1;
      const kind = this.chooseKind(seed, index);
      const size = this.chooseSize(seed, index, kind);
      const dimensions = this.chooseDimensions(seed, index, kind, size);
      const radiusX = dimensions.radiusX;
      const radiusY = dimensions.radiusY;
      const majorRadius = Math.max(radiusX, radiusY);
      const maximumPaintRadius = majorRadius * (1.12 + this.config.islands.edgeNoise / 2);
      const shapeSeed = Math.floor(seededValue(seed + SHAPE_NAMESPACE, id, 0) * 0xffff_ffff) >>> 0;
      profiles.push({
        id,
        kind,
        size,
        radiusX,
        radiusY,
        outerRadius: Math.max(majorRadius + this.config.islands.apronWidth, maximumPaintRadius),
        rotation: seededValue(seed + PROFILE_NAMESPACE, id, 7) * TWO_PI,
        shapeSeed,
        sourceKind: "procedural",
      });
    }
    return profiles;
  }

  private selectAuthoredIslands(
    seed: number,
    islands: readonly Readonly<AuthoredIslandCatalogEntry>[],
  ): readonly Readonly<AuthoredIslandCatalogEntry>[] {
    const stable = [...islands].sort((left, right) => left.assetId.localeCompare(right.assetId, "en"));
    if (stable.length <= this.config.islands.count) return stable;
    return stable
      .map((entry) => ({
        entry,
        rank: seededValue(seed + AUTHORED_SELECTION_NAMESPACE, this.stableStringHash(entry.assetId), 0),
      }))
      .sort((left, right) => left.rank - right.rank || left.entry.assetId.localeCompare(right.entry.assetId, "en"))
      .slice(0, this.config.islands.count)
      .map(({ entry }) => entry)
      .sort((left, right) => left.assetId.localeCompare(right.assetId, "en"));
  }

  private stableStringHash(value: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  private chooseKind(seed: number, index: number): IslandKind {
    const guaranteed = [
      IslandKind.RockySkerry,
      IslandKind.HighIsland,
      IslandKind.Atoll,
      IslandKind.LowCay,
    ] as const;
    if (index < guaranteed.length) return guaranteed[index];

    const weighted = [
      [IslandKind.HighIsland, this.config.islands.highIslandWeight],
      [IslandKind.LowCay, this.config.islands.lowCayWeight],
      [IslandKind.Atoll, this.config.islands.atollWeight],
      [IslandKind.RockySkerry, this.config.islands.rockySkerryWeight],
    ] as const;
    const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    let choice = seededValue(seed + PROFILE_NAMESPACE, index, 1) * total;
    for (const [kind, weight] of weighted) {
      choice -= weight;
      if (choice <= 0 && weight > 0) return kind;
    }
    return IslandKind.HighIsland;
  }

  private chooseSize(seed: number, index: number, kind: IslandKind): IslandSize {
    if (index === 0) return IslandSize.Small;
    if (index === 1) return IslandSize.Large;
    if (index === 2) return IslandSize.Medium;
    if (index === 3) return IslandSize.Small;

    const roll = seededValue(seed + PROFILE_NAMESPACE, index, 2);
    let size = roll < 0.5 ? IslandSize.Small : roll < 0.85 ? IslandSize.Medium : IslandSize.Large;
    if ((kind === IslandKind.HighIsland || kind === IslandKind.Atoll) && size === IslandSize.Small) {
      size = IslandSize.Medium;
    }
    if ((kind === IslandKind.LowCay || kind === IslandKind.RockySkerry) && size === IslandSize.Large) {
      size = IslandSize.Medium;
    }
    return size;
  }

  private chooseDimensions(
    seed: number,
    index: number,
    kind: IslandKind,
    size: IslandSize,
  ): { radiusX: number; radiusY: number } {
    if (index === 0) {
      const radiusX = this.config.world.hiddenObstacleRadius;
      return {
        radiusX,
        radiusY: Math.max(1.25, radiusX * lerp(0.72, 0.9, seededValue(seed + PROFILE_NAMESPACE, 1, 3))),
      };
    }

    const range = this.config.islands.maxRadius - this.config.islands.minRadius;
    const band = size === IslandSize.Small
      ? [0, 0.25]
      : size === IslandSize.Medium
        ? [0.36, 0.65]
        : [0.76, 1];
    const roll = seededValue(seed + PROFILE_NAMESPACE, index, 3);
    const major = this.config.islands.minRadius + range * lerp(band[0], band[1], roll);
    const aspectRoll = seededValue(seed + PROFILE_NAMESPACE, index, 4);
    let minorScale: number;
    switch (kind) {
      case IslandKind.HighIsland: minorScale = lerp(0.72, 0.9, aspectRoll); break;
      case IslandKind.LowCay: minorScale = lerp(0.38, 0.56, aspectRoll); break;
      case IslandKind.Atoll: minorScale = lerp(0.82, 0.98, aspectRoll); break;
      case IslandKind.RockySkerry: minorScale = lerp(0.62, 0.82, aspectRoll); break;
    }
    return { radiusX: major, radiusY: Math.max(1.25, major * minorScale) };
  }

  private placeStarterIsland(
    grid: WorldGrid,
    seed: number,
    home: GridPoint,
    dock: GridPoint,
    profile: IslandProfile,
    placementIndex: IslandPlacementIndex,
  ): GeneratedIsland {
    const diagnostics = this.createAttemptDiagnostics();
    const minimumDistance = this.minimumHomeDistance(profile);
    const baseDistance = Math.max(this.config.world.hiddenObstacleDistance, minimumDistance + 0.5);
    for (let attempt = 0; attempt < this.config.islands.placementAttempts; attempt++) {
      const angle = seededValue(seed + PLACEMENT_NAMESPACE, profile.id, attempt) * TWO_PI;
      const distanceJitter = (seededValue(seed + PLACEMENT_NAMESPACE + 17, profile.id, attempt) - 0.5) * 3;
      const rawCenter = {
        x: Math.round(home.x + Math.cos(angle) * (baseDistance + distanceJitter)),
        y: Math.round(home.y + Math.sin(angle) * (baseDistance + distanceJitter)),
      };
      const center = grid.topology.canonicalizeTile(rawCenter.x, rawCenter.y);
      if (!center) continue;
      if (this.isValidCenter(grid, home, dock, profile, center, placementIndex, diagnostics)) {
        return this.finishRecord(profile, center);
      }
    }
    return this.placeFallback(grid, seed, home, dock, profile, placementIndex, diagnostics);
  }

  private placeIsland(
    grid: WorldGrid,
    seed: number,
    home: GridPoint,
    dock: GridPoint,
    profile: IslandProfile,
    placementIndex: IslandPlacementIndex,
  ): GeneratedIsland {
    const diagnostics = this.createAttemptDiagnostics();
    const extent = this.profileExtent(profile);
    if (extent.width >= grid.width || extent.height >= grid.height) {
      throw this.createPlacementError(grid, seed, profile, placementIndex, diagnostics);
    }

    for (let attempt = 0; attempt < this.config.islands.placementAttempts; attempt++) {
      const center = this.samplePlacementCenter(grid, seed, profile.id, attempt);
      if (this.isValidCenter(grid, home, dock, profile, center, placementIndex, diagnostics)) {
        return this.finishRecord(profile, center);
      }
    }
    return this.placeFallback(grid, seed, home, dock, profile, placementIndex, diagnostics);
  }

  private samplePlacementCenter(
    grid: WorldGrid,
    seed: number,
    islandId: number,
    attempt: number,
  ): GridPoint {
    const { archipelagoBias, archipelagoClusters, archipelagoRadius } = this.config.islands;
    const useArchipelago = archipelagoClusters > 0
      && seededValue(seed + PLACEMENT_NAMESPACE + 101, islandId, attempt) < archipelagoBias;
    if (!useArchipelago) {
      return {
        x: Math.floor(seededValue(seed + PLACEMENT_NAMESPACE, islandId, attempt * 2) * grid.width),
        y: Math.floor(seededValue(seed + PLACEMENT_NAMESPACE, islandId, attempt * 2 + 1) * grid.height),
      };
    }

    const cluster = Math.min(
      archipelagoClusters - 1,
      Math.floor(seededValue(seed + PLACEMENT_NAMESPACE + 211, islandId, attempt) * archipelagoClusters),
    );
    const clusterX = seededValue(seed + PLACEMENT_NAMESPACE + 307, cluster, 0) * grid.width;
    const clusterY = seededValue(seed + PLACEMENT_NAMESPACE + 307, cluster, 1) * grid.height;
    const angle = seededValue(seed + PLACEMENT_NAMESPACE + 401, islandId, attempt) * TWO_PI;
    // Square root produces uniform area density rather than crowding every
    // candidate into the exact centre of an archipelago.
    const distance = Math.sqrt(
      seededValue(seed + PLACEMENT_NAMESPACE + 503, islandId, attempt),
    ) * archipelagoRadius;
    return grid.topology.normalizeTile(
      Math.round(clusterX + Math.cos(angle) * distance),
      Math.round(clusterY + Math.sin(angle) * distance),
    );
  }

  private placeFallback(
    grid: WorldGrid,
    seed: number,
    home: GridPoint,
    dock: GridPoint,
    profile: IslandProfile,
    placementIndex: IslandPlacementIndex,
    diagnostics: PlacementAttemptDiagnostics,
  ): GeneratedIsland {
    const total = grid.tileCount;
    const start = Math.floor(seededValue(seed + PLACEMENT_NAMESPACE + 31, profile.id, 0) * total);
    for (let offset = 0; offset < total; offset++) {
      const index = (start + offset) % total;
      const center = grid.pointFromIndex(index);
      if (this.isValidCenter(grid, home, dock, profile, center, placementIndex, diagnostics)) {
        return this.finishRecord(profile, center);
      }
    }
    throw this.createPlacementError(grid, seed, profile, placementIndex, diagnostics);
  }

  private isValidCenter(
    grid: WorldGrid,
    home: GridPoint,
    dock: GridPoint,
    profile: IslandProfile,
    center: GridPoint,
    placementIndex: IslandPlacementIndex,
    diagnostics: PlacementAttemptDiagnostics,
  ): boolean {
    diagnostics.candidatesEvaluated++;
    const homeDisplacement = grid.topology.minimumImageTileDisplacement(home, center);
    if (Math.hypot(homeDisplacement.x, homeDisplacement.y) < this.minimumHomeDistance(profile)) {
      return this.reject(diagnostics, "home-clearance");
    }

    if (this.intersectsStarterLane(grid, dock, center, profile.outerRadius)) {
      return this.reject(diagnostics, "starter-lane");
    }

    if (placementIndex.findConflict(center, profile.outerRadius)) {
      return this.reject(diagnostics, "island-channel");
    }
    return true;
  }

  private createAttemptDiagnostics(): PlacementAttemptDiagnostics {
    return {
      candidatesEvaluated: 0,
      rejectionCounts: {
        "home-clearance": 0,
        "starter-lane": 0,
        "island-channel": 0,
      },
    };
  }

  private reject(
    diagnostics: PlacementAttemptDiagnostics,
    reason: IslandPlacementRejection,
  ): false {
    diagnostics.rejectionCounts[reason]++;
    return false;
  }

  private createPlacementError(
    grid: WorldGrid,
    seed: number,
    profile: IslandProfile,
    placementIndex: IslandPlacementIndex,
    attempts: PlacementAttemptDiagnostics,
  ): IslandPlacementError {
    const rejectionCounts = Object.freeze({ ...attempts.rejectionCounts });
    return new IslandPlacementError(Object.freeze({
      seed,
      islandId: profile.id,
      sourceKind: profile.sourceKind,
      authoredAssetId: profile.authoredAssetId,
      placedIslandCount: placementIndex.diagnostics().islandCount,
      worldWidth: grid.width,
      worldHeight: grid.height,
      outerRadius: profile.outerRadius,
      randomAttemptLimit: this.config.islands.placementAttempts,
      fallbackScanLimit: grid.tileCount,
      candidatesEvaluated: attempts.candidatesEvaluated,
      rejectionCounts,
      spatialIndex: placementIndex.diagnostics(),
    }));
  }

  private minimumHomeDistance(profile: IslandProfile): number {
    return this.config.world.supportedWaterRadius
      + this.config.world.supportedBoundaryNoise
      + this.config.islands.homeClearance
      + profile.outerRadius;
  }

  private profileExtent(profile: Readonly<IslandProfile>): Readonly<{ width: number; height: number }> {
    if (profile.sourceKind === "authored" && profile.authoredCollision) {
      return {
        width: profile.authoredCollision.gridWidth,
        height: profile.authoredCollision.gridHeight,
      };
    }
    const extent = Math.ceil(profile.outerRadius);
    return { width: extent * 2 + 1, height: extent * 2 + 1 };
  }

  private intersectsStarterLane(
    grid: Readonly<WorldGrid>,
    dock: Readonly<GridPoint>,
    center: Readonly<GridPoint>,
    outerRadius: number,
  ): boolean {
    return intersectsPeriodicStarterLane(
      grid.topology,
      dock,
      center,
      outerRadius,
      this.config.islands.safeCorridorHalfWidth,
    );
  }

  private finishRecord(profile: IslandProfile, center: GridPoint): GeneratedIsland {
    if (profile.sourceKind === "authored" && profile.authoredCollision) {
      const minX = center.x - Math.floor(profile.authoredCollision.gridWidth / 2);
      const minY = center.y - Math.floor(profile.authoredCollision.gridHeight / 2);
      return {
        ...profile,
        center,
        bounds: {
          minX,
          minY,
          maxX: minX + profile.authoredCollision.gridWidth - 1,
          maxY: minY + profile.authoredCollision.gridHeight - 1,
        },
      };
    }
    const extent = Math.ceil(profile.outerRadius);
    return {
      ...profile,
      center,
      bounds: {
        minX: center.x - extent,
        minY: center.y - extent,
        maxX: center.x + extent,
        maxY: center.y + extent,
      },
    };
  }

  private paintAuthoredIsland(grid: WorldGrid, island: GeneratedIsland): void {
    const collision = island.authoredCollision;
    if (!collision || !island.authoredAssetId) {
      throw new RangeError(`Authored island ${island.id} is missing its asset collision`);
    }
    const masks = new Uint16Array(collision.gridWidth * collision.gridHeight);
    for (const point of collision.solidSubcells) {
      const cellX = Math.floor(point.x / 4);
      const cellY = Math.floor(point.y / 4);
      const index = cellY * collision.gridWidth + cellX;
      masks[index] |= collisionSubcellBit(point.x % 4, point.y % 4);
    }
    const exteriorEmpty = authoredExteriorEmptyCells(
      masks,
      collision.gridWidth,
      collision.gridHeight,
    );
    const written = new Set<number>();
    for (let cellY = 0; cellY < collision.gridHeight; cellY++) {
      for (let cellX = 0; cellX < collision.gridWidth; cellX++) {
        const liftedX = island.bounds.minX + cellX;
        const liftedY = island.bounds.minY + cellY;
        const point = grid.topology.canonicalizeTile(liftedX, liftedY);
        if (!point) throw new RangeError(`Authored island ${island.authoredAssetId} left bounded world limits`);
        const index = cellY * collision.gridWidth + cellX;
        const mask = masks[index];
        if (mask === 0 && !authoredShelfContains(
          masks,
          exteriorEmpty,
          collision.gridWidth,
          collision.gridHeight,
          cellX,
          cellY,
          island.shapeSeed,
        )) continue;
        const worldIndex = grid.index(point.x, point.y);
        if (written.has(worldIndex)) continue;
        written.add(worldIndex);
        grid.setTerrain(point.x, point.y, mask === 0 ? TerrainType.ShallowOcean : TerrainType.Land);
        grid.setFineCollisionMask(point.x, point.y, mask);
        grid.setIslandId(point.x, point.y, island.id);
        grid.setKnowledge(point.x, point.y, KnowledgeState.Unknown, 0);
      }
    }
    const shelfRadius = 2;
    for (let cellY = -shelfRadius; cellY < collision.gridHeight + shelfRadius; cellY++) {
      for (let cellX = -shelfRadius; cellX < collision.gridWidth + shelfRadius; cellX++) {
        if (cellX >= 0 && cellY >= 0 && cellX < collision.gridWidth && cellY < collision.gridHeight) continue;
        if (!authoredShelfDistanceContains(
          masks,
          collision.gridWidth,
          collision.gridHeight,
          cellX,
          cellY,
          island.shapeSeed,
        )) continue;
        const point = grid.topology.canonicalizeTile(
          island.bounds.minX + cellX,
          island.bounds.minY + cellY,
        );
        if (!point || grid.getIslandId(point.x, point.y) >= 0) continue;
        if (grid.getTerrain(point.x, point.y) === TerrainType.DeepOcean) {
          grid.setTerrain(point.x, point.y, TerrainType.ShallowOcean);
        }
      }
    }
  }

  private paintIsland(grid: WorldGrid, seed: number, island: GeneratedIsland): void {
    const cosine = Math.cos(island.rotation);
    const sine = Math.sin(island.rotation);
    const passageAngle = seededValue(seed + TERRAIN_NAMESPACE, island.id, 0) * TWO_PI - Math.PI;
    const passageHalfWidth = Math.max(0.24, 1.25 / Math.max(island.radiusX, island.radiusY));

    const written = new Set<number>();
    for (let liftedY = island.bounds.minY; liftedY <= island.bounds.maxY; liftedY++) {
      for (let liftedX = island.bounds.minX; liftedX <= island.bounds.maxX; liftedX++) {
        const point = grid.topology.canonicalizeTile(liftedX, liftedY);
        if (!point) throw new RangeError(`Procedural island ${island.id} left bounded world limits`);
        const worldIndex = grid.index(point.x, point.y);
        if (written.has(worldIndex)) continue;
        written.add(worldIndex);
        const dx = liftedX - island.center.x;
        const dy = liftedY - island.center.y;
        const localX = cosine * dx + sine * dy;
        const localY = -sine * dx + cosine * dy;
        const normalized = Math.hypot(localX / island.radiusX, localY / island.radiusY);
        const coarse = seededValue(island.shapeSeed, Math.floor(dx / 2), Math.floor(dy / 2)) - 0.5;
        const fine = seededValue(island.shapeSeed + SHAPE_NAMESPACE, dx, dy) - 0.5;
        const shaped = normalized + (coarse * 0.72 + fine * 0.28) * this.config.islands.edgeNoise;
        const detail = seededValue(seed + TERRAIN_NAMESPACE + island.id * 101, dx, dy);
        const angle = Math.atan2(localY / island.radiusY, localX / island.radiusX);
        const terrain = this.chooseTerrain(island.kind, shaped, detail, angle, passageAngle, passageHalfWidth);
        if (terrain === undefined) continue;
        grid.setTerrain(point.x, point.y, terrain);
        grid.setIslandId(point.x, point.y, island.id);
        grid.setKnowledge(point.x, point.y, KnowledgeState.Unknown, 0);
      }
    }
  }

  private chooseTerrain(
    kind: IslandKind,
    shaped: number,
    detail: number,
    angle: number,
    passageAngle: number,
    passageHalfWidth: number,
  ): TerrainType | undefined {
    switch (kind) {
      case IslandKind.HighIsland:
        if (shaped <= 0.65) return TerrainType.Land;
        if (shaped <= 0.8) return detail > 0.7 ? TerrainType.Rock : TerrainType.Land;
        if (shaped <= 1.1) return shaped > 0.91 && detail > 0.84 ? TerrainType.Reef : TerrainType.ShallowOcean;
        return undefined;
      case IslandKind.LowCay:
        if (shaped <= 0.5) return detail > 0.88 ? TerrainType.ShallowOcean : TerrainType.Land;
        if (shaped <= 1.1) return shaped > 0.94 && detail > 0.9 ? TerrainType.Reef : TerrainType.ShallowOcean;
        return undefined;
      case IslandKind.Atoll:
        if (shaped <= 0.5) return TerrainType.ShallowOcean;
        if (shaped <= 0.88) {
          if (angularDistance(angle, passageAngle) <= passageHalfWidth) return TerrainType.ShallowOcean;
          return detail > 0.9 ? TerrainType.Land : TerrainType.Reef;
        }
        if (shaped <= 1.12) return TerrainType.ShallowOcean;
        return undefined;
      case IslandKind.RockySkerry:
        if (shaped <= 0.68) return shaped < 0.34 && detail < 0.28 ? TerrainType.Land : TerrainType.Rock;
        if (shaped <= 1.06) return shaped > 0.84 && detail > 0.68 ? TerrainType.Reef : TerrainType.ShallowOcean;
        return undefined;
    }
  }

  /** Carves a cardinally connected one-ship channel from lagoon to open ocean. */
  private carveAtollPassage(grid: WorldGrid, seed: number, island: GeneratedIsland): void {
    const localPassageAngle = seededValue(seed + TERRAIN_NAMESPACE, island.id, 0) * TWO_PI - Math.PI;
    const worldPassageAngle = island.rotation + localPassageAngle;
    const length = Math.ceil(island.outerRadius) + 1;
    let x = island.center.x;
    let y = island.center.y;
    this.setPassageTile(grid, island, x, y);

    for (let step = 1; step <= length; step++) {
      const targetX = Math.round(island.center.x + Math.cos(worldPassageAngle) * step);
      const targetY = Math.round(island.center.y + Math.sin(worldPassageAngle) * step);
      while (x !== targetX) {
        x += Math.sign(targetX - x);
        this.setPassageTile(grid, island, x, y);
      }
      while (y !== targetY) {
        y += Math.sign(targetY - y);
        this.setPassageTile(grid, island, x, y);
      }
    }
  }

  private setPassageTile(grid: WorldGrid, island: GeneratedIsland, x: number, y: number): void {
    const point = grid.topology.canonicalizeTile(x, y);
    if (!point) throw new RangeError(`Atoll ${island.id} passage left bounded world limits`);
    const existingIslandId = grid.getTile(point.x, point.y).islandId;
    if (existingIslandId > 0 && existingIslandId !== island.id) {
      throw new RangeError(`Atoll ${island.id} passage intersected island ${existingIslandId}`);
    }
    grid.setTerrain(point.x, point.y, TerrainType.ShallowOcean);
    if (Math.hypot(x - island.center.x, y - island.center.y) <= island.outerRadius) {
      grid.setIslandId(point.x, point.y, island.id);
    }
    grid.setKnowledge(point.x, point.y, KnowledgeState.Unknown, 0);
  }

  private assertOpenOcean(
    grid: WorldGrid,
    dock: GridPoint,
    islands: readonly GeneratedIsland[],
  ): void {
    const graph = new GridGraph(grid, this.config);
    const start = grid.index(dock.x, dock.y);
    if (!graph.isNavigationNodePassable(start)) throw new RangeError("Island generation blocked the home dock");
    const visited = new Uint8Array(grid.tileCount);
    const imageOffsetX = new Int32Array(grid.tileCount);
    const imageOffsetY = new Int32Array(grid.tileCount);
    const queue = new Int32Array(grid.tileCount);
    const componentByIndex = new Uint32Array(grid.tileCount);
    const componentSizes: number[] = [0];
    const componentWinding: Array<Readonly<{ horizontal: boolean; vertical: boolean }>> = [
      { horizontal: false, vertical: false },
    ];
    let componentId = 0;

    const traverse = (componentStart: number): void => {
      componentId++;
      let head = 0;
      let tail = 0;
      let horizontal = false;
      let vertical = false;
      visited[componentStart] = 1;
      componentByIndex[componentStart] = componentId;
      imageOffsetX[componentStart] = 0;
      imageOffsetY[componentStart] = 0;
      queue[tail++] = componentStart;
      while (head < tail) {
        const index = queue[head++];
        graph.forEachTraversableCardinalEdge(
          index,
          (neighbor, _x, _y, _direction, _reverseDirection, edgeOffsetX, edgeOffsetY) => {
            const proposedX = imageOffsetX[index] + edgeOffsetX;
            const proposedY = imageOffsetY[index] + edgeOffsetY;
            if (!visited[neighbor]) {
              visited[neighbor] = 1;
              componentByIndex[neighbor] = componentId;
              imageOffsetX[neighbor] = proposedX;
              imageOffsetY[neighbor] = proposedY;
              queue[tail++] = neighbor;
              return;
            }
            if (componentByIndex[neighbor] !== componentId) return;
            const cycleX = proposedX - imageOffsetX[neighbor];
            const cycleY = proposedY - imageOffsetY[neighbor];
            horizontal ||= cycleX !== 0 && cycleX % grid.width === 0 && cycleY === 0;
            vertical ||= cycleY !== 0 && cycleY % grid.height === 0 && cycleX === 0;
          },
        );
      }
      componentSizes[componentId] = tail;
      componentWinding[componentId] = { horizontal, vertical };
    };

    traverse(start);
    const dockComponentId = componentByIndex[start];
    for (let index = 0; index < grid.tileCount; index++) {
      if (visited[index] || !graph.isNavigationNodePassable(index)) continue;
      traverse(index);
    }

    const dockSize = componentSizes[dockComponentId];
    for (let id = 1; id < componentSizes.length; id++) {
      if (id !== dockComponentId && componentSizes[id] >= dockSize) {
        throw new RangeError("The home dock ocean component is not uniquely largest");
      }
    }
    const winding = componentWinding[dockComponentId];
    if (!winding.horizontal || !winding.vertical) {
      throw new RangeError("The home dock ocean lacks independent horizontal and vertical circumnavigation cycles");
    }
    for (const island of islands) {
      if (island.kind !== IslandKind.Atoll) continue;
      if (componentByIndex[grid.index(island.center.x, island.center.y)] !== dockComponentId) {
        throw new RangeError(`Atoll ${island.id} lagoon is outside the global ocean component`);
      }
    }
  }
}

/** Marks transparent canvas space connected to the asset bounds as exterior. */
function authoredExteriorEmptyCells(
  masks: Uint16Array,
  width: number,
  height: number,
): Uint8Array {
  const exterior = new Uint8Array(masks.length);
  const queue = new Int32Array(masks.length);
  let head = 0;
  let tail = 0;
  const enqueue = (x: number, y: number): void => {
    const index = y * width + x;
    if (masks[index] !== 0 || exterior[index] !== 0) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    if (height > 1) enqueue(x, height - 1);
  }
  for (let y = 1; y + 1 < height; y++) {
    enqueue(0, y);
    if (width > 1) enqueue(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }
  return exterior;
}

/**
 * Keeps enclosed water and grows a narrow, deterministic non-uniform shelf
 * around the collision silhouette. Far transparent canvas cells remain the
 * ocean they were before the authored asset was stamped.
 */
function authoredShelfContains(
  masks: Uint16Array,
  exteriorEmpty: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  shapeSeed: number,
): boolean {
  const index = y * width + x;
  if (exteriorEmpty[index] === 0) return true;
  return authoredShelfDistanceContains(masks, width, height, x, y, shapeSeed);
}

function authoredShelfDistanceContains(
  masks: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
  shapeSeed: number,
): boolean {
  let nearestSquared = Number.POSITIVE_INFINITY;
  const radius = 2;
  for (let solidY = Math.max(0, y - radius); solidY <= Math.min(height - 1, y + radius); solidY++) {
    for (let solidX = Math.max(0, x - radius); solidX <= Math.min(width - 1, x + radius); solidX++) {
      if (masks[solidY * width + solidX] === 0) continue;
      const dx = solidX - x;
      const dy = solidY - y;
      nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
    }
  }
  if (nearestSquared <= 2) return true;
  return nearestSquared <= 5
    && seededValue(shapeSeed + AUTHORED_SHELF_NAMESPACE, x, y) > 0.66;
}
