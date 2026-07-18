import type { GridPoint } from "../../core/types";
import type { TerrainType } from "../TileData";

/** Inclusive, integer tile bounds. */
export interface WorldTileBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type CoastlineKind = "coastal-water" | "island-shore";

export interface WorldAnalysisBuildOptions {
  /**
   * Defaults to WorldGrid coarse movement passability. Generation may inject
   * the exact navigation predicate without coupling this index to GridGraph.
   */
  readonly isPassable?: (index: number, tile: Readonly<GridPoint>) => boolean;
  /** Stable generator/manifest identifier recorded with the derived facts. */
  readonly sourceId?: string;
  /** Stable generator/manifest revision recorded with the derived facts. */
  readonly sourceRevision?: string | number;
}

export interface WorldAnalysisProvenance {
  readonly sourceId: string;
  readonly sourceRevision?: string | number;
  readonly width: number;
  readonly height: number;
  readonly terrainVersion: number;
  readonly collisionVersion: number;
}

export interface WorldAnalysisBuildDiagnostics {
  /** Grid getters are read in one row-major source pass. */
  readonly sourceGridScans: 1;
  readonly sourceCellsRead: number;
  readonly passableTileCount: number;
  readonly blockedTileCount: number;
  readonly coastalWaterTileCount: number;
  readonly islandShoreTileCount: number;
  readonly connectedComponentCount: number;
  readonly cardinalNeighborChecks: number;
}

export interface WorldWaterComponentFacts {
  /** Component IDs start at one and are assigned by first row-major tile. */
  readonly id: number;
  readonly tileCount: number;
  readonly bounds: Readonly<WorldTileBounds>;
}

export interface WorldCoastlineRun {
  readonly kind: CoastlineKind;
  readonly y: number;
  readonly startX: number;
  readonly endX: number;
}

export interface WorldAnalysisTileQuery {
  /** Canonical or lifted bounds, decomposed through the analyzed world topology. */
  readonly bounds?: Readonly<WorldTileBounds>;
  readonly terrain?: TerrainType;
  readonly islandId?: number;
  readonly passable?: boolean;
  readonly coastline?: CoastlineKind;
  readonly componentId?: number;
}

export type WorldAnalysisQuerySource =
  | "world"
  | "bounds"
  | "terrain"
  | "island"
  | "passable"
  | "blocked"
  | "coastline"
  | "component";

export interface WorldAnalysisQueryCounters {
  /** The smallest available pre-indexed candidate set selected for filtering. */
  readonly source: WorldAnalysisQuerySource;
  readonly tilesExamined: number;
  readonly tilesMatched: number;
}

export interface WorldAnalysisQueryTotals {
  readonly queryCount: number;
  readonly tilesExamined: number;
  readonly tilesMatched: number;
}

export interface WorldAnalysisQueryResult {
  /** Stable world indices (row-major queries; rank then index for top-k). */
  readonly indices: readonly number[];
  readonly counters: Readonly<WorldAnalysisQueryCounters>;
}
