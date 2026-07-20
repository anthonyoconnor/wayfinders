import { describe, expect, it } from "vitest";
import {
  activeCloudAssetFrames,
  CLOUD_ASSET_PACKAGE,
  cloudAssetVariantEntries,
  preloadCloudAsset,
  resolveActiveCloudAssetFrame,
  type CloudAssetPackage,
  validateCloudAssetPackage,
} from "../src/wayfinders/assets/CloudAssetCatalog";
import {
  CloudLayerRenderer,
  isCloudEnvelopeFullyClear,
  isCloudFootprintFullyClear,
  resolveCloudDescriptorsForChunk,
  resolveCloudEnvelopeAtPosition,
  resolveCloudDescriptor,
  resolveCloudMotion,
} from "../src/wayfinders/rendering/CloudLayerRenderer";
import { ActiveChunkSet, type ActiveChunkEntry } from "../src/wayfinders/rendering/activation";
import { gridToWorld } from "../src/wayfinders/world/CoordinateSystem";
import { KnowledgeState } from "../src/wayfinders/world/TileData";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  WorldTopology,
} from "../src/wayfinders/world/WorldTopology";
import { createWorldProfileConfig } from "./fixtures/worldProfiles";

const CLOUD_VARIANT_IDS = [
  "long-broken-wisp",
  "compact-uneven-cluster",
  "split-trailing-wisps",
  "shallow-crescent-bank",
  "twin-crowned-cluster",
  "notched-broad-bank",
  "tapered-wedge-bank",
  "three-tower-shelf",
  "bow-tie-bank",
  "forked-drift",
  "three-finger-fan",
  "crooked-crossbank",
  "hook-and-beads",
  "serpentine-ribbon",
  "open-ring-bank",
  "double-window-bank",
  "triangular-hollow-bank",
  "braided-channel-bank",
  "curled-three-arm-cluster",
  "stepped-trio",
  "paired-islands",
  "parallel-broken-bands",
  "arc-scatter",
  "staggered-front",
] as const;

function entry(x: number, y: number): Readonly<ActiveChunkEntry> {
  return {
    viewKey: `${x},${y}@0,0`,
    canonicalChunk: { x, y },
    imageOffset: { x: 0, y: 0 },
    band: "visible",
    ringDistance: 0,
    loadPriority: y * 100 + x,
  };
}

function supportedWorld(size = 32, chunkSize = 8): WorldGrid {
  const world = new WorldGrid(size, size, chunkSize, BOUNDED_WORLD_TOPOLOGY);
  world.replaceKnowledge(
    new Uint8Array(world.tileCount).fill(KnowledgeState.Supported),
    new Uint32Array(world.tileCount),
  );
  return world;
}

interface SpriteState {
  x: number;
  y: number;
  readonly frame: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  flipX: boolean;
  tint: number | undefined;
  depth: number;
  name: string;
  visible: boolean;
  destroyed: boolean;
}

function createSpriteScene(): Readonly<{ scene: unknown; sprites: SpriteState[] }> {
  const sprites: SpriteState[] = [];
  const scene = {
    textures: { exists: () => true },
    add: {
      sprite: (x: number, y: number, _texture: string, frame: number) => {
        const state: SpriteState = {
          x,
          y,
          frame,
          scaleX: 1,
          scaleY: 1,
          alpha: 1,
          flipX: false,
          tint: undefined,
          depth: 0,
          name: "",
          visible: true,
          destroyed: false,
        };
        sprites.push(state);
        const sprite = {
          visible: true,
          alpha: 1,
          setOrigin: () => sprite,
          setScale: (scaleX: number, scaleY = scaleX) => {
            state.scaleX = scaleX;
            state.scaleY = scaleY;
            return sprite;
          },
          setAlpha: (alpha: number) => {
            state.alpha = alpha;
            sprite.alpha = alpha;
            return sprite;
          },
          setFlipX: (flipX: boolean) => {
            state.flipX = flipX;
            return sprite;
          },
          setTint: (tint: number) => {
            state.tint = tint;
            return sprite;
          },
          setDepth: (depth: number) => {
            state.depth = depth;
            return sprite;
          },
          setName: (name: string) => {
            state.name = name;
            return sprite;
          },
          setPosition: (nextX: number, nextY: number) => {
            state.x = nextX;
            state.y = nextY;
            return sprite;
          },
          setVisible: (visible: boolean) => {
            state.visible = visible;
            sprite.visible = visible;
            return sprite;
          },
          destroy: () => { state.destroyed = true; },
        };
        return sprite;
      },
    },
  };
  return { scene, sprites };
}

