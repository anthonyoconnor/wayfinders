import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import { generateFishingShoalCatalog } from "../src/wayfinders/exploration/FishingShoalCatalog";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  createFishingShoalId,
} from "../src/wayfinders/exploration/FishingShoalContracts";
import { FishingShoalSystem } from "../src/wayfinders/exploration/FishingShoalSystem";
import { generateIslandDossierCatalog } from "../src/wayfinders/exploration/IslandDossierCatalog";
import { createSurveyBudget } from "../src/wayfinders/exploration/SurveyContracts";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph";
import { solidRowsToCollisionMask } from "../src/wayfinders/world/CollisionMask";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { BOUNDED_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { drainForwardGuidance } from "./helpers";

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

function surveyBudget(availableProvisionUnits = 12, returnCost = 0) {
  return createSurveyBudget(2, availableProvisionUnits, returnCost);
}

function teleportAlongNavigablePath(
  simulation: GameSimulation,
  target: Readonly<{ x: number; y: number }>,
): void {
  const graph = new GridGraph(simulation.world, simulation.config);
  const start = simulation.world.index(
    simulation.ship.currentTileX,
    simulation.ship.currentTileY,
  );
  const goal = simulation.world.index(target.x, target.y);
  const unvisited = -2;
  const root = -1;
  const parents = new Int32Array(simulation.world.tileCount);
  const queue = new Int32Array(simulation.world.tileCount);
  parents.fill(unvisited);
  parents[start] = root;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail && parents[goal] === unvisited) {
    const current = queue[head++];
    graph.forEachTraversableCardinalEdge(current, (neighbor) => {
      if (parents[neighbor] !== unvisited) return;
      parents[neighbor] = current;
      queue[tail++] = neighbor;
    });
  }
  if (parents[goal] === unvisited) throw new Error("Expected a navigable route to the fishing ground");

  const route: number[] = [];
  for (let index = goal; index !== start; index = parents[index]) route.push(index);
  route.reverse();
  for (const index of route) {
    expect(simulation.teleport(simulation.world.pointFromIndex(index))).toBe(true);
  }
}

