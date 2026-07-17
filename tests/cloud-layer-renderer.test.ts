import { describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_PACKAGE,
  preloadCloudAsset,
  type CloudAssetPackage,
  validateCloudAssetPackage,
} from "../src/wayfinders/assets/CloudAssetCatalog";
import {
  CloudLayerRenderer,
  isCloudFootprintFullyClear,
  isCloudRouteEnvelopeDurablyClear,
  resolveCloudDescriptor,
  resolveCloudRouteEnvelope,
} from "../src/wayfinders/rendering/CloudLayerRenderer";
import { ActiveChunkSet, type ActiveChunkEntry } from "../src/wayfinders/rendering/activation";
import { KnowledgeState } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";

function entry(x: number, y: number): Readonly<ActiveChunkEntry> {
  return {
    key: `${x},${y}`,
    coordinate: { x, y },
    band: "visible",
    ringDistance: 0,
    loadPriority: y * 100 + x,
  };
}

function supportedWorld(size = 32, chunkSize = 8): WorldGrid {
  const world = new WorldGrid(size, size, chunkSize);
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

function oneChunkDelta(x = 1, y = 1): ReturnType<ActiveChunkSet["update"]> {
  const chunks = new ActiveChunkSet({
    worldBounds: { minX: x, minY: y, maxX: x + 1, maxY: y + 1 },
    prefetchRing: 0,
    maxActiveChunks: 1,
  });
  return chunks.update({ minX: x, minY: y, maxX: x + 1, maxY: y + 1 });
}

describe("cloud atmosphere assets and deterministic presentation", () => {
  it("validates four distinct runtime frames and preloads the declared sheet", () => {
    expect(validateCloudAssetPackage(CLOUD_ASSET_PACKAGE as never)).toBe(CLOUD_ASSET_PACKAGE);
    expect(CLOUD_ASSET_PACKAGE.variants).toHaveLength(4);
    expect(CLOUD_ASSET_PACKAGE.image.opaqueBounds).toHaveLength(4);
    expect(new Set(CLOUD_ASSET_PACKAGE.variants).size).toBe(4);
    expect(CLOUD_ASSET_PACKAGE.presentation.opacity.maximum).toBeLessThanOrEqual(0.35);
    expect(CLOUD_ASSET_PACKAGE.presentation.driftPeriodSeconds.minimum).toBeGreaterThanOrEqual(180);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.depth).toBeGreaterThan(50);
    expect(CLOUD_ASSET_PACKAGE.presentation.shadow.depth).toBeLessThan(CLOUD_ASSET_PACKAGE.presentation.depth);

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

  it("reconstructs identical clouds while varying frame, scale, flip, opacity and drift", () => {
    const first = resolveCloudDescriptor(13_371, entry(2, 3), 1024);
    expect(resolveCloudDescriptor(13_371, entry(2, 3), 1024)).toEqual(first);
    expect(new Set(Array.from({ length: 4 }, (_, slot) => (
      resolveCloudDescriptor(13_371, entry(2, 3), 1024, CLOUD_ASSET_PACKAGE, slot)?.frame
    )))).toEqual(new Set([0, 1, 2, 3]));

    const descriptors = Array.from({ length: 12 }, (_, y) => (
      Array.from({ length: 12 }, (_, x) => resolveCloudDescriptor(13_371, entry(x, y), 1024))
    )).flat().filter((descriptor) => descriptor !== undefined);

    expect(descriptors.length).toBeGreaterThan(50);
    expect(new Set(descriptors.map(({ frame }) => frame))).toEqual(new Set([0, 1, 2, 3]));
    expect(new Set(descriptors.map(({ scale }) => scale.toFixed(3))).size).toBeGreaterThan(8);
    expect(new Set(descriptors.map(({ alpha }) => alpha.toFixed(3))).size).toBeGreaterThan(8);
    expect(new Set(descriptors.map(({ flipX }) => flipX)).size).toBe(2);
    expect(new Set(descriptors.map(({ driftPeriodMs }) => Math.round(driftPeriodMs))).size).toBeGreaterThan(8);
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

  it("uses one durable envelope for the complete cloud and shadow route", () => {
    const cloudPackage = testCloudPackage({
      driftAmplitudePixels: { minimum: 96, maximum: 96 },
      scale: { minimum: 0.2, maximum: 0.2 },
    }, {
      offsetPixels: { x: 192, y: 0 },
    });
    const descriptor = resolveCloudDescriptor(13_371, entry(1, 1), 32 * 32, cloudPackage);
    expect(descriptor).toBeDefined();
    const envelope = resolveCloudRouteEnvelope(descriptor!, cloudPackage);
    const world = supportedWorld(96, 32);
    expect(isCloudRouteEnvelopeDurablyClear(world, envelope, new Set(), 32, 1)).toBe(true);

    const fogX = Math.floor((envelope.maxX - 1) / 32);
    const fogY = Math.floor(((envelope.minY + envelope.maxY) / 2) / 32);
    world.setKnowledge(fogX, fogY, KnowledgeState.Personal, 1);
    world.setVisibleNow(fogX, fogY, true);
    expect(isCloudRouteEnvelopeDurablyClear(world, envelope, new Set(), 32, 1)).toBe(false);
  });

  it("places at least one unobtrusive candidate in a revealed region crossing chunk corners", () => {
    const world = new WorldGrid(64, 64, 32);
    const knowledge = new Uint8Array(world.tileCount).fill(KnowledgeState.Unknown);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (Math.hypot(x - 32, y - 32) <= 14) knowledge[y * 64 + x] = KnowledgeState.Supported;
      }
    }
    world.replaceKnowledge(knowledge, new Uint32Array(world.tileCount));

    const { scene, sprites } = createSpriteScene();
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      prefetchRing: 0,
      maxActiveChunks: 9,
    });
    const renderer = new CloudLayerRenderer(scene as never, true);
    renderer.applyActiveChunkDelta(chunks.update({ minX: 0, minY: 0, maxX: 2, maxY: 2 }), 13_371, 32 * 32);
    renderer.sync(world, new Set(), 0, 10_000);
    renderer.sync(world, new Set(), 0, 17_000);

    expect(renderer.getResourceTelemetry()).toMatchObject({
      clearCloudFootprints: expect.any(Number),
      visibleClouds: expect.any(Number),
    });
    expect(renderer.getResourceTelemetry().clearCloudFootprints).toBeGreaterThan(0);
    expect(renderer.getResourceTelemetry().visibleClouds).toBeGreaterThan(0);
    expect(renderer.getResourceTelemetry().visibleShadows).toBe(renderer.getResourceTelemetry().visibleClouds);
    expect(sprites.some(({ name, alpha }) => !name.endsWith(":shadow") && alpha > 0)).toBe(true);
  });

  it("keeps an eligible cloud pair visible throughout multiple slow drift cycles", () => {
    const cloudPackage = testCloudPackage({
      driftAmplitudePixels: { minimum: 48, maximum: 48 },
      driftPeriodSeconds: { minimum: 200, maximum: 200 },
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

  it("ignores transient sight and invalidates durable eligibility across world instances", () => {
    const cloudPackage = testCloudPackage({
      driftAmplitudePixels: { minimum: 0, maximum: 0 },
      clearPaddingTiles: 0,
    });
    const descriptor = resolveCloudDescriptor(13_371, entry(1, 1), 32 * 32, cloudPackage)!;
    const envelope = resolveCloudRouteEnvelope(descriptor, cloudPackage);
    const personalWorld = new WorldGrid(96, 96, 32);
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
    expect(renderer.getResourceTelemetry()).toMatchObject({ visibleClouds: 0, visibleShadows: 0 });

    const supported = supportedWorld(96, 32);
    expect(supported.knowledgeVersion).toBe(personalWorld.knowledgeVersion);
    renderer.sync(supported, new Set(), 0, 10_000);
    expect(renderer.getResourceTelemetry()).toMatchObject({ visibleClouds: 1, visibleShadows: 1 });

    const fogX = Math.floor(((envelope.minX + envelope.maxX) / 2) / 32);
    const fogY = Math.floor(((envelope.minY + envelope.maxY) / 2) / 32);
    supported.setKnowledge(fogX, fogY, KnowledgeState.Personal, 1);
    supported.setVisibleNow(fogX, fogY, true);
    renderer.sync(supported, new Set(), 0, 20_000);
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
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      prefetchRing: 0,
      maxActiveChunks: 9,
    });
    const delta = chunks.update({ minX: 0, minY: 0, maxX: 2, maxY: 2 });
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
});
