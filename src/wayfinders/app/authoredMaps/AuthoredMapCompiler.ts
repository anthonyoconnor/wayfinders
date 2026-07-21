import { prototypeConfig, type PrototypeConfig } from "../../config/prototypeConfig";
import { generateIdolLocationCatalog } from "../../exploration/IdolLocationCatalog";
import { IDOL_LOCATION_CONTENT_VERSION } from "../../exploration/IdolLocationContracts";
import { generateIslandDossierCatalog } from "../../exploration/IslandDossierCatalog";
import { ISLAND_DOSSIER_CONTENT_VERSION } from "../../exploration/IslandDossierContracts";
import { generateSurveySiteCatalog } from "../../exploration/SurveySiteCatalog";
import { SURVEY_SITE_CONTENT_VERSION } from "../../exploration/SurveySiteContracts";
import {
  compileAuthoredFishingLayoutV1,
  createCurrentAuthoredFishingLayoutV1,
  type AuthoredFishingShoalV1,
} from "../../features/fishing";
import type { AuthoredIslandCatalog } from "../../world/AuthoredIslandCatalog";
import {
  compileAuthoredWorldLayoutV1,
  createCurrentAuthoredWorldLayoutV1,
  type AuthoredWorldIslandV1,
} from "../../world/authored";
import {
  AUTHORED_MAP_FORMAT_VERSION,
  AUTHORED_MAP_SOURCE_IDENTITY_CONTRACT_VERSION,
  type AuthoredMapCompileResultV1,
  type AuthoredMapDefinitionV1,
  type AuthoredMapDiagnosticV1,
  type WorldSourceIdentityV1,
} from "./AuthoredMapContracts";
import {
  AuthoredMapCatalogProjectionError,
  projectAuthoredMapCollisionCatalogV1,
} from "./AuthoredMapCatalogProjection";
import { withAuthoredMapContentFingerprintV1 } from "./AuthoredMapCodec";

export interface AuthoredMapCompilerOptionsV1 {
  readonly config?: PrototypeConfig;
  readonly availableAuthoredIslandCatalog: Readonly<AuthoredIslandCatalog>;
}

export function compileAuthoredMapV1(
  definition: Readonly<AuthoredMapDefinitionV1>,
  options: Readonly<AuthoredMapCompilerOptionsV1>,
): AuthoredMapCompileResultV1 {
  const config = options.config ?? prototypeConfig;
  const diagnostics = currentContentDiagnostics(definition);
  if (diagnostics.length > 0) return failed(definition, diagnostics);

  let collisionCatalog: Readonly<AuthoredIslandCatalog>;
  try {
    collisionCatalog = projectAuthoredMapCollisionCatalogV1(
      definition,
      options.availableAuthoredIslandCatalog,
    );
  } catch (error) {
    if (error instanceof AuthoredMapCatalogProjectionError) return failed(definition, error.diagnostics);
    return failed(definition, [{
      stage: "catalog-projection",
      code: "invalid-island-catalog",
      path: "$.world.islands",
      message: errorMessage(error),
    }]);
  }

  const sourceIdentity = createWorldSourceIdentityV1(definition, collisionCatalog.revision);
  const world = compileAuthoredWorldLayoutV1(definition.world, collisionCatalog, {
    config,
    analysisIdentity: {
      sourceId: `authored-map:${definition.id}`,
      sourceRevision: definition.contentFingerprint,
    },
  });
  if (!world.ok) {
    return failed(definition, world.diagnostics.map((diagnostic) => ({
      stage: "world",
      ...diagnostic,
    })));
  }

  const generated = world.value.generated;
  const fishing = compileAuthoredFishingLayoutV1(
    definition.fishing,
    definition.world.baseSeed,
    generated.grid,
    generated.analysis,
    generated.landmarks.homeReturnTile,
  );
  if (!fishing.ok) {
    return failed(definition, fishing.diagnostics.map((diagnostic) => ({
      stage: "fishing",
      ...diagnostic,
    })));
  }

  try {
    const islandDossierDefinitions = generateIslandDossierCatalog(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
      definition.contentVersions.islandDossier,
      config,
      generated.analysis,
    );
    const surveySiteDefinitions = generateSurveySiteCatalog(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
      definition.contentVersions.surveySite,
      config,
      generated.analysis,
    );
    const idolLocationDefinitions = generateIdolLocationCatalog(
      generated.seed,
      config.world.idolCount,
      islandDossierDefinitions,
      surveySiteDefinitions,
      definition.contentVersions.idolLocation,
    );
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        definition,
        sourceIdentity,
        collisionCatalog,
        generated,
        fishingDefinitions: fishing.definitions,
        islandDossierDefinitions,
        surveySiteDefinitions,
        idolLocationDefinitions,
      }),
    });
  } catch (error) {
    return failed(definition, [{
      stage: "initial-content",
      code: "initial-content-not-viable",
      path: "$",
      message: errorMessage(error),
    }]);
  }
}

