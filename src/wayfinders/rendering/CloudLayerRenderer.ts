import type Phaser from "phaser";
import { CLOUD_ASSET_PACKAGE, type CloudAssetPackage } from "../assets/CloudAssetCatalog";
import { seededValue } from "../world/SeededRandom";
import type { WorldGrid } from "../world/WorldGrid";
import {
  isKnowledgeOverlayDurablyClearInBounds,
  isKnowledgeOverlayFullyClearInBounds,
} from "./KnowledgeClearCoverage";
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

export interface CloudRouteEnvelope {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface CloudView {
  readonly descriptor: Readonly<CloudDescriptor>;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Sprite;
  readonly routeEnvelope: Readonly<CloudRouteEnvelope>;
  coverageRevision: string;
  clearOfFog: boolean;
  visibilityStartedAt: number | undefined;
}

export interface CloudLayerResourceTelemetry {
  readonly enabled: boolean;
  readonly chunkCapacity: number;
  readonly activeChunks: number;
  readonly activeClouds: number;
  readonly activeShadows: number;
  readonly clearCloudFootprints: number;
  readonly visibleClouds: number;
  readonly visibleShadows: number;
  readonly variantCounts: readonly number[];
  readonly peakActiveClouds: number;
  readonly peakActiveShadows: number;
  readonly totalCloudAllocations: number;
  readonly totalCloudReleases: number;
  readonly totalShadowAllocations: number;
  readonly totalShadowReleases: number;
  readonly stableFrameAllocations: number;
}

interface VisualFootprint {
  readonly center: Readonly<{ x: number; y: number }>;
  readonly displaySize: Readonly<{ width: number; height: number }>;
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
  // Bias the four candidates toward chunk corners so a revealed area spanning
  // neighboring chunks can admit a complete drift route without clustering.
  const positionX = (quadrantX === 0 ? 0.14 : 0.86) + lerp(-0.025, 0.025, sample(2));
  const positionY = (quadrantY === 0 ? 0.14 : 0.86) + lerp(-0.025, 0.025, sample(3));
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

function resolveVisualFootprint(
  spritePosition: Readonly<{ x: number; y: number }>,
  opaqueBounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  frameSize: Readonly<{ width: number; height: number }>,
  scale: Readonly<{ x: number; y: number }>,
  flipX: boolean,
): Readonly<VisualFootprint> {
  const horizontalOffset = (
    opaqueBounds.x + opaqueBounds.width / 2 - frameSize.width / 2
  ) * scale.x * (flipX ? -1 : 1);
  const verticalOffset = (
    opaqueBounds.y + opaqueBounds.height / 2 - frameSize.height / 2
  ) * scale.y;
  return {
    center: {
      x: spritePosition.x + horizontalOffset,
      y: spritePosition.y + verticalOffset,
    },
    displaySize: {
      width: opaqueBounds.width * scale.x,
      height: opaqueBounds.height * scale.y,
    },
  };
}

function rgbTint(rgb: Readonly<{ red: number; green: number; blue: number }>): number {
  return (rgb.red << 16) | (rgb.green << 8) | rgb.blue;
}

export function resolveCloudRouteEnvelope(
  descriptor: Readonly<CloudDescriptor>,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): Readonly<CloudRouteEnvelope> {
  const { image, presentation } = cloudPackage;
  const opaqueBounds = image.opaqueBounds[descriptor.frame];
  if (!opaqueBounds) throw new RangeError(`Missing opaque bounds for cloud frame ${descriptor.frame}`);
  const cloud = resolveVisualFootprint(
    { x: descriptor.baseX, y: descriptor.baseY },
    opaqueBounds,
    image.frameSize,
    { x: descriptor.scale, y: descriptor.scale },
    descriptor.flipX,
  );
  const shadow = resolveVisualFootprint(
    {
      x: descriptor.baseX + presentation.shadow.offsetPixels.x,
      y: descriptor.baseY + presentation.shadow.offsetPixels.y,
    },
    opaqueBounds,
    image.frameSize,
    {
      x: descriptor.scale * presentation.shadow.scale.x,
      y: descriptor.scale * presentation.shadow.scale.y,
    },
    descriptor.flipX,
  );
  const driftX = Math.abs(descriptor.driftAmplitudeX);
  const driftY = Math.abs(descriptor.driftAmplitudeY);
  return Object.freeze({
    minX: Math.min(
      cloud.center.x - cloud.displaySize.width / 2,
      shadow.center.x - shadow.displaySize.width / 2,
    ) - driftX,
    minY: Math.min(
      cloud.center.y - cloud.displaySize.height / 2,
      shadow.center.y - shadow.displaySize.height / 2,
    ) - driftY,
    maxX: Math.max(
      cloud.center.x + cloud.displaySize.width / 2,
      shadow.center.x + shadow.displaySize.width / 2,
    ) + driftX,
    maxY: Math.max(
      cloud.center.y + cloud.displaySize.height / 2,
      shadow.center.y + shadow.displaySize.height / 2,
    ) + driftY,
  });
}

export function isCloudRouteEnvelopeDurablyClear(
  world: WorldGrid,
  envelope: Readonly<CloudRouteEnvelope>,
  revealedIslandIds: ReadonlySet<number>,
  tileSize: number,
  paddingTiles: number,
): boolean {
  return isKnowledgeOverlayDurablyClearInBounds(world, {
    minX: envelope.minX / tileSize,
    minY: envelope.minY / tileSize,
    maxX: envelope.maxX / tileSize,
    maxY: envelope.maxY / tileSize,
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
  private peakActiveShadows = 0;
  private totalCloudAllocations = 0;
  private totalCloudReleases = 0;
  private totalShadowAllocations = 0;
  private totalShadowReleases = 0;
  private lastSyncAllocationCount = 0;
  private lastWorld: WorldGrid | undefined;

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
  ): void {
    if (!this.enabled) return;
    const allocationsBefore = this.totalCloudAllocations + this.totalShadowAllocations;
    const worldChanged = this.lastWorld !== world;
    this.lastWorld = world;
    const coverageRevision = `${world.knowledgeVersion}:${revealedIslandsRevision}`;
    const { presentation } = this.cloudPackage;
    const tileSize = this.chunkSizePixels / world.chunkSize;
    for (const view of this.views.values()) {
      if (worldChanged) {
        view.coverageRevision = "";
        view.clearOfFog = false;
        view.visibilityStartedAt = undefined;
      }
      if (view.coverageRevision !== coverageRevision) {
        view.clearOfFog = isCloudRouteEnvelopeDurablyClear(
          world,
          view.routeEnvelope,
          revealedIslandIds,
          tileSize,
          presentation.clearPaddingTiles,
        );
        view.coverageRevision = coverageRevision;
        if (!view.clearOfFog) view.visibilityStartedAt = undefined;
      }

      const descriptor = view.descriptor;
      const phase = this.reducedMotion
        ? descriptor.phase
        : descriptor.phase + (timeMs / descriptor.driftPeriodMs) * TWO_PI;
      const x = descriptor.baseX + Math.cos(phase) * descriptor.driftAmplitudeX;
      const y = descriptor.baseY + Math.sin(phase) * descriptor.driftAmplitudeY;
      view.sprite.setPosition(x, y);
      view.shadow.setPosition(
        x + presentation.shadow.offsetPixels.x,
        y + presentation.shadow.offsetPixels.y,
      );
      if (!view.clearOfFog) {
        view.visibilityStartedAt = undefined;
        view.sprite.setVisible(false);
        view.shadow.setVisible(false);
        continue;
      }
      if (view.visibilityStartedAt === undefined) view.visibilityStartedAt = timeMs;
      const fadeDurationMs = presentation.fadeInSeconds * 1000;
      const fade = fadeDurationMs === 0
        ? 1
        : Math.min(1, Math.max(0, (timeMs - view.visibilityStartedAt) / fadeDurationMs));
      view.sprite.setAlpha(descriptor.alpha * fade).setVisible(true);
      view.shadow
        .setAlpha(descriptor.alpha * presentation.shadow.opacityMultiplier * fade)
        .setVisible(true);
    }
    this.lastSyncAllocationCount = (
      this.totalCloudAllocations + this.totalShadowAllocations - allocationsBefore
    );
  }

  getResourceTelemetry(): Readonly<CloudLayerResourceTelemetry> {
    const variantCounts = Array.from({ length: this.cloudPackage.image.frameCount }, () => 0);
    let clearCloudFootprints = 0;
    let visibleClouds = 0;
    let visibleShadows = 0;
    for (const { descriptor, sprite, shadow, clearOfFog } of this.views.values()) {
      variantCounts[descriptor.frame]++;
      if (clearOfFog) clearCloudFootprints++;
      if (sprite.visible && sprite.alpha > 0) visibleClouds++;
      if (shadow.visible && shadow.alpha > 0) visibleShadows++;
    }
    return Object.freeze({
      enabled: this.enabled,
      chunkCapacity: this.chunkCapacity,
      activeChunks: this.activeEntries.size,
      activeClouds: this.views.size,
      activeShadows: this.views.size,
      clearCloudFootprints,
      visibleClouds,
      visibleShadows,
      variantCounts: Object.freeze(variantCounts),
      peakActiveClouds: this.peakActiveClouds,
      peakActiveShadows: this.peakActiveShadows,
      totalCloudAllocations: this.totalCloudAllocations,
      totalCloudReleases: this.totalCloudReleases,
      totalShadowAllocations: this.totalShadowAllocations,
      totalShadowReleases: this.totalShadowReleases,
      stableFrameAllocations: this.lastSyncAllocationCount,
    });
  }

  destroy(): void {
    this.destroyViews();
    this.activeEntries.clear();
    this.chunkCapacity = 0;
    this.lastWorld = undefined;
  }

  private createActiveViews(): void {
    if (!this.scene.textures.exists(this.cloudPackage.image.textureKey)) return;
    for (const entry of this.activeEntries.values()) {
      for (let slot = 0; slot < this.cloudPackage.presentation.candidatesPerChunk; slot++) {
        const descriptor = resolveCloudDescriptor(this.seed, entry, this.chunkSizePixels, this.cloudPackage, slot);
        if (!descriptor || this.views.has(descriptor.id)) continue;
        const { image, presentation } = this.cloudPackage;
        const shadow = this.scene.add.sprite(
          descriptor.baseX + presentation.shadow.offsetPixels.x,
          descriptor.baseY + presentation.shadow.offsetPixels.y,
          image.textureKey,
          descriptor.frame,
        ).setOrigin(0.5)
          .setScale(
            descriptor.scale * presentation.shadow.scale.x,
            descriptor.scale * presentation.shadow.scale.y,
          )
          .setAlpha(0)
          .setFlipX(descriptor.flipX)
          .setTint(rgbTint(presentation.shadow.tintRgb))
          .setDepth(presentation.shadow.depth)
          .setName(`${descriptor.id}:shadow`)
          .setVisible(false);
        const sprite = this.scene.add.sprite(
          descriptor.baseX,
          descriptor.baseY,
          image.textureKey,
          descriptor.frame,
        ).setOrigin(0.5)
          .setScale(descriptor.scale)
          .setAlpha(0)
          .setFlipX(descriptor.flipX)
          .setDepth(presentation.depth)
          .setName(descriptor.id)
          .setVisible(false);
        this.views.set(descriptor.id, {
          descriptor,
          sprite,
          shadow,
          routeEnvelope: resolveCloudRouteEnvelope(descriptor, this.cloudPackage),
          coverageRevision: "",
          clearOfFog: false,
          visibilityStartedAt: undefined,
        });
        this.totalCloudAllocations++;
        this.totalShadowAllocations++;
        this.peakActiveClouds = Math.max(this.peakActiveClouds, this.views.size);
        this.peakActiveShadows = Math.max(this.peakActiveShadows, this.views.size);
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
    view.shadow.destroy();
    this.views.delete(key);
    this.totalCloudReleases++;
    this.totalShadowReleases++;
  }

  private assertResourceCap(): void {
    const capacity = this.chunkCapacity * this.cloudPackage.presentation.candidatesPerChunk;
    if (this.views.size > capacity) {
      throw new Error(`Cloud layer resource cap exceeded: ${this.views.size}/${capacity}`);
    }
  }
}
