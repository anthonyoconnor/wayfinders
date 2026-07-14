import { describe, expect, it } from "vitest";
import {
  ISLAND_DOSSIER_CONTENT_VERSION,
  ISLAND_DOSSIER_CONTRACT_VERSION,
  ISLAND_DOSSIER_INTERACTION_RANGE_TILES,
  type IslandDossierInteractionCommandV1,
  type IslandDossierProvisionalRecordV1,
  type IslandDossierReturnedRecordV1,
} from "../src/wayfinders/exploration/IslandDossierContracts.ts";
import { generateIslandDossierCatalog } from "../src/wayfinders/exploration/IslandDossierCatalog.ts";
import { IslandDossierSystem } from "../src/wayfinders/exploration/IslandDossierSystem.ts";
import { createSurveyBudget } from "../src/wayfinders/exploration/SurveyContracts.ts";
import {
  IslandKind,
  IslandSize,
  type GeneratedIsland,
} from "../src/wayfinders/world/IslandGenerator.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { makeConfig } from "./helpers.ts";

const SEED = 13_371;

function generatedHarness(seed = SEED) {
  const generated = new WorldGenerator(makeConfig()).generate(seed);
  const definitions = generateIslandDossierCatalog(
    generated.grid,
    generated.seed,
    generated.islands,
    generated.landmarks.homeReturnTile,
  );
  return {
    generated,
    definitions,
    system: new IslandDossierSystem(generated.grid, definitions),
  };
}

function reachableWater(world: WorldGrid, startX: number, startY: number): Uint8Array {
  const reachable = new Uint8Array(world.tileCount);
  const queue = new Int32Array(world.tileCount);
  let head = 0;
  let tail = 0;
  const start = world.index(startX, startY);
  reachable[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const index = queue[head++];
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const visit = (candidate: number): void => {
      if (reachable[candidate] || world.isMovementBlockedAtIndex(candidate)) return;
      reachable[candidate] = 1;
      queue[tail++] = candidate;
    };
    if (x > 0) visit(index - 1);
    if (x + 1 < world.width) visit(index + 1);
    if (y > 0) visit(index - world.width);
    if (y + 1 < world.height) visit(index + world.width);
  }
  return reachable;
}

function sightFirstIsland(harness: ReturnType<typeof generatedHarness>, expeditionId = 1, generation = 1) {
  const definition = harness.definitions[0];
  const observation = harness.system.observeCurrentSight(
    expeditionId,
    generation,
    [definition.footprintIndices[0]],
  );
  expect(observation.found).toHaveLength(1);
  return definition;
}

const ampleBudget = () => createSurveyBudget(2, 12, 4.5);

