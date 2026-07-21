import type { GridPoint } from "../../core/types";
import {
  FISHING_SHOAL_HOME_EXCLUSION_TILES,
  FISHING_SHOAL_MINIMUM_SEPARATION_TILES,
  fishingShoalClueForStableKey,
  fishingShoalHasSeparationConflict,
  fishingShoalTilePlacementRejection,
  type FishingShoalPlacementRejection,
} from "../../exploration/FishingShoalCatalog";
import {
  FISHING_SHOAL_CONTENT_VERSION,
  FISHING_SHOAL_MAX_ORDINAL,
  FISHING_SHOAL_QUALITIES,
  isCurrentFishingShoalId,
  type FishingShoalClue,
  type FishingShoalDefinition,
  type FishingShoalId,
  type FishingShoalQuality,
} from "../../exploration/FishingShoalContracts";
import type { WorldGrid } from "../../world/WorldGrid";
import type { WorldAnalysisIndex } from "../../world/analysis";
import {
  AUTHORED_FISHING_LAYOUT_CONTRACT_VERSION,
  type AuthoredFishingCompileResultV1,
  type AuthoredFishingDiagnosticV1,
  type AuthoredFishingLayoutV1,
  type AuthoredFishingShoalV1,
} from "./AuthoredFishingLayoutContracts";

const AUTHORED_FISHING_CLUE_NAMESPACE = 1_904_327;

export function createAuthoredFishingShoalClueV1(
  baseSeed: number,
  id: FishingShoalId,
): Readonly<FishingShoalClue> {
  if (!Number.isSafeInteger(baseSeed)) throw new RangeError("Authored fishing clue seed must be a safe integer");
  if (!isCurrentFishingShoalId(id)) throw new RangeError("Authored fishing clue requires a current fishing-shoal ID");
  return Object.freeze(fishingShoalClueForStableKey(
    baseSeed,
    stableStringHash(id),
    AUTHORED_FISHING_CLUE_NAMESPACE,
  ));
}

export function createAuthoredFishingShoalV1(
  baseSeed: number,
  id: FishingShoalId,
  tile: Readonly<GridPoint>,
  quality: FishingShoalQuality,
): Readonly<AuthoredFishingShoalV1> {
  return Object.freeze({
    id,
    tile: Object.freeze({ ...tile }),
    quality,
    clue: createAuthoredFishingShoalClueV1(baseSeed, id),
  });
}

export function createCurrentAuthoredFishingLayoutV1(
  shoals: readonly Readonly<AuthoredFishingShoalV1>[],
): Readonly<AuthoredFishingLayoutV1> {
  return Object.freeze({
    contractVersion: AUTHORED_FISHING_LAYOUT_CONTRACT_VERSION,
    contentVersion: FISHING_SHOAL_CONTENT_VERSION,
    shoals: Object.freeze(shoals.map((shoal) => Object.freeze({
      ...shoal,
      tile: Object.freeze({ ...shoal.tile }),
      clue: Object.freeze({ ...shoal.clue }),
    })).sort((left, right) => left.id.localeCompare(right.id, "en"))),
  });
}

export function authoredFishingShoalPlacementRejectionV1(
  world: WorldGrid,
  analysis: Readonly<WorldAnalysisIndex>,
  homeReturnTile: Readonly<GridPoint>,
  tile: Readonly<GridPoint>,
  otherTiles: Iterable<Readonly<GridPoint>> = [],
): FishingShoalPlacementRejection | "invalid-tile" | "stale-world-analysis" | undefined {
  if (!analysis.isCurrentFor(world)) return "stale-world-analysis";
  if (
    !Number.isSafeInteger(tile.x)
    || !Number.isSafeInteger(tile.y)
    || !world.topology.isCanonicalTile(tile.x, tile.y)
  ) return "invalid-tile";
  const homeIndex = world.inBounds(homeReturnTile.x, homeReturnTile.y)
    ? world.index(homeReturnTile.x, homeReturnTile.y)
    : undefined;
  if (homeIndex === undefined || !analysis.isPassable(homeIndex)) return "outside-home-component";
  const homeComponent = analysis.componentIdAt(homeIndex);
  const index = world.index(tile.x, tile.y);
  const rejection = fishingShoalTilePlacementRejection(
    world,
    index,
    homeReturnTile,
    (candidateIndex) => analysis.isPassable(candidateIndex),
    (candidateIndex) => analysis.componentIdAt(candidateIndex) === homeComponent,
  );
  if (rejection) return rejection;
  return fishingShoalHasSeparationConflict(world, tile, otherTiles)
    ? "shoal-separation"
    : undefined;
}

