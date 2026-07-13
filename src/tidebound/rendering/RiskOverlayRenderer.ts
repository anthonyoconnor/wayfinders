import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { DebugVisibilityState } from "../core/GameSimulation";
import type { ForwardRangeResult } from "../exploration/ForwardRangeSystem";
import { ReturnRiskLevel, type ReturnPathResult } from "../exploration/ReturnPathSystem";
import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";
import { addCardinalChunkDependents } from "./OverlayChunkInvalidation";

interface OverlayChunkView {
  forwardTexture: Phaser.Textures.CanvasTexture;
  forwardImage: Phaser.GameObjects.Image;
  forwardKey: string;
  returnTexture: Phaser.Textures.CanvasTexture;
  returnImage: Phaser.GameObjects.Image;
  returnKey: string;
}

const OVERLAY_SCALE = 6;
const FORWARD_DASH_PERIOD = 4;
const FORWARD_DASH_LENGTH = 2;

/**
 * Renders cost-grid results into independently uploaded chunk textures. The
 * previous implementation refreshed two world-sized canvases for every budget
 * threshold change. This version compares only sparse range/risk/visibility
 * candidates, redraws only affected chunks, and lets Phaser cull chunk images.
 */
export class RiskOverlayRenderer {
  private readonly views = new Map<string, OverlayChunkView>();
  private readonly keyPrefix: string;
  private lastWorld?: WorldGrid;
  private lastRevision = -1;
  private lastVisibilityVersion = -1;
  private lastSignature = "";
  private forwardPresented = new Uint8Array(0);
  private forwardReachable = new Uint8Array(0);
  private returnPresented = new Uint8Array(0);
  private lastForward?: ForwardRangeResult;
  private lastReturning?: ReturnPathResult;
  private lastForwardPresentationCandidates: readonly number[] = [];
  private lastForwardCandidates: readonly number[] = [];
  private lastForwardReachableCount = -1;
  private lastReturnCorridor: readonly number[] = [];
  private lastVisibleIndices: readonly number[] = [];
  private lastForwardVisible?: boolean;
  private lastReturnVisible?: boolean;

  constructor(private readonly scene: Phaser.Scene) {
    this.keyPrefix = `${String(scene.sys.settings.key)}-risk`;
  }

