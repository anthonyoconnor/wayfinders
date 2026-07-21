import { describe, expect, it } from "vitest";
import {
  compileAuthoredMapV1,
  withAuthoredMapContentFingerprintV1,
  type CompiledAuthoredMapV1,
} from "../src/wayfinders/app/authoredMaps";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import type { GridPoint } from "../src/wayfinders/core/types";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  authoredFishingShoalPlacementRejectionV1,
  createAuthoredFishingShoalV1,
  createCurrentAuthoredFishingLayoutV1,
  createFishingShoalId,
} from "../src/wayfinders/features/fishing";
import { ISLAND_DOSSIER_CONTRACT_VERSION } from "../src/wayfinders/exploration/IslandDossierContracts";
import { SURVEY_SITE_CONTRACT_VERSION } from "../src/wayfinders/exploration/SurveySiteContracts";
import { PROSPERITY_SCORE_SCHEDULE_V1 } from "../src/wayfinders/features/prosperity";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph";
import type { PrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { createWorldProfileConfig } from "./fixtures/worldProfiles";
import {
  authoredMapTestCollisionCatalog,
  createValidAuthoredMapFixture,
} from "./fixtures/authoredMap";

async function addValidAuthoredShoal(
  compiled: Readonly<CompiledAuthoredMapV1>,
  config: PrototypeConfig,
): Promise<Readonly<CompiledAuthoredMapV1>> {
  const home = compiled.generated.landmarks.homeReturnTile;
  let tile: GridPoint | undefined;
  let greatestDistance = -1;
  compiled.generated.grid.forEachTile((x, y) => {
    const candidate = { x, y };
    if (authoredFishingShoalPlacementRejectionV1(
      compiled.generated.grid,
      compiled.generated.analysis,
      home,
      candidate,
    )) return;
    const distance = compiled.generated.grid.topology.minimumImageTileDistanceSquared(home, candidate);
    if (distance <= greatestDistance) return;
    greatestDistance = distance;
    tile = candidate;
  });
  if (!tile) throw new Error("Expected a valid authored fishing-shoal tile");

  const id = createFishingShoalId(37);
  const { contentFingerprint: _oldFingerprint, ...definitionInput } = compiled.definition;
  const definition = await withAuthoredMapContentFingerprintV1({
    ...definitionInput,
    fishing: createCurrentAuthoredFishingLayoutV1([
      createAuthoredFishingShoalV1(compiled.generated.seed, id, tile, "rich"),
    ]),
  });
  const result = compileAuthoredMapV1(definition, {
    config,
    availableAuthoredIslandCatalog: authoredMapTestCollisionCatalog(),
  });
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result.value;
}

function teleportAlongNavigablePath(
  simulation: GameSimulation,
  target: Readonly<GridPoint>,
): void {
  const graph = new GridGraph(simulation.world, simulation.config);
  const start = simulation.world.index(simulation.ship.currentTileX, simulation.ship.currentTileY);
  const goal = simulation.world.index(target.x, target.y);
  const unvisited = -2;
  const parents = new Int32Array(simulation.world.tileCount);
  const queue = new Int32Array(simulation.world.tileCount);
  parents.fill(unvisited);
  parents[start] = -1;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail && parents[goal] === unvisited) {
    const current = queue[head++]!;
    graph.forEachTraversableCardinalEdge(current, (neighbor) => {
      if (parents[neighbor] !== unvisited) return;
      parents[neighbor] = current;
      queue[tail++] = neighbor;
    });
  }
  if (parents[goal] === unvisited) throw new Error("Expected an authored-map navigation path");
  const route: number[] = [];
  for (let index = goal; index !== start; index = parents[index]!) route.push(index);
  route.reverse();
  for (const index of route) {
    expect(simulation.teleport(simulation.world.pointFromIndex(index))).toBe(true);
  }
}

