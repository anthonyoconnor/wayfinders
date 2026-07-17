import Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredHomeIslandMetadata,
} from "../assets/AuthoredAssetContracts";
import { createAuthoredHomeIslandVisual, type AuthoredHomeIslandVisual } from "../assets/AuthoredAssetPresentation";
import type { AuthoredAssetRuntime } from "../assets/PilotAssetRuntime";
import type {
  AuthoredIslandPresentationEntry,
  AuthoredIslandPresentationRuntime,
} from "../assets/AuthoredIslandPresentation";
import { prototypeConfig } from "../config/prototypeConfig";
import { gridToWorld } from "../world/CoordinateSystem";
import { IslandKind, type GeneratedIsland } from "../world/IslandGenerator";
import { seededValue } from "../world/SeededRandom";
import { KnowledgeState, TerrainType } from "../world/TileData";
import type { GeneratedWorld } from "../world/WorldGenerator";
import type { WorldChunk } from "../world/WorldChunk";
import { activeChunkKey } from "./activation/ActiveChunkSet";
import type {
  ActiveChunkDelta,
  ActiveChunkEntry,
} from "./activation/ActiveChunkContracts";

const COLORS = {
  ocean: 0x082f40,
  supported: 0x12536a,
  shallow: 0x2d858b,
  shallowSupported: 0x3b9696,
  wave: 0x8bd0cf,
  sand: 0xd2bb7f,
  land: 0x779459,
  landDark: 0x49683e,
  reef: 0x91b59b,
  rock: 0x626e6e,
  timber: 0x6f442a,
  timberLight: 0xb17c45,
  roof: 0x9b4f32,
  sailcloth: 0xf0d79b,
} as const;

interface IslandPalette {
  shallow: number;
  shallowSupported: number;
  land: number;
  landDark: number;
  rock: number;
  reef: number;
  coast: number;
}

const ISLAND_PALETTES: Record<IslandKind, IslandPalette> = {
  [IslandKind.HighIsland]: {
    shallow: 0x2d858b,
    shallowSupported: 0x3b9696,
    land: 0x779459,
    landDark: 0x49683e,
    rock: 0x65706d,
    reef: 0x91b59b,
    coast: 0xd2bb7f,
  },
  [IslandKind.LowCay]: {
    shallow: 0x4aa1a0,
    shallowSupported: 0x63b8b0,
    land: 0xd4bd78,
    landDark: 0xb89a5c,
    rock: 0x837a68,
    reef: 0xb6c68d,
    coast: 0xf0d691,
  },
  [IslandKind.Atoll]: {
    shallow: 0x3ca9a5,
    shallowSupported: 0x57c0b5,
    land: 0xe0c77f,
    landDark: 0xc6a867,
    rock: 0x7a8580,
    reef: 0x79c8a4,
    coast: 0xf3dda0,
  },
  [IslandKind.RockySkerry]: {
    shallow: 0x346f7a,
    shallowSupported: 0x4b8790,
    land: 0x68745d,
    landDark: 0x4b5549,
    rock: 0x515d60,
    reef: 0x76988d,
    coast: 0xa99b7d,
  },
};

type ChunkLayerName = "water" | "waves" | "terrain" | "coast" | "structures";

const CHUNK_LAYER_DEPTHS: Record<ChunkLayerName, number> = {
  water: 0,
  waves: 1,
  terrain: 2,
  coast: 3,
  structures: 5,
};

/** Phaser Graphics have no intrinsic bounds, so their command buffers are otherwise rendered for every camera. */
class CameraCulledGraphics extends Phaser.GameObjects.Graphics {
  constructor(
    scene: Phaser.Scene,
    private readonly worldBounds: Phaser.Geom.Rectangle,
  ) {
    super(scene);
    scene.add.existing(this);
  }

  override willRender(camera: Phaser.Cameras.Scene2D.Camera): boolean {
    if (!super.willRender(camera)) return false;
    const view = camera.worldView;
    return this.worldBounds.right >= view.left
      && this.worldBounds.left <= view.right
      && this.worldBounds.bottom >= view.top
      && this.worldBounds.top <= view.bottom;
  }
}

interface ChunkView {
  entry: Readonly<ActiveChunkEntry>;
  chunkX: number;
  chunkY: number;
  originX: number;
  originY: number;
  bounds: Phaser.Geom.Rectangle;
  layers: Partial<Record<ChunkLayerName, CameraCulledGraphics>>;
  homeStructures?: Phaser.GameObjects.Graphics;
  homeVisual?: AuthoredHomeIslandVisual;
  authoredIslandImages?: Phaser.GameObjects.Image[];
  label?: Phaser.GameObjects.Text;
}

