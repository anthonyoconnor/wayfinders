import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import {
  IslandPlacementIndex,
  type IslandPlacementIndexStats,
} from "./IslandPlacementIndex";
import { KnowledgeState, TerrainType } from "./TileData";
import { seededValue } from "./SeededRandom";
import type { WorldGrid } from "./WorldGrid";

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
}

interface IslandProfile extends Omit<GeneratedIsland, "center" | "bounds"> {}

export type IslandPlacementRejection = "edge" | "home-clearance" | "starter-lane" | "island-channel";

export interface IslandPlacementFailureDiagnostics {
  readonly seed: number;
  readonly islandId: number;
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
    super(
      `Unable to place configured island ${diagnostics.islandId} for seed ${diagnostics.seed} `
      + `after ${diagnostics.candidatesEvaluated} bounded candidates in `
      + `${diagnostics.worldWidth}x${diagnostics.worldHeight}; rejected `
      + `edge=${rejected.edge}, home-clearance=${rejected["home-clearance"]}, `
      + `starter-lane=${rejected["starter-lane"]}, island-channel=${rejected["island-channel"]}. `
      + `Reduce island count/radii, edge margin, home clearance, or minimum channel width.`,
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
const TWO_PI = Math.PI * 2;

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function angularDistance(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI);
}

/** Deterministic, bounded scatter and terrain painter for non-home islands. */
export class IslandGenerator {
  constructor(private readonly config: PrototypeConfig = prototypeConfig) {}

  /** Deterministically lays out descriptors without touching logical tile state. */
  plan(grid: WorldGrid, seed: number, home: GridPoint, dock: GridPoint): GeneratedIsland[] {
    const profiles = this.buildProfiles(seed);
    const placed: GeneratedIsland[] = [];
    const maximumOuterRadius = profiles.reduce(
      (maximum, profile) => Math.max(maximum, profile.outerRadius),
      0,
    );
    const placementIndex = new IslandPlacementIndex(
      maximumOuterRadius,
      this.config.islands.minimumChannelWidth,
    );

    const starterProfile = profiles.find(({ id }) => id === 1);
    if (!starterProfile) throw new RangeError("Scattered island generation requires starter island profile 1");
    const starterIsland = this.placeStarterIsland(grid, seed, home, dock, starterProfile, placementIndex);
    placed.push(starterIsland);
    placementIndex.add(starterIsland);

    const remaining = profiles
      .filter(({ id }) => id !== 1)
      .sort((a, b) => b.outerRadius - a.outerRadius || a.id - b.id);
    for (const profile of remaining) {
      const island = this.placeIsland(grid, seed, home, dock, profile, placementIndex);
      placed.push(island);
      placementIndex.add(island);
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
      this.paintIsland(grid, seed, island);
      if (island.kind === IslandKind.Atoll) this.carveAtollPassage(grid, seed, island);
    }
    this.assertOpenOcean(grid, dock, islands);
  }

  private buildProfiles(seed: number): IslandProfile[] {
    const profiles: IslandProfile[] = [];
    for (let index = 0; index < this.config.islands.count; index++) {
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
      });
    }
    return profiles;
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
      const center = {
        x: Math.round(home.x + Math.cos(angle) * (baseDistance + distanceJitter)),
        y: Math.round(home.y + Math.sin(angle) * (baseDistance + distanceJitter)),
      };
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
    const margin = Math.ceil(profile.outerRadius + this.config.islands.edgeMargin);
    const spanX = grid.width - margin * 2;
    const spanY = grid.height - margin * 2;
    if (spanX < 0 || spanY < 0) {
      throw this.createPlacementError(grid, seed, profile, placementIndex, diagnostics);
    }

