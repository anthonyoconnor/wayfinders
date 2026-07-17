import { describe, expect, it, vi } from "vitest";
import { prototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import type { ForwardRangeResult } from "../src/wayfinders/exploration/ForwardRangeSystem";
import { ReturnRiskLevel, type ReturnPathResult } from "../src/wayfinders/exploration/ReturnPathSystem";
import {
  addCardinalChunkDependents,
  addPaddedChunkNeighbours,
} from "../src/wayfinders/rendering/OverlayChunkInvalidation";
import { RiskOverlayRenderer } from "../src/wayfinders/rendering/RiskOverlayRenderer";
import { createCameraCulledImage } from "../src/wayfinders/rendering/CameraCulledImage";
import { ActiveChunkSet } from "../src/wayfinders/rendering/activation";
import type { WorldChunk } from "../src/wayfinders/world/WorldChunk";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";

vi.mock("phaser", () => ({
  default: { Textures: { FilterMode: { LINEAR: 0 } } },
}));

interface FillCall {
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

interface StrokeCall {
  style: string;
  width: number;
  commands: Array<
    | { kind: "move" | "line"; x: number; y: number }
    | { kind: "curve"; controlX: number; controlY: number; x: number; y: number }
  >;
}

interface FakeTexture {
  width: number;
  height: number;
  calls: FillCall[];
  strokes: StrokeCall[];
  refreshCount: number;
  getContext(): CanvasRenderingContext2D;
  setFilter(): void;
  refresh(): void;
}

function makeRendererHarness(key = "overlay-test") {
  const textures = new Map<string, FakeTexture>();
  const scene = {
    sys: { settings: { key } },
    textures: {
      createCanvas(textureKey: string, width: number, height: number) {
        const calls: FillCall[] = [];
        const strokes: StrokeCall[] = [];
        let commands: StrokeCall["commands"] = [];
        const drawingContext = {
          fillStyle: "",
          strokeStyle: "",
          lineWidth: 1,
          lineCap: "butt",
          lineJoin: "miter",
          clearRect: () => {
            calls.length = 0;
            strokes.length = 0;
          },
          fillRect(x: number, y: number, fillWidth: number, fillHeight: number) {
            calls.push({
              x,
              y,
              width: fillWidth,
              height: fillHeight,
              style: String(this.fillStyle),
            });
          },
          save: () => undefined,
          restore: () => undefined,
          beginPath: () => { commands = []; },
          moveTo: (x: number, y: number) => { commands.push({ kind: "move", x, y }); },
          lineTo: (x: number, y: number) => { commands.push({ kind: "line", x, y }); },
          quadraticCurveTo: (controlX: number, controlY: number, x: number, y: number) => {
            commands.push({ kind: "curve", controlX, controlY, x, y });
          },
          stroke() {
            strokes.push({
              style: String(this.strokeStyle),
              width: this.lineWidth,
              commands: [...commands],
            });
          },
        };
        const context = drawingContext as unknown as CanvasRenderingContext2D;
        const texture: FakeTexture = {
          width,
          height,
          calls,
          strokes,
          refreshCount: 0,
          getContext: () => context,
          setFilter: () => undefined,
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
          setOrigin: () => image,
          setDisplaySize: () => image,
          setDepth: () => image,
          setVisible: () => image,
          destroy: () => undefined,
        };
        return image;
      },
    },
  };
  return {
    renderer: new RiskOverlayRenderer(scene as never),
    textureKeys: () => [...textures.keys()].sort(),
    texture: (chunkX: number, chunkY: number) => {
      const texture = textures.get(`${key}-risk-forward-${chunkX}-${chunkY}`);
      if (!texture) throw new Error(`Missing forward texture ${chunkX},${chunkY}`);
      return texture;
    },
    returnTexture: (chunkX: number, chunkY: number) => {
      const texture = textures.get(`${key}-risk-return-${chunkX}-${chunkY}`);
      if (!texture) throw new Error(`Missing return texture ${chunkX},${chunkY}`);
      return texture;
    },
  };
}

function makeForward(
  world: WorldGrid,
  reachableIndices: readonly number[],
  presentationIndices: readonly number[],
): ForwardRangeResult {
  const mask = new Uint8Array(world.tileCount);
  const presentationMask = new Uint8Array(world.tileCount);
  for (const index of reachableIndices) mask[index] = 1;
  for (const index of presentationIndices) presentationMask[index] = 1;
  return {
    mask,
    presentationMask,
    costs: new Float64Array(world.tileCount),
    budget: 1,
    reachableCount: reachableIndices.length,
    frontierCount: presentationIndices.length,
    presentationHeading: 0,
    coneHalfAngleDegrees: 45,
    candidateIndices: reachableIndices,
    presentationCandidateIndices: presentationIndices,
    logicalRevision: 1,
  };
}

function activateAllChunks(renderer: RiskOverlayRenderer, world: WorldGrid): void {
  const maxX = Math.ceil(world.width / world.chunkSize) - 1;
  const maxY = Math.ceil(world.height / world.chunkSize) - 1;
  const activeChunks = new ActiveChunkSet({
    worldBounds: { minX: 0, minY: 0, maxX, maxY },
    prefetchRing: 0,
    maxActiveChunks: (maxX + 1) * (maxY + 1),
  });
  renderer.applyActiveChunkDelta(
    world,
    activeChunks.update({ minX: 0, minY: 0, maxX, maxY }),
  );
}

function emptyReturn(world: WorldGrid): ReturnPathResult {
  return {
    risk: new Uint8Array(world.tileCount),
    pathIndices: [],
    corridorIndices: [],
    riskLevel: ReturnRiskLevel.Hidden,
  } as unknown as ReturnPathResult;
}

function makeReturn(
  world: WorldGrid,
  pathIndices: readonly number[],
  riskLevel: ReturnRiskLevel,
  corridorIndices: readonly number[] = [],
): ReturnPathResult {
  const risk = new Uint8Array(world.tileCount);
  for (const index of corridorIndices) risk[index] = riskLevel;
  return { risk, pathIndices, corridorIndices, riskLevel } as unknown as ReturnPathResult;
}

const debugVisibility = {
  navigationGrid: false,
  collisionBoxes: false,
  currentSight: false,
  forwardRange: true,
  returnViability: true,
};

describe("camera-culled chunk images", () => {
  it("keeps normal render flags and rejects images outside the camera world view", () => {
    const image = { willRender: () => true };
    const culled = createCameraCulledImage(
      { add: { image: () => image } } as never,
      0,
      0,
      "chunk",
      undefined,
      { left: 100, right: 200, top: 100, bottom: 200 },
    );

    expect(culled.willRender({ worldView: { left: 120, right: 160, top: 120, bottom: 160 } } as never)).toBe(true);
    expect(culled.willRender({ worldView: { left: 0, right: 50, top: 0, bottom: 50 } } as never)).toBe(false);
  });
});

function keys(chunks: ReadonlySet<WorldChunk>): string[] {
  return [...chunks]
    .map(({ chunkX, chunkY }) => `${chunkX},${chunkY}`)
    .sort();
}

describe("overlay chunk invalidation", () => {
  it("invalidates every chunk sampled by a padded knowledge-mask chunk", () => {
    const world = new WorldGrid(12, 12, 4);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const dirty = new Set<WorldChunk>();

    addPaddedChunkNeighbours(world, world.getChunk(1, 1)!, 1, dirty);

    expect(keys(dirty)).toEqual([
      "0,0", "0,1", "0,2",
      "1,0", "1,1", "1,2",
      "2,0", "2,1", "2,2",
    ]);
  });

  it("invalidates only cardinal chunk dependents for a frontier-contour change", () => {
    const world = new WorldGrid(12, 12, 4);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const dirty = new Set<WorldChunk>();

    addCardinalChunkDependents(world, world.index(4, 4), dirty);

    expect(keys(dirty)).toEqual(["0,1", "1,0", "1,1"]);
  });

  it("keeps an interior frontier-contour change local to its owning chunk", () => {
    const world = new WorldGrid(12, 12, 4);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const dirty = new Set<WorldChunk>();

    addCardinalChunkDependents(world, world.index(5, 6), dirty);

    expect(keys(dirty)).toEqual(["1,1"]);
  });
});

describe("forward frontier rendering", () => {
  it("keeps textures capped and renders current data when an inactive chunk activates", () => {
    const world = new WorldGrid(8, 1, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const farFrontier = world.index(7, 0);
    const forward = makeForward(world, [farFrontier], [farFrontier]);
    const activeChunks = new ActiveChunkSet({
      worldBounds: { minX: 0, minY: 0, maxX: 3, maxY: 0 },
      prefetchRing: 0,
      maxActiveChunks: 1,
    });
    const { renderer, texture, textureKeys } = makeRendererHarness("active-risk-test");

    renderer.applyActiveChunkDelta(
      world,
      activeChunks.update({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
    );
    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 1);
    expect(textureKeys()).toEqual([
      "active-risk-test-risk-forward-0-0",
      "active-risk-test-risk-return-0-0",
    ]);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      chunkCapacity: 1,
      activeChunks: 1,
      activeTextures: 2,
      activeSprites: 2,
      estimatedTextureBytes: 1_152,
      peakActiveTextures: 2,
    });

    renderer.applyActiveChunkDelta(
      world,
      activeChunks.update({ minX: 3, minY: 0, maxX: 3, maxY: 0 }),
    );
    // Data identity and revisions are unchanged: activation itself must dirty
    // the replacement view and upload the already-current sparse masks.
    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 1);

    expect(textureKeys()).toEqual([
      "active-risk-test-risk-forward-3-0",
      "active-risk-test-risk-return-3-0",
    ]);
    expect(texture(3, 0).calls.length).toBeGreaterThan(0);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      activeChunks: 1,
      activeTextures: 2,
      totalTextureAllocations: 4,
      totalTextureReleases: 2,
    });
  });

  it("draws thin pale segments only on edges facing outside the logical reach mask", () => {
    const world = new WorldGrid(3, 3, 3);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const center = world.index(1, 1);
    const forward = makeForward(
      world,
      [center, world.index(0, 1), world.index(1, 0)],
      [center],
    );
    const { renderer, texture } = makeRendererHarness();
    activateAllChunks(renderer, world);

    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 1, true);

    const calls = texture(0, 0).calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(({ width, height }) => width === 1 && height === 1)).toBe(true);
    expect(calls.every(({ style }) => (
      style === `rgba(226, 230, 210, ${prototypeConfig.overlays.forwardOverlayOpacity})`
    ))).toBe(true);
    expect(calls.every(({ x, y }) => x === 11 || y === 11)).toBe(true);
    expect(calls.some(({ x }) => x === 11)).toBe(true);
    expect(calls.some(({ y }) => y === 11)).toBe(true);
    expect(calls.some(({ x }) => x === 6)).toBe(false);
    expect(calls.some(({ y }) => y === 6)).toBe(false);
  });

  it("keeps dash phase continuous across chunk seams without drawing a radial seam wall", () => {
    const world = new WorldGrid(4, 3, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const row = [0, 1, 2, 3].map((x) => world.index(x, 1));
    const forward = makeForward(world, row, [row[1], row[2]]);
    const { renderer, texture } = makeRendererHarness("seam-test");
    activateAllChunks(renderer, world);

    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 1, true);

    const leftCalls = texture(0, 0).calls;
    const rightCalls = texture(1, 0).calls.map((call) => ({ ...call, x: call.x + 12 }));
    const globalCalls = [...leftCalls, ...rightCalls];
    expect(globalCalls.every(({ y }) => y === 6 || y === 11)).toBe(true);
    expect(globalCalls.filter(({ y }) => y === 6).map(({ x }) => x)).toEqual([
      8, 9, 12, 13, 16, 17,
    ]);
  });

  it("redraws seam dependents when only an adjacent logical reach bit changes", () => {
    const world = new WorldGrid(4, 1, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const frontier = world.index(1, 0);
    const seamNeighbour = world.index(2, 0);
    const first = makeForward(world, [frontier, seamNeighbour], [frontier]);
    const { renderer, texture } = makeRendererHarness("topology-test");
    activateAllChunks(renderer, world);
    renderer.sync(world, first, emptyReturn(world), debugVisibility, 1, true);
    const leftRefreshes = texture(0, 0).refreshCount;
    const rightRefreshes = texture(1, 0).refreshCount;
    expect(texture(0, 0).calls.some(({ x }) => x === 11)).toBe(false);

    const second = makeForward(world, [frontier], [frontier]);
    renderer.sync(world, second, emptyReturn(world), debugVisibility, 2);

    expect(texture(0, 0).refreshCount).toBe(leftRefreshes + 1);
    expect(texture(1, 0).refreshCount).toBe(rightRefreshes + 1);
    expect(texture(0, 0).calls.some(({ x }) => x === 11)).toBe(true);
  });

  it("redraws same-count logical changes when a reusable result keeps its identity", () => {
    const world = new WorldGrid(4, 1, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const frontier = world.index(1, 0);
    const oldNeighbour = world.index(2, 0);
    const replacement = world.index(3, 0);
    const forward = makeForward(world, [frontier, oldNeighbour], [frontier]);
    const { renderer, texture } = makeRendererHarness("reuse-topology-test");
    activateAllChunks(renderer, world);
    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 1, true);
    const leftRefreshes = texture(0, 0).refreshCount;
    expect(texture(0, 0).calls.some(({ x }) => x === 11)).toBe(false);

    forward.mask[oldNeighbour] = 0;
    forward.mask[replacement] = 1;
    forward.candidateIndices = [frontier, replacement];
    forward.logicalRevision++;
    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 2);

    expect(texture(0, 0).refreshCount).toBe(leftRefreshes + 1);
    expect(texture(0, 0).calls.some(({ x }) => x === 11)).toBe(true);
  });

  it("clears the previous contour after its published buffer is reused", () => {
    const world = new WorldGrid(4, 1, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const oldFrontier = world.index(1, 0);
    const newFrontier = world.index(3, 0);
    const previous = makeForward(world, [oldFrontier], [oldFrontier]);
    const { renderer, texture } = makeRendererHarness("recycled-buffer-test");
    activateAllChunks(renderer, world);
    renderer.sync(world, previous, emptyReturn(world), debugVisibility, 1, true);
    expect(texture(0, 0).calls.length).toBeGreaterThan(0);

    // Cooperative guidance releases the old result before presentation sync;
    // its arrays may already be cleared for reuse by the next task.
    previous.mask[oldFrontier] = 0;
    previous.presentationMask[oldFrontier] = 0;
    (previous.candidateIndices as number[]).length = 0;
    (previous.presentationCandidateIndices as number[]).length = 0;
    const next = makeForward(world, [newFrontier], [newFrontier]);
    renderer.sync(world, next, emptyReturn(world), debugVisibility, 2);

    expect(texture(0, 0).calls).toEqual([]);
    expect(texture(1, 0).calls.length).toBeGreaterThan(0);
  });

  it("suppresses the forward contour on currently visible frontier cells", () => {
    const world = new WorldGrid(3, 3, 3);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const center = world.index(1, 1);
    world.setVisibleNowAtIndex(center, true);
    const forward = makeForward(world, [center], [center]);
    const { renderer, texture } = makeRendererHarness("visibility-test");
    activateAllChunks(renderer, world);

    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 1, true);

    expect(texture(0, 0).calls).toEqual([]);
  });

  it("renders the Voyage Sense thread from the ordered path instead of corridor tiles", () => {
    const world = new WorldGrid(4, 2, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Personal);
    const path = [world.index(0, 0), world.index(1, 0), world.index(2, 0), world.index(2, 1)];
    const corridorOnly = world.index(3, 1);
    const returning = makeReturn(world, path, ReturnRiskLevel.Comfortable, [corridorOnly]);
    const forward = makeForward(world, [], []);
    const { renderer, returnTexture } = makeRendererHarness("return-thread-test");
    activateAllChunks(renderer, world);

    renderer.sync(world, forward, returning, debugVisibility, 1, true);

    const strokes = [returnTexture(0, 0), returnTexture(1, 0)].flatMap(({ strokes: calls }) => calls);
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.some(({ commands }) => commands.some(({ kind }) => kind === "curve"))).toBe(true);
    expect(strokes.every(({ style }) => style.startsWith("rgba(91, 184, 116,"))).toBe(true);
    expect(returnTexture(1, 0).calls).toEqual([]);
    expect(renderer.getResourceTelemetry()).toMatchObject({
      returnThreadSegments: 3,
      returnThreadChunkBuckets: 2,
    });
  });

  it("recolors the whole thread through green, yellow, orange, and red risk states", () => {
    const world = new WorldGrid(3, 1, 3);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Personal);
    const path = [0, 1, 2].map((x) => world.index(x, 0));
    const forward = makeForward(world, [], []);
    const { renderer, returnTexture } = makeRendererHarness("return-color-test");
    activateAllChunks(renderer, world);
    const colors = new Map([
      [ReturnRiskLevel.Comfortable, "rgba(91, 184, 116,"],
      [ReturnRiskLevel.Warning, "rgba(226, 196, 74,"],
      [ReturnRiskLevel.Critical, "rgba(238, 125, 36,"],
      [ReturnRiskLevel.Impossible, "rgba(196, 38, 36,"],
    ]);

    let revision = 1;
    for (const [level, color] of colors) {
      renderer.sync(world, forward, makeReturn(world, path, level), debugVisibility, revision++);
      expect(returnTexture(0, 0).strokes).toHaveLength(2);
      expect(returnTexture(0, 0).strokes.every(({ style }) => style.startsWith(color))).toBe(true);
    }
  });

  it("clears stale thread geometry when the route moves to another chunk or becomes hidden", () => {
    const world = new WorldGrid(4, 2, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Personal);
    const forward = makeForward(world, [], []);
    const { renderer, returnTexture } = makeRendererHarness("return-replace-test");
    activateAllChunks(renderer, world);
    renderer.sync(
      world,
      forward,
      makeReturn(world, [world.index(0, 0), world.index(1, 0)], ReturnRiskLevel.Warning),
      debugVisibility,
      1,
    );
    expect(returnTexture(0, 0).strokes.length).toBeGreaterThan(0);

    renderer.sync(
      world,
      forward,
      makeReturn(world, [world.index(2, 1), world.index(3, 1)], ReturnRiskLevel.Critical),
      debugVisibility,
      2,
    );
    expect(returnTexture(0, 0).strokes).toEqual([]);
    expect(returnTexture(1, 0).strokes.length).toBeGreaterThan(0);

    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 3);
    expect(returnTexture(1, 0).strokes).toEqual([]);
  });

  it("skips full logical-candidate diffing for a presentation-only heading change", () => {
    const world = new WorldGrid(4, 2, 2);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const left = world.index(1, 0);
    const right = world.index(2, 0);
    const forward = makeForward(world, [left, right], [left]);
    const { renderer } = makeRendererHarness("heading-test");
    activateAllChunks(renderer, world);
    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 1, true);
    const reachableDiff = vi.spyOn(
      renderer as unknown as { updateForwardReachableIndices: (...args: unknown[]) => void },
      "updateForwardReachableIndices",
    );

    forward.presentationMask[left] = 0;
    forward.presentationMask[right] = 1;
    forward.presentationCandidateIndices = [right];
    forward.presentationHeading = 90;
    renderer.sync(world, forward, emptyReturn(world), debugVisibility, 2);

    expect(reachableDiff).not.toHaveBeenCalled();
  });
});
