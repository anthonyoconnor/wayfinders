import type { GridPoint } from "../core/types";

/** Minimal placement shape kept separate from terrain-painting concerns. */
export interface IslandPlacementCircle {
  readonly id: number;
  readonly center: GridPoint;
  readonly outerRadius: number;
}

export interface IslandPlacementIndexStats {
  readonly islandCount: number;
  readonly bucketCount: number;
  readonly queryCount: number;
  readonly candidateChecks: number;
  readonly maximumCandidatesPerQuery: number;
}

/**
 * Deterministic centre-bucket index used while laying out islands.
 *
 * Each island is stored once. Queries expand by the largest possible existing
 * radius, so the final Euclidean check is exactly equivalent to comparing a
 * candidate with every previously placed island without paying that O(n) cost.
 */
export class IslandPlacementIndex {
  private readonly buckets = new Map<string, IslandPlacementCircle[]>();
  private islandCount = 0;
  private queryCount = 0;
  private candidateChecks = 0;
  private maximumCandidatesPerQuery = 0;
  private readonly cellSize: number;

  constructor(
    private readonly maximumOuterRadius: number,
    private readonly minimumChannelWidth: number,
  ) {
    if (!Number.isFinite(maximumOuterRadius) || maximumOuterRadius <= 0) {
      throw new RangeError("maximumOuterRadius must be positive");
    }
    if (!Number.isFinite(minimumChannelWidth) || minimumChannelWidth < 0) {
      throw new RangeError("minimumChannelWidth must be non-negative");
    }
    this.cellSize = Math.max(1, Math.ceil(maximumOuterRadius + minimumChannelWidth));
  }

  add(island: IslandPlacementCircle): void {
    const key = this.bucketKey(
      this.cellCoordinate(island.center.x),
      this.cellCoordinate(island.center.y),
    );
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(island);
    this.islandCount++;
  }

  /** Returns any exact channel conflict, or undefined when the centre is valid. */
  findConflict(center: GridPoint, outerRadius: number): IslandPlacementCircle | undefined {
    this.queryCount++;
    const searchRadius = outerRadius + this.maximumOuterRadius + this.minimumChannelWidth;
    const minCellX = this.cellCoordinate(center.x - searchRadius);
    const maxCellX = this.cellCoordinate(center.x + searchRadius);
    const minCellY = this.cellCoordinate(center.y - searchRadius);
    const maxCellY = this.cellCoordinate(center.y + searchRadius);
    let checkedThisQuery = 0;

    // Stable row-major traversal plus insertion-ordered buckets keeps diagnostics
    // reproducible even if callers later need the conflicting island identity.
    for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const bucket = this.buckets.get(this.bucketKey(cellX, cellY));
        if (!bucket) continue;
        for (const other of bucket) {
          checkedThisQuery++;
          this.candidateChecks++;
          const requiredDistance = outerRadius + other.outerRadius + this.minimumChannelWidth;
          if (Math.hypot(center.x - other.center.x, center.y - other.center.y) < requiredDistance) {
            this.maximumCandidatesPerQuery = Math.max(this.maximumCandidatesPerQuery, checkedThisQuery);
            return other;
          }
        }
      }
    }

    this.maximumCandidatesPerQuery = Math.max(this.maximumCandidatesPerQuery, checkedThisQuery);
    return undefined;
  }

  diagnostics(): IslandPlacementIndexStats {
    return Object.freeze({
      islandCount: this.islandCount,
      bucketCount: this.buckets.size,
      queryCount: this.queryCount,
      candidateChecks: this.candidateChecks,
      maximumCandidatesPerQuery: this.maximumCandidatesPerQuery,
    });
  }

  private cellCoordinate(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private bucketKey(cellX: number, cellY: number): string {
    return `${cellX},${cellY}`;
  }
}
