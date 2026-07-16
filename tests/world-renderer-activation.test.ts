import { describe, expect, it, vi } from "vitest";
import { PILOT_HOME_ISLAND_METADATA } from "../src/wayfinders/assets/AuthoredHomeIsland";
import type { ActiveChunkEntry } from "../src/wayfinders/rendering/activation/ActiveChunkContracts";
import { WorldRenderer } from "../src/wayfinders/rendering/WorldRenderer";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import type { GeneratedWorld } from "../src/wayfinders/world/WorldGenerator";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";

vi.mock("phaser", () => {
  class Graphics {
    destroyed = false;

    constructor(_scene?: unknown) {}

    willRender(): boolean { return true; }
    setPosition(): this { return this; }
    setDepth(): this { return this; }
    clear(): this { return this; }
    fillStyle(): this { return this; }
    fillRect(): this { return this; }
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
  setOrigin(...args: unknown[]): FakeObject;
  setDepth(...args: unknown[]): FakeObject;
  setVisible(...args: unknown[]): FakeObject;
  setSize(...args: unknown[]): FakeObject;
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
    setDepth() { return this; },
    setVisible() { return this; },
    setSize() { return this; },
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

function entry(x: number, y: number, loadPriority: number): Readonly<ActiveChunkEntry> {
  return Object.freeze({
    key: `${x},${y}`,
    coordinate: Object.freeze({ x, y }),
    band: "visible" as const,
    ringDistance: 0,
    loadPriority,
  });
}

function generatedWorld(width = 32, height = 16, chunkSize = 8): GeneratedWorld {
  const grid = new WorldGrid(width, height, chunkSize);
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
      activeChunks: 0,
      activeResourceObjects: 0,
      totalObjects: 1,
      tilesVisitedLastUpdate: 0,
    });
  });

  it("visits only activated chunk bounds and keeps resources bounded while sailing", () => {
    const { scene } = makeScene();
    const renderer = new WorldRenderer(scene as never);
    renderer.render(generatedWorld());

    const first = renderer.syncActiveChunks([entry(1, 0, 1), entry(0, 0, 0)]);
    expect(first).toMatchObject({ activated: 2, deactivated: 0, retained: 0 });
    expect(first.telemetry.activeChunkKeys).toEqual(["0,0", "1,0"]);
    expect(first.telemetry.tilesVisitedLastUpdate).toBe(2 * 8 * 8);
    const plateau = first.telemetry.activeResourceObjects;

    const stationary = renderer.syncActiveChunks([entry(0, 0, 0), entry(1, 0, 1)]);
    expect(stationary).toMatchObject({ activated: 0, deactivated: 0, retained: 2 });
    expect(stationary.telemetry.tilesVisitedLastUpdate).toBe(0);

    const moved = renderer.syncActiveChunks([entry(1, 0, 0), entry(2, 0, 1)]);
    expect(moved).toMatchObject({ activated: 1, deactivated: 1, retained: 1 });
    expect(moved.telemetry.activeChunks).toBe(2);
    expect(moved.telemetry.activeResourceObjects).toBe(plateau);
    expect(moved.telemetry.tilesVisitedLastUpdate).toBe(8 * 8);
    expect(moved.telemetry.totalResourceObjectsDestroyed).toBeGreaterThan(0);
  });

  it("checks knowledge revisions only for active chunk views", () => {
    const { scene } = makeScene();
    const renderer = new WorldRenderer(scene as never);
    const generated = generatedWorld();
    renderer.render(generated, [entry(0, 0, 0)]);
    const loadedScan = vi.spyOn(generated.grid, "getLoadedChunks");

    generated.grid.setKnowledge(1, 1, KnowledgeState.Supported);
    generated.grid.setKnowledge(17, 1, KnowledgeState.Supported);
    const refreshed = renderer.refreshKnowledge(generated);

    expect(refreshed).toBe(1);
    expect(loadedScan).not.toHaveBeenCalled();
  });

  it("creates and destroys authored home art with its owning active chunk", () => {
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

  it("aligns authored island layers to manifest bounds and owns them with the active center chunk", () => {
    const { scene, images } = makeScene();
    const generated = generatedWorld(32, 16, 8);
    const island = {
      id: 7,
      kind: "low-cay",
      size: "small",
      center: { x: 12, y: 4 },
      radiusX: 2,
      radiusY: 1,
      outerRadius: 4,
      rotation: 0,
      shapeSeed: 5,
      bounds: { minX: 10, minY: 3, maxX: 13, maxY: 4 },
      sourceKind: "authored",
      authoredAssetId: "production.island.test-cay",
      authoredCollision: { gridWidth: 4, gridHeight: 2, solidSubcells: [{ x: 1, y: 1 }] },
    } as const;
    (generated as { islands: readonly unknown[] }).islands = [island];
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
          { id: "base", url: "/base.png", textureKey: "base", pixelWidth: 128, pixelHeight: 64, opacity: 1, blendMode: "normal" },
          { id: "detail", url: "/detail.png", textureKey: "detail", pixelWidth: 128, pixelHeight: 64, opacity: 0.75, blendMode: "multiply" },
        ],
      } as const : undefined,
    };
    (generated as unknown as { manifest: { authoredIslandCatalogRevision: string } }).manifest = {
      authoredIslandCatalogRevision: "catalog-test",
    };
    const renderer = new WorldRenderer(scene as never, undefined, presentations);

    renderer.render(generated, [entry(0, 0, 0)]);
    expect(images).toHaveLength(0);

    const activated = renderer.syncActiveChunks([entry(1, 0, 0)]);
    expect(activated.telemetry.activeAuthoredImageObjects).toBe(2);
    expect(images).toMatchObject([
      { x: 320, y: 96, textureKey: "base", displayWidth: 128, displayHeight: 64, alpha: 1, blendMode: 0 },
      { x: 320, y: 96, textureKey: "detail", displayWidth: 128, displayHeight: 64, alpha: 0.75, blendMode: 2 },
    ]);
    const retained = renderer.syncActiveChunks([entry(1, 0, 0)]);
    expect(retained).toMatchObject({ activated: 0, deactivated: 0, retained: 1 });
    expect(images).toHaveLength(2);

    renderer.syncActiveChunks([entry(0, 0, 0)]);
    expect(images.every(({ destroyed }) => destroyed)).toBe(true);
    expect(renderer.getTelemetry().activeAuthoredImageObjects).toBe(0);

    renderer.syncActiveChunks([entry(1, 0, 0)]);
    expect(images).toHaveLength(4);
    expect(renderer.getTelemetry().activeAuthoredImageObjects).toBe(2);
    expect(renderer.getTelemetry().peakResourceObjects).toBeLessThanOrEqual(7);
  });
});
