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
  readonly tint: number;
  readonly flipX: boolean;
  readonly driftAmplitudeX: number;
  readonly driftAmplitudeY: number;
  readonly driftPeriodMs: number;
  readonly phase: number;
  readonly initialFade: number;
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

interface HomeAtmosphereAnchor {
  readonly position: Readonly<{ x: number; y: number }>;
  readonly ownerChunkKey: string;
}

interface CloudView {
  readonly descriptor: Readonly<CloudDescriptor>;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Sprite;
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

function ownerChunkKeyAt(
  position: Readonly<{ x: number; y: number }>,
  chunkSizePixels: number,
): string {
  return `${Math.floor(position.x / chunkSizePixels)},${Math.floor(position.y / chunkSizePixels)}`;
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
    initialFade: 0,
  });
}

export function resolveOpeningCloudDescriptors(
  seed: number,
  ownerChunkKey: string,
  homeWorldPosition: Readonly<{ x: number; y: number }>,
  cloudPackage: Readonly<CloudAssetPackage> = CLOUD_ASSET_PACKAGE,
): readonly Readonly<CloudDescriptor>[] {
  const { image, presentation } = cloudPackage;
  const opening = presentation.openingClouds;
  const frameOffset = Math.floor(
    seededValue(seed + CLOUD_NAMESPACE + 0x48_4f_4d_45, 0, 0) * image.frameCount,
  );
  return Object.freeze(opening.offsetPixels.map((offset, slot) => {
    const slotSeed = seed + CLOUD_NAMESPACE + 0x48_4f_4d_45 + slot * 7_919;
    const sample = (sampleSlot: number) => seededValue(slotSeed + sampleSlot * 977, slot, 0);
    const amplitude = lerp(
      opening.driftAmplitudePixels.minimum,
      opening.driftAmplitudePixels.maximum,
      sample(1),
    );
    const openingPhase = lerp(0.24, 0.76, slot / Math.max(1, opening.offsetPixels.length - 1));
    const tintIndex = slot === 0
      ? 0
      : slot === opening.offsetPixels.length - 1
        ? presentation.cloudTintsRgb.length - 1
        : Math.floor((presentation.cloudTintsRgb.length - 1) / 2);
    return Object.freeze({
      id: `cloud:home:${slot}`,
      ownerChunkKey,
      frame: (frameOffset + slot) % image.frameCount,
      baseX: homeWorldPosition.x + offset.x,
      baseY: homeWorldPosition.y + offset.y,
      scale: lerp(
        opening.scale.minimum,
        opening.scale.maximum,
        slot / Math.max(1, opening.offsetPixels.length - 1),
      ),
      alpha: lerp(presentation.opacity.minimum, presentation.opacity.maximum, sample(3)),
      tint: rgbTint(presentation.cloudTintsRgb[tintIndex]!),
      flipX: sample(4) < 0.5,
      driftAmplitudeX: amplitude * (sample(5) < 0.5 ? -1 : 1),
      driftAmplitudeY: amplitude * lerp(0.2, 0.36, sample(6)) * (sample(7) < 0.5 ? -1 : 1),
      driftPeriodMs: lerp(
        opening.driftPeriodSeconds.minimum,
        opening.driftPeriodSeconds.maximum,
        sample(8),
      ) * 1000,
      phase: openingPhase * TWO_PI,
      initialFade: opening.initialFade,
    });
  }));
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
  private homeAnchor: Readonly<HomeAtmosphereAnchor> | undefined;

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
    homeWorldPosition?: Readonly<{ x: number; y: number }>,
  ): void {
    this.chunkCapacity = delta.telemetry.capacity;
    const worldChanged = this.seed !== seed || this.chunkSizePixels !== chunkSizePixels;
    const nextHomeAnchor = homeWorldPosition === undefined
      ? undefined
      : Object.freeze({
        position: Object.freeze({ x: homeWorldPosition.x, y: homeWorldPosition.y }),
        ownerChunkKey: ownerChunkKeyAt(homeWorldPosition, chunkSizePixels),
      });
    const homeChanged = this.homeAnchor?.position.x !== nextHomeAnchor?.position.x
      || this.homeAnchor?.position.y !== nextHomeAnchor?.position.y
      || this.homeAnchor?.ownerChunkKey !== nextHomeAnchor?.ownerChunkKey;
    if (worldChanged || homeChanged) this.destroyViews();
    this.seed = seed;
    this.chunkSizePixels = chunkSizePixels;
    this.homeAnchor = nextHomeAnchor;

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
      const currentEnvelope = resolveCloudEnvelopeAtPosition(descriptor, motion, this.cloudPackage);
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

      const { x, y } = motion;
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
        view.visibilityStartedAt = timeMs - fadeDurationMs * descriptor.initialFade;
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
    this.homeAnchor = undefined;
  }

  private createActiveViews(): void {
    if (!this.scene.textures.exists(this.cloudPackage.image.textureKey)) return;
    for (const entry of this.activeEntries.values()) {
      if (entry.key === this.homeAnchor?.ownerChunkKey) {
        for (const descriptor of resolveOpeningCloudDescriptors(
          this.seed,
          entry.key,
          this.homeAnchor.position,
          this.cloudPackage,
        )) this.createView(descriptor);
        continue;
      }
      for (let slot = 0; slot < this.cloudPackage.presentation.candidatesPerChunk; slot++) {
        const descriptor = resolveCloudDescriptor(this.seed, entry, this.chunkSizePixels, this.cloudPackage, slot);
        if (descriptor) this.createView(descriptor);
      }
    }
    this.assertResourceCap();
  }

  private createView(descriptor: Readonly<CloudDescriptor>): void {
    if (this.views.has(descriptor.id)) return;
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
      .setTint(descriptor.tint)
      .setDepth(presentation.depth)
      .setName(descriptor.id)
      .setVisible(false);
    this.views.set(descriptor.id, {
      descriptor,
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
