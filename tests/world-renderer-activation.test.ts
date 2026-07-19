import { describe, expect, it, vi } from "vitest";
import { PILOT_HOME_ISLAND_METADATA } from "../src/wayfinders/assets/AuthoredHomeIsland";
import type { ActiveChunkEntry } from "../src/wayfinders/rendering/activation/ActiveChunkContracts";
import { activeChunkViewKey } from "../src/wayfinders/rendering/activation/ActiveChunkSet";
import { WorldRenderer } from "../src/wayfinders/rendering/WorldRenderer";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import type { GeneratedWorld } from "../src/wayfinders/world/WorldGenerator";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  type WorldTopologyDefinition,
} from "../src/wayfinders/world/WorldTopology";

const { graphicsFills } = vi.hoisted(() => ({
  graphicsFills: [] as Array<{ color: number; x: number; y: number; width: number; height: number }>,
}));

vi.mock("phaser", () => {
  class Graphics {
    destroyed = false;
    private fillColor = 0;

    constructor(_scene?: unknown) {}

    willRender(): boolean { return true; }
    setPosition(): this { return this; }
    setDepth(): this { return this; }
    clear(): this { return this; }
    fillStyle(color: number): this { this.fillColor = color; return this; }
    fillRect(x: number, y: number, width: number, height: number): this {
      graphicsFills.push({ color: this.fillColor, x, y, width, height });
      return this;
    }
    fillRoundedRect(): this { return this; }
    fillTriangle(): this { return this; }
    fillCircle(): this { return this; }
    lineStyle(): this { return this; }
    lineBetween(): this { return this; }
    beginPath(): this { return this; }
    moveTo(): this { return this; }
    lineTo(): this { return this; }
    strokePath(): this { return this; }
    destroy(): void { this.destroyed = true; }
  }

  class Rectangle {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;

    constructor(x: number, y: number, width: number, height: number) {
      this.left = x;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
    }
  }

  return {
    default: {
      GameObjects: { Graphics },
      BlendModes: { NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3 },
      Geom: { Rectangle },
      Scenes: { Events: { SHUTDOWN: "shutdown" } },
    },
  };
});

interface FakeObject {
  x: number;
  y: number;
  destroyed: boolean;
  textureKey?: string;
  displayWidth?: number;
  displayHeight?: number;
  alpha?: number;
  blendMode?: number;
  depth?: number;
  visible?: boolean;
  setOrigin(...args: unknown[]): FakeObject;
  setDepth(depth: number): FakeObject;
  setVisible(value: boolean): FakeObject;
  setSize(width: number, height: number): FakeObject;
  setPosition(x: number, y: number): FakeObject;
  setDisplaySize(...args: unknown[]): FakeObject;
  setAlpha(value: number): FakeObject;
  setBlendMode(value: number): FakeObject;
  destroy(): void;
}

function fakeObject(x = 0, y = 0): FakeObject {
  return {
    x,
    y,
    destroyed: false,
    setOrigin() { return this; },
    setDepth(depth: number) { this.depth = depth; return this; },
    setVisible(value: boolean) { this.visible = value; return this; },
    setSize(width: number, height: number) {
      this.displayWidth = width;
      this.displayHeight = height;
      return this;
    },
    setPosition(nextX: number, nextY: number) {
      this.x = nextX;
      this.y = nextY;
      return this;
    },
    setDisplaySize() { return this; },
    setAlpha(value: number) { this.alpha = value; return this; },
    setBlendMode(value: number) { this.blendMode = value; return this; },
    destroy() { this.destroyed = true; },
  };
}

