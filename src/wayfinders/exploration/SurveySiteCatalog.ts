import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { GridGraph } from "../navigation/GridGraph";
import {
  IslandKind,
  type GeneratedIsland,
} from "../world/IslandGenerator";
import { seededValue } from "../world/SeededRandom";
import { TerrainType } from "../world/TileData";
import type { WorldGrid } from "../world/WorldGrid";
import {
  SURVEY_SITE_CONTENT_VERSION,
  compareSurveySiteIds,
  createSurveySiteId,
  type SurveySiteClue,
  type SurveySiteDefinition,
  type SurveySiteResult,
  type SurveySiteType,
  type SurveySiteTypeDescriptor,
} from "./SurveySiteContracts";

interface RankedSiteCandidate {
  readonly index: number;
  readonly tile: GridPoint;
  readonly serviceAnchor: GridPoint;
  readonly islandId: number;
  readonly rank: number;
}

const HISTORIC_WRECK_CLUES = Object.freeze([
  Object.freeze({ id: "broken-spars", label: "Broken spars caught in the island shallows" }),
  Object.freeze({ id: "weathered-ribs", label: "Weathered hull ribs showing above the tide" }),
  Object.freeze({ id: "debris-trail", label: "A trail of old worked timber beneath the water" }),
] satisfies readonly SurveySiteClue[]);

const HISTORIC_WRECK_RESULTS = Object.freeze([
  Object.freeze({
    id: "forgotten-route",
    label: "Evidence of a forgotten sea route",
    detail: "The hull and its worn fittings belonged to sailors following a route no longer remembered at home.",
  }),
  Object.freeze({
    id: "storm-lost-merchant",
    label: "A storm-lost merchant vessel",
    detail: "Cargo fastenings and patched planks identify a trading vessel driven onto the coast generations ago.",
  }),
  Object.freeze({
    id: "foreign-tools",
    label: "Tools from an unfamiliar boatbuilding tradition",
    detail: "The surviving ironwork records techniques unlike those used by the tribe's present shipwrights.",
  }),
] satisfies readonly SurveySiteResult[]);

const COASTAL_RUIN_CLUES = Object.freeze([
  Object.freeze({ id: "carved-stones", label: "Carved stones visible beyond the strand" }),
  Object.freeze({ id: "shore-foundations", label: "Straight foundations interrupting the natural shore" }),
  Object.freeze({ id: "broken-seawall", label: "A broken wall following the old high-tide line" }),
] satisfies readonly SurveySiteClue[]);

const COASTAL_RUIN_RESULTS = Object.freeze([
  Object.freeze({
    id: "abandoned-shore-home",
    label: "An abandoned shore settlement",
    detail: "Hearth stones and post holes show that several families once made a permanent home on this coast.",
  }),
  Object.freeze({
    id: "tide-inscription",
    label: "A weathered tidal inscription",
    detail: "Repeated marks on a standing stone record seasonal water levels over many years.",
  }),
  Object.freeze({
    id: "meeting-place",
    label: "The remains of a coastal meeting place",
    detail: "A broad paved circle and worn approach suggest gatherings rather than defensive occupation.",
  }),
] satisfies readonly SurveySiteResult[]);

const TIDAL_CAVE_CLUES = Object.freeze([
  Object.freeze({ id: "dark-cleft", label: "A dark cleft opening at the waterline" }),
  Object.freeze({ id: "returning-echo", label: "An echo returning from inside the cliff" }),
  Object.freeze({ id: "cave-birds", label: "Pale shore birds vanishing into a rock opening" }),
] satisfies readonly SurveySiteClue[]);

const TIDAL_CAVE_RESULTS = Object.freeze([
  Object.freeze({
    id: "carved-tide-marks",
    label: "Old carvings above the tide line",
    detail: "Simple boat forms and tally marks survive where spray reaches but direct weather does not.",
  }),
  Object.freeze({
    id: "mineral-chamber",
    label: "A chamber of luminous mineral seams",
    detail: "Pale mineral bands catch reflected water-light and make the inner chamber glow at low tide.",
  }),
  Object.freeze({
    id: "earlier-visitors",
    label: "Evidence of earlier sheltering visitors",
    detail: "A smoke-darkened ceiling and worked shell fragments show that voyagers once waited out storms here.",
  }),
] satisfies readonly SurveySiteResult[]);

