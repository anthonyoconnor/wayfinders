import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import { generateDiscoveryDefinitions } from "../src/wayfinders/exploration/DiscoverySystem";
import { generateFishingShoalCatalog } from "../src/wayfinders/exploration/FishingShoalCatalog";
import { FishingShoalSystem } from "../src/wayfinders/exploration/FishingShoalSystem";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

function terrainSignature(simulation: GameSimulation): number[] {
  const result: number[] = [];
  simulation.world.forEachTile((x, y, index) => {
    result.push(
      simulation.world.getTerrain(x, y),
      simulation.world.getIslandIdAtIndex(index),
      simulation.world.getResourceIdAtIndex(index),
    );
  });
  return result;
}

describe("deterministic fishing-shoal catalog", () => {
  it("derives a sparse stable catalog without changing terrain, islands, or discoveries", () => {
    const seed = 13_371;
    const first = new GameSimulation();
    first.regenerate(seed);
    const beforeTerrain = terrainSignature(first);
    const beforeIslands = structuredClone(first.generated.islands);
    const beforeDiscoveries = structuredClone(first.discoveryDefinitions);

    const catalog = generateFishingShoalCatalog(
      first.world,
      seed,
      first.generated.landmarks.homeReturnTile,
    );
    const generatedAgain = new WorldGenerator().generate(seed);
    const repeated = generateFishingShoalCatalog(
      generatedAgain.grid,
      seed,
      generatedAgain.landmarks.homeReturnTile,
    );

    expect(catalog).toEqual(repeated);
    expect(catalog).toHaveLength(4);
    expect(new Set(catalog.map(({ id }) => id)).size).toBe(catalog.length);
    expect(terrainSignature(first)).toEqual(beforeTerrain);
    expect(first.generated.islands).toEqual(beforeIslands);
    expect(first.discoveryDefinitions).toEqual(beforeDiscoveries);
    expect(generateDiscoveryDefinitions(seed, first.generated.islands)).toEqual(beforeDiscoveries);

    for (const definition of catalog) {
      const { x, y } = definition.tile;
      const index = first.world.index(x, y);
      expect(first.world.isMovementBlockedAtIndex(index)).toBe(false);
      expect(first.world.getIslandIdAtIndex(index)).toBeLessThan(0);
      expect(first.world.getResourceIdAtIndex(index)).toBeLessThan(0);
      expect([TerrainType.DeepOcean, TerrainType.ShallowOcean]).toContain(first.world.getTerrain(x, y));
      expect(Math.hypot(
        x - first.generated.landmarks.homeReturnTile.x,
        y - first.generated.landmarks.homeReturnTile.y,
      )).toBeGreaterThanOrEqual(18);
      expect(definition.serviceAnchor).toEqual(definition.tile);
    }
    for (let left = 0; left < catalog.length; left++) {
      for (let right = left + 1; right < catalog.length; right++) {
        expect(Math.hypot(
          catalog[left].tile.x - catalog[right].tile.x,
          catalog[left].tile.y - catalog[right].tile.y,
        )).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it("keeps IDs namespaced while seed changes can change locations and outcomes", () => {
    const first = new WorldGenerator().generate(7_001);
    const second = new WorldGenerator().generate(7_002);
    const firstCatalog = generateFishingShoalCatalog(first.grid, first.seed, first.landmarks.homeReturnTile);
    const secondCatalog = generateFishingShoalCatalog(second.grid, second.seed, second.landmarks.homeReturnTile);

    expect(firstCatalog.map(({ id }) => id)).toEqual(secondCatalog.map(({ id }) => id));
    expect(firstCatalog.map(({ tile, quality, clue }) => ({ tile, quality, clue })))
      .not.toEqual(secondCatalog.map(({ tile, quality, clue }) => ({ tile, quality, clue })));
    expect(() => generateFishingShoalCatalog(first.grid, first.seed, first.landmarks.homeReturnTile, 2))
      .toThrow(/Unsupported fishing-shoal content version/);
  });
});

describe("fishing-shoal sighting lifecycle", () => {
  it("observes current sight once and never mutates world knowledge", () => {
    const generated = new WorldGenerator().generate(21_345);
    const definitions = generateFishingShoalCatalog(
      generated.grid,
      generated.seed,
      generated.landmarks.homeReturnTile,
    );
    const system = new FishingShoalSystem(generated.grid, definitions);
    const definition = definitions[0];
    const index = generated.grid.index(definition.tile.x, definition.tile.y);
    const beforeKnowledgeVersion = generated.grid.knowledgeVersion;
    const beforeKnowledge = generated.grid.getKnowledgeAtIndex(index);

    expect(system.observeCurrentSight(3, 2, []).found).toHaveLength(0);
    expect(system.observeCurrentSight(3, 2, [index]).found).toEqual([{
      id: definition.id,
      state: "sighted",
      expeditionId: 3,
      generation: 2,
    }]);
    expect(system.observeCurrentSight(3, 2, [index]).found).toHaveLength(0);
    expect(generated.grid.knowledgeVersion).toBe(beforeKnowledgeVersion);
    expect(generated.grid.getKnowledgeAtIndex(index)).toBe(beforeKnowledge);

    generated.grid.setVisibleNowAtIndex(index, true);
    const visibleModel = system.readModels().find(({ id }) => id === definition.id);
    expect(visibleModel).toMatchObject({ state: "sighted", clue: definition.clue });
    expect(visibleModel).not.toHaveProperty("quality");

    generated.grid.setVisibleNowAtIndex(index, false);
    expect(system.readModels().some(({ id }) => id === definition.id)).toBe(false);
    generated.grid.setKnowledgeAtIndex(index, KnowledgeState.Personal, 3);
    expect(system.readModels().find(({ id }) => id === definition.id)).toMatchObject({ state: "sighted" });
  });

  it("round-trips a provisional sighting without rerolling its definition", () => {
    const original = new GameSimulation();
    const definition = original.fishingShoalDefinitions[0];
    expect(original.teleport(definition.tile)).toBe(true);
    expect(original.provisionalFishingShoals).toEqual([{
      id: definition.id,
      state: "sighted",
      expeditionId: original.currentExpeditionId,
      generation: original.generation,
    }]);

    const save = original.createSave();
    const restored = new GameSimulation();
    restored.restoreSave(save);
    expect(restored.fishingShoalDefinitions).toEqual(original.fishingShoalDefinitions);
    expect(restored.provisionalFishingShoals).toEqual(original.provisionalFishingShoals);
    expect(restored.fishingShoalDefinitions.find(({ id }) => id === definition.id)?.quality)
      .toBe(definition.quality);
    expect(restored.createSave().fishingShoals).toEqual(save.fishingShoals);
  });

  it("discards GP-1.1 provisional sightings on either return or wreck", () => {
    const returned = new GameSimulation();
    expect(returned.teleport(returned.fishingShoalDefinitions[0].tile)).toBe(true);
    expect(returned.provisionalFishingShoals).toHaveLength(1);
    expect(returned.teleport(returned.generated.landmarks.homeReturnTile)).toBe(true);
    expect(returned.provisionalFishingShoals).toHaveLength(0);

    const wrecked = new GameSimulation();
    expect(wrecked.teleport(wrecked.fishingShoalDefinitions[0].tile)).toBe(true);
    expect(wrecked.forceWreck()).toBe(true);
    expect(wrecked.provisionalFishingShoals).toHaveLength(0);
  });
});
