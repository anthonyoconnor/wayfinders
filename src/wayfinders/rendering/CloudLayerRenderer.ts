import type Phaser from "phaser";
import {
  CLOUD_ASSET_PACKAGE,
  CLOUD_PACKAGE_CANDIDATES_MAXIMUM,
  resolveActiveCloudAssetFrame,
  type CloudAssetPackage,
} from "../assets/CloudAssetCatalog";
import { seededValue } from "../world/SeededRandom";
import type { WorldGrid } from "../world/WorldGrid";
import { isKnowledgeOverlayFullyClearInBounds } from "./KnowledgeClearCoverage";
import type { ActiveChunkDelta, ActiveChunkEntry } from "./activation";

const CLOUD_NAMESPACE = 0x43_4c_44_31;
const TWO_PI = Math.PI * 2;
export const CLOUD_FREQUENCY_MINIMUM = 0;
export const CLOUD_FREQUENCY_MAXIMUM = CLOUD_PACKAGE_CANDIDATES_MAXIMUM;

export interface CloudDescriptor {
  readonly id: string;
  readonly ownerChunkKey: string;
  readonly frame: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly scale: number;
  readonly alpha: number;
  readonly tint: number;
  readonly flipX: boolean;
  readonly driftAmplitudeX: number;
  readonly driftAmplitudeY: number;
  readonly driftPeriodMs: number;
  readonly phase: number;
}

