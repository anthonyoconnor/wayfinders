import type { CloudAssetPackage } from "../CloudAssetCatalog";
import {
  resolveCloudDescriptorsForChunk,
  resolveCloudMotion,
  type CloudDescriptor,
} from "../../rendering/CloudLayerRenderer";
import type { ActiveChunkEntry } from "../../rendering/activation";
import { TerrainType } from "../../world/TileData";
import { WorldGenerator, type GeneratedWorld } from "../../world/WorldGenerator";

export const CLOUD_WORLD_PREVIEW_CELL_SIZE = 6;
export const CLOUD_WORLD_PREVIEW_SPEEDS = Object.freeze([1, 4, 12, 24] as const);

export interface CloudWorldPreviewModel {
  readonly seed: number;
  readonly generated: Readonly<GeneratedWorld>;
}

export interface CloudWorldPreviewOptions {
  readonly timeMs: number;
  readonly activationAgeMs: number;
  readonly showGuides: boolean;
  readonly selectedFrame: number | undefined;
}

function previewChunkEntry(chunkX: number, chunkY: number): Readonly<ActiveChunkEntry> {
  return Object.freeze({
    viewKey: `preview:${chunkX},${chunkY}`,
    canonicalChunk: Object.freeze({ x: chunkX, y: chunkY }),
    imageOffset: Object.freeze({ x: 0, y: 0 }),
    band: "visible",
    ringDistance: 0,
    loadPriority: chunkY * 1_024 + chunkX,
  });
}

export function generateCloudWorldPreview(seed: number): Readonly<CloudWorldPreviewModel> {
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  return Object.freeze({
    seed: normalizedSeed,
    generated: new WorldGenerator().generate(normalizedSeed),
  });
}

/** Resolves the complete world descriptor set through the same chunk seam as the game. */
export function resolveCloudWorldPreviewDescriptors(
  model: Readonly<CloudWorldPreviewModel>,
  cloudPackage: Readonly<CloudAssetPackage>,
): readonly Readonly<CloudDescriptor>[] {
  const { generated } = model;
  const { grid } = generated;
  const chunkColumns = Math.ceil(grid.width / grid.chunkSize);
  const chunkRows = Math.ceil(grid.height / grid.chunkSize);
  const chunkSizePixels = grid.chunkSize * grid.tileSize;
  const descriptors: Readonly<CloudDescriptor>[] = [];
  for (let chunkY = 0; chunkY < chunkRows; chunkY++) {
    for (let chunkX = 0; chunkX < chunkColumns; chunkX++) {
      descriptors.push(...resolveCloudDescriptorsForChunk(
        model.seed,
        previewChunkEntry(chunkX, chunkY),
        chunkSizePixels,
        cloudPackage.presentation.candidatesPerChunk,
        cloudPackage,
      ));
    }
  }
  return Object.freeze(descriptors);
}

