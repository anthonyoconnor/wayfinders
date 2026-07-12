import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import { seededValue } from "../world/WorldGenerator";
import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";

interface MaskView {
  image: Phaser.GameObjects.Image;
  texture: Phaser.Textures.CanvasTexture;
  worldWidth: number;
  worldHeight: number;
}

const MASK_SCALE = 4;
const MASK_PADDING_TILES = 1;

/**
 * Reusable, bilinear knowledge mask. Changed chunks are redrawn into one world
 * texture so camera scaling cannot expose seams between adjacent chunk quads.
 */
export class KnowledgeOverlayRenderer {
  private readonly lastChunkRevisions = new Map<string, number>();
  private readonly scratch: HTMLCanvasElement;
  private readonly filtered: HTMLCanvasElement;
  private readonly textureKey: string;
  private view?: MaskView;
  private lastWorld?: WorldGrid;
  private lastSignature = "";

  constructor(private readonly scene: Phaser.Scene) {
    const paddedPixels = (prototypeConfig.navigation.chunkSize + MASK_PADDING_TILES * 2) * MASK_SCALE;
    this.scratch = document.createElement("canvas");
    this.filtered = document.createElement("canvas");
    this.scratch.width = this.scratch.height = paddedPixels;
    this.filtered.width = this.filtered.height = paddedPixels;
    this.textureKey = `${String(scene.sys.settings.key)}-knowledge-mask`;
  }

  sync(world: WorldGrid, seed: number, force = false): void {
    const signature = [
      prototypeConfig.overlays.fogBlend,
      prototypeConfig.overlays.fogNoise,
      prototypeConfig.navigation.tileSize,
    ].join(":");
    const worldChanged = this.lastWorld !== world;
    const styleChanged = this.lastSignature !== signature;
    const view = this.getOrCreateView(world);
    this.lastWorld = world;
    this.lastSignature = signature;

    let changed = false;
    for (const chunk of world.getLoadedChunks()) {
      const key = `${chunk.chunkX},${chunk.chunkY}`;
      const previousRevision = this.lastChunkRevisions.get(key);
      if (!force && !worldChanged && !styleChanged && previousRevision === chunk.revision) continue;
      this.renderChunk(world, chunk, seed, view.texture);
      this.lastChunkRevisions.set(key, chunk.revision);
      changed = true;
    }
    if (changed) view.texture.refresh();
  }

  destroy(): void {
    this.view?.image.destroy();
    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
    this.view = undefined;
    this.lastChunkRevisions.clear();
  }

  private getOrCreateView(world: WorldGrid): MaskView {
    if (this.view?.worldWidth === world.width && this.view.worldHeight === world.height) return this.view;
    this.view?.image.destroy();
    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);

    const texture = this.scene.textures.createCanvas(
      this.textureKey,
      world.width * MASK_SCALE,
      world.height * MASK_SCALE,
    );
    if (!texture) throw new Error(`Could not create knowledge mask texture ${this.textureKey}`);
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    const image = this.scene.add.image(0, 0, this.textureKey).setOrigin(0).setDisplaySize(
      world.width * prototypeConfig.navigation.tileSize,
      world.height * prototypeConfig.navigation.tileSize,
    ).setDepth(35);
    this.view = { image, texture, worldWidth: world.width, worldHeight: world.height };
    this.lastChunkRevisions.clear();
    return this.view;
  }

  private renderChunk(
    world: WorldGrid,
    chunk: WorldChunk,
    seed: number,
    texture: Phaser.Textures.CanvasTexture,
  ): void {
    const scratchContext = this.scratch.getContext("2d");
    const filteredContext = this.filtered.getContext("2d");
    const targetContext = texture.getContext();
    if (!scratchContext || !filteredContext || !targetContext) throw new Error("Canvas masks require a 2D context");

    scratchContext.clearRect(0, 0, this.scratch.width, this.scratch.height);
    const padding = MASK_PADDING_TILES;
    for (let localY = -padding; localY < chunk.size + padding; localY++) {
      for (let localX = -padding; localX < chunk.size + padding; localX++) {
        const worldX = chunk.chunkX * chunk.size + localX;
        const worldY = chunk.chunkY * chunk.size + localY;
        const pixelX = (localX + padding) * MASK_SCALE;
        const pixelY = (localY + padding) * MASK_SCALE;

        if (!world.inBounds(worldX, worldY)) {
          scratchContext.fillStyle = "rgba(1, 7, 10, 1)";
          scratchContext.fillRect(pixelX, pixelY, MASK_SCALE, MASK_SCALE);
          continue;
        }
        if (world.isVisibleNow(worldX, worldY) || world.getKnowledge(worldX, worldY) === KnowledgeState.Supported) continue;

        const noise = (seededValue(seed + 809, worldX, worldY) - 0.5) * prototypeConfig.overlays.fogNoise;
        if (world.getKnowledge(worldX, worldY) === KnowledgeState.Unknown) {
          const shade = Math.round(5 + noise * 22);
          scratchContext.fillStyle = `rgba(${Math.max(1, shade)}, ${Math.max(7, shade + 5)}, ${Math.max(10, shade + 8)}, 0.97)`;
        } else {
          const shade = Math.round(65 + noise * 30);
          scratchContext.fillStyle = `rgba(${shade}, ${shade + 5}, ${shade + 8}, 0.62)`;
        }
        scratchContext.fillRect(pixelX, pixelY, MASK_SCALE, MASK_SCALE);
      }
    }

    filteredContext.clearRect(0, 0, this.filtered.width, this.filtered.height);
    filteredContext.save();
    const blurPixels = Math.max(0.25, prototypeConfig.overlays.fogBlend * MASK_SCALE * 1.6);
    filteredContext.filter = `blur(${blurPixels}px)`;
    filteredContext.drawImage(this.scratch, 0, 0);
    filteredContext.restore();

    const sourceOffset = padding * MASK_SCALE;
    const chunkPixels = chunk.size * MASK_SCALE;
    const targetX = chunk.chunkX * chunkPixels;
    const targetY = chunk.chunkY * chunkPixels;
    targetContext.clearRect(targetX, targetY, chunkPixels, chunkPixels);
    targetContext.drawImage(
      this.filtered,
      sourceOffset,
      sourceOffset,
      chunkPixels,
      chunkPixels,
      targetX,
      targetY,
      chunkPixels,
      chunkPixels,
    );
  }
}
