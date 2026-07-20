import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  createFishingShoalId,
  type FishingShoalDefinition,
  type FishingShoalReturnedRecordV1,
} from "../../src/wayfinders/features/fishing/index.ts";
import { ProsperityTrafficRouteSystem } from "../../src/wayfinders/features/prosperity/index.ts";
import {
  ISLAND_DOSSIER_CONTENT_VERSION,
  type IslandDossierDefinitionV1,
  type IslandDossierReturnedRecordV1,
  type IslandDossierTheme,
} from "../../src/wayfinders/exploration/IslandDossierContracts.ts";
import { SupportedConnectivitySystem } from "../../src/wayfinders/exploration/SupportedConnectivitySystem.ts";
import { IslandKind, IslandSize } from "../../src/wayfinders/world/IslandGenerator.ts";
import { KnowledgeState, TerrainType } from "../../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../../src/wayfinders/world/WorldGrid.ts";
import { WORLD_PROFILES } from "../fixtures/worldProfiles.ts";

const SPARSE_COLD_REFRESH_BUDGET_MS = 80;
const DENSE_COLD_REFRESH_BUDGET_MS = 225;
const CACHE_HIT_P95_BUDGET_MS = 2;
const COLD_SAMPLES = 20;
const CACHE_HIT_WARMUPS = 50;
const CACHE_HIT_SAMPLES = 500;
const FISHING_ROUTE_COUNT = 4;
const COMMUNITY_ROUTE_COUNT = 20;
const NON_COMMUNITY_DOSSIER_COUNT = 8;

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function fishingDefinition(
  ordinal: number,
  tile: Readonly<{ x: number; y: number }>,
): Readonly<FishingShoalDefinition> {
  return Object.freeze({
    id: createFishingShoalId(ordinal),
    contentVersion: FISHING_SHOAL_CONTENT_VERSION,
    tile: Object.freeze({ ...tile }),
    serviceAnchor: Object.freeze({ ...tile }),
    quality: ordinal % 3 === 0 ? "lean" : ordinal % 3 === 1 ? "steady" : "rich",
    clue: Object.freeze({
      kind: "seabirds",
      intensity: 2,
      label: `P2 fishing sign ${ordinal}`,
    }),
  });
}

function islandDefinition(
  world: WorldGrid,
  islandId: number,
  theme: IslandDossierTheme,
  x: number,
  y: number,
): Readonly<IslandDossierDefinitionV1> {
  const approachIndices = Object.freeze([
    world.index(x, y),
    world.index((x + 1) % world.width, y),
    world.index(x, (y + 1) % world.height),
  ].sort((left, right) => left - right));
  const canonicalApproach = Object.freeze(world.pointFromIndex(approachIndices[0]!));
  return Object.freeze({
    contentVersion: ISLAND_DOSSIER_CONTENT_VERSION,
    islandId,
    name: `P2 Island ${islandId}`,
    kind: IslandKind.HighIsland,
    size: IslandSize.Small,
    center: canonicalApproach,
    footprintIndices: Object.freeze([approachIndices[0]!]),
    approachIndices,
    canonicalApproach,
    dossier: Object.freeze({
      theme,
      findingLabel: `${theme} finding`,
      detail: `${theme} detail`,
      developerArtId: `developer:performance:${theme}`,
    }),
  });
}

function supportRoute(
  world: WorldGrid,
  home: Readonly<{ x: number; y: number }>,
  destination: Readonly<{ x: number; y: number }>,
): void {
  const stepX = destination.x < home.x ? -1 : 1;
  for (let x = home.x; x !== destination.x; x += stepX) {
    world.setKnowledge(x, home.y, KnowledgeState.Supported);
  }
  const stepY = destination.y < home.y ? -1 : 1;
  for (let y = home.y; y !== destination.y; y += stepY) {
    world.setKnowledge(destination.x, y, KnowledgeState.Supported);
  }
  world.setKnowledge(destination.x, destination.y, KnowledgeState.Supported);
}

