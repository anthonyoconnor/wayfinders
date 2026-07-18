import { describe, expect, it } from "vitest";

import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
} from "../src/wayfinders/world/WorldTopology";
import { WorldAnalysisIndex } from "../src/wayfinders/world/analysis";
import type { WorldManifestWaterRegionV2 } from "../src/wayfinders/world/manifest";
import {
  DEFAULT_WATER_TYPE_CATALOG,
  WATER_LAYOUT_VERSION,
  WATER_TYPE_IDS,
  WATER_TYPE_CATALOG_VERSION,
  WaterLayoutPlanner,
  validateWaterTypeCatalog,
} from "../src/wayfinders/world/water";

function plannedLayout(
  grid: WorldGrid,
  regions: readonly Readonly<WorldManifestWaterRegionV2>[],
  seed = 17,
) {
  return new WaterLayoutPlanner().plan(
    grid,
    WorldAnalysisIndex.build(grid),
    [],
    {
      waterLayout: {
        version: WATER_LAYOUT_VERSION,
        catalogFingerprint: DEFAULT_WATER_TYPE_CATALOG.fingerprint,
        regions,
      },
    },
    seed,
  );
}

function waterFacts(seed: number): string[] {
  const generated = new WorldGenerator().generate(seed);
  const facts: string[] = [];
  for (let y = 0; y < generated.grid.height; y++) {
    for (let x = 0; x < generated.grid.width; x++) {
      facts.push([
        generated.water.baseTypeAt(x, y),
        generated.water.overlayMaskAt(x, y),
        generated.water.transitionMaskAt(x, y),
        generated.water.variantAt(x, y),
        generated.water.phaseAt(x, y),
      ].join(":"));
    }
  }
  return facts;
}

