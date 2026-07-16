import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import { seededValue } from "../world/WorldGenerator";
import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";
import { addPaddedChunkNeighbours } from "./OverlayChunkInvalidation";
import { createCameraCulledImage } from "./CameraCulledImage";
import type { ActiveChunkDelta, ActiveChunkEntry } from "./activation";

interface MaskChunkView {
  image: Phaser.GameObjects.Image;
  texture: Phaser.Textures.CanvasTexture;
  textureKey: string;
}

/** Lightweight counters for the renderer-owned decoded presentation resources. */
export interface KnowledgeOverlayResourceTelemetry {
  readonly chunkCapacity: number;
  readonly activeChunks: number;
  readonly activeTextures: number;
  readonly activeSprites: number;
  /** Canvas backing-store estimate; GPU/framework overhead is intentionally excluded. */
  readonly estimatedTextureBytes: number;
  readonly peakActiveTextures: number;
  readonly totalTextureAllocations: number;
  readonly totalTextureReleases: number;
}

const MASK_SCALE = 4;
const MASK_PADDING_TILES = 1;
const NO_REVEALED_ISLANDS: ReadonlySet<number> = new Set<number>();

/** Island dossiers reveal only the exact generated non-home island footprint. */
export function isExactIslandTileRevealed(
  islandId: number,
  revealedIslandIds: ReadonlySet<number>,
): boolean {
  return islandId > 0 && revealedIslandIds.has(islandId);
}

/**
 * Reusable, bilinear knowledge mask. Each chunk owns a small padded texture;
 * changes invalidate that chunk and its neighbours so the sampled padding at
 * chunk boundaries never becomes stale.
 */
export class KnowledgeOverlayRenderer {
  private readonly views = new Map<string, MaskChunkView>();
  private readonly activeEntries = new Map<string, Readonly<ActiveChunkEntry>>();
  private readonly pendingActivationKeys = new Set<string>();
  private readonly scratch: HTMLCanvasElement;
  private readonly filtered: HTMLCanvasElement;
  private readonly textureKeyPrefix: string;
  private lastWorld?: WorldGrid;
  private lastSignature = "";
  private lastKnowledgeVersion = -1;
  private lastVisibilityVersion = -1;
  private lastRevealedIslandsRevision = -1;
  private observedRevisions = new WeakMap<WorldChunk, number>();
  private chunkCapacity = 0;
  private peakActiveTextures = 0;
  private totalTextureAllocations = 0;
  private totalTextureReleases = 0;

  constructor(private readonly scene: Phaser.Scene) {
    const paddedPixels = (prototypeConfig.navigation.chunkSize + MASK_PADDING_TILES * 2) * MASK_SCALE;
    this.scratch = document.createElement("canvas");
    this.filtered = document.createElement("canvas");
    this.scratch.width = this.scratch.height = paddedPixels;
    this.filtered.width = this.filtered.height = paddedPixels;
    this.textureKeyPrefix = `${String(scene.sys.settings.key)}-knowledge-mask`;
  }

  /**
   * Applies the bounded presentation set before {@link sync}. Deactivations are
   * released immediately; activated chunks receive a texture only when their
   * authoritative WorldChunk already exists. Passing the complete active list
   * makes this resilient to renderer recreation and world replacement.
   */
  applyActiveChunkDelta(world: WorldGrid, delta: Readonly<ActiveChunkDelta>): void {
    this.prepareWorld(world);
    this.chunkCapacity = delta.telemetry.capacity;
    if (delta.active.length > this.chunkCapacity) {
      throw new RangeError(
        `Knowledge overlay received ${delta.active.length} active chunks for capacity ${this.chunkCapacity}`,
      );
    }

    const desiredKeys = new Set(delta.active.map(({ key }) => key));
    for (const { key } of delta.deactivated) this.destroyView(key);
    for (const key of [...this.views.keys()]) {
      if (!desiredKeys.has(key)) this.destroyView(key);
    }

    this.activeEntries.clear();
    for (const entry of delta.active) {
      this.activeEntries.set(entry.key, entry);
      const chunk = world.getChunk(entry.coordinate.x, entry.coordinate.y);
      if (!chunk) continue;
      if (!this.views.has(entry.key)) {
        this.getOrCreateChunkView(chunk);
        this.pendingActivationKeys.add(entry.key);
      }
    }
    this.assertResourceCap();
  }

  getResourceTelemetry(): Readonly<KnowledgeOverlayResourceTelemetry> {
    let estimatedTextureBytes = 0;
    for (const { texture } of this.views.values()) {
      estimatedTextureBytes += texture.width * texture.height * 4;
    }
    return Object.freeze({
      chunkCapacity: this.chunkCapacity,
      activeChunks: this.views.size,
      activeTextures: this.views.size,
      activeSprites: this.views.size,
      estimatedTextureBytes,
      peakActiveTextures: this.peakActiveTextures,
      totalTextureAllocations: this.totalTextureAllocations,
      totalTextureReleases: this.totalTextureReleases,
    });
  }

