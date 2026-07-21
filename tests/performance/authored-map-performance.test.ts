import { performance } from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MapEditorDraftModel,
  compileAuthoredMapV1,
  createCurrentAuthoredMapDefinitionV1,
  parseAuthoredMapDefinitionV1,
  serializeAuthoredMapDefinitionV1,
  withAuthoredMapContentFingerprintV1,
  type AuthoredMapDefinitionV1,
  type CompiledAuthoredMapV1,
} from "../../src/wayfinders/app/authoredMaps";
import {
  MapEditorPreviewSpatialIndex,
  type MapEditorPreviewRecord,
} from "../../src/wayfinders/assets/mapEditor/MapEditorPreview";
import { resolveAuthoredHomeIslandPlacement } from "../../src/wayfinders/assets/AuthoredHomeIsland";
import type { PrototypeConfig } from "../../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../../src/wayfinders/core/GameSimulation";
import type { SimulationPhase, SimulationTraceSink } from "../../src/wayfinders/core/SimulationTrace";
import {
  AuthoredFishingSeparationIndexV1,
  authoredFishingShoalPlacementRejectionV1,
  createAuthoredFishingShoalV1,
  createFishingShoalId,
  type AuthoredFishingShoalV1,
} from "../../src/wayfinders/features/fishing";
import { IslandPlacementIndex } from "../../src/wayfinders/world/IslandPlacementIndex";
import { WorldGrid } from "../../src/wayfinders/world/WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY } from "../../src/wayfinders/world/WorldTopology";
import {
  createAuthoredIslandPlacementProfile,
  finishIslandPlacement,
  islandPlacementRejection,
} from "../../src/wayfinders/world/authored";
import {
  authoredMapTestCollisionCatalog,
  createValidAuthoredMapFixture,
} from "../fixtures/authoredMap";
import { createWorldProfileConfig } from "../fixtures/worldProfiles";

const TIMING_SAMPLES = 3;
const STABLE_FRAME_SAMPLES = 500;
const INDEX_QUERY_SAMPLES = 1_000;
const DENSE_PLANNED_ISLAND_COUNT = 96;
const DENSE_SHOAL_COUNT = 96;

interface AuthoredPerformanceFixture {
  readonly name: "normal" | "dense-valid";
  readonly config: PrototypeConfig;
  readonly definition: Readonly<AuthoredMapDefinitionV1>;
  readonly compiled: Readonly<CompiledAuthoredMapV1>;
}

interface FixtureBudgets {
  readonly parseP95Ms: number;
  readonly compileP95Ms: number;
  readonly constructionP95Ms: number;
  readonly restartP95Ms: number;
  readonly featureSeedingP95Ms: number;
  readonly stableFrameP95Ms: number;
  readonly committedRebuildP95Ms: number;
  readonly indexRebuildP95Ms: number;
  readonly indexQueryP95Ms: number;
}

// These are attributed wall-clock guardrails, not product cardinality caps.
// They intentionally leave headroom over the noisy Windows MAP-1.0 baseline
// while keeping the dense fixture below roughly twice the normal compile and
// runtime budgets. Work-bound assertions below guard the scaling mechanism so
// timing variance cannot hide a total-object scan in a stable frame/query.
const BUDGETS: Readonly<Record<AuthoredPerformanceFixture["name"], FixtureBudgets>> = Object.freeze({
  normal: Object.freeze({
    parseP95Ms: 15,
    compileP95Ms: 1_500,
    constructionP95Ms: 1_800,
    restartP95Ms: 1_800,
    featureSeedingP95Ms: 250,
    stableFrameP95Ms: 5,
    committedRebuildP95Ms: 1_500,
    indexRebuildP95Ms: 25,
    indexQueryP95Ms: 1,
  }),
  "dense-valid": Object.freeze({
    parseP95Ms: 30,
    compileP95Ms: 1_800,
    constructionP95Ms: 2_200,
    restartP95Ms: 2_200,
    featureSeedingP95Ms: 400,
    stableFrameP95Ms: 5,
    committedRebuildP95Ms: 1_800,
    indexRebuildP95Ms: 40,
    indexQueryP95Ms: 1,
  }),
});

let fixtures: readonly Readonly<AuthoredPerformanceFixture>[];

