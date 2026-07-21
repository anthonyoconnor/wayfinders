import type { GridPoint } from "../../core/types";
import type { WorldTopologyDefinition } from "../WorldTopology";
import type { GeneratedWorld, PlannedWorld } from "../WorldGenerator";

export const AUTHORED_WORLD_LAYOUT_CONTRACT_VERSION = 1 as const;
/** WorldChunk stores authoritative island identity in a signed Int32Array. */
export const AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID = 0x7fff_ffff as const;

export interface AuthoredWorldLayoutDimensionsV1 {
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
  readonly tileSize: number;
  readonly artTileSize: number;
}

export interface AuthoredWorldIslandV1 {
  readonly sourceId: number;
  readonly authoredAssetId: string;
  readonly assetRevision: string;
  readonly center: Readonly<GridPoint>;
}

/** Editable world-owned portion of one app-level authored map definition. */
export interface AuthoredWorldLayoutV1 {
  readonly contractVersion: typeof AUTHORED_WORLD_LAYOUT_CONTRACT_VERSION;
  readonly settingsFingerprint: string;
  readonly generatorVersion: string;
  readonly dimensions: Readonly<AuthoredWorldLayoutDimensionsV1>;
  readonly topology: Readonly<WorldTopologyDefinition>;
  readonly baseSeed: number;
  readonly islands: readonly Readonly<AuthoredWorldIslandV1>[];
}

export type AuthoredWorldDiagnosticCode =
  | "unsupported-layout-contract"
  | "stale-layout-settings"
  | "stale-generator-contract"
  | "incompatible-world-shape"
  | "invalid-base-seed"
  | "missing-island"
  | "invalid-island-source-id"
  | "duplicate-island-source-id"
  | "invalid-island-center"
  | "missing-island-asset"
  | "stale-island-asset"
  | "island-footprint-too-large"
  | "home-clearance"
  | "starter-lane"
  | "island-channel"
  | "world-rasterization";

export interface AuthoredWorldDiagnosticV1 {
  readonly code: AuthoredWorldDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly sourceId?: number;
  readonly tile?: Readonly<GridPoint>;
}

export interface CompiledAuthoredWorldV1 {
  readonly plan: Readonly<PlannedWorld>;
  readonly generated: Readonly<GeneratedWorld>;
}

export type AuthoredWorldCompileResultV1 =
  | Readonly<{ readonly ok: true; readonly value: Readonly<CompiledAuthoredWorldV1> }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly Readonly<AuthoredWorldDiagnosticV1>[];
    }>;
