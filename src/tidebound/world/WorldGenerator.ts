import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { KnowledgeState, TerrainType, terrainBlocksMovement, terrainBlocksSight } from "./TileData";
import { WorldGrid } from "./WorldGrid";

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
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function seededValue(seed: number, x: number, y: number): number {
  const mixed = mix32(seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495));
  return mixed / 0x1_0000_0000;
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

    const hiddenObstacleCenter = this.chooseHiddenObstacleCenter(grid, seed, homeCenter);
    this.paintHiddenObstacle(grid, seed, hiddenObstacleCenter);

    const hiddenResource = this.chooseHiddenResource(grid, seed, homeCenter, hiddenObstacleCenter);
    grid.setResourceId(hiddenResource.x, hiddenResource.y, 1);

    return {
      seed,
      grid,
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

    grid.forEachTile((x, y) => {
      const dx = x - center.x;
      const dy = y - center.y;
      const distance = Math.hypot(dx, dy);
      const noise = valueNoise(seed, x, y, noiseScale) * 2 - 1;
      if (distance <= baseRadius + noise * noiseAmplitude) {
        grid.setKnowledge(x, y, KnowledgeState.Supported, 0);
      }
    });
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
          this.setTerrain(grid, x, y, TerrainType.ShallowOcean);
        }
      }
    }

    // Carve a readable east-facing harbour and a passable dock approach.
    for (let x = center.x; x <= dock.x; x++) {
      this.setTerrain(grid, x, center.y, TerrainType.ShallowOcean);
      grid.setIslandId(x, center.y, -1);
      grid.setKnowledge(x, center.y, KnowledgeState.Supported, 0);
    }
    this.setTerrain(grid, harbour.x, harbour.y, TerrainType.ShallowOcean);
    this.setTerrain(grid, dock.x, dock.y, TerrainType.ShallowOcean);
  }

  private chooseHiddenObstacleCenter(grid: WorldGrid, seed: number, home: GridPoint): GridPoint {
    const angle = seededValue(seed + 101, 0, 0) * Math.PI * 2;
    const distance = this.config.world.hiddenObstacleDistance;
    const radius = this.config.world.hiddenObstacleRadius;
    const margin = radius + 2;
    return {
      x: Math.max(margin, Math.min(grid.width - margin - 1, Math.round(home.x + Math.cos(angle) * distance))),
      y: Math.max(margin, Math.min(grid.height - margin - 1, Math.round(home.y + Math.sin(angle) * distance))),
    };
  }

  private paintHiddenObstacle(grid: WorldGrid, seed: number, center: GridPoint): void {
    const radius = this.config.world.hiddenObstacleRadius;
    for (let y = center.y - radius - 1; y <= center.y + radius + 1; y++) {
      for (let x = center.x - radius - 1; x <= center.x + radius + 1; x++) {
        if (!grid.inBounds(x, y)) continue;
        const distance = Math.hypot(x - center.x, y - center.y);
        const edgeNoise = (seededValue(seed + 211, x, y) - 0.5) * 0.8;
        if (distance <= radius + edgeNoise) {
          const terrain = distance < radius * 0.55 ? TerrainType.Land : TerrainType.Rock;
          this.setTerrain(grid, x, y, terrain);
          grid.setIslandId(x, y, 1);
          grid.setKnowledge(x, y, KnowledgeState.Unknown, 0);
        } else if (distance <= radius + 1) {
          this.setTerrain(grid, x, y, TerrainType.ShallowOcean);
          grid.setKnowledge(x, y, KnowledgeState.Unknown, 0);
        }
      }
    }
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
    grid.setMovementBlocked(x, y, terrainBlocksMovement(terrain));
    grid.setSightBlocked(x, y, terrainBlocksSight(terrain));
  }
}