  sync(
    world: WorldGrid,
    forward: ForwardRangeResult,
    returning: ReturnPathResult,
    debug: Readonly<DebugVisibilityState>,
    revision: number,
    force = false,
  ): void {
    const worldChanged = this.lastWorld !== world;
    if (worldChanged) {
      this.destroyViews();
      this.forwardPresented = new Uint8Array(world.tileCount);
      this.forwardReachable = new Uint8Array(world.tileCount);
      this.returnPresented = new Uint8Array(world.tileCount);
      this.lastWorld = world;
      this.lastRevision = -1;
      this.lastVisibilityVersion = -1;
      this.lastSignature = "";
      this.lastForward = undefined;
      this.lastReturning = undefined;
      this.lastForwardPresentationCandidates = [];
      this.lastForwardCandidates = [];
      this.lastForwardReachableCount = -1;
      this.lastReturnCorridor = [];
      this.lastVisibleIndices = [];
      this.lastForwardVisible = undefined;
      this.lastReturnVisible = undefined;
    }

    const chunks = world.getLoadedChunks();
    const signature = `${prototypeConfig.overlays.forwardOverlayOpacity}:`
      + `${prototypeConfig.overlays.returnOverlayOpacity}`;
    const styleChanged = signature !== this.lastSignature;
    const visibilityChanged = world.visibilityVersion !== this.lastVisibilityVersion;
    const dataChanged = revision !== this.lastRevision
      || forward !== this.lastForward
      || returning !== this.lastReturning;
    const logicalForwardChanged = forward !== this.lastForward
      || forward.reachableCount !== this.lastForwardReachableCount;
    const chunksChanged = chunks.length !== this.views.size;
    const debugChanged = debug.forwardRange !== this.lastForwardVisible
      || debug.returnViability !== this.lastReturnVisible;
    if (!force && !worldChanged && !styleChanged && !visibilityChanged && !dataChanged && !chunksChanged && !debugChanged) {
      return;
    }

    const newChunks: WorldChunk[] = [];
    if (worldChanged || chunksChanged) {
      for (const chunk of chunks) {
        if (!this.views.has(this.chunkKey(chunk))) newChunks.push(chunk);
        this.getOrCreateChunkView(chunk);
      }
    }
    if (worldChanged || chunksChanged || debugChanged) {
      for (const view of this.views.values()) {
        view.forwardImage.setVisible(debug.forwardRange);
        view.returnImage.setVisible(debug.returnViability);
      }
    }

    const redrawAll = force || worldChanged || styleChanged;
    const dirtyForward = new Set<WorldChunk>();
    const dirtyReturn = new Set<WorldChunk>();

    if (force || worldChanged || dataChanged || chunksChanged) {
      if (force || worldChanged || logicalForwardChanged) {
        this.updateForwardReachableIndices(world, forward, this.lastForwardCandidates, dirtyForward);
        this.updateForwardReachableIndices(world, forward, forward.candidateIndices, dirtyForward);
      }
      this.updateForwardIndices(world, forward, this.lastForwardPresentationCandidates, dirtyForward);
      this.updateForwardIndices(world, forward, forward.presentationCandidateIndices, dirtyForward);
      this.updateReturnIndices(world, returning, this.lastReturnCorridor, dirtyReturn);
      this.updateReturnIndices(world, returning, returning.corridorIndices, dirtyReturn);
    } else if (visibilityChanged) {
      this.updateForwardIndices(world, forward, this.lastVisibleIndices, dirtyForward);
      this.updateForwardIndices(world, forward, world.getVisibleIndices(), dirtyForward);
      this.updateReturnIndices(world, returning, this.lastVisibleIndices, dirtyReturn);
      this.updateReturnIndices(world, returning, world.getVisibleIndices(), dirtyReturn);
    }

    if (redrawAll) {
      for (const chunk of chunks) {
        dirtyForward.add(chunk);
        dirtyReturn.add(chunk);
      }
    } else if (chunksChanged) {
      // Chunks are append-only. Any view without prior presented pixels must be
      // uploaded once even when the simulation data itself did not change.
      for (const chunk of newChunks) {
        dirtyForward.add(chunk);
        dirtyReturn.add(chunk);
      }
    }

    for (const chunk of dirtyForward) {
      const view = this.views.get(this.chunkKey(chunk));
      if (!view) continue;
      this.renderForwardChunk(world, forward, chunk, view.forwardTexture);
      view.forwardTexture.refresh();
    }
    for (const chunk of dirtyReturn) {
      const view = this.views.get(this.chunkKey(chunk));
      if (!view) continue;
      this.renderReturnChunk(world, chunk, view.returnTexture);
      view.returnTexture.refresh();
    }

    this.lastRevision = revision;
    this.lastVisibilityVersion = world.visibilityVersion;
    this.lastSignature = signature;
    this.lastForward = forward;
    this.lastReturning = returning;
    this.lastForwardCandidates = forward.candidateIndices;
    this.lastForwardReachableCount = forward.reachableCount;
    this.lastForwardPresentationCandidates = forward.presentationCandidateIndices;
    this.lastReturnCorridor = returning.corridorIndices;
    this.lastVisibleIndices = [...world.getVisibleIndices()];
    this.lastForwardVisible = debug.forwardRange;
    this.lastReturnVisible = debug.returnViability;
  }

  destroy(): void {
    this.destroyViews();
    this.lastWorld = undefined;
    this.forwardPresented = new Uint8Array(0);
    this.forwardReachable = new Uint8Array(0);
    this.returnPresented = new Uint8Array(0);
    this.lastForward = undefined;
    this.lastReturning = undefined;
    this.lastForwardPresentationCandidates = [];
    this.lastForwardCandidates = [];
    this.lastForwardReachableCount = -1;
    this.lastReturnCorridor = [];
    this.lastVisibleIndices = [];
    this.lastForwardVisible = undefined;
    this.lastReturnVisible = undefined;
  }

  private updateForwardIndices(
    world: WorldGrid,
    forward: ForwardRangeResult,
    indices: Iterable<number>,
    dirtyChunks: Set<WorldChunk>,
  ): void {
    for (const index of indices) this.updateForwardIndex(world, forward, index, dirtyChunks);
  }

  private updateForwardReachableIndices(
    world: WorldGrid,
    forward: ForwardRangeResult,
    indices: Iterable<number>,
    dirtyChunks: Set<WorldChunk>,
  ): void {
    for (const index of indices) {
      const next = forward.mask[index] !== 0 ? 1 : 0;
      if (this.forwardReachable[index] === next) continue;
      this.forwardReachable[index] = next;
      addCardinalChunkDependents(world, index, dirtyChunks);
    }
  }

