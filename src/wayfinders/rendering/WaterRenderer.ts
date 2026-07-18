import Phaser from "phaser";
import {
  WATER_TEXTURE_KEYS,
  WATER_TRANSITION_MASKS,
  type WaterAssetRuntime,
} from "../assets/water";
import { PILOT_HOME_ISLAND_METADATA } from "../assets/AuthoredHomeIsland";
import { prototypeConfig } from "../config/prototypeConfig";
import type { GridPoint, WorldPoint } from "../core/types";
import { TerrainType } from "../world/TileData";
import type { GeneratedWorld } from "../world/WorldGenerator";
import type { CanonicalTileBounds, WorldTopology } from "../world/WorldTopology";
import { WATER_TYPE_IDS, type WaterTypeId } from "../world/water";
import { activeChunkViewKey, type ActiveChunkDelta, type ActiveChunkEntry } from "./activation";

interface WaterCanonicalChunk {
  readonly key: string;
  readonly coordinate: Readonly<GridPoint>;
  readonly baseTextureKey: string;
  readonly surfaceTextureKey: string;
  lastFrame: number;
  visible: boolean;
}

interface WaterImageView {
  entry: Readonly<ActiveChunkEntry>;
  readonly canonicalKey: string;
  readonly base: Phaser.GameObjects.Image;
  readonly surface: Phaser.GameObjects.Image;
}

interface HomeShoreImage {
  readonly imageOffset: Readonly<WorldPoint>;
  readonly image: Phaser.GameObjects.Image;
  visible: boolean;
}

const BASE_TEXTURE_FRAME = "chunk";
const BASE_TEXTURE_GUTTER = 1;

export interface WaterRendererTelemetry {
  readonly activeImageEntries: number;
  readonly activeCanonicalChunks: number;
  readonly visibleImageEntries: number;
  readonly visibleCanonicalChunks: number;
  readonly activeCanvasTextures: number;
  readonly activeWaterImageObjects: number;
  readonly homeShoreAliases: number;
  readonly redrawCount: number;
  readonly animatedRedrawCount: number;
  readonly tilesDrawn: number;
  readonly totalImageActivations: number;
  readonly totalImageDeactivations: number;
  readonly totalHomeShoreAliasActivations: number;
  readonly totalHomeShoreAliasDeactivations: number;
  readonly peakImageEntries: number;
  readonly peakCanonicalChunks: number;
  readonly peakHomeShoreAliases: number;
}

/** Production water presentation. Authoritative terrain and revisions remain canonical. */
export class WaterRenderer {
  private readonly canonicalChunks = new Map<string, WaterCanonicalChunk>();
  private readonly images = new Map<string, WaterImageView>();
  private readonly homeShoreImages = new Map<string, HomeShoreImage>();
  private readonly transitionMaskIndex = new Map<number, number>(
    WATER_TRANSITION_MASKS.map((mask, index) => [mask, index]),
  );
  private generated?: GeneratedWorld;
  private redrawCount = 0;
  private animatedRedrawCount = 0;
  private tilesDrawn = 0;
  private currentFrame = 0;
  private totalImageActivations = 0;
  private totalImageDeactivations = 0;
  private totalHomeShoreAliasActivations = 0;
  private totalHomeShoreAliasDeactivations = 0;
  private peakImageEntries = 0;
  private peakCanonicalChunks = 0;
  private peakHomeShoreAliases = 0;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly assets: Readonly<WaterAssetRuntime>,
    private readonly reducedMotion: boolean,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  render(generated: GeneratedWorld, entries: readonly Readonly<ActiveChunkEntry>[]): void {
    this.clear();
    this.generated = generated;
    this.sync(entries);
  }

  applyActiveChunks(delta: Readonly<ActiveChunkDelta>): void {
    this.sync(delta.active);
  }

  update(timeMilliseconds: number): void {
    if (!this.generated || this.reducedMotion) return;
    const frame = Math.floor(timeMilliseconds / 140) % 8;
    this.currentFrame = frame;
    for (const owner of this.canonicalChunks.values()) {
      if (!owner.visible || owner.lastFrame === frame) continue;
      this.drawChunk(owner, frame, true);
      this.animatedRedrawCount++;
    }
    for (const alias of this.homeShoreImages.values()) {
      if (alias.visible) alias.image.setFrame(frame);
    }
  }