function makeScene() {
  const existing: Array<{ destroyed?: boolean }> = [];
  const images: FakeObject[] = [];
  const texts: FakeObject[] = [];
  const scene = {
    events: {
      once: () => undefined,
      off: () => undefined,
    },
    add: {
      existing: (object: { destroyed?: boolean }) => { existing.push(object); },
      rectangle: () => {
        const object = fakeObject();
        existing.push(object);
        return object;
      },
      graphics: () => {
        const object = fakeObject() as FakeObject & {
          lineStyle(...args: unknown[]): typeof object;
          lineBetween(...args: unknown[]): typeof object;
          fillStyle(...args: unknown[]): typeof object;
          fillTriangle(...args: unknown[]): typeof object;
          fillRect(...args: unknown[]): typeof object;
        };
        object.lineStyle = () => object;
        object.lineBetween = () => object;
        object.fillStyle = () => object;
        object.fillTriangle = () => object;
        object.fillRect = () => object;
        existing.push(object);
        return object;
      },
      image: (x: number, y: number, textureKey?: string) => {
        const image = fakeObject(x, y);
        image.textureKey = textureKey;
        image.setDisplaySize = (width, height) => {
          image.displayWidth = width as number;
          image.displayHeight = height as number;
          return image;
        };
        images.push(image);
        return image;
      },
      text: (x: number, y: number) => {
        const label = fakeObject(x, y);
        texts.push(label);
        return label;
      },
    },
  };
  return { scene, existing, images, texts };
}

function entry(
  x: number,
  y: number,
  loadPriority: number,
  imageOffset = { x: 0, y: 0 },
  band: ActiveChunkEntry["band"] = "visible",
): Readonly<ActiveChunkEntry> {
  return Object.freeze({
    viewKey: activeChunkViewKey(x, y, imageOffset.x, imageOffset.y),
    canonicalChunk: Object.freeze({ x, y }),
    imageOffset: Object.freeze({ ...imageOffset }),
    band,
    ringDistance: 0,
    loadPriority,
  });
}

function generatedWorld(
  width = 32,
  height = 16,
  chunkSize = 8,
  topology: Readonly<WorldTopologyDefinition> = BOUNDED_WORLD_TOPOLOGY,
): GeneratedWorld {
  const grid = new WorldGrid(width, height, chunkSize, topology);
  grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  return {
    seed: 44,
    grid,
    islands: [],
    landmarks: {
      homeCenter: { x: 24, y: 8 },
      harbour: { x: 26, y: 8 },
      dock: { x: 27, y: 8 },
      homeReturnTile: { x: 27, y: 8 },
      hiddenObstacleCenter: { x: 12, y: 4 },
      hiddenResource: { x: 14, y: 4 },
    },
  } as unknown as GeneratedWorld;
}