/** The only three type descriptors shipped by GP-3.3. */
export const INITIAL_SURVEY_SITE_DESCRIPTORS: readonly Readonly<SurveySiteTypeDescriptor<SurveySiteType>>[] =
  Object.freeze([
    Object.freeze({
      type: "historic-wreck",
      label: "Historic wreck",
      namespace: 1_340_017,
      count: 1,
      placement: Object.freeze({
        terrain: Object.freeze([TerrainType.ShallowOcean]),
        islandKinds: Object.freeze([
          IslandKind.Atoll,
          IslandKind.LowCay,
          IslandKind.RockySkerry,
          IslandKind.HighIsland,
        ]),
      }),
      clues: HISTORIC_WRECK_CLUES,
      results: HISTORIC_WRECK_RESULTS,
      presentation: Object.freeze({
        id: "developer.survey_site.historic_wreck.01",
        badge: "HW",
        color: 0xd3a263,
      }),
    }),
    Object.freeze({
      type: "coastal-ruin",
      label: "Coastal ruin",
      namespace: 1_340_031,
      count: 1,
      placement: Object.freeze({
        terrain: Object.freeze([TerrainType.Land]),
        islandKinds: Object.freeze([
          IslandKind.HighIsland,
          IslandKind.LowCay,
          IslandKind.Atoll,
        ]),
      }),
      clues: COASTAL_RUIN_CLUES,
      results: COASTAL_RUIN_RESULTS,
      presentation: Object.freeze({
        id: "developer.survey_site.coastal_ruin.01",
        badge: "CR",
        color: 0xc8c0a2,
      }),
    }),
    Object.freeze({
      type: "tidal-cave",
      label: "Tidal cave",
      namespace: 1_340_047,
      count: 1,
      placement: Object.freeze({
        terrain: Object.freeze([TerrainType.Rock]),
        islandKinds: Object.freeze([
          IslandKind.RockySkerry,
          IslandKind.HighIsland,
        ]),
      }),
      clues: TIDAL_CAVE_CLUES,
      results: TIDAL_CAVE_RESULTS,
      presentation: Object.freeze({
        id: "developer.survey_site.tidal_cave.01",
        badge: "TC",
        color: 0x9aa8c9,
      }),
    }),
  ]);

/** Generates the initial one-of-each GP-3.3 catalog. */
export function generateSurveySiteCatalog(
  world: WorldGrid,
  seed: number,
  islands: readonly GeneratedIsland[],
  homeReturnTile: Readonly<GridPoint>,
  contentVersion: number = SURVEY_SITE_CONTENT_VERSION,
  config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
): readonly Readonly<SurveySiteDefinition>[] {
  return generateSurveySiteCatalogFromDescriptors(
    world,
    seed,
    islands,
    homeReturnTile,
    INITIAL_SURVEY_SITE_DESCRIPTORS,
    contentVersion,
    config,
  );
}

/**
 * Generic catalog entry point used to prove that a fourth type needs only a
 * descriptor. Existing simulation commands and mutable records remain valid.
 */
export function generateSurveySiteCatalogFromDescriptors<TType extends string>(
  world: WorldGrid,
  seed: number,
  islands: readonly GeneratedIsland[],
  homeReturnTile: Readonly<GridPoint>,
  descriptors: readonly Readonly<SurveySiteTypeDescriptor<TType>>[],
  contentVersion: number = SURVEY_SITE_CONTENT_VERSION,
  config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
): readonly Readonly<SurveySiteDefinition<TType>>[] {
  if (contentVersion !== SURVEY_SITE_CONTENT_VERSION) {
    throw new RangeError(`Unsupported survey-site content version ${contentVersion}`);
  }
  if (!Number.isSafeInteger(seed)) throw new RangeError("Survey-site seed must be a safe integer");
  const graph = new GridGraph(world, config);
  if (
    !world.inBounds(homeReturnTile.x, homeReturnTile.y)
    || !graph.isNavigationNodePassable(world.index(homeReturnTile.x, homeReturnTile.y))
  ) {
    throw new RangeError("Survey-site home return tile must be an in-bounds passable tile");
  }

  validateDescriptors(descriptors);
  const islandById = new Map(islands.map((island) => [island.id, island] as const));
  const reachable = dockReachableMask(world, homeReturnTile, graph);
  const usedVisualIndices = new Set<number>();
  const usedAnchorIndices = new Set<number>();
  const usedIslandIds = new Set<number>();
  const definitions: SurveySiteDefinition<TType>[] = [];

  for (const descriptor of descriptors) {
    const candidates = buildCandidates(world, seed, descriptor, islandById, reachable);
    for (let ordinal = 0; ordinal < descriptor.count; ordinal++) {
      const unused = candidates.filter((candidate) => (
        !usedVisualIndices.has(candidate.index)
        && !usedAnchorIndices.has(world.index(candidate.serviceAnchor.x, candidate.serviceAnchor.y))
      ));
      const unusedIsland = unused.filter(({ islandId }) => !usedIslandIds.has(islandId));
      const candidate = (unusedIsland.length > 0 ? unusedIsland : unused)[0];
      if (!candidate) {
        throw new RangeError(`Unable to place survey-site type ${descriptor.type}`);
      }

      const clue = chooseContent(descriptor.clues, seed, descriptor.namespace, candidate.index, 101 + ordinal);
      const result = chooseContent(descriptor.results, seed, descriptor.namespace, candidate.index, 211 + ordinal);
      const tile = Object.freeze({ ...candidate.tile });
      const serviceAnchor = Object.freeze({ ...candidate.serviceAnchor });
      definitions.push(Object.freeze({
        id: createSurveySiteId(descriptor.type, ordinal),
        contentVersion: SURVEY_SITE_CONTENT_VERSION,
        type: descriptor.type,
        typeLabel: descriptor.label,
        islandId: candidate.islandId,
        tile,
        serviceAnchor,
        clue,
        result,
        presentation: descriptor.presentation,
      }));
      usedVisualIndices.add(candidate.index);
      usedAnchorIndices.add(world.index(serviceAnchor.x, serviceAnchor.y));
      usedIslandIds.add(candidate.islandId);
    }
  }

  definitions.sort((left, right) => compareSurveySiteIds(left.id, right.id));
  return Object.freeze(definitions);
}