type PresentationOverrides = Partial<Omit<CloudAssetPackage["presentation"], "shadow">>;
type ShadowOverrides = Partial<CloudAssetPackage["presentation"]["shadow"]>;

function testCloudPackage(
  presentationOverrides: PresentationOverrides = {},
  shadowOverrides: ShadowOverrides = {},
): Readonly<CloudAssetPackage> {
  const base = CLOUD_ASSET_PACKAGE;
  return {
    ...base,
    presentation: {
      ...base.presentation,
      candidatesPerChunk: 1,
      chunkDensity: 1,
      fadeInSeconds: 0,
      ...presentationOverrides,
      shadow: {
        ...base.presentation.shadow,
        ...shadowOverrides,
        offsetPixels: {
          ...base.presentation.shadow.offsetPixels,
          ...shadowOverrides.offsetPixels,
        },
        scale: {
          ...base.presentation.shadow.scale,
          ...shadowOverrides.scale,
        },
        tintRgb: {
          ...base.presentation.shadow.tintRgb,
          ...shadowOverrides.tintRgb,
        },
      },
    },
  };
}

function cloudPackageWithActiveFrames(
  activeFrames: readonly number[],
): Readonly<CloudAssetPackage> {
  const active = new Set(activeFrames);
  return {
    ...CLOUD_ASSET_PACKAGE,
    variants: CLOUD_ASSET_PACKAGE.variants.map((variant, frame) => (
      variant === null ? null : { ...variant, activeInGame: active.has(frame) }
    )),
  };
}

function oneChunkDelta(x = 1, y = 1): ReturnType<ActiveChunkSet["update"]> {
  const chunkSize = 32;
  const topology = new WorldTopology(
    Math.max(1, x + 1) * chunkSize,
    Math.max(1, y + 1) * chunkSize,
    32,
    chunkSize,
    BOUNDED_WORLD_TOPOLOGY,
  );
  const chunks = new ActiveChunkSet({
    topology,
    prefetchRing: 0,
    maxActiveChunks: 1,
  });
  return chunks.update({
    minX: x * chunkSize,
    minY: y * chunkSize,
    maxX: (x + 1) * chunkSize - 1,
    maxY: (y + 1) * chunkSize - 1,
  });
}

