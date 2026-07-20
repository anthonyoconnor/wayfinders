import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import type { GridPoint } from "../src/wayfinders/core/types";
import {
  FISHING_SHOAL_CONTRACT_VERSION,
  type FishingShoalDefinition,
} from "../src/wayfinders/features/fishing";
import {
  ISLAND_DOSSIER_CONTRACT_VERSION,
  type IslandDossierDefinitionV1,
} from "../src/wayfinders/exploration/IslandDossierContracts";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph";
import { KnowledgeState } from "../src/wayfinders/world/TileData";
import { configurePrototypeForTestProfile } from "./helpers";

beforeEach(() => configurePrototypeForTestProfile());
afterEach(() => resetPrototypeConfig());

function teleportAlongNavigablePath(
  simulation: GameSimulation,
  target: Readonly<GridPoint>,
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
    const current = queue[head++]!;
    graph.forEachTraversableCardinalEdge(current, (neighbor) => {
      if (parents[neighbor] !== unvisited) return;
      parents[neighbor] = current;
      queue[tail++] = neighbor;
    });
  }
  if (parents[goal] === unvisited) throw new Error("Expected a navigable developer journey");

  const route: number[] = [];
  for (let index = goal; index !== start; index = parents[index]!) route.push(index);
  route.reverse();
  for (const index of route) {
    expect(simulation.teleport(simulation.world.pointFromIndex(index))).toBe(true);
  }
}

function farthestFishingShoal(simulation: GameSimulation): Readonly<FishingShoalDefinition> {
  const home = simulation.generated.landmarks.homeReturnTile;
  const target = [...simulation.fishingShoalDefinitions].sort((left, right) => (
    simulation.world.topology.minimumImageTileDistanceSquared(home, right.serviceAnchor)
      - simulation.world.topology.minimumImageTileDistanceSquared(home, left.serviceAnchor)
      || left.id.localeCompare(right.id)
  ))[0];
  if (!target) throw new Error("Expected a generated fishing shoal");
  return target;
}

function surveyFishing(
  simulation: GameSimulation,
  target: Readonly<FishingShoalDefinition>,
) {
  return simulation.interactWithFishingShoal({
    contractVersion: FISHING_SHOAL_CONTRACT_VERSION,
    type: "survey",
    id: target.id,
  });
}

function dossierByTheme(
  simulation: GameSimulation,
  predicate: (definition: Readonly<IslandDossierDefinitionV1>) => boolean,
): Readonly<IslandDossierDefinitionV1> {
  const definition = simulation.islandDossierDefinitions.find(predicate);
  if (!definition) throw new Error("Expected a generated island dossier with the requested theme");
  return definition;
}

function surveyIsland(
  simulation: GameSimulation,
  target: Readonly<IslandDossierDefinitionV1>,
) {
  return simulation.interactWithIslandDossier({
    contractVersion: ISLAND_DOSSIER_CONTRACT_VERSION,
    type: "survey",
    islandId: target.islandId,
  });
}

