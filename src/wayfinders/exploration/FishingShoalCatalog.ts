import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import { seededValue } from "../world/SeededRandom";
import { TerrainType } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";
import type { WorldAnalysisIndex } from "../world/analysis";
import {
  FISHING_SHOAL_CLUE_KINDS,
  FISHING_SHOAL_CONTENT_VERSION,
  FISHING_SHOAL_QUALITIES,
  createFishingShoalId,
  type FishingShoalClue,
  type FishingShoalClueIntensity,
  type FishingShoalDefinition,
} from "./FishingShoalContracts";

const CATALOG_NAMESPACE = 904_321;
export const FISHING_SHOAL_HOME_EXCLUSION_TILES = 18;
export const FISHING_SHOAL_MINIMUM_SEPARATION_TILES = 14;

export type FishingShoalPlacementRejection =
  | "blocked"
  | "outside-home-component"
  | "occupied"
  | "home-exclusion"
  | "non-ocean"
  | "shoal-separation";

interface RankedCandidate {
  index: number;
  tile: GridPoint;
  rank: number;
}

export const FISHING_SHOAL_CLUE_LABELS: Readonly<
  Record<(typeof FISHING_SHOAL_CLUE_KINDS)[number], readonly [string, string, string]>
> = Object.freeze({
  seabirds: ["A few circling seabirds", "Seabirds gathering low", "A dense wheel of seabirds"],
  "surface-breaks": ["An occasional silver flash", "Repeated breaks at the surface", "Water flashing with movement"],
  "water-colour": ["A faint change in the water", "A distinct green-blue seam", "A broad living stain in the water"],
});

export function fishingShoalTilePlacementRejection(
  world: WorldGrid,
  index: number,
  home: GridPoint,
  isPassable: (index: number) => boolean,
  isDockReachable: (index: number) => boolean,
): Exclude<FishingShoalPlacementRejection, "shoal-separation"> | undefined {
  if (!isPassable(index)) return "blocked";
  if (!isDockReachable(index)) return "outside-home-component";
  if (world.getIslandIdAtIndex(index) >= 0 || world.getResourceIdAtIndex(index) >= 0) return "occupied";
  const tile = world.pointFromIndex(index);
  if (
    world.topology.minimumImageTileDistanceSquared(tile, home)
    < FISHING_SHOAL_HOME_EXCLUSION_TILES * FISHING_SHOAL_HOME_EXCLUSION_TILES
  ) return "home-exclusion";
  const terrain = world.getTerrain(tile.x, tile.y);
  if (terrain !== TerrainType.DeepOcean && terrain !== TerrainType.ShallowOcean) return "non-ocean";
  return undefined;
}

export function fishingShoalHasSeparationConflict(
  world: Pick<WorldGrid, "topology">,
  tile: Readonly<GridPoint>,
  otherTiles: Iterable<Readonly<GridPoint>>,
): boolean {
  for (const other of otherTiles) {
    if (
      world.topology.minimumImageTileDistanceSquared(tile, other)
      < FISHING_SHOAL_MINIMUM_SEPARATION_TILES * FISHING_SHOAL_MINIMUM_SEPARATION_TILES
    ) return true;
  }
  return false;
}

function dockReachableMask(
  world: WorldGrid,
  home: Readonly<GridPoint>,
  graph: GridGraph,
): Uint8Array {
  const reachable = new Uint8Array(world.tileCount);
  const queue = new Int32Array(world.tileCount);
  let head = 0;
  let tail = 0;
  const start = world.index(home.x, home.y);
  reachable[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    graph.forEachTraversableCardinalEdge(queue[head++], (neighbor) => {
      if (reachable[neighbor]) return;
      reachable[neighbor] = 1;
      queue[tail++] = neighbor;
    });
  }
  return reachable;
}