describe("island-dossier catalog", () => {
  it("derives one stable, unique and versioned dossier from every non-home island", () => {
    const first = generatedHarness();
    const replay = generatedHarness();

    expect(replay.definitions).toEqual(first.definitions);
    expect(first.definitions).toHaveLength(first.generated.islands.length);
    expect(first.definitions.map(({ islandId }) => islandId)).toEqual(
      first.generated.islands.map(({ id }) => id),
    );
    expect(new Set(first.definitions.map(({ name }) => name)).size).toBe(first.definitions.length);
    expect(first.definitions.every(({ contentVersion }) => (
      contentVersion === ISLAND_DOSSIER_CONTENT_VERSION
    ))).toBe(true);
    expect(first.definitions.every(({ dossier }) => (
      dossier.developerArtId.startsWith("developer:island-dossier:v1:")
    ))).toBe(true);

    for (const definition of first.definitions) {
      const exactFootprint: number[] = [];
      first.generated.grid.forEachTile((_x, _y, index) => {
        if (first.generated.grid.getIslandIdAtIndex(index) === definition.islandId) {
          exactFootprint.push(index);
        }
      });
      expect(definition.footprintIndices).toEqual(exactFootprint);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.footprintIndices)).toBe(true);
      expect(Object.isFrozen(definition.approachIndices)).toBe(true);
      expect(Object.isFrozen(definition.dossier)).toBe(true);
    }

    const serialized = JSON.stringify(first.definitions);
    expect(serialized).not.toContain("historic-wreck");
    expect(serialized).not.toContain("fishing-ground");
    const skerry = first.definitions.find(({ kind }) => kind === IslandKind.RockySkerry);
    expect(skerry?.dossier.theme).toBe("weather-watch");
  });

  it("derives the exhaustive passable, dock-reachable 1.5-tile coastal ring", () => {
    const { generated, definitions } = generatedHarness();
    const world = generated.grid;
    const reachable = reachableWater(
      world,
      generated.landmarks.homeReturnTile.x,
      generated.landmarks.homeReturnTile.y,
    );

    for (const definition of definitions) {
      const approaches = new Set(definition.approachIndices);
      const canonicalIndex = world.index(
        definition.canonicalApproach.x,
        definition.canonicalApproach.y,
      );
      expect(approaches.has(canonicalIndex)).toBe(true);

      for (const index of approaches) {
        expect(world.isMovementBlockedAtIndex(index)).toBe(false);
        expect(reachable[index]).toBe(1);
        const point = world.pointFromIndex(index);
        const minimumDistance = Math.min(...definition.footprintIndices.map((footprintIndex) => {
          const footprint = world.pointFromIndex(footprintIndex);
          return Math.hypot(point.x - footprint.x, point.y - footprint.y);
        }));
        expect(minimumDistance).toBeLessThanOrEqual(ISLAND_DOSSIER_INTERACTION_RANGE_TILES);
      }

      const extent = Math.ceil(ISLAND_DOSSIER_INTERACTION_RANGE_TILES);
      for (const footprintIndex of definition.footprintIndices) {
        const footprint = world.pointFromIndex(footprintIndex);
        for (let dy = -extent; dy <= extent; dy++) {
          for (let dx = -extent; dx <= extent; dx++) {
            if (Math.hypot(dx, dy) > ISLAND_DOSSIER_INTERACTION_RANGE_TILES) continue;
            const x = footprint.x + dx;
            const y = footprint.y + dy;
            if (!world.inBounds(x, y)) continue;
            const candidate = world.index(x, y);
            if (!world.isMovementBlockedAtIndex(candidate) && reachable[candidate]) {
              expect(approaches.has(candidate), `island ${definition.islandId} approach ${x},${y}`).toBe(true);
            }
          }
        }
      }
    }

    const large = definitions.find(({ size }) => size === IslandSize.Large);
    expect(large).toBeDefined();
    const largeApproaches = large?.approachIndices.map((index) => world.pointFromIndex(index)) ?? [];
    expect(largeApproaches.some(({ x }) => x < (large?.center.x ?? 0))).toBe(true);
    expect(largeApproaches.some(({ x }) => x > (large?.center.x ?? 0))).toBe(true);

    const atoll = definitions.find(({ kind }) => kind === IslandKind.Atoll);
    expect(atoll).toBeDefined();
    expect(atoll?.approachIndices).toContain(world.index(atoll!.center.x, atoll!.center.y));
  });

  it("excludes an isolated passable footprint cell while retaining reachable coast cells", () => {
    const world = new WorldGrid(7, 7, 4);
    world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
    world.setTerrain(3, 3, TerrainType.ShallowOcean);
    world.setIslandId(3, 3, 1);
    for (const [x, y] of [[2, 3], [4, 3], [3, 2], [3, 4]] as const) {
      world.setTerrain(x, y, TerrainType.Rock);
    }
    const island: GeneratedIsland = {
      id: 1,
      kind: IslandKind.HighIsland,
      size: IslandSize.Small,
      center: { x: 3, y: 3 },
      radiusX: 1,
      radiusY: 1,
      outerRadius: 1,
      rotation: 0,
      shapeSeed: 1,
      bounds: { minX: 3, minY: 3, maxX: 3, maxY: 3 },
    };

    const [definition] = generateIslandDossierCatalog(world, 7, [island], { x: 0, y: 0 });
    expect(definition.footprintIndices).toEqual([world.index(3, 3)]);
    expect(definition.approachIndices).not.toContain(world.index(3, 3));
    expect(definition.approachIndices).toEqual([
      world.index(2, 2),
      world.index(4, 2),
      world.index(2, 4),
      world.index(4, 4),
    ]);
  });

  it("rejects unsupported content versions without mutating the world", () => {
    const generated = new WorldGenerator(makeConfig()).generate(SEED);
    const knowledgeVersion = generated.grid.knowledgeVersion;
    const terrainVersion = generated.grid.terrainVersion;
    expect(() => generateIslandDossierCatalog(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
      ISLAND_DOSSIER_CONTENT_VERSION + 1,
    )).toThrow(/Unsupported island-dossier content version/);
    expect(generated.grid.knowledgeVersion).toBe(knowledgeVersion);
    expect(generated.grid.terrainVersion).toBe(terrainVersion);
  });
});

