import { describe, expect, it } from "vitest";

import {
  WORLD_MANIFEST_SCHEMA_VERSION,
  WorldManifestValidationError,
  createManifestFromPlannedWorldV2,
  encodeWorldManifestV2,
  parseWorldManifestV2,
  serializeWorldManifestV2,
  validateWorldManifestV2,
  type PlannedIslandFactsV2,
  type PlannedWorldFactsV2,
  type WorldManifestV2,
} from "../src/wayfinders/world/manifest";
import { WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology";
import { createManifestWaterLayout } from "../src/wayfinders/world/water";

const ISLAND_ONE: PlannedIslandFactsV2 = {
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
  sourceKind: "procedural",
};

const ISLAND_TWO: PlannedIslandFactsV2 = {
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
  sourceKind: "procedural",
};

function plannedWorld(islands: readonly PlannedIslandFactsV2[]): PlannedWorldFactsV2 {
  return {
    seed: 84_221,
    width: 64,
    height: 48,
    chunkSize: 16,
    topology: WRAPPING_WORLD_TOPOLOGY,
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
  islands: readonly PlannedIslandFactsV2[] = [ISLAND_TWO, ISLAND_ONE],
): WorldManifestV2 {
  return createManifestFromPlannedWorldV2(plannedWorld(islands), {
    generatorVersion: "islands-v1",
    settingsProfileId: "P2-normal",
    settingsFingerprint: "sha256-a1b2c3",
    authoredIslandCatalogRevision: "none",
    waterLayout: createManifestWaterLayout(84_221, 64, 48),
  });
}

function mutableClone(value: WorldManifestV2): Record<string, unknown> {
  return JSON.parse(serializeWorldManifestV2(value)) as Record<string, unknown>;
}

describe("WorldManifest v2", () => {
  it("produces byte-equivalent output for equivalent facts in different input orders", () => {
    const first = manifest([ISLAND_TWO, ISLAND_ONE]);
    const second = manifest([ISLAND_ONE, ISLAND_TWO]);

    expect(first.schemaVersion).toBe(WORLD_MANIFEST_SCHEMA_VERSION);
    expect(first.islands.map(({ id }) => id)).toEqual(["island:000001", "island:000002"]);
    expect(serializeWorldManifestV2(first)).toBe(serializeWorldManifestV2(second));
    expect([...encodeWorldManifestV2(first)]).toEqual([...encodeWorldManifestV2(second)]);
  });

  it("round-trips canonical UTF-8 while returning recursively immutable facts", () => {
    const original = manifest();
    const bytes = encodeWorldManifestV2(original);
    const replay = parseWorldManifestV2(bytes);

    expect(replay).toEqual(original);
    expect(encodeWorldManifestV2(replay)).toEqual(bytes);
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.islands)).toBe(true);
    expect(Object.isFrozen(replay.islands[0].footprint)).toBe(true);
    expect(Object.isFrozen(replay.islands[0].footprint.pieces)).toBe(true);
  });

  it("preserves one stable island identity across four canonical footprint pieces", () => {
    const seamIsland: PlannedIslandFactsV2 = {
      ...ISLAND_ONE,
      center: { x: 1, y: 46 },
      bounds: { minX: -2, minY: 44, maxX: 3, maxY: 49 },
    };
    const original = manifest([seamIsland]);

    expect(original.islands).toHaveLength(1);
    expect(original.islands[0].id).toBe("island:000001");
    expect(original.islands[0].footprint.pieces).toEqual([
      { minX: 0, minY: 0, maxX: 3, maxY: 1 },
      { minX: 62, minY: 0, maxX: 63, maxY: 1 },
      { minX: 0, minY: 44, maxX: 3, maxY: 47 },
      { minX: 62, minY: 44, maxX: 63, maxY: 47 },
    ]);

    const reordered = mutableClone(original);
    const island = (reordered.islands as Array<Record<string, unknown>>)[0];
    const footprint = island.footprint as Record<string, unknown>;
    (footprint.pieces as unknown[]).reverse();
    expect(serializeWorldManifestV2(validateWorldManifestV2(reordered))).toBe(
      serializeWorldManifestV2(original),
    );
  });

  it("retains an explicit lifted ribbon image and rejects topology disagreement", () => {
    const explicitLift = mutableClone(manifest());
    const waterLayout = explicitLift.waterLayout as Record<string, unknown>;
    const regions = waterLayout.regions as Array<Record<string, unknown>>;
    const ribbon = regions.find(({ strategy }) => strategy === "ribbon");
    if (!ribbon) throw new Error("Expected generated current ribbon");
    ribbon.start = { x: 61, y: 20 };
    ribbon.end = { x: 3, y: 24 };
    ribbon.imageOffset = { x: 64, y: 0 };

    const accepted = validateWorldManifestV2(explicitLift);
    const acceptedRibbon = accepted.waterLayout.regions.find(({ strategy }) => strategy === "ribbon");
    expect(acceptedRibbon?.strategy === "ribbon" ? acceptedRibbon.imageOffset : undefined).toEqual({ x: 64, y: 0 });
    expect(parseWorldManifestV2(serializeWorldManifestV2(accepted))).toEqual(accepted);

    const bounded = mutableClone(accepted);
    bounded.topology = { x: "bounded", y: "wrap" };
    expect(() => validateWorldManifestV2(bounded)).toThrow(
      "$.waterLayout.regions[1].imageOffset.x: must be zero for a bounded topology axis",
    );
  });

  it("rejects topology/footprint disagreement and footprints spanning an axis", () => {
    const seamIsland: PlannedIslandFactsV2 = {
      ...ISLAND_ONE,
      center: { x: 1, y: 12 },
      bounds: { minX: -2, minY: 10, maxX: 3, maxY: 14 },
    };
    const bounded = mutableClone(manifest([seamIsland]));
    bounded.topology = { x: "bounded", y: "wrap" };
    expect(() => validateWorldManifestV2(bounded)).toThrow(
      "$.islands[0].footprint.liftedBounds.minX: is outside the bounded topology span",
    );

    const oversized = mutableClone(manifest());
    const island = (oversized.islands as Array<Record<string, unknown>>)[0];
    const footprint = island.footprint as Record<string, unknown>;
    const liftedBounds = footprint.liftedBounds as Record<string, unknown>;
    liftedBounds.minX = 0;
    liftedBounds.maxX = 63;
    expect(() => validateWorldManifestV2(oversized)).toThrow(
      "$.islands[0].footprint.liftedBounds: width 64 must be strictly smaller than world width 64",
    );
  });

  it("reports schema, stable-ID, geometry, and reference errors at precise paths", () => {
    const wrongVersion = mutableClone(manifest());
    wrongVersion.schemaVersion = 1;
    expect(() => validateWorldManifestV2(wrongVersion)).toThrowError(
      new WorldManifestValidationError("$.schemaVersion", "unsupported version 1; expected 2"),
    );

    const wrongIslandId = mutableClone(manifest());
    const islands = wrongIslandId.islands as Array<Record<string, unknown>>;
    islands[0].id = "island:999999";
    expect(() => validateWorldManifestV2(wrongIslandId)).toThrow(
      "$.islands[0].id: must be island:000001 for sourceId 1",
    );

    const clippedBounds = mutableClone(manifest());
    const clippedIsland = (clippedBounds.islands as Array<Record<string, unknown>>)[0];
    const footprint = clippedIsland.footprint as Record<string, unknown>;
    (footprint.liftedBounds as Record<string, unknown>).maxX = 20;
    expect(() => validateWorldManifestV2(clippedBounds)).toThrow(
      "$.islands[0].footprint.liftedBounds: must contain the island's outer-radius extent",
    );

  });
});
