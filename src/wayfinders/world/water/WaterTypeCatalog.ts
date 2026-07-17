import { TerrainType } from "../TileData";

export const WATER_TYPE_CATALOG_VERSION = 1 as const;
export const WATER_TYPE_CATALOG_FINGERPRINT = "wayfinders-water-types-v1";

export const WATER_TYPE_IDS = Object.freeze({
  abyss: "abyss",
  brackish: "brackish",
  coastal: "coastal",
  current: "current",
  deep: "deep",
  lagoon: "lagoon",
  reef: "reef",
  rough: "rough",
} as const);

/** Stable catalog key. Known IDs are constants, while future packages may add more. */
export type WaterTypeId = string;
export type WaterTypeRole = "base" | "overlay";
export type WaterTypeAuthority = "terrain" | "contextual" | "visual-only";
export type WaterPlacementStrategyId =
  | "terrain-deep"
  | "terrain-reef"
  | "island-shelf"
  | "protected-shallow"
  | "coherent-ellipse"
  | "coherent-ribbon"
  | "context-required";

export interface WaterTypeDefinitionV1 {
  readonly id: WaterTypeId;
  readonly label: string;
  readonly role: WaterTypeRole;
  readonly authority: WaterTypeAuthority;
  readonly eligibleTerrain: readonly TerrainType[];
  readonly priority: number;
  readonly placementStrategy: WaterPlacementStrategyId;
  readonly automaticallyPlaced: boolean;
  readonly animationFps: number;
}

export interface WaterTypeCatalogV1 {
  readonly version: typeof WATER_TYPE_CATALOG_VERSION;
  readonly fingerprint: string;
  readonly types: readonly Readonly<WaterTypeDefinitionV1>[];
}

const DEFINITIONS: readonly WaterTypeDefinitionV1[] = [
  {
    id: WATER_TYPE_IDS.abyss,
    label: "Abyss",
    role: "base",
    authority: "contextual",
    eligibleTerrain: [TerrainType.DeepOcean],
    priority: 20,
    placementStrategy: "coherent-ellipse",
    automaticallyPlaced: true,
    animationFps: 3,
  },
  {
    id: WATER_TYPE_IDS.brackish,
    label: "Brackish",
    role: "base",
    authority: "contextual",
    eligibleTerrain: [TerrainType.ShallowOcean],
    priority: 40,
    placementStrategy: "context-required",
    automaticallyPlaced: false,
    animationFps: 3,
  },
  {
    id: WATER_TYPE_IDS.coastal,
    label: "Coastal",
    role: "base",
    authority: "terrain",
    eligibleTerrain: [TerrainType.ShallowOcean],
    priority: 30,
    placementStrategy: "island-shelf",
    automaticallyPlaced: true,
    animationFps: 5,
  },
  {
    id: WATER_TYPE_IDS.current,
    label: "Current",
    role: "overlay",
    authority: "visual-only",
    eligibleTerrain: [TerrainType.DeepOcean, TerrainType.ShallowOcean],
    priority: 10,
    placementStrategy: "coherent-ribbon",
    automaticallyPlaced: true,
    animationFps: 7,
  },
  {
    id: WATER_TYPE_IDS.deep,
    label: "Deep",
    role: "base",
    authority: "terrain",
    eligibleTerrain: [TerrainType.DeepOcean],
    priority: 10,
    placementStrategy: "terrain-deep",
    automaticallyPlaced: true,
    animationFps: 4,
  },
  {
    id: WATER_TYPE_IDS.lagoon,
    label: "Lagoon",
    role: "base",
    authority: "contextual",
    eligibleTerrain: [TerrainType.ShallowOcean],
    priority: 40,
    placementStrategy: "protected-shallow",
    automaticallyPlaced: true,
    animationFps: 4,
  },
  {
    id: WATER_TYPE_IDS.reef,
    label: "Reef",
    role: "base",
    authority: "terrain",
    eligibleTerrain: [TerrainType.Reef],
    priority: 100,
    placementStrategy: "terrain-reef",
    automaticallyPlaced: true,
    animationFps: 3,
  },
  {
    id: WATER_TYPE_IDS.rough,
    label: "Rough",
    role: "overlay",
    authority: "visual-only",
    eligibleTerrain: [TerrainType.DeepOcean, TerrainType.ShallowOcean],
    priority: 20,
    placementStrategy: "coherent-ellipse",
    automaticallyPlaced: true,
    animationFps: 7,
  },
];

export const DEFAULT_WATER_TYPE_CATALOG: Readonly<WaterTypeCatalogV1> = validateWaterTypeCatalog({
  version: WATER_TYPE_CATALOG_VERSION,
  fingerprint: WATER_TYPE_CATALOG_FINGERPRINT,
  types: DEFINITIONS,
});

export function validateWaterTypeCatalog(input: Readonly<WaterTypeCatalogV1>): Readonly<WaterTypeCatalogV1> {
  if (input.version !== WATER_TYPE_CATALOG_VERSION) {
    throw new RangeError(`Unsupported water type catalog version ${String(input.version)}`);
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/u.test(input.fingerprint)) {
    throw new RangeError("Water type catalog fingerprint must be a stable lowercase ID");
  }
  if (input.types.length === 0 || input.types.length > 32) {
    throw new RangeError("Water type catalog must contain between 1 and 32 types");
  }
  const ids = new Set<string>();
  let deep = false;
  let reef = false;
  let coastal = false;
  const normalized = input.types.map((definition) => {
    if (ids.has(definition.id)) throw new RangeError(`Duplicate water type ID ${definition.id}`);
    ids.add(definition.id);
    if (definition.eligibleTerrain.length === 0) {
      throw new RangeError(`Water type ${definition.id} must declare eligible terrain`);
    }
    if (!Number.isFinite(definition.animationFps) || definition.animationFps <= 0) {
      throw new RangeError(`Water type ${definition.id} must declare positive animation FPS`);
    }
    if (definition.role === "overlay" && definition.authority !== "visual-only") {
      throw new RangeError(`Water overlay ${definition.id} must remain visual-only`);
    }
    if (definition.id === WATER_TYPE_IDS.brackish && definition.automaticallyPlaced) {
      throw new RangeError("Brackish water requires an authoritative future context");
    }
    deep ||= definition.id === WATER_TYPE_IDS.deep;
    reef ||= definition.id === WATER_TYPE_IDS.reef;
    coastal ||= definition.id === WATER_TYPE_IDS.coastal;
    return Object.freeze({ ...definition, eligibleTerrain: Object.freeze([...definition.eligibleTerrain]) });
  }).sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (!deep || !reef || !coastal) throw new RangeError("Water catalog requires deep, coastal, and reef bases");
  return Object.freeze({
    version: WATER_TYPE_CATALOG_VERSION,
    fingerprint: input.fingerprint,
    types: Object.freeze(normalized),
  });
}

export function waterTypeIndex(catalog: Readonly<WaterTypeCatalogV1>, id: WaterTypeId): number {
  const index = catalog.types.findIndex((definition) => definition.id === id);
  if (index < 0) throw new RangeError(`Water type catalog does not contain ${id}`);
  return index;
}
