import { describe, expect, it } from "vitest";
import { createSurveyBudget } from "../src/wayfinders/exploration/SurveyContracts";
import {
  INITIAL_SURVEY_SITE_DESCRIPTORS,
  generateSurveySiteCatalog,
  generateSurveySiteCatalogFromDescriptors,
} from "../src/wayfinders/exploration/SurveySiteCatalog";
import {
  SURVEY_SITE_CONTENT_VERSION,
  SURVEY_SITE_CONTRACT_VERSION,
  SURVEY_SITE_TYPES,
  compareSurveySiteIds,
  createSurveySiteId,
  isCurrentSurveySiteId,
  parseSurveySiteId,
  type SurveySiteDefinition,
  type SurveySiteTypeDescriptor,
} from "../src/wayfinders/exploration/SurveySiteContracts";
import { SurveySiteSystem } from "../src/wayfinders/exploration/SurveySiteSystem";
import { VisibilitySystem } from "../src/wayfinders/exploration/VisibilitySystem";
import { IslandKind } from "../src/wayfinders/world/IslandGenerator";
import { TerrainType } from "../src/wayfinders/world/TileData";
import type { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";

function makeCatalog(seed = 13_371) {
  const generated = new WorldGenerator().generate(seed);
  const definitions = generateSurveySiteCatalog(
    generated.grid,
    generated.seed,
    generated.islands,
    generated.landmarks.homeReturnTile,
  );
  return { generated, definitions };
}

function dockReachable(world: WorldGrid, home: Readonly<{ x: number; y: number }>): Uint8Array {
  const visited = new Uint8Array(world.tileCount);
  const queue = new Int32Array(world.tileCount);
  let head = 0;
  let tail = 0;
  const start = world.index(home.x, home.y);
  visited[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const tile = world.pointFromIndex(queue[head++]);
    for (const neighbor of [
      { x: tile.x - 1, y: tile.y },
      { x: tile.x + 1, y: tile.y },
      { x: tile.x, y: tile.y - 1 },
      { x: tile.x, y: tile.y + 1 },
    ]) {
      if (!world.inBounds(neighbor.x, neighbor.y) || world.isMovementBlocked(neighbor.x, neighbor.y)) continue;
      const index = world.index(neighbor.x, neighbor.y);
      if (visited[index]) continue;
      visited[index] = 1;
      queue[tail++] = index;
    }
  }
  return visited;
}

function revealAndSight<TType extends string>(
  system: SurveySiteSystem<TType>,
  world: WorldGrid,
  definition: Readonly<SurveySiteDefinition<TType>>,
  expeditionId: number,
  generation: number,
) {
  const index = world.index(definition.tile.x, definition.tile.y);
  world.setVisibleNowAtIndex(index, true);
  return system.observeCurrentSight(expeditionId, generation, [index]);
}

const affordableBudget = createSurveyBudget(2, 12, 3.5);

describe("survey-site identifiers and deterministic catalog", () => {
  it("uses typed, versioned IDs without sharing the navigator-wreck namespace", () => {
    const ids = SURVEY_SITE_TYPES.map((type) => createSurveySiteId(type, 0));
    expect(ids).toEqual([
      "survey-site:v1:historic-wreck:0000",
      "survey-site:v1:coastal-ruin:0000",
      "survey-site:v1:tidal-cave:0000",
    ]);
    expect(ids.map(parseSurveySiteId)).toEqual(SURVEY_SITE_TYPES.map((type) => ({
      contentVersion: 1,
      type,
      ordinal: 0,
    })));
    expect(ids.every(isCurrentSurveySiteId)).toBe(true);
    expect(isCurrentSurveySiteId("survey-site:v2:historic-wreck:0000")).toBe(false);
    expect(parseSurveySiteId("wreck:1")).toBeUndefined();
    expect(() => createSurveySiteId("Historic Wreck", 0)).toThrow(/lowercase hyphenated/);
    expect(() => createSurveySiteId("historic-wreck", 10_000)).toThrow(/ordinal/);

    const extensibleIds = [createSurveySiteId("a", 0), createSurveySiteId("a0", 0)];
    expect(extensibleIds.sort(compareSurveySiteIds)).toEqual([
      "survey-site:v1:a0:0000",
      "survey-site:v1:a:0000",
    ]);
  });

  it("ships exactly one stable, directly approachable site of each initial type", () => {
    const generated = new WorldGenerator().generate(13_371);
    const terrainVersion = generated.grid.terrainVersion;
    const knowledgeVersion = generated.grid.knowledgeVersion;
    const islandsBefore = structuredClone(generated.islands);
    const first = generateSurveySiteCatalog(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
    );
    const repeated = generateSurveySiteCatalog(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
    );

    expect(first).toEqual(repeated);
    expect(first).toHaveLength(3);
    expect(first.map(({ type }) => type).sort()).toEqual([...SURVEY_SITE_TYPES].sort());
    expect(new Set(first.map(({ id }) => id)).size).toBe(3);
    expect(generated.grid.terrainVersion).toBe(terrainVersion);
    expect(generated.grid.knowledgeVersion).toBe(knowledgeVersion);
    expect(generated.islands).toEqual(islandsBefore);

    const reachable = dockReachable(generated.grid, generated.landmarks.homeReturnTile);
    const visibility = new VisibilitySystem(generated.grid);
    for (const definition of first) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(parseSurveySiteId(definition.id)).toMatchObject({
        contentVersion: SURVEY_SITE_CONTENT_VERSION,
        type: definition.type,
      });
      expect(generated.grid.getIslandId(definition.tile.x, definition.tile.y)).toBe(definition.islandId);
      expect(generated.grid.isMovementBlocked(definition.serviceAnchor.x, definition.serviceAnchor.y)).toBe(false);
      expect(reachable[generated.grid.index(definition.serviceAnchor.x, definition.serviceAnchor.y)]).toBe(1);
      expect(Math.hypot(
        definition.tile.x - definition.serviceAnchor.x,
        definition.tile.y - definition.serviceAnchor.y,
      )).toBeLessThanOrEqual(1.5);
      expect(visibility.getVisibleIndices(definition.serviceAnchor)).toContain(
        generated.grid.index(definition.tile.x, definition.tile.y),
      );
      expect(definition.clue.label.length).toBeGreaterThan(0);
      expect(definition.result.detail.length).toBeGreaterThan(0);
      expect(definition.presentation.id).toMatch(/^developer\.survey_site\./);
    }

    const byType = new Map(first.map((definition) => [definition.type, definition]));
    expect(generated.grid.getTerrain(
      byType.get("historic-wreck")!.tile.x,
      byType.get("historic-wreck")!.tile.y,
    )).toBe(TerrainType.ShallowOcean);
    expect(generated.grid.getTerrain(
      byType.get("coastal-ruin")!.tile.x,
      byType.get("coastal-ruin")!.tile.y,
    )).toBe(TerrainType.Land);
    expect(generated.grid.getTerrain(
      byType.get("tidal-cave")!.tile.x,
      byType.get("tidal-cave")!.tile.y,
    )).toBe(TerrainType.Rock);
  });

  it("rerolls through the site namespace only and rejects unsupported content versions", () => {
    const first = makeCatalog(7_001);
    const second = makeCatalog(7_002);
    expect(first.definitions.map(({ id }) => id)).toEqual(second.definitions.map(({ id }) => id));
    expect(first.definitions.map(({ tile, clue, result }) => ({ tile, clue, result })))
      .not.toEqual(second.definitions.map(({ tile, clue, result }) => ({ tile, clue, result })));
    expect(() => generateSurveySiteCatalog(
      first.generated.grid,
      first.generated.seed,
      first.generated.islands,
      first.generated.landmarks.homeReturnTile,
      2,
    )).toThrow(/Unsupported survey-site content version 2/);
  });
});

