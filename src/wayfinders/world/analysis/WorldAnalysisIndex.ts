import type { GridPoint } from "../../core/types";
import { TerrainType } from "../TileData";
import type { WorldGrid } from "../WorldGrid";
import type { WorldTopology } from "../WorldTopology";
import type {
  CoastlineKind,
  WorldAnalysisBuildDiagnostics,
  WorldAnalysisBuildOptions,
  WorldAnalysisProvenance,
  WorldAnalysisQueryCounters,
  WorldAnalysisQueryResult,
  WorldAnalysisQuerySource,
  WorldAnalysisQueryTotals,
  WorldAnalysisTileQuery,
  WorldCoastlineRun,
  WorldTileBounds,
  WorldWaterComponentFacts,
} from "./WorldAnalysisContracts";

interface CandidateSource {
  readonly source: WorldAnalysisQuerySource;
  readonly indices: readonly number[];
}

const EMPTY_INDICES: readonly number[] = Object.freeze([]);
const TERRAIN_TYPES = Object.freeze([
  TerrainType.DeepOcean,
  TerrainType.ShallowOcean,
  TerrainType.Reef,
  TerrainType.Rock,
  TerrainType.Land,
]);

/**
 * Immutable derived topology and placement facts for one logical world.
 *
 * Construction is the only operation that reads the complete WorldGrid.
 * Queries use row-major indexes, component membership, or bounded coordinates;
 * they never call back into the grid and cannot mutate the captured facts.
 */
export class WorldAnalysisIndex {
  private readonly topology: WorldTopology;
  private readonly terrainByIndex: Uint8Array;
  private readonly islandByIndex: Int32Array;
  private readonly passableMask: Uint8Array;
  private readonly coastalWaterMask: Uint8Array;
  private readonly islandShoreMask: Uint8Array;
  private readonly componentByIndex: Uint32Array;
  private readonly allIndices: readonly number[];
  private readonly passableIndices: readonly number[];
  private readonly blockedIndices: readonly number[];
  private readonly coastalWaterIndices: readonly number[];
  private readonly islandShoreIndices: readonly number[];
  private readonly terrainIndices: ReadonlyMap<TerrainType, readonly number[]>;
  private readonly islandIndices: ReadonlyMap<number, readonly number[]>;
  private readonly componentIndices: ReadonlyMap<number, readonly number[]>;
  private readonly componentFactsById: ReadonlyMap<number, Readonly<WorldWaterComponentFacts>>;
  private readonly coastlineRunsByKind: ReadonlyMap<CoastlineKind, readonly Readonly<WorldCoastlineRun>[]>;
  private queryCount = 0;
  private queriedTiles = 0;
  private matchedTiles = 0;

  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  readonly provenance: Readonly<WorldAnalysisProvenance>;
  readonly buildDiagnostics: Readonly<WorldAnalysisBuildDiagnostics>;

