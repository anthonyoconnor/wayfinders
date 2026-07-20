import { describe, expect, it } from "vitest";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  createFishingShoalId,
  type FishingShoalDefinition,
  type FishingShoalQuality,
  type FishingShoalReturnedRecordV1,
} from "../src/wayfinders/features/fishing/index.ts";
import {
  ProsperityTrafficRouteSystem,
} from "../src/wayfinders/features/prosperity/index.ts";
import {
  ISLAND_DOSSIER_CONTENT_VERSION,
  type IslandDossierDefinitionV1,
  type IslandDossierReturnedRecordV1,
  type IslandDossierTheme,
} from "../src/wayfinders/exploration/IslandDossierContracts.ts";
import { SupportedConnectivitySystem } from "../src/wayfinders/exploration/SupportedConnectivitySystem.ts";
import { IslandKind, IslandSize } from "../src/wayfinders/world/IslandGenerator.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import {
  BOUNDED_WORLD_TOPOLOGY,
  WRAPPING_WORLD_TOPOLOGY,
  type WorldTopologyDefinition,
} from "../src/wayfinders/world/WorldTopology.ts";

function supportedWorld(
  width: number,
  height: number,
  topology: Readonly<WorldTopologyDefinition> = BOUNDED_WORLD_TOPOLOGY,
): WorldGrid {
  const world = new WorldGrid(width, height, Math.max(width, height), topology);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
  return world;
}

function fishingDefinition(
  ordinal: number,
  tile: Readonly<{ x: number; y: number }>,
  serviceAnchor: Readonly<{ x: number; y: number }>,
  quality: FishingShoalQuality = "steady",
): Readonly<FishingShoalDefinition> {
  return Object.freeze({
    id: createFishingShoalId(ordinal),
    contentVersion: FISHING_SHOAL_CONTENT_VERSION,
    tile: Object.freeze({ ...tile }),
    serviceAnchor: Object.freeze({ ...serviceAnchor }),
    quality,
    clue: Object.freeze({ kind: "seabirds", intensity: 2, label: "Circling seabirds" }),
  });
}

function islandDefinition(
  world: WorldGrid,
  islandId: number,
  theme: IslandDossierTheme,
  approachIndices: readonly number[],
): Readonly<IslandDossierDefinitionV1> {
  const canonicalApproach = world.pointFromIndex(approachIndices[0]);
  return Object.freeze({
    contentVersion: ISLAND_DOSSIER_CONTENT_VERSION,
    islandId,
    name: `Island ${islandId}`,
    kind: IslandKind.HighIsland,
    size: IslandSize.Small,
    center: Object.freeze({ x: canonicalApproach.x, y: canonicalApproach.y }),
    footprintIndices: Object.freeze([approachIndices[0]]),
    approachIndices: Object.freeze([...approachIndices]),
    canonicalApproach: Object.freeze(canonicalApproach),
    dossier: Object.freeze({
      theme,
      findingLabel: `${theme} finding`,
      detail: `${theme} detail`,
      developerArtId: `developer:test:${theme}`,
    }),
  });
}

function returnedFishing(
  definition: Readonly<FishingShoalDefinition>,
  state: FishingShoalReturnedRecordV1["state"] = "survey",
): Readonly<FishingShoalReturnedRecordV1> {
  return Object.freeze({ id: definition.id, state, expeditionId: 1, generation: 1 });
}

function returnedIsland(
  definition: Readonly<IslandDossierDefinitionV1>,
  state: IslandDossierReturnedRecordV1["state"] = "dossier",
): Readonly<IslandDossierReturnedRecordV1> {
  return Object.freeze({ islandId: definition.islandId, state, expeditionId: 1, generation: 1 });
}