  private updateReturnIndices(
    world: WorldGrid,
    returning: ReturnPathResult,
    indices: Iterable<number>,
    dirtyChunks: Set<WorldChunk>,
  ): void {
    for (const index of indices) this.updateReturnIndex(world, returning, index, dirtyChunks);
  }

  private updateForwardIndex(
    world: WorldGrid,
    forward: ForwardRangeResult,
    index: number,
    dirtyChunks: Set<WorldChunk>,
  ): void {
    const next = forward.presentationMask[index] !== 0 && !world.isVisibleNowAtIndex(index) ? 1 : 0;
    if (this.forwardPresented[index] === next) return;
    this.forwardPresented[index] = next;
    addCardinalChunkDependents(world, index, dirtyChunks);
  }

  private updateReturnIndex(
    world: WorldGrid,
    returning: ReturnPathResult,
    index: number,
    dirtyChunks: Set<WorldChunk>,
  ): void {
    const next = world.isVisibleNowAtIndex(index) ? ReturnRiskLevel.Hidden : returning.risk[index];
    if (this.returnPresented[index] === next) return;
    this.returnPresented[index] = next;
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const chunk = world.getChunkAt(x, y, false);
    if (chunk) dirtyChunks.add(chunk);
  }

  private getOrCreateChunkView(chunk: WorldChunk): OverlayChunkView {
    const key = this.chunkKey(chunk);
    const existing = this.views.get(key);
    if (existing) return existing;

    const texturePixels = chunk.size * OVERLAY_SCALE;
    const displayPixels = chunk.size * prototypeConfig.navigation.tileSize;
    const worldX = chunk.chunkX * displayPixels;
    const worldY = chunk.chunkY * displayPixels;
    const forwardKey = `${this.keyPrefix}-forward-${chunk.chunkX}-${chunk.chunkY}`;
    const returnKey = `${this.keyPrefix}-return-${chunk.chunkX}-${chunk.chunkY}`;
    const forwardTexture = this.scene.textures.createCanvas(forwardKey, texturePixels, texturePixels);
    const returnTexture = this.scene.textures.createCanvas(returnKey, texturePixels, texturePixels);
    if (!forwardTexture || !returnTexture) throw new Error("Could not create range-overlay chunk textures");
    forwardTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    returnTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    const forwardImage = this.scene.add.image(worldX, worldY, forwardKey)
      .setOrigin(0)
      .setDisplaySize(displayPixels, displayPixels)
      .setDepth(37);
    const returnImage = this.scene.add.image(worldX, worldY, returnKey)
      .setOrigin(0)
      .setDisplaySize(displayPixels, displayPixels)
      .setDepth(38);
    const view = {
      forwardTexture,
      forwardImage,
      forwardKey,
      returnTexture,
      returnImage,
      returnKey,
    };
    this.views.set(key, view);
    return view;
  }

  private destroyViews(): void {
    for (const view of this.views.values()) {
      view.forwardImage.destroy();
      view.returnImage.destroy();
      if (this.scene.textures.exists(view.forwardKey)) this.scene.textures.remove(view.forwardKey);
      if (this.scene.textures.exists(view.returnKey)) this.scene.textures.remove(view.returnKey);
    }
    this.views.clear();
  }

  private renderForwardChunk(
    world: WorldGrid,
    forward: ForwardRangeResult,
    chunk: WorldChunk,
    texture: Phaser.Textures.CanvasTexture,
  ): void {
    const context = texture.getContext();
    context.clearRect(0, 0, texture.width, texture.height);
    const opacity = prototypeConfig.overlays.forwardOverlayOpacity;
    context.fillStyle = `rgba(226, 230, 210, ${opacity})`;

    for (let localY = 0; localY < chunk.size; localY++) {
      const y = chunk.chunkY * chunk.size + localY;
      if (y >= world.height) break;
      for (let localX = 0; localX < chunk.size; localX++) {
        const x = chunk.chunkX * chunk.size + localX;
        if (x >= world.width) break;
        const index = y * world.width + x;
        if (!this.forwardPresented[index]) continue;
        const px = localX * OVERLAY_SCALE;
        const py = localY * OVERLAY_SCALE;
        if (y === 0 || forward.mask[index - world.width] === 0) {
          this.drawHorizontalForwardSegment(context, px, py, x * OVERLAY_SCALE);
        }
        if (y + 1 >= world.height || forward.mask[index + world.width] === 0) {
          this.drawHorizontalForwardSegment(
            context,
            px,
            py + OVERLAY_SCALE - 1,
            x * OVERLAY_SCALE,
          );
        }
        if (x === 0 || forward.mask[index - 1] === 0) {
          this.drawVerticalForwardSegment(context, px, py, y * OVERLAY_SCALE);
        }
        if (x + 1 >= world.width || forward.mask[index + 1] === 0) {
          this.drawVerticalForwardSegment(
            context,
            px + OVERLAY_SCALE - 1,
            py,
            y * OVERLAY_SCALE,
          );
        }
      }
    }
  }

