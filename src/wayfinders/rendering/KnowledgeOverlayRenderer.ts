import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import { seededValue } from "../world/WorldGenerator";
import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";
import { KnowledgeState } from "../world/TileData";
import { addPaddedChunkNeighbours } from "./OverlayChunkInvalidation";
import { createCameraCulledImage } from "./CameraCulledImage";
import {
  isExactIslandTileRevealed,
  isKnowledgeOverlayFullyClearAtTile,
} from "./KnowledgeClearCoverage";
import type { ActiveChunkDelta, ActiveChunkEntry } from "./activation";

export { isExactIslandTileRevealed } from "./KnowledgeClearCoverage";

interface MaskChunkResource {
  texture: Phaser.Textures.CanvasTexture;
  textureKey: string;
  readonly widthTiles: number;
  readonly heightTiles: number;
}

interface MaskChunkView {
  readonly image: Phaser.GameObjects.Image;
  readonly canonicalKey: string;
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

/**
 * Reusable, bilinear knowledge mask. Each chunk owns a small padded texture;
 * changes invalidate that chunk and its neighbours so the sampled padding at
 * chunk boundaries never becomes stale.
 */
export class KnowledgeOverlayRenderer {
  private readonly views = new Map<string, MaskChunkView>();
  private readonly resources = new Map<string, MaskChunkResource>();
  private readonly activeEntries = new Map<string, Readonly<ActiveChunkEntry>>();
  private readonly pendingResourceKeys = new Set<string>();
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
  private visible = true;

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

    const desiredKeys = new Set(delta.active.map(({ viewKey }) => viewKey));
    const desiredResourceKeys = new Set(delta.active.map(({ canonicalChunk }) => (
      `${canonicalChunk.x},${canonicalChunk.y}`
    )));
    for (const { viewKey } of delta.deactivated) this.destroyView(viewKey);
    for (const key of [...this.views.keys()]) {
      if (!desiredKeys.has(key)) this.destroyView(key);
    }
    // An image-offset transaction can replace every view key while retaining
    // the same canonical chunks. Reconcile resources against the complete
    // destination before creating aliases so those canonical textures survive
    // rebases without allocation or redraw churn.
    this.releaseResourcesNotIn(desiredResourceKeys);

    this.activeEntries.clear();
    for (const entry of delta.active) {
      this.activeEntries.set(entry.viewKey, entry);
      const chunk = world.getChunk(entry.canonicalChunk.x, entry.canonicalChunk.y);
      if (!chunk) continue;
      const resource = this.getOrCreateChunkResource(world, chunk);
      if (!this.views.has(entry.viewKey)) this.createImageView(chunk, entry, resource);
    }
    this.releaseUnreferencedResources();
    this.assertResourceCap();
  }

  getResourceTelemetry(): Readonly<KnowledgeOverlayResourceTelemetry> {
    let estimatedTextureBytes = 0;
    for (const { texture } of this.resources.values()) {
      estimatedTextureBytes += texture.width * texture.height * 4;
    }
    return Object.freeze({
      chunkCapacity: this.chunkCapacity,
      activeChunks: this.activeEntries.size,
      activeTextures: this.resources.size,
      activeSprites: this.views.size,
      estimatedTextureBytes,
      peakActiveTextures: this.peakActiveTextures,
      totalTextureAllocations: this.totalTextureAllocations,
      totalTextureReleases: this.totalTextureReleases,
    });
  }