describe("shared survey-site lifecycle", () => {
  it("keeps the deterministic result hidden until an affordable survey succeeds", () => {
    const { generated, definitions } = makeCatalog();
    const definition = definitions[0];
    const system = new SurveySiteSystem(generated.grid, definitions);
    generated.grid.setVisibleNow(definition.tile.x, definition.tile.y, true);

    const clue = system.readModels().find(({ id }) => id === definition.id);
    expect(clue).toMatchObject({ state: "clue", clue: definition.clue });
    expect(clue).not.toHaveProperty("result");

    expect(revealAndSight(system, generated.grid, definition, 4, 2).found).toEqual([{
      id: definition.id,
      state: "sighted",
      expeditionId: 4,
      generation: 2,
    }]);
    const sighted = system.readModels().find(({ id }) => id === definition.id);
    expect(sighted).toMatchObject({ state: "sighted", clue: definition.clue });
    expect(sighted).not.toHaveProperty("result");
    expect(system.interactionNear(definition.serviceAnchor, affordableBudget)).toMatchObject({
      id: definition.id,
      state: "sighted",
      surveyCost: 2,
      canAfford: true,
      distanceTiles: 0,
    });

    const revisionBeforeRejection = system.recordsRevision;
    expect(system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: definition.id,
    }, definition.serviceAnchor, 4, 2, createSurveyBudget(2, 1, 0))).toMatchObject({
      status: "rejected",
      reason: "insufficient-provisions",
    });
    expect(system.recordsRevision).toBe(revisionBeforeRejection);
    expect(system.provisional[0].state).toBe("sighted");

    const surveyed = system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: definition.id,
    }, definition.serviceAnchor, 4, 2, affordableBudget);
    expect(surveyed).toMatchObject({
      status: "surveyed",
      id: definition.id,
      type: definition.type,
      result: definition.result,
      provisionsSpent: 2,
      availableProvisionUnitsRemaining: 10,
    });
    expect(system.readModels().find(({ id }) => id === definition.id)).toMatchObject({
      state: "surveyed",
      result: definition.result,
    });

    const committed = system.commitExpedition(4);
    expect(committed.leads).toHaveLength(0);
    expect(committed.reports).toEqual([{
      id: definition.id,
      state: "report",
      expeditionId: 4,
      generation: 2,
    }]);
    expect(system.commitExpedition(4)).toEqual({ leads: [], reports: [] });
    expect(system.readModels().find(({ id }) => id === definition.id)).toMatchObject({
      state: "returned-report",
      result: definition.result,
    });
    expect(system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: definition.id,
    }, definition.serviceAnchor, 5, 2, affordableBudget)).toMatchObject({
      status: "rejected",
      reason: "already-surveyed",
    });
  });

  it("preserves a returned lead when a later provisional report is lost", () => {
    const { generated, definitions } = makeCatalog();
    const definition = definitions[1];
    const system = new SurveySiteSystem(generated.grid, definitions);
    revealAndSight(system, generated.grid, definition, 8, 3);

    expect(system.commitExpedition(8)).toEqual({
      leads: [{ id: definition.id, state: "lead", expeditionId: 8, generation: 3 }],
      reports: [],
    });
    const leadModel = system.readModels().find(({ id }) => id === definition.id);
    expect(leadModel).toMatchObject({ state: "returned-lead" });
    expect(leadModel).not.toHaveProperty("result");

    expect(system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: definition.id,
    }, definition.serviceAnchor, 9, 4, affordableBudget).status).toBe("surveyed");
    expect(system.returned).toEqual([expect.objectContaining({ id: definition.id, state: "lead" })]);
    expect(system.provisional).toEqual([{
      id: definition.id,
      state: "surveyed",
      expeditionId: 9,
      generation: 4,
    }]);

    expect(system.revertExpedition(9)).toEqual([expect.objectContaining({ id: definition.id, state: "surveyed" })]);
    expect(system.provisional).toHaveLength(0);
    expect(system.returned).toEqual([expect.objectContaining({ id: definition.id, state: "lead" })]);
    expect(system.readModels().find(({ id }) => id === definition.id)).not.toHaveProperty("result");

    expect(system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: definition.id,
    }, definition.serviceAnchor, 10, 4, affordableBudget).status).toBe("surveyed");
    expect(system.commitExpedition(10).reports).toEqual([{
      id: definition.id,
      state: "report",
      expeditionId: 10,
      generation: 4,
    }]);
    expect(system.returned).toEqual([expect.objectContaining({ id: definition.id, state: "report" })]);
  });

});