    for (let attempt = 0; attempt < this.config.islands.placementAttempts; attempt++) {
      const center = this.samplePlacementCenter(seed, profile.id, attempt, margin, spanX, spanY);
      if (this.isValidCenter(grid, home, dock, profile, center, placementIndex, diagnostics)) {
        return this.finishRecord(profile, center);
      }
    }
    return this.placeFallback(grid, seed, home, dock, profile, placementIndex, diagnostics);
  }

  private samplePlacementCenter(
    seed: number,
    islandId: number,
    attempt: number,
    margin: number,
    spanX: number,
    spanY: number,
  ): GridPoint {
    const { archipelagoBias, archipelagoClusters, archipelagoRadius } = this.config.islands;
    const useArchipelago = archipelagoClusters > 0
      && seededValue(seed + PLACEMENT_NAMESPACE + 101, islandId, attempt) < archipelagoBias;
    if (!useArchipelago) {
      return {
        x: margin + Math.floor(seededValue(seed + PLACEMENT_NAMESPACE, islandId, attempt * 2) * (spanX + 1)),
        y: margin + Math.floor(seededValue(seed + PLACEMENT_NAMESPACE, islandId, attempt * 2 + 1) * (spanY + 1)),
      };
    }

    const cluster = Math.min(
      archipelagoClusters - 1,
      Math.floor(seededValue(seed + PLACEMENT_NAMESPACE + 211, islandId, attempt) * archipelagoClusters),
    );
    const clusterX = margin + seededValue(seed + PLACEMENT_NAMESPACE + 307, cluster, 0) * spanX;
    const clusterY = margin + seededValue(seed + PLACEMENT_NAMESPACE + 307, cluster, 1) * spanY;
    const angle = seededValue(seed + PLACEMENT_NAMESPACE + 401, islandId, attempt) * TWO_PI;
    // Square root produces uniform area density rather than crowding every
    // candidate into the exact centre of an archipelago.
    const distance = Math.sqrt(
      seededValue(seed + PLACEMENT_NAMESPACE + 503, islandId, attempt),
    ) * archipelagoRadius;
    return {
      x: Math.max(margin, Math.min(margin + spanX, Math.round(clusterX + Math.cos(angle) * distance))),
      y: Math.max(margin, Math.min(margin + spanY, Math.round(clusterY + Math.sin(angle) * distance))),
    };
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
    const edge = this.config.islands.edgeMargin;
    if (
      center.x - profile.outerRadius < edge
      || center.y - profile.outerRadius < edge
      || center.x + profile.outerRadius > grid.width - 1 - edge
      || center.y + profile.outerRadius > grid.height - 1 - edge
    ) return this.reject(diagnostics, "edge");
    if (Math.hypot(center.x - home.x, center.y - home.y) < this.minimumHomeDistance(profile)) {
      return this.reject(diagnostics, "home-clearance");
    }

    const corridor = this.config.islands.safeCorridorHalfWidth;
    if (
      center.x + profile.outerRadius >= dock.x
      && center.y - profile.outerRadius <= dock.y + corridor
      && center.y + profile.outerRadius >= dock.y - corridor
    ) return this.reject(diagnostics, "starter-lane");

    if (placementIndex.findConflict(center, profile.outerRadius)) {
      return this.reject(diagnostics, "island-channel");
    }
    return true;
  }

  private createAttemptDiagnostics(): PlacementAttemptDiagnostics {
    return {
      candidatesEvaluated: 0,
      rejectionCounts: {
        edge: 0,
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

  private finishRecord(profile: IslandProfile, center: GridPoint): GeneratedIsland {
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

  private paintIsland(grid: WorldGrid, seed: number, island: GeneratedIsland): void {
    const cosine = Math.cos(island.rotation);
    const sine = Math.sin(island.rotation);
    const passageAngle = seededValue(seed + TERRAIN_NAMESPACE, island.id, 0) * TWO_PI - Math.PI;
    const passageHalfWidth = Math.max(0.24, 1.25 / Math.max(island.radiusX, island.radiusY));

    for (let y = island.bounds.minY; y <= island.bounds.maxY; y++) {
      for (let x = island.bounds.minX; x <= island.bounds.maxX; x++) {
        if (!grid.inBounds(x, y)) continue;
        const dx = x - island.center.x;
        const dy = y - island.center.y;
        const localX = cosine * dx + sine * dy;
        const localY = -sine * dx + cosine * dy;
        const normalized = Math.hypot(localX / island.radiusX, localY / island.radiusY);
        const coarse = seededValue(island.shapeSeed, Math.floor(x / 2), Math.floor(y / 2)) - 0.5;
        const fine = seededValue(island.shapeSeed + SHAPE_NAMESPACE, x, y) - 0.5;
        const shaped = normalized + (coarse * 0.72 + fine * 0.28) * this.config.islands.edgeNoise;
        const detail = seededValue(seed + TERRAIN_NAMESPACE + island.id * 101, x, y);
        const angle = Math.atan2(localY / island.radiusY, localX / island.radiusX);
        const terrain = this.chooseTerrain(island.kind, shaped, detail, angle, passageAngle, passageHalfWidth);
        if (terrain === undefined) continue;
        grid.setTerrain(x, y, terrain);
        grid.setIslandId(x, y, island.id);
        grid.setKnowledge(x, y, KnowledgeState.Unknown, 0);
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
    if (!grid.inBounds(x, y)) throw new RangeError(`Atoll ${island.id} passage left the world bounds`);
    const existingIslandId = grid.getTile(x, y).islandId;
    if (existingIslandId > 0 && existingIslandId !== island.id) {
      throw new RangeError(`Atoll ${island.id} passage intersected island ${existingIslandId}`);
    }
    grid.setTerrain(x, y, TerrainType.ShallowOcean);
    if (Math.hypot(x - island.center.x, y - island.center.y) <= island.outerRadius) {
      grid.setIslandId(x, y, island.id);
    }
    grid.setKnowledge(x, y, KnowledgeState.Unknown, 0);
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
    const queue = new Int32Array(grid.tileCount);
    const unreachedAtollCenters = new Set<number>();
    for (const island of islands) {
      if (island.kind === IslandKind.Atoll) {
        unreachedAtollCenters.add(grid.index(island.center.x, island.center.y));
      }
    }
    let head = 0;
    let tail = 0;
    visited[start] = 1;
    queue[tail++] = start;
    let reachedEdges = 0;
    const allEdges = 0b1111;

    while (head < tail) {
      const index = queue[head++];
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      if (y === 0) reachedEdges |= 0b0001;
      if (x === grid.width - 1) reachedEdges |= 0b0010;
      if (y === grid.height - 1) reachedEdges |= 0b0100;
      if (x === 0) reachedEdges |= 0b1000;
      unreachedAtollCenters.delete(index);
      if (reachedEdges === allEdges && unreachedAtollCenters.size === 0) return;

      graph.forEachTraversableCardinalNeighbor(index, (neighbor) => {
        if (visited[neighbor]) return;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      });
    }

    if (reachedEdges !== allEdges) {
      throw new RangeError("Generated islands disconnected the home dock from the open ocean");
    }
    for (const island of islands) {
      if (island.kind !== IslandKind.Atoll) continue;
      if (!visited[grid.index(island.center.x, island.center.y)]) {
        throw new RangeError(`Atoll ${island.id} lagoon is disconnected from the open ocean`);
      }
    }
  }
}