  private constructor(
    world: WorldGrid,
    options: Readonly<WorldAnalysisBuildOptions>,
  ) {
    this.width = world.width;
    this.height = world.height;
    this.tileCount = world.tileCount;
    this.topology = world.topology;
    this.terrainByIndex = new Uint8Array(this.tileCount);
    this.islandByIndex = new Int32Array(this.tileCount);
    this.passableMask = new Uint8Array(this.tileCount);
    this.coastalWaterMask = new Uint8Array(this.tileCount);
    this.islandShoreMask = new Uint8Array(this.tileCount);
    this.componentByIndex = new Uint32Array(this.tileCount);

    const all: number[] = [];
    const passable: number[] = [];
    const blocked: number[] = [];
    const terrainBuckets = new Map<TerrainType, number[]>();
    const islandBuckets = new Map<number, number[]>();
    for (const terrain of TERRAIN_TYPES) terrainBuckets.set(terrain, []);

    const passability = options.isPassable
      ?? ((index: number): boolean => !world.isMovementBlockedAtIndex(index));

    // The sole source-grid scan. All later derivation operates on local arrays.
    for (let index = 0; index < this.tileCount; index++) {
      const tile = { x: index % this.width, y: Math.floor(index / this.width) };
      const terrain = world.getTerrain(tile.x, tile.y);
      const islandId = world.getIslandIdAtIndex(index);
      const isPassable = passability(index, tile);
      this.terrainByIndex[index] = terrain;
      this.islandByIndex[index] = islandId;
      this.passableMask[index] = isPassable ? 1 : 0;
      all.push(index);
      (isPassable ? passable : blocked).push(index);
      terrainBuckets.get(terrain)?.push(index);
      if (islandId >= 0) {
        const indices = islandBuckets.get(islandId) ?? [];
        indices.push(index);
        islandBuckets.set(islandId, indices);
      }
    }

    let cardinalNeighborChecks = 0;
    const coastalWater: number[] = [];
    const islandShore: number[] = [];
    const cardinalNeighborScratch = new Int32Array(4);
    const wrapsX = this.topology.wrapsX;
    const wrapsY = this.topology.wrapsY;
    for (let index = 0; index < this.tileCount; index++) {
      const islandId = this.islandByIndex[index];
      let bordersIsland = false;
      let bordersPassable = false;
      const neighborCount = writeUniqueCardinalNeighborIndices(
        index,
        this.width,
        this.height,
        wrapsX,
        wrapsY,
        cardinalNeighborScratch,
      );
      for (let neighborOffset = 0; neighborOffset < neighborCount; neighborOffset++) {
        const neighbor = cardinalNeighborScratch[neighborOffset];
        cardinalNeighborChecks++;
        if (this.islandByIndex[neighbor] >= 0) bordersIsland = true;
        if (this.passableMask[neighbor] !== 0) bordersPassable = true;
      }
      if (this.passableMask[index] !== 0 && islandId < 0 && bordersIsland) {
        this.coastalWaterMask[index] = 1;
        coastalWater.push(index);
      }
      if (islandId >= 0 && bordersPassable) {
        this.islandShoreMask[index] = 1;
        islandShore.push(index);
      }
    }

    const componentMembers = new Map<number, number[]>();
    const componentFacts = new Map<number, Readonly<WorldWaterComponentFacts>>();
    const queue = new Int32Array(this.tileCount);
    let componentId = 0;
    for (const start of passable) {
      if (this.componentByIndex[start] !== 0) continue;
      componentId++;
      let head = 0;
      let tail = 0;
      let minX = this.width;
      let minY = this.height;
      let maxX = -1;
      let maxY = -1;
      const members: number[] = [];
      this.componentByIndex[start] = componentId;
      queue[tail++] = start;
      while (head < tail) {
        const index = queue[head++];
        const x = index % this.width;
        const y = Math.floor(index / this.width);
        members.push(index);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        const neighborCount = writeUniqueCardinalNeighborIndices(
          index,
          this.width,
          this.height,
          wrapsX,
          wrapsY,
          cardinalNeighborScratch,
        );
        for (let neighborOffset = 0; neighborOffset < neighborCount; neighborOffset++) {
          const neighbor = cardinalNeighborScratch[neighborOffset];
          cardinalNeighborChecks++;
          if (this.passableMask[neighbor] === 0 || this.componentByIndex[neighbor] !== 0) continue;
          this.componentByIndex[neighbor] = componentId;
          queue[tail++] = neighbor;
        }
      }
      componentMembers.set(componentId, members);
      componentFacts.set(componentId, Object.freeze({
        id: componentId,
        tileCount: members.length,
        bounds: Object.freeze({ minX, minY, maxX, maxY }),
      }));
    }

    this.allIndices = freezeNumbers(all);
    this.passableIndices = freezeNumbers(passable);
    this.blockedIndices = freezeNumbers(blocked);
    this.coastalWaterIndices = freezeNumbers(coastalWater);
    this.islandShoreIndices = freezeNumbers(islandShore);
    this.terrainIndices = freezeNumberBuckets(terrainBuckets);
    this.islandIndices = freezeNumberBuckets(islandBuckets);
    this.componentIndices = freezeNumberBuckets(componentMembers);
    this.componentFactsById = componentFacts;
    this.coastlineRunsByKind = new Map([
      ["coastal-water", buildRuns("coastal-water", this.coastalWaterMask, this.width, this.height)],
      ["island-shore", buildRuns("island-shore", this.islandShoreMask, this.width, this.height)],
    ]);
    this.provenance = Object.freeze({
      sourceId: options.sourceId ?? "runtime-world-grid",
      ...(options.sourceRevision === undefined ? {} : { sourceRevision: options.sourceRevision }),
      width: this.width,
      height: this.height,
      terrainVersion: world.terrainVersion,
      collisionVersion: world.collisionVersion,
    });
    this.buildDiagnostics = Object.freeze({
      sourceGridScans: 1,
      sourceCellsRead: this.tileCount,
      passableTileCount: this.passableIndices.length,
      blockedTileCount: this.blockedIndices.length,
      coastalWaterTileCount: this.coastalWaterIndices.length,
      islandShoreTileCount: this.islandShoreIndices.length,
      connectedComponentCount: this.componentFactsById.size,
      cardinalNeighborChecks,
    });
  }