interface AuthoredIslandPresentationRecord {
  readonly island: Readonly<GeneratedIsland>;
  readonly presentation: Readonly<AuthoredIslandPresentationEntry>;
}

/** Bounded counters suitable for the runtime performance HUD and regression tests. */
export interface WorldRendererTelemetry {
  readonly updateCount: number;
  readonly activeChunks: number;
  readonly activeChunkKeys: readonly string[];
  readonly activeGraphicsObjects: number;
  readonly activeTextObjects: number;
  readonly activeAuthoredImageObjects: number;
  /** Per-chunk Phaser objects, excluding the constant ocean backdrop. */
  readonly activeResourceObjects: number;
  readonly sharedObjects: number;
  readonly totalObjects: number;
  readonly totalChunkActivations: number;
  readonly totalChunkDeactivations: number;
  readonly totalResourceObjectsCreated: number;
  readonly totalResourceObjectsDestroyed: number;
  readonly peakActiveChunks: number;
  readonly peakResourceObjects: number;
  readonly tilesVisitedLastUpdate: number;
  readonly totalTilesVisited: number;
}

export interface WorldRendererActivationResult {
  readonly activated: number;
  readonly deactivated: number;
  readonly retained: number;
  readonly telemetry: Readonly<WorldRendererTelemetry>;
}

