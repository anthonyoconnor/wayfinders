import Phaser from "phaser";
import {
  WATER_TEXTURE_KEYS,
  WATER_TRANSITION_MASKS,
  type WaterAssetRuntime,
} from "../assets/water";
import { PILOT_HOME_ISLAND_METADATA, resolveAuthoredHomeIslandPlacement } from "../assets/AuthoredHomeIsland";
import { prototypeConfig } from "../config/prototypeConfig";
import { TerrainType } from "../world/TileData";
import type { GeneratedWorld } from "../world/WorldGenerator";
import { WATER_TYPE_IDS, type WaterTypeId } from "../world/water";
import type { ActiveChunkDelta, ActiveChunkEntry } from "./activation";

interface WaterChunkView {
  entry: Readonly<ActiveChunkEntry>;
  base: Phaser.GameObjects.Image;
  surface: Phaser.GameObjects.Image;
  baseTextureKey: string;
  surfaceTextureKey: string;
  lastFrame: number;
}

export interface WaterRendererTelemetry {
  readonly activeChunks: number;
  readonly visibleChunks: number;
  readonly redrawCount: number;
  readonly animatedRedrawCount: number;
  readonly tilesDrawn: number;
}

/** Production water presentation. Authoritative terrain remains owned by WorldGrid. */
export class WaterRenderer {
  private readonly chunks = new Map<string, WaterChunkView>();
  private readonly transitionMaskIndex = new Map<number, number>(
    WATER_TRANSITION_MASKS.map((mask, index) => [mask, index]),
  );
  private generated?: GeneratedWorld;
  private homeShore?: Phaser.GameObjects.Image;
  private redrawCount = 0;
  private animatedRedrawCount = 0;
  private tilesDrawn = 0;
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
    this.createHomeShore(generated);
    this.sync(entries);
  }

  applyActiveChunks(delta: Readonly<ActiveChunkDelta>): void {
    this.sync(delta.active);
  }

  update(timeMilliseconds: number): void {
    if (!this.generated || this.reducedMotion) return;
    const frame = Math.floor(timeMilliseconds / 140) % 8;
    let homeVisible = false;
    for (const view of this.chunks.values()) {
      if (view.entry.band === "visible") {
        homeVisible ||= this.isHomeOwnerChunk(view.entry);
        if (view.lastFrame !== frame) {
          this.drawChunk(view, frame, true);
          this.animatedRedrawCount++;
        }
      }
    }
    this.homeShore?.setVisible(homeVisible).setFrame(frame);
  }

  getTelemetry(): Readonly<WaterRendererTelemetry> {
    let visibleChunks = 0;
    for (const view of this.chunks.values()) if (view.entry.band === "visible") visibleChunks++;
    return Object.freeze({
      activeChunks: this.chunks.size,
      visibleChunks,
      redrawCount: this.redrawCount,
      animatedRedrawCount: this.animatedRedrawCount,
      tilesDrawn: this.tilesDrawn,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.clear();
  }

  private sync(entries: readonly Readonly<ActiveChunkEntry>[]): void {
    if (!this.generated || this.destroyed) return;
    const desired = new Map(entries.map((entry) => [entry.key, entry]));
    for (const [key, view] of this.chunks) {
      const next = desired.get(key);
      if (!next) {
        this.destroyChunk(view);
        this.chunks.delete(key);
      } else {
        view.entry = next;
      }
    }
    for (const entry of entries) {
      if (this.chunks.has(entry.key)) continue;
      const view = this.createChunk(entry);
      this.chunks.set(entry.key, view);
      this.drawChunk(view, 0, false);
    }
    const homeVisible = entries.some((entry) => this.isHomeOwnerChunk(entry));
    this.homeShore?.setVisible(homeVisible);
  }

  private createChunk(entry: Readonly<ActiveChunkEntry>): WaterChunkView {
    const generated = this.generated!;
    const snapshot = generated.water.chunk(entry.coordinate.x, entry.coordinate.y);
    const tileSize = prototypeConfig.navigation.tileSize;
    const suffix = `${entry.coordinate.x}-${entry.coordinate.y}`;
    const baseTextureKey = `wayfinders.water.chunk.base.${suffix}`;
    const surfaceTextureKey = `wayfinders.water.chunk.surface.${suffix}`;
    if (this.scene.textures.exists(baseTextureKey)) this.scene.textures.remove(baseTextureKey);
    if (this.scene.textures.exists(surfaceTextureKey)) this.scene.textures.remove(surfaceTextureKey);
    this.scene.textures.createCanvas(
      baseTextureKey,
      snapshot.width * tileSize,
      snapshot.height * tileSize,
    );
    this.scene.textures.createCanvas(
      surfaceTextureKey,
      snapshot.width * tileSize,
      snapshot.height * tileSize,
    );
    const base = this.scene.add.image(
      snapshot.startX * tileSize,
      snapshot.startY * tileSize,
      baseTextureKey,
    ).setOrigin(0).setDepth(1.5);
    const surface = this.scene.add.image(
      snapshot.startX * tileSize,
      snapshot.startY * tileSize,
      surfaceTextureKey,
    ).setOrigin(0).setDepth(1.6);
    return { entry, base, surface, baseTextureKey, surfaceTextureKey, lastFrame: -1 };
  }

  private drawChunk(view: WaterChunkView, frame: number, animated: boolean): void {
    const generated = this.generated!;
    const snapshot = generated.water.chunk(view.entry.coordinate.x, view.entry.coordinate.y);
    const tileSize = prototypeConfig.navigation.tileSize;
    const targetKey = animated ? view.surfaceTextureKey : view.baseTextureKey;
    const target = this.scene.textures.get(targetKey) as Phaser.Textures.CanvasTexture;
    const context = target.getContext();
    context.clearRect(0, 0, target.width, target.height);
    context.imageSmoothingEnabled = false;
    const surface = this.scene.textures.get(view.surfaceTextureKey) as Phaser.Textures.CanvasTexture;
    const surfaceContext = surface.getContext();
    if (!animated) {
      surfaceContext.clearRect(0, 0, surface.width, surface.height);
      surfaceContext.imageSmoothingEnabled = false;
    }
    for (let y = snapshot.startY; y < snapshot.startY + snapshot.height; y++) {
      for (let x = snapshot.startX; x < snapshot.startX + snapshot.width; x++) {
        const terrain = generated.grid.getTerrain(x, y);
        if (terrain === TerrainType.Land || terrain === TerrainType.Rock) continue;
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
            localX,
            localY,
          );
        }
        const mask = generated.water.transitionMaskAt(x, y);
        const maskIndex = this.transitionMaskIndex.get(mask);
        if (maskIndex !== undefined && mask !== 0) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.transitions, (phase % 4) * 47 + maskIndex, 47, localX, localY);
        }
        if (generated.water.hasOverlay(x, y, WATER_TYPE_IDS.current)) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, 16 + phase, 8, localX, localY);
        }
        if (generated.water.hasOverlay(x, y, WATER_TYPE_IDS.rough)) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, 24 + phase, 8, localX, localY);
        } else if (
          (type === WATER_TYPE_IDS.coastal || type === WATER_TYPE_IDS.lagoon || type === WATER_TYPE_IDS.reef)
          && (x + y + variant) % 3 === 0
        ) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, 8 + phase, 8, localX, localY, 0.58);
        } else if ((x + y + variant) % 17 === 0) {
          this.drawFrame(surfaceContext, WATER_TEXTURE_KEYS.overlays, phase, 8, localX, localY, 0.7);
        }
        this.tilesDrawn++;
      }
    }
    target.refresh();
    if (!animated) surface.refresh();
    view.lastFrame = frame;
    this.redrawCount++;
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

  private destroyChunk(view: WaterChunkView): void {
    view.base.destroy();
    view.surface.destroy();
    if (this.scene.textures.exists(view.baseTextureKey)) this.scene.textures.remove(view.baseTextureKey);
    if (this.scene.textures.exists(view.surfaceTextureKey)) this.scene.textures.remove(view.surfaceTextureKey);
  }

  private createHomeShore(generated: GeneratedWorld): void {
    const center = { x: Math.floor(generated.grid.width / 2), y: Math.floor(generated.grid.height / 2) };
    const placement = resolveAuthoredHomeIslandPlacement(center);
    const tileSize = prototypeConfig.navigation.tileSize;
    this.homeShore = this.scene.add.image(
      placement.topLeft.x * tileSize,
      placement.topLeft.y * tileSize,
      WATER_TEXTURE_KEYS.homeShore,
      0,
    ).setOrigin(0).setDepth(4.75).setVisible(false);
  }

  private isHomeOwnerChunk(entry: Readonly<ActiveChunkEntry>): boolean {
    const generated = this.generated;
    if (!generated) return false;
    const center = { x: Math.floor(generated.grid.width / 2), y: Math.floor(generated.grid.height / 2) };
    const placement = resolveAuthoredHomeIslandPlacement(center, PILOT_HOME_ISLAND_METADATA);
    return entry.coordinate.x === Math.floor(placement.topLeft.x / generated.grid.chunkSize)
      && entry.coordinate.y === Math.floor(placement.topLeft.y / generated.grid.chunkSize);
  }

  private clear(): void {
    for (const view of this.chunks.values()) {
      this.destroyChunk(view);
    }
    this.chunks.clear();
    this.homeShore?.destroy();
    this.homeShore = undefined;
    this.generated = undefined;
  }
}
