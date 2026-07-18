import { describe, expect, it } from "vitest";
import { generateFishingShoalCatalog } from "../src/wayfinders/exploration/FishingShoalCatalog";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  FISHING_SHOAL_CONTENT_VERSION,
  createFishingShoalId,
  type FishingShoalDefinition,
} from "../src/wayfinders/exploration/FishingShoalContracts";
import { FishingShoalSystem } from "../src/wayfinders/exploration/FishingShoalSystem";
import { generateIslandDossierCatalog } from "../src/wayfinders/exploration/IslandDossierCatalog";
import { ISLAND_DOSSIER_CONTRACT_VERSION } from "../src/wayfinders/exploration/IslandDossierContracts";
import { IslandDossierSystem } from "../src/wayfinders/exploration/IslandDossierSystem";
import { createSurveyBudget } from "../src/wayfinders/exploration/SurveyContracts";
import { generateSurveySiteCatalogFromDescriptors } from "../src/wayfinders/exploration/SurveySiteCatalog";
import {
  SURVEY_SITE_CONTRACT_VERSION,
  type SurveySiteTypeDescriptor,
} from "../src/wayfinders/exploration/SurveySiteContracts";
import { SurveySiteSystem } from "../src/wayfinders/exploration/SurveySiteSystem";
import {
  IslandKind,
  IslandSize,
  type GeneratedIsland,
} from "../src/wayfinders/world/IslandGenerator";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology";

const BUDGET = createSurveyBudget(2, 12, 0);

function wrappingWorld(width: number, height: number): WorldGrid {
  const world = new WorldGrid(width, height, 8, WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  return world;
}

function islandAtOrigin(): GeneratedIsland {
  return {
    id: 1,
    kind: IslandKind.HighIsland,
    size: IslandSize.Small,
    center: { x: 0, y: 0 },
    radiusX: 1,
    radiusY: 1,
    outerRadius: 1,
    rotation: 0,
    shapeSeed: 1,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    sourceKind: "procedural",
  };
}

describe("periodic fishing features", () => {
  it("places shoals on coordinate-zero seams without weakening periodic clearances", () => {
    const world = wrappingWorld(48, 48);
    const home = { x: 24, y: 24 };
    let definitions: readonly Readonly<FishingShoalDefinition>[] | undefined;
    for (let seed = 1; seed <= 64; seed++) {
      const candidate = generateFishingShoalCatalog(world, seed, home);
      if (candidate.some(({ tile }) => tile.x === 0 || tile.y === 0)) {
        definitions = candidate;
        break;
      }
    }

    expect(definitions).toBeDefined();
    expect(definitions).toHaveLength(4);
    expect(definitions?.some(({ tile }) => tile.x === 0 || tile.y === 0)).toBe(true);
    for (const definition of definitions ?? []) {
      expect(world.topology.minimumImageTileDistanceSquared(home, definition.tile))
        .toBeGreaterThanOrEqual(18 * 18);
    }
    for (let left = 0; left < (definitions?.length ?? 0); left++) {
      for (let right = left + 1; right < (definitions?.length ?? 0); right++) {
        expect(world.topology.minimumImageTileDistanceSquared(
          definitions![left].tile,
          definitions![right].tile,
        )).toBeGreaterThanOrEqual(14 * 14);
      }
    }
  });

  it("keeps every service anchor in the dock's periodic water component", () => {
    const world = wrappingWorld(48, 48);
    for (let y = 0; y < world.height; y++) {
      world.setTerrain(0, y, TerrainType.Rock);
      world.setTerrain(20, y, TerrainType.Rock);
    }

    const definitions = generateFishingShoalCatalog(world, 73, { x: 10, y: 24 });
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions.every(({ serviceAnchor }) => (
      serviceAnchor.x > 0 && serviceAnchor.x < 20
    ))).toBe(true);
  });

  it("uses the same corner-wrapped exact range for prompt and command and mutates once", () => {
    const world = wrappingWorld(8, 8);
    const id = createFishingShoalId(0);
    const definition: Readonly<FishingShoalDefinition> = Object.freeze({
      id,
      contentVersion: FISHING_SHOAL_CONTENT_VERSION,
      tile: Object.freeze({ x: 0, y: 0 }),
      serviceAnchor: Object.freeze({ x: 0, y: 0 }),
      quality: "steady",
      clue: Object.freeze({ kind: "seabirds", intensity: 2, label: "Seabirds gathering low" }),
    });
    const system = new FishingShoalSystem(world, [definition], { x: 4, y: 4 });
    const index = world.index(0, 0);

    expect(system.observeCurrentSight(1, 1, [index, index], [id, id]).found).toHaveLength(1);
    expect(system.interactionNear({ x: 7, y: 7 }, BUDGET, [id, id])).toMatchObject({ id });
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id,
    }, { x: 7, y: 7 }, 1, 1, BUDGET)).toMatchObject({ status: "surveyed", id });

    const revision = system.recordsRevision;
    const records = structuredClone(system.provisional);
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id,
    }, { x: 7, y: 7 }, 1, 1, BUDGET)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(system.recordsRevision).toBe(revision);
    expect(system.provisional).toEqual(records);
  });
});