  setVisible(visible: boolean): boolean {
    if (this.visible === visible) return false;
    this.visible = visible;
    for (const { image } of this.views.values()) image.setVisible(visible);
    return true;
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
    const chunksChanged = this.pendingResourceKeys.size > 0;
    if (!redrawAll && !knowledgeChanged && !visibilityChanged && !revealedIslandsChanged && !chunksChanged) return;

    const dirtyChunks = new Set<WorldChunk>();

    for (const chunk of chunks) {
      this.getOrCreateChunkResource(world, chunk);
      if (redrawAll || revealedIslandsChanged || this.pendingResourceKeys.has(this.chunkKey(chunk))) {
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
      const resource = this.resources.get(this.chunkKey(chunk));
      if (!resource) continue;
      this.renderChunk(world, chunk, seed, revealedIslandIds, resource);
      resource.texture.refresh();
    }

    this.lastKnowledgeVersion = world.knowledgeVersion;
    this.lastVisibilityVersion = world.visibilityVersion;
    this.lastRevealedIslandsRevision = revealedIslandsRevision;
    this.pendingResourceKeys.clear();
  }

  destroy(): void {
    this.destroyViews();
    this.releaseUnreferencedResources();
    this.lastWorld = undefined;
    this.lastKnowledgeVersion = -1;
    this.lastVisibilityVersion = -1;
    this.lastRevealedIslandsRevision = -1;
    this.activeEntries.clear();
    this.pendingResourceKeys.clear();
    this.chunkCapacity = 0;
  }

  private getOrCreateChunkResource(world: WorldGrid, chunk: WorldChunk): MaskChunkResource {
    const key = `${chunk.chunkX},${chunk.chunkY}`;
    const existing = this.resources.get(key);
    if (existing) return existing;

    const textureKey = `${this.textureKeyPrefix}-${chunk.chunkX}-${chunk.chunkY}`;
    const paddingPixels = MASK_PADDING_TILES * MASK_SCALE;
    const widthTiles = Math.min(chunk.size, world.width - chunk.chunkX * chunk.size);
    const heightTiles = Math.min(chunk.size, world.height - chunk.chunkY * chunk.size);
    const widthPixels = widthTiles * MASK_SCALE;
    const heightPixels = heightTiles * MASK_SCALE;
    const texture = this.scene.textures.createCanvas(
      textureKey,
      widthPixels + paddingPixels * 2,
      heightPixels + paddingPixels * 2,
    );
    if (!texture) throw new Error(`Could not create knowledge mask texture ${textureKey}`);
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    texture.add("chunk", 0, paddingPixels, paddingPixels, widthPixels, heightPixels);
    const resource = { texture, textureKey, widthTiles, heightTiles };
    this.resources.set(key, resource);
    this.pendingResourceKeys.add(key);
    this.totalTextureAllocations++;
    this.peakActiveTextures = Math.max(this.peakActiveTextures, this.resources.size);
    return resource;
  }

  private createImageView(
    chunk: WorldChunk,
    entry: Readonly<ActiveChunkEntry>,
    resource: Readonly<MaskChunkResource>,
  ): MaskChunkView {
    const tileSize = prototypeConfig.navigation.tileSize;
    const worldX = chunk.chunkX * chunk.size * tileSize + entry.imageOffset.x;
    const worldY = chunk.chunkY * chunk.size * tileSize + entry.imageOffset.y;
    const displayWidth = resource.widthTiles * tileSize;
    const displayHeight = resource.heightTiles * tileSize;
    const image = createCameraCulledImage(
      this.scene,
      worldX,
      worldY,
      resource.textureKey,
      "chunk",
      {
        left: worldX,
        right: worldX + displayWidth,
        top: worldY,
        bottom: worldY + displayHeight,
      },
    ).setOrigin(0)
      // The texture frame is surrounded by sampled neighbour padding, so
      // linear filtering can meet adjacent quads without an overlap stripe.
      .setDisplaySize(displayWidth, displayHeight)
      .setDepth(35)
      .setVisible(this.visible);
    const view = { image, canonicalKey: this.chunkKey(chunk) };
    this.views.set(entry.viewKey, view);
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
    this.views.delete(key);
  }

  private releaseUnreferencedResources(): void {
    const referenced = new Set([...this.views.values()].map(({ canonicalKey }) => canonicalKey));
    this.releaseResourcesNotIn(referenced);
  }

  private releaseResourcesNotIn(referenced: ReadonlySet<string>): void {
    for (const [key, resource] of [...this.resources]) {
      if (referenced.has(key)) continue;
      if (this.scene.textures.exists(resource.textureKey)) this.scene.textures.remove(resource.textureKey);
      this.resources.delete(key);
      this.pendingResourceKeys.delete(key);
      this.totalTextureReleases++;
    }
  }

  private prepareWorld(world: WorldGrid): boolean {
    if (this.lastWorld === world) return false;
    this.destroyViews();
    this.releaseUnreferencedResources();
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
      const chunk = world.getChunk(entry.canonicalChunk.x, entry.canonicalChunk.y);
      if (chunk && !chunks.includes(chunk)) chunks.push(chunk);
    }
    return chunks;
  }

  private sampledChunks(world: WorldGrid, activeChunks: readonly WorldChunk[]): readonly WorldChunk[] {
    const sampled = new Set<WorldChunk>();
    for (const active of activeChunks) {
      addPaddedChunkNeighbours(world, active, MASK_PADDING_TILES, sampled);
    }
    return [...sampled];
  }

  private assertResourceCap(): void {
    if (this.views.size > this.chunkCapacity || this.resources.size > this.chunkCapacity) {
      throw new Error(
        `Knowledge overlay resource cap exceeded: ${this.views.size} views, ${this.resources.size} textures/${this.chunkCapacity}`,
      );
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
    resource: Readonly<MaskChunkResource>,
  ): void {
    const { texture } = resource;
    const scratchContext = this.scratch.getContext("2d");
    const filteredContext = this.filtered.getContext("2d");
    const targetContext = texture.getContext();
    if (!scratchContext || !filteredContext || !targetContext) throw new Error("Canvas masks require a 2D context");

    scratchContext.clearRect(0, 0, this.scratch.width, this.scratch.height);
    const padding = MASK_PADDING_TILES;
    for (let localY = -padding; localY < resource.heightTiles + padding; localY++) {
      for (let localX = -padding; localX < resource.widthTiles + padding; localX++) {
        const worldX = chunk.chunkX * chunk.size + localX;
        const worldY = chunk.chunkY * chunk.size + localY;
        const pixelX = (localX + padding) * MASK_SCALE;
        const pixelY = (localY + padding) * MASK_SCALE;

        const canonical = world.topology.canonicalizeTile(worldX, worldY);
        if (!canonical) {
          scratchContext.fillStyle = "rgba(1, 7, 10, 1)";
          scratchContext.fillRect(pixelX, pixelY, MASK_SCALE, MASK_SCALE);
          continue;
        }
        if (isKnowledgeOverlayFullyClearAtTile(world, canonical.x, canonical.y, revealedIslandIds)) continue;

        const noise = (seededValue(seed + 809, canonical.x, canonical.y) - 0.5)
          * prototypeConfig.overlays.fogNoise;
        if (world.getKnowledge(canonical.x, canonical.y) === KnowledgeState.Unknown) {
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
    for (let localY = -padding; localY < resource.heightTiles + padding; localY++) {
      for (let localX = -padding; localX < resource.widthTiles + padding; localX++) {
        const worldX = chunk.chunkX * chunk.size + localX;
        const worldY = chunk.chunkY * chunk.size + localY;
        const canonical = world.topology.canonicalizeTile(worldX, worldY);
        if (
          !canonical
          || !isExactIslandTileRevealed(
            world.getIslandId(canonical.x, canonical.y),
            revealedIslandIds,
          )
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
