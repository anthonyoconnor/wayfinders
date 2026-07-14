import Phaser from "phaser";
import { AUTHORED_ASSET_IDS, type AuthoredHomeIslandMetadata } from "../assets/AuthoredAssetContracts";
import type { PilotAssetRuntime } from "../assets/PilotAssetRuntime";
import { prototypeConfig } from "../config/prototypeConfig";
import { gridToWorld } from "../world/CoordinateSystem";
import { IslandKind, type GeneratedIsland } from "../world/IslandGenerator";
import { seededValue } from "../world/SeededRandom";
import { KnowledgeState, TerrainType } from "../world/TileData";
import type { GeneratedWorld } from "../world/WorldGenerator";
import type { WorldChunk } from "../world/WorldChunk";

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
  chunkX: number;
  chunkY: number;
  originX: number;
  originY: number;
  bounds: Phaser.Geom.Rectangle;
  layers: Partial<Record<ChunkLayerName, CameraCulledGraphics>>;
  renderers: CameraCulledGraphics[];
}

/** Developer-art renderer. Gameplay terrain remains owned by WorldGrid. */
export class WorldRenderer {
  private readonly ocean: Phaser.GameObjects.Rectangle;
  private readonly homeStructures: Phaser.GameObjects.Graphics;
  private readonly homeImage?: Phaser.GameObjects.Image;
  private readonly homeMetadata?: Readonly<AuthoredHomeIslandMetadata>;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private chunks: ChunkView[] = [];
  private lastWorld?: GeneratedWorld["grid"];
  private observedKnowledgeRevisions = new WeakMap<WorldChunk, number>();
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    pilotAssets?: Readonly<PilotAssetRuntime>,
  ) {
    this.ocean = scene.add.rectangle(0, 0, 1, 1, COLORS.ocean, 1).setOrigin(0).setDepth(0);
    // Home structures are a constant-size overlay. Keeping them separate avoids
    // coupling their cross-chunk dock geometry to a single chunk's visibility.
    this.homeStructures = scene.add.graphics().setDepth(5.5);
    const metadata = pilotAssets?.metadata(AUTHORED_ASSET_IDS.homeIsland);
    if (metadata?.kind === "home-island" && metadata.render.slices.length === 1) {
      const slice = metadata.render.slices[0];
      const textureKey = pilotAssets?.textureKey(slice.imageId);
      if (textureKey) {
        this.homeMetadata = metadata;
        this.homeImage = scene.add.image(0, 0, textureKey)
          .setOrigin(0)
          .setDisplaySize(slice.pixelSize.width * slice.scale, slice.pixelSize.height * slice.scale)
          .setDepth(slice.depth)
          .setVisible(false);
      }
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  render(generated: GeneratedWorld): void {
    if (this.destroyed) return;
    const { grid, landmarks, seed } = generated;
    const size = prototypeConfig.navigation.tileSize;
    const islandsById = new Map(generated.islands.map((island) => [island.id, island]));
    this.clear();
    this.lastWorld = grid;
    this.observedKnowledgeRevisions = new WeakMap();

    this.ocean
      .setSize(grid.width * size, grid.height * size)
      .setPosition(0, 0)
      .setVisible(true);
    this.chunks = this.createChunkViews(generated);
    const chunkColumns = Math.ceil(grid.width / grid.chunkSize);

    grid.forEachTile((x, y) => {
      const tile = grid.getTile(x, y);
      const chunk = this.chunks[
        Math.floor(y / grid.chunkSize) * chunkColumns + Math.floor(x / grid.chunkSize)
      ];
      const px = (x - chunk.chunkX * grid.chunkSize) * size;
      const py = (y - chunk.chunkY * grid.chunkSize) * size;
      const supported = tile.knowledge === KnowledgeState.Supported;
      if (this.isAuthoredHomeFootprint(generated, x, y)) {
        if (supported) {
          const water = this.getLayer(chunk, "water");
          water.fillStyle(COLORS.supported, 1);
          water.fillRect(px, py, size + 1, size + 1);
        }
        return;
      }
      const island = islandsById.get(tile.islandId);
      const palette = island ? ISLAND_PALETTES[island.kind] : ISLAND_PALETTES[IslandKind.HighIsland];

      let waterColor: number = supported ? COLORS.supported : COLORS.ocean;
      if (tile.terrain === TerrainType.ShallowOcean) {
        waterColor = supported ? palette.shallowSupported : palette.shallow;
      }
      if (waterColor !== COLORS.ocean) {
        const water = this.getLayer(chunk, "water");
        water.fillStyle(waterColor, 1);
        water.fillRect(px, py, size + 1, size + 1);
      }

      if (tile.terrain === TerrainType.Land) {
        const terrain = this.getLayer(chunk, "terrain");
        const variation = seededValue(seed + 401, x, y) > 0.5 ? palette.land : palette.landDark;
        terrain.fillStyle(variation, 1);
        terrain.fillRoundedRect(px + 1, py + 1, size - 2, size - 2, size * 0.18);
      } else if (tile.terrain === TerrainType.Rock) {
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
      } else if (tile.terrain === TerrainType.Reef) {
        const terrain = this.getLayer(chunk, "terrain");
        terrain.fillStyle(palette.reef, 0.9);
        terrain.fillCircle(px + size * 0.32, py + size * 0.54, size * 0.15);
        terrain.fillCircle(px + size * 0.63, py + size * 0.42, size * 0.12);
      }

      if (tile.terrain === TerrainType.Land) {
        this.drawCoastTile(generated, chunk, island ? palette.coast : COLORS.sand, x, y, px, py, size);
      }
      if (island) this.drawIslandDecoration(chunk, island, tile.terrain, x, y, px, py, size, seed);

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

    });

    this.drawHome(generated);

    const labelAt = gridToWorld({ x: landmarks.homeCenter.x, y: landmarks.homeCenter.y - prototypeConfig.world.homeIslandRadius - 2 });
    const label = this.scene.add.text(labelAt.x, labelAt.y, "HOME ISLAND", {
      color: "#f5e4b3",
      fontFamily: "ui-monospace, monospace",
      fontSize: "14px",
      fontStyle: "bold",
      stroke: "#10242a",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);
    this.labels.push(label);
    for (const chunk of grid.getLoadedChunks()) {
      this.observedKnowledgeRevisions.set(chunk, chunk.knowledgeRevision);
    }
  }

  /** Repaints only water layers whose authoritative knowledge changed since the last world render. */
  refreshKnowledge(generated: GeneratedWorld): number {
    if (this.destroyed) return 0;
    if (this.lastWorld !== generated.grid) {
      this.render(generated);
      return this.chunks.length;
    }

    const islandsById = new Map(generated.islands.map((island) => [island.id, island]));
    const columns = Math.ceil(generated.grid.width / generated.grid.chunkSize);
    let refreshed = 0;
    for (const worldChunk of generated.grid.getLoadedChunks()) {
      if (this.observedKnowledgeRevisions.get(worldChunk) === worldChunk.knowledgeRevision) continue;
      const view = this.chunks[worldChunk.chunkY * columns + worldChunk.chunkX];
      if (!view) continue;
      this.redrawWaterLayer(generated, view, islandsById);
      this.observedKnowledgeRevisions.set(worldChunk, worldChunk.knowledgeRevision);
      refreshed++;
    }
    return refreshed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.clear();
    this.ocean.destroy();
    this.homeStructures.destroy();
    this.homeImage?.destroy();
  }

  private createChunkViews(generated: GeneratedWorld): ChunkView[] {
    const { grid } = generated;
    const tileSize = prototypeConfig.navigation.tileSize;
    const padding = Math.max(2, tileSize * 0.12);
    const columns = Math.ceil(grid.width / grid.chunkSize);
    const rows = Math.ceil(grid.height / grid.chunkSize);
    const chunks: ChunkView[] = [];

    for (let chunkY = 0; chunkY < rows; chunkY++) {
      for (let chunkX = 0; chunkX < columns; chunkX++) {
        const startX = chunkX * grid.chunkSize;
        const startY = chunkY * grid.chunkSize;
        const originX = startX * tileSize;
        const originY = startY * tileSize;
        const width = Math.min(grid.chunkSize, grid.width - startX) * tileSize;
        const height = Math.min(grid.chunkSize, grid.height - startY) * tileSize;
        chunks.push({
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
          renderers: [],
        });
      }
    }
    return chunks;
  }

  private getLayer(chunk: ChunkView, name: ChunkLayerName): CameraCulledGraphics {
    let layer = chunk.layers[name];
    if (layer) return layer;
    layer = new CameraCulledGraphics(this.scene, chunk.bounds)
      .setPosition(chunk.originX, chunk.originY)
      .setDepth(CHUNK_LAYER_DEPTHS[name]);
    chunk.layers[name] = layer;
    chunk.renderers.push(layer);
    return layer;
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
        const palette = island ? ISLAND_PALETTES[island.kind] : ISLAND_PALETTES[IslandKind.HighIsland];
        let waterColor: number = supported ? COLORS.supported : COLORS.ocean;
        if (tile.terrain === TerrainType.ShallowOcean) {
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

  private drawHome(generated: GeneratedWorld): void {
    const { homeCenter, harbour, dock } = generated.landmarks;
    const size = prototypeConfig.navigation.tileSize;
    if (this.homeImage && this.homeMetadata) {
      const topLeftX = homeCenter.x - this.homeMetadata.anchors.homeCenter.x;
      const topLeftY = homeCenter.y - this.homeMetadata.anchors.homeCenter.y;
      this.homeImage.setPosition(topLeftX * size, topLeftY * size).setVisible(true);
      this.homeStructures.clear();
      return;
    }
    const center = gridToWorld(homeCenter);
    const harbourWorld = gridToWorld(harbour);
    const dockWorld = gridToWorld(dock);

    // A flag and simple huts make the home readable without production art.
    this.homeStructures.lineStyle(3, COLORS.timber, 1);
    this.homeStructures.lineBetween(center.x, center.y - size * 1.45, center.x, center.y - size * 0.2);
    this.homeStructures.fillStyle(COLORS.sailcloth, 1);
    this.homeStructures.fillTriangle(center.x, center.y - size * 1.4, center.x + size * 0.55, center.y - size * 1.15, center.x, center.y - size * 0.95);

    const huts = [
      { x: center.x - size * 1.7, y: center.y - size * 0.6 },
      { x: center.x + size * 0.6, y: center.y + size * 1.4 },
      { x: center.x - size * 0.8, y: center.y + size * 1.7 },
    ];
    for (const hut of huts) {
      this.homeStructures.fillStyle(COLORS.timberLight, 1);
      this.homeStructures.fillRect(hut.x - size * 0.28, hut.y - size * 0.05, size * 0.56, size * 0.42);
      this.homeStructures.fillStyle(COLORS.roof, 1);
      this.homeStructures.fillTriangle(hut.x - size * 0.4, hut.y, hut.x, hut.y - size * 0.42, hut.x + size * 0.4, hut.y);
    }

    // East-facing harbour and a short dock aligned to the generated return tile.
    this.homeStructures.lineStyle(size * 0.18, COLORS.timber, 1);
    this.homeStructures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y, dockWorld.x + size * 0.35, dockWorld.y);
    this.homeStructures.lineStyle(size * 0.08, COLORS.timberLight, 1);
    this.homeStructures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y - size * 0.12, dockWorld.x + size * 0.35, dockWorld.y - size * 0.12);
    this.homeStructures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y + size * 0.12, dockWorld.x + size * 0.35, dockWorld.y + size * 0.12);
    for (let x = harbourWorld.x - size * 0.5; x <= dockWorld.x + size * 0.25; x += size * 0.38) {
      this.homeStructures.lineStyle(2, COLORS.timberLight, 1);
      this.homeStructures.lineBetween(x, harbourWorld.y - size * 0.23, x, harbourWorld.y + size * 0.23);
    }
  }

  private isAuthoredHomeFootprint(generated: GeneratedWorld, x: number, y: number): boolean {
    if (!this.homeImage || !this.homeMetadata) return false;
    const topLeftX = generated.landmarks.homeCenter.x - this.homeMetadata.anchors.homeCenter.x;
    const topLeftY = generated.landmarks.homeCenter.y - this.homeMetadata.anchors.homeCenter.y;
    return x >= topLeftX
      && y >= topLeftY
      && x < topLeftX + this.homeMetadata.grid.width
      && y < topLeftY + this.homeMetadata.grid.height;
  }

  private clear(): void {
    this.ocean.setVisible(false);
    this.homeImage?.setVisible(false);
    this.homeStructures.clear();
    for (const chunk of this.chunks) {
      for (const renderer of chunk.renderers) renderer.destroy();
    }
    this.chunks = [];
    for (const label of this.labels) label.destroy();
    this.labels.length = 0;
    this.lastWorld = undefined;
    this.observedKnowledgeRevisions = new WeakMap();
  }
}
