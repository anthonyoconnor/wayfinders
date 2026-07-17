import type Phaser from "phaser";
import { CLOUD_ASSET_PACKAGE, type CloudAssetPackage } from "../assets/CloudAssetCatalog";
import { seededValue } from "../world/SeededRandom";
import type { WorldGrid } from "../world/WorldGrid";
import { isKnowledgeOverlayFullyClearInBounds } from "./KnowledgeClearCoverage";
import type { ActiveChunkDelta, ActiveChunkEntry } from "./activation";

const CLOUD_NAMESPACE = 0x43_4c_44_31;
const TWO_PI = Math.PI * 2;

export interface CloudDescriptor {
  readonly id: string;
  readonly ownerChunkKey: string;
  readonly frame: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly scale: number;
  readonly alpha: number;
  readonly flipX: boolean;
  readonly driftAmplitudeX: number;
  readonly driftAmplitudeY: number;
  readonly driftPeriodMs: number;
  readonly phase: number;
}

interface CloudView {
  readonly descriptor: Readonly<CloudDescriptor>;
  readonly sprite: Phaser.GameObjects.Sprite;
  coverageSignature: string;
  coverageRevision: string;
  clearOfFog: boolean;
}

export interface CloudLayerResourceTelemetry {
  readonly enabled: boolean;
  readonly chunkCapacity: number;
  readonly activeChunks: number;
  readonly activeClouds: number;
  readonly clearCloudFootprints: number;
  readonly visibleClouds: number;
  readonly variantCounts: readonly number[];
  readonly peakActiveClouds: number;
  readonly totalCloudAllocations: number;
  readonly totalCloudReleases: number;
  readonly stableFrameAllocations: number;
}

function lerp(minimum: number, maximum: number, amount: number): number {
  return minimum + (maximum - minimum) * amount;
}

export function resolveCloudDescriptor(
  seed: number,
  entry: Readonly<ActiveChunkEntry>,
  chunkSizePixels: number,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
  slot = 0,
): Readonly<CloudDescriptor> | undefined {
  const { x: chunkX, y: chunkY } = entry.coordinate;
  const slotSeed = seed + CLOUD_NAMESPACE + slot * 7_919;
  if (seededValue(slotSeed, chunkX, chunkY) >= cloudPackage.presentation.chunkDensity) return undefined;
  const sample = (sampleSlot: number) => seededValue(slotSeed + sampleSlot * 977, chunkX, chunkY);
  const quadrantX = slot % 2;
  const quadrantY = Math.floor(slot / 2) % 2;
  const positionX = (quadrantX === 0 ? 0.22 : 0.78) + lerp(-0.045, 0.045, sample(2));
  const positionY = (quadrantY === 0 ? 0.22 : 0.78) + lerp(-0.045, 0.045, sample(3));
  const frameOffset = Math.floor(
    seededValue(seed + CLOUD_NAMESPACE + 13, chunkX, chunkY) * cloudPackage.image.frameCount,
  );
  const amplitude = lerp(
    cloudPackage.presentation.driftAmplitudePixels.minimum,
    cloudPackage.presentation.driftAmplitudePixels.maximum,
    sample(7),
  );
  return Object.freeze({
    id: `cloud:${chunkX},${chunkY}:${slot}`,
    ownerChunkKey: entry.key,
    frame: (frameOffset + slot) % cloudPackage.image.frameCount,
    baseX: (chunkX + positionX) * chunkSizePixels,
    baseY: (chunkY + positionY) * chunkSizePixels,
    scale: lerp(cloudPackage.presentation.scale.minimum, cloudPackage.presentation.scale.maximum, sample(4)),
    alpha: lerp(cloudPackage.presentation.opacity.minimum, cloudPackage.presentation.opacity.maximum, sample(5)),
    flipX: sample(6) < 0.5,
    driftAmplitudeX: amplitude,
    driftAmplitudeY: amplitude * lerp(0.18, 0.38, sample(8)) * (sample(9) < 0.5 ? -1 : 1),
    driftPeriodMs: lerp(
      cloudPackage.presentation.driftPeriodSeconds.minimum,
      cloudPackage.presentation.driftPeriodSeconds.maximum,
      sample(10),
    ) * 1000,
    phase: sample(11) * TWO_PI,
  });
}

