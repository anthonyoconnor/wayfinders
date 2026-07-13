import { describe, expect, it } from "vitest";
import baselineFixturesJson from "./fixtures/accepted-baseline-v1.json";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import {
  SAVE_SCHEMA_VERSION,
  SaveValidationError,
  UnsupportedSaveSchemaVersionError,
  applyGenerationConfig,
  classifySaveGame,
  migrateSaveGame,
  parseSaveGame,
} from "../src/wayfinders/persistence/SaveGame";

const baselineFixtures = baselineFixturesJson as Record<string, unknown>;

function restoreFixture(value: unknown): { migrated: ReturnType<typeof migrateSaveGame>; simulation: GameSimulation } {
  const migrated = migrateSaveGame(value);
  const config = applyGenerationConfig(migrated.world.generationConfig, migrated.world.seed);
  const simulation = new GameSimulation(config);
  simulation.restoreSave(value);
  return { migrated, simulation };
}

function currentSaveAtTimestamp(simulation: GameSimulation, savedAt: number): ReturnType<GameSimulation["createSave"]> {
  const save = simulation.createSave();
  save.savedAt = savedAt;
  return save;
}

describe("save migration chain", () => {
  it("migrates the GP-1.1 V2 shape through the current returned-record schema", () => {
    const baseline = structuredClone(baselineFixtures.activeProvisional) as Record<string, unknown>;
    const world = baseline.world as Record<string, unknown>;
    const versionTwo = {
      ...baseline,
      schemaVersion: 2,
      world: { ...world, contentVersions: { fishingShoals: 1 } },
      fishingShoals: { provisional: [] },
    };

    const migrated = migrateSaveGame(versionTwo);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.fishingShoals).toEqual({ provisional: [], returned: [] });
    expect(versionTwo.schemaVersion).toBe(2);
  });

  it("adds an empty returned collection in the adjacent V3-to-V4 migration", () => {
    const baseline = structuredClone(baselineFixtures.activeProvisional) as Record<string, unknown>;
    const world = baseline.world as Record<string, unknown>;
    const versionThree = {
      ...baseline,
      schemaVersion: 3,
      world: { ...world, contentVersions: { fishingShoals: 1 } },
      fishingShoals: { provisional: [] },
    };

    const migrated = migrateSaveGame(versionThree);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.fishingShoals).toEqual({ provisional: [], returned: [] });
    expect(versionThree).not.toHaveProperty("fishingShoals.returned");
  });

  it.each(Object.entries(baselineFixtures))(
    "loads, restores and round-trips the immutable V1 %s fixture",
    (_name, fixture) => {
      const inputBeforeMigration = structuredClone(fixture);
      const first = migrateSaveGame(fixture);
      const second = migrateSaveGame(first);

      expect(fixture).toEqual(inputBeforeMigration);
      expect(second).toEqual(first);
      expect(first.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      expect(parseSaveGame(first)).toEqual(first);

      const { simulation } = restoreFixture(fixture);
      expect(currentSaveAtTimestamp(simulation, first.savedAt)).toEqual(first);

      const restoredOnce = currentSaveAtTimestamp(simulation, first.savedAt);
      simulation.restoreSave(fixture);
      expect(currentSaveAtTimestamp(simulation, first.savedAt)).toEqual(restoredOnce);
    },
  );

  it("keeps a migrated pending-wreck hold idempotent and advances its generation exactly once", () => {
    const { migrated, simulation } = restoreFixture(baselineFixtures.pendingWreck);
    const pending = migrated.expedition.pendingRespawn;
    expect(pending).not.toBeNull();
    expect(simulation.wreckPresentationActive).toBe(true);
    expect(simulation.generation).toBe(1);

    simulation.update({ turn: 0, throttle: 0 }, pending?.remainingSeconds ?? 0);
    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.generation).toBe(2);
    simulation.update({ turn: 0, throttle: 0 }, 1);
    expect(simulation.generation).toBe(2);
  });

  it("preserves unsupported newer slots and distinguishes corrupt known schemas", () => {
    const future = structuredClone(baselineFixtures.dockedReturned) as Record<string, unknown>;
    future.schemaVersion = SAVE_SCHEMA_VERSION + 1;
    expect(classifySaveGame(future)).toBe("unsupported-newer");
    expect(() => migrateSaveGame(future)).toThrow(UnsupportedSaveSchemaVersionError);

    const corrupt = structuredClone(baselineFixtures.dockedReturned) as {
      schemaVersion: number;
      ship: { currentTileX: number };
    };
    corrupt.schemaVersion = SAVE_SCHEMA_VERSION;
    corrupt.ship.currentTileX = -1;
    expect(classifySaveGame(corrupt)).toBe("invalid");
    expect(() => migrateSaveGame(corrupt)).toThrow(SaveValidationError);
  });
});