describe("PRS-2.1 Prosperity traffic route budget", () => {
  it.each([
    ["sparse-route", KnowledgeState.Unknown, SPARSE_COLD_REFRESH_BUDGET_MS],
    ["dense-late-game", KnowledgeState.Supported, DENSE_COLD_REFRESH_BUDGET_MS],
  ] as const)("keeps the %s P2 refresh and cache hits within their accepted budgets", (
    scenario,
    initialKnowledge,
    coldRefreshBudgetMs,
  ) => {
    const profile = WORLD_PROFILES.P2;
    const world = new WorldGrid(
      profile.dimensions.width,
      profile.dimensions.height,
      profile.config.navigation.chunkSize,
      profile.topology,
    );
    world.fill(TerrainType.DeepOcean, initialKnowledge);
    const homeReturnTile = Object.freeze({ x: 16, y: 16 });
    world.setKnowledge(homeReturnTile.x, homeReturnTile.y, KnowledgeState.Supported);

    const fishingDefinitions = Object.freeze(Array.from(
      { length: FISHING_ROUTE_COUNT },
      (_, ordinal) => fishingDefinition(ordinal, {
        x: 47 + ordinal * 41,
        y: 31 + ordinal * 11,
      }),
    ));
    const islandDefinitions = Object.freeze(Array.from(
      { length: COMMUNITY_ROUTE_COUNT + NON_COMMUNITY_DOSSIER_COUNT },
      (_, offset) => {
        const islandId = offset + 1;
        return islandDefinition(
          world,
          islandId,
          offset < COMMUNITY_ROUTE_COUNT ? "community" : "anchorage",
          29 + (offset % 14) * 19,
          43 + Math.floor(offset / 14) * 31,
        );
      },
    ));
    if (initialKnowledge === KnowledgeState.Unknown) {
      for (const definition of fishingDefinitions) {
        supportRoute(world, homeReturnTile, definition.serviceAnchor);
      }
      for (const definition of islandDefinitions.slice(0, COMMUNITY_ROUTE_COUNT)) {
        for (const approachIndex of definition.approachIndices) {
          supportRoute(world, homeReturnTile, world.pointFromIndex(approachIndex));
        }
      }
    }
    const returnedFishing = Object.freeze(fishingDefinitions.map((definition, index) => Object.freeze({
      id: definition.id,
      state: "survey" as const,
      expeditionId: index + 1,
      generation: 1,
    }) satisfies FishingShoalReturnedRecordV1));
    const returnedIslands = Object.freeze(islandDefinitions.map((definition, index) => Object.freeze({
      islandId: definition.islandId,
      state: "dossier" as const,
      expeditionId: index + 1,
      generation: 1,
    }) satisfies IslandDossierReturnedRecordV1));
    const refreshKey = Object.freeze({
      fishingRecordsRevision: 1,
      islandDossierRecordsRevision: 1,
      supportedTopologyRevision: world.supportedTopologyVersion,
    });
    const createFixture = () => {
      const connectivity = new SupportedConnectivitySystem(
        world,
        homeReturnTile,
        profile.config,
      );
      return {
        connectivity,
        routes: new ProsperityTrafficRouteSystem(
          world,
          connectivity,
          fishingDefinitions,
          islandDefinitions,
        ),
      };
    };

    // Rehearse the same cold-cache work once so module loading and JIT setup do
    // not masquerade as route-planning cost in the measured distribution.
    const rehearsal = createFixture();
    rehearsal.routes.refresh(refreshKey, returnedFishing, returnedIslands);
    expect(rehearsal.connectivity.buildCount).toBe(1);

    const coldDurations: number[] = [];
    const coldBuildCounts: number[] = [];
    let cachedFixture: ReturnType<typeof createFixture> | undefined;
    let cachedReadModel: ReturnType<ProsperityTrafficRouteSystem["refresh"]> | undefined;
    for (let sample = 0; sample < COLD_SAMPLES; sample++) {
      const fixture = createFixture();
      const startedAt = performance.now();
      const readModel = fixture.routes.refresh(refreshKey, returnedFishing, returnedIslands);
      coldDurations.push(performance.now() - startedAt);
      coldBuildCounts.push(fixture.connectivity.buildCount);
      expect(readModel.routes).toHaveLength(FISHING_ROUTE_COUNT + COMMUNITY_ROUTE_COUNT);
      if (sample === 0) {
        cachedFixture = fixture;
        cachedReadModel = readModel;
      }
    }
    if (!cachedFixture || !cachedReadModel) throw new Error("P2 traffic cache fixture was not retained");

    for (let warmup = 0; warmup < CACHE_HIT_WARMUPS; warmup++) {
      expect(cachedFixture.routes.refresh(refreshKey, returnedFishing, returnedIslands)).toBe(cachedReadModel);
    }
    const cacheHitDurations: number[] = [];
    let stableIdentity = true;
    for (let sample = 0; sample < CACHE_HIT_SAMPLES; sample++) {
      const startedAt = performance.now();
      const hit = cachedFixture.routes.refresh(refreshKey, returnedFishing, returnedIslands);
      cacheHitDurations.push(performance.now() - startedAt);
      stableIdentity &&= hit === cachedReadModel;
    }

    const coldP95 = percentile(coldDurations, 0.95);
    const cacheHitP95 = percentile(cacheHitDurations, 0.95);
    const evidence = {
      profile: profile.id,
      scenario,
      dimensions: profile.dimensions,
      returnedRecords: returnedFishing.length + returnedIslands.length,
      publishedRoutes: cachedReadModel.routes.length,
      coldSamples: COLD_SAMPLES,
      coldP95Ms: coldP95,
      coldBudgetMs: coldRefreshBudgetMs,
      cacheHitSamples: CACHE_HIT_SAMPLES,
      cacheHitP95Ms: cacheHitP95,
      cacheHitBudgetMs: CACHE_HIT_P95_BUDGET_MS,
    };
    console.info(`[prosperity-traffic-routes] ${JSON.stringify(evidence)}`);

    expect(coldBuildCounts.every((count) => count === 1)).toBe(true);
    expect(cachedFixture.connectivity.buildCount).toBe(1);
    expect(stableIdentity).toBe(true);
    expect(coldP95, `Prosperity traffic cold budget miss: ${JSON.stringify(evidence)}`)
      .toBeLessThan(coldRefreshBudgetMs);
    expect(cacheHitP95, `Prosperity traffic cache-hit budget miss: ${JSON.stringify(evidence)}`)
      .toBeLessThan(CACHE_HIT_P95_BUDGET_MS);
  }, 120_000);
});
