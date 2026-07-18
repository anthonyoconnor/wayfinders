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
const DEFAULT_SHOAL_COUNT = 4;
const HOME_EXCLUSION_TILES = 18;
const MINIMUM_SEPARATION_TILES = 14;

interface RankedCandidate {
  index: number;
  tile: GridPoint;
  rank: number;
}

const CLUE_LABELS: Readonly<Record<(typeof FISHING_SHOAL_CLUE_KINDS)[number], readonly [string, string, string]>> = {
  seabirds: ["A few circling seabirds", "Seabirds gathering low", "A dense wheel of seabirds"],
  "surface-breaks": ["An occasional silver flash", "Repeated breaks at the surface", "Water flashing with movement"],
  "water-colour": ["A faint change in the water", "A distinct green-blue seam", "A broad living stain in the water"],
};

function candidateIsEligible(
  world: WorldGrid,
  graph: GridGraph | undefined,
  index: number,
  home: GridPoint,
  analysis: WorldAnalysisIndex | undefined,
  isDockReachable: (index: number) => boolean,
): GridPoint | undefined {
  if (!(analysis?.isPassable(index) ?? graph?.isNavigationNodePassable(index))) return undefined;
  if (!isDockReachable(index)) return undefined;
  if (world.getIslandIdAtIndex(index) >= 0 || world.getResourceIdAtIndex(index) >= 0) return undefined;
  const tile = world.pointFromIndex(index);
  if (
    world.topology.minimumImageTileDistanceSquared(tile, home)
    < HOME_EXCLUSION_TILES * HOME_EXCLUSION_TILES
  ) return undefined;
  const terrain = world.getTerrain(tile.x, tile.y);
  if (terrain !== TerrainType.DeepOcean && terrain !== TerrainType.ShallowOcean) return undefined;
  return tile;
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

function clueFor(seed: number, candidateIndex: number): FishingShoalClue {
  const kindIndex = Math.min(
    FISHING_SHOAL_CLUE_KINDS.length - 1,
    Math.floor(seededValue(seed + CATALOG_NAMESPACE, candidateIndex, 31) * FISHING_SHOAL_CLUE_KINDS.length),
  );
  const intensity = (1 + Math.min(
    2,
    Math.floor(seededValue(seed + CATALOG_NAMESPACE, candidateIndex, 32) * 3),
  )) as FishingShoalClueIntensity;
  const kind = FISHING_SHOAL_CLUE_KINDS[kindIndex];
  return { kind, intensity, label: CLUE_LABELS[kind][intensity - 1] };
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
  config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
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
    const tile = candidateIsEligible(world, graph, index, home, analysis, isDockReachable);
    if (!tile) continue;
    candidates.push({
      index,
      tile,
      rank: seededValue(seed + CATALOG_NAMESPACE, index, contentVersion),
    });
  }
  candidates.sort((left, right) => left.rank - right.rank || left.index - right.index);

  const selected: RankedCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.some(({ tile }) => (
      world.topology.minimumImageTileDistanceSquared(candidate.tile, tile)
      < MINIMUM_SEPARATION_TILES * MINIMUM_SEPARATION_TILES
    ))) {
      continue;
    }
    selected.push(candidate);
    if (selected.length === DEFAULT_SHOAL_COUNT) break;
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
      clue: Object.freeze(clueFor(seed, candidate.index)),
    });
  }));
}