beforeAll(async () => {
  const config = createWorldProfileConfig("P1");
  const normal = await createValidAuthoredMapFixture(config, "performance-normal");
  const dense = await createDenseValidFixture(config);
  fixtures = Object.freeze([
    Object.freeze({ name: "normal", config, ...normal }),
    Object.freeze({ name: "dense-valid", config, ...dense }),
  ]);

  expect(normal.definition.world.islands).toHaveLength(32);
  expect(dense.definition.world.islands.length).toBeGreaterThan(normal.definition.world.islands.length);
  expect(dense.definition.fishing.shoals).toHaveLength(DENSE_SHOAL_COUNT);
}, 30_000);

describe("MAP-1.4 authored-map scale budgets", () => {
  it("keeps normal and dense-valid canonical parsing and compilation within attributed budgets", async () => {
    for (const fixture of fixtures) {
      const source = serializeAuthoredMapDefinitionV1(fixture.definition);
      const budget = BUDGETS[fixture.name];
      const parseDurations: number[] = [];
      const compileDurations: number[] = [];

      // One unmeasured rehearsal removes module/JIT startup from the phase that
      // owns map complexity while retaining cold-ish measured compiles.
      const rehearsal = parseAuthoredMapDefinitionV1(source);
      expect(compileOrThrow(rehearsal, fixture.config).definition.contentFingerprint)
        .toBe(fixture.definition.contentFingerprint);

      for (let sample = 0; sample < TIMING_SAMPLES; sample++) {
        const parseStartedAt = performance.now();
        const parsed = parseAuthoredMapDefinitionV1(source);
        parseDurations.push(performance.now() - parseStartedAt);

        const compileStartedAt = performance.now();
        const compiled = compileOrThrow(parsed, fixture.config);
        compileDurations.push(performance.now() - compileStartedAt);
        expect(compiled.generated.manifest.islands).toHaveLength(fixture.definition.world.islands.length);
        expect(compiled.fishingDefinitions).toHaveLength(fixture.definition.fishing.shoals.length);
        await yieldToEventLoop();
      }

      const evidence = {
        fixture: fixture.name,
        dimensions: fixture.definition.world.dimensions,
        islands: fixture.definition.world.islands.length,
        shoals: fixture.definition.fishing.shoals.length,
        bytes: new TextEncoder().encode(source).byteLength,
        samples: TIMING_SAMPLES,
        parseP95Ms: percentile(parseDurations, 0.95),
        parseBudgetMs: budget.parseP95Ms,
        compileP95Ms: percentile(compileDurations, 0.95),
        compileBudgetMs: budget.compileP95Ms,
      };
      console.info(`[authored-map-compile] ${JSON.stringify(evidence)}`);
      expect(evidence.parseP95Ms, `Authored map parse budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.parseP95Ms);
      expect(evidence.compileP95Ms, `Authored map compile budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.compileP95Ms);
    }
  }, 45_000);

  it.each(["normal", "dense-valid"] as const)(
    "bounds %s authored simulation construction, restart, descriptor seeding, and stable frames",
    async (fixtureName) => {
      const fixture = fixtureNamed(fixtureName);
      const budget = BUDGETS[fixture.name];
      const constructionDurations: number[] = [];
      const restartDurations: number[] = [];
      const featureSeedingDurations: number[] = [];
      let retained: GameSimulation | undefined;

      for (let sample = 0; sample < TIMING_SAMPLES; sample++) {
        const trace = new PhaseTrace();
        const startedAt = performance.now();
        const simulation = createSimulation(fixture, trace);
        constructionDurations.push(performance.now() - startedAt);
        featureSeedingDurations.push(...trace.take("feature-seeding"));

        const priorWorld = simulation.world;
        const restartStartedAt = performance.now();
        simulation.restartCurrentSource();
        restartDurations.push(performance.now() - restartStartedAt);
        featureSeedingDurations.push(...trace.take("feature-seeding"));
        expect(simulation.world).not.toBe(priorWorld);
        expect(simulation.sourceIdentity).toMatchObject({
          kind: "authored-map",
          mapId: fixture.definition.id,
          contentFingerprint: fixture.definition.contentFingerprint,
        });
        retained = simulation;
        await yieldToEventLoop();
      }
      if (!retained) throw new Error("Authored simulation performance fixture was not retained");

      // Prime visible and interaction caches, then prove stable updates do not
      // rebuild the world/definitions or issue new descriptor-index queries.
      retained.snapshot();
      void retained.fishingShoalInteraction;
      const world = retained.world;
      const fishing = retained.fishingShoalDefinitions;
      const dossiers = retained.islandDossierDefinitions;
      const surveySites = retained.surveySiteDefinitions;
      const descriptorTotals = retained.descriptorSpatialQueryTotals;
      const revision = retained.revision;
      const stableDurations: number[] = [];
      for (let sample = 0; sample < STABLE_FRAME_SAMPLES; sample++) {
        const startedAt = performance.now();
        retained.update({ turn: 0, throttle: 0 }, 0);
        retained.snapshot();
        void retained.fishingShoalInteraction;
        stableDurations.push(performance.now() - startedAt);
        if (sample > 0 && sample % 100 === 0) await yieldToEventLoop();
      }

      const evidence = {
        fixture: fixture.name,
        islands: fixture.definition.world.islands.length,
        shoals: fixture.definition.fishing.shoals.length,
        timingSamples: TIMING_SAMPLES,
        constructionP95Ms: percentile(constructionDurations, 0.95),
        constructionBudgetMs: budget.constructionP95Ms,
        restartP95Ms: percentile(restartDurations, 0.95),
        restartBudgetMs: budget.restartP95Ms,
        featureSeedingSamples: featureSeedingDurations.length,
        featureSeedingP95Ms: percentile(featureSeedingDurations, 0.95),
        featureSeedingBudgetMs: budget.featureSeedingP95Ms,
        stableFrameSamples: STABLE_FRAME_SAMPLES,
        stableFrameP95Ms: percentile(stableDurations, 0.95),
        stableFrameBudgetMs: budget.stableFrameP95Ms,
        descriptorTotals,
      };
      console.info(`[authored-map-runtime] ${JSON.stringify(evidence)}`);

      expect(retained.world).toBe(world);
      expect(retained.fishingShoalDefinitions).toBe(fishing);
      expect(retained.islandDossierDefinitions).toBe(dossiers);
      expect(retained.surveySiteDefinitions).toBe(surveySites);
      expect(retained.revision).toBe(revision);
      expect(retained.descriptorSpatialQueryTotals).toEqual(descriptorTotals);
      expect(evidence.constructionP95Ms, `Authored construction budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.constructionP95Ms);
      expect(evidence.restartP95Ms, `Authored restart budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.restartP95Ms);
      expect(evidence.featureSeedingP95Ms, `Authored descriptor seeding budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.featureSeedingP95Ms);
      expect(evidence.stableFrameP95Ms, `Authored stable-frame budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.stableFrameP95Ms);
    },
    60_000,
  );

  it("bounds committed editor rebuilds and keeps viewport queries local", async () => {
    for (const fixture of fixtures) {
      const budget = BUDGETS[fixture.name];
      const model = new MapEditorDraftModel(fixture.definition, {
        catalogRevision: 1,
        mapRepositoryRevision: 1,
        saved: true,
      }, {
        finalize: withAuthoredMapContentFingerprintV1,
        compile: (definition) => compileAuthoredMapV1(definition, {
          config: fixture.config,
          availableAuthoredIslandCatalog: authoredMapTestCollisionCatalog(),
        }),
      });
      const index = new MapEditorPreviewSpatialIndex<MapEditorPreviewRecord>(
        fixture.definition.world.dimensions.width,
        fixture.definition.world.dimensions.height,
        16,
      );
      const records = previewRecords(fixture.definition);

      index.rebuild(records);
      await model.setDisplayName(`${fixture.name} rehearsal`);

      const committedRebuildDurations: number[] = [];
      const indexRebuildDurations: number[] = [];
      for (let sample = 0; sample < TIMING_SAMPLES; sample++) {
        const commitStartedAt = performance.now();
        expect(await model.setDisplayName(`${fixture.name} committed ${sample}`)).toBe(true);
        committedRebuildDurations.push(performance.now() - commitStartedAt);
        expect(model.snapshot().valid).toBe(true);

        const indexStartedAt = performance.now();
        index.rebuild(records);
        indexRebuildDurations.push(performance.now() - indexStartedAt);
        await yieldToEventLoop();
      }

      const firstIsland = fixture.definition.world.islands[0];
      if (!firstIsland) throw new Error("Authored map performance fixture requires one island");
      const viewport = Object.freeze({
        minX: Math.max(0, firstIsland.center.x - 8),
        minY: Math.max(0, firstIsland.center.y - 8),
        maxX: Math.min(fixture.definition.world.dimensions.width - 1, firstIsland.center.x + 8),
        maxY: Math.min(fixture.definition.world.dimensions.height - 1, firstIsland.center.y + 8),
      });
      const expectedKeys = index.query(viewport).map(({ key }) => key);
      const viewCount = index.allViews().length;
      const queryDurations: number[] = [];
      let maximumQueryResults = 0;
      for (let sample = 0; sample < INDEX_QUERY_SAMPLES; sample++) {
        const startedAt = performance.now();
        const result = index.query(viewport);
        queryDurations.push(performance.now() - startedAt);
        maximumQueryResults = Math.max(maximumQueryResults, result.length);
        expect(result.map(({ key }) => key)).toEqual(expectedKeys);
      }

      const evidence = {
        fixture: fixture.name,
        records: records.length,
        periodicViews: viewCount,
        maximumQueryResults,
        committedSamples: TIMING_SAMPLES,
        committedRebuildP95Ms: percentile(committedRebuildDurations, 0.95),
        committedRebuildBudgetMs: budget.committedRebuildP95Ms,
        indexRebuildP95Ms: percentile(indexRebuildDurations, 0.95),
        indexRebuildBudgetMs: budget.indexRebuildP95Ms,
        indexQuerySamples: INDEX_QUERY_SAMPLES,
        indexQueryP95Ms: percentile(queryDurations, 0.95),
        indexQueryBudgetMs: budget.indexQueryP95Ms,
      };
      console.info(`[authored-map-editor] ${JSON.stringify(evidence)}`);

      expect(index.allViews()).toHaveLength(viewCount);
      expect(maximumQueryResults).toBeGreaterThan(0);
      expect(maximumQueryResults).toBeLessThan(Math.max(2, Math.ceil(viewCount / 4)));
      expect(evidence.committedRebuildP95Ms, `Committed map rebuild budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.committedRebuildP95Ms);
      expect(evidence.indexRebuildP95Ms, `Map preview index rebuild budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.indexRebuildP95Ms);
      expect(evidence.indexQueryP95Ms, `Map preview query budget miss: ${JSON.stringify(evidence)}`)
        .toBeLessThan(budget.indexQueryP95Ms);
    }
  }, 45_000);
});

