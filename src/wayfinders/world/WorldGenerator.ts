import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import {
  PILOT_HOME_ISLAND_METADATA,
  resolveAuthoredHomeIslandPlacement,
  stampAuthoredHomeIsland,
} from "../assets/AuthoredHomeIsland";
import { GridGraph } from "../navigation/GridGraph";
import { IslandGenerator, type GeneratedIsland } from "./IslandGenerator";
import { seededValue } from "./SeededRandom";
import { KnowledgeState, TerrainType } from "./TileData";
import {
  worldGenerationProfileIdForConfig,
  worldGenerationSettingsFingerprint,
} from "./WorldGenerationProfiles";
import { WorldAnalysisIndex } from "./analysis";
import {
  createManifestFromPlannedWorldV1,
  type WorldManifestV1,
} from "./manifest";
import { WorldGrid } from "./WorldGrid";
import {
  EMPTY_AUTHORED_ISLAND_CATALOG,
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalog,
} from "./AuthoredIslandCatalog";

export { seededValue } from "./SeededRandom";

export interface WorldLandmarks {
  homeCenter: GridPoint;
  harbour: GridPoint;
  dock: GridPoint;
  homeReturnTile: GridPoint;
  hiddenObstacleCenter: GridPoint;
  hiddenResource: GridPoint;
}

export const WORLD_GENERATOR_VERSION = "wayfinders-world-v2";

export interface PlannedWorld {
  seed: number;
  landmarks: WorldLandmarks;
  islands: readonly GeneratedIsland[];
  manifest: WorldManifestV1;
}

export interface RasterizedWorld extends PlannedWorld {
  grid: WorldGrid;
}

export interface GeneratedWorld extends RasterizedWorld {
  analysis: WorldAnalysisIndex;
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
  private readonly authoredIslandCatalog: Readonly<AuthoredIslandCatalog>;

  constructor(
    private readonly config: PrototypeConfig = prototypeConfig,
    authoredIslandCatalog: Readonly<AuthoredIslandCatalog> = EMPTY_AUTHORED_ISLAND_CATALOG,
  ) {
    this.authoredIslandCatalog = validateAuthoredIslandCatalog(authoredIslandCatalog);
  }

  generate(seed = this.config.world.seed): GeneratedWorld {
    const planned = this.plan(seed);
    const rasterized = this.rasterize(planned);
    return { ...rasterized, analysis: this.analyze(rasterized) };
  }

  /** Produces stable world facts without allocating or painting logical chunks. */
  plan(seed = this.config.world.seed): PlannedWorld {
    const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : this.config.world.seed;
    const planningGrid = new WorldGrid(
      this.config.world.width,
      this.config.world.height,
      this.config.navigation.chunkSize,
    );
    const homePlacement = {
      x: Math.floor(planningGrid.width / 2),
      y: Math.floor(planningGrid.height / 2),
    };
    const home = resolveAuthoredHomeIslandPlacement(homePlacement);
    this.assertHomePlacementFits(planningGrid, home.topLeft);
    const islands = new IslandGenerator(this.config).plan(
      planningGrid,
      normalizedSeed,
      home.landmarks.homeCenter,
      home.landmarks.dock,
      this.authoredIslandCatalog,
    );
    const hiddenObstacle = islands[0];
    if (!hiddenObstacle) throw new RangeError("World generation requires at least one scattered island");
    const landmarks: WorldLandmarks = {
      ...home.landmarks,
      hiddenObstacleCenter: { ...hiddenObstacle.center },
      hiddenResource: this.planHiddenResource(
        planningGrid,
        normalizedSeed,
        home.landmarks.homeCenter,
        hiddenObstacle,
      ),
    };
    const manifest = createManifestFromPlannedWorldV1({
      seed: normalizedSeed,
      width: planningGrid.width,
      height: planningGrid.height,
      chunkSize: planningGrid.chunkSize,
      landmarks,
      islands,
    }, {
      generatorVersion: WORLD_GENERATOR_VERSION,
      settingsProfileId: worldGenerationProfileIdForConfig(this.config),
      settingsFingerprint: worldGenerationSettingsFingerprint(this.config),
      authoredIslandCatalogRevision: this.authoredIslandCatalog.revision,
    });
    return Object.freeze({
      seed: normalizedSeed,
      landmarks: Object.freeze(landmarks),
      islands: Object.freeze(islands),
      manifest,
    });
  }