export function fishingShoalClueForStableKey(
  seed: number,
  stableKey: number,
  namespace: number,
): FishingShoalClue {
  const kindIndex = Math.min(
    FISHING_SHOAL_CLUE_KINDS.length - 1,
    Math.floor(seededValue(seed + namespace, stableKey, 31) * FISHING_SHOAL_CLUE_KINDS.length),
  );
  const intensity = (1 + Math.min(
    2,
    Math.floor(seededValue(seed + namespace, stableKey, 32) * 3),
  )) as FishingShoalClueIntensity;
  const kind = FISHING_SHOAL_CLUE_KINDS[kindIndex];
  return { kind, intensity, label: FISHING_SHOAL_CLUE_LABELS[kind][intensity - 1] };
}

/**
 * Pure content generation over semantic world data. It never writes terrain,
 * knowledge, islands or the existing discovery catalog.
 */
export function generateFishingShoalCatalog(
  world: WorldGrid,
  seed: number,
  home: GridPoint,
  contentVersion: number = FISHING_SHOAL_CONTENT_VERSION,
  config: Pick<PrototypeConfig, "navigation" | "movement" | "world"> = prototypeConfig,
  analysis?: WorldAnalysisIndex,
): readonly Readonly<FishingShoalDefinition>[] {
  if (contentVersion !== FISHING_SHOAL_CONTENT_VERSION) {
    throw new RangeError(`Unsupported fishing-shoal content version ${contentVersion}`);
  }

  if (analysis && !analysis.isCurrentFor(world)) throw new RangeError("Fishing-shoal analysis index is stale");
  const graph = analysis ? undefined : new GridGraph(world, config);
  if (!world.inBounds(home.x, home.y)) {
    throw new RangeError("Fishing-shoal home return tile is outside the world");
  }
  const homeIndex = world.index(home.x, home.y);
  if (!(analysis?.isPassable(homeIndex) ?? graph?.isNavigationNodePassable(homeIndex))) {
    throw new RangeError("Fishing-shoal home return tile is blocked");
  }
  const homeComponent = analysis?.componentIdAt(homeIndex);
  const reachable = graph === undefined ? undefined : dockReachableMask(world, home, graph);
  const isDockReachable = (index: number): boolean => analysis
    ? analysis.componentIdAt(index) === homeComponent
    : reachable?.[index] === 1;
  const candidates: RankedCandidate[] = [];
  const candidateIndices = analysis?.getPassableIndices();
  const totalCandidates = candidateIndices?.length ?? world.tileCount;
  for (let ordinal = 0; ordinal < totalCandidates; ordinal++) {
    const index = candidateIndices?.[ordinal] ?? ordinal;
    const rejection = fishingShoalTilePlacementRejection(
      world,
      index,
      home,
      (candidateIndex) => analysis?.isPassable(candidateIndex)
        ?? graph?.isNavigationNodePassable(candidateIndex)
        ?? false,
      isDockReachable,
    );
    if (rejection) continue;
    const tile = world.pointFromIndex(index);
    candidates.push({
      index,
      tile,
      rank: seededValue(seed + CATALOG_NAMESPACE, index, contentVersion),
    });
  }
  candidates.sort((left, right) => left.rank - right.rank || left.index - right.index);

  const selected: RankedCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.length >= config.world.fishingShoalCount) break;
    if (fishingShoalHasSeparationConflict(world, candidate.tile, selected.map(({ tile }) => tile))) {
      continue;
    }
    selected.push(candidate);
  }

  return Object.freeze(selected.map((candidate, ordinal): Readonly<FishingShoalDefinition> => {
    const qualityIndex = Math.min(
      FISHING_SHOAL_QUALITIES.length - 1,
      Math.floor(seededValue(seed + CATALOG_NAMESPACE, candidate.index, 21) * FISHING_SHOAL_QUALITIES.length),
    );
    const tile = Object.freeze({ ...candidate.tile });
    return Object.freeze({
      id: createFishingShoalId(ordinal),
      contentVersion: FISHING_SHOAL_CONTENT_VERSION,
      tile,
      serviceAnchor: tile,
      quality: FISHING_SHOAL_QUALITIES[qualityIndex],
      clue: Object.freeze(fishingShoalClueForStableKey(seed, candidate.index, CATALOG_NAMESPACE)),
    });
  }));
}