describe("GameSimulation prosperity traffic integration", () => {
  it("keeps provisional sightings and returned fishing leads out of traffic routes", () => {
    const simulation = new GameSimulation();
    const target = farthestFishingShoal(simulation);

    teleportAlongNavigablePath(simulation, target.serviceAnchor);
    expect(simulation.provisionalFishingShoals).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "sighted",
    }));
    expect(simulation.prosperityTrafficRoutes.routes).toEqual([]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.returnedFishingShoals).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "lead",
    }));
    expect(simulation.prosperityTrafficRoutes.fishingRoutes).toEqual([]);
  });

  it("publishes a safe fishing route in the exact-dock settlement and shares one connectivity flood", () => {
    const simulation = new GameSimulation();
    const target = farthestFishingShoal(simulation);

    teleportAlongNavigablePath(simulation, target.serviceAnchor);
    expect(surveyFishing(simulation, target)).toMatchObject({
      status: "surveyed",
      id: target.id,
    });
    expect(simulation.prosperityTrafficRoutes.routes).toEqual([]);
    expect(simulation.fishingShoalConnectivityBuildCount).toBe(0);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const traffic = simulation.prosperityTrafficRoutes;
    expect(traffic.fishingRoutes).toHaveLength(1);
    const [route] = traffic.fishingRoutes;
    expect(route).toMatchObject({
      fishingShoalId: target.id,
      destinationIndex: simulation.world.index(
        target.serviceAnchor.x,
        target.serviceAnchor.y,
      ),
    });
    expect(route.pathIndices[0]).toBe(simulation.world.index(
      simulation.generated.landmarks.homeReturnTile.x,
      simulation.generated.landmarks.homeReturnTile.y,
    ));
    const graph = new GridGraph(simulation.world, simulation.config);
    for (const index of route.pathIndices) {
      expect(simulation.world.getKnowledgeAtIndex(index)).toBe(KnowledgeState.Supported);
      expect(graph.isNavigationNodePassable(index)).toBe(true);
    }
    for (const edge of route.pathEdges) {
      expect(graph.canTraverseCardinalDirection(edge.fromIndex, edge.direction)).toBe(true);
      expect(edge.toIndex).toBe(graph.cardinalEdge(edge.fromIndex, edge.direction)?.neighborIndex);
    }

    expect(simulation.fishingShoalConnectivityBuildCount).toBe(1);
    expect(simulation.activationEligibleFishingShoals).toEqual([
      expect.objectContaining({ id: target.id, state: "survey" }),
    ]);
    expect(simulation.prosperityTrafficRoutes).toBe(traffic);
    expect(simulation.fishingShoalConnectivityBuildCount).toBe(1);

    simulation.regenerate(simulation.generated.seed);
    expect(simulation.prosperityTrafficRoutes.routes).toEqual([]);
    expect(simulation.fishingShoalConnectivityBuildCount).toBe(0);
  });

  it("does not create traffic from a survey lost with a failed expedition", () => {
    const simulation = new GameSimulation();
    const target = farthestFishingShoal(simulation);

    teleportAlongNavigablePath(simulation, target.serviceAnchor);
    expect(surveyFishing(simulation, target).status).toBe("surveyed");
    expect(simulation.forceWreck()).toBe(true);

    expect(simulation.provisionalFishingShoals).toEqual([]);
    expect(simulation.returnedFishingShoals).toEqual([]);
    expect(simulation.prosperityTrafficRoutes.routes).toEqual([]);
    expect(simulation.fishingShoalConnectivityBuildCount).toBe(0);
  });

  it("creates trade only for a returned community dossier", () => {
    const simulation = new GameSimulation();
    const community = dossierByTheme(
      simulation,
      ({ dossier }) => dossier.theme === "community",
    );
    const nonCommunity = dossierByTheme(
      simulation,
      ({ dossier }) => dossier.theme !== "community",
    );

    teleportAlongNavigablePath(simulation, community.canonicalApproach);
    expect(surveyIsland(simulation, community).status).toBe("surveyed");
    teleportAlongNavigablePath(simulation, nonCommunity.canonicalApproach);
    expect(surveyIsland(simulation, nonCommunity).status).toBe("surveyed");
    expect(simulation.prosperityTrafficRoutes.tradeRoutes).toEqual([]);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.returnedIslandDossiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ islandId: community.islandId, state: "dossier" }),
      expect.objectContaining({ islandId: nonCommunity.islandId, state: "dossier" }),
    ]));
    expect(simulation.prosperityTrafficRoutes.tradeRoutes).toEqual([
      expect.objectContaining({
        islandId: community.islandId,
        dossierTheme: "community",
      }),
    ]);
  });

  it("activates a returned but disconnected fishing target after a later Supported connection", () => {
    const simulation = new GameSimulation();
    const target = farthestFishingShoal(simulation);

    // A direct developer jump reveals and returns only the remote sight area,
    // deliberately leaving no continuous Supported route home.
    expect(simulation.teleport(target.serviceAnchor)).toBe(true);
    expect(surveyFishing(simulation, target).status).toBe("surveyed");
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.returnedFishingShoals).toContainEqual(expect.objectContaining({
      id: target.id,
      state: "survey",
    }));
    expect(simulation.prosperityTrafficRoutes.fishingRoutes).toEqual([]);

    teleportAlongNavigablePath(simulation, target.serviceAnchor);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.prosperityTrafficRoutes.fishingRoutes).toEqual([
      expect.objectContaining({ fishingShoalId: target.id }),
    ]);
  });
});
