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
  createManifestFromPlannedWorldV2,
  type WorldManifestV2,
} from "./manifest";
import { WorldGrid } from "./WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY } from "./WorldTopology";
import {
  GeneratedWaterLayout,
  WaterLayoutPlanner,
  createManifestWaterLayout,
} from "./water";
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

export const WORLD_GENERATOR_VERSION = "wayfinders-world-v5";

export interface PlannedWorld {
  seed: number;
  landmarks: WorldLandmarks;
  islands: readonly GeneratedIsland[];
  manifest: WorldManifestV2;
}

export interface RasterizedWorld extends PlannedWorld {
  grid: WorldGrid;
}

export interface GeneratedWorld extends RasterizedWorld {
  analysis: WorldAnalysisIndex;
  water: GeneratedWaterLayout;
}

export interface ResolvedWorldPlanIdentity {
  readonly settingsProfileId: string;
  readonly settingsFingerprint?: string;
  readonly authoredIslandCatalogRevision: string;
}

export interface WorldAnalysisIdentity {
  readonly sourceId: string;
  readonly sourceRevision?: string | number;
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
    const analysis = this.analyze(rasterized);
    const water = this.planWater(rasterized, analysis);
    return { ...rasterized, analysis, water };
  }

  /** Produces stable world facts without allocating or painting logical chunks. */
  plan(seed = this.config.world.seed): PlannedWorld {
    const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : this.config.world.seed;
    const planningGrid = new WorldGrid(
      this.config.world.width,
      this.config.world.height,
      this.config.navigation.chunkSize,
      WRAPPING_WORLD_TOPOLOGY,
      this.config.navigation.tileSize,
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
    return this.createPlannedWorld(planningGrid, normalizedSeed, home, islands, {
      settingsProfileId: worldGenerationProfileIdForConfig(this.config, WRAPPING_WORLD_TOPOLOGY),
      settingsFingerprint: worldGenerationSettingsFingerprint(this.config, WRAPPING_WORLD_TOPOLOGY),
      authoredIslandCatalogRevision: this.authoredIslandCatalog.revision,
    });
  }

  /** Assembles already validated explicit island instances into the ordinary planned-world contract. */
  planResolvedIslands(
    seed: number,
    islands: readonly Readonly<GeneratedIsland>[],
    identity: Readonly<ResolvedWorldPlanIdentity>,
  ): PlannedWorld {
    const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : this.config.world.seed;
    const planningGrid = new WorldGrid(
      this.config.world.width,
      this.config.world.height,
      this.config.navigation.chunkSize,
      WRAPPING_WORLD_TOPOLOGY,
      this.config.navigation.tileSize,
    );
    const homePlacement = {
      x: Math.floor(planningGrid.width / 2),
      y: Math.floor(planningGrid.height / 2),
    };
    const home = resolveAuthoredHomeIslandPlacement(homePlacement);
    this.assertHomePlacementFits(planningGrid, home.topLeft);
    return this.createPlannedWorld(planningGrid, normalizedSeed, home, islands, identity);
  }

  private createPlannedWorld(
    planningGrid: WorldGrid,
    normalizedSeed: number,
    home: ReturnType<typeof resolveAuthoredHomeIslandPlacement>,
    islands: readonly Readonly<GeneratedIsland>[],
    identity: Readonly<ResolvedWorldPlanIdentity>,
  ): PlannedWorld {
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
    const manifest = createManifestFromPlannedWorldV2({
      seed: normalizedSeed,
      width: planningGrid.width,
      height: planningGrid.height,
      chunkSize: planningGrid.chunkSize,
      topology: WRAPPING_WORLD_TOPOLOGY,
      landmarks,
      islands,
    }, {
      generatorVersion: WORLD_GENERATOR_VERSION,
      settingsProfileId: identity.settingsProfileId,
      ...(identity.settingsFingerprint === undefined
        ? {}
        : { settingsFingerprint: identity.settingsFingerprint }),
      authoredIslandCatalogRevision: identity.authoredIslandCatalogRevision,
      waterLayout: createManifestWaterLayout(normalizedSeed, planningGrid.width, planningGrid.height),
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
      WRAPPING_WORLD_TOPOLOGY,
      this.config.navigation.tileSize,
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
  analyze(
    world: Readonly<RasterizedWorld>,
    identity?: Readonly<WorldAnalysisIdentity>,
  ): WorldAnalysisIndex {
    const graph = new GridGraph(world.grid, this.config);
    return WorldAnalysisIndex.build(world.grid, {
      sourceId: identity?.sourceId
        ?? world.manifest.settingsFingerprint
        ?? world.manifest.generatorVersion,
      sourceRevision: identity?.sourceRevision ?? world.manifest.generatorVersion,
      isPassable: (index) => graph.isNavigationNodePassable(index),
    });
  }

  /** Resolves presentation water types without changing authoritative terrain. */
  planWater(
    world: Readonly<RasterizedWorld>,
    analysis: Readonly<WorldAnalysisIndex>,
  ): GeneratedWaterLayout {
    return new WaterLayoutPlanner().plan(
      world.grid,
      analysis,
      world.islands,
      world.manifest,
      world.seed,
    );
  }

  private paintSupportedWater(grid: WorldGrid, seed: number, center: GridPoint): void {
    const baseRadius = this.config.world.supportedWaterRadius;
    const noiseAmplitude = this.config.world.supportedBoundaryNoise;
    const noiseScale = this.config.world.supportedNoiseScale;
    const maximumRadius = baseRadius + noiseAmplitude;
    const extent = Math.ceil(maximumRadius);
    const written = new Set<number>();
    for (let liftedY = center.y - extent; liftedY <= center.y + extent; liftedY++) {
      for (let liftedX = center.x - extent; liftedX <= center.x + extent; liftedX++) {
        const point = grid.topology.canonicalizeTile(liftedX, liftedY);
        if (!point) continue;
        const index = grid.index(point.x, point.y);
        if (written.has(index)) continue;
        written.add(index);
        const dx = liftedX - center.x;
        const dy = liftedY - center.y;
        const distance = Math.hypot(dx, dy);
        if (distance > maximumRadius) continue;
        const noise = valueNoise(seed, dx, dy, noiseScale) * 2 - 1;
        if (distance <= baseRadius + noise * noiseAmplitude) {
          grid.setKnowledge(point.x, point.y, KnowledgeState.Supported, 0);
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
    const canonicalCandidate = grid.topology.canonicalizeTile(candidate.x, candidate.y);
    if (canonicalCandidate) return canonicalCandidate;

    return grid.topology.normalizeTile(
      home.x - this.config.world.hiddenObstacleDistance,
      home.y,
    );
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