  static build(
    world: WorldGrid,
    options: Readonly<WorldAnalysisBuildOptions> = {},
  ): WorldAnalysisIndex {
    return new WorldAnalysisIndex(world, options);
  }

  /** Detects terrain/collision staleness without rescanning the source grid. */
  isCurrentFor(world: WorldGrid): boolean {
    return world.width === this.width
      && world.height === this.height
      && world.topology.definition.x === this.topology.definition.x
      && world.topology.definition.y === this.topology.definition.y
      && world.terrainVersion === this.provenance.terrainVersion
      && world.collisionVersion === this.provenance.collisionVersion;
  }

  pointFromIndex(index: number): Readonly<GridPoint> {
    this.assertIndex(index);
    return Object.freeze({ x: index % this.width, y: Math.floor(index / this.width) });
  }

  indexOf(point: Readonly<GridPoint>): number {
    this.assertPoint(point);
    return point.y * this.width + point.x;
  }

  terrainAt(index: number): TerrainType {
    this.assertIndex(index);
    return this.terrainByIndex[index] as TerrainType;
  }

  islandIdAt(index: number): number {
    this.assertIndex(index);
    return this.islandByIndex[index];
  }

  isPassable(index: number): boolean {
    this.assertIndex(index);
    return this.passableMask[index] !== 0;
  }

  componentIdAt(pointOrIndex: Readonly<GridPoint> | number): number | undefined {
    const index = typeof pointOrIndex === "number" ? pointOrIndex : this.indexOf(pointOrIndex);
    this.assertIndex(index);
    return this.componentByIndex[index] || undefined;
  }

  areConnected(left: Readonly<GridPoint> | number, right: Readonly<GridPoint> | number): boolean {
    const leftComponent = this.componentIdAt(left);
    return leftComponent !== undefined && leftComponent === this.componentIdAt(right);
  }

  getTerrainIndices(terrain: TerrainType): readonly number[] {
    return this.terrainIndices.get(terrain) ?? EMPTY_INDICES;
  }

  getIslandIndices(islandId: number): readonly number[] {
    assertIslandId(islandId);
    return this.islandIndices.get(islandId) ?? EMPTY_INDICES;
  }

  getIslandIds(): readonly number[] {
    return Object.freeze([...this.islandIndices.keys()].sort((left, right) => left - right));
  }

  getPassableIndices(): readonly number[] {
    return this.passableIndices;
  }

  getCoastlineIndices(kind: CoastlineKind): readonly number[] {
    return kind === "coastal-water" ? this.coastalWaterIndices : this.islandShoreIndices;
  }

  getCoastlineRuns(kind: CoastlineKind): readonly Readonly<WorldCoastlineRun>[] {
    return this.coastlineRunsByKind.get(kind) ?? Object.freeze([]);
  }

  getComponentFacts(componentId: number): Readonly<WorldWaterComponentFacts> | undefined {
    assertComponentId(componentId);
    return this.componentFactsById.get(componentId);
  }

  getAllComponentFacts(): readonly Readonly<WorldWaterComponentFacts>[] {
    return Object.freeze([...this.componentFactsById.values()]);
  }

  getComponentIndices(componentId: number): readonly number[] {
    assertComponentId(componentId);
    return this.componentIndices.get(componentId) ?? EMPTY_INDICES;
  }

