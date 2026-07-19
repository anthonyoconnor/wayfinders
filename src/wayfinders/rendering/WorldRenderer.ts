import Phaser from "phaser";
import {
  AUTHORED_ASSET_IDS,
  type AuthoredHomeIslandMetadata,
} from "../assets/AuthoredAssetContracts";
import { createAuthoredHomeIslandVisual, type AuthoredHomeIslandVisual } from "../assets/AuthoredAssetPresentation";
import { PILOT_HOME_ISLAND_METADATA } from "../assets/AuthoredHomeIsland";
import type { AuthoredAssetRuntime } from "../assets/PilotAssetRuntime";
import type {
  AuthoredIslandPresentationEntry,
  AuthoredIslandPresentationRuntime,
} from "../assets/AuthoredIslandPresentation";
import { hasAuthoredIslandLandPlane } from "../assets/AuthoredIslandPresentation";
import { prototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, WorldPoint } from "../core/types";
import { gridToWorld } from "../world/CoordinateSystem";
import { IslandKind, type GeneratedIsland } from "../world/IslandGenerator";
import { seededValue } from "../world/SeededRandom";
import { TerrainType } from "../world/TileData";
import type { GeneratedWorld } from "../world/WorldGenerator";
import type { CanonicalTileBounds, WorldTopology } from "../world/WorldTopology";
import { activeChunkViewKey } from "./activation/ActiveChunkSet";
import type {
  ActiveChunkDelta,
  ActiveChunkEntry,
  LiftedTileBounds,
} from "./activation/ActiveChunkContracts";

const COLORS = {
  ocean: 0x082f40,
  sand: 0xd2bb7f,
  timber: 0x6f442a,
  timberLight: 0xb17c45,
  roof: 0x9b4f32,
  sailcloth: 0xf0d79b,
} as const;

interface IslandPalette {
  land: number;
  landDark: number;
  rock: number;
  reef: number;
  coast: number;
}

const ISLAND_PALETTES: Record<IslandKind, IslandPalette> = {
  [IslandKind.HighIsland]: {
    land: 0x779459,
    landDark: 0x49683e,
    rock: 0x65706d,
    reef: 0x91b59b,
    coast: 0xd2bb7f,
  },
  [IslandKind.LowCay]: {
    land: 0xd4bd78,
    landDark: 0xb89a5c,
    rock: 0x837a68,
    reef: 0xb6c68d,
    coast: 0xf0d691,
  },
  [IslandKind.Atoll]: {
    land: 0xe0c77f,
    landDark: 0xc6a867,
    rock: 0x7a8580,
    reef: 0x79c8a4,
    coast: 0xf3dda0,
  },
  [IslandKind.RockySkerry]: {
    land: 0x68745d,
    landDark: 0x4b5549,
    rock: 0x515d60,
    reef: 0x76988d,
    coast: 0xa99b7d,
  },
};

type ChunkLayerName = "terrain" | "coast" | "structures";

const CHUNK_LAYER_DEPTHS: Record<ChunkLayerName, number> = {
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
}

interface AuthoredIslandPresentationRecord {
  readonly island: Readonly<GeneratedIsland>;
  readonly presentation: Readonly<AuthoredIslandPresentationEntry>;
}

interface HomeAliasView {
  readonly imageOffset: Readonly<WorldPoint>;
  homeStructures?: Phaser.GameObjects.Graphics;
  homeVisual?: AuthoredHomeIslandVisual;
  label?: Phaser.GameObjects.Text;
}

interface AuthoredIslandAliasView {
  readonly islandId: number;
  readonly imageOffset: Readonly<WorldPoint>;
  readonly images: readonly Phaser.GameObjects.Image[];
}

/** Bounded counters suitable for the runtime performance HUD and regression tests. */
export interface WorldRendererTelemetry {
  readonly updateCount: number;
  readonly activeImageEntries: number;
  readonly activeCanonicalChunks: number;
  readonly activeViewKeys: readonly string[];
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
  private readonly homeAliases = new Map<string, HomeAliasView>();
  private readonly authoredIslandAliases = new Map<string, AuthoredIslandAliasView>();
  private generated?: GeneratedWorld;
  private islandsById: ReadonlyMap<number, GeneratedIsland> = new Map();
  private authoredIslandPresentationsByIslandId: ReadonlyMap<number, AuthoredIslandPresentationRecord> = new Map();
  private authoredIslandPresentationsByFootprintChunk: ReadonlyMap<
    string,
    readonly Readonly<AuthoredIslandPresentationRecord>[]
  > = new Map();
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
    this.generated = generated;
    this.islandsById = new Map(generated.islands.map((island) => [island.id, island]));
    this.indexAuthoredIslandPresentations(generated);