describe("ProsperityTrafficRouteSystem", () => {
  it("rejects connectivity authority from a different world", () => {
    const world = supportedWorld(5, 3);
    const otherWorld = supportedWorld(5, 3);
    const connectivity = new SupportedConnectivitySystem(otherWorld, { x: 0, y: 0 });

    expect(() => new ProsperityTrafficRouteSystem(
      world,
      connectivity,
      [],
      [],
    )).toThrow("Prosperity traffic connectivity must use the same world");
  });

  it("publishes stable fishing-first routes only for returned surveys and community dossiers", () => {
    const world = supportedWorld(7, 3);
    const connectivity = new SupportedConnectivitySystem(world, { x: 0, y: 1 });
    const fishingOne = fishingDefinition(1, { x: 6, y: 0 }, { x: 6, y: 0 }, "rich");
    const fishingTwo = fishingDefinition(2, { x: 1, y: 0 }, { x: 1, y: 0 }, "lean");
    const fishingLead = fishingDefinition(0, { x: 3, y: 2 }, { x: 3, y: 2 });
    const communityNine = islandDefinition(world, 9, "community", [
      world.index(5, 1),
      world.index(4, 1),
    ]);
    const communityFour = islandDefinition(world, 4, "community", [
      world.index(1, 2),
      world.index(1, 0),
    ]);
    const anchorage = islandDefinition(world, 3, "anchorage", [world.index(2, 1)]);
    const system = new ProsperityTrafficRouteSystem(
      world,
      connectivity,
      [fishingTwo, fishingLead, fishingOne],
      [communityNine, anchorage, communityFour],
    );

    const result = system.refresh(
      {
        fishingRecordsRevision: 3,
        islandDossierRecordsRevision: 4,
        supportedTopologyRevision: world.supportedTopologyVersion,
      },
      [returnedFishing(fishingTwo), returnedFishing(fishingLead, "lead"), returnedFishing(fishingOne)],
      [returnedIsland(communityNine), returnedIsland(anchorage), returnedIsland(communityFour)],
    );

    expect(result.routes.map(({ id }) => id)).toEqual([
      `prosperity-traffic:v1:fishing:${fishingOne.id}`,
      `prosperity-traffic:v1:fishing:${fishingTwo.id}`,
      "prosperity-traffic:v1:trade:island:4",
      "prosperity-traffic:v1:trade:island:9",
    ]);
    expect(result.fishingRoutes.map(({ fishingShoalId }) => fishingShoalId)).toEqual([
      fishingOne.id,
      fishingTwo.id,
    ]);
    expect(result.fishingRoutes[0].destinationTile).toEqual(fishingOne.serviceAnchor);
    expect(result.tradeRoutes.map(({ islandId }) => islandId)).toEqual([4, 9]);
    // Both Island 4 approaches are equally short, so the lower canonical index wins.
    expect(result.tradeRoutes[0].destinationIndex).toBe(world.index(1, 0));
    expect(result.routes.every((route) => Object.isFrozen(route))).toBe(true);
    expect(result.routes.every((route) => Object.isFrozen(route.pathIndices))).toBe(true);
    expect(connectivity.buildCount).toBe(1);
  });

  it("preserves direction and lifted edge offsets across a wrapping seam", () => {
    const world = supportedWorld(4, 1, WRAPPING_WORLD_TOPOLOGY);
    const connectivity = new SupportedConnectivitySystem(world, { x: 0, y: 0 });
    const fishing = fishingDefinition(0, { x: 3, y: 0 }, { x: 3, y: 0 });
    const system = new ProsperityTrafficRouteSystem(world, connectivity, [fishing], []);

    const result = system.refresh(
      {
        fishingRecordsRevision: 1,
        islandDossierRecordsRevision: 0,
        supportedTopologyRevision: world.supportedTopologyVersion,
      },
      [returnedFishing(fishing)],
      [],
    );

    expect(result.fishingRoutes[0].pathIndices).toEqual([
      world.index(0, 0),
      world.index(3, 0),
    ]);
    expect(result.fishingRoutes[0].pathEdges).toEqual([{
      fromIndex: world.index(0, 0),
      toIndex: world.index(3, 0),
      direction: 0,
      imageOffset: { x: -4, y: 0 },
      destinationImageOffset: { x: -4, y: 0 },
      liftedFrom: { x: 0, y: 0 },
      liftedTo: { x: -1, y: 0 },
    }]);
    expect(Object.isFrozen(result.fishingRoutes[0].pathEdges[0])).toBe(true);
    expect(Object.isFrozen(result.fishingRoutes[0].pathEdges[0].imageOffset)).toBe(true);
  });

  it("caches the three source revisions and advances only when route content changes", () => {
    const world = supportedWorld(5, 1);
    const connectivity = new SupportedConnectivitySystem(world, { x: 0, y: 0 });
    const fishing = fishingDefinition(0, { x: 2, y: 0 }, { x: 2, y: 0 });
    const community = islandDefinition(world, 1, "community", [world.index(4, 0)]);
    const fishingRecords = [returnedFishing(fishing)];
    const islandRecords = [returnedIsland(community)];
    const system = new ProsperityTrafficRouteSystem(
      world,
      connectivity,
      [fishing],
      [community],
    );
    const initialKey = {
      fishingRecordsRevision: 1,
      islandDossierRecordsRevision: 1,
      supportedTopologyRevision: world.supportedTopologyVersion,
    };

    const initial = system.refresh(initialKey, fishingRecords, islandRecords);
    expect(initial.revision).toBe(1);
    expect(initial.routes).toHaveLength(2);
    expect(system.refresh(initialKey, [], [])).toBe(initial);
    expect(connectivity.buildCount).toBe(1);

    const irrelevantRecordRevision = system.refresh(
      { ...initialKey, fishingRecordsRevision: 2 },
      fishingRecords,
      islandRecords,
    );
    expect(irrelevantRecordRevision).toBe(initial);
    expect(connectivity.buildCount).toBe(1);

    world.setKnowledge(1, 0, KnowledgeState.Unknown);
    const disconnected = system.refresh(
      {
        fishingRecordsRevision: 2,
        islandDossierRecordsRevision: 1,
        supportedTopologyRevision: world.supportedTopologyVersion,
      },
      fishingRecords,
      islandRecords,
    );
    expect(disconnected.revision).toBe(2);
    expect(disconnected.routes).toEqual([]);
    expect(connectivity.buildCount).toBe(2);

    const regenerated = new ProsperityTrafficRouteSystem(
      world,
      new SupportedConnectivitySystem(world, { x: 0, y: 0 }),
      [fishing],
      [community],
    );
    expect(regenerated.readModel.revision).toBe(0);
    expect(regenerated.readModel.routes).toEqual([]);
  });

  it("rejects invalid revisions and inconsistent returned-record catalogs", () => {
    const world = supportedWorld(3, 1);
    const fishing = fishingDefinition(0, { x: 2, y: 0 }, { x: 2, y: 0 });
    const system = new ProsperityTrafficRouteSystem(
      world,
      new SupportedConnectivitySystem(world, { x: 0, y: 0 }),
      [],
      [],
    );

    expect(() => system.refresh(
      {
        fishingRecordsRevision: -1,
        islandDossierRecordsRevision: 0,
        supportedTopologyRevision: world.supportedTopologyVersion,
      },
      [],
      [],
    )).toThrow(RangeError);
    expect(() => system.refresh(
      {
        fishingRecordsRevision: 1,
        islandDossierRecordsRevision: 0,
        supportedTopologyRevision: world.supportedTopologyVersion,
      },
      [returnedFishing(fishing)],
      [],
    )).toThrow(`Returned fishing shoal ${fishing.id} has no definition`);
  });
});
