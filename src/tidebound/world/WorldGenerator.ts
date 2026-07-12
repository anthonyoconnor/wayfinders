import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { IslandGenerator, type GeneratedIsland } from "./IslandGenerator";
import { seededValue } from "./SeededRandom";
import { KnowledgeState, TerrainType } from "./TileData";
import { WorldGrid } from "./WorldGrid";

export { seededValue } from "./SeededRandom";

export interface WorldLandmarks {
  homeCenter: GridPoint;
  harbour: GridPoint;
  dock: GridPoint;
  homeReturnTile: GridPoint;
  hiddenObstacleCenter: GridPoint;
  hiddenResource: GridPoint;
}

export interface GeneratedWorld {
  seed: number;
  grid: WorldGrid;
  landmarks: WorldLandmarks;
  islands: readonly GeneratedIsland[];
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(seed: number, x: number, y: number, scale: number): number {
  const scaledX = x / scale;
  const scaledY = y / scale;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const tx = smoothStep(scaledX - x0);
  const ty = smoothStep(scaledY - y0);
  const a = seededValue(seed, x0, y0);
  const b = seededValue(seed, x0 + 1, y0);
  const c = seededValue(seed, x0, y0 + 1);
  const d = seededValue(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

export class WorldGenerator {
  constructor(private readonly config: PrototypeConfig = prototypeConfig) {}

  generate(seed = this.config.world.seed): GeneratedWorld {
    const grid = new WorldGrid(
      this.config.world.width,
      this.config.world.height,
      this.config.navigation.chunkSize,
    );
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);

    const homeCenter = {
      x: Math.floor(grid.width / 2),
      y: Math.floor(grid.height / 2),
    };
    const homeRadius = this.config.world.homeIslandRadius;
    const harbour = { x: homeCenter.x + homeRadius, y: homeCenter.y };
    const dock = { x: harbour.x + 1, y: harbour.y };

    this.paintSupportedWater(grid, seed, homeCenter);
    this.paintHomeIsland(grid, seed, homeCenter, harbour, dock);

    const islands = new IslandGenerator(this.config).generate(grid, seed, homeCenter, dock);
    const hiddenObstacleCenter = { ...islands[0].center };

    const hiddenResource = this.chooseHiddenResource(grid, seed, homeCenter, hiddenObstacleCenter);
    grid.setResourceId(hiddenResource.x, hiddenResource.y, 1);

    return {
      seed,
      grid,
      islands,
      landmarks: {
        homeCenter,
        harbour,
        dock,
        homeReturnTile: { ...dock },
        hiddenObstacleCenter,
        hiddenResource,
      },
    };
  }

  private paintSupportedWater(grid: WorldGrid, seed: number, center: GridPoint): void {
    const baseRadius = this.config.world.supportedWaterRadius;
    const noiseAmplitude = this.config.world.supportedBoundaryNoise;
    const noiseScale = this.config.world.supportedNoiseScale;
    const maximumRadius = baseRadius + noiseAmplitude;
    const extent = Math.ceil(maximumRadius);
    const minX = Math.max(0, center.x - extent);
    const maxX = Math.min(grid.width - 1, center.x + extent);
    const minY = Math.max(0, center.y - extent);
    const maxY = Math.min(grid.height - 1, center.y + extent);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - center.x;
        const dy = y - center.y;
        const distance = Math.hypot(dx, dy);
        if (distance > maximumRadius) continue;
        const noise = valueNoise(seed, x, y, noiseScale) * 2 - 1;
        if (distance <= baseRadius + noise * noiseAmplitude) {
          grid.setKnowledge(x, y, KnowledgeState.Supported, 0);
        }
      }
    }
  }

  private paintHomeIsland(
    grid: WorldGrid,
    seed: number,
    center: GridPoint,
    harbour: GridPoint,
    dock: GridPoint,
  ): void {
    const landRadius = this.config.world.homeIslandRadius;
    const shallowRadius = this.config.world.shallowWaterRadius;

    for (let y = center.y - shallowRadius; y <= center.y + shallowRadius; y++) {
      for (let x = center.x - shallowRadius; x <= center.x + shallowRadius; x++) {
        if (!grid.inBounds(x, y)) continue;
        const distance = Math.hypot(x - center.x, y - center.y);
        const edgeNoise = (seededValue(seed + 11, x, y) - 0.5) * 0.9;

        if (distance <= landRadius + edgeNoise) {
          this.setTerrain(grid, x, y, TerrainType.Land);
          grid.setIslandId(x, y, 0);
        } else if (distance <= shallowRadius + edgeNoise) {
          const protectsHarbourApproach = x >= center.x + landRadius - 1
            && Math.abs(y - center.y) <= this.config.islands.safeCorridorHalfWidth;
          const reefChance = seededValue(seed + 79, x, y);
          const terrain = !protectsHarbourApproach && distance > shallowRadius - 1.2 && reefChance > 0.88
            ? TerrainType.Reef
            : TerrainType.ShallowOcean;
          this.setTerrain(grid, x, y, terrain);
        }
      }
    }

    // Carve a readable east-facing harbour and a passable dock approach.
    for (let x = center.x + landRadius - 1; x <= dock.x; x++) {
      this.setTerrain(grid, x, center.y, TerrainType.ShallowOcean);
      grid.setIslandId(x, center.y, -1);
      grid.setKnowledge(x, center.y, KnowledgeState.Supported, 0);
    }
    this.setTerrain(grid, harbour.x, harbour.y, TerrainType.ShallowOcean);
    this.setTerrain(grid, dock.x, dock.y, TerrainType.ShallowOcean);
  }

  private chooseHiddenResource(grid: WorldGrid, seed: number, home: GridPoint, obstacle: GridPoint): GridPoint {
    const offsetSign = seededValue(seed + 307, 0, 0) < 0.5 ? -1 : 1;
    const candidate = {
      x: obstacle.x + offsetSign * (this.config.world.hiddenObstacleRadius + 3),
      y: obstacle.y + offsetSign * 2,
    };
    if (grid.inBounds(candidate.x, candidate.y) && !grid.isMovementBlocked(candidate.x, candidate.y)) return candidate;

    return {
      x: Math.max(0, Math.min(grid.width - 1, home.x - this.config.world.hiddenObstacleDistance)),
      y: home.y,
    };
  }

  private setTerrain(grid: WorldGrid, x: number, y: number, terrain: TerrainType): void {
    grid.setTerrain(x, y, terrain);
  }
}