export function compileAuthoredFishingLayoutV1(
  layout: Readonly<AuthoredFishingLayoutV1>,
  baseSeed: number,
  world: WorldGrid,
  analysis: Readonly<WorldAnalysisIndex>,
  homeReturnTile: Readonly<GridPoint>,
): AuthoredFishingCompileResultV1 {
  const diagnostics: AuthoredFishingDiagnosticV1[] = [];
  if (layout.contractVersion !== AUTHORED_FISHING_LAYOUT_CONTRACT_VERSION) {
    diagnostics.push({
      code: "unsupported-layout-contract",
      path: "$.fishing.contractVersion",
      message: `unsupported version ${layout.contractVersion}; expected ${AUTHORED_FISHING_LAYOUT_CONTRACT_VERSION}`,
    });
  }
  if (layout.contentVersion !== FISHING_SHOAL_CONTENT_VERSION) {
    diagnostics.push({
      code: "stale-content-contract",
      path: "$.fishing.contentVersion",
      message: `requires ${layout.contentVersion}; current fishing content is ${FISHING_SHOAL_CONTENT_VERSION}`,
    });
  }
  if (!analysis.isCurrentFor(world)) {
    diagnostics.push({
      code: "stale-world-analysis",
      path: "$.fishing",
      message: "world analysis is stale for the compiled terrain",
    });
  }
  if (diagnostics.length > 0) return failed(diagnostics);

  const ordered = layout.shoals
    .map((shoal, sourceIndex) => ({ shoal, sourceIndex }))
    .sort((left, right) => (
      left.shoal.id.localeCompare(right.shoal.id, "en")
      || left.sourceIndex - right.sourceIndex
    ));
  const seenIds = new Set<string>();
  const seenTiles = new Set<number>();
  const separationIndex = new AuthoredFishingSeparationIndexV1(world);
  const definitions: FishingShoalDefinition[] = [];
  for (const { shoal, sourceIndex } of ordered) {
    const path = `$.fishing.shoals[${sourceIndex}]`;
    if (!isCurrentFishingShoalId(shoal.id)) {
      diagnostics.push(issue("invalid-id", `${path}.id`, "must be a current fishing-shoal ID", shoal));
      continue;
    }
    if (seenIds.has(shoal.id)) {
      diagnostics.push(issue("duplicate-id", `${path}.id`, `duplicates fishing shoal ${shoal.id}`, shoal));
      continue;
    }
    seenIds.add(shoal.id);
    if (!FISHING_SHOAL_QUALITIES.includes(shoal.quality)) {
      diagnostics.push(issue("invalid-quality", `${path}.quality`, "must be lean, steady, or rich", shoal));
      continue;
    }
    const expectedClue = createAuthoredFishingShoalClueV1(baseSeed, shoal.id);
    if (!sameClue(shoal.clue, expectedClue)) {
      diagnostics.push(issue(
        "invalid-clue",
        `${path}.clue`,
        "must match the clue materialized from base seed and stable shoal ID",
        shoal,
      ));
      continue;
    }
    if (
      !Number.isSafeInteger(shoal.tile.x)
      || !Number.isSafeInteger(shoal.tile.y)
      || !world.topology.isCanonicalTile(shoal.tile.x, shoal.tile.y)
    ) {
      diagnostics.push(issue("invalid-tile", `${path}.tile`, "must be a canonical integer tile", shoal));
      continue;
    }
    const tileIndex = world.index(shoal.tile.x, shoal.tile.y);
    if (seenTiles.has(tileIndex)) {
      diagnostics.push(issue("duplicate-tile", `${path}.tile`, "duplicates another fishing-shoal tile", shoal));
      continue;
    }
    seenTiles.add(tileIndex);
    const rejection = authoredFishingShoalPlacementRejectionV1(
      world,
      analysis,
      homeReturnTile,
      shoal.tile,
    ) ?? (separationIndex.hasConflict(shoal.tile) ? "shoal-separation" : undefined);
    if (rejection) {
      diagnostics.push(issue(rejection, `${path}.tile`, placementMessage(rejection), shoal));
      continue;
    }
    const tile = Object.freeze({ ...shoal.tile });
    separationIndex.add(tile);
    definitions.push(Object.freeze({
      id: shoal.id,
      contentVersion: FISHING_SHOAL_CONTENT_VERSION,
      tile,
      serviceAnchor: tile,
      quality: shoal.quality,
      clue: Object.freeze({ ...shoal.clue }),
    }));
  }
  if (diagnostics.length > 0) return failed(diagnostics);
  return Object.freeze({ ok: true, definitions: Object.freeze(definitions) });
}

/**
 * Fixed-radius topology-aware buckets keep dense authored validation linear in
 * the number of shoals while preserving the exact minimum-image distance rule.
 */
export class AuthoredFishingSeparationIndexV1 {
  private readonly columns: number;
  private readonly rows: number;
  private readonly buckets = new Map<number, GridPoint[]>();

  constructor(private readonly world: WorldGrid) {
    // Uniformly scale the buckets around each periodic axis. A final short
    // ceil-sized bucket would make the penultimate bucket geometrically
    // adjacent to bucket zero across the seam even though it is two bucket
    // indices away, allowing a minimum-image conflict to escape the 3x3 query.
    this.columns = Math.max(1, Math.floor(
      world.width / FISHING_SHOAL_MINIMUM_SEPARATION_TILES,
    ));
    this.rows = Math.max(1, Math.floor(
      world.height / FISHING_SHOAL_MINIMUM_SEPARATION_TILES,
    ));
  }