describe("authored map GameSimulation source", () => {
  it("restarts fresh gameplay from the same exact map fingerprint", async () => {
    const config = createWorldProfileConfig("P0");
    const baseFixture = await createValidAuthoredMapFixture(config);
    const authoredCompiled = await addValidAuthoredShoal(baseFixture.compiled, config);
    const authoredDefinition = authoredCompiled.definition;
    let first: typeof authoredCompiled | undefined = authoredCompiled;
    let compileCount = 0;
    const simulation = new GameSimulation(config, undefined, {
      authoredIslandCatalog: authoredCompiled.collisionCatalog,
      authoredMapSource: {
        identity: authoredCompiled.sourceIdentity,
        catalogRepositoryRevision: 9,
        compileFresh: () => {
          compileCount++;
          if (first) {
            const compiled = first;
            first = undefined;
            return compiled;
          }
          const result = compileAuthoredMapV1(authoredDefinition, {
            config,
            availableAuthoredIslandCatalog: authoredMapTestCollisionCatalog(),
          });
          if (!result.ok) throw new Error(result.diagnostics[0]?.message);
          return result.value;
        },
      },
    });
    const originalWorld = simulation.world;
    const originalSource = simulation.sourceIdentity;
    simulation.setProvisions(1);

    simulation.restartCurrentSource(999_999);

    expect(compileCount).toBe(2);
    expect(simulation.world).not.toBe(originalWorld);
    expect(simulation.sourceIdentity).toEqual(originalSource);
    expect(simulation.sourceIdentity).toMatchObject({
      kind: "authored-map",
      mapId: authoredDefinition.id,
      contentFingerprint: authoredDefinition.contentFingerprint,
      catalogRepositoryRevision: 9,
    });
    expect(simulation.generated.seed).toBe(authoredDefinition.world.baseSeed);
    expect(simulation.ship.provisions).toBe(config.provisions.startingBundles);
    expect(simulation.atDock).toBe(true);
    expect(simulation.fishingShoalDefinitions).toHaveLength(1);
    expect(simulation.snapshot().source).toEqual(simulation.sourceIdentity);

    const [authoredShoal] = simulation.fishingShoalDefinitions;
    expect(authoredShoal.serviceAnchor).toBe(authoredShoal.tile);
    teleportAlongNavigablePath(simulation, authoredShoal.serviceAnchor);
    expect(simulation.provisionalFishingShoals).toContainEqual(expect.objectContaining({
      id: authoredShoal.id,
      state: "sighted",
    }));
    expect(simulation.interactWithFishingShoal({
      contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
      type: "survey",
      id: authoredShoal.id,
    })).toMatchObject({ status: "surveyed", id: authoredShoal.id, quality: "rich" });
    expect(simulation.prosperityScoreSnapshot.score).toBe(0);
    teleportAlongNavigablePath(simulation, simulation.generated.landmarks.homeReturnTile);
    expect(simulation.returnedFishingShoals).toContainEqual(expect.objectContaining({
      id: authoredShoal.id,
      state: "survey",
    }));
    expect(simulation.prosperityScoreSnapshot.ledger).toContainEqual(expect.objectContaining({
      kind: "fishing-shoal",
      sourceId: authoredShoal.id,
      value: PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.surveyByQuality.rich,
    }));
    expect(simulation.prosperityTrafficRoutes.fishingRoutes).toContainEqual(expect.objectContaining({
      fishingShoalId: authoredShoal.id,
      shoalTile: authoredShoal.tile,
    }));

    for (const location of simulation.idolLocationDefinitions) {
      const host = location.host;
      if (host.kind === "island-dossier") {
        const islandId = host.islandId;
        const dossier = simulation.islandDossierDefinitions.find(
          (definition) => definition.islandId === islandId,
        );
        if (!dossier) throw new Error("Missing authored-map idol dossier host");
        expect(simulation.teleport(dossier.canonicalApproach)).toBe(true);
        expect(simulation.interactWithIslandDossier({
          contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
          type: "survey",
          islandId: dossier.islandId,
        }).status).toBe("surveyed");
      } else {
        const surveySiteId = host.surveySiteId;
        const site = simulation.surveySiteDefinitions.find(
          ({ id }) => id === surveySiteId,
        );
        if (!site) throw new Error("Missing authored-map idol survey-site host");
        expect(simulation.teleport(site.serviceAnchor)).toBe(true);
        expect(simulation.interactWithSurveySite({
          contractVersion: SURVEY_SITE_CONTRACT_VERSION,
          type: "survey",
          id: site.id,
        }).status).toBe("surveyed");
      }
    }
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.completionChoiceActive).toBe(true);
    expect(simulation.startNewGame()).toBe(authoredDefinition.world.baseSeed);
    expect(simulation.sourceIdentity).toEqual(originalSource);
    expect(simulation.atDock).toBe(true);
    expect(simulation.returnedIdolLocations).toEqual([]);
  }, 15_000);

  it("leaves the current simulation untouched when a fresh compile fails", async () => {
    const config = createWorldProfileConfig("P0");
    const fixture = await createValidAuthoredMapFixture(config, "atomic-restart");
    let calls = 0;
    const simulation = new GameSimulation(config, undefined, {
      authoredIslandCatalog: fixture.compiled.collisionCatalog,
      authoredMapSource: {
        identity: fixture.compiled.sourceIdentity,
        catalogRepositoryRevision: 1,
        compileFresh: () => {
          calls++;
          if (calls === 1) return fixture.compiled;
          throw new Error("captured authored input became stale");
        },
      },
    });
    const world = simulation.world;
    const ship = simulation.ship;
    const revision = simulation.revision;

    expect(() => simulation.restartCurrentSource()).toThrow(/became stale/u);
    expect(simulation.world).toBe(world);
    expect(simulation.ship).toBe(ship);
    expect(simulation.revision).toBe(revision);
  });
});