  getTelemetry(): Readonly<WaterRendererTelemetry> {
    let visibleImageEntries = 0;
    let visibleCanonicalChunks = 0;
    for (const view of this.images.values()) if (view.entry.band === "visible") visibleImageEntries++;
    for (const owner of this.canonicalChunks.values()) if (owner.visible) visibleCanonicalChunks++;
    return Object.freeze({
      activeImageEntries: this.images.size,
      activeCanonicalChunks: this.canonicalChunks.size,
      visibleImageEntries,
      visibleCanonicalChunks,
      activeCanvasTextures: this.canonicalChunks.size * 2,
      activeWaterImageObjects: this.images.size * 2,
      homeShoreAliases: this.homeShoreImages.size,
      redrawCount: this.redrawCount,
      animatedRedrawCount: this.animatedRedrawCount,
      tilesDrawn: this.tilesDrawn,
      totalImageActivations: this.totalImageActivations,
      totalImageDeactivations: this.totalImageDeactivations,
      totalHomeShoreAliasActivations: this.totalHomeShoreAliasActivations,
      totalHomeShoreAliasDeactivations: this.totalHomeShoreAliasDeactivations,
      peakImageEntries: this.peakImageEntries,
      peakCanonicalChunks: this.peakCanonicalChunks,
      peakHomeShoreAliases: this.peakHomeShoreAliases,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.clear();
  }

  private sync(entries: readonly Readonly<ActiveChunkEntry>[]): void {
    const generated = this.generated;
    if (!generated || this.destroyed) return;

    const desiredImages = new Map<string, Readonly<ActiveChunkEntry>>();
    const desiredCanonical = new Set<string>();
    for (const entry of entries) {
      this.assertValidEntry(entry);
      if (desiredImages.has(entry.viewKey)) {
        throw new RangeError(`Duplicate water image entry ${entry.viewKey}`);
      }
      desiredImages.set(entry.viewKey, entry);
      desiredCanonical.add(canonicalChunkKey(entry.canonicalChunk));
    }

    for (const [viewKey, view] of this.images) {
      const next = desiredImages.get(viewKey);
      if (!next) {
        this.destroyImage(view);
        this.images.delete(viewKey);
        this.totalImageDeactivations++;
      } else {
        view.entry = next;
        this.positionImage(view);
      }
    }

    for (const [key, owner] of this.canonicalChunks) {
      if (desiredCanonical.has(key)) continue;
      this.destroyCanonicalChunk(owner);
      this.canonicalChunks.delete(key);
    }

    for (const entry of entries) {
      if (this.images.has(entry.viewKey)) continue;
      const owner = this.ensureCanonicalChunk(entry.canonicalChunk);
      const view = this.createImage(entry, owner);
      this.images.set(entry.viewKey, view);
      this.totalImageActivations++;
    }

    for (const owner of this.canonicalChunks.values()) owner.visible = false;
    for (const view of this.images.values()) {
      if (view.entry.band === "visible") this.canonicalChunks.get(view.canonicalKey)!.visible = true;
    }
    this.syncHomeShore(entries);
    this.peakImageEntries = Math.max(this.peakImageEntries, this.images.size);
    this.peakCanonicalChunks = Math.max(this.peakCanonicalChunks, this.canonicalChunks.size);
    this.peakHomeShoreAliases = Math.max(this.peakHomeShoreAliases, this.homeShoreImages.size);
  }

  private ensureCanonicalChunk(coordinate: Readonly<GridPoint>): WaterCanonicalChunk {
    const key = canonicalChunkKey(coordinate);
    const existing = this.canonicalChunks.get(key);
    if (existing) return existing;

    const generated = this.generated!;
    const snapshot = generated.water.chunk(coordinate.x, coordinate.y);
    const tileSize = prototypeConfig.navigation.tileSize;
    const suffix = `${coordinate.x}-${coordinate.y}`;
    const baseTextureKey = `wayfinders.water.chunk.base.${suffix}`;
    const surfaceTextureKey = `wayfinders.water.chunk.surface.${suffix}`;
    if (this.scene.textures.exists(baseTextureKey)) this.scene.textures.remove(baseTextureKey);
    if (this.scene.textures.exists(surfaceTextureKey)) this.scene.textures.remove(surfaceTextureKey);
    const baseWidth = snapshot.width * tileSize;
    const baseHeight = snapshot.height * tileSize;
    const baseTexture = this.scene.textures.createCanvas(
      baseTextureKey,
      baseWidth + BASE_TEXTURE_GUTTER * 2,
      baseHeight + BASE_TEXTURE_GUTTER * 2,
    );
    if (!baseTexture) throw new Error(`Could not create water base texture ${baseTextureKey}`);
    baseTexture.add(
      BASE_TEXTURE_FRAME,
      0,
      BASE_TEXTURE_GUTTER,
      BASE_TEXTURE_GUTTER,
      baseWidth,
      baseHeight,
    );
    this.scene.textures.createCanvas(surfaceTextureKey, snapshot.width * tileSize, snapshot.height * tileSize);
    const owner: WaterCanonicalChunk = {
      key,
      coordinate: Object.freeze({ ...coordinate }),
      baseTextureKey,
      surfaceTextureKey,
      lastFrame: -1,
      visible: false,
    };
    this.canonicalChunks.set(key, owner);
    this.drawChunk(owner, this.currentFrame, false);
    return owner;
  }

  private createImage(
    entry: Readonly<ActiveChunkEntry>,
    owner: Readonly<WaterCanonicalChunk>,
  ): WaterImageView {
    const base = this.scene.add.image(0, 0, owner.baseTextureKey, BASE_TEXTURE_FRAME).setOrigin(0).setDepth(1.5);
    const surface = this.scene.add.image(0, 0, owner.surfaceTextureKey).setOrigin(0).setDepth(1.6);
    const view: WaterImageView = {
      entry,
      canonicalKey: owner.key,
      base,
      surface,
    };
    this.positionImage(view);
    return view;
  }

  private positionImage(view: WaterImageView): void {
    const snapshot = this.generated!.water.chunk(
      view.entry.canonicalChunk.x,
      view.entry.canonicalChunk.y,
    );
    const tileSize = prototypeConfig.navigation.tileSize;
    const x = snapshot.startX * tileSize + view.entry.imageOffset.x;
    const y = snapshot.startY * tileSize + view.entry.imageOffset.y;
    view.base.setPosition(x, y);
    view.surface.setPosition(x, y);
  }

  private drawChunk(owner: WaterCanonicalChunk, frame: number, animated: boolean): void {
    const generated = this.generated!;
    const snapshot = generated.water.chunk(owner.coordinate.x, owner.coordinate.y);
    const tileSize = prototypeConfig.navigation.tileSize;
    const targetKey = animated ? owner.surfaceTextureKey : owner.baseTextureKey;
    const target = this.scene.textures.get(targetKey) as Phaser.Textures.CanvasTexture;
    const context = target.getContext();
    context.clearRect(0, 0, target.width, target.height);
    context.imageSmoothingEnabled = false;
    const surface = this.scene.textures.get(owner.surfaceTextureKey) as Phaser.Textures.CanvasTexture;
    const surfaceContext = surface.getContext();
    if (!animated) {
      surfaceContext.clearRect(0, 0, surface.width, surface.height);
      surfaceContext.imageSmoothingEnabled = false;
    }
    for (let y = snapshot.startY; y < snapshot.startY + snapshot.height; y++) {
      for (let x = snapshot.startX; x < snapshot.startX + snapshot.width; x++) {
        const terrain = generated.grid.getTerrain(x, y);
        const blockedIslandCell = terrain === TerrainType.Land || terrain === TerrainType.Rock;
        const localX = (x - snapshot.startX) * tileSize;
        const localY = (y - snapshot.startY) * tileSize;
        const type = generated.water.baseTypeAt(x, y);
        const variant = generated.water.variantAt(x, y);
        const profile = this.assets.profiles.get(type);
        if (!profile) continue;
        const phase = (frame + generated.water.phaseAt(x, y)) % 8;
        if (!animated) {
          this.drawFrame(
            context,
            WATER_TEXTURE_KEYS.static,
            this.profileIndex(type) * 4 + variant,
            4,
            localX + BASE_TEXTURE_GUTTER,
            localY + BASE_TEXTURE_GUTTER,
          );
        }
        const mask = generated.water.transitionMaskAt(x, y);
        const maskIndex = this.transitionMaskIndex.get(mask);
        if (maskIndex !== undefined && mask !== 0) {
          this.drawFrame(
            surfaceContext,
            WATER_TEXTURE_KEYS.transitions,
            (phase % 4) * WATER_TRANSITION_MASKS.length + maskIndex,
            WATER_TRANSITION_MASKS.length,
            localX,
            localY,
          );
        }
        if (!blockedIslandCell && generated.water.hasOverlay(x, y, WATER_TYPE_IDS.current)) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, 16 + phase, 8, localX, localY);
        }
        if (!blockedIslandCell && generated.water.hasOverlay(x, y, WATER_TYPE_IDS.rough)) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, 24 + phase, 8, localX, localY);
        } else if (
          !blockedIslandCell
          && (type === WATER_TYPE_IDS.coastal || type === WATER_TYPE_IDS.lagoon || type === WATER_TYPE_IDS.reef)
          && (x + y + variant) % 3 === 0
        ) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, 8 + phase, 8, localX, localY, 0.58);
        } else if (!blockedIslandCell && (x + y + variant) % 17 === 0) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, phase, 8, localX, localY, 0.7);
        }
        this.tilesDrawn++;
      }
    }
    if (!animated) this.extrudeBaseTextureGutter(target, snapshot.width * tileSize, snapshot.height * tileSize);
    target.refresh();
    if (!animated) surface.refresh();
    owner.lastFrame = frame;
    this.redrawCount++;
  }

  /**
   * Keeps bilinear sampling inside opaque base-water pixels at independently
   * transformed chunk and periodic-image joins. The displayed frame remains
   * the exact canonical chunk size; only its one-pixel sampling gutter grows.
   */
  private extrudeBaseTextureGutter(
    texture: Phaser.Textures.CanvasTexture,
    coreWidth: number,
    coreHeight: number,
  ): void {
    const context = texture.getContext();
    const source = texture.getSourceImage() as CanvasImageSource;
    const gutter = BASE_TEXTURE_GUTTER;
    const right = gutter + coreWidth - 1;
    const bottom = gutter + coreHeight - 1;

    context.drawImage(source, gutter, gutter, coreWidth, 1, gutter, 0, coreWidth, gutter);
    context.drawImage(source, gutter, bottom, coreWidth, 1, gutter, bottom + 1, coreWidth, gutter);
    context.drawImage(source, gutter, gutter, 1, coreHeight, 0, gutter, gutter, coreHeight);
    context.drawImage(source, right, gutter, 1, coreHeight, right + 1, gutter, gutter, coreHeight);
    context.drawImage(source, gutter, gutter, 1, 1, 0, 0, gutter, gutter);
    context.drawImage(source, right, gutter, 1, 1, right + 1, 0, gutter, gutter);
    context.drawImage(source, gutter, bottom, 1, 1, 0, bottom + 1, gutter, gutter);
    context.drawImage(source, right, bottom, 1, 1, right + 1, bottom + 1, gutter, gutter);
  }

  private profileIndex(type: WaterTypeId): number {
    const index = this.assets.package.profiles.findIndex(({ id }) => id === type);
    if (index < 0) throw new RangeError(`Water package does not contain ${type}`);
    return index;
  }

  private drawFrame(
    context: CanvasRenderingContext2D,
    textureKey: string,
    frame: number,
    columns: number,
    x: number,
    y: number,
    alpha = 1,
  ): void {
    const source = this.scene.textures.get(textureKey).getSourceImage() as CanvasImageSource;
    const sourceX = 2 + (frame % columns) * 36;
    const sourceY = 2 + Math.floor(frame / columns) * 36;
    const tileSize = prototypeConfig.navigation.tileSize;
    context.globalAlpha = alpha;
    context.drawImage(source, sourceX, sourceY, 32, 32, x, y, tileSize, tileSize);
    context.globalAlpha = 1;
  }

  private syncHomeShore(entries: readonly Readonly<ActiveChunkEntry>[]): void {
    const generated = this.generated!;
    const topology = generated.grid.topology;
    const topLeft = {
      x: generated.landmarks.homeCenter.x - PILOT_HOME_ISLAND_METADATA.anchors.homeCenter.x,
      y: generated.landmarks.homeCenter.y - PILOT_HOME_ISLAND_METADATA.anchors.homeCenter.y,
    };
    const footprint: CanonicalTileBounds = {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: topLeft.x + PILOT_HOME_ISLAND_METADATA.grid.width - 1,
      maxY: topLeft.y + PILOT_HOME_ISLAND_METADATA.grid.height - 1,
    };
    const desired = new Map<string, { imageOffset: WorldPoint; visible: boolean }>();
    for (const entry of entries) {
      const viewBounds = liftedChunkBounds(entry, topology);
      for (const imageOffset of periodicOffsetsIntersecting(footprint, viewBounds, topology)) {
        const key = imageOffsetKey(imageOffset);
        const existing = desired.get(key);
        desired.set(key, {
          imageOffset,
          visible: (existing?.visible ?? false) || entry.band === "visible",
        });
      }
    }

    for (const [key, alias] of this.homeShoreImages) {
      const next = desired.get(key);
      if (!next) {
        alias.image.destroy();
        this.homeShoreImages.delete(key);
        this.totalHomeShoreAliasDeactivations++;
        continue;
      }
      alias.visible = next.visible;
      alias.image.setVisible(next.visible);
      if (next.visible) alias.image.setFrame(this.currentFrame);
    }
    const tileSize = prototypeConfig.navigation.tileSize;
    for (const [key, next] of desired) {
      if (this.homeShoreImages.has(key)) continue;
      const image = this.scene.add.image(
        topLeft.x * tileSize + next.imageOffset.x,
        topLeft.y * tileSize + next.imageOffset.y,
        WATER_TEXTURE_KEYS.homeShore,
        this.currentFrame,
      ).setOrigin(0).setDepth(4.75).setVisible(next.visible);
      this.homeShoreImages.set(key, {
        imageOffset: Object.freeze({ ...next.imageOffset }),
        image,
        visible: next.visible,
      });
      this.totalHomeShoreAliasActivations++;
    }
  }

  private assertValidEntry(entry: Readonly<ActiveChunkEntry>): void {
    const topology = this.generated!.grid.topology;
    const { x, y } = entry.canonicalChunk;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new RangeError(`Canonical water chunk coordinates must be safe integers: ${entry.viewKey}`);
    }
    if (x < 0 || y < 0 || x >= topology.chunkColumns || y >= topology.chunkRows) {
      throw new RangeError(`Water image ${entry.viewKey} has an out-of-range canonical chunk`);
    }
    if (
      !Number.isSafeInteger(entry.imageOffset.x)
      || !Number.isSafeInteger(entry.imageOffset.y)
      || (entry.imageOffset.x !== 0 && entry.imageOffset.x % topology.pixelWidth !== 0)
      || (entry.imageOffset.y !== 0 && entry.imageOffset.y % topology.pixelHeight !== 0)
      || (!topology.wrapsX && entry.imageOffset.x !== 0)
      || (!topology.wrapsY && entry.imageOffset.y !== 0)
    ) throw new RangeError(`Water image ${entry.viewKey} has an invalid whole-world offset`);
    const expected = activeChunkViewKey(x, y, entry.imageOffset.x, entry.imageOffset.y);
    if (entry.viewKey !== expected) {
      throw new RangeError(`Water image key ${entry.viewKey} does not match ${expected}`);
    }
  }

  private destroyImage(view: Readonly<WaterImageView>): void {
    view.base.destroy();
    view.surface.destroy();
  }

  private destroyCanonicalChunk(owner: Readonly<WaterCanonicalChunk>): void {
    if (this.scene.textures.exists(owner.baseTextureKey)) this.scene.textures.remove(owner.baseTextureKey);
    if (this.scene.textures.exists(owner.surfaceTextureKey)) this.scene.textures.remove(owner.surfaceTextureKey);
  }

  private clear(): void {
    for (const view of this.images.values()) this.destroyImage(view);
    this.totalImageDeactivations += this.images.size;
    this.images.clear();
    for (const owner of this.canonicalChunks.values()) this.destroyCanonicalChunk(owner);
    this.canonicalChunks.clear();
    for (const alias of this.homeShoreImages.values()) alias.image.destroy();
    this.totalHomeShoreAliasDeactivations += this.homeShoreImages.size;
    this.homeShoreImages.clear();
    this.generated = undefined;
  }
}

function canonicalChunkKey(coordinate: Readonly<GridPoint>): string {
  return `${coordinate.x},${coordinate.y}`;
}

function imageOffsetKey(offset: Readonly<WorldPoint>): string {
  return `${offset.x},${offset.y}`;
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
