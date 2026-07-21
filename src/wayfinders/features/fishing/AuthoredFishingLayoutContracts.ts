import type { GridPoint } from "../../core/types";
import type {
  FishingShoalClue,
  FishingShoalDefinition,
  FishingShoalId,
  FishingShoalQuality,
} from "../../exploration/FishingShoalContracts";

export const AUTHORED_FISHING_LAYOUT_CONTRACT_VERSION = 1 as const;

export interface AuthoredFishingShoalV1 {
  readonly id: FishingShoalId;
  readonly tile: Readonly<GridPoint>;
  readonly quality: FishingShoalQuality;
  readonly clue: Readonly<FishingShoalClue>;
}

export interface AuthoredFishingLayoutV1 {
  readonly contractVersion: typeof AUTHORED_FISHING_LAYOUT_CONTRACT_VERSION;
  readonly contentVersion: number;
  readonly shoals: readonly Readonly<AuthoredFishingShoalV1>[];
}

export type AuthoredFishingDiagnosticCode =
  | "unsupported-layout-contract"
  | "stale-content-contract"
  | "invalid-id"
  | "duplicate-id"
  | "invalid-tile"
  | "duplicate-tile"
  | "invalid-quality"
  | "invalid-clue"
  | "blocked"
  | "outside-home-component"
  | "occupied"
  | "home-exclusion"
  | "non-ocean"
  | "shoal-separation"
  | "stale-world-analysis";

export interface AuthoredFishingDiagnosticV1 {
  readonly code: AuthoredFishingDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly shoalId?: string;
  readonly tile?: Readonly<GridPoint>;
}

export type AuthoredFishingCompileResultV1 =
  | Readonly<{
      readonly ok: true;
      readonly definitions: readonly Readonly<FishingShoalDefinition>[];
    }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly Readonly<AuthoredFishingDiagnosticV1>[];
    }>;
