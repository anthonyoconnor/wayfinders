import type { FishingShoalDefinition } from "../../exploration/FishingShoalContracts";
import type { IdolLocationDefinition } from "../../exploration/IdolLocationContracts";
import type { IslandDossierDefinitionV1 } from "../../exploration/IslandDossierContracts";
import type { SurveySiteDefinition } from "../../exploration/SurveySiteContracts";
import type { AuthoredFishingLayoutV1 } from "../../features/fishing";
import type { AuthoredIslandCatalog } from "../../world/AuthoredIslandCatalog";
import type { GeneratedWorld } from "../../world/WorldGenerator";
import type { AuthoredWorldLayoutV1 } from "../../world/authored";

export const AUTHORED_MAP_FORMAT_VERSION = 1 as const;
export const AUTHORED_MAP_SOURCE_IDENTITY_CONTRACT_VERSION = 1 as const;

export interface AuthoredMapContentVersionsV1 {
  readonly islandDossier: number;
  readonly surveySite: number;
  readonly idolLocation: number;
}

/** Strict app-owned source envelope. Collision raster data is resolved separately. */
export interface AuthoredMapDefinitionV1 {
  readonly formatVersion: typeof AUTHORED_MAP_FORMAT_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly contentFingerprint: string;
  readonly contentVersions: Readonly<AuthoredMapContentVersionsV1>;
  readonly world: Readonly<AuthoredWorldLayoutV1>;
  readonly fishing: Readonly<AuthoredFishingLayoutV1>;
}

export type AuthoredMapDefinitionInputV1 = Omit<AuthoredMapDefinitionV1, "contentFingerprint">;

/** Immutable provenance used by runtime restart, diagnostics, and analysis caches. */
export interface WorldSourceIdentityV1 {
  readonly contractVersion: typeof AUTHORED_MAP_SOURCE_IDENTITY_CONTRACT_VERSION;
  readonly kind: "authored-map";
  readonly mapId: string;
  readonly contentFingerprint: string;
  readonly layoutContractVersion: number;
  readonly layoutSettingsFingerprint: string;
  readonly referencedIslandCatalogRevision: string;
}

export type AuthoredMapDiagnosticStageV1 =
  | "catalog-projection"
  | "world"
  | "fishing"
  | "initial-content";

export interface AuthoredMapDiagnosticV1 {
  readonly stage: AuthoredMapDiagnosticStageV1;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly sourceId?: number;
  readonly shoalId?: string;
  readonly tile?: Readonly<{ readonly x: number; readonly y: number }>;
}

export interface CompiledAuthoredMapV1 {
  readonly definition: Readonly<AuthoredMapDefinitionV1>;
  readonly sourceIdentity: Readonly<WorldSourceIdentityV1>;
  readonly collisionCatalog: Readonly<AuthoredIslandCatalog>;
  readonly generated: Readonly<GeneratedWorld>;
  readonly fishingDefinitions: readonly Readonly<FishingShoalDefinition>[];
  readonly islandDossierDefinitions: readonly Readonly<IslandDossierDefinitionV1>[];
  readonly surveySiteDefinitions: readonly Readonly<SurveySiteDefinition>[];
  readonly idolLocationDefinitions: readonly Readonly<IdolLocationDefinition>[];
}

export type AuthoredMapCompileResultV1 =
  | Readonly<{ readonly ok: true; readonly value: Readonly<CompiledAuthoredMapV1> }>
  | Readonly<{
      readonly ok: false;
      readonly definition: Readonly<AuthoredMapDefinitionV1>;
      readonly diagnostics: readonly Readonly<AuthoredMapDiagnosticV1>[];
    }>;
