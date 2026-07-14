import type { GridPoint } from "../core/types";
import { IslandKind, type GeneratedIsland } from "../world/IslandGenerator";
import { seededValue } from "../world/SeededRandom";
import type { WorldGrid } from "../world/WorldGrid";
import {
  ISLAND_DOSSIER_CONTENT_VERSION,
  ISLAND_DOSSIER_INTERACTION_RANGE_TILES,
  type IslandDossierDefinitionV1,
  type IslandDossierResultV1,
  type IslandDossierTheme,
} from "./IslandDossierContracts";

const CONTENT_NAMESPACE = 1_307_041;
const APPROACH_NAMESPACE = 1_307_083;

const NAME_ADJECTIVES = [
  "Amber", "Blue", "Bracken", "Cloud", "Copper", "Dawn", "Far", "Glass",
  "Green", "Hollow", "Moon", "North", "Quiet", "Red", "Salt", "Star",
] as const;

const NAME_NOUNS = [
  "Cairn", "Cay", "Crown", "Haven", "Head", "Key", "Lantern", "Mere",
  "Needle", "Reach", "Rest", "Rook", "Sound", "Spire", "Tide", "Watch",
] as const;

function choose<T>(values: readonly T[], seed: number, islandId: number, slot: number): T {
  const index = Math.floor(seededValue(seed + CONTENT_NAMESPACE, islandId, slot) * values.length);
  return values[Math.min(values.length - 1, index)];
}

function createUniqueName(seed: number, islandId: number, usedNames: Set<string>): string {
  let salt = 0;
  let name: string;
  do {
    const adjective = choose(NAME_ADJECTIVES, seed, islandId, 1 + salt * 2);
    const noun = choose(NAME_NOUNS, seed, islandId, 2 + salt * 2);
    name = `${adjective} ${noun}`;
    salt++;
  } while (usedNames.has(name) && salt < NAME_ADJECTIVES.length * NAME_NOUNS.length);
  if (usedNames.has(name)) name = `${name} ${islandId}`;
  usedNames.add(name);
  return name;
}

function dossierForIsland(
  island: Readonly<GeneratedIsland>,
  seed: number,
): Readonly<IslandDossierResultV1> {
  let theme: IslandDossierTheme;
  let findingLabel: string;
  let detail: string;

  switch (island.kind) {
    case IslandKind.HighIsland:
      theme = "community";
      findingLabel = "welcoming island community";
      detail = `A ${island.size} high island with a community willing to share local knowledge.`;
      break;
    case IslandKind.LowCay:
      theme = "resource";
      findingLabel = "useful island materials";
      detail = `A ${island.size} low cay with dependable materials for the tribe.`;
      break;
    case IslandKind.Atoll:
      if (seededValue(seed + CONTENT_NAMESPACE, island.id, 31) < 0.5) {
        theme = "anchorage";
        findingLabel = "sheltered anchorage";
        detail = `A ${island.size} atoll whose lagoon offers a sheltered anchorage.`;
      } else {
        theme = "reef-passage";
        findingLabel = "charted reef passage";
        detail = `A ${island.size} atoll with a dependable passage through its surrounding reef.`;
      }
      break;
    case IslandKind.RockySkerry:
      theme = "weather-watch";
      findingLabel = "weather watchpoint";
      detail = `A ${island.size} rocky skerry suited to reading approaching seas and weather.`;
      break;
  }

  return Object.freeze({
    theme,
    findingLabel,
    detail,
    developerArtId: `developer:island-dossier:v${ISLAND_DOSSIER_CONTENT_VERSION}:${theme}`,
  });
}

function dockReachableMask(world: WorldGrid, homeReturnTile: Readonly<GridPoint>): Uint8Array {
  if (!world.inBounds(homeReturnTile.x, homeReturnTile.y)) {
    throw new RangeError("Island-dossier home return tile is outside the world");
  }
  const start = world.index(homeReturnTile.x, homeReturnTile.y);
  if (world.isMovementBlockedAtIndex(start)) {
    throw new RangeError("Island-dossier home return tile is blocked");
  }

  const reachable = new Uint8Array(world.tileCount);
  const queue = new Int32Array(world.tileCount);
  let head = 0;
  let tail = 0;
  reachable[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const index = queue[head++];
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const visit = (candidate: number): void => {
      if (reachable[candidate] || world.isMovementBlockedAtIndex(candidate)) return;
      reachable[candidate] = 1;
      queue[tail++] = candidate;
    };
    if (x > 0) visit(index - 1);
    if (x + 1 < world.width) visit(index + 1);
    if (y > 0) visit(index - world.width);
    if (y + 1 < world.height) visit(index + world.width);
  }

  return reachable;
}