describe("island-dossier lifecycle", () => {
  it("keeps sighting free and the result structurally hidden until a successful survey", () => {
    const harness = generatedHarness();
    const definition = sightFirstIsland(harness);
    const budget = ampleBudget();

    expect(harness.system.recordsRevision).toBe(1);
    expect(harness.system.fogRevealRevision).toBe(0);
    expect(harness.system.revealedIslandIds).toEqual([]);
    const lead = harness.system.readModels()[0];
    expect(lead).toMatchObject({ islandId: definition.islandId, state: "sighted", name: definition.name });
    expect(lead).not.toHaveProperty("dossier");

    const interaction = harness.system.interactionNear(definition.canonicalApproach, budget);
    expect(interaction).toMatchObject({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      islandId: definition.islandId,
      state: "sighted",
      surveyCost: 2,
      availableProvisionUnits: 12,
      remainingProvisionUnits: 10,
      returnCost: 4.5,
      projectedReturnMargin: 5.5,
      canAfford: true,
    });
    expect(interaction).not.toHaveProperty("dossier");

    const result = harness.system.applyInteraction({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: definition.islandId,
    }, definition.canonicalApproach, 1, 1, budget);
    expect(result).toMatchObject({
      status: "surveyed",
      islandId: definition.islandId,
      name: definition.name,
      dossier: definition.dossier,
      provisionsSpent: 2,
      availableProvisionUnitsRemaining: 10,
    });
    expect(harness.system.revealedIslandIds).toEqual([definition.islandId]);
    expect(harness.system.fogRevealRevision).toBe(1);
    expect(harness.system.readModels()[0]).toMatchObject({
      state: "surveyed",
      dossier: definition.dossier,
    });

    const fogExemptIndices: number[] = [];
    const revealed = new Set(harness.system.revealedIslandIds);
    harness.generated.grid.forEachTile((_x, _y, index) => {
      if (revealed.has(harness.generated.grid.getIslandIdAtIndex(index))) fogExemptIndices.push(index);
    });
    expect(fogExemptIndices).toEqual(definition.footprintIndices);

    const revealRevision = harness.system.fogRevealRevision;
    const committed = harness.system.commitExpedition(1);
    expect(committed.leads).toEqual([]);
    expect(committed.dossiers).toEqual([expect.objectContaining({
      islandId: definition.islandId,
      state: "dossier",
    })]);
    expect(harness.system.provisional).toEqual([]);
    expect(harness.system.returned).toEqual([expect.objectContaining({ state: "dossier" })]);
    expect(harness.system.revealedIslandIds).toEqual([definition.islandId]);
    expect(harness.system.fogRevealRevision).toBe(revealRevision);
    expect(harness.system.commitExpedition(1)).toEqual({ leads: [], dossiers: [] });
  });

  it("supports a returned lead upgrade from any coastal approach and rolls it back cleanly", () => {
    const harness = generatedHarness();
    const definition = sightFirstIsland(harness);
    const leadCommit = harness.system.commitExpedition(1);
    expect(leadCommit.leads).toEqual([expect.objectContaining({ state: "lead" })]);
    expect(leadCommit.dossiers).toEqual([]);
    expect(harness.system.readModels()[0]).toMatchObject({ state: "returned-lead" });
    expect(harness.system.readModels()[0]).not.toHaveProperty("dossier");
    expect(harness.system.observeCurrentSight(2, 2, definition.footprintIndices).found).toEqual([]);

    const farApproachIndex = definition.approachIndices.reduce((selected, candidate) => {
      const selectedPoint = harness.generated.grid.pointFromIndex(selected);
      const candidatePoint = harness.generated.grid.pointFromIndex(candidate);
      const selectedDistance = Math.hypot(
        selectedPoint.x - definition.canonicalApproach.x,
        selectedPoint.y - definition.canonicalApproach.y,
      );
      const candidateDistance = Math.hypot(
        candidatePoint.x - definition.canonicalApproach.x,
        candidatePoint.y - definition.canonicalApproach.y,
      );
      return candidateDistance > selectedDistance ? candidate : selected;
    });
    const farApproach = harness.generated.grid.pointFromIndex(farApproachIndex);
    expect(harness.system.interactionNear(farApproach, ampleBudget())).toMatchObject({
      islandId: definition.islandId,
      state: "returned-lead",
      approachTile: farApproach,
    });

    expect(harness.system.applyInteraction({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: definition.islandId,
    }, farApproach, 2, 2, ampleBudget()).status).toBe("surveyed");
    expect(harness.system.returned).toEqual([expect.objectContaining({ state: "lead" })]);
    expect(harness.system.provisional).toEqual([expect.objectContaining({ state: "surveyed" })]);
    expect(harness.system.revealedIslandIds).toEqual([definition.islandId]);

    const lost = harness.system.revertExpedition(2);
    expect(lost).toEqual([expect.objectContaining({ state: "surveyed" })]);
    expect(harness.system.returned).toEqual([expect.objectContaining({ state: "lead" })]);
    expect(harness.system.provisional).toEqual([]);
    expect(harness.system.revealedIslandIds).toEqual([]);
    expect(harness.system.readModels()[0]).toMatchObject({ state: "returned-lead" });

    expect(harness.system.applyInteraction({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: definition.islandId,
    }, farApproach, 3, 3, ampleBudget()).status).toBe("surveyed");
    const dossierCommit = harness.system.commitExpedition(3);
    expect(dossierCommit.dossiers).toEqual([expect.objectContaining({
      state: "dossier",
      expeditionId: 3,
      generation: 3,
    })]);
    expect(harness.system.returned).toEqual([expect.objectContaining({ state: "dossier" })]);
    expect(harness.system.readModels()[0]).toMatchObject({ state: "returned-dossier" });
  });

  it("removes a failed expedition's fresh survey and permits a later rediscovery", () => {
    const harness = generatedHarness();
    const definition = sightFirstIsland(harness);
    expect(harness.system.applyInteraction({
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: definition.islandId,
    }, definition.canonicalApproach, 1, 1, ampleBudget()).status).toBe("surveyed");
    expect(harness.system.revertExpedition(1)).toEqual([expect.objectContaining({ state: "surveyed" })]);
    expect(harness.system.provisional).toEqual([]);
    expect(harness.system.returned).toEqual([]);
    expect(harness.system.revealedIslandIds).toEqual([]);
    expect(harness.system.observeCurrentSight(2, 2, [definition.footprintIndices[0]]).found).toEqual([
      expect.objectContaining({ islandId: definition.islandId, state: "sighted", expeditionId: 2 }),
    ]);
  });

  it("rejects stale, invalid, unaffordable and duplicate surveys without mutation", () => {
    const harness = generatedHarness();
    const definition = harness.definitions[0];
    const command: IslandDossierInteractionCommandV1 = {
      contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
      type: "survey",
      islandId: definition.islandId,
    };
    const revision = harness.system.recordsRevision;
    expect(harness.system.applyInteraction(
      command,
      definition.canonicalApproach,
      1,
      1,
      ampleBudget(),
    )).toMatchObject({ status: "rejected", reason: "not-sighted" });
    expect(harness.system.recordsRevision).toBe(revision);

    sightFirstIsland(harness);
    const sightedRevision = harness.system.recordsRevision;
    expect(harness.system.applyInteraction(
      command,
      harness.generated.landmarks.homeReturnTile,
      1,
      1,
      ampleBudget(),
    )).toMatchObject({ status: "rejected", reason: "out-of-range" });
    expect(harness.system.applyInteraction(
      command,
      definition.canonicalApproach,
      1,
      1,
      createSurveyBudget(2, 1, 4),
    )).toMatchObject({ status: "rejected", reason: "insufficient-provisions" });
    expect(harness.system.applyInteraction(
      { ...command, contractVersion: 99 } as unknown as IslandDossierInteractionCommandV1,
      definition.canonicalApproach,
      1,
      1,
      ampleBudget(),
    )).toMatchObject({ status: "rejected", reason: "unsupported-contract" });
    expect(harness.system.applyInteraction(
      { ...command, type: "leave" } as unknown as IslandDossierInteractionCommandV1,
      definition.canonicalApproach,
      1,
      1,
      ampleBudget(),
    )).toMatchObject({ status: "rejected", reason: "invalid-command" });
    expect(harness.system.applyInteraction(
      { ...command, islandId: 99_999 },
      definition.canonicalApproach,
      1,
      1,
      ampleBudget(),
    )).toMatchObject({ status: "rejected", reason: "unknown-island" });
    expect(harness.system.recordsRevision).toBe(sightedRevision);
    expect(harness.system.provisional).toEqual([expect.objectContaining({ state: "sighted" })]);

    expect(harness.system.applyInteraction(
      command,
      definition.canonicalApproach,
      1,
      1,
      ampleBudget(),
    ).status).toBe("surveyed");
    const surveyedRevision = harness.system.recordsRevision;
    expect(harness.system.applyInteraction(
      command,
      definition.canonicalApproach,
      1,
      1,
      ampleBudget(),
    )).toMatchObject({ status: "rejected", reason: "already-surveyed" });
    expect(harness.system.recordsRevision).toBe(surveyedRevision);
  });

  it("restores only valid lead/dossier state combinations and keeps failed restores atomic", () => {
    const harness = generatedHarness();
    const islandId = harness.definitions[0].islandId;
    const returnedLead: IslandDossierReturnedRecordV1 = {
      islandId,
      state: "lead",
      expeditionId: 1,
      generation: 1,
    };
    const provisionalSurvey: IslandDossierProvisionalRecordV1 = {
      islandId,
      state: "surveyed",
      expeditionId: 2,
      generation: 2,
    };
    harness.system.restore([provisionalSurvey], [returnedLead]);
    expect(harness.system.returned).toEqual([returnedLead]);
    expect(harness.system.provisional).toEqual([provisionalSurvey]);
    expect(harness.system.revealedIslandIds).toEqual([islandId]);

    const beforeProvisional = harness.system.provisional;
    const beforeReturned = harness.system.returned;
    expect(() => harness.system.restore([
      { ...provisionalSurvey, state: "sighted" },
    ], [returnedLead])).toThrow(/returned lead with a provisional survey/);
    expect(() => harness.system.restore([provisionalSurvey], [
      { ...returnedLead, state: "dossier" },
    ])).toThrow(/returned lead with a provisional survey/);
    expect(() => harness.system.restore([], [returnedLead, returnedLead])).toThrow(/duplicated/);
    expect(() => harness.system.restore([
      { ...provisionalSurvey, islandId: 99_999 },
    ], [])).toThrow(/regenerated catalog/);
    expect(() => harness.system.restore([
      { ...provisionalSurvey, state: "invalid" } as unknown as IslandDossierProvisionalRecordV1,
    ], [])).toThrow(/invalid provisional state/);
    expect(harness.system.provisional).toEqual(beforeProvisional);
    expect(harness.system.returned).toEqual(beforeReturned);
    expect(harness.system.revealedIslandIds).toEqual([islandId]);
  });
});