describe("descriptor extensibility", () => {
  it("uses deterministic binary ID order for future type names", () => {
    const generated = new WorldGenerator().generate(24_680);
    const base = INITIAL_SURVEY_SITE_DESCRIPTORS[0];
    const descriptor = (type: "a" | "a0", namespace: number): Readonly<SurveySiteTypeDescriptor<string>> => ({
      ...base,
      type,
      label: type,
      namespace,
      presentation: { ...base.presentation, id: `developer.survey_site.${type}.01` },
    });
    const definitions = generateSurveySiteCatalogFromDescriptors(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
      [descriptor("a", 1_340_101), descriptor("a0", 1_340_103)],
    );

    expect(definitions.map(({ id }) => id)).toEqual([
      "survey-site:v1:a0:0000",
      "survey-site:v1:a:0000",
    ]);
    const system = new SurveySiteSystem<string>(generated.grid, [...definitions].reverse());
    expect(system.definitions.map(({ id }) => id)).toEqual(definitions.map(({ id }) => id));
  });

  it("runs a synthetic fourth type through the same catalog, command, and reducer", () => {
    const generated = new WorldGenerator().generate(24_680);
    const synthetic: Readonly<SurveySiteTypeDescriptor<"sea-arch">> = Object.freeze({
      type: "sea-arch",
      label: "Sea arch",
      namespace: 1_340_099,
      count: 1,
      placement: Object.freeze({
        terrain: Object.freeze([TerrainType.ShallowOcean]),
        islandKinds: Object.freeze(Object.values(IslandKind)),
      }),
      clues: Object.freeze([Object.freeze({ id: "spray", label: "Spray appearing through the island" })]),
      results: Object.freeze([Object.freeze({
        id: "cut-through",
        label: "A tide-cut sea arch",
        detail: "The opening records many generations of wave action.",
      })]),
      presentation: Object.freeze({
        id: "developer.survey_site.sea_arch.01",
        badge: "SA",
        color: 0x88bbcc,
      }),
    });
    const descriptors: readonly Readonly<SurveySiteTypeDescriptor<string>>[] = [
      ...INITIAL_SURVEY_SITE_DESCRIPTORS,
      synthetic,
    ];
    const definitions = generateSurveySiteCatalogFromDescriptors(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
      descriptors,
    );
    expect(definitions).toHaveLength(4);
    const target = definitions.find(({ type }) => type === "sea-arch")!;
    expect(parseSurveySiteId(target.id)).toMatchObject({ type: "sea-arch", ordinal: 0 });

    const system = new SurveySiteSystem<string>(generated.grid, definitions);
    expect(revealAndSight(system, generated.grid, target, 3, 1).found).toHaveLength(1);
    expect(system.applyInteraction({
      contractVersion: SURVEY_SITE_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    }, target.serviceAnchor, 3, 1, affordableBudget)).toMatchObject({
      status: "surveyed",
      type: "sea-arch",
      result: target.result,
    });
    expect(system.commitExpedition(3).reports).toEqual([
      expect.objectContaining({ id: target.id, state: "report" }),
    ]);
  });
});