function deriveApproachIndices(
  world: WorldGrid,
  footprintIndices: readonly number[],
  reachable: Uint8Array,
): readonly number[] {
  const approaches = new Set<number>();
  const extent = Math.ceil(ISLAND_DOSSIER_INTERACTION_RANGE_TILES);
  for (const footprintIndex of footprintIndices) {
    const footprintX = footprintIndex % world.width;
    const footprintY = Math.floor(footprintIndex / world.width);
    for (let dy = -extent; dy <= extent; dy++) {
      for (let dx = -extent; dx <= extent; dx++) {
        if (Math.hypot(dx, dy) > ISLAND_DOSSIER_INTERACTION_RANGE_TILES) continue;
        const x = footprintX + dx;
        const y = footprintY + dy;
        if (!world.inBounds(x, y)) continue;
        const candidate = world.index(x, y);
        if (!reachable[candidate] || world.isMovementBlockedAtIndex(candidate)) continue;
        approaches.add(candidate);
      }
    }
  }
  return Object.freeze([...approaches].sort((left, right) => left - right));
}

function chooseCanonicalApproach(
  world: WorldGrid,
  seed: number,
  islandId: number,
  approachIndices: readonly number[],
): Readonly<GridPoint> {
  let selected = approachIndices[0];
  let selectedRank = Number.POSITIVE_INFINITY;
  for (const index of approachIndices) {
    const point = world.pointFromIndex(index);
    const rank = seededValue(seed + APPROACH_NAMESPACE + islandId, point.x, point.y);
    if (rank > selectedRank || (rank === selectedRank && index >= selected)) continue;
    selected = index;
    selectedRank = rank;
  }
  return Object.freeze(world.pointFromIndex(selected));
}

/**
 * Generates exactly one deterministic dossier for each supplied generated
 * non-home island. Terrain, knowledge and island identity remain untouched.
 */
export function generateIslandDossierCatalog(
  world: WorldGrid,
  seed: number,
  islands: readonly Readonly<GeneratedIsland>[],
  homeReturnTile: Readonly<GridPoint>,
  contentVersion: number = ISLAND_DOSSIER_CONTENT_VERSION,
): readonly Readonly<IslandDossierDefinitionV1>[] {
  if (contentVersion !== ISLAND_DOSSIER_CONTENT_VERSION) {
    throw new RangeError(`Unsupported island-dossier content version ${contentVersion}`);
  }
  const islandsById = new Map<number, Readonly<GeneratedIsland>>();
  for (const island of islands) {
    if (!Number.isSafeInteger(island.id) || island.id <= 0) {
      throw new RangeError(`Invalid generated island ID ${island.id}`);
    }
    if (islandsById.has(island.id)) throw new RangeError(`Duplicate generated island ${island.id}`);
    islandsById.set(island.id, island);
  }

  const footprints = new Map<number, number[]>();
  for (const islandId of islandsById.keys()) footprints.set(islandId, []);
  world.forEachTile((_x, _y, index) => {
    const footprint = footprints.get(world.getIslandIdAtIndex(index));
    if (footprint) footprint.push(index);
  });

  const reachable = dockReachableMask(world, homeReturnTile);
  const usedNames = new Set<string>();
  const definitions: IslandDossierDefinitionV1[] = [];
  for (const island of [...islandsById.values()].sort((left, right) => left.id - right.id)) {
    const mutableFootprint = footprints.get(island.id);
    if (!mutableFootprint || mutableFootprint.length === 0) {
      throw new RangeError(`Generated island ${island.id} has no exact island-ID footprint`);
    }
    mutableFootprint.sort((left, right) => left - right);
    const footprintIndices = Object.freeze([...mutableFootprint]);
    const approachIndices = deriveApproachIndices(world, footprintIndices, reachable);
    if (approachIndices.length === 0) {
      throw new RangeError(`Generated island ${island.id} has no dock-reachable coastal approach`);
    }

    definitions.push(Object.freeze({
      contentVersion: ISLAND_DOSSIER_CONTENT_VERSION,
      islandId: island.id,
      name: createUniqueName(seed, island.id, usedNames),
      kind: island.kind,
      size: island.size,
      center: Object.freeze({ ...island.center }),
      footprintIndices,
      approachIndices,
      canonicalApproach: chooseCanonicalApproach(world, seed, island.id, approachIndices),
      dossier: dossierForIsland(island, seed),
    }));
  }

  return Object.freeze(definitions);
}