function buildCandidates<TType extends string>(
  world: WorldGrid,
  seed: number,
  descriptor: Readonly<SurveySiteTypeDescriptor<TType>>,
  islandById: ReadonlyMap<number, GeneratedIsland>,
  reachable: Uint8Array,
): RankedSiteCandidate[] {
  const terrain = new Set<TerrainType>(descriptor.placement.terrain);
  const islandKinds = new Set<IslandKind>(descriptor.placement.islandKinds);
  const candidates: RankedSiteCandidate[] = [];

  for (let index = 0; index < world.tileCount; index++) {
    const islandId = world.getIslandIdAtIndex(index);
    const island = islandById.get(islandId);
    if (!island || !islandKinds.has(island.kind)) continue;
    const tile = world.pointFromIndex(index);
    if (!terrain.has(world.getTerrain(tile.x, tile.y))) continue;
    const serviceAnchor = findServiceAnchor(world, tile, reachable);
    if (!serviceAnchor) continue;
    candidates.push({
      index,
      tile,
      serviceAnchor,
      islandId,
      rank: seededValue(seed + descriptor.namespace, index, SURVEY_SITE_CONTENT_VERSION),
    });
  }

  candidates.sort((left, right) => left.rank - right.rank || left.index - right.index);
  return candidates;
}

function findServiceAnchor(
  world: WorldGrid,
  tile: Readonly<GridPoint>,
  reachable: Uint8Array,
): GridPoint | undefined {
  const candidates: Array<{ tile: GridPoint; distance: number; index: number }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const candidate = { x: tile.x + dx, y: tile.y + dy };
      if (!world.inBounds(candidate.x, candidate.y)) continue;
      const index = world.index(candidate.x, candidate.y);
      if (reachable[index] === 0) continue;
      const distance = Math.hypot(dx, dy);
      if (distance > 1.5) continue;
      candidates.push({ tile: candidate, distance, index });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || left.index - right.index);
  return candidates[0]?.tile;
}

function dockReachableMask(
  world: WorldGrid,
  home: Readonly<GridPoint>,
  graph: GridGraph,
): Uint8Array {
  const visited = new Uint8Array(world.tileCount);
  const queue = new Int32Array(world.tileCount);
  let head = 0;
  let tail = 0;
  const start = world.index(home.x, home.y);
  visited[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const index = queue[head++];
    graph.forEachTraversableCardinalNeighbor(index, (neighborIndex) => {
      if (visited[neighborIndex]) return;
      visited[neighborIndex] = 1;
      queue[tail++] = neighborIndex;
    });
  }
  return visited;
}

function chooseContent<T>(
  values: readonly Readonly<T>[],
  seed: number,
  namespace: number,
  index: number,
  slot: number,
): Readonly<T> {
  const choice = Math.min(
    values.length - 1,
    Math.floor(seededValue(seed + namespace, index, slot) * values.length),
  );
  return values[choice];
}

function validateDescriptors<TType extends string>(
  descriptors: readonly Readonly<SurveySiteTypeDescriptor<TType>>[],
): void {
  if (descriptors.length === 0) throw new RangeError("Survey-site catalog requires at least one type descriptor");
  const types = new Set<string>();
  const namespaces = new Set<number>();
  for (const descriptor of descriptors) {
    // createSurveySiteId centralizes the extensible type-ID syntax.
    createSurveySiteId(descriptor.type, 0);
    if (types.has(descriptor.type)) throw new RangeError(`Duplicate survey-site type ${descriptor.type}`);
    types.add(descriptor.type);
    if (!Number.isSafeInteger(descriptor.namespace) || namespaces.has(descriptor.namespace)) {
      throw new RangeError(`Survey-site type ${descriptor.type} requires a unique safe-integer namespace`);
    }
    namespaces.add(descriptor.namespace);
    if (!Number.isInteger(descriptor.count) || descriptor.count <= 0 || descriptor.count > 10_000) {
      throw new RangeError(`Survey-site type ${descriptor.type} requires a count from 1 through 10000`);
    }
    if (descriptor.placement.terrain.length === 0 || descriptor.placement.islandKinds.length === 0) {
      throw new RangeError(`Survey-site type ${descriptor.type} requires placement terrain and island kinds`);
    }
    if (descriptor.clues.length === 0 || descriptor.results.length === 0) {
      throw new RangeError(`Survey-site type ${descriptor.type} requires clue and result content`);
    }
    if (!descriptor.label || !descriptor.presentation.id || !descriptor.presentation.badge) {
      throw new RangeError(`Survey-site type ${descriptor.type} requires presentation labels`);
    }
  }
}