  sync(
    world: WorldGrid,
    seed: number,
    force = false,
    revealedIslandIds: ReadonlySet<number> = NO_REVEALED_ISLANDS,
    revealedIslandsRevision = 0,
  ): void {
    if (this.chunkCapacity === 0) {
      throw new Error("Knowledge overlay requires an ActiveChunkSet delta before sync");
    }
    const worldChanged = this.prepareWorld(world);
    const signature = [
      prototypeConfig.overlays.fogBlend,
      prototypeConfig.overlays.fogNoise,
      prototypeConfig.navigation.tileSize,
    ].join(":");
    const styleChanged = this.lastSignature !== signature;
    this.lastSignature = signature;

    const chunks = this.presentationChunks(world);
    const redrawAll = force || worldChanged || styleChanged;
    const knowledgeChanged = world.knowledgeVersion !== this.lastKnowledgeVersion;
    const visibilityChanged = world.visibilityVersion !== this.lastVisibilityVersion;
    const revealedIslandsChanged = revealedIslandsRevision !== this.lastRevealedIslandsRevision;
    const chunksChanged = chunks.length !== this.views.size || this.pendingActivationKeys.size > 0;
    if (!redrawAll && !knowledgeChanged && !visibilityChanged && !revealedIslandsChanged && !chunksChanged) return;

    const dirtyChunks = new Set<WorldChunk>();

    for (const chunk of chunks) {
      this.getOrCreateChunkView(chunk);
      if (redrawAll || revealedIslandsChanged || this.pendingActivationKeys.has(this.chunkKey(chunk))) {
        dirtyChunks.add(chunk);
      }
    }

    // A mask samples one tile beyond its owner. Observe only active chunks and
    // that narrow dependency ring, so an off-screen seam mutation is noticed
    // without scanning the world's loaded-chunk list.
    for (const sampledChunk of this.sampledChunks(world, chunks)) {
      const revisionChanged = this.observedRevisions.get(sampledChunk) !== sampledChunk.revision;
      this.observedRevisions.set(sampledChunk, sampledChunk.revision);
      if (!redrawAll && !revealedIslandsChanged && revisionChanged) {
        addPaddedChunkNeighbours(world, sampledChunk, MASK_PADDING_TILES, dirtyChunks);
      }
    }

    for (const chunk of dirtyChunks) {
      const view = this.views.get(this.chunkKey(chunk));
      if (!view) continue;
      this.renderChunk(world, chunk, seed, revealedIslandIds, view.texture);
      view.texture.refresh();
    }

    this.lastKnowledgeVersion = world.knowledgeVersion;
    this.lastVisibilityVersion = world.visibilityVersion;
    this.lastRevealedIslandsRevision = revealedIslandsRevision;
    this.pendingActivationKeys.clear();
  }

  destroy(): void {
    this.destroyViews();
    this.lastWorld = undefined;
    this.lastKnowledgeVersion = -1;
    this.lastVisibilityVersion = -1;
    this.lastRevealedIslandsRevision = -1;
    this.activeEntries.clear();
    this.pendingActivationKeys.clear();
    this.chunkCapacity = 0;
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
    this.totalTextureAllocations++;
    this.peakActiveTextures = Math.max(this.peakActiveTextures, this.views.size);
    this.assertResourceCap();
    return view;
  }

  private destroyViews(): void {
    for (const key of [...this.views.keys()]) this.destroyView(key);
  }

  private destroyView(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    view.image.destroy();
    if (this.scene.textures.exists(view.textureKey)) this.scene.textures.remove(view.textureKey);
    this.views.delete(key);
    this.pendingActivationKeys.delete(key);
    this.totalTextureReleases++;
  }

  private prepareWorld(world: WorldGrid): boolean {
    if (this.lastWorld === world) return false;
    this.destroyViews();
    this.observedRevisions = new WeakMap();
    this.lastKnowledgeVersion = -1;
    this.lastVisibilityVersion = -1;
    this.lastRevealedIslandsRevision = -1;
    this.lastWorld = world;
    return true;
  }

  private presentationChunks(world: WorldGrid): readonly WorldChunk[] {
    const chunks: WorldChunk[] = [];
    for (const entry of this.activeEntries.values()) {
      const chunk = world.getChunk(entry.coordinate.x, entry.coordinate.y);
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  }

  private sampledChunks(world: WorldGrid, activeChunks: readonly WorldChunk[]): readonly WorldChunk[] {
    const sampled = new Map<string, WorldChunk>();
    const chunkRadius = Math.ceil(MASK_PADDING_TILES / world.chunkSize);
    for (const active of activeChunks) {
      for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
        for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
          const chunk = world.getChunk(active.chunkX + dx, active.chunkY + dy);
          if (chunk) sampled.set(this.chunkKey(chunk), chunk);
        }
      }
    }
    return [...sampled.values()];
  }

  private assertResourceCap(): void {
    if (this.views.size > this.chunkCapacity) {
      throw new Error(`Knowledge overlay texture cap exceeded: ${this.views.size}/${this.chunkCapacity}`);
    }
  }

  private chunkKey(chunk: WorldChunk): string {
    return `${chunk.chunkX},${chunk.chunkY}`;
  }

  private renderChunk(
    world: WorldGrid,
    chunk: WorldChunk,
    seed: number,
    revealedIslandIds: ReadonlySet<number>,
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
        if (isExactIslandTileRevealed(world.getIslandId(worldX, worldY), revealedIslandIds)) continue;

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

    // Filtering softens ordinary fog boundaries, but a completed island
    // dossier owns an exact generated footprint. Clear those pixels after
    // the blur so fog from adjacent water cannot bleed back over the island.
    for (let localY = -padding; localY < chunk.size + padding; localY++) {
      for (let localX = -padding; localX < chunk.size + padding; localX++) {
        const worldX = chunk.chunkX * chunk.size + localX;
        const worldY = chunk.chunkY * chunk.size + localY;
        if (
          !world.inBounds(worldX, worldY)
          || !isExactIslandTileRevealed(world.getIslandId(worldX, worldY), revealedIslandIds)
        ) continue;
        filteredContext.clearRect(
          (localX + padding) * MASK_SCALE,
          (localY + padding) * MASK_SCALE,
          MASK_SCALE,
          MASK_SCALE,
        );
      }
    }

    targetContext.clearRect(0, 0, texture.width, texture.height);
    targetContext.drawImage(this.filtered, 0, 0);
  }
}