function tintCss(tint: number): string {
  return `#${tint.toString(16).padStart(6, "0")}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function terrainColor(terrain: TerrainType, x: number, y: number): string {
  const alternate = (x * 31 + y * 17) % 5 === 0;
  switch (terrain) {
    case TerrainType.DeepOcean: return alternate ? "#0c5066" : "#0d566c";
    case TerrainType.ShallowOcean: return alternate ? "#247e8c" : "#287f90";
    case TerrainType.Reef: return alternate ? "#48aaa4" : "#52b3aa";
    case TerrainType.Rock: return alternate ? "#667172" : "#727c79";
    case TerrainType.Land: return alternate ? "#78975b" : "#6f8d52";
  }
}

/** Canvas adapter for the renderer-neutral cloud descriptors used by the asset workspace. */
export class CloudWorldPreviewCanvas {
  private readonly tintedFrames = new Map<string, HTMLCanvasElement>();
  private backdrop?: HTMLCanvasElement;
  private backdropSeed?: number;

  constructor(private readonly sheetImage: HTMLImageElement) {}

  draw(
    canvas: HTMLCanvasElement,
    model: Readonly<CloudWorldPreviewModel>,
    descriptors: readonly Readonly<CloudDescriptor>[],
    cloudPackage: Readonly<CloudAssetPackage>,
    options: Readonly<CloudWorldPreviewOptions>,
  ): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    const { grid } = model.generated;
    const width = grid.width * CLOUD_WORLD_PREVIEW_CELL_SIZE;
    const height = grid.height * CLOUD_WORLD_PREVIEW_CELL_SIZE;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(this.worldBackdrop(model), 0, 0);
    context.imageSmoothingEnabled = false;

    const previewScale = CLOUD_WORLD_PREVIEW_CELL_SIZE / grid.tileSize;
    if (options.showGuides) {
      this.drawChunkGuides(context, model);
      this.drawRouteGuides(context, descriptors, previewScale, options.selectedFrame);
    }

    const samples = descriptors.map((descriptor) => ({
      descriptor,
      motion: resolveCloudMotion(descriptor, options.timeMs, false, cloudPackage),
    }));
    const fadeDurationMs = cloudPackage.presentation.fadeInSeconds * 1_000;

    for (const { descriptor, motion } of samples) {
      const fade = this.fadeFor(motion.routeFade, options.activationAgeMs, fadeDurationMs);
      this.drawDescriptor(
        context,
        descriptor,
        motion,
        cloudPackage,
        previewScale,
        descriptor.alpha * cloudPackage.presentation.shadow.opacityMultiplier * fade,
        true,
      );
    }
    for (const { descriptor, motion } of samples) {
      const fade = this.fadeFor(motion.routeFade, options.activationAgeMs, fadeDurationMs);
      this.drawDescriptor(
        context,
        descriptor,
        motion,
        cloudPackage,
        previewScale,
        descriptor.alpha * fade,
        false,
      );
    }
  }

  destroy(): void {
    this.tintedFrames.clear();
    this.backdrop = undefined;
    this.backdropSeed = undefined;
  }

  private worldBackdrop(model: Readonly<CloudWorldPreviewModel>): HTMLCanvasElement {
    if (this.backdrop && this.backdropSeed === model.seed) return this.backdrop;
    const { generated } = model;
    const { grid } = generated;
    const canvas = document.createElement("canvas");
    canvas.width = grid.width * CLOUD_WORLD_PREVIEW_CELL_SIZE;
    canvas.height = grid.height * CLOUD_WORLD_PREVIEW_CELL_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        context.fillStyle = terrainColor(grid.getTerrain(x, y), x, y);
        context.fillRect(
          x * CLOUD_WORLD_PREVIEW_CELL_SIZE,
          y * CLOUD_WORLD_PREVIEW_CELL_SIZE,
          CLOUD_WORLD_PREVIEW_CELL_SIZE,
          CLOUD_WORLD_PREVIEW_CELL_SIZE,
        );
      }
    }
    this.drawHomeAndBoat(context, model);
    this.backdrop = canvas;
    this.backdropSeed = model.seed;
    return canvas;
  }

  private drawHomeAndBoat(
    context: CanvasRenderingContext2D,
    model: Readonly<CloudWorldPreviewModel>,
  ): void {
    const { landmarks } = model.generated;
    const cell = CLOUD_WORLD_PREVIEW_CELL_SIZE;
    const homeX = (landmarks.homeCenter.x + 0.5) * cell;
    const homeY = (landmarks.homeCenter.y + 0.5) * cell;
    context.save();
    context.strokeStyle = "rgba(255, 225, 145, 0.9)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(homeX, homeY, cell * 2.2, 0, Math.PI * 2);
    context.stroke();

    const boatX = (landmarks.dock.x + 0.5) * cell;
    const boatY = (landmarks.dock.y + 1.8) * cell;
    context.fillStyle = "rgba(215, 245, 244, 0.35)";
    context.beginPath();
    context.ellipse(boatX, boatY + cell, cell * 2.4, cell * 0.7, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f3eee0";
    context.beginPath();
    context.moveTo(boatX, boatY - cell * 1.5);
    context.lineTo(boatX + cell * 1.5, boatY + cell);
    context.lineTo(boatX - cell * 1.1, boatY + cell * 0.7);
    context.closePath();
    context.fill();
    context.restore();
  }

  private drawChunkGuides(
    context: CanvasRenderingContext2D,
    model: Readonly<CloudWorldPreviewModel>,
  ): void {
    const { grid } = model.generated;
    const chunkPixels = grid.chunkSize * CLOUD_WORLD_PREVIEW_CELL_SIZE;
    context.save();
    context.strokeStyle = "rgba(194, 239, 238, 0.24)";
    context.lineWidth = 1;
    context.setLineDash([5, 5]);
    for (let x = chunkPixels; x < context.canvas.width; x += chunkPixels) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, context.canvas.height);
      context.stroke();
    }
    for (let y = chunkPixels; y < context.canvas.height; y += chunkPixels) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(context.canvas.width, y + 0.5);
      context.stroke();
    }
    context.restore();
  }

  private drawRouteGuides(
    context: CanvasRenderingContext2D,
    descriptors: readonly Readonly<CloudDescriptor>[],
    previewScale: number,
    selectedFrame: number | undefined,
  ): void {
    context.save();
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    for (const descriptor of descriptors) {
      context.strokeStyle = descriptor.frame === selectedFrame
        ? "rgba(255, 224, 139, 0.72)"
        : "rgba(205, 245, 244, 0.38)";
      context.fillStyle = descriptor.frame === selectedFrame
        ? "rgba(255, 224, 139, 0.92)"
        : "rgba(205, 245, 244, 0.62)";
      context.beginPath();
      context.moveTo(
        (descriptor.baseX - descriptor.driftAmplitudeX) * previewScale,
        (descriptor.baseY - descriptor.driftAmplitudeY) * previewScale,
      );
      context.lineTo(
        (descriptor.baseX + descriptor.driftAmplitudeX) * previewScale,
        (descriptor.baseY + descriptor.driftAmplitudeY) * previewScale,
      );
      context.stroke();
      context.beginPath();
      context.arc(descriptor.baseX * previewScale, descriptor.baseY * previewScale, 1.7, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  private fadeFor(
    routeFade: number,
    activationAgeMs: number,
    fadeDurationMs: number,
  ): number {
    const activationFade = fadeDurationMs === 0
      ? 1
      : clamp01(activationAgeMs / fadeDurationMs);
    return activationFade * routeFade;
  }

  private drawDescriptor(
    context: CanvasRenderingContext2D,
    descriptor: Readonly<CloudDescriptor>,
    motion: Readonly<{ x: number; y: number }>,
    cloudPackage: Readonly<CloudAssetPackage>,
    previewScale: number,
    alpha: number,
    shadow: boolean,
  ): void {
    if (alpha <= 0) return;
    const { presentation } = cloudPackage;
    const tint = shadow
      ? (presentation.shadow.tintRgb.red << 16)
        | (presentation.shadow.tintRgb.green << 8)
        | presentation.shadow.tintRgb.blue
      : descriptor.tint;
    const frame = this.tintedFrame(descriptor.frame, tint, cloudPackage);
    const offsetX = shadow ? presentation.shadow.offsetPixels.x : 0;
    const offsetY = shadow ? presentation.shadow.offsetPixels.y : 0;
    const scaleX = descriptor.scale * previewScale * (shadow ? presentation.shadow.scale.x : 1);
    const scaleY = descriptor.scale * previewScale * (shadow ? presentation.shadow.scale.y : 1);
    context.save();
    context.globalAlpha = clamp01(alpha);
    context.translate((motion.x + offsetX) * previewScale, (motion.y + offsetY) * previewScale);
    context.scale((descriptor.flipX ? -1 : 1) * scaleX, scaleY);
    context.drawImage(frame, -frame.width / 2, -frame.height / 2);
    context.restore();
  }

  private tintedFrame(
    frame: number,
    tint: number,
    cloudPackage: Readonly<CloudAssetPackage>,
  ): HTMLCanvasElement {
    const key = `${frame}:${tint}`;
    const cached = this.tintedFrames.get(key);
    if (cached) return cached;
    const { image } = cloudPackage;
    const columns = image.pixelSize.width / image.frameSize.width;
    const sourceX = (frame % columns) * image.frameSize.width;
    const sourceY = Math.floor(frame / columns) * image.frameSize.height;
    const canvas = document.createElement("canvas");
    canvas.width = image.frameSize.width;
    canvas.height = image.frameSize.height;
    const context = canvas.getContext("2d");
    if (context) {
      context.imageSmoothingEnabled = false;
      context.drawImage(
        this.sheetImage,
        sourceX,
        sourceY,
        image.frameSize.width,
        image.frameSize.height,
        0,
        0,
        image.frameSize.width,
        image.frameSize.height,
      );
      if (tint !== 0xff_ff_ff) {
        context.globalCompositeOperation = "multiply";
        context.fillStyle = tintCss(tint);
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = "destination-in";
        context.drawImage(
          this.sheetImage,
          sourceX,
          sourceY,
          image.frameSize.width,
          image.frameSize.height,
          0,
          0,
          image.frameSize.width,
          image.frameSize.height,
        );
      }
    }
    this.tintedFrames.set(key, canvas);
    return canvas;
  }
}