class PhaseTrace implements SimulationTraceSink {
  private readonly durations = new Map<SimulationPhase, number[]>();

  record(phase: SimulationPhase, durationMs: number): void {
    const durations = this.durations.get(phase) ?? [];
    durations.push(durationMs);
    this.durations.set(phase, durations);
  }

  take(phase: SimulationPhase): readonly number[] {
    const durations = this.durations.get(phase) ?? [];
    this.durations.set(phase, []);
    return durations;
  }
}

function createSimulation(
  fixture: Readonly<AuthoredPerformanceFixture>,
  trace: SimulationTraceSink,
): GameSimulation {
  return new GameSimulation(fixture.config, trace, {
    authoredIslandCatalog: fixture.compiled.collisionCatalog,
    authoredMapSource: {
      identity: fixture.compiled.sourceIdentity,
      catalogRepositoryRevision: 1,
      compileFresh: () => compileOrThrow(fixture.definition, fixture.config),
    },
  });
}

function compileOrThrow(
  definition: Readonly<AuthoredMapDefinitionV1>,
  config: PrototypeConfig,
): Readonly<CompiledAuthoredMapV1> {
  const result = compileAuthoredMapV1(definition, {
    config,
    availableAuthoredIslandCatalog: authoredMapTestCollisionCatalog(),
  });
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return result.value;
}

