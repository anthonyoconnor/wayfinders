import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WATER_HOME_HANDOFF_MARGIN,
  WATER_TEXTURE_KEYS,
} from "../src/wayfinders/assets/water";
import { prototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { activeChunkViewKey } from "../src/wayfinders/rendering/activation";
import type { ActiveChunkEntry } from "../src/wayfinders/rendering/activation";
import { WaterRenderer } from "../src/wayfinders/rendering/WaterRenderer";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import type { GeneratedWorld } from "../src/wayfinders/world/WorldGenerator";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology";
import { WATER_TYPE_IDS, type WaterTypeId } from "../src/wayfinders/world/water";

const { createdImages } = vi.hoisted(() => ({
  createdImages: [] as FakeImage[],
}));

vi.mock("phaser", () => ({
  default: {
    Scenes: { Events: { SHUTDOWN: "shutdown" } },
  },
}));

interface FakeImage {
  x: number;
  y: number;
  readonly textureKey: string;
  frame: string | number;
  depth: number;
  visible: boolean;
  destroyed: boolean;
  setOrigin(...args: unknown[]): FakeImage;
  setDepth(...args: unknown[]): FakeImage;
  setPosition(x: number, y: number): FakeImage;
  setFrame(frame: string | number): FakeImage;
  setVisible(visible: boolean): FakeImage;
  destroy(): void;
}

interface FakeCanvasTexture {
  readonly width: number;
  readonly height: number;
  readonly context: CanvasRenderingContext2D;
  readonly add: ReturnType<typeof vi.fn>;
  refreshCount: number;
  getContext(): CanvasRenderingContext2D;
  getSourceImage(): object;
  refresh(): void;
}

function fakeImage(x: number, y: number, textureKey: string, frame: string | number = 0): FakeImage {
  return {
    x,
    y,
    textureKey,
    frame,
    depth: 0,
    visible: true,
    destroyed: false,
    setOrigin() { return this; },
    setDepth(nextDepth: number) { this.depth = nextDepth; return this; },
    setPosition(nextX: number, nextY: number) { this.x = nextX; this.y = nextY; return this; },
    setFrame(nextFrame: number) { this.frame = nextFrame; return this; },
    setVisible(nextVisible: boolean) { this.visible = nextVisible; return this; },
    destroy() { this.destroyed = true; },
  };
}

function fakeCanvas(width: number, height: number): FakeCanvasTexture {
  const context = {
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  return {
    width,
    height,
    context,
    add: vi.fn(),
    refreshCount: 0,
    getContext() { return context; },
    getSourceImage() { return {}; },
    refresh() { this.refreshCount++; },
  };
}

function makeScene() {
  const canvases = new Map<string, FakeCanvasTexture>();
  const removed: string[] = [];
  const scene = {
    events: {
      once: () => undefined,
      off: () => undefined,
    },
    textures: {
      exists: (key: string) => canvases.has(key),
      remove: (key: string) => { canvases.delete(key); removed.push(key); },
      createCanvas: (key: string, width: number, height: number) => {
        const canvas = fakeCanvas(width, height);
        canvases.set(key, canvas);
        return canvas;
      },
      get: (key: string) => canvases.get(key) ?? {
        getSourceImage: () => ({}),
      },
    },
    add: {
      image: (x: number, y: number, textureKey: string, frame: string | number = 0) => {
        const image = fakeImage(x, y, textureKey, frame);
        createdImages.push(image);
        return image;
      },
    },
  };
  return { scene, canvases, removed };
}

function entry(
  chunkX: number,
  chunkY: number,
  imageOffset: Readonly<{ x: number; y: number }>,
  band: ActiveChunkEntry["band"] = "visible",
  loadPriority = 0,
): Readonly<ActiveChunkEntry> {
  return Object.freeze({
    viewKey: activeChunkViewKey(chunkX, chunkY, imageOffset.x, imageOffset.y),
    canonicalChunk: Object.freeze({ x: chunkX, y: chunkY }),
    imageOffset: Object.freeze({ ...imageOffset }),
    band,
    ringDistance: band === "visible" ? 0 : 1,
    loadPriority,
  });
}

function generatedWorld(width = 32, height = 32, chunkSize = 8): GeneratedWorld {
  const tileSize = prototypeConfig.navigation.tileSize;
  const grid = new WorldGrid(width, height, chunkSize, WRAPPING_WORLD_TOPOLOGY, tileSize);
  grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const water = {
    chunk: (chunkX: number, chunkY: number) => {
      const startX = chunkX * chunkSize;
      const startY = chunkY * chunkSize;
      return {
        startX,
        startY,
        width: Math.min(chunkSize, width - startX),
        height: Math.min(chunkSize, height - startY),
      };
    },
    baseTypeAt: () => WATER_TYPE_IDS.deep,
    variantAt: () => 0,
    phaseAt: (x: number, y: number) => (x + y) % 8,
    transitionMaskAt: () => 0,
    hasOverlay: () => false,
  };
  return {
    seed: 1,
    grid,
    islands: [],
    landmarks: {
      homeCenter: { x: 9, y: 9 },
      harbour: { x: 11, y: 9 },
      dock: { x: 12, y: 9 },
      homeReturnTile: { x: 12, y: 9 },
      hiddenObstacleCenter: { x: 1, y: 1 },
      hiddenResource: { x: 2, y: 2 },
    },
    water,
  } as unknown as GeneratedWorld;
}

function waterAssets(types: readonly WaterTypeId[] = [WATER_TYPE_IDS.deep]) {
  return {
    profiles: new Map(types.map((id) => [id, {}])),
    package: { profiles: types.map((id) => ({ id })) },
  };
}

describe("WaterRenderer periodic image ownership", () => {
  beforeEach(() => { createdImages.length = 0; });

  it("shares exactly two canonical textures across aliases and redraws the owner once per frame", () => {
    const { scene, canvases } = makeScene();
    const generated = generatedWorld();
    const worldOffset = generated.grid.topology.pixelWidth;
    const renderer = new WaterRenderer(scene as never, waterAssets() as never, false);
    renderer.render(generated, [
      entry(0, 0, { x: 0, y: 0 }),
      entry(0, 0, { x: worldOffset, y: 0 }, "visible", 1),
    ]);

    expect(renderer.getTelemetry()).toMatchObject({
      activeImageEntries: 2,
      activeCanonicalChunks: 1,
      visibleImageEntries: 2,
      visibleCanonicalChunks: 1,
      activeCanvasTextures: 2,
      activeWaterImageObjects: 4,
      homeShoreAliases: 2,
      redrawCount: 1,
      animatedRedrawCount: 0,
      tilesDrawn: 64,
    });
    expect([...canvases.keys()]).toEqual([
      "wayfinders.water.chunk.base.0-0",
      "wayfinders.water.chunk.surface.0-0",
    ]);
    expect(createdImages.filter(({ textureKey }) => textureKey.includes("water.chunk"))).toMatchObject([
      { x: 0, y: 0, textureKey: "wayfinders.water.chunk.base.0-0", frame: "chunk" },
      { x: 0, y: 0, textureKey: "wayfinders.water.chunk.surface.0-0", frame: 0 },
      { x: worldOffset, y: 0, textureKey: "wayfinders.water.chunk.base.0-0", frame: "chunk" },
      { x: worldOffset, y: 0, textureKey: "wayfinders.water.chunk.surface.0-0", frame: 0 },
    ]);

    const base = canvases.get("wayfinders.water.chunk.base.0-0")!;
    const coreSize = prototypeConfig.navigation.tileSize * 8;
    expect(base).toMatchObject({ width: coreSize + 2, height: coreSize + 2 });
    expect(base.add).toHaveBeenCalledWith("chunk", 0, 1, 1, coreSize, coreSize);
    expect(vi.mocked(base.context.drawImage).mock.calls.slice(-8).map((call) => call.slice(1))).toEqual([
      [1, 1, coreSize, 1, 1, 0, coreSize, 1],
      [1, coreSize, coreSize, 1, 1, coreSize + 1, coreSize, 1],
      [1, 1, 1, coreSize, 0, 1, 1, coreSize],
      [coreSize, 1, 1, coreSize, coreSize + 1, 1, 1, coreSize],
      [1, 1, 1, 1, 0, 0, 1, 1],
      [coreSize, 1, 1, 1, coreSize + 1, 0, 1, 1],
      [1, coreSize, 1, 1, 0, coreSize + 1, 1, 1],
      [coreSize, coreSize, 1, 1, coreSize + 1, coreSize + 1, 1, 1],
    ]);
    expect(canvases.get("wayfinders.water.chunk.surface.0-0")).toMatchObject({
      width: coreSize,
      height: coreSize,
    });

    renderer.update(140);
    renderer.update(140);
    expect(renderer.getTelemetry()).toMatchObject({
      redrawCount: 2,
      animatedRedrawCount: 1,
      tilesDrawn: 128,
    });
  });

  it("keeps prefetch static, preserves phase while aliases turn over, and sizes partial chunks exactly", () => {
    const { scene, canvases, removed } = makeScene();
    const generated = generatedWorld(18, 18);
    const worldOffset = generated.grid.topology.pixelWidth;
    const renderer = new WaterRenderer(scene as never, waterAssets() as never, false);
    const retained = entry(0, 0, { x: worldOffset, y: 0 });
    renderer.render(generated, [entry(0, 0, { x: 0, y: 0 }), retained]);
    renderer.update(140);

    const partial = entry(2, 2, { x: 0, y: 0 }, "prefetch", 1);
    renderer.applyActiveChunks({ active: [retained, partial] } as never);
    expect(removed).toEqual([]);
    expect(canvases.get("wayfinders.water.chunk.base.2-2")).toMatchObject({
      width: prototypeConfig.navigation.tileSize * 2 + 2,
      height: prototypeConfig.navigation.tileSize * 2 + 2,
    });
    expect(renderer.getTelemetry()).toMatchObject({
      activeImageEntries: 2,
      activeCanonicalChunks: 2,
      activeCanvasTextures: 4,
      redrawCount: 3,
      animatedRedrawCount: 1,
      tilesDrawn: 132,
    });

    renderer.update(280);
    expect(renderer.getTelemetry()).toMatchObject({
      redrawCount: 4,
      animatedRedrawCount: 2,
      tilesDrawn: 196,
    });
    renderer.applyActiveChunks({ active: [partial] } as never);
    renderer.update(420);
    expect(renderer.getTelemetry().animatedRedrawCount).toBe(2);
    expect(removed.sort()).toEqual([
      "wayfinders.water.chunk.base.0-0",
      "wayfinders.water.chunk.surface.0-0",
    ]);
  });

  it("owns one aligned home handoff and shore pair across the expanded periodic footprint", () => {
    const { scene, canvases } = makeScene();
    const generated = generatedWorld();
    const tileSize = prototypeConfig.navigation.tileSize;
    const worldOffset = generated.grid.topology.pixelWidth;
    const homeTopLeft = { x: 2 * tileSize, y: 2 * tileSize };
    const renderer = new WaterRenderer(scene as never, waterAssets() as never, false);
    renderer.render(generated, [entry(3, 0, { x: 0, y: 0 })]);
    const handoff = createdImages.find(
      ({ textureKey }) => textureKey === WATER_TEXTURE_KEYS.homeDepthHandoff,
    );
    const shore = createdImages.find(
      ({ textureKey }) => textureKey === WATER_TEXTURE_KEYS.homeShore,
    );
    expect(handoff).toMatchObject({
      x: homeTopLeft.x + worldOffset - WATER_HOME_HANDOFF_MARGIN,
      y: homeTopLeft.y - WATER_HOME_HANDOFF_MARGIN,
      frame: 0,
      depth: 1.7,
      visible: true,
    });
    expect(shore).toMatchObject({
      x: homeTopLeft.x + worldOffset,
      y: homeTopLeft.y,
      frame: 0,
      depth: 4.75,
      visible: true,
    });

    renderer.update(420);
    expect(handoff?.frame).toBe(3);
    expect(shore?.frame).toBe(3);

    renderer.applyActiveChunks({
      active: [entry(0, 0, { x: worldOffset, y: 0 })],
    } as never);
    expect(renderer.getTelemetry()).toMatchObject({
      homeShoreAliases: 1,
      totalHomeShoreAliasActivations: 1,
      totalHomeShoreAliasDeactivations: 0,
    });
    expect(handoff?.destroyed).toBe(false);
    expect(shore?.destroyed).toBe(false);

    renderer.destroy();
    expect(handoff?.destroyed).toBe(true);
    expect(shore?.destroyed).toBe(true);
    expect(canvases.size).toBe(0);
    expect(renderer.getTelemetry()).toMatchObject({
      activeImageEntries: 0,
      activeCanonicalChunks: 0,
      activeCanvasTextures: 0,
      homeShoreAliases: 0,
    });
  });

  it("holds the initial surface frame under reduced motion", () => {
    const { scene } = makeScene();
    const generated = generatedWorld();
    const renderer = new WaterRenderer(scene as never, waterAssets() as never, true);
    renderer.render(generated, [entry(0, 0, { x: 0, y: 0 })]);
    renderer.update(4_200);
    expect(renderer.getTelemetry()).toMatchObject({ redrawCount: 1, animatedRedrawCount: 0 });
    expect(createdImages.find(
      ({ textureKey }) => textureKey === WATER_TEXTURE_KEYS.homeDepthHandoff,
    )?.frame).toBe(0);
    expect(createdImages.find(
      ({ textureKey }) => textureKey === WATER_TEXTURE_KEYS.homeShore,
    )?.frame).toBe(0);
  });

  it("uses only deep base presentation across the periodic home footprint and collar", () => {
    const { scene, canvases } = makeScene();
    const source = generatedWorld(32, 32, 32);
    const generated = {
      ...source,
      landmarks: {
        ...source.landmarks,
        homeCenter: { x: 0, y: 0 },
      },
      water: {
        ...source.water,
        baseTypeAt: () => WATER_TYPE_IDS.coastal,
        transitionMaskAt: () => 1,
      },
    } as unknown as GeneratedWorld;
    const renderer = new WaterRenderer(
      scene as never,
      waterAssets([WATER_TYPE_IDS.deep, WATER_TYPE_IDS.coastal]) as never,
      false,
    );

    renderer.render(generated, [entry(0, 0, { x: 0, y: 0 })]);

    const base = canvases.get("wayfinders.water.chunk.base.0-0")!;
    const baseCalls = vi.mocked(base.context.drawImage).mock.calls;
    const insideWrappedCollarX = 24;
    const immediatelyOutsideX = 23;
    const tileSize = prototypeConfig.navigation.tileSize;
    const baseDrawAt = (tileX: number) => baseCalls.find(
      (call) => call[5] === tileX * tileSize + 1 && call[6] === 1,
    );
    expect(baseDrawAt(insideWrappedCollarX)?.slice(1)).toEqual([
      2, 2, 32, 32, insideWrappedCollarX * tileSize + 1, 1, 32, 32,
    ]);
    expect(baseDrawAt(immediatelyOutsideX)?.slice(1)).toEqual([
      2, 38, 32, 32, immediatelyOutsideX * tileSize + 1, 1, 32, 32,
    ]);

    const surface = canvases.get("wayfinders.water.chunk.surface.0-0")!;
    const surfaceCalls = vi.mocked(surface.context.drawImage).mock.calls;
    expect(surfaceCalls.some(
      (call) => call[5] === insideWrappedCollarX * tileSize && call[6] === 0,
    )).toBe(false);
    expect(surfaceCalls.find(
      (call) => call[5] === immediatelyOutsideX * tileSize && call[6] === 0,
    )?.slice(1)).toEqual([
      38, 110, 32, 32, immediatelyOutsideX * tileSize, 0, 32, 32,
    ]);
  });
});
