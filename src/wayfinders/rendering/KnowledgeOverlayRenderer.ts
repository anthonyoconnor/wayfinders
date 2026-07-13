import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import { seededValue } from "../world/WorldGenerator";
import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";
import { addPaddedChunkNeighbours } from "./OverlayChunkInvalidation";
import { createCameraCulledImage } from "./CameraCulledImage";

interface MaskChunkView {
  image: Phaser.GameObjects.Image;
  texture: Phaser.Textures.CanvasTexture;
  textureKey: string;
}

const MASK_SCALE = 4;
const MASK_PADDING_TILES = 1;

/**
 * Reusable, bilinear knowledge mask. Each chunk owns a small padded texture;
 * changes invalidate that chunk and its neighbours so the sampled padding at
 * chunk boundaries never becomes stale.
 */
export class KnowledgeOverlayRenderer {
  private readonly views = new Map<string, MaskChunkView>();
  private readonly scratch: HTMLCanvasElement;
  private readonly filtered: HTMLCanvasElement;
  private readonly textureKeyPrefix: string;
  private lastWorld?: WorldGrid;
  private lastSignature = "";
  private lastKnowledgeVersion = -1;
  private lastVisibilityVersion = -1;
  private observedRevisions = new WeakMap<WorldChunk, number>();

  constructor(private readonly scene: Phaser.Scene) {
    const paddedPixels = (prototypeConfig.navigation.chunkSize + MASK_PADDING_TILES * 2) * MASK_SCALE;
    this.scratch = document.createElement("canvas");
    this.filtered = document.createElement("canvas");
    this.scratch.width = this.scratch.height = paddedPixels;
    this.filtered.width = this.filtered.height = paddedPixels;
    this.textureKeyPrefix = `${String(scene.sys.settings.key)}-knowledge-mask`;
  }

  sync(world: WorldGrid, seed: number, force = false): void {
    const signature = [
      prototypeConfig.overlays.fogBlend,
      prototypeConfig.overlays.fogNoise,
      prototypeConfig.navigation.tileSize,
    ].join(":");
    const worldChanged = this.lastWorld !== world;
    const styleChanged = this.lastSignature !== signature;
    if (worldChanged) {
      this.destroyViews();
      this.observedRevisions = new WeakMap();
      this.lastKnowledgeVersion = -1;
      this.lastVisibilityVersion = -1;
    }
    this.lastWorld = world;
    this.lastSignature = signature;

    const chunks = world.getLoadedChunks();
    const redrawAll = force || worldChanged || styleChanged;
    const knowledgeChanged = world.knowledgeVersion !== this.lastKnowledgeVersion;
    const visibilityChanged = world.visibilityVersion !== this.lastVisibilityVersion;
    const chunksChanged = chunks.length !== this.views.size;
    if (!redrawAll && !knowledgeChanged && !visibilityChanged && !chunksChanged) return;

    const dirtyChunks = new Set<WorldChunk>();

    for (const chunk of chunks) {
      this.getOrCreateChunkView(chunk);
      const revisionChanged = this.observedRevisions.get(chunk) !== chunk.revision;
      this.observedRevisions.set(chunk, chunk.revision);
      if (redrawAll) {
        dirtyChunks.add(chunk);
      } else if (revisionChanged) {
        addPaddedChunkNeighbours(world, chunk, MASK_PADDING_TILES, dirtyChunks);
      }
    }

    for (const chunk of dirtyChunks) {
      const view = this.views.get(this.chunkKey(chunk));
      if (!view) continue;
      this.renderChunk(world, chunk, seed, view.texture);
      view.texture.refresh();
    }

    this.lastKnowledgeVersion = world.knowledgeVersion;
    this.lastVisibilityVersion = world.visibilityVersion;
  }

  destroy(): void {
    this.destroyViews();
    this.lastWorld = undefined;
    this.lastKnowledgeVersion = -1;
    this.lastVisibilityVersion = -1;
  }

  private getOrCreateChunkView(chunk: WorldChunk): MaskChunkView {
    const key = `${chunk.chunkX},${chunk.chunkY}`;
    const existing = this.views.get(key);
    if (existing) return existing;

    const textureKey = `${this.textureKeyPrefix}-${chunk.chunkX}-${chunk.chunkY}`;
    const paddingPixels = MASK_PADDING_TILES * MASK_SCALE;
    const chunkPixels = chunk.size * MASK_SCALE;
    const texturePixels = chunkPixels + paddingPixels * 2;
    const texture = this.scene.textures.createCanvas(textureKey, texturePixels, texturePixels);
    if (!texture) throw new Error(`Could not create knowledge mask texture ${textureKey}`);
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    texture.add("chunk", 0, paddingPixels, paddingPixels, chunkPixels, chunkPixels);
    const displayPixels = chunk.size * prototypeConfig.navigation.tileSize;
    const image = createCameraCulledImage(
      this.scene,
      chunk.chunkX * displayPixels,
      chunk.chunkY * displayPixels,
      textureKey,
      "chunk",
      {
        left: chunk.chunkX * displayPixels,
        right: (chunk.chunkX + 1) * displayPixels + 1,
        top: chunk.chunkY * displayPixels,
        bottom: (chunk.chunkY + 1) * displayPixels + 1,
      },
    ).setOrigin(0)
      // A one-world-pixel overlap prevents sub-pixel camera scaling from
      // exposing the boundary between independently filtered chunk quads.
      .setDisplaySize(displayPixels + 1, displayPixels + 1)
      .setDepth(35);
    const view = { image, texture, textureKey };
    this.views.set(key, view);
    return view;
  }

  private destroyViews(): void {
    for (const view of this.views.values()) {
      view.image.destroy();
      if (this.scene.textures.exists(view.textureKey)) this.scene.textures.remove(view.textureKey);
    }
    this.views.clear();
  }

  private chunkKey(chunk: WorldChunk): string {
    return `${chunk.chunkX},${chunk.chunkY}`;
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
          // Unknown interiors are fully opaque so high-contrast terrain cannot
          // silhouette through fog; smoothing applies only at knowledge edges.
          scratchContext.fillStyle = `rgba(${Math.max(1, shade)}, ${Math.max(7, shade + 5)}, ${Math.max(10, shade + 8)}, 1)`;
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

    targetContext.clearRect(0, 0, texture.width, texture.height);
    targetContext.drawImage(this.filtered, 0, 0);
  }
}