describe("deterministic fishing-shoal catalog", () => {
  it("derives a sparse stable catalog without changing terrain, islands, or island dossiers", () => {
    const seed = 13_371;
    const first = new GameSimulation();
    first.regenerate(seed);
    const beforeTerrain = terrainSignature(first);
    const beforeIslands = structuredClone(first.generated.islands);
    const beforeIslandDossiers = structuredClone(first.islandDossierDefinitions);

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
    expect(first.islandDossierDefinitions).toEqual(beforeIslandDossiers);
    expect(generateIslandDossierCatalog(
      first.world,
      seed,
      first.generated.islands,
      first.generated.landmarks.homeReturnTile,
    )).toEqual(beforeIslandDossiers);

    for (const definition of catalog) {
      const { x, y } = definition.tile;
      const index = first.world.index(x, y);
      expect(first.world.isMovementBlockedAtIndex(index)).toBe(false);
      expect(first.world.getIslandIdAtIndex(index)).toBeLessThan(0);
      expect(first.world.getResourceIdAtIndex(index)).toBeLessThan(0);
      expect([TerrainType.DeepOcean, TerrainType.ShallowOcean]).toContain(first.world.getTerrain(x, y));
      expect(Math.sqrt(first.world.topology.minimumImageTileDistanceSquared(
        { x, y },
        first.generated.landmarks.homeReturnTile,
      ))).toBeGreaterThanOrEqual(18);
      expect(definition.serviceAnchor).toEqual(definition.tile);
    }
    for (let left = 0; left < catalog.length; left++) {
      for (let right = left + 1; right < catalog.length; right++) {
        expect(Math.sqrt(first.world.topology.minimumImageTileDistanceSquared(
          catalog[left].tile,
          catalog[right].tile,
        ))).toBeGreaterThanOrEqual(14);
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

  it("excludes otherwise-open candidates whose fine collision is unsafe for the ship hull", () => {
    const generated = new WorldGenerator().generate(7_003);
    const baseline = generateFishingShoalCatalog(
      generated.grid,
      generated.seed,
      generated.landmarks.homeReturnTile,
    );
    const excluded = baseline[0].tile;
    generated.grid.setFineCollisionMask(excluded.x, excluded.y, solidRowsToCollisionMask([
      "1000",
      "0000",
      "0000",
      "0000",
    ]));

    const refined = generateFishingShoalCatalog(
      generated.grid,
      generated.seed,
      generated.landmarks.homeReturnTile,
    );

    expect(refined).toHaveLength(4);
    expect(refined.some(({ tile }) => tile.x === excluded.x && tile.y === excluded.y)).toBe(false);
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
    const system = new FishingShoalSystem(
      generated.grid,
      definitions,
      generated.landmarks.homeReturnTile,
    );
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

  it("commits an unsurveyed sighting as a returned lead but loses it on wreck", () => {
    const returned = new GameSimulation();
    const target = returned.fishingShoalDefinitions[0];
    expect(returned.teleport(target.tile)).toBe(true);
    expect(returned.provisionalFishingShoals).toHaveLength(1);
    expect(returned.teleport(returned.generated.landmarks.homeReturnTile)).toBe(true);
    expect(returned.provisionalFishingShoals).toHaveLength(0);
    expect(returned.returnedFishingShoals).toEqual([expect.objectContaining({
      id: target.id,
      state: "lead",
    })]);
    expect(returned.currentNavigator.successfulVoyages[0].fishingLeadIds).toEqual([target.id]);
    expect(returned.activationEligibleFishingShoals).toHaveLength(0);

    const wrecked = new GameSimulation();
    expect(wrecked.teleport(wrecked.fishingShoalDefinitions[0].tile)).toBe(true);
    expect(wrecked.forceWreck()).toBe(true);
    expect(wrecked.provisionalFishingShoals).toHaveLength(0);
    expect(wrecked.returnedFishingShoals).toHaveLength(0);
  });
});

describe("provision-funded fishing-shoal survey action", () => {
  it("validates Survey-only commands and permits multiple surveys through the target system", () => {
    const generated = new WorldGenerator().generate(44_321);
    const definitions = generateFishingShoalCatalog(
      generated.grid,
      generated.seed,
      generated.landmarks.homeReturnTile,
    );
    const system = new FishingShoalSystem(
      generated.grid,
      definitions,
      generated.landmarks.homeReturnTile,
    );
    const first = definitions[0];
    const second = definitions[1];
    system.observeCurrentSight(8, 3, [
      generated.grid.index(first.tile.x, first.tile.y),
      generated.grid.index(second.tile.x, second.tile.y),
    ]);

    const interaction = system.interactionNear(first.tile, surveyBudget());
    expect(interaction).toMatchObject({
      id: first.id,
      state: "sighted",
      clueLabel: first.clue.label,
      surveyCost: 2,
      availableProvisionUnits: 12,
      remainingProvisionUnits: 10,
      returnCost: 0,
      projectedReturnMargin: 10,
      canAfford: true,
    });
    expect(interaction).not.toHaveProperty("quality");

    expect(system.applyInteraction({
      contractVersion: 1,
      type: "survey",
      id: first.id,
    } as never, first.tile, 8, 3, surveyBudget())).toMatchObject({
      status: "rejected",
      reason: "unsupported-contract",
    });
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "leave",
      id: first.id,
    } as never, first.tile, 8, 3, surveyBudget())).toMatchObject({
      status: "rejected",
      reason: "invalid-command",
    });
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: createFishingShoalId(99),
    }, first.tile, 8, 3, surveyBudget())).toMatchObject({ status: "rejected", reason: "unknown-opportunity" });
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: second.id,
    }, first.tile, 8, 3, surveyBudget())).toMatchObject({ status: "rejected", reason: "out-of-range" });
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: definitions[2].id,
    }, definitions[2].tile, 8, 3, surveyBudget())).toMatchObject({ status: "rejected", reason: "not-sighted" });

    const beforeInsufficient = system.provisional.map((record) => ({ ...record }));
    const revisionBeforeInsufficient = system.recordsRevision;
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: first.id,
    }, first.tile, 8, 3, surveyBudget(1))).toMatchObject({
      status: "rejected",
      reason: "insufficient-provisions",
    });
    expect(system.provisional).toEqual(beforeInsufficient);
    expect(system.recordsRevision).toBe(revisionBeforeInsufficient);

    const surveyed = system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: first.id,
    }, first.tile, 8, 3, surveyBudget());
    expect(surveyed).toMatchObject({
      status: "surveyed",
      id: first.id,
      quality: first.quality,
      provisionsSpent: 2,
      availableProvisionUnitsRemaining: 10,
      presentationMs: 1_200,
    });
    expect(system.provisional.find(({ id }) => id === first.id)?.state).toBe("surveyed");
    const provisionalSurveyModel = system.readModels().find(({ id }) => id === first.id);
    expect(provisionalSurveyModel).toMatchObject({ state: "surveyed", quality: first.quality });
    expect(provisionalSurveyModel).not.toHaveProperty("homeConnected");

    const revisionAfterSurvey = system.recordsRevision;
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: first.id,
    }, first.tile, 8, 3, surveyBudget(10))).toMatchObject({ status: "rejected", reason: "already-surveyed" });
    expect(system.recordsRevision).toBe(revisionAfterSurvey);

    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: second.id,
    }, second.tile, 8, 3, surveyBudget(10))).toMatchObject({
      status: "surveyed",
      id: second.id,
      provisionsSpent: 2,
      availableProvisionUnitsRemaining: 8,
    });
    expect(system.provisional.filter(({ state }) => state === "surveyed")).toHaveLength(2);
  });

  it("charges multiple surveys, then replenishes on dock or post-wreck succession", () => {
    const original = new GameSimulation();
    const first = original.fishingShoalDefinitions[0];
    const second = original.fishingShoalDefinitions[1];
    expect(original.teleport(first.tile)).toBe(true);
    expect(original.fishingShoalInteraction).toMatchObject({
      id: first.id,
      surveyCost: 2,
      availableProvisionUnits: 12,
      remainingProvisionUnits: 10,
      canAfford: true,
    });

    expect(original.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: first.id,
    })).toMatchObject({ status: "surveyed", quality: first.quality, provisionsSpent: 2 });
    expect(original.ship.provisions).toBe(10);
    expect(original.teleport(second.tile)).toBe(true);
    expect(original.fishingShoalInteraction).toMatchObject({
      id: second.id,
      availableProvisionUnits: 10,
      remainingProvisionUnits: 8,
      canAfford: true,
    });
    expect(original.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: second.id,
    })).toMatchObject({ status: "surveyed", quality: second.quality, provisionsSpent: 2 });
    expect(original.ship.provisions).toBe(8);
    expect(original.provisionalFishingShoals.filter(({ state }) => state === "surveyed")).toHaveLength(2);

    expect(original.teleport(original.generated.landmarks.homeReturnTile)).toBe(true);
    expect(original.provisionalFishingShoals).toHaveLength(0);
    expect(original.returnedFishingShoals.filter(({ state }) => state === "survey")).toHaveLength(2);
    expect(original.ship.provisions).toBe(original.config.provisions.startingBundles);

    const wrecked = new GameSimulation();
    const target = wrecked.fishingShoalDefinitions[0];
    expect(wrecked.teleport(target.tile)).toBe(true);
    expect(wrecked.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    }).status).toBe("surveyed");
    expect(wrecked.ship.provisions).toBe(10);
    expect(wrecked.forceWreck()).toBe(true);
    expect(wrecked.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    })).toMatchObject({ status: "rejected", reason: "wreck-hold" });
    wrecked.update({ turn: 0, throttle: 0 }, wrecked.config.simulation.wreckPresentationSeconds);
    expect(wrecked.acknowledgeGenerationHandover()).toBe(true);
    expect(wrecked.ship.provisions).toBe(wrecked.config.provisions.startingBundles);
  });

  it("uses fractional availability, rejects insufficient supply atomically, and refreshes range budgets", () => {
    const simulation = new GameSimulation();
    const target = simulation.fishingShoalDefinitions[0];
    expect(simulation.teleport(target.tile)).toBe(true);
    simulation.ship.provisionAccumulator = 0.375;
    simulation.refreshRiskOverlays();
    drainForwardGuidance(simulation);

    const budgetBefore = simulation.forwardRange.budget;
    const returnMarginBefore = simulation.returnPaths.returnMargin;
    expect(simulation.fishingShoalInteraction).toMatchObject({
      surveyCost: 2,
      availableProvisionUnits: 11.625,
      remainingProvisionUnits: 9.625,
      canAfford: true,
    });
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    })).toMatchObject({
      status: "surveyed",
      provisionsSpent: 2,
      availableProvisionUnitsRemaining: 9.625,
    });
    expect(simulation.ship).toMatchObject({ provisions: 10, provisionAccumulator: 0.375 });
    expect(simulation.forwardRange.budget).toBeCloseTo(budgetBefore - 2);
    if (Number.isFinite(returnMarginBefore)) {
      expect(simulation.returnPaths.returnMargin).toBeCloseTo(returnMarginBefore - 2);
    }

    const insufficient = new GameSimulation();
    const remote = insufficient.fishingShoalDefinitions[0];
    expect(insufficient.teleport(remote.tile)).toBe(true);
    insufficient.setProvisions(1);
    const recordsBefore = structuredClone(insufficient.provisionalFishingShoals);
    expect(insufficient.fishingShoalInteraction).toMatchObject({
      surveyCost: 2,
      availableProvisionUnits: 1,
      remainingProvisionUnits: 0,
      canAfford: false,
    });
    expect(insufficient.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: remote.id,
    })).toMatchObject({ status: "rejected", reason: "insufficient-provisions" });
    expect(insufficient.ship.provisions).toBe(1);
    expect(insufficient.provisionalFishingShoals).toEqual(recordsBefore);
  });

  it("rejects stale and reentrant survey commands without double charging", () => {
    const simulation = new GameSimulation();
    const target = simulation.fishingShoalDefinitions[0];
    expect(simulation.teleport(target.tile)).toBe(true);

    expect(simulation.interactWithFishingShoal({
      contractVersion: 1,
      type: "survey",
      id: target.id,
    } as never)).toMatchObject({ status: "rejected", reason: "unsupported-contract" });
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "leave",
      id: target.id,
    } as never)).toMatchObject({ status: "rejected", reason: "invalid-command" });
    expect(simulation.ship.provisions).toBe(12);

    let callbackResult: ReturnType<GameSimulation["interactWithFishingShoal"]> | undefined;
    let callbackTeleport: boolean | undefined;
    simulation.events.on("provisionConsumed", () => {
      callbackResult ??= simulation.interactWithFishingShoal({
        contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
        type: "survey",
        id: target.id,
      });
      callbackTeleport ??= simulation.teleport(simulation.generated.landmarks.homeReturnTile);
    });
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    })).toMatchObject({ status: "surveyed", provisionsSpent: 2 });
    expect(callbackResult).toMatchObject({ status: "rejected", reason: "interaction-busy" });
    expect(callbackTeleport).toBe(false);
    expect(simulation.ship.provisions).toBe(10);
    expect(simulation.provisionalFishingShoals.filter(({ state }) => state === "surveyed")).toHaveLength(1);
  });
});