  /**
   * Finds candidate tiles from the smallest reusable index, then applies exact
   * filters. An optional bounds filter makes local work proportional to area.
   */
  queryTiles(query: Readonly<WorldAnalysisTileQuery> = {}): Readonly<WorldAnalysisQueryResult> {
    const bounds = query.bounds === undefined ? undefined : this.normalizeBounds(query.bounds);
    const boundsIndices = bounds === undefined ? undefined : this.indicesWithin(bounds);
    const boundsMembership = boundsIndices === undefined ? undefined : new Set(boundsIndices);
    if (query.islandId !== undefined) assertIslandId(query.islandId);
    if (query.componentId !== undefined) assertComponentId(query.componentId);
    if (query.terrain !== undefined && !this.terrainIndices.has(query.terrain)) {
      throw new RangeError(`Unknown terrain type ${query.terrain}`);
    }

    const candidates: CandidateSource[] = [{ source: "world", indices: this.allIndices }];
    if (boundsIndices) candidates.push({ source: "bounds", indices: boundsIndices });
    if (query.terrain !== undefined) {
      candidates.push({ source: "terrain", indices: this.getTerrainIndices(query.terrain) });
    }
    if (query.islandId !== undefined) {
      candidates.push({ source: "island", indices: this.getIslandIndices(query.islandId) });
    }
    if (query.passable !== undefined) {
      candidates.push({
        source: query.passable ? "passable" : "blocked",
        indices: query.passable ? this.passableIndices : this.blockedIndices,
      });
    }
    if (query.coastline !== undefined) {
      candidates.push({ source: "coastline", indices: this.getCoastlineIndices(query.coastline) });
    }
    if (query.componentId !== undefined) {
      candidates.push({ source: "component", indices: this.getComponentIndices(query.componentId) });
    }
    candidates.sort((left, right) => left.indices.length - right.indices.length);
    const selected = candidates[0];
    const matched: number[] = [];
    for (const index of selected.indices) {
      if (boundsMembership && !boundsMembership.has(index)) continue;
      if (query.terrain !== undefined && this.terrainByIndex[index] !== query.terrain) continue;
      if (query.islandId !== undefined && this.islandByIndex[index] !== query.islandId) continue;
      if (query.passable !== undefined && (this.passableMask[index] !== 0) !== query.passable) continue;
      if (query.coastline !== undefined && !this.isCoastline(index, query.coastline)) continue;
      if (query.componentId !== undefined && this.componentByIndex[index] !== query.componentId) continue;
      matched.push(index);
    }
    matched.sort((left, right) => left - right);
    return this.recordQuery(selected.source, selected.indices.length, matched);
  }

  /** Stable bounded top-k selection over indexed candidates. */
  selectTopTiles(
    query: Readonly<WorldAnalysisTileQuery>,
    limit: number,
    rank: (index: number) => number,
  ): Readonly<WorldAnalysisQueryResult> {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Tile selection limit must be a non-negative safe integer");
    const candidates = this.queryTiles(query);
    const indices = [...candidates.indices]
      .map((index) => {
        const score = rank(index);
        if (!Number.isFinite(score)) throw new RangeError(`Tile rank for index ${index} must be finite`);
        return { index, rank: score };
      })
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .slice(0, limit)
      .map(({ index }) => index);
    return Object.freeze({ indices: freezeNumbers(indices), counters: candidates.counters });
  }

  /**
   * Finds the nearest passable 3x3 service tile. A component constraint turns
   * this into a deterministic reachable-anchor lookup without a flood fill.
   */
  findServiceAnchor(
    pointOrIndex: Readonly<GridPoint> | number,
    componentId?: number,
  ): Readonly<GridPoint> | undefined {
    const source = typeof pointOrIndex === "number" ? this.pointFromIndex(pointOrIndex) : pointOrIndex;
    this.assertPoint(source);
    if (componentId !== undefined) assertComponentId(componentId);
    const candidates: Array<{ index: number; distanceSquared: number }> = [];
    for (const tile of [source, ...this.topology.uniqueEightNeighbors(source)]) {
      const index = tile.y * this.width + tile.x;
      if (this.passableMask[index] === 0) continue;
      if (componentId !== undefined && this.componentByIndex[index] !== componentId) continue;
      candidates.push({
        index,
        distanceSquared: this.topology.minimumImageTileDistanceSquared(source, tile),
      });
    }
    candidates.sort((left, right) => left.distanceSquared - right.distanceSquared || left.index - right.index);
    return candidates[0] === undefined ? undefined : this.pointFromIndex(candidates[0].index);
  }

  getQueryTotals(): Readonly<WorldAnalysisQueryTotals> {
    return Object.freeze({
      queryCount: this.queryCount,
      tilesExamined: this.queriedTiles,
      tilesMatched: this.matchedTiles,
    });
  }

  resetQueryTotals(): void {
    this.queryCount = 0;
    this.queriedTiles = 0;
    this.matchedTiles = 0;
  }