describe("periodic island dossier features", () => {
  it("wraps and deduplicates a corner approach ring with one lifecycle mutation", () => {
    const world = wrappingWorld(8, 8);
    world.setTerrain(0, 0, TerrainType.Land);
    world.setIslandId(0, 0, 1);
    const [definition] = generateIslandDossierCatalog(
      world,
      17,
      [islandAtOrigin()],
      { x: 4, y: 4 },
    );

    expect(definition.approachIndices).toContain(world.index(7, 7));
    expect(new Set(definition.approachIndices).size).toBe(definition.approachIndices.length);
    const system = new IslandDossierSystem(world, [definition]);
    expect(system.observeCurrentSight(1, 1, [world.index(0, 0), world.index(0, 0)]).found)
      .toHaveLength(1);
    expect(system.interactionNear({ x: 7, y: 7 }, BUDGET, [1, 1])).toMatchObject({
      islandId: 1,
      approachTile: { x: 7, y: 7 },
    });
    expect(system.applyInteraction({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: 1,
    }, { x: 7, y: 7 }, 1, 1, BUDGET)).toMatchObject({ status: "surveyed", islandId: 1 });

    const revision = system.recordsRevision;
    const records = structuredClone(system.provisional);
    expect(system.applyInteraction({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: 1,
    }, { x: 7, y: 7 }, 1, 1, BUDGET)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(system.recordsRevision).toBe(revision);
    expect(system.provisional).toEqual(records);
  });
});

describe("periodic survey-site features", () => {
  it("derives one dock-component corner anchor and shares its wrapped prompt/command check", () => {
    const world = wrappingWorld(8, 8);
    world.setTerrain(0, 0, TerrainType.Land);
    world.setIslandId(0, 0, 1);
    for (const tile of world.topology.uniqueEightNeighbors({ x: 0, y: 0 })) {
      if (tile.x === 7 && tile.y === 7) continue;
      world.setTerrain(tile.x, tile.y, TerrainType.Rock);
    }
    const descriptor: Readonly<SurveySiteTypeDescriptor<"seam-site">> = Object.freeze({
      type: "seam-site",
      label: "Seam site",
      namespace: 9_006_401,
      count: 1,
      placement: Object.freeze({
        terrain: Object.freeze([TerrainType.Land]),
        islandKinds: Object.freeze([IslandKind.HighIsland]),
      }),
      clues: Object.freeze([Object.freeze({ id: "seam-clue", label: "A clue across the seam" })]),
      results: Object.freeze([Object.freeze({
        id: "seam-result",
        label: "A seam result",
        detail: "The site and its service point share one short periodic neighbourhood.",
      })]),
      presentation: Object.freeze({ id: "developer.survey_site.seam.01", badge: "SS", color: 0x88aacc }),
    });
    const [definition] = generateSurveySiteCatalogFromDescriptors(
      world,
      31,
      [islandAtOrigin()],
      { x: 4, y: 4 },
      [descriptor],
    );

    expect(definition.serviceAnchor).toEqual({ x: 7, y: 7 });
    const system = new SurveySiteSystem(world, [definition]);
    const index = world.index(0, 0);
    expect(system.observeCurrentSight(1, 1, [index, index], [definition.id, definition.id]).found)
      .toHaveLength(1);
    expect(system.interactionNear({ x: 0, y: 7 }, BUDGET, [definition.id, definition.id]))
      .toMatchObject({ id: definition.id, distanceTiles: 1 });
    expect(system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: definition.id,
    }, { x: 0, y: 7 }, 1, 1, BUDGET)).toMatchObject({
      status: "surveyed",
      id: definition.id,
    });

    const revision = system.recordsRevision;
    const records = structuredClone(system.provisional);
    expect(system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: definition.id,
    }, { x: 0, y: 7 }, 1, 1, BUDGET)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
    expect(system.recordsRevision).toBe(revision);
    expect(system.provisional).toEqual(records);
  });
});