describe("WorldRenderer active chunk resources", () => {
  it("binds a world without allocating any chunk presentation resources", () => {
    const { scene } = makeScene();
    const renderer = new WorldRenderer(scene as never);

    const result = renderer.render(generatedWorld());

    expect(result.telemetry).toMatchObject({
      activeImageEntries: 0,
      activeResourceObjects: 0,
      totalObjects: 1,
      tilesVisitedLastUpdate: 0,
    });
  });

  it("visits only activated chunk bounds and keeps resources bounded while sailing", () => {
    const { scene } = makeScene();
    const renderer = new WorldRenderer(scene as never);
    renderer.render(generatedWorld(64, 64, 8));

    const first = renderer.syncActiveChunks([entry(7, 6, 1), entry(6, 6, 0)]);
    expect(first).toMatchObject({ activated: 2, deactivated: 0, retained: 0 });
    expect(first.telemetry.activeViewKeys).toEqual(["6,6@0,0", "7,6@0,0"]);
    expect(first.telemetry.tilesVisitedLastUpdate).toBe(2 * 8 * 8);
    const plateau = first.telemetry.activeResourceObjects;
    expect(plateau).toBe(0);

    const stationary = renderer.syncActiveChunks([entry(6, 6, 0), entry(7, 6, 1)]);
    expect(stationary).toMatchObject({ activated: 0, deactivated: 0, retained: 2 });
    expect(stationary.telemetry.tilesVisitedLastUpdate).toBe(0);

    const moved = renderer.syncActiveChunks([entry(7, 6, 0), entry(6, 7, 1)]);
    expect(moved).toMatchObject({ activated: 1, deactivated: 1, retained: 1 });
    expect(moved.telemetry.activeImageEntries).toBe(2);
    expect(moved.telemetry.activeResourceObjects).toBe(plateau);
    expect(moved.telemetry.tilesVisitedLastUpdate).toBe(8 * 8);
    expect(moved.telemetry.totalResourceObjectsDestroyed).toBe(0);
  });

  it("creates and destroys one authored home image when any footprint chunk is active", () => {
    const { scene, images, texts } = makeScene();
    const assets = {
      metadata: () => PILOT_HOME_ISLAND_METADATA,
      textureKey: (id: string) => id,
    };
    const renderer = new WorldRenderer(scene as never, assets as never);
    const generated = generatedWorld();
    renderer.render(generated, [entry(0, 0, 0)]);
    expect(images).toHaveLength(0);
    expect(texts).toHaveLength(0);

    const activated = renderer.syncActiveChunks([entry(3, 1, 0)]);
    expect(activated.telemetry.activeAuthoredImageObjects)
      .toBe(PILOT_HOME_ISLAND_METADATA.render.slices.length);
    expect(images).toHaveLength(PILOT_HOME_ISLAND_METADATA.render.slices.length);
    expect(texts).toHaveLength(1);

    renderer.syncActiveChunks([entry(0, 0, 0)]);
    expect(images.every(({ destroyed }) => destroyed)).toBe(true);
    expect(texts.every(({ destroyed }) => destroyed)).toBe(true);
    expect(renderer.getTelemetry().activeAuthoredImageObjects).toBe(0);
  });

  it("activates authored island art by footprint when its center chunk is outside the view", () => {
    const { scene, images } = makeScene();
    const generated = generatedWorld(32, 16, 8);
    const island = {
      id: 7,
      kind: "low-cay",
      size: "small",
      center: { x: 10, y: 4 },
      radiusX: 2,
      radiusY: 1,
      outerRadius: 4,
      rotation: 0,
      shapeSeed: 5,
      bounds: { minX: 7, minY: 3, maxX: 10, maxY: 4 },
      sourceKind: "authored",
      authoredAssetId: "production.island.test-cay",
      authoredCollision: { gridWidth: 4, gridHeight: 2, solidSubcells: [{ x: 1, y: 1 }] },
    } as const;
    (generated as { islands: readonly unknown[] }).islands = [island];
    generated.grid.setTerrain(island.bounds.minX, island.bounds.minY, TerrainType.Land);
    generated.grid.setIslandId(island.bounds.minX, island.bounds.minY, island.id);
    const presentations = {
      revision: "catalog-test",
      diagnostics: [],
      entry: (assetId: string) => assetId === island.authoredAssetId ? {
        assetId,
        name: "Test Cay",
        revision: "revision-1",
        gridWidth: 4,
        gridHeight: 2,
        layers: [
          { id: "apron", plane: "water-apron", url: "/apron.png", textureKey: "apron", pixelWidth: 128, pixelHeight: 64, opacity: 1, blendMode: "normal" },
          { id: "base", plane: "land", url: "/base.png", textureKey: "base", pixelWidth: 128, pixelHeight: 64, opacity: 1, blendMode: "normal" },
          { id: "detail", plane: "land", url: "/detail.png", textureKey: "detail", pixelWidth: 128, pixelHeight: 64, opacity: 0.75, blendMode: "multiply" },
          { id: "surf", plane: "shore-effect", url: "/surf.png", textureKey: "surf", pixelWidth: 128, pixelHeight: 64, opacity: 0.9, blendMode: "screen" },
        ],
      } as const : undefined,
    };
    (generated as unknown as { manifest: { authoredIslandCatalogRevision: string } }).manifest = {
      authoredIslandCatalogRevision: "catalog-test",
    };
    const renderer = new WorldRenderer(scene as never, undefined, presentations);
    graphicsFills.length = 0;

    const activated = renderer.render(generated, [entry(0, 0, 0)]);
    expect(activated.telemetry.activeAuthoredImageObjects).toBe(4);
    expect(images).toMatchObject([
      { x: 224, y: 96, textureKey: "apron", displayWidth: 128, displayHeight: 64, alpha: 1, blendMode: 0, depth: 1.7 },
      { x: 224, y: 96, textureKey: "base", displayWidth: 128, displayHeight: 64, alpha: 1, blendMode: 0, depth: 4 },
      { x: 224, y: 96, textureKey: "detail", displayWidth: 128, displayHeight: 64, alpha: 0.75, blendMode: 2, depth: 4.01 },
      { x: 224, y: 96, textureKey: "surf", displayWidth: 128, displayHeight: 64, alpha: 0.9, blendMode: 3, depth: 4.75 },
    ]);
    const retained = renderer.syncActiveChunks([entry(1, 0, 0)]);
    expect(retained).toMatchObject({ activated: 1, deactivated: 1, retained: 0 });
    expect(images).toHaveLength(4);
    expect(images.every(({ destroyed }) => !destroyed)).toBe(true);

    renderer.syncActiveChunks([entry(2, 0, 0)]);
    expect(images.every(({ destroyed }) => destroyed)).toBe(true);
    expect(renderer.getTelemetry().activeAuthoredImageObjects).toBe(0);

    renderer.syncActiveChunks([entry(0, 0, 0)]);
    expect(images).toHaveLength(8);
    expect(renderer.getTelemetry().activeAuthoredImageObjects).toBe(4);
    expect(renderer.getTelemetry().peakResourceObjects).toBeLessThanOrEqual(9);
  });

  it.each([
    { name: "water-apron-only", plane: "water-apron" as const, revision: "catalog-test", gridWidth: 2 },
    { name: "shore-effect-only", plane: "shore-effect" as const, revision: "catalog-test", gridWidth: 2 },
    { name: "stale composite", plane: "island-composite" as const, revision: "catalog-stale", gridWidth: 2 },
    { name: "size-mismatched composite", plane: "island-composite" as const, revision: "catalog-test", gridWidth: 3 },
  ])("keeps fallback terrain for a $name presentation", ({ plane, revision, gridWidth }) => {
    const { scene, images } = makeScene();
    const generated = generatedWorld(32, 16, 8);
    const island = {
      id: 11,
      kind: "low-cay",
      size: "small",
      center: { x: 5, y: 4 },
      radiusX: 1,
      radiusY: 1,
      outerRadius: 2,
      rotation: 0,
      shapeSeed: 7,
      bounds: { minX: 4, minY: 3, maxX: 5, maxY: 4 },
      sourceKind: "authored",
      authoredAssetId: "production.island.incomplete",
      authoredCollision: { gridWidth: 2, gridHeight: 2, solidSubcells: [{ x: 1, y: 1 }] },
    } as const;
    (generated as { islands: readonly unknown[] }).islands = [island];
    generated.grid.setTerrain(island.bounds.minX, island.bounds.minY, TerrainType.Land);
    generated.grid.setIslandId(island.bounds.minX, island.bounds.minY, island.id);
    (generated as unknown as { manifest: { authoredIslandCatalogRevision: string } }).manifest = {
      authoredIslandCatalogRevision: "catalog-test",
    };
    const presentations = {
      revision,
      diagnostics: [],
      entry: () => ({
        assetId: island.authoredAssetId,
        name: "Incomplete Island",
        revision: "revision-1",
        gridWidth,
        gridHeight: 2,
        layers: [{
          id: "visual",
          plane,
          url: "/visual.png",
          textureKey: "visual",
          pixelWidth: 64,
          pixelHeight: 64,
          opacity: 1,
          blendMode: "normal" as const,
        }],
      }),
    };
    const renderer = new WorldRenderer(scene as never, undefined, presentations);

    const result = renderer.render(generated, [entry(0, 0, 0)]);

    expect(images).toHaveLength(0);
    expect(result.telemetry.activeAuthoredImageObjects).toBe(0);
    expect(result.telemetry.activeGraphicsObjects).toBeGreaterThan(0);
  });

  it("keeps one authored island alias stable while adjacent chunk images cross a seam", () => {
    const { scene, images } = makeScene();
    const generated = generatedWorld(32, 16, 8, WRAPPING_WORLD_TOPOLOGY);
    const island = {
      id: 9,
      kind: "low-cay",
      size: "small",
      center: { x: 0, y: 4 },
      radiusX: 2,
      radiusY: 1,
      outerRadius: 4,
      rotation: 0,
      shapeSeed: 5,
      bounds: { minX: -2, minY: 3, maxX: 1, maxY: 4 },
      sourceKind: "authored",
      authoredAssetId: "production.island.seam-cay",
      authoredCollision: { gridWidth: 4, gridHeight: 2, solidSubcells: [{ x: 0, y: 0 }] },
    } as const;
    (generated as { islands: readonly unknown[] }).islands = [island];
    generated.grid.setTerrain(30, 3, TerrainType.Land);
    generated.grid.setIslandId(30, 3, island.id);
    (generated as unknown as { manifest: { authoredIslandCatalogRevision: string } }).manifest = {
      authoredIslandCatalogRevision: "catalog-seam",
    };
    const presentations = {
      revision: "catalog-seam",
      diagnostics: [],
      entry: (assetId: string) => assetId === island.authoredAssetId ? {
        assetId,
        name: "Seam Cay",
        revision: "revision-1",
        gridWidth: 4,
        gridHeight: 2,
        layers: [
          { id: "base", plane: "island-composite", url: "/base.png", textureKey: "base", pixelWidth: 128, pixelHeight: 64, opacity: 1, blendMode: "normal" },
        ],
      } as const : undefined,
    };
    const renderer = new WorldRenderer(scene as never, undefined, presentations);

    renderer.render(generated, [entry(3, 0, 0)]);
    expect(images).toMatchObject([{ x: 960, y: 96, textureKey: "base" }]);

    renderer.syncActiveChunks([entry(0, 0, 0, { x: 1_024, y: 0 })]);
    expect(images).toHaveLength(1);
    expect(images[0].destroyed).toBe(false);
    expect(renderer.getTelemetry()).toMatchObject({
      activeImageEntries: 1,
      activeCanonicalChunks: 1,
      activeAuthoredImageObjects: 1,
    });

    renderer.destroy();
    expect(images[0].destroyed).toBe(true);
    expect(renderer.getTelemetry().activeResourceObjects).toBe(0);
  });

  it("sizes the ocean fallback to lifted visible demand even when entries are deferred", () => {
    const { scene, existing } = makeScene();
    const renderer = new WorldRenderer(scene as never);
    const generated = generatedWorld(32, 16, 8, WRAPPING_WORLD_TOPOLOGY);
    renderer.render(generated);
    const active = [entry(0, 0, 0, { x: 2_048, y: 0 })];

    renderer.applyActiveChunks({
      revision: 1,
      membershipRevision: 1,
      visibleTileBounds: { minX: 64, minY: -4, maxX: 75, maxY: 7 },
      activated: active,
      deactivated: [],
      updated: [],
      active,
      deferred: [entry(1, 0, 1, { x: 2_048, y: 0 })],
      telemetry: {} as never,
    });

    expect(existing[0]).toMatchObject({
      x: 2_048,
      y: -128,
      displayWidth: 384,
      displayHeight: 384,
      visible: true,
    });
  });
});