  private recordQuery(
    source: WorldAnalysisQuerySource,
    tilesExamined: number,
    indices: number[],
  ): Readonly<WorldAnalysisQueryResult> {
    const counters: Readonly<WorldAnalysisQueryCounters> = Object.freeze({
      source,
      tilesExamined,
      tilesMatched: indices.length,
    });
    this.queryCount++;
    this.queriedTiles += tilesExamined;
    this.matchedTiles += indices.length;
    return Object.freeze({ indices: freezeNumbers(indices), counters });
  }

  private isCoastline(index: number, kind: CoastlineKind): boolean {
    return (kind === "coastal-water" ? this.coastalWaterMask[index] : this.islandShoreMask[index]) !== 0;
  }

  private indicesWithin(bounds: Readonly<WorldTileBounds>): readonly number[] {
    const indices = new Set<number>();
    for (const piece of this.topology.decomposeTileBounds(bounds)) {
      for (let y = piece.minY; y <= piece.maxY; y++) {
        for (let x = piece.minX; x <= piece.maxX; x++) indices.add(y * this.width + x);
      }
    }
    return [...indices].sort((left, right) => left - right);
  }

  private normalizeBounds(bounds: Readonly<WorldTileBounds>): Readonly<WorldTileBounds> {
    for (const [name, value] of Object.entries(bounds)) {
      if (!Number.isInteger(value)) throw new RangeError(`World query ${name} must be an integer`);
    }
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
      throw new RangeError("World query bounds must not be inverted");
    }
    return bounds;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  private assertPoint(point: Readonly<GridPoint>): void {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || !this.inBounds(point.x, point.y)) {
      throw new RangeError(`World point ${point.x},${point.y} is outside the analyzed world`);
    }
  }

  private assertIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.tileCount) {
      throw new RangeError(`Invalid analyzed world index ${index}`);
    }
  }

}

/**
 * Writes unique neighbours in the public topology order: west, east, north,
 * south. The caller reuses one four-slot buffer across the analysis build, so
 * coastline and component scans create no per-tile neighbour objects or sets.
 */
function writeUniqueCardinalNeighborIndices(
  index: number,
  width: number,
  height: number,
  wrapsX: boolean,
  wrapsY: boolean,
  target: Int32Array,
): number {
  const x = index % width;
  const y = Math.floor(index / width);
  const west = x > 0
    ? index - 1
    : wrapsX && width > 1 ? index + width - 1 : -1;
  const east = x + 1 < width
    ? index + 1
    : wrapsX && width > 1 ? index - width + 1 : -1;
  const north = y > 0
    ? index - width
    : wrapsY && height > 1 ? index + width * (height - 1) : -1;
  const south = y + 1 < height
    ? index + width
    : wrapsY && height > 1 ? index - width * (height - 1) : -1;

  let count = 0;
  if (west >= 0) target[count++] = west;
  if (east >= 0 && east !== west) target[count++] = east;
  if (north >= 0 && north !== west && north !== east) target[count++] = north;
  if (south >= 0 && south !== west && south !== east && south !== north) target[count++] = south;
  return count;
}

function freezeNumbers(indices: number[]): readonly number[] {
  return Object.freeze(indices);
}

function freezeNumberBuckets<T extends number>(
  buckets: ReadonlyMap<T, number[]>,
): ReadonlyMap<T, readonly number[]> {
  const frozen = new Map<T, readonly number[]>();
  for (const [key, indices] of buckets) frozen.set(key, freezeNumbers(indices));
  return frozen;
}

function buildRuns(
  kind: CoastlineKind,
  mask: Uint8Array,
  width: number,
  height: number,
): readonly Readonly<WorldCoastlineRun>[] {
  const runs: Array<Readonly<WorldCoastlineRun>> = [];
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      while (x < width && mask[y * width + x] === 0) x++;
      if (x >= width) break;
      const startX = x;
      while (x + 1 < width && mask[y * width + x + 1] !== 0) x++;
      runs.push(Object.freeze({ kind, y, startX, endX: x }));
      x++;
    }
  }
  return Object.freeze(runs);
}

function assertIslandId(islandId: number): void {
  if (!Number.isSafeInteger(islandId) || islandId < 0) throw new RangeError(`Invalid island ID ${islandId}`);
}

function assertComponentId(componentId: number): void {
  if (!Number.isSafeInteger(componentId) || componentId <= 0) {
    throw new RangeError(`Invalid water component ID ${componentId}`);
  }
}
