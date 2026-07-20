import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import type { OverlayVisibilitySettings } from "../config/gameSettings";
import type { ForwardRangeResult } from "../exploration/ForwardRangeSystem";
import { ReturnRiskLevel, type ReturnPathResult } from "../exploration/ReturnPathSystem";
import type { WorldChunk } from "../world/WorldChunk";
import type { WorldGrid } from "../world/WorldGrid";
import { addCardinalChunkDependents } from "./OverlayChunkInvalidation";
import { createCameraCulledImage } from "./CameraCulledImage";
import {
  buildVoyageSenseThread,
  type VoyageSenseThreadGeometry,
  type VoyageSenseThreadSegment,
} from "./VoyageSenseThread";
import type { ActiveChunkDelta, ActiveChunkEntry } from "./activation";

interface OverlayChunkResource {
  forwardTexture: Phaser.Textures.CanvasTexture;
  forwardKey: string;
  returnTexture: Phaser.Textures.CanvasTexture;
  returnKey: string;
  readonly widthTiles: number;
  readonly heightTiles: number;
}

interface OverlayChunkView {
  forwardImage: Phaser.GameObjects.Image;
  returnImage: Phaser.GameObjects.Image;
  readonly canonicalKey: string;
}

/** Lightweight counters for renderer-owned decoded presentation resources. */
export interface RiskOverlayResourceTelemetry {
  readonly chunkCapacity: number;
  readonly activeChunks: number;
  readonly activeTextures: number;
  readonly activeSprites: number;
  /** Canvas backing-store estimate; GPU/framework overhead is intentionally excluded. */
  readonly estimatedTextureBytes: number;
  readonly peakActiveTextures: number;
  readonly totalTextureAllocations: number;
  readonly totalTextureReleases: number;
  readonly returnThreadSegments: number;
  readonly returnThreadChunkBuckets: number;
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
  private readonly resources = new Map<string, OverlayChunkResource>();
  private readonly activeEntries = new Map<string, Readonly<ActiveChunkEntry>>();
  private readonly pendingResourceKeys = new Set<string>();
  private readonly keyPrefix: string;
  private lastWorld?: WorldGrid;
  private lastRevision = -1;
  private lastVisibilityVersion = -1;
  private lastSignature = "";
  private forwardPresented = new Uint8Array(0);
  private forwardReachable = new Uint8Array(0);
  private lastForward?: ForwardRangeResult;
  private lastReturning?: ReturnPathResult;
  private lastForwardPresentationCandidates: readonly number[] = [];
  private lastForwardCandidates: readonly number[] = [];
  private lastForwardLogicalRevision = -1;
  private lastReturnEdges?: ReturnPathResult["pathEdges"];
  private lastReturnRiskLevel = ReturnRiskLevel.Hidden;
  private returnThread: VoyageSenseThreadGeometry = {
    segments: [],
    segmentsByChunk: new Map(),
  };
  private lastVisibleIndices: readonly number[] = [];
  private lastForwardVisible?: boolean;
  private lastReturnVisible?: boolean;
  private chunkCapacity = 0;
  private peakActiveTextures = 0;
  private totalTextureAllocations = 0;
  private totalTextureReleases = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.keyPrefix = `${String(scene.sys.settings.key)}-risk`;
  }

  /**
   * Applies the bounded presentation set before {@link sync}. Two canvas
   * textures and two sprites are owned per active chunk and are released as
   * soon as that chunk leaves the set.
   */
  applyActiveChunkDelta(world: WorldGrid, delta: Readonly<ActiveChunkDelta>): void {
    this.prepareWorld(world);
    this.chunkCapacity = delta.telemetry.capacity;
    if (delta.active.length > this.chunkCapacity) {
      throw new RangeError(
        `Risk overlay received ${delta.active.length} active chunks for capacity ${this.chunkCapacity}`,
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
    // Alias keys are presentation identities, not decoded-resource owners. A
    // whole-world rebase can replace every alias while retaining every
    // canonical chunk, so keep the destination owners alive through the swap.
    this.releaseResourcesNotIn(desiredResourceKeys);

    this.activeEntries.clear();
    for (const entry of delta.active) {
      this.activeEntries.set(entry.viewKey, entry);
      const chunk = world.getChunk(entry.canonicalChunk.x, entry.canonicalChunk.y);
      if (!chunk) continue;
      const resource = this.getOrCreateChunkResource(world, chunk);
      if (!this.views.has(entry.viewKey)) {
        const view = this.createImageView(chunk, entry, resource);
        if (this.lastForwardVisible !== undefined) view.forwardImage.setVisible(this.lastForwardVisible);
        if (this.lastReturnVisible !== undefined) view.returnImage.setVisible(this.lastReturnVisible);
      }
    }
    this.releaseUnreferencedResources();
    this.assertResourceCap();
  }

  getResourceTelemetry(): Readonly<RiskOverlayResourceTelemetry> {
    let estimatedTextureBytes = 0;
    for (const { forwardTexture, returnTexture } of this.resources.values()) {
      estimatedTextureBytes += (forwardTexture.width * forwardTexture.height
        + returnTexture.width * returnTexture.height) * 4;
    }
    const activeTextures = this.resources.size * 2;
    return Object.freeze({
      chunkCapacity: this.chunkCapacity,
      activeChunks: this.activeEntries.size,
      activeTextures,
      activeSprites: this.views.size * 2,
      estimatedTextureBytes,
      peakActiveTextures: this.peakActiveTextures,
      totalTextureAllocations: this.totalTextureAllocations,
      totalTextureReleases: this.totalTextureReleases,
      returnThreadSegments: this.returnThread.segments.length,
      returnThreadChunkBuckets: this.returnThread.segmentsByChunk.size,
    });
  }

  sync(
    world: WorldGrid,
    forward: ForwardRangeResult,
    returning: ReturnPathResult,
    visibility: Readonly<OverlayVisibilitySettings>,
    revision: number,
    force = false,
  ): void {
    if (this.chunkCapacity === 0) {
      throw new Error("Risk overlay requires an ActiveChunkSet delta before sync");
    }
    const worldChanged = this.prepareWorld(world);

    const signature = `${prototypeConfig.overlays.forwardOverlayOpacity}:`
      + `${prototypeConfig.overlays.returnOverlayOpacity}:`
      + `${prototypeConfig.overlays.returnThreadWidth}:`
      + `${prototypeConfig.overlays.returnThreadCurveRadius}`;
    const styleChanged = signature !== this.lastSignature;
    const visibilityChanged = world.visibilityVersion !== this.lastVisibilityVersion;
    const dataChanged = revision !== this.lastRevision
      || forward !== this.lastForward
      || returning !== this.lastReturning;
    const logicalForwardChanged = visibility.forwardRange && (
      forward !== this.lastForward
      || forward.logicalRevision !== this.lastForwardLogicalRevision
    );
    const returnGeometryChanged = worldChanged
      || styleChanged
      || returning !== this.lastReturning
      || returning.pathEdges !== this.lastReturnEdges;
    const returnChanged = returnGeometryChanged
      || returning.riskLevel !== this.lastReturnRiskLevel;
    const chunksChanged = this.pendingResourceKeys.size > 0;
    const overlayVisibilityChanged = visibility.forwardRange !== this.lastForwardVisible
      || visibility.returnViability !== this.lastReturnVisible;
    if (!force && !worldChanged && !styleChanged && !visibilityChanged && !dataChanged && !chunksChanged && !overlayVisibilityChanged) {
      return;
    }
    const chunks = this.presentationChunks(world);

    if (worldChanged || chunksChanged) {
      for (const chunk of chunks) {
        this.getOrCreateChunkResource(world, chunk);
      }
    }
    if (worldChanged || chunksChanged || overlayVisibilityChanged) {
      for (const view of this.views.values()) {
        view.forwardImage.setVisible(visibility.forwardRange);
        view.returnImage.setVisible(visibility.returnViability);
      }
    }

    const redrawAll = force || worldChanged || styleChanged;
    const dirtyForward = new Set<WorldChunk>();
    const dirtyReturn = new Set<WorldChunk>();

    if (returnGeometryChanged) {
      this.returnThread = buildVoyageSenseThread(
        world,
        returning.pathEdges,
        prototypeConfig.navigation.tileSize,
        prototypeConfig.overlays.returnThreadCurveRadius,
        prototypeConfig.overlays.returnThreadWidth,
      );
    }

    if (visibility.forwardRange && (force || worldChanged || dataChanged || chunksChanged)) {
      if (force || worldChanged || logicalForwardChanged) {
        this.updateForwardReachableIndices(world, forward, this.lastForwardCandidates, dirtyForward);
        this.updateForwardReachableIndices(world, forward, forward.candidateIndices, dirtyForward);
      }
      this.updateForwardIndices(world, forward, this.lastForwardPresentationCandidates, dirtyForward);
      this.updateForwardIndices(world, forward, forward.presentationCandidateIndices, dirtyForward);
    } else if (visibility.forwardRange && visibilityChanged) {
      this.updateForwardIndices(world, forward, this.lastVisibleIndices, dirtyForward);
      this.updateForwardIndices(world, forward, world.getVisibleIndices(), dirtyForward);
    }

    if (returnChanged) {
      for (const chunk of chunks) dirtyReturn.add(chunk);
    }

    if (redrawAll) {
      for (const chunk of chunks) {
        if (visibility.forwardRange) dirtyForward.add(chunk);
        dirtyReturn.add(chunk);
      }
    } else if (chunksChanged) {
      // Chunks are append-only. Any view without prior presented pixels must be
      // uploaded once even when the simulation data itself did not change.
      for (const key of this.pendingResourceKeys) {
        const viewChunk = this.chunkForCanonicalKey(world, key);
        if (!viewChunk) continue;
        if (visibility.forwardRange) dirtyForward.add(viewChunk);
        dirtyReturn.add(viewChunk);
      }
    }

    for (const chunk of dirtyForward) {
      const resource = this.resources.get(this.chunkKey(chunk));
      if (!resource) continue;
      this.renderForwardChunk(world, forward, chunk, resource);
      resource.forwardTexture.refresh();
    }
    for (const chunk of dirtyReturn) {
      const resource = this.resources.get(this.chunkKey(chunk));
      if (!resource) continue;
      this.renderReturnChunk(returning.riskLevel, chunk, resource.returnTexture);
      resource.returnTexture.refresh();
    }

    this.lastRevision = revision;
    this.lastVisibilityVersion = world.visibilityVersion;
    this.lastSignature = signature;
    this.lastForward = forward;
    // Guidance results use reusable buffers. Keep renderer-owned sparse
    // snapshots so a released result cannot lose the indices whose pixels
    // must be cleared when the next visible result publishes.
    if (visibility.forwardRange) {
      this.lastForwardCandidates = [...forward.candidateIndices];
      this.lastForwardLogicalRevision = forward.logicalRevision;
      this.lastForwardPresentationCandidates = [...forward.presentationCandidateIndices];
      this.lastVisibleIndices = [...world.getVisibleIndices()];
    }
    this.lastReturning = returning;
    this.lastReturnEdges = returning.pathEdges;
    this.lastReturnRiskLevel = returning.riskLevel;
    this.lastForwardVisible = visibility.forwardRange;
    this.lastReturnVisible = visibility.returnViability;
    this.pendingResourceKeys.clear();
  }

  destroy(): void {
    this.destroyViews();
    this.releaseUnreferencedResources();
    this.lastWorld = undefined;
    this.forwardPresented = new Uint8Array(0);
    this.forwardReachable = new Uint8Array(0);
    this.lastForward = undefined;
    this.lastReturning = undefined;
    this.lastForwardPresentationCandidates = [];
    this.lastForwardCandidates = [];
    this.lastForwardLogicalRevision = -1;
    this.lastReturnEdges = undefined;
    this.lastReturnRiskLevel = ReturnRiskLevel.Hidden;
    this.returnThread = { segments: [], segmentsByChunk: new Map() };
    this.lastVisibleIndices = [];
    this.lastForwardVisible = undefined;
    this.lastReturnVisible = undefined;
    this.activeEntries.clear();
    this.pendingResourceKeys.clear();
    this.chunkCapacity = 0;
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

  private getOrCreateChunkResource(world: WorldGrid, chunk: WorldChunk): OverlayChunkResource {
    const key = this.chunkKey(chunk);
    const existing = this.resources.get(key);
    if (existing) return existing;

    const widthTiles = Math.min(chunk.size, world.width - chunk.chunkX * chunk.size);
    const heightTiles = Math.min(chunk.size, world.height - chunk.chunkY * chunk.size);
    const forwardKey = `${this.keyPrefix}-forward-${chunk.chunkX}-${chunk.chunkY}`;
    const returnKey = `${this.keyPrefix}-return-${chunk.chunkX}-${chunk.chunkY}`;
    const forwardTexture = this.scene.textures.createCanvas(
      forwardKey,
      widthTiles * OVERLAY_SCALE,
      heightTiles * OVERLAY_SCALE,
    );
    const returnTexture = this.scene.textures.createCanvas(
      returnKey,
      widthTiles * OVERLAY_SCALE,
      heightTiles * OVERLAY_SCALE,
    );
    if (!forwardTexture || !returnTexture) throw new Error("Could not create range-overlay chunk textures");
    forwardTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    returnTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    const resource = {
      forwardTexture,
      forwardKey,
      returnTexture,
      returnKey,
      widthTiles,
      heightTiles,
    };
    this.resources.set(key, resource);
    this.pendingResourceKeys.add(key);
    this.totalTextureAllocations += 2;
    this.peakActiveTextures = Math.max(this.peakActiveTextures, this.resources.size * 2);
    return resource;
  }

  private createImageView(
    chunk: WorldChunk,
    entry: Readonly<ActiveChunkEntry>,
    resource: Readonly<OverlayChunkResource>,
  ): OverlayChunkView {
    const tileSize = prototypeConfig.navigation.tileSize;
    const worldX = chunk.chunkX * chunk.size * tileSize + entry.imageOffset.x;
    const worldY = chunk.chunkY * chunk.size * tileSize + entry.imageOffset.y;
    const displayWidth = resource.widthTiles * tileSize;
    const displayHeight = resource.heightTiles * tileSize;
    const worldBounds = {
      left: worldX,
      right: worldX + displayWidth,
      top: worldY,
      bottom: worldY + displayHeight,
    };
    const forwardImage = createCameraCulledImage(
      this.scene, worldX, worldY, resource.forwardKey, undefined, worldBounds,
    )
      .setOrigin(0)
      .setDisplaySize(displayWidth, displayHeight)
      .setDepth(37);
    const returnImage = createCameraCulledImage(
      this.scene, worldX, worldY, resource.returnKey, undefined, worldBounds,
    )
      .setOrigin(0)
      .setDisplaySize(displayWidth, displayHeight)
      .setDepth(38);
    const view = {
      forwardImage,
      returnImage,
      canonicalKey: this.chunkKey(chunk),
    };
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
    view.forwardImage.destroy();
    view.returnImage.destroy();
    this.views.delete(key);
  }

  private releaseUnreferencedResources(): void {
    const referenced = new Set([...this.views.values()].map(({ canonicalKey }) => canonicalKey));
    this.releaseResourcesNotIn(referenced);
  }

  private releaseResourcesNotIn(referenced: ReadonlySet<string>): void {
    for (const [key, resource] of [...this.resources]) {
      if (referenced.has(key)) continue;
      if (this.scene.textures.exists(resource.forwardKey)) this.scene.textures.remove(resource.forwardKey);
      if (this.scene.textures.exists(resource.returnKey)) this.scene.textures.remove(resource.returnKey);
      this.resources.delete(key);
      this.pendingResourceKeys.delete(key);
      this.totalTextureReleases += 2;
    }
  }

  private prepareWorld(world: WorldGrid): boolean {
    if (this.lastWorld === world) return false;
    this.destroyViews();
    this.releaseUnreferencedResources();
    this.forwardPresented = new Uint8Array(world.tileCount);
    this.forwardReachable = new Uint8Array(world.tileCount);
    this.lastWorld = world;
    this.lastRevision = -1;
    this.lastVisibilityVersion = -1;
    this.lastSignature = "";
    this.lastForward = undefined;
    this.lastReturning = undefined;
    this.lastForwardPresentationCandidates = [];
    this.lastForwardCandidates = [];
    this.lastForwardLogicalRevision = -1;
    this.lastReturnEdges = undefined;
    this.lastReturnRiskLevel = ReturnRiskLevel.Hidden;
    this.returnThread = { segments: [], segmentsByChunk: new Map() };
    this.lastVisibleIndices = [];
    this.lastForwardVisible = undefined;
    this.lastReturnVisible = undefined;
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

  private chunkForCanonicalKey(world: WorldGrid, key: string): WorldChunk | undefined {
    const [x, y] = key.split(",").map(Number);
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? world.getChunk(x!, y!) : undefined;
  }

  private assertResourceCap(): void {
    if (this.views.size > this.chunkCapacity || this.resources.size > this.chunkCapacity) {
      throw new Error(
        `Risk overlay resource cap exceeded: ${this.views.size} views, ${this.resources.size * 2} textures/${this.chunkCapacity}`,
      );
    }
  }

  private renderForwardChunk(
    world: WorldGrid,
    forward: ForwardRangeResult,
    chunk: WorldChunk,
    resource: Readonly<OverlayChunkResource>,
  ): void {
    const { forwardTexture: texture } = resource;
    const context = texture.getContext();
    context.clearRect(0, 0, texture.width, texture.height);
    const opacity = prototypeConfig.overlays.forwardOverlayOpacity;
    const horizontalDashPeriod = world.topology.wrapsX
      ? greatestCommonDivisor(FORWARD_DASH_PERIOD, world.width * OVERLAY_SCALE)
      : FORWARD_DASH_PERIOD;
    const verticalDashPeriod = world.topology.wrapsY
      ? greatestCommonDivisor(FORWARD_DASH_PERIOD, world.height * OVERLAY_SCALE)
      : FORWARD_DASH_PERIOD;
    context.fillStyle = `rgba(226, 230, 210, ${opacity})`;

    for (let localY = 0; localY < resource.heightTiles; localY++) {
      const y = chunk.chunkY * chunk.size + localY;
      if (y >= world.height) break;
      for (let localX = 0; localX < resource.widthTiles; localX++) {
        const x = chunk.chunkX * chunk.size + localX;
        if (x >= world.width) break;
        const index = y * world.width + x;
        if (!this.forwardPresented[index]) continue;
        const px = localX * OVERLAY_SCALE;
        const py = localY * OVERLAY_SCALE;
        if (!this.forwardNeighbourIsReachable(world, forward, x, y, 2)) {
          this.drawHorizontalForwardSegment(
            context, px, py, x * OVERLAY_SCALE, horizontalDashPeriod,
          );
        }
        if (!this.forwardNeighbourIsReachable(world, forward, x, y, 3)) {
          this.drawHorizontalForwardSegment(
            context,
            px,
            py + OVERLAY_SCALE - 1,
            x * OVERLAY_SCALE,
            horizontalDashPeriod,
          );
        }
        if (!this.forwardNeighbourIsReachable(world, forward, x, y, 0)) {
          this.drawVerticalForwardSegment(
            context, px, py, y * OVERLAY_SCALE, verticalDashPeriod,
          );
        }
        if (!this.forwardNeighbourIsReachable(world, forward, x, y, 1)) {
          this.drawVerticalForwardSegment(
            context,
            px + OVERLAY_SCALE - 1,
            py,
            y * OVERLAY_SCALE,
            verticalDashPeriod,
          );
        }
      }
    }
  }

  private forwardNeighbourIsReachable(
    world: WorldGrid,
    forward: ForwardRangeResult,
    x: number,
    y: number,
    direction: 0 | 1 | 2 | 3,
  ): boolean {
    const offset = direction === 0
      ? { x: -1, y: 0 }
      : direction === 1
        ? { x: 1, y: 0 }
        : direction === 2
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
    const neighbour = world.topology.canonicalizeTile(x + offset.x, y + offset.y);
    return neighbour !== undefined && forward.mask[world.index(neighbour.x, neighbour.y)] !== 0;
  }

  private drawHorizontalForwardSegment(
    context: CanvasRenderingContext2D,
    px: number,
    py: number,
    worldPixelX: number,
    dashPeriod: number,
  ): void {
    const dashLength = Math.min(FORWARD_DASH_LENGTH, dashPeriod);
    for (let offset = 0; offset < OVERLAY_SCALE; offset++) {
      if ((worldPixelX + offset) % dashPeriod < dashLength) {
        context.fillRect(px + offset, py, 1, 1);
      }
    }
  }

  private drawVerticalForwardSegment(
    context: CanvasRenderingContext2D,
    px: number,
    py: number,
    worldPixelY: number,
    dashPeriod: number,
  ): void {
    const dashLength = Math.min(FORWARD_DASH_LENGTH, dashPeriod);
    for (let offset = 0; offset < OVERLAY_SCALE; offset++) {
      if ((worldPixelY + offset) % dashPeriod < dashLength) {
        context.fillRect(px, py + offset, 1, 1);
      }
    }
  }

  private renderReturnChunk(
    level: ReturnRiskLevel,
    chunk: WorldChunk,
    texture: Phaser.Textures.CanvasTexture,
  ): void {
    const context = texture.getContext();
    context.clearRect(0, 0, texture.width, texture.height);
    if (level === ReturnRiskLevel.Hidden) return;

    const segments = this.returnThread.segmentsByChunk.get(this.chunkKey(chunk));
    if (!segments || segments.length === 0) return;

    const opacity = prototypeConfig.overlays.returnOverlayOpacity;
    const canvasScale = OVERLAY_SCALE / prototypeConfig.navigation.tileSize;
    const coreWidth = prototypeConfig.overlays.returnThreadWidth * canvasScale;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    this.strokeThread(context, segments, chunk, coreWidth * 2.2, this.riskColor(level, opacity * 0.18));
    this.strokeThread(context, segments, chunk, coreWidth, this.riskColor(level, opacity * 0.78));
    context.restore();
  }

  private riskColor(level: ReturnRiskLevel, opacity: number): string {
    switch (level) {
      case ReturnRiskLevel.Comfortable: return `rgba(91, 184, 116, ${opacity})`;
      case ReturnRiskLevel.Warning: return `rgba(226, 196, 74, ${opacity})`;
      case ReturnRiskLevel.Critical: return `rgba(238, 125, 36, ${opacity})`;
      case ReturnRiskLevel.Impossible: return `rgba(196, 38, 36, ${opacity})`;
      default: return "rgba(0, 0, 0, 0)";
    }
  }

  private strokeThread(
    context: CanvasRenderingContext2D,
    segments: readonly VoyageSenseThreadSegment[],
    chunk: WorldChunk,
    lineWidth: number,
    strokeStyle: string,
  ): void {
    const tileSize = prototypeConfig.navigation.tileSize;
    const canvasScale = OVERLAY_SCALE / tileSize;
    const chunkWorldX = chunk.chunkX * chunk.size * tileSize;
    const chunkWorldY = chunk.chunkY * chunk.size * tileSize;
    const local = ({ x, y }: Readonly<{ x: number; y: number }>) => ({
      x: (x - chunkWorldX) * canvasScale,
      y: (y - chunkWorldY) * canvasScale,
    });
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.beginPath();
    for (const segment of segments) {
      const from = local(segment.from);
      const to = local(segment.to);
      context.moveTo(from.x, from.y);
      if (segment.kind === "curve") {
        const control = local(segment.control);
        context.quadraticCurveTo(control.x, control.y, to.x, to.y);
      } else {
        context.lineTo(to.x, to.y);
      }
    }
    context.stroke();
  }

  private chunkKey(chunk: WorldChunk): string {
    return `${chunk.chunkX},${chunk.chunkY}`;
  }
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return Math.max(1, a);
}
