import { describe, expect, it } from "vitest";

import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WorldAnalysisIndex } from "../src/wayfinders/world/analysis";
import {
  DEFAULT_WATER_TYPE_CATALOG,
  WATER_LAYOUT_VERSION,
  WATER_TYPE_IDS,
  WATER_TYPE_CATALOG_VERSION,
  WaterLayoutPlanner,
  validateWaterTypeCatalog,
} from "../src/wayfinders/world/water";

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
    const grid = new WorldGrid(5, 3, 5);
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