async function createDenseValidFixture(config: PrototypeConfig): Promise<Readonly<{
  definition: Readonly<AuthoredMapDefinitionV1>;
  compiled: Readonly<CompiledAuthoredMapV1>;
}>> {
  const baseSeed = 84_127;
  const availableAuthoredIslandCatalog = authoredMapTestCollisionCatalog();
  const repeatedEntry = availableAuthoredIslandCatalog.islands[0];
  if (!repeatedEntry) throw new Error("Dense authored fixture requires one reusable collision entry");
  const planningWorld = new WorldGrid(
    config.world.width,
    config.world.height,
    config.navigation.chunkSize,
    WRAPPING_WORLD_TOPOLOGY,
    config.navigation.tileSize,
  );
  const home = resolveAuthoredHomeIslandPlacement({
    x: Math.floor(planningWorld.width / 2),
    y: Math.floor(planningWorld.height / 2),
  });
  const representative = createAuthoredIslandPlacementProfile(1, repeatedEntry, config);
  const placementIndex = new IslandPlacementIndex(
    planningWorld.topology,
    representative.outerRadius,
    config.islands.minimumChannelWidth,
  );
  const islands: Array<Readonly<{
    readonly sourceId: number;
    readonly authoredAssetId: string;
    readonly assetRevision: string;
    readonly center: Readonly<{ readonly x: number; readonly y: number }>;
  }>> = [];
  for (let y = 0; y < planningWorld.height && islands.length < DENSE_PLANNED_ISLAND_COUNT; y++) {
    for (let x = 0; x < planningWorld.width && islands.length < DENSE_PLANNED_ISLAND_COUNT; x++) {
      const sourceId = islands.length + 1;
      const profile = createAuthoredIslandPlacementProfile(sourceId, repeatedEntry, config);
      const center = Object.freeze({ x, y });
      if (islandPlacementRejection(
        planningWorld.topology,
        home.landmarks.homeCenter,
        home.landmarks.dock,
        profile,
        center,
        placementIndex,
        config,
      )) continue;
      placementIndex.add(finishIslandPlacement(profile, center));
      islands.push(Object.freeze({
        sourceId,
        authoredAssetId: repeatedEntry.assetId,
        assetRevision: repeatedEntry.revision,
        center,
      }));
    }
  }
  if (islands.length !== DENSE_PLANNED_ISLAND_COUNT) {
    throw new Error(`Dense authored fixture placed ${islands.length}/${DENSE_PLANNED_ISLAND_COUNT} islands`);
  }
  const worldOnlyDefinition = await createCurrentAuthoredMapDefinitionV1({
    id: "performance-dense-valid",
    displayName: "Performance dense valid",
    baseSeed,
    islands,
    shoals: [],
    config,
  });
  const worldOnly = compileOrThrow(worldOnlyDefinition, config);
  const shoals = denseShoals(worldOnly, baseSeed, DENSE_SHOAL_COUNT);
  const definition = await createCurrentAuthoredMapDefinitionV1({
    id: worldOnlyDefinition.id,
    displayName: worldOnlyDefinition.displayName,
    baseSeed,
    islands,
    shoals,
    config,
  });
  return Object.freeze({ definition, compiled: compileOrThrow(definition, config) });
}