  add(tile: Readonly<GridPoint>): void {
    const key = this.keyForTile(tile);
    const bucket = this.buckets.get(key);
    const point = { ...tile };
    if (bucket) bucket.push(point);
    else this.buckets.set(key, [point]);
  }

  hasConflict(tile: Readonly<GridPoint>): boolean {
    const centreX = this.bucketCoordinate(tile.x, this.world.width, this.columns);
    const centreY = this.bucketCoordinate(tile.y, this.world.height, this.rows);
    const visited = new Set<number>();
    for (let dy = -1; dy <= 1; dy++) {
      const bucketY = this.canonicalBucket(centreY + dy, this.rows, this.world.topology.wrapsY);
      if (bucketY === undefined) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const bucketX = this.canonicalBucket(centreX + dx, this.columns, this.world.topology.wrapsX);
        if (bucketX === undefined) continue;
        const key = bucketY * this.columns + bucketX;
        if (visited.has(key)) continue;
        visited.add(key);
        const bucket = this.buckets.get(key);
        if (!bucket) continue;
        for (const other of bucket) {
          if (
            this.world.topology.minimumImageTileDistanceSquared(tile, other)
            < FISHING_SHOAL_MINIMUM_SEPARATION_TILES ** 2
          ) return true;
        }
      }
    }
    return false;
  }

  private keyForTile(tile: Readonly<GridPoint>): number {
    return this.bucketCoordinate(tile.y, this.world.height, this.rows) * this.columns
      + this.bucketCoordinate(tile.x, this.world.width, this.columns);
  }

  private bucketCoordinate(value: number, worldSpan: number, bucketSpan: number): number {
    return Math.min(bucketSpan - 1, Math.floor(value * bucketSpan / worldSpan));
  }

  private canonicalBucket(value: number, span: number, wraps: boolean): number | undefined {
    if (value >= 0 && value < span) return value;
    if (!wraps) return undefined;
    return ((value % span) + span) % span;
  }
}

export interface AuthoredFishingCapacityProofV1 {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly minimumSeparation: number;
  readonly proofCellSpan: number;
  readonly maximumShoalCount: number;
  readonly availableIdCount: number;
}

/** Conservative proof only; authored shoal placement remains count-free. */
export function authoredFishingCapacityProofV1(
  width: number,
  height: number,
): Readonly<AuthoredFishingCapacityProofV1> {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError("Fishing capacity proof requires positive safe-integer dimensions");
  }
  let proofCellSpan = 1;
  while (Math.hypot(proofCellSpan, proofCellSpan) < FISHING_SHOAL_MINIMUM_SEPARATION_TILES) {
    proofCellSpan++;
  }
  return Object.freeze({
    worldWidth: width,
    worldHeight: height,
    minimumSeparation: FISHING_SHOAL_MINIMUM_SEPARATION_TILES,
    proofCellSpan,
    maximumShoalCount: Math.ceil(width / proofCellSpan) * Math.ceil(height / proofCellSpan),
    availableIdCount: FISHING_SHOAL_MAX_ORDINAL + 1,
  });
}

export {
  FISHING_SHOAL_HOME_EXCLUSION_TILES,
  FISHING_SHOAL_MINIMUM_SEPARATION_TILES,
};

function sameClue(left: Readonly<FishingShoalClue>, right: Readonly<FishingShoalClue>): boolean {
  return left.kind === right.kind && left.intensity === right.intensity && left.label === right.label;
}

function stableStringHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function issue(
  code: AuthoredFishingDiagnosticV1["code"],
  path: string,
  message: string,
  shoal: Readonly<AuthoredFishingShoalV1>,
): AuthoredFishingDiagnosticV1 {
  return {
    code,
    path,
    message,
    shoalId: String(shoal.id),
    tile: Object.freeze({ ...shoal.tile }),
  };
}

function failed(
  diagnostics: readonly Readonly<AuthoredFishingDiagnosticV1>[],
): AuthoredFishingCompileResultV1 {
  return Object.freeze({ ok: false, diagnostics: Object.freeze([...diagnostics]) });
}

function placementMessage(
  code: FishingShoalPlacementRejection | "invalid-tile" | "stale-world-analysis",
): string {
  switch (code) {
    case "blocked": return "tile is not navigation-passable";
    case "outside-home-component": return "tile is outside the Home dock ocean component";
    case "occupied": return "tile contains island or resource identity";
    case "home-exclusion": return `tile is within ${FISHING_SHOAL_HOME_EXCLUSION_TILES} tiles of Home`;
    case "non-ocean": return "tile is not deep or shallow ocean";
    case "shoal-separation": return `tile is within ${FISHING_SHOAL_MINIMUM_SEPARATION_TILES} tiles of another shoal`;
    case "invalid-tile": return "tile must be a canonical integer coordinate";
    case "stale-world-analysis": return "world analysis is stale for the compiled terrain";
  }
}