/** Developer-art renderer. Gameplay terrain remains owned by WorldGrid. */
export class WorldRenderer {
  private readonly ocean: Phaser.GameObjects.Rectangle;
  private readonly authoredHomeMetadata?: Readonly<AuthoredHomeIslandMetadata>;
  private readonly chunks = new Map<string, ChunkView>();
  private generated?: GeneratedWorld;
  private islandsById: ReadonlyMap<number, GeneratedIsland> = new Map();
  private authoredIslandPresentationsByIslandId: ReadonlyMap<number, AuthoredIslandPresentationRecord> = new Map();
  private authoredIslandPresentationsByOwnerChunk: ReadonlyMap<string, readonly AuthoredIslandPresentationRecord[]> = new Map();
  private observedKnowledgeRevisions = new WeakMap<WorldChunk, number>();
  private updateCount = 0;
  private totalChunkActivations = 0;
  private totalChunkDeactivations = 0;
  private totalResourceObjectsCreated = 0;
  private totalResourceObjectsDestroyed = 0;
  private peakActiveChunks = 0;
  private peakResourceObjects = 0;
  private tilesVisitedLastUpdate = 0;
  private totalTilesVisited = 0;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly pilotAssets?: Readonly<AuthoredAssetRuntime>,
    private readonly authoredIslandPresentations?: Readonly<AuthoredIslandPresentationRuntime>,
  ) {
    this.ocean = scene.add.rectangle(0, 0, 1, 1, COLORS.ocean, 1).setOrigin(0).setDepth(0);
    this.ocean.setVisible(false);
    const homeMetadata = pilotAssets?.metadata(AUTHORED_ASSET_IDS.homeIsland);
    this.authoredHomeMetadata = homeMetadata?.kind === "home-island"
      && homeMetadata.render.slices.every(({ imageId }) => pilotAssets?.textureKey(imageId) !== undefined)
      ? homeMetadata
      : undefined;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /**
   * Binds a generated world and presents only the explicitly supplied chunks.
   * Passing no chunks intentionally creates no terrain presentation resources.
   */
  render(
    generated: GeneratedWorld,
    activeChunks: readonly Readonly<ActiveChunkEntry>[] = [],
  ): Readonly<WorldRendererActivationResult> {
    if (this.destroyed) return this.activationResult(0, 0, 0);
    this.clearWorld();
    const { grid } = generated;
    const size = prototypeConfig.navigation.tileSize;
    this.generated = generated;
    this.islandsById = new Map(generated.islands.map((island) => [island.id, island]));
    this.indexAuthoredIslandPresentations(generated);

    this.ocean
      .setSize(grid.width * size, grid.height * size)
      .setPosition(0, 0)
      .setVisible(false);
    return this.syncActiveChunks(activeChunks);
  }

  /** Applies the bounded ActiveChunkSet result without scanning non-active world tiles. */
  applyActiveChunks(delta: Readonly<ActiveChunkDelta>): Readonly<WorldRendererActivationResult> {
    return this.syncActiveChunks(delta.active);
  }

  /**
   * Reconciles presentation resources to an explicit active set. Missing chunks
   * are destroyed before new chunks are built in load-priority order.
   */
  syncActiveChunks(
    entries: readonly Readonly<ActiveChunkEntry>[],
  ): Readonly<WorldRendererActivationResult> {
    if (this.destroyed || !this.generated) return this.activationResult(0, 0, 0);
    this.updateCount++;
    this.tilesVisitedLastUpdate = 0;

    const desired = new Map<string, Readonly<ActiveChunkEntry>>();
    for (const entry of entries) {
      this.assertValidChunkEntry(entry);
      if (desired.has(entry.key)) throw new RangeError(`Duplicate active chunk ${entry.key}`);
      desired.set(entry.key, entry);
    }

    let deactivated = 0;
    for (const key of [...this.chunks.keys()]) {
      if (desired.has(key)) continue;
      this.deactivateChunk(key);
      deactivated++;
    }

    let activated = 0;
    let retained = 0;
    const ordered = [...desired.values()].sort(compareActiveChunkEntry);
    for (const entry of ordered) {
      const existing = this.chunks.get(entry.key);
      if (existing) {
        existing.entry = entry;
        retained++;
        continue;
      }
      this.activateChunk(entry);
      activated++;
    }

    this.totalChunkActivations += activated;
    this.totalChunkDeactivations += deactivated;
    this.peakActiveChunks = Math.max(this.peakActiveChunks, this.chunks.size);
    const activeResources = this.countActiveResources();
    this.peakResourceObjects = Math.max(this.peakResourceObjects, activeResources);
    this.ocean.setVisible(this.chunks.size > 0);
    return this.activationResult(activated, deactivated, retained);
  }

  /** Repaints only water layers whose authoritative knowledge changed since the last world render. */
  refreshKnowledge(generated: GeneratedWorld): number {
    if (this.destroyed) return 0;
    if (this.generated?.grid !== generated.grid) {
      this.render(generated);
      return 0;
    }

    this.generated = generated;
    let refreshed = 0;
    for (const view of this.chunks.values()) {
      const worldChunk = generated.grid.getChunk(view.chunkX, view.chunkY);
      if (!worldChunk) continue;
      if (this.observedKnowledgeRevisions.get(worldChunk) === worldChunk.knowledgeRevision) continue;
      const resourcesBefore = this.chunkResourceCount(view);
      this.redrawWaterLayer(generated, view, this.islandsById);
      const resourcesCreated = this.chunkResourceCount(view) - resourcesBefore;
      this.totalResourceObjectsCreated += resourcesCreated;
      this.observedKnowledgeRevisions.set(worldChunk, worldChunk.knowledgeRevision);
      refreshed++;
    }
    this.peakResourceObjects = Math.max(this.peakResourceObjects, this.countActiveResources());
    return refreshed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.clearWorld();
    this.ocean.destroy();
  }

  getTelemetry(): Readonly<WorldRendererTelemetry> {
    const counts = this.objectCounts();
    const activeChunkKeys = [...this.chunks.values()]
      .sort((left, right) => compareActiveChunkEntry(left.entry, right.entry))
      .map(({ entry }) => entry.key);
    return Object.freeze({
      updateCount: this.updateCount,
      activeChunks: this.chunks.size,
      activeChunkKeys: Object.freeze(activeChunkKeys),
      activeGraphicsObjects: counts.graphics,
      activeTextObjects: counts.text,
      activeAuthoredImageObjects: counts.authoredImages,
      activeResourceObjects: counts.resources,
      sharedObjects: this.destroyed ? 0 : 1,
      totalObjects: counts.resources + (this.destroyed ? 0 : 1),
      totalChunkActivations: this.totalChunkActivations,
      totalChunkDeactivations: this.totalChunkDeactivations,
      totalResourceObjectsCreated: this.totalResourceObjectsCreated,
      totalResourceObjectsDestroyed: this.totalResourceObjectsDestroyed,
      peakActiveChunks: this.peakActiveChunks,
      peakResourceObjects: this.peakResourceObjects,
      tilesVisitedLastUpdate: this.tilesVisitedLastUpdate,
      totalTilesVisited: this.totalTilesVisited,
    });
  }

  private activateChunk(entry: Readonly<ActiveChunkEntry>): void {
    const generated = this.generated;
    if (!generated) throw new Error("A world must be bound before chunks can be activated");
    const chunk = this.createChunkView(generated, entry);
    this.chunks.set(entry.key, chunk);
    this.renderChunk(generated, chunk);
    if (this.isHomeOwnerChunk(generated, chunk)) this.drawHome(generated, chunk);
    this.drawAuthoredIslands(chunk);
    const worldChunk = generated.grid.getChunk(chunk.chunkX, chunk.chunkY);
    if (worldChunk) this.observedKnowledgeRevisions.set(worldChunk, worldChunk.knowledgeRevision);
    const created = this.chunkResourceCount(chunk);
    this.totalResourceObjectsCreated += created;
  }

  private deactivateChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    const destroyed = this.chunkResourceCount(chunk);
    for (const layer of Object.values(chunk.layers)) layer?.destroy();
    chunk.homeStructures?.destroy();
    chunk.homeVisual?.destroy();
    for (const image of chunk.authoredIslandImages ?? []) image.destroy();
    chunk.label?.destroy();
    const worldChunk = this.generated?.grid.getChunk(chunk.chunkX, chunk.chunkY);
    if (worldChunk) this.observedKnowledgeRevisions.delete(worldChunk);
    this.chunks.delete(key);
    this.totalResourceObjectsDestroyed += destroyed;
  }

  private createChunkView(
    generated: GeneratedWorld,
    entry: Readonly<ActiveChunkEntry>,
  ): ChunkView {
    const { grid } = generated;
    const tileSize = prototypeConfig.navigation.tileSize;
    const padding = Math.max(2, tileSize * 0.12);
    const chunkX = entry.coordinate.x;
    const chunkY = entry.coordinate.y;
    const startX = chunkX * grid.chunkSize;
    const startY = chunkY * grid.chunkSize;
    const originX = startX * tileSize;
    const originY = startY * tileSize;
    const width = Math.min(grid.chunkSize, grid.width - startX) * tileSize;
    const height = Math.min(grid.chunkSize, grid.height - startY) * tileSize;
    return {
      entry,
      chunkX,
      chunkY,
      originX,
      originY,
      bounds: new Phaser.Geom.Rectangle(
        originX - padding,
        originY - padding,
        width + padding * 2,
        height + padding * 2,
      ),
      layers: {},
    };
  }

  private getLayer(chunk: ChunkView, name: ChunkLayerName): CameraCulledGraphics {
    let layer = chunk.layers[name];
    if (layer) return layer;
    layer = new CameraCulledGraphics(this.scene, chunk.bounds)
      .setPosition(chunk.originX, chunk.originY)
      .setDepth(CHUNK_LAYER_DEPTHS[name]);
    chunk.layers[name] = layer;
    return layer;
  }

  private renderChunk(generated: GeneratedWorld, chunk: ChunkView): void {
    const { grid, seed } = generated;
    const size = prototypeConfig.navigation.tileSize;
    const startX = chunk.chunkX * grid.chunkSize;
    const startY = chunk.chunkY * grid.chunkSize;
    const endX = Math.min(grid.width, startX + grid.chunkSize);
    const endY = Math.min(grid.height, startY + grid.chunkSize);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        this.tilesVisitedLastUpdate++;
        this.totalTilesVisited++;
        const tile = grid.getTile(x, y);
        const px = (x - startX) * size;
        const py = (y - startY) * size;
        const supported = tile.knowledge === KnowledgeState.Supported;
        if (this.isAuthoredHomeFootprint(generated, x, y)) {
          if (supported) {
            const water = this.getLayer(chunk, "water");
            water.fillStyle(COLORS.supported, 1);
            water.fillRect(px, py, size + 1, size + 1);
          }
          continue;
        }

        const island = this.islandsById.get(tile.islandId);
        const hasAuthoredPresentation = island !== undefined
          && this.authoredIslandPresentationsByIslandId.has(island.id);
        const palette = island ? ISLAND_PALETTES[island.kind] : ISLAND_PALETTES[IslandKind.HighIsland];
        let waterColor: number = supported ? COLORS.supported : COLORS.ocean;
        if (hasAuthoredPresentation || tile.terrain === TerrainType.ShallowOcean) {
          waterColor = supported ? palette.shallowSupported : palette.shallow;
        }
        if (waterColor !== COLORS.ocean) {
          const water = this.getLayer(chunk, "water");
          water.fillStyle(waterColor, 1);
          water.fillRect(px, py, size + 1, size + 1);
        }

        if (!hasAuthoredPresentation && tile.terrain === TerrainType.Land) {
          const terrain = this.getLayer(chunk, "terrain");
          const variation = seededValue(seed + 401, x, y) > 0.5 ? palette.land : palette.landDark;
          terrain.fillStyle(variation, 1);
          terrain.fillRoundedRect(px + 1, py + 1, size - 2, size - 2, size * 0.18);
        } else if (!hasAuthoredPresentation && tile.terrain === TerrainType.Rock) {
          const terrain = this.getLayer(chunk, "terrain");
          terrain.fillStyle(palette.rock, 1);
          terrain.fillTriangle(
            px + size * 0.12,
            py + size * 0.84,
            px + size * 0.52,
            py + size * 0.12,
            px + size * 0.9,
            py + size * 0.84,
          );
        } else if (!hasAuthoredPresentation && tile.terrain === TerrainType.Reef) {
          const terrain = this.getLayer(chunk, "terrain");
          terrain.fillStyle(palette.reef, 0.9);
          terrain.fillCircle(px + size * 0.32, py + size * 0.54, size * 0.15);
          terrain.fillCircle(px + size * 0.63, py + size * 0.42, size * 0.12);
        }

        if (!hasAuthoredPresentation && tile.terrain === TerrainType.Land) {
          this.drawCoastTile(generated, chunk, island ? palette.coast : COLORS.sand, x, y, px, py, size);
        }
        if (island && !hasAuthoredPresentation) {
          this.drawIslandDecoration(chunk, island, tile.terrain, x, y, px, py, size, seed);
        }

        if ((x + y) % 2 === 0 && tile.terrain !== TerrainType.Land) {
          const waves = this.getLayer(chunk, "waves");
          const waveOffset = seededValue(seed + 503, x, y) * size * 0.24;
          waves.lineStyle(1, COLORS.wave, supported ? 0.2 : 0.12);
          waves.beginPath();
          waves.moveTo(px + size * 0.2 + waveOffset, py + size * 0.52);
          waves.lineTo(px + size * 0.45 + waveOffset, py + size * 0.46);
          waves.lineTo(px + size * 0.7 + waveOffset, py + size * 0.52);
          waves.strokePath();
        }
      }
    }
  }

  private redrawWaterLayer(
    generated: GeneratedWorld,
    chunk: ChunkView,
    islandsById: ReadonlyMap<number, GeneratedIsland>,
  ): void {
    chunk.layers.water?.clear();
    chunk.layers.waves?.clear();
    const { grid } = generated;
    const size = prototypeConfig.navigation.tileSize;
    const startX = chunk.chunkX * grid.chunkSize;
    const startY = chunk.chunkY * grid.chunkSize;
    const endX = Math.min(grid.width, startX + grid.chunkSize);
    const endY = Math.min(grid.height, startY + grid.chunkSize);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        this.totalTilesVisited++;
        const tile = grid.getTile(x, y);
        const supported = tile.knowledge === KnowledgeState.Supported;
        if (this.isAuthoredHomeFootprint(generated, x, y)) {
          if (supported) {
            const water = this.getLayer(chunk, "water");
            water.fillStyle(COLORS.supported, 1);
            water.fillRect((x - startX) * size, (y - startY) * size, size + 1, size + 1);
          }
          continue;
        }
        const island = islandsById.get(tile.islandId);
        const hasAuthoredPresentation = island !== undefined
          && this.authoredIslandPresentationsByIslandId.has(island.id);
        const palette = island ? ISLAND_PALETTES[island.kind] : ISLAND_PALETTES[IslandKind.HighIsland];
        let waterColor: number = supported ? COLORS.supported : COLORS.ocean;
        if (hasAuthoredPresentation || tile.terrain === TerrainType.ShallowOcean) {
          waterColor = supported ? palette.shallowSupported : palette.shallow;
        }
        const px = (x - startX) * size;
        const py = (y - startY) * size;
        if (waterColor !== COLORS.ocean) {
          const water = this.getLayer(chunk, "water");
          water.fillStyle(waterColor, 1);
          water.fillRect(px, py, size + 1, size + 1);
        }
        if ((x + y) % 2 === 0 && tile.terrain !== TerrainType.Land) {
          const waves = this.getLayer(chunk, "waves");
          const waveOffset = seededValue(generated.seed + 503, x, y) * size * 0.24;
          waves.lineStyle(1, COLORS.wave, supported ? 0.2 : 0.12);
          waves.beginPath();
          waves.moveTo(px + size * 0.2 + waveOffset, py + size * 0.52);
          waves.lineTo(px + size * 0.45 + waveOffset, py + size * 0.46);
          waves.lineTo(px + size * 0.7 + waveOffset, py + size * 0.52);
          waves.strokePath();
        }
      }
    }
  }

  private drawCoastTile(
    generated: GeneratedWorld,
    chunk: ChunkView,
    coastColor: number,
    x: number,
    y: number,
    px: number,
    py: number,
    size: number,
  ): void {
    const { grid } = generated;
    const top = y === 0 || grid.getTerrain(x, y - 1) !== TerrainType.Land;
    const right = x + 1 >= grid.width || grid.getTerrain(x + 1, y) !== TerrainType.Land;
    const bottom = y + 1 >= grid.height || grid.getTerrain(x, y + 1) !== TerrainType.Land;
    const left = x === 0 || grid.getTerrain(x - 1, y) !== TerrainType.Land;
    if (!top && !right && !bottom && !left) return;

    const coast = this.getLayer(chunk, "coast");
    coast.lineStyle(Math.max(2, size * 0.1), coastColor, 0.95);
    if (top) coast.lineBetween(px, py, px + size, py);
    if (right) coast.lineBetween(px + size, py, px + size, py + size);
    if (bottom) coast.lineBetween(px, py + size, px + size, py + size);
    if (left) coast.lineBetween(px, py, px, py + size);
  }

  private drawIslandDecoration(
    chunk: ChunkView,
    island: GeneratedIsland,
    terrain: TerrainType,
    x: number,
    y: number,
    px: number,
    py: number,
    size: number,
    seed: number,
  ): void {
    const detail = seededValue(seed + 907 + island.id * 53, x, y);
    if (island.kind === IslandKind.HighIsland && terrain === TerrainType.Land && detail > 0.68) {
      const structures = this.getLayer(chunk, "structures");
      structures.fillStyle(0x315b3a, 0.85);
      structures.fillTriangle(
        px + size * 0.28,
        py + size * 0.7,
        px + size * 0.5,
        py + size * 0.25,
        px + size * 0.72,
        py + size * 0.7,
      );
    } else if (island.kind === IslandKind.LowCay && terrain === TerrainType.Land && detail > 0.72) {
      const structures = this.getLayer(chunk, "structures");
      structures.lineStyle(2, 0xf1dda0, 0.75);
      structures.lineBetween(px + size * 0.25, py + size * 0.58, px + size * 0.75, py + size * 0.46);
    } else if (island.kind === IslandKind.Atoll && terrain === TerrainType.Reef && detail > 0.72) {
      const structures = this.getLayer(chunk, "structures");
      structures.fillStyle(0xe4a37b, 0.78);
      structures.fillCircle(px + size * 0.5, py + size * 0.5, size * 0.06);
    } else if (island.kind === IslandKind.RockySkerry && terrain === TerrainType.Rock && detail > 0.58) {
      const structures = this.getLayer(chunk, "structures");
      structures.lineStyle(1.5, 0x9aa3a0, 0.55);
      structures.lineBetween(px + size * 0.38, py + size * 0.38, px + size * 0.58, py + size * 0.68);
    }
  }

  private drawHome(generated: GeneratedWorld, chunk: ChunkView): void {
    const { homeCenter, harbour, dock } = generated.landmarks;
    const size = prototypeConfig.navigation.tileSize;
    if (this.pilotAssets && this.authoredHomeMetadata) {
      const visual = createAuthoredHomeIslandVisual(this.scene, this.pilotAssets);
      if (visual) {
        const topLeftX = homeCenter.x - visual.metadata.anchors.homeCenter.x;
        const topLeftY = homeCenter.y - visual.metadata.anchors.homeCenter.y;
        visual.setPosition(topLeftX * size, topLeftY * size);
        visual.setVisible(true);
        chunk.homeVisual = visual;
      }
    }

    if (!chunk.homeVisual) {
      const homeStructures = this.scene.add.graphics().setDepth(5.5);
      chunk.homeStructures = homeStructures;
      const center = gridToWorld(homeCenter);
      const harbourWorld = gridToWorld(harbour);
      const dockWorld = gridToWorld(dock);

      // A flag and simple huts make the home readable without production art.
      homeStructures.lineStyle(3, COLORS.timber, 1);
      homeStructures.lineBetween(center.x, center.y - size * 1.45, center.x, center.y - size * 0.2);
      homeStructures.fillStyle(COLORS.sailcloth, 1);
      homeStructures.fillTriangle(center.x, center.y - size * 1.4, center.x + size * 0.55, center.y - size * 1.15, center.x, center.y - size * 0.95);

      const huts = [
        { x: center.x - size * 1.7, y: center.y - size * 0.6 },
        { x: center.x + size * 0.6, y: center.y + size * 1.4 },
        { x: center.x - size * 0.8, y: center.y + size * 1.7 },
      ];
      for (const hut of huts) {
        homeStructures.fillStyle(COLORS.timberLight, 1);
        homeStructures.fillRect(hut.x - size * 0.28, hut.y - size * 0.05, size * 0.56, size * 0.42);
        homeStructures.fillStyle(COLORS.roof, 1);
        homeStructures.fillTriangle(hut.x - size * 0.4, hut.y, hut.x, hut.y - size * 0.42, hut.x + size * 0.4, hut.y);
      }

      // East-facing harbour and a short dock aligned to the generated return tile.
      homeStructures.lineStyle(size * 0.18, COLORS.timber, 1);
      homeStructures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y, dockWorld.x + size * 0.35, dockWorld.y);
      homeStructures.lineStyle(size * 0.08, COLORS.timberLight, 1);
      homeStructures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y - size * 0.12, dockWorld.x + size * 0.35, dockWorld.y - size * 0.12);
      homeStructures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y + size * 0.12, dockWorld.x + size * 0.35, dockWorld.y + size * 0.12);
      for (let x = harbourWorld.x - size * 0.5; x <= dockWorld.x + size * 0.25; x += size * 0.38) {
        homeStructures.lineStyle(2, COLORS.timberLight, 1);
        homeStructures.lineBetween(x, harbourWorld.y - size * 0.23, x, harbourWorld.y + size * 0.23);
      }
    }

    const labelAt = gridToWorld({
      x: homeCenter.x,
      y: homeCenter.y - prototypeConfig.world.homeIslandRadius - 2,
    });
    chunk.label = this.scene.add.text(labelAt.x, labelAt.y, "HOME ISLAND", {
      color: "#f5e4b3",
      fontFamily: "ui-monospace, monospace",
      fontSize: "14px",
      fontStyle: "bold",
      stroke: "#10242a",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);
  }

  private indexAuthoredIslandPresentations(generated: Readonly<GeneratedWorld>): void {
    const byIslandId = new Map<number, AuthoredIslandPresentationRecord>();
    const byOwnerChunk = new Map<string, AuthoredIslandPresentationRecord[]>();
    if (
      this.authoredIslandPresentations
      && generated.manifest.authoredIslandCatalogRevision !== this.authoredIslandPresentations.revision
    ) {
      this.authoredIslandPresentationsByIslandId = byIslandId;
      this.authoredIslandPresentationsByOwnerChunk = byOwnerChunk;
      return;
    }
    for (const island of generated.islands) {
      if (island.sourceKind !== "authored" || !island.authoredAssetId || !island.authoredCollision) continue;
      const presentation = this.authoredIslandPresentations?.entry(island.authoredAssetId);
      if (!presentation) continue;
      if (
        presentation.gridWidth !== island.authoredCollision.gridWidth
        || presentation.gridHeight !== island.authoredCollision.gridHeight
      ) {
        throw new RangeError(`Authored island ${island.authoredAssetId} presentation does not match its collision bounds`);
      }
      const record = Object.freeze({ island, presentation });
      byIslandId.set(island.id, record);
      const key = activeChunkKey(
        Math.floor(island.center.x / generated.grid.chunkSize),
        Math.floor(island.center.y / generated.grid.chunkSize),
      );
      const records = byOwnerChunk.get(key) ?? [];
      records.push(record);
      byOwnerChunk.set(key, records);
    }
    this.authoredIslandPresentationsByIslandId = byIslandId;
    this.authoredIslandPresentationsByOwnerChunk = byOwnerChunk;
  }

  private drawAuthoredIslands(chunk: ChunkView): void {
    const records = this.authoredIslandPresentationsByOwnerChunk.get(chunk.entry.key);
    if (!records || records.length === 0) return;
    const size = prototypeConfig.navigation.tileSize;
    const images: Phaser.GameObjects.Image[] = [];
    for (const { island, presentation } of records) {
      for (const [index, layer] of presentation.layers.entries()) {
        const image = this.scene.add.image(
          island.bounds.minX * size,
          island.bounds.minY * size,
          layer.textureKey,
        )
          .setOrigin(0)
          .setDisplaySize(presentation.gridWidth * size, presentation.gridHeight * size)
          .setAlpha(layer.opacity)
          .setBlendMode(authoredIslandBlendMode(layer.blendMode))
          .setDepth(4 + index * 0.01);
        images.push(image);
      }
    }
    chunk.authoredIslandImages = images;
  }

  private isAuthoredHomeFootprint(generated: GeneratedWorld, x: number, y: number): boolean {
    const metadata = this.authoredHomeMetadata;
    if (!metadata) return false;
    const topLeftX = generated.landmarks.homeCenter.x - metadata.anchors.homeCenter.x;
    const topLeftY = generated.landmarks.homeCenter.y - metadata.anchors.homeCenter.y;
    return x >= topLeftX
      && y >= topLeftY
      && x < topLeftX + metadata.grid.width
      && y < topLeftY + metadata.grid.height;
  }

  private isHomeOwnerChunk(generated: GeneratedWorld, chunk: ChunkView): boolean {
    const { grid, landmarks } = generated;
    return chunk.chunkX === Math.floor(landmarks.homeCenter.x / grid.chunkSize)
      && chunk.chunkY === Math.floor(landmarks.homeCenter.y / grid.chunkSize);
  }

  private assertValidChunkEntry(entry: Readonly<ActiveChunkEntry>): void {
    const generated = this.generated;
    if (!generated) throw new Error("A world must be bound before chunks can be validated");
    const { x, y } = entry.coordinate;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new RangeError(`Active chunk coordinates must be safe integers: ${entry.key}`);
    }
    if (entry.key !== activeChunkKey(x, y)) {
      throw new RangeError(`Active chunk key ${entry.key} does not match coordinate ${x},${y}`);
    }
    const columns = Math.ceil(generated.grid.width / generated.grid.chunkSize);
    const rows = Math.ceil(generated.grid.height / generated.grid.chunkSize);
    if (x < 0 || y < 0 || x >= columns || y >= rows) {
      throw new RangeError(`Active chunk ${entry.key} is outside ${columns}x${rows} presentation bounds`);
    }
  }

  private objectCounts(): {
    graphics: number;
    text: number;
    authoredImages: number;
    resources: number;
  } {
    let graphics = 0;
    let text = 0;
    let authoredImages = 0;
    for (const chunk of this.chunks.values()) {
      graphics += Object.values(chunk.layers).filter(Boolean).length;
      if (chunk.homeStructures) graphics++;
      if (chunk.label) text++;
      if (chunk.homeVisual) authoredImages += chunk.homeVisual.metadata.render.slices.length;
      authoredImages += chunk.authoredIslandImages?.length ?? 0;
    }
    return { graphics, text, authoredImages, resources: graphics + text + authoredImages };
  }

  private chunkResourceCount(chunk: ChunkView): number {
    return Object.values(chunk.layers).filter(Boolean).length
      + (chunk.homeStructures ? 1 : 0)
      + (chunk.label ? 1 : 0)
      + (chunk.homeVisual ? chunk.homeVisual.metadata.render.slices.length : 0)
      + (chunk.authoredIslandImages?.length ?? 0);
  }

  private countActiveResources(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) count += this.chunkResourceCount(chunk);
    return count;
  }

  private activationResult(
    activated: number,
    deactivated: number,
    retained: number,
  ): Readonly<WorldRendererActivationResult> {
    return Object.freeze({
      activated,
      deactivated,
      retained,
      telemetry: this.getTelemetry(),
    });
  }

  private clearWorld(): void {
    this.ocean.setVisible(false);
    const activeCount = this.chunks.size;
    for (const key of [...this.chunks.keys()]) this.deactivateChunk(key);
    this.totalChunkDeactivations += activeCount;
    this.generated = undefined;
    this.islandsById = new Map();
    this.authoredIslandPresentationsByIslandId = new Map();
    this.authoredIslandPresentationsByOwnerChunk = new Map();
    this.observedKnowledgeRevisions = new WeakMap();
  }
}

function authoredIslandBlendMode(mode: "normal" | "multiply" | "screen" | "add"): number {
  switch (mode) {
    case "multiply": return Phaser.BlendModes.MULTIPLY;
    case "screen": return Phaser.BlendModes.SCREEN;
    case "add": return Phaser.BlendModes.ADD;
    default: return Phaser.BlendModes.NORMAL;
  }
}

function compareActiveChunkEntry(
  left: Readonly<ActiveChunkEntry>,
  right: Readonly<ActiveChunkEntry>,
): number {
  return left.loadPriority - right.loadPriority
    || left.coordinate.y - right.coordinate.y
    || left.coordinate.x - right.coordinate.x;
}