describe("generated water layout", () => {
  it("is deterministic and includes every automatically placed treatment", () => {
    const first = waterFacts(84_221);
    const second = waterFacts(84_221);
    expect(second).toEqual(first);
    expect(first.some((fact) => fact.startsWith(`${WATER_TYPE_IDS.abyss}:`))).toBe(true);
    expect(first.some((fact) => fact.startsWith(`${WATER_TYPE_IDS.coastal}:`))).toBe(true);
    expect(first.some((fact) => fact.startsWith(`${WATER_TYPE_IDS.lagoon}:`))).toBe(true);
    expect(first.some((fact) => fact.startsWith(`${WATER_TYPE_IDS.reef}:`))).toBe(true);
    expect(first.some((fact) => fact.startsWith(`${WATER_TYPE_IDS.brackish}:`))).toBe(false);
  });

  it("keeps reef authority and visual overlays separate from terrain", () => {
    const generated = new WorldGenerator().generate(84_221);
    let currentTiles = 0;
    let roughTiles = 0;
    for (let y = 0; y < generated.grid.height; y++) {
      for (let x = 0; x < generated.grid.width; x++) {
        if (generated.grid.getTerrain(x, y) === TerrainType.Reef) {
          expect(generated.water.baseTypeAt(x, y)).toBe(WATER_TYPE_IDS.reef);
        }
        if (generated.water.hasOverlay(x, y, WATER_TYPE_IDS.current)) currentTiles++;
        if (generated.water.hasOverlay(x, y, WATER_TYPE_IDS.rough)) roughTiles++;
      }
    }
    expect(currentTiles).toBeGreaterThan(0);
    expect(roughTiles).toBeGreaterThan(0);
  });

  it("uses the opaque transition atlas only from deep water toward coastal water", () => {
    const grid = new WorldGrid(5, 3, 5, BOUNDED_WORLD_TOPOLOGY);
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    grid.setTerrain(2, 1, TerrainType.ShallowOcean);
    grid.setTerrain(4, 1, TerrainType.Land);
    const analysis = WorldAnalysisIndex.build(grid);
    const layout = new WaterLayoutPlanner().plan(
      grid,
      analysis,
      [],
      {
        waterLayout: {
          version: WATER_LAYOUT_VERSION,
          catalogFingerprint: DEFAULT_WATER_TYPE_CATALOG.fingerprint,
          regions: [{
            id: "water:abyss:test" as const,
            typeId: WATER_TYPE_IDS.abyss,
            strategy: "ellipse" as const,
            seed: 9,
            center: { x: 2, y: 1 },
            radiusX: 20,
            radiusY: 20,
          }],
        },
      },
      17,
    );

    expect(layout.baseTypeAt(2, 1)).toBe(WATER_TYPE_IDS.coastal);
    expect(layout.baseTypeAt(4, 1)).toBe(WATER_TYPE_IDS.coastal);
    expect(layout.baseTypeAt(0, 1)).toBe(WATER_TYPE_IDS.abyss);
    expect(layout.baseTypeAt(1, 1)).toBe(WATER_TYPE_IDS.deep);
    expect(layout.baseTypeAt(3, 1)).toBe(WATER_TYPE_IDS.deep);
    expect(layout.transitionMaskAt(2, 1)).toBe(0);
    expect(layout.transitionMaskAt(4, 1)).toBe(0);
    expect(layout.transitionMaskAt(1, 1)).toBe(2);
    expect(layout.transitionMaskAt(3, 1)).toBe(10);
  });

  it("derives protected shallows, transition collars, and masks through periodic seams", () => {
    const shallows = new WorldGrid(5, 3, 5, WRAPPING_WORLD_TOPOLOGY);
    shallows.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    shallows.setTerrain(0, 1, TerrainType.ShallowOcean);
    shallows.setTerrain(0, 0, TerrainType.Land);

    expect(plannedLayout(shallows, []).baseTypeAt(0, 1)).toBe(WATER_TYPE_IDS.coastal);

    shallows.setTerrain(4, 1, TerrainType.Land);
    expect(plannedLayout(shallows, []).baseTypeAt(0, 1)).toBe(WATER_TYPE_IDS.lagoon);

    const transitions = new WorldGrid(5, 3, 5, WRAPPING_WORLD_TOPOLOGY);
    transitions.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    transitions.setTerrain(0, 1, TerrainType.ShallowOcean);
    const layout = plannedLayout(transitions, [{
      id: "water:abyss:seam" as const,
      typeId: WATER_TYPE_IDS.abyss,
      strategy: "ellipse",
      seed: 91,
      center: { x: 2, y: 1 },
      radiusX: 100,
      radiusY: 100,
    }]);

    expect(layout.baseTypeAt(0, 1)).toBe(WATER_TYPE_IDS.coastal);
    expect(layout.baseTypeAt(4, 1)).toBe(WATER_TYPE_IDS.deep);
    expect(layout.transitionMaskAt(4, 1)).toBe(2);
  });

  it("contains ellipses through axis and corner images without duplicating layout facts", () => {
    const grid = new WorldGrid(7, 6, 4, WRAPPING_WORLD_TOPOLOGY);
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const layout = plannedLayout(grid, [{
      id: "water:rough:corner" as const,
      typeId: WATER_TYPE_IDS.rough,
      strategy: "ellipse",
      seed: 0,
      center: { x: 0, y: 0 },
      radiusX: 2,
      radiusY: 2,
    }]);

    expect(layout.hasOverlay(6, 0, WATER_TYPE_IDS.rough)).toBe(true);
    expect(layout.hasOverlay(0, 5, WATER_TYPE_IDS.rough)).toBe(true);
    expect(layout.hasOverlay(6, 5, WATER_TYPE_IDS.rough)).toBe(true);
    expect(layout.hasOverlay(3, 3, WATER_TYPE_IDS.rough)).toBe(false);
    expect(layout.chunk(1, 1)).toEqual({
      chunkX: 1,
      chunkY: 1,
      startX: 4,
      startY: 4,
      width: 3,
      height: 2,
    });
    expect(() => layout.baseTypeAt(7, 0)).toThrow("outside 7x6");
  });

  it("honors the exact ribbon lift instead of shortening an offset-zero interior ribbon", () => {
    const grid = new WorldGrid(20, 11, 6, WRAPPING_WORLD_TOPOLOGY);
    grid.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const longInterior = plannedLayout(grid, [{
      id: "water:current:long" as const,
      typeId: WATER_TYPE_IDS.current,
      strategy: "ribbon",
      seed: 0,
      start: { x: 2, y: 5 },
      end: { x: 18, y: 5 },
      imageOffset: { x: 0, y: 0 },
      width: 0.7,
    }]);
    const liftedSeam = plannedLayout(grid, [{
      id: "water:current:lifted" as const,
      typeId: WATER_TYPE_IDS.current,
      strategy: "ribbon",
      seed: 0,
      start: { x: 18, y: 5 },
      end: { x: 2, y: 5 },
      imageOffset: { x: 20, y: 0 },
      width: 0.7,
    }]);

    expect(longInterior.hasOverlay(10, 5, WATER_TYPE_IDS.current)).toBe(true);
    expect(longInterior.hasOverlay(0, 5, WATER_TYPE_IDS.current)).toBe(false);
    expect(liftedSeam.hasOverlay(0, 5, WATER_TYPE_IDS.current)).toBe(true);
    expect(liftedSeam.hasOverlay(10, 5, WATER_TYPE_IDS.current)).toBe(false);
  });

  it("accepts a new catalog type through an existing placement strategy", () => {
    const generated = new WorldGenerator().generate(84_221);
    const catalog = validateWaterTypeCatalog({
      version: WATER_TYPE_CATALOG_VERSION,
      fingerprint: "wayfinders-water-types-extension-v1",
      types: [
        ...DEFAULT_WATER_TYPE_CATALOG.types,
        {
          id: "kelp-sea",
          label: "Kelp sea",
          role: "base",
          authority: "contextual",
          eligibleTerrain: [TerrainType.DeepOcean],
          priority: 30,
          placementStrategy: "coherent-ellipse",
          automaticallyPlaced: true,
          animationFps: 3,
        },
      ],
    });
    const manifest = {
      waterLayout: {
        ...generated.manifest.waterLayout,
        catalogFingerprint: catalog.fingerprint,
        regions: [
          ...generated.manifest.waterLayout.regions,
          {
            id: "water:kelp-sea:000" as const,
            typeId: "kelp-sea",
            strategy: "ellipse" as const,
            seed: 91,
            center: { x: 8, y: 8 },
            radiusX: 7,
            radiusY: 7,
          },
        ],
      },
    };
    const layout = new WaterLayoutPlanner(catalog).plan(
      generated.grid,
      generated.analysis,
      generated.islands,
      manifest,
      generated.seed,
    );
    let extensionTiles = 0;
    for (let y = 1; y < 16; y++) {
      for (let x = 1; x < 16; x++) if (layout.baseTypeAt(x, y) === "kelp-sea") extensionTiles++;
    }
    expect(extensionTiles).toBeGreaterThan(0);
  });
});