function denseShoals(
  compiled: Readonly<CompiledAuthoredMapV1>,
  baseSeed: number,
  target: number,
): readonly Readonly<AuthoredFishingShoalV1>[] {
  const world = compiled.generated.grid;
  const separation = new AuthoredFishingSeparationIndexV1(world);
  const shoals: Readonly<AuthoredFishingShoalV1>[] = [];
  for (let y = 0; y < world.height && shoals.length < target; y++) {
    for (let x = 0; x < world.width && shoals.length < target; x++) {
      const tile = Object.freeze({ x, y });
      const rejection = authoredFishingShoalPlacementRejectionV1(
        world,
        compiled.generated.analysis,
        compiled.generated.landmarks.homeReturnTile,
        tile,
      );
      if (rejection || separation.hasConflict(tile)) continue;
      const ordinal = shoals.length;
      shoals.push(createAuthoredFishingShoalV1(
        baseSeed,
        createFishingShoalId(ordinal),
        tile,
        ordinal % 3 === 0 ? "lean" : ordinal % 3 === 1 ? "steady" : "rich",
      ));
      separation.add(tile);
    }
  }
  if (shoals.length !== target) {
    throw new Error(`Dense authored fixture placed ${shoals.length}/${target} fishing shoals`);
  }
  return Object.freeze(shoals);
}

function previewRecords(
  definition: Readonly<AuthoredMapDefinitionV1>,
): readonly Readonly<MapEditorPreviewRecord>[] {
  return Object.freeze([
    ...definition.world.islands.map((island) => Object.freeze({
      id: `island:${island.sourceId}`,
      bounds: Object.freeze({
        minX: island.center.x - 1,
        minY: island.center.y - 1,
        maxX: island.center.x + 1,
        maxY: island.center.y + 1,
      }),
    })),
    ...definition.fishing.shoals.map((shoal) => Object.freeze({
      id: `shoal:${shoal.id}`,
      bounds: Object.freeze({
        minX: shoal.tile.x,
        minY: shoal.tile.y,
        maxX: shoal.tile.x,
        maxY: shoal.tile.y,
      }),
    })),
  ]);
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new RangeError("A percentile requires at least one timing sample");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function fixtureNamed(name: AuthoredPerformanceFixture["name"]): Readonly<AuthoredPerformanceFixture> {
  const fixture = fixtures.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`Missing authored performance fixture ${name}`);
  return fixture;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
