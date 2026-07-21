import { describe, expect, it } from "vitest";

import {
  compileAuthoredMapV1,
  createCurrentAuthoredMapDefinitionV1,
  projectAuthoredMapCollisionCatalogV1,
} from "../src/wayfinders/app/authoredMaps";
import {
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalogEntry,
} from "../src/wayfinders/world/AuthoredIslandCatalog";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import {
  AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
  compileAuthoredWorldLayoutV1,
  createCurrentAuthoredWorldLayoutV1,
} from "../src/wayfinders/world/authored";
import { createWorldProfileConfig } from "./fixtures/worldProfiles";

const REPEATED_ENTRY: Readonly<AuthoredIslandCatalogEntry> = Object.freeze({
  assetId: "production.island.repeated",
  name: "Repeated Island",
  revision: "revision-1",
  gridWidth: 2,
  gridHeight: 2,
  solidSubcells: Object.freeze([{ x: 0, y: 0 }, { x: 4, y: 4 }]),
});

function catalog(includeUnrelated = false) {
  return validateAuthoredIslandCatalog({
    revision: includeUnrelated ? "available-2" : "available-1",
    islands: [
      REPEATED_ENTRY,
      ...(includeUnrelated ? [{
        assetId: "production.island.unrelated",
        name: "Unrelated Island",
        revision: "revision-9",
        gridWidth: 1,
        gridHeight: 1,
        solidSubcells: [{ x: 0, y: 0 }],
      }] : []),
    ],
  });
}

describe("MAP-1.1 authored-map compiler", () => {
  it("compiles repeated asset instances through manifest, rasterization, analysis, water, and viability", async () => {
    const config = createWorldProfileConfig("P0");
    const baseSeed = 13_371;
    const ordinaryPlan = new WorldGenerator(config, catalog()).plan(baseSeed);
    const definition = await createCurrentAuthoredMapDefinitionV1({
      id: "repeated-islands",
      displayName: "Repeated islands",
      baseSeed,
      islands: ordinaryPlan.islands.map((island) => ({
        sourceId: island.id,
        authoredAssetId: REPEATED_ENTRY.assetId,
        assetRevision: REPEATED_ENTRY.revision,
        center: island.center,
      })),
      shoals: [],
      config,
    });
    const result = compileAuthoredMapV1(definition, {
      config,
      availableAuthoredIslandCatalog: catalog(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
    expect(result.value.generated.islands).toHaveLength(config.islands.count);
    expect(new Set(result.value.generated.islands.map(({ authoredAssetId }) => authoredAssetId))).toEqual(
      new Set([REPEATED_ENTRY.assetId]),
    );
    expect(result.value.generated.manifest.islands.map(({ sourceId }) => sourceId)).toEqual(
      ordinaryPlan.islands.map(({ id }) => id),
    );
    expect(result.value.islandDossierDefinitions).toHaveLength(config.islands.count);
    expect(result.value.surveySiteDefinitions.length).toBeGreaterThan(0);
    expect(result.value.idolLocationDefinitions).toHaveLength(config.world.idolCount);
    expect(result.value.generated.manifest.authoredIslandCatalogRevision).toBe(
      result.value.collisionCatalog.revision,
    );
  });

  it("projects only referenced collision inputs and reports stale layout settings before state exists", async () => {
    const config = createWorldProfileConfig("P0");
    const definition = await createCurrentAuthoredMapDefinitionV1({
      id: "projection-map",
      displayName: "Projection map",
      baseSeed: 7,
      islands: [{
        sourceId: 1,
        authoredAssetId: REPEATED_ENTRY.assetId,
        assetRevision: REPEATED_ENTRY.revision,
        center: { x: 0, y: 0 },
      }],
      shoals: [],
      config,
    });
    expect(projectAuthoredMapCollisionCatalogV1(definition, catalog(true))).toEqual(
      projectAuthoredMapCollisionCatalogV1(definition, catalog(false)),
    );

    const stale = structuredClone(definition);
    (stale.world as { settingsFingerprint: string }).settingsFingerprint = "stale-layout-settings";
    const result = compileAuthoredMapV1(stale, {
      config,
      availableAuthoredIslandCatalog: catalog(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected stale settings rejection");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "world", code: "stale-layout-settings" }),
    ]));
  });

  it("accepts a repeated island asset across the wrapping corner", () => {
    const config = createWorldProfileConfig("P0");
    const result = compileAuthoredWorldLayoutV1(
      createCurrentAuthoredWorldLayoutV1(17, [
        {
          sourceId: 1,
          authoredAssetId: REPEATED_ENTRY.assetId,
          assetRevision: REPEATED_ENTRY.revision,
          center: { x: 0, y: 0 },
        },
        {
          sourceId: 2,
          authoredAssetId: REPEATED_ENTRY.assetId,
          assetRevision: REPEATED_ENTRY.revision,
          center: { x: 24, y: 0 },
        },
      ], config),
      catalog(),
      { config },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
    expect(result.value.generated.manifest.islands.map(({ authoredAssetId }) => authoredAssetId)).toEqual([
      REPEATED_ENTRY.assetId,
      REPEATED_ENTRY.assetId,
    ]);
    expect(result.value.generated.manifest.islands[0].footprint.pieces.length).toBeGreaterThan(1);
  });

  it("preserves the greatest signed-int32 source ID without tile aliasing", () => {
    const config = createWorldProfileConfig("P0");
    const center = new WorldGenerator(config, catalog()).plan(17).islands[0].center;
    const layout = createCurrentAuthoredWorldLayoutV1(17, [{
      sourceId: AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
      authoredAssetId: REPEATED_ENTRY.assetId,
      assetRevision: REPEATED_ENTRY.revision,
      center,
    }], config);
    const result = compileAuthoredWorldLayoutV1(layout, catalog(), { config });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
    expect(result.value.generated.manifest.islands[0].sourceId)
      .toBe(AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID);
    expect(Array.from({ length: result.value.generated.grid.tileCount }, (_, index) => (
      result.value.generated.grid.getIslandIdAtIndex(index)
    ))).toContain(AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID);

    const invalid = structuredClone(layout);
    (invalid.islands[0] as { sourceId: number }).sourceId = AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID + 1;
    const rejected = compileAuthoredWorldLayoutV1(invalid, catalog(), { config });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Expected out-of-range source ID rejection");
    expect(rejected.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-island-source-id" }),
    ]));
  });
});
