import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KnowledgeOverlayRenderer,
  isExactIslandTileRevealed,
} from "../src/wayfinders/rendering/KnowledgeOverlayRenderer";
import { ActiveChunkSet } from "../src/wayfinders/rendering/activation";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
} from "../src/wayfinders/world/WorldTopology";

vi.mock("phaser", () => ({
  default: { Textures: { FilterMode: { LINEAR: 0 } } },
}));

interface FillCall {
  x: number;
  y: number;
}

interface ClearCall extends FillCall {
  width: number;
  height: number;
}

function makeContext(fillCalls?: FillCall[], clearCalls?: ClearCall[]): CanvasRenderingContext2D {
  return {
    fillStyle: "",
    filter: "none",
    clearRect: (x: number, y: number, width: number, height: number) => {
      if (fillCalls) fillCalls.length = 0;
      if (clearCalls) clearCalls.push({ x, y, width, height });
    },
    fillRect: (x: number, y: number) => fillCalls?.push({ x, y }),
    save: () => undefined,
    restore: () => undefined,
    drawImage: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

function makeHarness(key = "island-fog-test") {
  const scratchCalls: FillCall[] = [];
  const filteredClearCalls: ClearCall[] = [];
  const displaySizes: Array<{ width: number; height: number }> = [];
  const images: Array<{ visible: boolean }> = [];
  const canvasContexts = [makeContext(scratchCalls), makeContext(undefined, filteredClearCalls)];
  vi.stubGlobal("document", {
    createElement: () => {
      const context = canvasContexts.shift();
      if (!context) throw new Error("Unexpected mask canvas allocation");
      return {
        width: 0,
        height: 0,
        getContext: () => context,
      };
    },
  });

  const textures = new Map<string, { refreshCount: number }>();
  const scene = {
    sys: { settings: { key } },
    textures: {
      createCanvas(textureKey: string, width: number, height: number) {
        const texture = {
          width,
          height,
          refreshCount: 0,
          setFilter: () => undefined,
          add: () => undefined,
          getContext: () => makeContext(),
          refresh() { this.refreshCount++; },
        };
        textures.set(textureKey, texture);
        return texture;
      },
      exists: (textureKey: string) => textures.has(textureKey),
      remove: (textureKey: string) => textures.delete(textureKey),
    },
    add: {
      image: () => {
        const image = {
          visible: true,
          setOrigin: () => image,
          setDisplaySize: (width: number, height: number) => {
            displaySizes.push({ width, height });
            return image;
          },
          setDepth: () => image,
          setVisible: (visible: boolean) => {
            image.visible = visible;
            return image;
          },
          destroy: () => undefined,
        };
        images.push(image);
        return image;
      },
    },
  };

  return {
    renderer: new KnowledgeOverlayRenderer(scene as never),
    scratchCalls,
    filteredClearCalls,
    displaySizes,
    images,
    textureKeys: () => [...textures.keys()].sort(),
    texture: (chunkX = 0, chunkY = 0) => {
      const texture = textures.get(`${key}-knowledge-mask-${chunkX}-${chunkY}`);
      if (!texture) throw new Error("Knowledge mask texture was not created");
      return texture;
    },
  };
}

function activateAllChunks(renderer: KnowledgeOverlayRenderer, world: WorldGrid): void {
  const maxX = Math.ceil(world.width / world.chunkSize) - 1;
  const maxY = Math.ceil(world.height / world.chunkSize) - 1;
  const activeChunks = new ActiveChunkSet({
    topology: world.topology,
    prefetchRing: 0,
    maxActiveChunks: (maxX + 1) * (maxY + 1),
  });
  renderer.applyActiveChunkDelta(
    world,
    activeChunks.update({ minX: 0, minY: 0, maxX: world.width - 1, maxY: world.height - 1 }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("exact island dossier fog reveal", () => {
  it("hides existing and newly activated fog views during presentation review", () => {
    const world = new WorldGrid(8, 1, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const activeChunks = new ActiveChunkSet({
      topology: world.topology,
      prefetchRing: 0,
      maxActiveChunks: 2,
    });
    const { renderer, images } = makeHarness("fog-review-test");
    renderer.applyActiveChunkDelta(
      world,
      activeChunks.update({ minX: 0, minY: 0, maxX: 3, maxY: 0 }),
    );
    expect(images.map(({ visible }) => visible)).toEqual([true]);

    expect(renderer.setVisible(false)).toBe(true);
    renderer.applyActiveChunkDelta(
      world,
      activeChunks.update({ minX: 0, minY: 0, maxX: 7, maxY: 0 }),
    );
    expect(images.map(({ visible }) => visible)).toEqual([false, false]);
    expect(renderer.setVisible(false)).toBe(false);
    expect(renderer.setVisible(true)).toBe(true);
    expect(images.map(({ visible }) => visible)).toEqual([true, true]);
  });

  it("shares one canonical mask across seam aliases and sizes partial chunks exactly", () => {
    const wrapping = new WorldGrid(4, 1, 4, WRAPPING_WORLD_TOPOLOGY);
    wrapping.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const activeChunks = new ActiveChunkSet({
      topology: wrapping.topology,
      prefetchRing: 0,
      maxActiveChunks: 2,
    });
    const { renderer, textureKeys, displaySizes } = makeHarness("fog-alias-test");
    renderer.applyActiveChunkDelta(
      wrapping,
      activeChunks.update({ minX: -1, minY: 0, maxX: 0, maxY: 0 }),
    );
    renderer.sync(wrapping, 17);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeChunks: 2,
      activeTextures: 1,
      activeSprites: 2,
      totalTextureAllocations: 1,
    });
    expect(textureKeys()).toEqual(["fog-alias-test-knowledge-mask-0-0"]);
    expect(displaySizes).toEqual([
      { width: 128, height: 32 },
      { width: 128, height: 32 },
    ]);

    const partial = new WorldGrid(5, 3, 4, BOUNDED_WORLD_TOPOLOGY);
    partial.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const partialSet = new ActiveChunkSet({
      topology: partial.topology,
      prefetchRing: 0,
      maxActiveChunks: 1,
    });
    const partialHarness = makeHarness("fog-partial-test");
    partialHarness.renderer.applyActiveChunkDelta(
      partial,
      partialSet.update({ minX: 4, minY: 0, maxX: 4, maxY: 2 }),
    );
    partialHarness.renderer.sync(partial, 17);
    expect(partialHarness.texture(1, 0)).toMatchObject({ width: 12, height: 20 });
    expect(partialHarness.displaySizes).toEqual([{ width: 32, height: 96 }]);
    expect(partialHarness.renderer.getResourceTelemetry().estimatedTextureBytes).toBe(960);
  });

  it("retains canonical masks when a rebase replaces every periodic image alias", () => {
    const world = new WorldGrid(8, 1, 4, WRAPPING_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const activeChunks = new ActiveChunkSet({
      topology: world.topology,
      prefetchRing: 0,
      maxActiveChunks: 2,
    });
    const { renderer, texture } = makeHarness("fog-rebase-test");
    const first = activeChunks.update({ minX: 0, minY: 0, maxX: 7, maxY: 0 });
    renderer.applyActiveChunkDelta(world, first);
    renderer.sync(world, 17);
    const refreshes = [texture(0, 0).refreshCount, texture(1, 0).refreshCount];

    const rebased = activeChunks.update({ minX: 8, minY: 0, maxX: 15, maxY: 0 });
    expect(rebased.activated).toHaveLength(2);
    expect(rebased.deactivated).toHaveLength(2);
    expect(new Set(rebased.active.map(({ canonicalChunk }) => (
      `${canonicalChunk.x},${canonicalChunk.y}`
    )))).toEqual(new Set(["0,0", "1,0"]));
    renderer.applyActiveChunkDelta(world, rebased);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeChunks: 2,
      activeTextures: 2,
      activeSprites: 2,
      totalTextureAllocations: 2,
      totalTextureReleases: 0,
    });

    renderer.sync(world, 17);
    expect([texture(0, 0).refreshCount, texture(1, 0).refreshCount]).toEqual(refreshes);
  });

  it("releases inactive mask textures and keeps the decoded set at its chunk cap", () => {
    const world = new WorldGrid(8, 1, 4, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const activeChunks = new ActiveChunkSet({
      topology: world.topology,
      prefetchRing: 0,
      maxActiveChunks: 1,
    });
    const { renderer, texture, textureKeys } = makeHarness("active-fog-test");

    renderer.applyActiveChunkDelta(
      world,
      activeChunks.update({ minX: 0, minY: 0, maxX: 3, maxY: 0 }),
    );
    renderer.sync(world, 17);
    expect(textureKeys()).toEqual(["active-fog-test-knowledge-mask-0-0"]);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      chunkCapacity: 1,
      activeChunks: 1,
      activeTextures: 1,
      activeSprites: 1,
      estimatedTextureBytes: 1_152,
      peakActiveTextures: 1,
    });

    const firstRefreshes = texture(0, 0).refreshCount;
    // The active mask samples a one-tile border from this inactive neighbour.
    world.setKnowledge(4, 0, KnowledgeState.Personal, 2);
    renderer.sync(world, 17);
    expect(texture(0, 0).refreshCount).toBe(firstRefreshes + 1);

    renderer.applyActiveChunkDelta(
      world,
      activeChunks.update({ minX: 4, minY: 0, maxX: 7, maxY: 0 }),
    );
    renderer.sync(world, 17);
    expect(textureKeys()).toEqual(["active-fog-test-knowledge-mask-1-0"]);
    expect(texture(1, 0).refreshCount).toBe(1);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeChunks: 1,
      activeTextures: 1,
      totalTextureAllocations: 2,
      totalTextureReleases: 1,
    });
  });

  it("accepts only exact positive island IDs", () => {
    const revealed = new Set([-1, 0, 2]);
    expect(isExactIslandTileRevealed(-1, revealed)).toBe(false);
    expect(isExactIslandTileRevealed(0, revealed)).toBe(false);
    expect(isExactIslandTileRevealed(1, revealed)).toBe(false);
    expect(isExactIslandTileRevealed(2, revealed)).toBe(true);
  });

  it("redraws on reveal and rollback tokens without changing world knowledge or visibility", () => {
    const world = new WorldGrid(4, 1, 4, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setIslandId(1, 0, 1);
    world.setIslandId(2, 0, 1);
    world.setIslandId(3, 0, 2);
    const chunk = world.getChunk(0, 0)!;
    const chunkRevision = chunk.revision;
    const knowledgeVersion = world.knowledgeVersion;
    const visibilityVersion = world.visibilityVersion;
    const knowledgeBefore = [0, 1, 2, 3].map((x) => world.getKnowledge(x, 0));
    const visibilityBefore = [0, 1, 2, 3].map((x) => world.isVisibleNow(x, 0));
    const { renderer, scratchCalls, filteredClearCalls, texture } = makeHarness();
    activateAllChunks(renderer, world);

    renderer.sync(world, 17, true);
    const firstRefreshCount = texture().refreshCount;
    const filled = (x: number): boolean => scratchCalls.some((call) => call.x === (x + 1) * 4 && call.y === 4);
    expect([0, 1, 2, 3].map(filled)).toEqual([true, true, true, true]);

    renderer.sync(world, 17, false, new Set([1]), 1);
    expect(texture().refreshCount).toBe(firstRefreshCount + 1);
    expect([0, 1, 2, 3].map(filled)).toEqual([true, false, false, true]);
    expect(filteredClearCalls.slice(-2)).toEqual([
      { x: 8, y: 4, width: 4, height: 4 },
      { x: 12, y: 4, width: 4, height: 4 },
    ]);
    expect(filteredClearCalls).not.toContainEqual({ x: 4, y: 4, width: 4, height: 4 });
    expect(filteredClearCalls).not.toContainEqual({ x: 16, y: 4, width: 4, height: 4 });

    renderer.sync(world, 17, false, new Set(), 2);
    expect(texture().refreshCount).toBe(firstRefreshCount + 2);
    expect([0, 1, 2, 3].map(filled)).toEqual([true, true, true, true]);

    expect(chunk.revision).toBe(chunkRevision);
    expect(world.knowledgeVersion).toBe(knowledgeVersion);
    expect(world.visibilityVersion).toBe(visibilityVersion);
    expect([0, 1, 2, 3].map((x) => world.getKnowledge(x, 0))).toEqual(knowledgeBefore);
    expect([0, 1, 2, 3].map((x) => world.isVisibleNow(x, 0))).toEqual(visibilityBefore);
  });
});