    this.ocean.setVisible(false);
    return this.syncActiveChunks(activeChunks);
  }

  /** Applies the capacity-bounded ActiveChunkSet result without scanning inactive world tiles. */
  applyActiveChunks(delta: Readonly<ActiveChunkDelta>): Readonly<WorldRendererActivationResult> {
    const result = this.syncActiveChunks(delta.active, false);
    this.updateOceanCoverage(delta.visibleTileBounds, delta.active);
    return result;
  }

  /**
   * Reconciles presentation resources to an explicit active set. Missing chunks
   * are destroyed before new chunks are built in load-priority order.
   */
  syncActiveChunks(
    entries: readonly Readonly<ActiveChunkEntry>[],
    updateOcean = true,
  ): Readonly<WorldRendererActivationResult> {
    if (this.destroyed || !this.generated) return this.activationResult(0, 0, 0);
    this.updateCount++;
    this.tilesVisitedLastUpdate = 0;

    const desired = new Map<string, Readonly<ActiveChunkEntry>>();
    for (const entry of entries) {
      this.assertValidChunkEntry(entry);
      if (desired.has(entry.viewKey)) throw new RangeError(`Duplicate active chunk image ${entry.viewKey}`);
      desired.set(entry.viewKey, entry);
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
      const existing = this.chunks.get(entry.viewKey);
      if (existing) {
        existing.entry = entry;
        retained++;
        continue;
      }
      this.activateChunk(entry);
      activated++;
    }

    this.syncPeriodicArtwork(ordered);

    this.totalChunkActivations += activated;
    this.totalChunkDeactivations += deactivated;
    this.peakActiveChunks = Math.max(this.peakActiveChunks, this.chunks.size);
    const activeResources = this.countActiveResources();
    this.peakResourceObjects = Math.max(this.peakResourceObjects, activeResources);
    if (updateOcean) this.updateOceanCoverage(null, ordered);
    return this.activationResult(activated, deactivated, retained);
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
    const activeViewKeys = [...this.chunks.values()]
      .sort((left, right) => compareActiveChunkEntry(left.entry, right.entry))
      .map(({ entry }) => entry.viewKey);
    const canonicalChunkKeys = new Set(
      [...this.chunks.values()].map(({ entry }) => canonicalChunkKey(entry.canonicalChunk)),
    );
    return Object.freeze({
      updateCount: this.updateCount,
      activeImageEntries: this.chunks.size,
      activeCanonicalChunks: canonicalChunkKeys.size,
      activeViewKeys: Object.freeze(activeViewKeys),
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
    this.chunks.set(entry.viewKey, chunk);
    this.renderChunk(generated, chunk);
    const created = this.chunkResourceCount(chunk);
    this.totalResourceObjectsCreated += created;
  }

  private deactivateChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    const destroyed = this.chunkResourceCount(chunk);
    for (const layer of Object.values(chunk.layers)) layer?.destroy();
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
    const chunkX = entry.canonicalChunk.x;
    const chunkY = entry.canonicalChunk.y;
    const startX = chunkX * grid.chunkSize;
    const startY = chunkY * grid.chunkSize;
    const originX = startX * tileSize + entry.imageOffset.x;
    const originY = startY * tileSize + entry.imageOffset.y;
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
        if (this.isAuthoredHomeFootprint(generated, x, y)) continue;

        const island = this.islandsById.get(tile.islandId);
        const hasAuthoredPresentation = island !== undefined
          && this.authoredIslandPresentationsByIslandId.has(island.id);
        const palette = island ? ISLAND_PALETTES[island.kind] : ISLAND_PALETTES[IslandKind.HighIsland];
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
    const top = terrainAtImageNeighbor(grid, x, y - 1) !== TerrainType.Land;
    const right = terrainAtImageNeighbor(grid, x + 1, y) !== TerrainType.Land;
    const bottom = terrainAtImageNeighbor(grid, x, y + 1) !== TerrainType.Land;
    const left = terrainAtImageNeighbor(grid, x - 1, y) !== TerrainType.Land;
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

  private drawHome(generated: GeneratedWorld, imageOffset: Readonly<WorldPoint>): HomeAliasView {
    const { homeCenter, harbour, dock } = generated.landmarks;
    const size = prototypeConfig.navigation.tileSize;
    const alias: HomeAliasView = { imageOffset: Object.freeze({ ...imageOffset }) };
    if (this.pilotAssets && this.authoredHomeMetadata) {
      const visual = createAuthoredHomeIslandVisual(this.scene, this.pilotAssets);
      if (visual) {
        const topLeftX = homeCenter.x - visual.metadata.anchors.homeCenter.x;
        const topLeftY = homeCenter.y - visual.metadata.anchors.homeCenter.y;
        visual.setPosition(topLeftX * size + imageOffset.x, topLeftY * size + imageOffset.y);
        visual.setVisible(true);
        alias.homeVisual = visual;
      }
    }

    if (!alias.homeVisual) {
      const homeStructures = this.scene.add.graphics().setDepth(5.5);
      alias.homeStructures = homeStructures;
      const center = offsetWorldPoint(gridToWorld(homeCenter), imageOffset);
      const harbourWorld = offsetWorldPoint(gridToWorld(harbour), imageOffset);
      const dockWorld = offsetWorldPoint(gridToWorld(dock), imageOffset);

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
    alias.label = this.scene.add.text(
      labelAt.x + imageOffset.x,
      labelAt.y + imageOffset.y,
      "HOME ISLAND",
      {
      color: "#f5e4b3",
      fontFamily: "ui-monospace, monospace",
      fontSize: "14px",
      fontStyle: "bold",
      stroke: "#10242a",
      strokeThickness: 4,
      },
    ).setOrigin(0.5).setDepth(10);
    return alias;
  }

  private indexAuthoredIslandPresentations(generated: Readonly<GeneratedWorld>): void {
    const byIslandId = new Map<number, AuthoredIslandPresentationRecord>();
    const byFootprintChunk = new Map<string, AuthoredIslandPresentationRecord[]>();
    if (
      this.authoredIslandPresentations
      && generated.manifest.authoredIslandCatalogRevision !== this.authoredIslandPresentations.revision
    ) {
      this.authoredIslandPresentationsByIslandId = byIslandId;
      this.authoredIslandPresentationsByFootprintChunk = byFootprintChunk;
      return;
    }
    for (const island of generated.islands) {
      if (island.sourceKind !== "authored" || !island.authoredAssetId || !island.authoredCollision) continue;
      const presentation = this.authoredIslandPresentations?.entry(island.authoredAssetId);
      if (!presentation || !hasAuthoredIslandLandPlane(presentation)) continue;
      if (
        presentation.gridWidth !== island.authoredCollision.gridWidth
        || presentation.gridHeight !== island.authoredCollision.gridHeight
      ) {
        continue;
      }
      const record = Object.freeze({ island, presentation });
      byIslandId.set(island.id, record);
      const chunkKeys = new Set<string>();
      for (const piece of generated.grid.topology.decomposeTileBounds(island.bounds)) {
        const minimumChunkX = Math.floor(piece.minX / generated.grid.chunkSize);
        const maximumChunkX = Math.floor(piece.maxX / generated.grid.chunkSize);
        const minimumChunkY = Math.floor(piece.minY / generated.grid.chunkSize);
        const maximumChunkY = Math.floor(piece.maxY / generated.grid.chunkSize);
        for (let chunkY = minimumChunkY; chunkY <= maximumChunkY; chunkY++) {
          for (let chunkX = minimumChunkX; chunkX <= maximumChunkX; chunkX++) {
            chunkKeys.add(canonicalChunkKey({ x: chunkX, y: chunkY }));
          }
        }
      }
      for (const key of chunkKeys) {
        const bucket = byFootprintChunk.get(key) ?? [];
        bucket.push(record);
        byFootprintChunk.set(key, bucket);
      }
    }
    this.authoredIslandPresentationsByIslandId = byIslandId;
    this.authoredIslandPresentationsByFootprintChunk = new Map(
      [...byFootprintChunk].map(([key, bucket]) => [
        key,
        Object.freeze(bucket.sort((left, right) => left.island.id - right.island.id)),
      ]),
    );
  }

  private drawAuthoredIslandAlias(
    record: Readonly<AuthoredIslandPresentationRecord>,
    imageOffset: Readonly<WorldPoint>,
  ): AuthoredIslandAliasView {
    const { island, presentation } = record;
    const size = prototypeConfig.navigation.tileSize;
    const images: Phaser.GameObjects.Image[] = [];
    let landPlaneIndex = 0;
    for (const layer of presentation.layers) {
      const depth = layer.plane === "water-apron"
        ? 1.7
        : layer.plane === "shore-effect"
          ? 4.75
          : 4 + landPlaneIndex++ * 0.01;
      const image = this.scene.add.image(
        island.bounds.minX * size + imageOffset.x,
        island.bounds.minY * size + imageOffset.y,
        layer.textureKey,
      )
        .setOrigin(0)
        .setDisplaySize(presentation.gridWidth * size, presentation.gridHeight * size)
        .setAlpha(layer.opacity)
        .setBlendMode(authoredIslandBlendMode(layer.blendMode))
        .setDepth(depth);
      images.push(image);
    }
    return {
      islandId: island.id,
      imageOffset: Object.freeze({ ...imageOffset }),
      images: Object.freeze(images),
    };
  }

  private syncPeriodicArtwork(entries: readonly Readonly<ActiveChunkEntry>[]): void {
    const generated = this.generated!;
    const topology = generated.grid.topology;
    const homeMetadata = this.authoredHomeMetadata ?? PILOT_HOME_ISLAND_METADATA;
    const homeBounds = homeFootprintBounds(generated, homeMetadata);
    const desiredHome = new Map<string, WorldPoint>();
    const desiredIslands = new Map<
      string,
      { record: Readonly<AuthoredIslandPresentationRecord>; imageOffset: WorldPoint }
    >();
    for (const entry of entries) {
      const viewBounds = liftedChunkBounds(entry, topology);
      for (const imageOffset of periodicOffsetsIntersecting(homeBounds, viewBounds, topology)) {
        desiredHome.set(imageOffsetKey(imageOffset), imageOffset);
      }
      const records = this.authoredIslandPresentationsByFootprintChunk.get(
        canonicalChunkKey(entry.canonicalChunk),
      ) ?? [];
      for (const record of records) {
        for (const imageOffset of periodicOffsetsIntersecting(record.island.bounds, viewBounds, topology)) {
          desiredIslands.set(authoredIslandAliasKey(record.island.id, imageOffset), { record, imageOffset });
        }
      }
    }

    for (const [key, alias] of this.homeAliases) {
      if (desiredHome.has(key)) continue;
      const destroyed = homeAliasResourceCount(alias);
      destroyHomeAlias(alias);
      this.homeAliases.delete(key);
      this.totalResourceObjectsDestroyed += destroyed;
    }
    for (const [key, imageOffset] of desiredHome) {
      if (this.homeAliases.has(key)) continue;
      const alias = this.drawHome(generated, imageOffset);
      this.homeAliases.set(key, alias);
      this.totalResourceObjectsCreated += homeAliasResourceCount(alias);
    }

    for (const [key, alias] of this.authoredIslandAliases) {
      if (desiredIslands.has(key)) continue;
      for (const image of alias.images) image.destroy();
      this.authoredIslandAliases.delete(key);
      this.totalResourceObjectsDestroyed += alias.images.length;
    }
    for (const [key, desired] of desiredIslands) {
      if (this.authoredIslandAliases.has(key)) continue;
      const alias = this.drawAuthoredIslandAlias(desired.record, desired.imageOffset);
      this.authoredIslandAliases.set(key, alias);
      this.totalResourceObjectsCreated += alias.images.length;
    }
  }

  private isAuthoredHomeFootprint(generated: GeneratedWorld, x: number, y: number): boolean {
    const metadata = this.authoredHomeMetadata;
    if (!metadata) return false;
    return generated.grid.topology.decomposeTileBounds(homeFootprintBounds(generated, metadata))
      .some((piece) => x >= piece.minX && x <= piece.maxX && y >= piece.minY && y <= piece.maxY);
  }

  private assertValidChunkEntry(entry: Readonly<ActiveChunkEntry>): void {
    const generated = this.generated;
    if (!generated) throw new Error("A world must be bound before chunks can be validated");
    const { x, y } = entry.canonicalChunk;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new RangeError(`Canonical chunk coordinates must be safe integers: ${entry.viewKey}`);
    }
    const topology = generated.grid.topology;
    const expectedKey = activeChunkViewKey(x, y, entry.imageOffset.x, entry.imageOffset.y);
    if (entry.viewKey !== expectedKey) {
      throw new RangeError(`Active chunk image key ${entry.viewKey} does not match ${expectedKey}`);
    }
    if (x < 0 || y < 0 || x >= topology.chunkColumns || y >= topology.chunkRows) {
      throw new RangeError(`Active chunk image ${entry.viewKey} has an out-of-range canonical chunk`);
    }
    if (
      !Number.isSafeInteger(entry.imageOffset.x)
      || !Number.isSafeInteger(entry.imageOffset.y)
      || (entry.imageOffset.x !== 0 && entry.imageOffset.x % topology.pixelWidth !== 0)
      || (entry.imageOffset.y !== 0 && entry.imageOffset.y % topology.pixelHeight !== 0)
      || (!topology.wrapsX && entry.imageOffset.x !== 0)
      || (!topology.wrapsY && entry.imageOffset.y !== 0)
    ) throw new RangeError(`Active chunk image ${entry.viewKey} has an invalid whole-world offset`);
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
    }
    for (const alias of this.homeAliases.values()) {
      if (alias.homeStructures) graphics++;
      if (alias.label) text++;
      if (alias.homeVisual) authoredImages += alias.homeVisual.metadata.render.slices.length;
    }
    for (const alias of this.authoredIslandAliases.values()) authoredImages += alias.images.length;
    return { graphics, text, authoredImages, resources: graphics + text + authoredImages };
  }

  private chunkResourceCount(chunk: ChunkView): number {
    return Object.values(chunk.layers).filter(Boolean).length;
  }

  private countActiveResources(): number {
    let count = this.homeAliasResourceCount() + this.authoredIslandAliasResourceCount();
    for (const chunk of this.chunks.values()) count += this.chunkResourceCount(chunk);
    return count;
  }

  private homeAliasResourceCount(): number {
    let count = 0;
    for (const alias of this.homeAliases.values()) count += homeAliasResourceCount(alias);
    return count;
  }

  private authoredIslandAliasResourceCount(): number {
    let count = 0;
    for (const alias of this.authoredIslandAliases.values()) count += alias.images.length;
    return count;
  }

  private updateOceanCoverage(
    visibleBounds: Readonly<LiftedTileBounds> | null,
    entries: readonly Readonly<ActiveChunkEntry>[],
  ): void {
    const generated = this.generated;
    if (!generated) {
      this.ocean.setVisible(false);
      return;
    }
    let bounds = visibleBounds;
    if (!bounds && entries.length > 0) {
      const topology = generated.grid.topology;
      const lifted = entries.map((entry) => liftedChunkBounds(entry, topology));
      bounds = {
        minX: Math.min(...lifted.map(({ minX }) => minX)),
        minY: Math.min(...lifted.map(({ minY }) => minY)),
        maxX: Math.max(...lifted.map(({ maxX }) => maxX)),
        maxY: Math.max(...lifted.map(({ maxY }) => maxY)),
      };
    }
    if (!bounds) {
      this.ocean.setVisible(false);
      return;
    }
    const size = prototypeConfig.navigation.tileSize;
    this.ocean
      .setSize((bounds.maxX - bounds.minX + 1) * size, (bounds.maxY - bounds.minY + 1) * size)
      .setPosition(bounds.minX * size, bounds.minY * size)
      .setVisible(true);
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
    for (const alias of this.homeAliases.values()) {
      const destroyed = homeAliasResourceCount(alias);
      destroyHomeAlias(alias);
      this.totalResourceObjectsDestroyed += destroyed;
    }
    this.homeAliases.clear();
    for (const alias of this.authoredIslandAliases.values()) {
      for (const image of alias.images) image.destroy();
      this.totalResourceObjectsDestroyed += alias.images.length;
    }
    this.authoredIslandAliases.clear();
    this.totalChunkDeactivations += activeCount;
    this.generated = undefined;
    this.islandsById = new Map();
    this.authoredIslandPresentationsByIslandId = new Map();
    this.authoredIslandPresentationsByFootprintChunk = new Map();
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
    || left.imageOffset.y - right.imageOffset.y
    || left.imageOffset.x - right.imageOffset.x
    || left.canonicalChunk.y - right.canonicalChunk.y
    || left.canonicalChunk.x - right.canonicalChunk.x;
}

function canonicalChunkKey(coordinate: Readonly<GridPoint>): string {
  return `${coordinate.x},${coordinate.y}`;
}

function offsetWorldPoint(point: Readonly<WorldPoint>, offset: Readonly<WorldPoint>): WorldPoint {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function imageOffsetKey(offset: Readonly<WorldPoint>): string {
  return `${offset.x},${offset.y}`;
}

function authoredIslandAliasKey(islandId: number, offset: Readonly<WorldPoint>): string {
  return `${islandId}@${imageOffsetKey(offset)}`;
}

function homeFootprintBounds(
  generated: Readonly<GeneratedWorld>,
  metadata: Readonly<AuthoredHomeIslandMetadata>,
): CanonicalTileBounds {
  const minX = generated.landmarks.homeCenter.x - metadata.anchors.homeCenter.x;
  const minY = generated.landmarks.homeCenter.y - metadata.anchors.homeCenter.y;
  return {
    minX,
    minY,
    maxX: minX + metadata.grid.width - 1,
    maxY: minY + metadata.grid.height - 1,
  };
}

function liftedChunkBounds(
  entry: Readonly<ActiveChunkEntry>,
  topology: Readonly<WorldTopology>,
): CanonicalTileBounds {
  const offsetX = entry.imageOffset.x / topology.tileSize;
  const offsetY = entry.imageOffset.y / topology.tileSize;
  const minX = entry.canonicalChunk.x * topology.chunkSize + offsetX;
  const minY = entry.canonicalChunk.y * topology.chunkSize + offsetY;
  return {
    minX,
    minY,
    maxX: Math.min(topology.tileWidth, (entry.canonicalChunk.x + 1) * topology.chunkSize) - 1 + offsetX,
    maxY: Math.min(topology.tileHeight, (entry.canonicalChunk.y + 1) * topology.chunkSize) - 1 + offsetY,
  };
}

function periodicOffsetsIntersecting(
  footprint: Readonly<CanonicalTileBounds>,
  view: Readonly<CanonicalTileBounds>,
  topology: Readonly<WorldTopology>,
): WorldPoint[] {
  const xOffsets = intersectingAxisOffsets(
    footprint.minX,
    footprint.maxX,
    view.minX,
    view.maxX,
    topology.tileWidth,
    topology.wrapsX,
  );
  const yOffsets = intersectingAxisOffsets(
    footprint.minY,
    footprint.maxY,
    view.minY,
    view.maxY,
    topology.tileHeight,
    topology.wrapsY,
  );
  const result: WorldPoint[] = [];
  for (const offsetY of yOffsets) {
    for (const offsetX of xOffsets) {
      result.push({ x: offsetX * topology.tileSize, y: offsetY * topology.tileSize });
    }
  }
  return result;
}

function intersectingAxisOffsets(
  footprintMinimum: number,
  footprintMaximum: number,
  viewMinimum: number,
  viewMaximum: number,
  span: number,
  wraps: boolean,
): number[] {
  if (!wraps) {
    return footprintMaximum >= viewMinimum && footprintMinimum <= viewMaximum ? [0] : [];
  }
  const firstImage = Math.ceil((viewMinimum - footprintMaximum) / span);
  const lastImage = Math.floor((viewMaximum - footprintMinimum) / span);
  const offsets: number[] = [];
  for (let image = firstImage; image <= lastImage; image++) offsets.push(image * span);
  return offsets;
}

function homeAliasResourceCount(alias: Readonly<HomeAliasView>): number {
  return (alias.homeStructures ? 1 : 0)
    + (alias.label ? 1 : 0)
    + (alias.homeVisual ? alias.homeVisual.metadata.render.slices.length : 0);
}

function destroyHomeAlias(alias: Readonly<HomeAliasView>): void {
  alias.homeStructures?.destroy();
  alias.homeVisual?.destroy();
  alias.label?.destroy();
}

function terrainAtImageNeighbor(
  grid: Readonly<GeneratedWorld["grid"]>,
  x: number,
  y: number,
): TerrainType | undefined {
  const canonical = grid.topology.canonicalizeTile(x, y);
  return canonical ? grid.getTerrain(canonical.x, canonical.y) : undefined;
}