export function isCloudFootprintFullyClear(
  world: WorldGrid,
  center: Readonly<{ x: number; y: number }>,
  displaySize: Readonly<{ width: number; height: number }>,
  revealedIslandIds: ReadonlySet<number>,
  tileSize: number,
  paddingTiles: number,
): boolean {
  return isKnowledgeOverlayFullyClearInBounds(world, {
    minX: (center.x - displaySize.width / 2) / tileSize,
    minY: (center.y - displaySize.height / 2) / tileSize,
    maxX: (center.x + displaySize.width / 2) / tileSize,
    maxY: (center.y + displaySize.height / 2) / tileSize,
  }, revealedIslandIds, paddingTiles);
}

/** Independent, deterministic, chunk-bounded atmosphere presentation. */
export class CloudLayerRenderer {
  private readonly views = new Map<string, CloudView>();
  private readonly activeEntries = new Map<string, Readonly<ActiveChunkEntry>>();
  private enabled = true;
  private seed = 0;
  private chunkSizePixels = 0;
  private chunkCapacity = 0;
  private peakActiveClouds = 0;
  private totalCloudAllocations = 0;
  private totalCloudReleases = 0;
  private lastSyncAllocationCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion = false,
    private readonly cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): boolean {
    if (this.enabled === enabled) return false;
    this.enabled = enabled;
    if (enabled) this.createActiveViews();
    else this.destroyViews();
    return true;
  }

  applyActiveChunkDelta(
    delta: Readonly<ActiveChunkDelta>,
    seed: number,
    chunkSizePixels: number,
  ): void {
    this.chunkCapacity = delta.telemetry.capacity;
    const worldChanged = this.seed !== seed || this.chunkSizePixels !== chunkSizePixels;
    if (worldChanged) this.destroyViews();
    this.seed = seed;
    this.chunkSizePixels = chunkSizePixels;

    const desiredKeys = new Set(delta.active.map(({ key }) => key));
    for (const { key } of delta.deactivated) this.destroyChunkViews(key);
    for (const [key, view] of [...this.views.entries()]) {
      if (!desiredKeys.has(view.descriptor.ownerChunkKey)) this.destroyView(key);
    }
    this.activeEntries.clear();
    for (const entry of delta.active) this.activeEntries.set(entry.key, entry);
    if (this.enabled) this.createActiveViews();
    this.assertResourceCap();
  }

  sync(
    world: WorldGrid,
    revealedIslandIds: ReadonlySet<number>,
    revealedIslandsRevision: number,
    timeMs: number,
    playerWorldPosition: Readonly<{ x: number; y: number }>,
  ): void {
    if (!this.enabled) return;
    const allocationsBefore = this.totalCloudAllocations;
    const coverageRevision = `${world.knowledgeVersion}:${world.visibilityVersion}:${revealedIslandsRevision}`;
    const { image, presentation } = this.cloudPackage;
    const tileSize = this.chunkSizePixels / world.chunkSize;
    for (const view of this.views.values()) {
      const descriptor = view.descriptor;
      const phase = this.reducedMotion
        ? descriptor.phase
        : descriptor.phase + (timeMs / descriptor.driftPeriodMs) * TWO_PI;
      const x = descriptor.baseX + Math.cos(phase) * descriptor.driftAmplitudeX;
      const y = descriptor.baseY + Math.sin(phase) * descriptor.driftAmplitudeY;
      view.sprite.setPosition(x, y);
      const opaqueBounds = image.opaqueBounds[descriptor.frame];
      if (!opaqueBounds) throw new RangeError(`Missing opaque bounds for cloud frame ${descriptor.frame}`);
      const horizontalOffset = (
        opaqueBounds.x + opaqueBounds.width / 2 - image.frameSize.width / 2
      ) * descriptor.scale * (descriptor.flipX ? -1 : 1);
      const verticalOffset = (
        opaqueBounds.y + opaqueBounds.height / 2 - image.frameSize.height / 2
      ) * descriptor.scale;
      const coverageCenter = { x: x + horizontalOffset, y: y + verticalOffset };
      const displaySize = {
        width: opaqueBounds.width * descriptor.scale,
        height: opaqueBounds.height * descriptor.scale,
      };
      const tileBoundsSignature = [
        Math.floor((coverageCenter.x - displaySize.width / 2) / tileSize),
        Math.floor((coverageCenter.y - displaySize.height / 2) / tileSize),
        Math.ceil((coverageCenter.x + displaySize.width / 2) / tileSize),
        Math.ceil((coverageCenter.y + displaySize.height / 2) / tileSize),
      ].join(":");
      if (view.coverageRevision !== coverageRevision || view.coverageSignature !== tileBoundsSignature) {
        view.clearOfFog = isCloudFootprintFullyClear(
          world,
          coverageCenter,
          displaySize,
          revealedIslandIds,
          tileSize,
          presentation.clearPaddingTiles,
        );
        view.coverageRevision = coverageRevision;
        view.coverageSignature = tileBoundsSignature;
      }
      const playerDistance = Math.hypot(x - playerWorldPosition.x, y - playerWorldPosition.y);
      view.sprite.setVisible(view.clearOfFog && playerDistance >= presentation.playerClearRadiusPixels);
    }
    this.lastSyncAllocationCount = this.totalCloudAllocations - allocationsBefore;
  }

  getResourceTelemetry(): Readonly<CloudLayerResourceTelemetry> {
    const variantCounts = Array.from({ length: this.cloudPackage.image.frameCount }, () => 0);
    let clearCloudFootprints = 0;
    let visibleClouds = 0;
    for (const { descriptor, sprite, clearOfFog } of this.views.values()) {
      variantCounts[descriptor.frame]++;
      if (clearOfFog) clearCloudFootprints++;
      if (sprite.visible) visibleClouds++;
    }
    return Object.freeze({
      enabled: this.enabled,
      chunkCapacity: this.chunkCapacity,
      activeChunks: this.activeEntries.size,
      activeClouds: this.views.size,
      clearCloudFootprints,
      visibleClouds,
      variantCounts: Object.freeze(variantCounts),
      peakActiveClouds: this.peakActiveClouds,
      totalCloudAllocations: this.totalCloudAllocations,
      totalCloudReleases: this.totalCloudReleases,
      stableFrameAllocations: this.lastSyncAllocationCount,
    });
  }

  destroy(): void {
    this.destroyViews();
    this.activeEntries.clear();
    this.chunkCapacity = 0;
  }

  private createActiveViews(): void {
    if (!this.scene.textures.exists(this.cloudPackage.image.textureKey)) return;
    for (const entry of this.activeEntries.values()) {
      for (let slot = 0; slot < this.cloudPackage.presentation.candidatesPerChunk; slot++) {
        const descriptor = resolveCloudDescriptor(this.seed, entry, this.chunkSizePixels, this.cloudPackage, slot);
        if (!descriptor || this.views.has(descriptor.id)) continue;
        const sprite = this.scene.add.sprite(
          descriptor.baseX,
          descriptor.baseY,
          this.cloudPackage.image.textureKey,
          descriptor.frame,
        ).setOrigin(0.5)
          .setScale(descriptor.scale)
          .setAlpha(descriptor.alpha)
          .setFlipX(descriptor.flipX)
          .setDepth(this.cloudPackage.presentation.depth)
          .setName(descriptor.id);
        this.views.set(descriptor.id, {
          descriptor,
          sprite,
          coverageSignature: "",
          coverageRevision: "",
          clearOfFog: false,
        });
        this.totalCloudAllocations++;
        this.peakActiveClouds = Math.max(this.peakActiveClouds, this.views.size);
      }
    }
    this.assertResourceCap();
  }

  private destroyViews(): void {
    for (const key of [...this.views.keys()]) this.destroyView(key);
  }

  private destroyChunkViews(ownerChunkKey: string): void {
    for (const [key, view] of [...this.views.entries()]) {
      if (view.descriptor.ownerChunkKey === ownerChunkKey) this.destroyView(key);
    }
  }

  private destroyView(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    view.sprite.destroy();
    this.views.delete(key);
    this.totalCloudReleases++;
  }

  private assertResourceCap(): void {
    const capacity = this.chunkCapacity * this.cloudPackage.presentation.candidatesPerChunk;
    if (this.views.size > capacity) {
      throw new Error(`Cloud layer resource cap exceeded: ${this.views.size}/${capacity}`);
    }
  }
}