describe("returned fishing-shoal lifecycle", () => {
  it("preserves a returned lead when its later provisional survey is wrecked", () => {
    const simulation = new GameSimulation();
    const target = simulation.fishingShoalDefinitions[0];
    const remote = simulation.fishingShoalDefinitions[1];

    expect(simulation.teleport(target.tile)).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const returnedLead = structuredClone(simulation.returnedFishingShoals[0]);
    expect(returnedLead).toMatchObject({ id: target.id, state: "lead" });
    const returnedLeadModel = simulation.fishingShoalReadModels.find(({ id }) => id === target.id);
    expect(returnedLeadModel).toMatchObject({ state: "returned-lead" });
    expect(returnedLeadModel).not.toHaveProperty("homeConnected");

    expect(simulation.teleport(target.tile)).toBe(true);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.fishingShoalInteraction).toMatchObject({
      id: target.id,
      state: "returned-lead",
      surveyCost: 2,
      availableProvisionUnits: 12,
      remainingProvisionUnits: 10,
      canAfford: true,
    });
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    })).toMatchObject({ status: "surveyed", quality: target.quality });
    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.returnedFishingShoals).toEqual([returnedLead]);
    expect(simulation.provisionalFishingShoals).toEqual([expect.objectContaining({
      id: target.id,
      state: "surveyed",
    })]);

    expect(simulation.returnedFishingShoals).toEqual([returnedLead]);
    expect(simulation.fishingShoalReadModels.find(({ id }) => id === target.id))
      .toMatchObject({ state: "surveyed", quality: target.quality });

    expect(simulation.teleport(remote.tile)).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.provisionalFishingShoals).toHaveLength(0);
    expect(simulation.returnedFishingShoals).toEqual([returnedLead]);
    simulation.update(
      { turn: 0, throttle: 0 },
      simulation.config.simulation.wreckPresentationSeconds,
    );
    expect(simulation.acknowledgeGenerationHandover()).toBe(true);

    teleportAlongNavigablePath(simulation, target.tile);
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    }).status).toBe("surveyed");
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.provisionalFishingShoals).toHaveLength(0);
    expect(simulation.returnedFishingShoals).toEqual([expect.objectContaining({
      id: target.id,
      state: "survey",
    })]);
    expect(simulation.currentNavigator.successfulVoyages[0].fishingSurveyIds).toEqual([target.id]);
    expect(simulation.activationEligibleFishingShoals).toHaveLength(1);
  });

  it("makes a returned survey terminal and idempotent across revisit, dock, and wreck", () => {
    const simulation = new GameSimulation();
    const target = simulation.fishingShoalDefinitions[0];
    const remote = simulation.fishingShoalDefinitions[1];
    let returnReports = 0;
    simulation.events.on("fishingShoalsReturned", () => returnReports++);

    teleportAlongNavigablePath(simulation, target.tile);
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    }).status).toBe("surveyed");
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(returnReports).toBe(1);
    const terminalRecord = structuredClone(simulation.returnedFishingShoals[0]);
    expect(terminalRecord).toMatchObject({ id: target.id, state: "survey" });
    expect(simulation.currentNavigator.successfulVoyages[0].fishingSurveyIds).toEqual([target.id]);
    expect(simulation.fishingShoalReadModels.find(({ id }) => id === target.id)).toMatchObject({
      state: "returned-survey",
      quality: target.quality,
      homeConnected: true,
    });
    expect(simulation.activationEligibleFishingShoals).toEqual([terminalRecord]);

    let replayReports = 0;
    simulation.events.on("fishingShoalsReturned", () => replayReports++);
    expect(simulation.teleport(target.tile)).toBe(true);
    expect(simulation.fishingShoalInteraction).toBeUndefined();
    const beforeRepeat = structuredClone(simulation.returnedFishingShoals);
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: target.id,
    })).toMatchObject({ status: "rejected", reason: "already-surveyed" });
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);
    expect(simulation.expeditionActive).toBe(false);
    expect(simulation.returnedFishingShoals).toEqual(beforeRepeat);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(replayReports).toBe(0);

    expect(simulation.teleport(remote.tile)).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    expect(simulation.returnedFishingShoals).toEqual(beforeRepeat);
    simulation.update(
      { turn: 0, throttle: 0 },
      simulation.config.simulation.wreckPresentationSeconds,
    );
    expect(simulation.returnedFishingShoals).toEqual(beforeRepeat);
    expect(replayReports).toBe(0);
  });
});

