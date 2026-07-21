import {
  compileAuthoredMapV1,
  createCurrentAuthoredMapDefinitionV1,
  type AuthoredMapDefinitionV1,
  type CompiledAuthoredMapV1,
} from "../../src/wayfinders/app/authoredMaps";
import type { AuthoredIslandPresentationCatalog } from "../../src/wayfinders/assets/AuthoredIslandPresentation";
import type { PrototypeConfig } from "../../src/wayfinders/config/prototypeConfig";
import {
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalogEntry,
} from "../../src/wayfinders/world/AuthoredIslandCatalog";
import { WorldGenerator } from "../../src/wayfinders/world/WorldGenerator";
import { createWorldProfileConfig } from "./worldProfiles";

export const REPEATED_AUTHORED_ISLAND_ENTRY: Readonly<AuthoredIslandCatalogEntry> = Object.freeze({
  assetId: "production.island.repeated",
  name: "Repeated Island",
  revision: "revision-1",
  gridWidth: 2,
  gridHeight: 2,
  solidSubcells: Object.freeze([{ x: 0, y: 0 }, { x: 4, y: 4 }]),
});

export function authoredMapTestCollisionCatalog() {
  return validateAuthoredIslandCatalog({
    revision: "available-test",
    islands: [REPEATED_AUTHORED_ISLAND_ENTRY],
  });
}

export function authoredMapTestPresentationCatalog(): Readonly<AuthoredIslandPresentationCatalog> {
  return Object.freeze({
    revision: "available-presentation-test",
    islands: Object.freeze([Object.freeze({
      assetId: REPEATED_AUTHORED_ISLAND_ENTRY.assetId,
      name: REPEATED_AUTHORED_ISLAND_ENTRY.name,
      revision: REPEATED_AUTHORED_ISLAND_ENTRY.revision,
      gridWidth: REPEATED_AUTHORED_ISLAND_ENTRY.gridWidth,
      gridHeight: REPEATED_AUTHORED_ISLAND_ENTRY.gridHeight,
      layers: Object.freeze([Object.freeze({
        id: "land",
        plane: "land" as const,
        url: "/test/repeated-island.png",
        textureKey: "test.repeated-island.land",
        pixelWidth: 64,
        pixelHeight: 64,
        opacity: 1,
        blendMode: "normal" as const,
      })]),
    })]),
  });
}

export async function createValidAuthoredMapFixture(
  config: PrototypeConfig = createWorldProfileConfig("P0"),
  id = "repeated-islands",
): Promise<Readonly<{
  definition: Readonly<AuthoredMapDefinitionV1>;
  compiled: Readonly<CompiledAuthoredMapV1>;
}>> {
  const baseSeed = 13_371;
  const availableAuthoredIslandCatalog = authoredMapTestCollisionCatalog();
  const ordinaryPlan = new WorldGenerator(config, availableAuthoredIslandCatalog).plan(baseSeed);
  const definition = await createCurrentAuthoredMapDefinitionV1({
    id,
    displayName: "Repeated islands",
    baseSeed,
    islands: ordinaryPlan.islands.map((island) => ({
      sourceId: island.id,
      authoredAssetId: REPEATED_AUTHORED_ISLAND_ENTRY.assetId,
      assetRevision: REPEATED_AUTHORED_ISLAND_ENTRY.revision,
      center: island.center,
    })),
    shoals: [],
    config,
  });
  const result = compileAuthoredMapV1(definition, { config, availableAuthoredIslandCatalog });
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  return Object.freeze({ definition, compiled: result.value });
}
