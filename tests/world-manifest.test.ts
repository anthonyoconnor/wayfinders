import { describe, expect, it } from "vitest";

import {
  WORLD_MANIFEST_SCHEMA_VERSION,
  WorldManifestValidationError,
  createManifestFromPlannedWorldV1,
  encodeWorldManifestV1,
  parseWorldManifestV1,
  serializeWorldManifestV1,
  validateWorldManifestV1,
  type PlannedIslandFactsV1,
  type PlannedWorldFactsV1,
  type WorldManifestV1,
} from "../src/wayfinders/world/manifest";

const ISLAND_ONE: PlannedIslandFactsV1 = {
  id: 1,
  kind: "low-cay",
  size: "small",
  center: { x: 20, y: 12 },
  radiusX: 1.5,
  radiusY: 1.25,
  outerRadius: 2,
  rotation: 0.25,
  shapeSeed: 101,
  bounds: { minX: 18, minY: 10, maxX: 22, maxY: 14 },
};

const ISLAND_TWO: PlannedIslandFactsV1 = {
  id: 2,
  kind: "high-island",
  size: "medium",
  center: { x: 40, y: 20 },
  radiusX: 3.25,
  radiusY: 2.5,
  outerRadius: 3.5,
  rotation: 1.5,
  shapeSeed: 202,
  bounds: { minX: 36, minY: 16, maxX: 44, maxY: 24 },
};

function plannedWorld(islands: readonly PlannedIslandFactsV1[]): PlannedWorldFactsV1 {
  return {
    seed: 84_221,
    width: 64,
    height: 48,
    chunkSize: 16,
    landmarks: {
      homeCenter: { x: 32, y: 24 },
      harbour: { x: 33, y: 24 },
      dock: { x: 36, y: 24 },
      homeReturnTile: { x: 35, y: 24 },
      hiddenObstacleCenter: { x: 10, y: 10 },
      hiddenResource: { x: 8, y: 12 },
    },
    islands,
  };
}

function manifest(
  islands: readonly PlannedIslandFactsV1[] = [ISLAND_TWO, ISLAND_ONE],
): WorldManifestV1 {
  return createManifestFromPlannedWorldV1(plannedWorld(islands), {
    generatorVersion: "islands-v1",
    settingsProfileId: "P2-normal",
    settingsFingerprint: "sha256-a1b2c3",
  });
}

function mutableClone(value: WorldManifestV1): Record<string, unknown> {
  return JSON.parse(serializeWorldManifestV1(value)) as Record<string, unknown>;
}

describe("WorldManifest v1", () => {
  it("produces byte-equivalent output for equivalent facts in different input orders", () => {
    const first = manifest([ISLAND_TWO, ISLAND_ONE]);
    const second = manifest([ISLAND_ONE, ISLAND_TWO]);

    expect(first.schemaVersion).toBe(WORLD_MANIFEST_SCHEMA_VERSION);
    expect(first.islands.map(({ id }) => id)).toEqual(["island:000001", "island:000002"]);
    expect(serializeWorldManifestV1(first)).toBe(serializeWorldManifestV1(second));
    expect([...encodeWorldManifestV1(first)]).toEqual([...encodeWorldManifestV1(second)]);
  });

  it("round-trips canonical UTF-8 while returning recursively immutable facts", () => {
    const original = manifest();
    const bytes = encodeWorldManifestV1(original);
    const replay = parseWorldManifestV1(bytes);

    expect(replay).toEqual(original);
    expect(encodeWorldManifestV1(replay)).toEqual(bytes);
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.islands)).toBe(true);
    expect(Object.isFrozen(replay.islands[0].bounds)).toBe(true);
  });

  it("reports schema, stable-ID, geometry, and reference errors at precise paths", () => {
    const wrongVersion = mutableClone(manifest());
    wrongVersion.schemaVersion = 2;
    expect(() => validateWorldManifestV1(wrongVersion)).toThrowError(
      new WorldManifestValidationError("$.schemaVersion", "unsupported version 2; expected 1"),
    );

    const wrongIslandId = mutableClone(manifest());
    const islands = wrongIslandId.islands as Array<Record<string, unknown>>;
    islands[0].id = "island:999999";
    expect(() => validateWorldManifestV1(wrongIslandId)).toThrow(
      "$.islands[0].id: must be island:000001 for sourceId 1",
    );

    const clippedBounds = mutableClone(manifest());
    const clippedIsland = (clippedBounds.islands as Array<Record<string, unknown>>)[0];
    (clippedIsland.bounds as Record<string, unknown>).maxX = 20;
    expect(() => validateWorldManifestV1(clippedBounds)).toThrow(
      "$.islands[0].bounds: must contain the island's outer-radius extent",
    );

  });
});