describe("returned-ground Supported connectivity", () => {
  it("derives connection and activation from exact topology without rebuilding on unrelated changes", () => {
    const world = new WorldGrid(5, 2, 5, BOUNDED_WORLD_TOPOLOGY);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    const id = createFishingShoalId(0);
    const system = new FishingShoalSystem(
      world,
      [{
        id,
        contentVersion: 1,
        tile: { x: 4, y: 0 },
        serviceAnchor: { x: 4, y: 0 },
        quality: "steady",
        clue: { kind: "seabirds", intensity: 2, label: "Circling seabirds" },
      }],
      { x: 0, y: 0 },
    );
    system.observeCurrentSight(1, 1, [world.index(4, 0)]);
    expect(system.applyInteraction({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id,
    }, { x: 4, y: 0 }, 1, 1, surveyBudget(12)).status).toBe("surveyed");
    system.commitExpedition(1);

    expect(system.readModels()).toEqual([
      expect.objectContaining({ id, state: "returned-survey", homeConnected: false }),
    ]);
    expect(system.activationEligible).toEqual([]);
    expect(system.connectivityBuildCount).toBe(1);

    world.setVisibleNow(4, 0, true);
    world.setKnowledge(0, 1, KnowledgeState.Personal, 2);
    expect(system.readModels()[0]).toMatchObject({ homeConnected: false });
    expect(system.connectivityBuildCount).toBe(1);

    for (let x = 0; x <= 4; x++) world.setKnowledge(x, 0, KnowledgeState.Supported);
    expect(system.readModels()[0]).toMatchObject({ homeConnected: true });
    expect(system.activationEligible).toEqual([expect.objectContaining({ id, state: "survey" })]);
    expect(system.connectivityBuildCount).toBe(2);

    world.setKnowledge(2, 0, KnowledgeState.Personal, 3);
    expect(system.readModels()[0]).toMatchObject({ homeConnected: false });
    expect(system.activationEligible).toEqual([]);
    expect(system.connectivityBuildCount).toBe(3);
  });
});