  /** Paints authoritative tile state from a previously planned manifest layout. */
  rasterize(planned: Readonly<PlannedWorld>): RasterizedWorld {
    const grid = new WorldGrid(
      this.config.world.width,
      this.config.world.height,
      this.config.navigation.chunkSize,
    );
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);

    const homePlacement = {
      x: Math.floor(grid.width / 2),
      y: Math.floor(grid.height / 2),
    };

    this.paintSupportedWater(grid, planned.seed, homePlacement);
    const home = stampAuthoredHomeIsland(grid, homePlacement, undefined, this.config);
    this.assertLandmarksMatch(planned.landmarks, home.landmarks);
    new IslandGenerator(this.config).rasterize(grid, planned.seed, planned.islands, home.landmarks.dock);
    const graph = new GridGraph(grid, this.config);
    const hiddenResourceIndex = grid.index(
      planned.landmarks.hiddenResource.x,
      planned.landmarks.hiddenResource.y,
    );
    if (!graph.isNavigationNodePassable(hiddenResourceIndex)) {
      throw new RangeError("Planned hidden resource is not navigation-passable after rasterization");
    }
    grid.setResourceId(planned.landmarks.hiddenResource.x, planned.landmarks.hiddenResource.y, 1);

    return {
      ...planned,
      grid,
    };
  }

  /** Builds the one reusable topology/coastline index for all feature seeding. */
  analyze(world: Readonly<RasterizedWorld>): WorldAnalysisIndex {
    const graph = new GridGraph(world.grid, this.config);
    return WorldAnalysisIndex.build(world.grid, {
      sourceId: world.manifest.settingsFingerprint ?? world.manifest.generatorVersion,
      sourceRevision: world.manifest.generatorVersion,
      isPassable: (index) => graph.isNavigationNodePassable(index),
    });
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

  private planHiddenResource(
    grid: WorldGrid,
    seed: number,
    home: GridPoint,
    obstacle: Readonly<GeneratedIsland>,
  ): GridPoint {
    const offsetSign = seededValue(seed + 307, 0, 0) < 0.5 ? -1 : 1;
    const candidate = {
      x: obstacle.center.x + offsetSign * (Math.ceil(obstacle.outerRadius) + 3),
      y: obstacle.center.y + offsetSign * 2,
    };
    if (grid.inBounds(candidate.x, candidate.y)) return candidate;

    return {
      x: Math.max(0, Math.min(grid.width - 1, home.x - this.config.world.hiddenObstacleDistance)),
      y: home.y,
    };
  }

  private assertHomePlacementFits(grid: WorldGrid, topLeft: Readonly<GridPoint>): void {
    if (
      topLeft.x < 0
      || topLeft.y < 0
      || topLeft.x + PILOT_HOME_ISLAND_METADATA.grid.width > grid.width
      || topLeft.y + PILOT_HOME_ISLAND_METADATA.grid.height > grid.height
    ) {
      throw new RangeError("Authored home island does not fit inside the planned world");
    }
  }

  private assertLandmarksMatch(
    planned: Readonly<WorldLandmarks>,
    rasterized: Pick<WorldLandmarks, "homeCenter" | "harbour" | "dock" | "homeReturnTile">,
  ): void {
    for (const key of ["homeCenter", "harbour", "dock", "homeReturnTile"] as const) {
      if (planned[key].x !== rasterized[key].x || planned[key].y !== rasterized[key].y) {
        throw new RangeError(`Planned ${key} changed during logical rasterization`);
      }
    }
  }

}