export interface CloudFootprintEnvelope {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface CloudMotionSample {
  readonly x: number;
  readonly y: number;
  readonly routeFade: number;
}

interface CloudView {
  readonly descriptor: Readonly<CloudDescriptor>;
  readonly ownerViewKey: string;
  readonly imageOffset: Readonly<{ x: number; y: number }>;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Sprite;
  coverageRevision: string;
  clearOfFog: boolean;
  visibilityStartedAt: number | undefined;
}

export interface CloudLayerResourceTelemetry {
  readonly enabled: boolean;
  readonly cloudsPerChunk: number;
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

function radicalInverse(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let remaining = index;
  while (remaining > 0) {
    result += (remaining % base) * fraction;
    remaining = Math.floor(remaining / base);
    fraction /= base;
  }
  return result;
}

export function resolveCloudDescriptor(
  seed: number,
  entry: Readonly<ActiveChunkEntry>,
  chunkSizePixels: number,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
  slot = 0,
): Readonly<CloudDescriptor> | undefined {
  const { x: chunkX, y: chunkY } = entry.canonicalChunk;
  const slotSeed = seed + CLOUD_NAMESPACE + slot * 7_919;
  if (seededValue(slotSeed, chunkX, chunkY) >= cloudPackage.presentation.chunkDensity) return undefined;
  const sample = (sampleSlot: number) => seededValue(slotSeed + sampleSlot * 977, chunkX, chunkY);
  // A low-discrepancy sequence keeps every existing slot stable when the live
  // frequency changes while distributing additional candidates across a chunk.
  const positionX = Math.min(0.92, Math.max(
    0.08,
    lerp(0.12, 0.88, radicalInverse(slot + 1, 2)) + lerp(-0.025, 0.025, sample(2)),
  ));
  const positionY = Math.min(0.92, Math.max(
    0.08,
    lerp(0.12, 0.88, radicalInverse(slot + 1, 3)) + lerp(-0.025, 0.025, sample(3)),
  ));
  const frameOffset = Math.floor(
    seededValue(seed + CLOUD_NAMESPACE + 13, chunkX, chunkY) * cloudPackage.image.frameCount,
  );
  const frame = resolveActiveCloudAssetFrame(
    (frameOffset + slot) % cloudPackage.image.frameCount,
    cloudPackage,
  );
  if (frame === undefined) return undefined;
  const amplitude = lerp(
    cloudPackage.presentation.driftAmplitudePixels.minimum,
    cloudPackage.presentation.driftAmplitudePixels.maximum,
    sample(7),
  );
  return Object.freeze({
    id: `cloud:${chunkX},${chunkY}:${slot}`,
    ownerChunkKey: `${chunkX},${chunkY}`,
    frame,
    baseX: (chunkX + positionX) * chunkSizePixels,
    baseY: (chunkY + positionY) * chunkSizePixels,
    scale: lerp(cloudPackage.presentation.scale.minimum, cloudPackage.presentation.scale.maximum, sample(4)),
    alpha: lerp(cloudPackage.presentation.opacity.minimum, cloudPackage.presentation.opacity.maximum, sample(5)),
    tint: rgbTint(cloudPackage.presentation.cloudTintsRgb[
      Math.min(
        cloudPackage.presentation.cloudTintsRgb.length - 1,
        Math.floor(sample(13) * cloudPackage.presentation.cloudTintsRgb.length),
      )
    ]!),
    flipX: sample(6) < 0.5,
    driftAmplitudeX: amplitude * (sample(12) < 0.5 ? -1 : 1),
    driftAmplitudeY: amplitude * lerp(0.18, 0.38, sample(8)) * (sample(9) < 0.5 ? -1 : 1),
    driftPeriodMs: lerp(
      cloudPackage.presentation.driftPeriodSeconds.minimum,
      cloudPackage.presentation.driftPeriodSeconds.maximum,
      sample(10),
    ) * 1000,
    phase: sample(11) * TWO_PI,
  });
}

/**
 * Resolves the exact descriptor set the runtime owns for one canonical chunk.
 * Asset tooling uses this renderer-neutral seam so its live world preview stays
 * in lockstep with the game's seeded layout rules.
 */
export function resolveCloudDescriptorsForChunk(
  seed: number,
  entry: Readonly<ActiveChunkEntry>,
  chunkSizePixels: number,
  frequency: number,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): readonly Readonly<CloudDescriptor>[] {
  if (!Number.isInteger(frequency)
    || frequency < CLOUD_FREQUENCY_MINIMUM
    || frequency > CLOUD_FREQUENCY_MAXIMUM) {
    throw new RangeError(
      `Cloud frequency must be an integer from ${CLOUD_FREQUENCY_MINIMUM} through ${CLOUD_FREQUENCY_MAXIMUM}`,
    );
  }
  const descriptors: Readonly<CloudDescriptor>[] = [];
  for (let slot = 0; slot < frequency; slot++) {
    const descriptor = resolveCloudDescriptor(seed, entry, chunkSizePixels, cloudPackage, slot);
    if (descriptor) descriptors.push(descriptor);
  }
  return Object.freeze(descriptors);
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

export function resolveCloudEnvelopeAtPosition(
  descriptor: Readonly<CloudDescriptor>,
  position: Readonly<{ x: number; y: number }>,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): Readonly<CloudFootprintEnvelope> {
  const { image, presentation } = cloudPackage;
  const opaqueBounds = image.opaqueBounds[descriptor.frame];
  if (!opaqueBounds) throw new RangeError(`Missing opaque bounds for cloud frame ${descriptor.frame}`);
  const cloud = resolveVisualFootprint(
    position,
    opaqueBounds,
    image.frameSize,
    { x: descriptor.scale, y: descriptor.scale },
    descriptor.flipX,
  );
  const shadow = resolveVisualFootprint(
    {
      x: position.x + presentation.shadow.offsetPixels.x,
      y: position.y + presentation.shadow.offsetPixels.y,
    },
    opaqueBounds,
    image.frameSize,
    {
      x: descriptor.scale * presentation.shadow.scale.x,
      y: descriptor.scale * presentation.shadow.scale.y,
    },
    descriptor.flipX,
  );
  return Object.freeze({
    minX: Math.min(
      cloud.center.x - cloud.displaySize.width / 2,
      shadow.center.x - shadow.displaySize.width / 2,
    ),
    minY: Math.min(
      cloud.center.y - cloud.displaySize.height / 2,
      shadow.center.y - shadow.displaySize.height / 2,
    ),
    maxX: Math.max(
      cloud.center.x + cloud.displaySize.width / 2,
      shadow.center.x + shadow.displaySize.width / 2,
    ),
    maxY: Math.max(
      cloud.center.y + cloud.displaySize.height / 2,
      shadow.center.y + shadow.displaySize.height / 2,
    ),
  });
}

export function isCloudEnvelopeFullyClear(
  world: WorldGrid,
  envelope: Readonly<CloudFootprintEnvelope>,
  revealedIslandIds: ReadonlySet<number>,
  tileSize: number,
  paddingTiles: number,
): boolean {
  return isKnowledgeOverlayFullyClearInBounds(world, {
    minX: envelope.minX / tileSize,
    minY: envelope.minY / tileSize,
    maxX: envelope.maxX / tileSize,
    maxY: envelope.maxY / tileSize,
  }, revealedIslandIds, paddingTiles);
}

function cloudCoverageRevision(
  world: WorldGrid,
  revealedIslandsRevision: number,
  envelope: Readonly<CloudFootprintEnvelope>,
  tileSize: number,
  paddingTiles: number,
): string {
  return [
    world.knowledgeVersion,
    world.visibilityVersion,
    revealedIslandsRevision,
    Math.floor(envelope.minX / tileSize) - paddingTiles,
    Math.floor(envelope.minY / tileSize) - paddingTiles,
    Math.ceil(envelope.maxX / tileSize) + paddingTiles,
    Math.ceil(envelope.maxY / tileSize) + paddingTiles,
  ].join(":");
}

function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function resolveCloudMotion(
  descriptor: Readonly<CloudDescriptor>,
  timeMs: number,
  reducedMotion: boolean,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): Readonly<CloudMotionSample> {
  const phaseFraction = descriptor.phase / TWO_PI;
  const rawCycle = reducedMotion ? phaseFraction : phaseFraction + timeMs / descriptor.driftPeriodMs;
  const cycle = ((rawCycle % 1) + 1) % 1;
  const routePosition = cycle * 2 - 1;
  const fadeFraction = cloudPackage.presentation.routeFadeFraction;
  const routeFade = reducedMotion || fadeFraction === 0
    ? 1
    : smoothstep(Math.min(cycle, 1 - cycle) / fadeFraction);
  return Object.freeze({
    x: descriptor.baseX + routePosition * descriptor.driftAmplitudeX,
    y: descriptor.baseY + routePosition * descriptor.driftAmplitudeY,
    routeFade,
  });
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
  private motionEpochMs: number | undefined;
  private frequency: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion = false,
    private readonly cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
  ) {
    this.frequency = cloudPackage.presentation.candidatesPerChunk;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get cloudsPerChunk(): number {
    return this.frequency;
  }

  setEnabled(enabled: boolean): boolean {
    if (this.enabled === enabled) return false;
    this.enabled = enabled;
    if (enabled) this.createActiveViews();
    else this.destroyViews();
    return true;
  }

  setCloudsPerChunk(frequency: number): boolean {
    if (!Number.isInteger(frequency)
      || frequency < CLOUD_FREQUENCY_MINIMUM
      || frequency > CLOUD_FREQUENCY_MAXIMUM) {
      throw new RangeError(
        `Cloud frequency must be an integer from ${CLOUD_FREQUENCY_MINIMUM} through ${CLOUD_FREQUENCY_MAXIMUM}`,
      );
    }
    if (this.frequency === frequency) return false;
    this.destroyViews();
    this.frequency = frequency;
    if (this.enabled) this.createActiveViews();
    this.assertResourceCap();
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

    const desiredKeys = new Set(delta.active.map(({ viewKey }) => viewKey));
    for (const { viewKey } of delta.deactivated) this.destroyImageViews(viewKey);
    for (const [key, view] of [...this.views.entries()]) {
      if (!desiredKeys.has(view.ownerViewKey)) this.destroyView(key);
    }
    this.activeEntries.clear();
    for (const entry of delta.active) this.activeEntries.set(entry.viewKey, entry);
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
    if (worldChanged || this.motionEpochMs === undefined) this.motionEpochMs = timeMs;
    const motionTimeMs = timeMs - this.motionEpochMs;
    const { presentation } = this.cloudPackage;
    const tileSize = this.chunkSizePixels / world.chunkSize;
    for (const view of this.views.values()) {
      if (worldChanged) {
        view.coverageRevision = "";
        view.clearOfFog = false;
        view.visibilityStartedAt = undefined;
      }
      const descriptor = view.descriptor;
      const motion = resolveCloudMotion(descriptor, motionTimeMs, this.reducedMotion, this.cloudPackage);
      const imageMotion = {
        x: motion.x + view.imageOffset.x,
        y: motion.y + view.imageOffset.y,
      };
      const currentEnvelope = resolveCloudEnvelopeAtPosition(descriptor, imageMotion, this.cloudPackage);
      const coverageRevision = cloudCoverageRevision(
        world,
        revealedIslandsRevision,
        currentEnvelope,
        tileSize,
        presentation.clearPaddingTiles,
      );
      if (view.coverageRevision !== coverageRevision) {
        view.clearOfFog = isCloudEnvelopeFullyClear(
          world,
          currentEnvelope,
          revealedIslandIds,
          tileSize,
          presentation.clearPaddingTiles,
        );
        view.coverageRevision = coverageRevision;
        if (!view.clearOfFog) view.visibilityStartedAt = undefined;
      }

      const { x, y } = imageMotion;
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
      const fadeDurationMs = presentation.fadeInSeconds * 1000;
      if (view.visibilityStartedAt === undefined) {
        view.visibilityStartedAt = timeMs;
      }
      const activationFade = fadeDurationMs === 0
        ? 1
        : Math.min(1, Math.max(0, (timeMs - view.visibilityStartedAt) / fadeDurationMs));
      const fade = activationFade * motion.routeFade;
      view.sprite.setAlpha(descriptor.alpha * fade).setVisible(fade > 0);
      view.shadow
        .setAlpha(descriptor.alpha * presentation.shadow.opacityMultiplier * fade)
        .setVisible(fade > 0);
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
      cloudsPerChunk: this.frequency,
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
    this.motionEpochMs = undefined;
  }

  private createActiveViews(): void {
    if (!this.scene.textures.exists(this.cloudPackage.image.textureKey)) return;
    for (const entry of this.activeEntries.values()) {
      for (const descriptor of resolveCloudDescriptorsForChunk(
        this.seed,
        entry,
        this.chunkSizePixels,
        this.frequency,
        this.cloudPackage,
      )) {
        this.createView(descriptor, entry);
      }
    }
    this.assertResourceCap();
  }

  private createView(
    descriptor: Readonly<CloudDescriptor>,
    entry: Readonly<ActiveChunkEntry>,
  ): void {
    const viewKey = `${descriptor.id}@${entry.viewKey}`;
    if (this.views.has(viewKey)) return;
    const { image, presentation } = this.cloudPackage;
    const shadow = this.scene.add.sprite(
      descriptor.baseX + entry.imageOffset.x + presentation.shadow.offsetPixels.x,
      descriptor.baseY + entry.imageOffset.y + presentation.shadow.offsetPixels.y,
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
      .setName(`${viewKey}:shadow`)
      .setVisible(false);
    const sprite = this.scene.add.sprite(
      descriptor.baseX + entry.imageOffset.x,
      descriptor.baseY + entry.imageOffset.y,
      image.textureKey,
      descriptor.frame,
    ).setOrigin(0.5)
      .setScale(descriptor.scale)
      .setAlpha(0)
      .setFlipX(descriptor.flipX)
      .setTint(descriptor.tint)
      .setDepth(presentation.depth)
      .setName(viewKey)
      .setVisible(false);
    this.views.set(viewKey, {
      descriptor,
      ownerViewKey: entry.viewKey,
      imageOffset: Object.freeze({ ...entry.imageOffset }),
      sprite,
      shadow,
      coverageRevision: "",
      clearOfFog: false,
      visibilityStartedAt: undefined,
    });
    this.totalCloudAllocations++;
    this.totalShadowAllocations++;
    this.peakActiveClouds = Math.max(this.peakActiveClouds, this.views.size);
    this.peakActiveShadows = Math.max(this.peakActiveShadows, this.views.size);
  }

  private destroyViews(): void {
    for (const key of [...this.views.keys()]) this.destroyView(key);
  }

  private destroyImageViews(ownerViewKey: string): void {
    for (const [key, view] of [...this.views.entries()]) {
      if (view.ownerViewKey === ownerViewKey) this.destroyView(key);
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
    const capacity = this.chunkCapacity * this.frequency;
    if (this.views.size > capacity) {
      throw new Error(`Cloud layer resource cap exceeded: ${this.views.size}/${capacity}`);
    }
  }
}