export interface CreateCurrentAuthoredMapDefinitionInputV1 {
  readonly id: string;
  readonly displayName: string;
  readonly baseSeed: number;
  readonly islands: readonly Readonly<AuthoredWorldIslandV1>[];
  readonly shoals: readonly Readonly<AuthoredFishingShoalV1>[];
  readonly config?: PrototypeConfig;
}

export function createCurrentAuthoredMapDefinitionV1(
  input: Readonly<CreateCurrentAuthoredMapDefinitionInputV1>,
): Promise<Readonly<AuthoredMapDefinitionV1>> {
  const config = input.config ?? prototypeConfig;
  return withAuthoredMapContentFingerprintV1({
    formatVersion: AUTHORED_MAP_FORMAT_VERSION,
    id: input.id,
    displayName: input.displayName,
    contentVersions: currentAuthoredMapContentVersionsV1(),
    world: createCurrentAuthoredWorldLayoutV1(input.baseSeed, input.islands, config),
    fishing: createCurrentAuthoredFishingLayoutV1(input.shoals),
  });
}

export function currentAuthoredMapContentVersionsV1(): Readonly<{
  islandDossier: number;
  surveySite: number;
  idolLocation: number;
}> {
  return Object.freeze({
    islandDossier: ISLAND_DOSSIER_CONTENT_VERSION,
    surveySite: SURVEY_SITE_CONTENT_VERSION,
    idolLocation: IDOL_LOCATION_CONTENT_VERSION,
  });
}

function createWorldSourceIdentityV1(
  definition: Readonly<AuthoredMapDefinitionV1>,
  referencedIslandCatalogRevision: string,
): Readonly<WorldSourceIdentityV1> {
  return Object.freeze({
    contractVersion: AUTHORED_MAP_SOURCE_IDENTITY_CONTRACT_VERSION,
    kind: "authored-map",
    mapId: definition.id,
    contentFingerprint: definition.contentFingerprint,
    layoutContractVersion: definition.world.contractVersion,
    layoutSettingsFingerprint: definition.world.settingsFingerprint,
    referencedIslandCatalogRevision,
  });
}

function currentContentDiagnostics(
  definition: Readonly<AuthoredMapDefinitionV1>,
): AuthoredMapDiagnosticV1[] {
  const diagnostics: AuthoredMapDiagnosticV1[] = [];
  for (const [key, current] of [
    ["islandDossier", ISLAND_DOSSIER_CONTENT_VERSION],
    ["surveySite", SURVEY_SITE_CONTENT_VERSION],
    ["idolLocation", IDOL_LOCATION_CONTENT_VERSION],
  ] as const) {
    if (definition.contentVersions[key] === current) continue;
    diagnostics.push({
      stage: "initial-content",
      code: "stale-content-contract",
      path: `$.contentVersions.${key}`,
      message: `requires ${definition.contentVersions[key]}; current ${key} content is ${current}`,
    });
  }
  return diagnostics;
}

function failed(
  definition: Readonly<AuthoredMapDefinitionV1>,
  diagnostics: readonly Readonly<AuthoredMapDiagnosticV1>[],
): AuthoredMapCompileResultV1 {
  return Object.freeze({ ok: false, definition, diagnostics: Object.freeze([...diagnostics]) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
