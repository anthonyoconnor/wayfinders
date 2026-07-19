import { beforeEach, describe, expect, it, vi } from "vitest";
import { PILOT_HOME_ISLAND_METADATA } from "../src/wayfinders/assets/AuthoredHomeIsland";
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

  it("keeps authored-home water ownership inside chunk textures without separate sprites", () => {
    const { scene, canvases } = makeScene();
    const generated = generatedWorld();
    const renderer = new WaterRenderer(scene as never, waterAssets() as never, false);
    renderer.render(generated, [entry(3, 0, { x: 0, y: 0 })]);
    expect(createdImages).toHaveLength(2);
    expect(createdImages.every(({ textureKey }) => textureKey.includes("water.chunk"))).toBe(true);

    renderer.update(420);
    expect(createdImages).toHaveLength(2);

    renderer.destroy();
    expect(createdImages.every(({ destroyed }) => destroyed)).toBe(true);
    expect(canvases.size).toBe(0);
    expect(renderer.getTelemetry()).toMatchObject({
      activeImageEntries: 0,
      activeCanonicalChunks: 0,
      activeCanvasTextures: 0,
    });
  });

  it("suppresses generic transitions only for revision-matched authored composite or apron art", () => {
    const renderScenario = (
      sourceKind: "authored" | "procedural",
      plane: "island-composite" | "water-apron" | "land" | "shore-effect",
      presentationRevision = "catalog-current",
      complete = true,
      includeLandPlane = plane === "water-apron",
    ) => {
      const { scene, canvases } = makeScene();
      const source = generatedWorld(64, 32, 32);
      const island = {
        id: 7,
        kind: "low-cay",
        size: "small",
        center: { x: 5, y: 5 },
        radiusX: 1,
        radiusY: 1,
        outerRadius: 2,
        rotation: 0,
        shapeSeed: 4,
        bounds: { minX: 4, minY: 4, maxX: 5, maxY: 5 },
        sourceKind,
        authoredAssetId: "production.island.test",
        authoredCollision: { gridWidth: 2, gridHeight: 2, solidSubcells: [{ x: 1, y: 1 }] },
      } as const;
      const generated = {
        ...source,
        islands: [island],
        landmarks: { ...source.landmarks, homeCenter: { x: 48, y: 16 } },
        manifest: { authoredIslandCatalogRevision: "catalog-current" },
        water: {
          ...source.water,
          baseTypeAt: () => WATER_TYPE_IDS.coastal,
          transitionMaskAt: () => 1,
        },
      } as unknown as GeneratedWorld;
      const presentations = {
        revision: presentationRevision,
        diagnostics: [],
        entry: () => complete ? {
          assetId: "production.island.test",
          name: "Test Island",
          revision: "asset-current",
          gridWidth: 2,
          gridHeight: 2,
          layers: [
            {
              id: "visual",
              plane,
              url: "/visual.png",
              textureKey: "visual",
              pixelWidth: 64,
              pixelHeight: 64,
              opacity: 1,
              blendMode: "normal",
            },
            ...(includeLandPlane ? [{
              id: "land",
              plane: "land" as const,
              url: "/land.png",
              textureKey: "land",
              pixelWidth: 64,
              pixelHeight: 64,
              opacity: 1,
              blendMode: "normal" as const,
            }] : []),
          ],
        } as const : undefined,
      };
      const renderer = new WaterRenderer(
        scene as never,
        waterAssets([WATER_TYPE_IDS.deep, WATER_TYPE_IDS.coastal]) as never,
        false,
        presentations,
      );
      renderer.render(generated, [entry(0, 0, { x: 0, y: 0 })]);
      const base = canvases.get("wayfinders.water.chunk.base.0-0")!;
      const surface = canvases.get("wayfinders.water.chunk.surface.0-0")!;
      const tileSize = prototypeConfig.navigation.tileSize;
      const baseAt = (x: number, y: number) => vi.mocked(base.context.drawImage).mock.calls.find(
        (call) => call[5] === x * tileSize + 1 && call[6] === y * tileSize + 1,
      );
      const surfaceAt = (x: number, y: number) => vi.mocked(surface.context.drawImage).mock.calls.find(
        (call) => call[5] === x * tileSize && call[6] === y * tileSize,
      );
      return { baseAt, surfaceAt };
    };

    for (const plane of ["island-composite", "water-apron"] as const) {
      const owned = renderScenario("authored", plane);
      expect(owned.baseAt(4, 4)?.[2]).toBe(2);
      expect(owned.surfaceAt(4, 4)).toBeUndefined();
      expect(owned.baseAt(3, 4)?.[2]).toBe(2);
      expect(owned.surfaceAt(3, 4)).toBeUndefined();
      expect(owned.baseAt(2, 4)?.[2]).toBe(38);
      expect(owned.surfaceAt(2, 4)).toBeDefined();
    }

    for (const scenario of [
      renderScenario("authored", "land"),
      renderScenario("authored", "island-composite", "catalog-stale"),
      renderScenario("authored", "island-composite", "catalog-current", false),
      renderScenario("procedural", "island-composite"),
      renderScenario("authored", "water-apron", "catalog-current", true, false),
      renderScenario("authored", "shore-effect"),
    ]) {
      expect(scenario.baseAt(4, 4)?.[2]).toBe(38);
      expect(scenario.surfaceAt(4, 4)).toBeDefined();
    }
  });

  it("holds the initial surface frame under reduced motion", () => {
    const { scene } = makeScene();
    const generated = generatedWorld();
    const renderer = new WaterRenderer(scene as never, waterAssets() as never, true);
    renderer.render(generated, [entry(0, 0, { x: 0, y: 0 })]);
    renderer.update(4_200);
    expect(renderer.getTelemetry()).toMatchObject({ redrawCount: 1, animatedRedrawCount: 0 });
  });

  it.each([
    { name: "missing", presentation: undefined },
    {
      name: "land-only",
      presentation: {
        ...PILOT_HOME_ISLAND_METADATA,
        render: { ...PILOT_HOME_ISLAND_METADATA.render, plane: "land" as const },
      },
    },
  ])("retains generated home water when the Home presentation is $name", ({ presentation }) => {
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
      undefined,
      presentation,
    );

    renderer.render(generated, [entry(0, 0, { x: 0, y: 0 })]);

    const topLeftX = -PILOT_HOME_ISLAND_METADATA.anchors.homeCenter.x;
    const formerlyOwnedX = source.grid.topology.canonicalizeTile(topLeftX - 1, 0)!.x;
    const tileSize = prototypeConfig.navigation.tileSize;
    const base = canvases.get("wayfinders.water.chunk.base.0-0")!;
    const baseDraw = vi.mocked(base.context.drawImage).mock.calls.find(
      (call) => call[5] === formerlyOwnedX * tileSize + 1 && call[6] === 1,
    );
    expect(baseDraw?.[2]).toBe(38);

    const surface = canvases.get("wayfinders.water.chunk.surface.0-0")!;
    expect(vi.mocked(surface.context.drawImage).mock.calls.some(
      (call) => call[5] === formerlyOwnedX * tileSize && call[6] === 0,
    )).toBe(true);
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
      undefined,
      PILOT_HOME_ISLAND_METADATA,
    );

    renderer.render(generated, [entry(0, 0, { x: 0, y: 0 })]);

    const base = canvases.get("wayfinders.water.chunk.base.0-0")!;
    const baseCalls = vi.mocked(base.context.drawImage).mock.calls;
    const topLeftX = -PILOT_HOME_ISLAND_METADATA.anchors.homeCenter.x;
    const insideWrappedCollarX = source.grid.topology.canonicalizeTile(topLeftX - 1, 0)!.x;
    const immediatelyOutsideX = source.grid.topology.canonicalizeTile(topLeftX - 2, 0)!.x;
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
    const outsideTransition = surfaceCalls.find(
      (call) => call[5] === immediatelyOutsideX * tileSize && call[6] === 0,
    );
    expect(outsideTransition?.[1]).toBe(38);
    expect(outsideTransition?.slice(3)).toEqual([
      32, 32, immediatelyOutsideX * tileSize, 0, 32, 32,
    ]);
  });
});