  private drawHorizontalForwardSegment(
    context: CanvasRenderingContext2D,
    px: number,
    py: number,
    worldPixelX: number,
  ): void {
    for (let offset = 0; offset < OVERLAY_SCALE; offset++) {
      if ((worldPixelX + offset) % FORWARD_DASH_PERIOD < FORWARD_DASH_LENGTH) {
        context.fillRect(px + offset, py, 1, 1);
      }
    }
  }

  private drawVerticalForwardSegment(
    context: CanvasRenderingContext2D,
    px: number,
    py: number,
    worldPixelY: number,
  ): void {
    for (let offset = 0; offset < OVERLAY_SCALE; offset++) {
      if ((worldPixelY + offset) % FORWARD_DASH_PERIOD < FORWARD_DASH_LENGTH) {
        context.fillRect(px, py + offset, 1, 1);
      }
    }
  }

  private renderReturnChunk(
    world: WorldGrid,
    chunk: WorldChunk,
    texture: Phaser.Textures.CanvasTexture,
  ): void {
    const context = texture.getContext();
    context.clearRect(0, 0, texture.width, texture.height);
    const opacity = prototypeConfig.overlays.returnOverlayOpacity;

    for (let localY = 0; localY < chunk.size; localY++) {
      const y = chunk.chunkY * chunk.size + localY;
      if (y >= world.height) break;
      for (let localX = 0; localX < chunk.size; localX++) {
        const x = chunk.chunkX * chunk.size + localX;
        if (x >= world.width) break;
        const index = y * world.width + x;
        const level = this.returnPresented[index] as ReturnRiskLevel;
        if (level === ReturnRiskLevel.Hidden) continue;
        const px = localX * OVERLAY_SCALE;
        const py = localY * OVERLAY_SCALE;
        context.fillStyle = this.riskColor(level, opacity);
        context.fillRect(px, py, OVERLAY_SCALE, OVERLAY_SCALE);
        this.drawRiskPattern(context, level, px, py, opacity);
      }
    }
  }

  private riskColor(level: ReturnRiskLevel, opacity: number): string {
    switch (level) {
      case ReturnRiskLevel.Comfortable: return `rgba(222, 195, 82, ${opacity * 0.7})`;
      case ReturnRiskLevel.Warning: return `rgba(238, 188, 62, ${opacity})`;
      case ReturnRiskLevel.Critical: return `rgba(238, 105, 29, ${Math.min(0.9, opacity * 1.25)})`;
      case ReturnRiskLevel.Impossible: return `rgba(196, 38, 36, ${Math.min(0.95, opacity * 1.6)})`;
      default: return "rgba(0, 0, 0, 0)";
    }
  }

  private drawRiskPattern(
    context: CanvasRenderingContext2D,
    level: ReturnRiskLevel,
    px: number,
    py: number,
    opacity: number,
  ): void {
    if (level === ReturnRiskLevel.Comfortable) return;
    context.save();
    context.strokeStyle = `rgba(28, 24, 18, ${Math.min(0.82, opacity * 2.2)})`;
    context.lineWidth = 0.75;
    context.beginPath();
    context.moveTo(px + 0.75, py + OVERLAY_SCALE - 0.75);
    context.lineTo(px + OVERLAY_SCALE - 0.75, py + 0.75);
    if (level >= ReturnRiskLevel.Critical) {
      context.moveTo(px - 1, py + OVERLAY_SCALE - 0.75);
      context.lineTo(px + OVERLAY_SCALE * 0.5, py + 0.75);
    }
    if (level === ReturnRiskLevel.Impossible) {
      context.moveTo(px + 0.75, py + 0.75);
      context.lineTo(px + OVERLAY_SCALE - 0.75, py + OVERLAY_SCALE - 0.75);
    }
    context.stroke();
    context.restore();
  }

  private chunkKey(chunk: WorldChunk): string {
    return `${chunk.chunkX},${chunk.chunkY}`;
  }
}