describe("cloud atmosphere assets and deterministic presentation", () => {
  it("renders canonical cloud motion in each seam image and releases aliases independently", () => {
    const world = new WorldGrid(4, 1, 4, WRAPPING_WORLD_TOPOLOGY);
    world.replaceKnowledge(
      new Uint8Array(world.tileCount).fill(KnowledgeState.Supported),
      new Uint32Array(world.tileCount),
    );
    const activeChunks = new ActiveChunkSet({
      topology: world.topology,
      prefetchRing: 0,
      maxActiveChunks: 2,
    });
    const { scene, sprites } = createSpriteScene();
    const renderer = new CloudLayerRenderer(
      scene as never,
      true,
      testCloudPackage({ candidatesPerChunk: 1, chunkDensity: 1 }),
    );
    renderer.applyActiveChunkDelta(
      activeChunks.update({ minX: -1, minY: 0, maxX: 0, maxY: 0 }),
      13_371,
      4 * 32,
    );
    renderer.sync(world, new Set(), 0, 0);

    const clouds = sprites.filter(({ name }) => name.startsWith("cloud:") && !name.endsWith(":shadow"));
    expect(clouds).toHaveLength(2);
    expect(Math.abs(clouds[1]!.x - clouds[0]!.x)).toBe(world.topology.pixelWidth);
    expect(clouds[0]!.y).toBe(clouds[1]!.y);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeChunks: 2,
      activeClouds: 2,
      activeShadows: 2,
    });

    renderer.applyActiveChunkDelta(
      activeChunks.update({ minX: 2, minY: 0, maxX: 2, maxY: 0 }),
      13_371,
      4 * 32,
    );
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeChunks: 1,
      activeClouds: 1,
      activeShadows: 1,
      totalCloudAllocations: 2,
      totalCloudReleases: 1,
    });
  });

  it("validates 24 stable cloud catalog slots and the reference-led presentation", () => {
    expect(validateCloudAssetPackage(CLOUD_ASSET_PACKAGE as never)).toBe(CLOUD_ASSET_PACKAGE);
    expect(CLOUD_ASSET_PACKAGE.contractVersion).toBe(3);
    expect(CLOUD_ASSET_PACKAGE.variants).toHaveLength(CLOUD_VARIANT_IDS.length);
    expect(CLOUD_ASSET_PACKAGE.image.opaqueBounds).toHaveLength(CLOUD_VARIANT_IDS.length);
    expect(cloudAssetVariantEntries()).toMatchObject(CLOUD_VARIANT_IDS.map((id, frame) => ({
      id,
      frame,
      activeInGame: true,
    })));
    expect(activeCloudAssetFrames()).toEqual(CLOUD_VARIANT_IDS.map((_, frame) => frame));
    expect(CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk).toBe(6);
    expect(CLOUD_ASSET_PACKAGE.presentation.opacity.minimum).toBeGreaterThanOrEqual(0.85);
    expect(CLOUD_ASSET_PACKAGE.presentation.opacity.maximum).toBeGreaterThanOrEqual(0.95);
    expect(CLOUD_ASSET_PACKAGE.presentation.opacity.maximum).toBeLessThanOrEqual(1);
    expect(CLOUD_ASSET_PACKAGE.presentation.scale.minimum).toBeLessThanOrEqual(0.22);
    expect(CLOUD_ASSET_PACKAGE.presentation.scale.maximum).toBeGreaterThanOrEqual(0.5);
    expect(CLOUD_ASSET_PACKAGE.presentation.cloudTintsRgb).toHaveLength(4);
    expect(CLOUD_ASSET_PACKAGE.presentation.cloudTintsRgb.at(-1)!.red).toBeGreaterThanOrEqual(200);
    expect(CLOUD_ASSET_PACKAGE.presentation.driftAmplitudePixels.minimum).toBeGreaterThanOrEqual(80);
    expect(CLOUD_ASSET_PACKAGE.presentation.driftPeriodSeconds.maximum).toBeLessThanOrEqual(180);
    expect(CLOUD_ASSET_PACKAGE.presentation.routeFadeFraction).toBeGreaterThan(0);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.depth).toBeGreaterThan(50);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.depth).toBeLessThan(CLOUD_ASSET_PACKAGE.presentation.depth);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.offsetPixels.x).toBeGreaterThanOrEqual(48);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.offsetPixels.x).toBeLessThanOrEqual(64);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.offsetPixels.y).toBeGreaterThanOrEqual(36);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.offsetPixels.y).toBeLessThanOrEqual(48);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.opacityMultiplier).toBeGreaterThanOrEqual(0.65);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.scale.x).toBeGreaterThan(1);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.scale.y).toBeGreaterThan(0.5);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.scale.y).toBeLessThanOrEqual(0.65);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.tintRgb.red).toBeLessThan(24);

    const calls: unknown[][] = [];
    preloadCloudAsset({
      load: {
        spritesheet: (...args: unknown[]) => calls.push(args),
      },
    } as never);
    expect(calls).toEqual([[
      CLOUD_ASSET_PACKAGE.image.textureKey,
      CLOUD_ASSET_PACKAGE.image.url,
      {
        frameWidth: CLOUD_ASSET_PACKAGE.image.frameSize.width,
        frameHeight: CLOUD_ASSET_PACKAGE.image.frameSize.height,
      },
    ]]);
  });

  it("uses only active catalog frames without changing any cloud behavior samples", () => {
    const frameOneInactive = cloudPackageWithActiveFrames(
      CLOUD_VARIANT_IDS.map((_, frame) => frame).filter((frame) => frame !== 1),
    );
    expect(resolveActiveCloudAssetFrame(0, frameOneInactive)).toBe(0);
    expect(resolveActiveCloudAssetFrame(1, frameOneInactive)).toBe(2);
    expect(resolveActiveCloudAssetFrame(2, frameOneInactive)).toBe(2);
    expect(resolveActiveCloudAssetFrame(3, frameOneInactive)).toBe(3);

    for (let slot = 0; slot < CLOUD_VARIANT_IDS.length; slot++) {
      const baseline = resolveCloudDescriptor(13_371, entry(2, 3), 1024, CLOUD_ASSET_PACKAGE, slot)!;
      const filtered = resolveCloudDescriptor(13_371, entry(2, 3), 1024, frameOneInactive, slot)!;
      expect({ ...filtered, frame: baseline.frame }).toEqual(baseline);
      expect(filtered.frame).toBe(baseline.frame === 1 ? 2 : baseline.frame);
    }

    const oneActive = cloudPackageWithActiveFrames([2]);
    expect(Array.from({ length: 8 }, (_, slot) => (
      resolveCloudDescriptor(13_371, entry(2, 3), 1024, oneActive, slot)?.frame
    ))).toEqual(Array.from({ length: 8 }, () => 2));
    const noneActive = cloudPackageWithActiveFrames([]);
    expect(resolveCloudDescriptor(13_371, entry(2, 3), 1024, noneActive)).toBeUndefined();
  });

  it("accepts deleted fixed slots while rejecting duplicate cloud identities", () => {
    const deleted = {
      ...CLOUD_ASSET_PACKAGE,
      variants: CLOUD_ASSET_PACKAGE.variants.map((variant, frame) => frame === 1 ? null : variant),
    } satisfies CloudAssetPackage;
    expect(validateCloudAssetPackage(deleted)).toBe(deleted);
    expect(cloudAssetVariantEntries(deleted).map(({ frame }) => frame)).toEqual(
      CLOUD_VARIANT_IDS.map((_, frame) => frame).filter((frame) => frame !== 1),
    );
    expect(() => validateCloudAssetPackage({
      ...CLOUD_ASSET_PACKAGE,
      variants: CLOUD_ASSET_PACKAGE.variants.map((variant, frame) => frame === 1
        ? { ...CLOUD_ASSET_PACKAGE.variants[0]!, name: "Another cloud" }
        : variant),
    })).toThrow(/repeats variant/u);
  });

  it("reconstructs identical clouds while varying frame, scale, flip, opacity and drift", () => {
    const first = resolveCloudDescriptor(13_371, entry(2, 3), 1024);
    expect(resolveCloudDescriptor(13_371, entry(2, 3), 1024)).toEqual(first);
    expect(new Set(Array.from({ length: CLOUD_VARIANT_IDS.length }, (_, slot) => (
      resolveCloudDescriptor(13_371, entry(2, 3), 1024, CLOUD_ASSET_PACKAGE, slot)?.frame
    )))).toEqual(new Set(CLOUD_VARIANT_IDS.map((_, frame) => frame)));
    const denseChunk = Array.from({ length: 12 }, (_, slot) => (
      resolveCloudDescriptor(13_371, entry(2, 3), 1024, CLOUD_ASSET_PACKAGE, slot)!
    ));
    expect(new Set(denseChunk.map(({ baseX, baseY }) => (
      `${baseX.toFixed(2)}:${baseY.toFixed(2)}`
    )))).toHaveLength(12);

    const descriptors = Array.from({ length: 12 }, (_, y) => (
      Array.from({ length: 12 }, (_, x) => resolveCloudDescriptor(13_371, entry(x, y), 1024))
    )).flat().filter((descriptor) => descriptor !== undefined);

    expect(descriptors.length).toBeGreaterThan(50);
    expect(new Set(descriptors.map(({ frame }) => frame))).toEqual(
      new Set(CLOUD_VARIANT_IDS.map((_, frame) => frame)),
    );
    expect(new Set(descriptors.map(({ scale }) => scale.toFixed(3))).size).toBeGreaterThan(8);
    expect(new Set(descriptors.map(({ alpha }) => alpha.toFixed(3))).size).toBeGreaterThan(8);
    expect(new Set(descriptors.map(({ tint }) => tint)).size).toBeGreaterThan(2);
    expect(new Set(descriptors.map(({ flipX }) => flipX)).size).toBe(2);
    expect(new Set(descriptors.map(({ driftPeriodMs }) => Math.round(driftPeriodMs))).size).toBeGreaterThan(8);
  });

  it("moves perceptibly along a slow route and eases opacity at both ends", () => {
    const cloudPackage = testCloudPackage({
      driftAmplitudePixels: { minimum: 96, maximum: 96 },
      driftPeriodSeconds: { minimum: 120, maximum: 120 },
      routeFadeFraction: 0.1,
    });
    const descriptor = resolveCloudDescriptor(13_371, entry(1, 1), 32 * 32, cloudPackage)!;
    const phaseFraction = descriptor.phase / (Math.PI * 2);
    const timeForCycle = (cycle: number) => (
      ((cycle - phaseFraction + 1) % 1) * descriptor.driftPeriodMs
    );
    const entering = resolveCloudMotion(descriptor, timeForCycle(0.05), false, cloudPackage);
    const full = resolveCloudMotion(descriptor, timeForCycle(0.25), false, cloudPackage);
    const leaving = resolveCloudMotion(descriptor, timeForCycle(0.95), false, cloudPackage);
    const tenSecondsLater = resolveCloudMotion(
      descriptor,
      timeForCycle(0.25) + 10_000,
      false,
      cloudPackage,
    );

    expect(entering.routeFade).toBeGreaterThan(0);
    expect(entering.routeFade).toBeLessThan(1);
    expect(full.routeFade).toBe(1);
    expect(leaving.routeFade).toBeCloseTo(entering.routeFade);
    expect(resolveCloudMotion(descriptor, timeForCycle(0), true, cloudPackage).routeFade).toBe(1);
    expect(Math.hypot(tenSecondsLater.x - full.x, tenSecondsLater.y - full.y)).toBeGreaterThan(10);
  });

  it("shows a cloud only when its padded footprint is fully outside fog", () => {
    const world = supportedWorld(16);
    const center = { x: 8 * 32, y: 8 * 32 };
    const size = { width: 64, height: 64 };
    expect(isCloudFootprintFullyClear(world, center, size, new Set(), 32, 1)).toBe(true);

    world.setKnowledge(8, 8, KnowledgeState.Personal, 1);
    expect(isCloudFootprintFullyClear(world, center, size, new Set(), 32, 1)).toBe(false);
    world.setVisibleNow(8, 8, true);
    expect(isCloudFootprintFullyClear(world, center, size, new Set(), 32, 1)).toBe(true);

    expect(isCloudFootprintFullyClear(world, { x: 8, y: 8 }, size, new Set(), 32, 1)).toBe(false);
  });

  it("checks the current cloud and shadow footprint against the rendered fog", () => {
    const cloudPackage = testCloudPackage({
      driftAmplitudePixels: { minimum: 96, maximum: 96 },
      scale: { minimum: 0.2, maximum: 0.2 },
    }, {
      offsetPixels: { x: 192, y: 0 },
    });
    const descriptor = resolveCloudDescriptor(13_371, entry(1, 1), 32 * 32, cloudPackage);
    expect(descriptor).toBeDefined();
    const envelope = resolveCloudEnvelopeAtPosition(descriptor!, {
      x: descriptor!.baseX,
      y: descriptor!.baseY,
    }, cloudPackage);
    const world = supportedWorld(96, 32);
    expect(isCloudEnvelopeFullyClear(world, envelope, new Set(), 32, 1)).toBe(true);

    const fogX = Math.floor((envelope.maxX - 1) / 32);
    const fogY = Math.floor(((envelope.minY + envelope.maxY) / 2) / 32);
    world.setKnowledge(fogX, fogY, KnowledgeState.Personal, 1);
    expect(isCloudEnvelopeFullyClear(world, envelope, new Set(), 32, 1)).toBe(false);
    world.setVisibleNow(fogX, fogY, true);
    expect(isCloudEnvelopeFullyClear(world, envelope, new Set(), 32, 1)).toBe(true);
  });

  it("uses ordinary seeded chunk descriptors for the generated starting chunk", () => {
    const config = createWorldProfileConfig("P0");
    const generated = new WorldGenerator(config).plan(13_371);
    const homeWorldPosition = gridToWorld(
      generated.landmarks.homeCenter,
      config.navigation.tileSize,
    );
    const chunkSizePixels = config.navigation.chunkSize * config.navigation.tileSize;
    const homeChunkX = Math.floor(homeWorldPosition.x / chunkSizePixels);
    const homeChunkY = Math.floor(homeWorldPosition.y / chunkSizePixels);
    const homeEntry = entry(homeChunkX, homeChunkY);
    const descriptors = resolveCloudDescriptorsForChunk(
      generated.seed,
      homeEntry,
      chunkSizePixels,
      CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk,
    );

    expect(descriptors).toEqual(Array.from(
      { length: CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk },
      (_, slot) => resolveCloudDescriptor(
        generated.seed,
        homeEntry,
        chunkSizePixels,
        CLOUD_ASSET_PACKAGE,
        slot,
      ),
    ));
    expect(descriptors).toHaveLength(CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk);
    expect(descriptors.every(({ id }) => id.startsWith(`cloud:${homeChunkX},${homeChunkY}:`))).toBe(true);

    const { scene } = createSpriteScene();
    const renderer = new CloudLayerRenderer(scene as never, false);
    renderer.applyActiveChunkDelta(
      oneChunkDelta(homeChunkX, homeChunkY),
      generated.seed,
      chunkSizePixels,
    );
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeClouds: CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk,
      activeShadows: CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk,
    });
  });

  it("keeps an eligible cloud pair visible throughout multiple slow drift cycles", () => {
    const cloudPackage = testCloudPackage({
      driftAmplitudePixels: { minimum: 48, maximum: 48 },
      driftPeriodSeconds: { minimum: 200, maximum: 200 },
      routeFadeFraction: 0,
    });
    const { scene, sprites } = createSpriteScene();
    const renderer = new CloudLayerRenderer(scene as never, false, cloudPackage);
    renderer.applyActiveChunkDelta(oneChunkDelta(), 13_371, 32 * 32);
    const world = supportedWorld(96, 32);
    const times = [0, 50_000, 100_000, 200_000, 450_000];
    const positions: string[] = [];

    for (const time of times) {
      renderer.sync(world, new Set(), 0, time);
      expect(renderer.getResourceTelemetry()).toMatchObject({
        activeClouds: 1,
        activeShadows: 1,
        visibleClouds: 1,
        visibleShadows: 1,
        stableFrameAllocations: 0,
      });
      const cloud = sprites.find(({ name }) => name !== "" && !name.endsWith(":shadow"));
      expect(cloud).toBeDefined();
      positions.push(`${cloud!.x.toFixed(2)}:${cloud!.y.toFixed(2)}`);
    }
    expect(new Set(positions).size).toBeGreaterThan(2);
  });

  it("reveals existing clouds through transient sight and invalidates coverage across worlds", () => {
    const cloudPackage = testCloudPackage({
      driftAmplitudePixels: { minimum: 0, maximum: 0 },
      clearPaddingTiles: 0,
    });
    const descriptor = resolveCloudDescriptor(13_371, entry(1, 1), 32 * 32, cloudPackage)!;
    const envelope = resolveCloudEnvelopeAtPosition(descriptor, {
      x: descriptor.baseX,
      y: descriptor.baseY,
    }, cloudPackage);
    const personalWorld = new WorldGrid(96, 96, 32, BOUNDED_WORLD_TOPOLOGY);
    personalWorld.replaceKnowledge(
      new Uint8Array(personalWorld.tileCount).fill(KnowledgeState.Personal),
      new Uint32Array(personalWorld.tileCount).fill(1),
    );
    for (let y = Math.floor(envelope.minY / 32); y <= Math.ceil(envelope.maxY / 32); y++) {
      for (let x = Math.floor(envelope.minX / 32); x <= Math.ceil(envelope.maxX / 32); x++) {
        if (personalWorld.inBounds(x, y)) personalWorld.setVisibleNow(x, y, true);
      }
    }

    const { scene } = createSpriteScene();
    const renderer = new CloudLayerRenderer(scene as never, false, cloudPackage);
    renderer.applyActiveChunkDelta(oneChunkDelta(), 13_371, 32 * 32);
    renderer.sync(personalWorld, new Set(), 0, 0);
    expect(renderer.getResourceTelemetry()).toMatchObject({ visibleClouds: 1, visibleShadows: 1 });

    for (let y = Math.floor(envelope.minY / 32); y <= Math.ceil(envelope.maxY / 32); y++) {
      for (let x = Math.floor(envelope.minX / 32); x <= Math.ceil(envelope.maxX / 32); x++) {
        if (personalWorld.inBounds(x, y)) personalWorld.setVisibleNow(x, y, false);
      }
    }
    renderer.sync(personalWorld, new Set(), 0, 5_000);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeClouds: 1,
      activeShadows: 1,
      visibleClouds: 0,
      visibleShadows: 0,
    });

    const supported = supportedWorld(96, 32);
    expect(supported.knowledgeVersion).toBe(personalWorld.knowledgeVersion);
    renderer.sync(supported, new Set(), 0, 10_000);
    expect(renderer.getResourceTelemetry()).toMatchObject({ visibleClouds: 1, visibleShadows: 1 });

    const fogX = Math.floor(((envelope.minX + envelope.maxX) / 2) / 32);
    const fogY = Math.floor(((envelope.minY + envelope.maxY) / 2) / 32);
    supported.setKnowledge(fogX, fogY, KnowledgeState.Personal, 1);
    supported.setVisibleNow(fogX, fogY, true);
    renderer.sync(supported, new Set(), 0, 20_000);
    expect(renderer.getResourceTelemetry()).toMatchObject({ visibleClouds: 1, visibleShadows: 1 });
    supported.setVisibleNow(fogX, fogY, false);
    renderer.sync(supported, new Set(), 0, 30_000);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeClouds: 1,
      activeShadows: 1,
      visibleClouds: 0,
      visibleShadows: 0,
    });

    expect(renderer.setIgnoreFog(true)).toBe(true);
    renderer.sync(supported, new Set(), 0, 35_000);
    renderer.sync(supported, new Set(), 0, 40_000);
    expect(renderer.getResourceTelemetry()).toMatchObject({ visibleClouds: 1, visibleShadows: 1 });
    expect(renderer.setIgnoreFog(false)).toBe(true);
    renderer.sync(supported, new Set(), 0, 45_000);
    expect(renderer.getResourceTelemetry()).toMatchObject({ visibleClouds: 0, visibleShadows: 0 });
  });

  it("renders a flattened paired shadow above the ship with lockstep motion and visibility", () => {
    const cloudPackage = testCloudPackage();
    const { scene, sprites } = createSpriteScene();
    const renderer = new CloudLayerRenderer(scene as never, false, cloudPackage);
    renderer.applyActiveChunkDelta(oneChunkDelta(), 13_371, 32 * 32);
    renderer.sync(supportedWorld(96, 32), new Set(), 0, 0);

    const cloud = sprites.find(({ name }) => name !== "" && !name.endsWith(":shadow"));
    const shadow = sprites.find(({ name }) => name.endsWith(":shadow"));
    expect(cloud).toBeDefined();
    expect(shadow).toBeDefined();
    expect(shadow!.frame).toBe(cloud!.frame);
    expect(shadow!.flipX).toBe(cloud!.flipX);
    expect(shadow!.x - cloud!.x).toBeCloseTo(cloudPackage.presentation.shadow.offsetPixels.x);
    expect(shadow!.y - cloud!.y).toBeCloseTo(cloudPackage.presentation.shadow.offsetPixels.y);
    expect(shadow!.scaleX).toBeCloseTo(cloud!.scaleX * cloudPackage.presentation.shadow.scale.x);
    expect(shadow!.scaleY).toBeCloseTo(cloud!.scaleY * cloudPackage.presentation.shadow.scale.y);
    expect(shadow!.depth).toBeGreaterThan(50);
    expect(shadow!.depth).toBeLessThan(cloud!.depth);
    expect(shadow!.tint).toBe(
      (cloudPackage.presentation.shadow.tintRgb.red << 16)
      | (cloudPackage.presentation.shadow.tintRgb.green << 8)
      | cloudPackage.presentation.shadow.tintRgb.blue,
    );
    expect(shadow!.alpha).toBeCloseTo(cloud!.alpha * cloudPackage.presentation.shadow.opacityMultiplier);
    expect(shadow!.visible).toBe(cloud!.visible);
    expect(shadow!.visible).toBe(true);
  });

  it("toggles and rebuilds only cloud-owned resources without stable-frame allocation", () => {
    const { scene, sprites } = createSpriteScene();
    const topology = new WorldTopology(24, 24, 32, 8, BOUNDED_WORLD_TOPOLOGY);
    const chunks = new ActiveChunkSet({
      topology,
      prefetchRing: 0,
      maxActiveChunks: 9,
    });
    const delta = chunks.update({ minX: 0, minY: 0, maxX: 23, maxY: 23 });
    const renderer = new CloudLayerRenderer(scene as never, false);
    renderer.applyActiveChunkDelta(delta, 13_371, 8 * 32);
    const initial = renderer.getResourceTelemetry();
    expect(initial.activeClouds).toBeGreaterThan(0);
    expect(initial.activeShadows).toBe(initial.activeClouds);
    expect(sprites).toHaveLength(initial.activeClouds * 2);
    expect(initial.activeClouds).toBeLessThanOrEqual(
      delta.telemetry.capacity * CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk,
    );
    const initialSpriteCount = sprites.length;

    expect(renderer.setEnabled(false)).toBe(true);
    expect(renderer.setEnabled(false)).toBe(false);
    expect(renderer.getResourceTelemetry()).toMatchObject({ enabled: false, activeClouds: 0, activeShadows: 0 });
    expect(sprites.slice(0, initialSpriteCount).every(({ destroyed }) => destroyed)).toBe(true);

    expect(renderer.setEnabled(true)).toBe(true);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeClouds: initial.activeClouds,
      activeShadows: initial.activeClouds,
    });
    const world = supportedWorld(64, 8);
    renderer.sync(world, new Set(), 0, 20_000);
    renderer.sync(world, new Set(), 0, 27_000);
    expect(renderer.getResourceTelemetry().stableFrameAllocations).toBe(0);
    expect(renderer.getResourceTelemetry().visibleClouds).toBeGreaterThan(0);
    expect(renderer.getResourceTelemetry().visibleShadows).toBe(renderer.getResourceTelemetry().visibleClouds);

    renderer.destroy();
    const final = renderer.getResourceTelemetry();
    expect(final.activeClouds).toBe(0);
    expect(final.activeShadows).toBe(0);
    expect(final.totalCloudReleases).toBe(final.totalCloudAllocations);
    expect(final.totalShadowReleases).toBe(final.totalShadowAllocations);
    expect(sprites.every(({ destroyed }) => destroyed)).toBe(true);
  });

  it("rebuilds deterministic bounded resources when live cloud frequency changes", () => {
    const { scene, sprites } = createSpriteScene();
    const renderer = new CloudLayerRenderer(scene as never, false);
    const delta = oneChunkDelta();
    renderer.applyActiveChunkDelta(delta, 13_371, 32 * 32);
    const initialCount = CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk;
    expect(renderer.getResourceTelemetry()).toMatchObject({
      cloudsPerChunk: initialCount,
      activeClouds: initialCount,
      activeShadows: initialCount,
    });

    expect(renderer.setCloudsPerChunk(9)).toBe(true);
    expect(renderer.setCloudsPerChunk(9)).toBe(false);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      cloudsPerChunk: 9,
      activeClouds: 9,
      activeShadows: 9,
    });
    expect(sprites.slice(0, initialCount * 2).every(({ destroyed }) => destroyed)).toBe(true);

    expect(renderer.setCloudsPerChunk(0)).toBe(true);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      cloudsPerChunk: 0,
      activeClouds: 0,
      activeShadows: 0,
    });
    expect(() => renderer.setCloudsPerChunk(13)).toThrow(/integer from 0 through 12/);
    expect(() => renderer.setCloudsPerChunk(1.5)).toThrow(/integer from 0 through 12/);
    expect(renderer.getResourceTelemetry().activeClouds).toBeLessThanOrEqual(
      delta.telemetry.capacity * renderer.cloudsPerChunk,
    );
  });
});
