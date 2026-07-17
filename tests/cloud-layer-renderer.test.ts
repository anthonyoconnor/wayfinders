import { describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_PACKAGE,
  preloadCloudAsset,
  validateCloudAssetPackage,
} from "../src/wayfinders/assets/CloudAssetCatalog";
import {
  CloudLayerRenderer,
  isCloudFootprintFullyClear,
  resolveCloudDescriptor,
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

function supportedWorld(size = 32): WorldGrid {
  const world = new WorldGrid(size, size, 8);
  world.replaceKnowledge(
    new Uint8Array(world.tileCount).fill(KnowledgeState.Supported),
    new Uint32Array(world.tileCount),
  );
  return world;
}

describe("cloud atmosphere assets and deterministic presentation", () => {
  it("validates four distinct runtime frames and preloads the declared sheet", () => {
    expect(validateCloudAssetPackage(CLOUD_ASSET_PACKAGE as never)).toBe(CLOUD_ASSET_PACKAGE);
    expect(CLOUD_ASSET_PACKAGE.variants).toHaveLength(4);
    expect(CLOUD_ASSET_PACKAGE.image.opaqueBounds).toHaveLength(4);
    expect(new Set(CLOUD_ASSET_PACKAGE.variants).size).toBe(4);
    expect(CLOUD_ASSET_PACKAGE.presentation.opacity.maximum).toBeLessThanOrEqual(0.35);

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

  it("places at least one unobtrusive candidate in a revealed region crossing chunk corners", () => {
    const world = new WorldGrid(64, 64, 32);
    const knowledge = new Uint8Array(world.tileCount).fill(KnowledgeState.Unknown);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (Math.hypot(x - 32, y - 32) <= 14) knowledge[y * 64 + x] = KnowledgeState.Supported;
      }
    }
    world.replaceKnowledge(knowledge, new Uint32Array(world.tileCount));

    const scene = {
      textures: { exists: () => true },
      add: {
        sprite: () => {
          const sprite = {
            visible: false,
            setOrigin: () => sprite,
            setScale: () => sprite,
            setAlpha: () => sprite,
            setFlipX: () => sprite,
            setDepth: () => sprite,
            setName: () => sprite,
            setPosition: () => sprite,
            setVisible: (visible: boolean) => {
              sprite.visible = visible;
              return sprite;
            },
            destroy: () => undefined,
          };
          return sprite;
        },
      },
    };
    const chunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      prefetchRing: 0,
      maxActiveChunks: 9,
    });
    const renderer = new CloudLayerRenderer(scene as never, true);
    renderer.applyActiveChunkDelta(chunks.update({ minX: 0, minY: 0, maxX: 2, maxY: 2 }), 13_371, 32 * 32);
    renderer.sync(world, new Set(), 0, 0, { x: 32 * 32, y: 32 * 32 });

    expect(renderer.getResourceTelemetry()).toMatchObject({
      clearCloudFootprints: expect.any(Number),
      visibleClouds: expect.any(Number),
    });
    expect(renderer.getResourceTelemetry().clearCloudFootprints).toBeGreaterThan(0);
    expect(renderer.getResourceTelemetry().visibleClouds).toBeGreaterThan(0);
  });

  it("toggles and rebuilds only cloud-owned resources without stable-frame allocation", () => {
    const sprites: Array<{ destroyed: boolean; visible: boolean }> = [];
    const scene = {
      textures: { exists: () => true },
      add: {
        sprite: () => {
          const state = { destroyed: false, visible: false };
          sprites.push(state);
          const sprite = {
            setOrigin: () => sprite,
            setScale: () => sprite,
            setAlpha: () => sprite,
            setFlipX: () => sprite,
            setDepth: () => sprite,
            setName: () => sprite,
            setPosition: () => sprite,
            setVisible: (visible: boolean) => {
              state.visible = visible;
              return sprite;
            },
            destroy: () => { state.destroyed = true; },
          };
          return sprite;
        },
      },
    };
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
    expect(initial.activeClouds).toBeLessThanOrEqual(
      delta.telemetry.capacity * CLOUD_ASSET_PACKAGE.presentation.candidatesPerChunk,
    );

    expect(renderer.setEnabled(false)).toBe(true);
    expect(renderer.setEnabled(false)).toBe(false);
    expect(renderer.getResourceTelemetry()).toMatchObject({ enabled: false, activeClouds: 0 });
    expect(sprites.slice(0, initial.activeClouds).every(({ destroyed }) => destroyed)).toBe(true);

    expect(renderer.setEnabled(true)).toBe(true);
    expect(renderer.getResourceTelemetry().activeClouds).toBe(initial.activeClouds);
    const world = supportedWorld();
    renderer.sync(world, new Set(), 0, 20_000, { x: -10_000, y: -10_000 });
    expect(renderer.getResourceTelemetry().stableFrameAllocations).toBe(0);
    expect(sprites.slice(initial.activeClouds).some(({ visible }) => visible)).toBe(true);

    renderer.destroy();
    const final = renderer.getResourceTelemetry();
    expect(final.activeClouds).toBe(0);
    expect(final.totalCloudReleases).toBe(final.totalCloudAllocations);
  });
});
