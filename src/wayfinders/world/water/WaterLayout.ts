import type { GeneratedIsland } from "../IslandGenerator";
import { seededValue } from "../SeededRandom";
import { TerrainType } from "../TileData";
import type { WorldGrid } from "../WorldGrid";
import type { WorldAnalysisIndex } from "../analysis";
import type { WorldManifestWaterLayoutV1, WorldManifestWaterRegionV1 } from "../manifest";
import {
  DEFAULT_WATER_TYPE_CATALOG,
  WATER_TYPE_IDS,
  type WaterTypeCatalogV1,
  type WaterTypeId,
  waterTypeIndex,
} from "./WaterTypeCatalog";

export const WATER_LAYOUT_VERSION = "wayfinders-water-layout-v1";

export interface WaterLayoutChunkSnapshot {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly startX: number;
  readonly startY: number;
  readonly width: number;
  readonly height: number;
}

export class GeneratedWaterLayout {
  readonly version = WATER_LAYOUT_VERSION;
  readonly catalogFingerprint: string;
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
  readonly typeIds: readonly WaterTypeId[];

  constructor(
    catalog: Readonly<WaterTypeCatalogV1>,
    width: number,
    height: number,
    chunkSize: number,
    private readonly baseTypes: Uint8Array,
    private readonly overlays: Uint32Array,
    private readonly transitions: Uint8Array,
    private readonly variants: Uint8Array,
    private readonly phases: Uint8Array,
  ) {
    this.catalogFingerprint = catalog.fingerprint;
    this.width = width;
    this.height = height;
    this.chunkSize = chunkSize;
    this.typeIds = Object.freeze(catalog.types.map(({ id }) => id));
    const tileCount = width * height;
    if ([baseTypes.length, overlays.length, transitions.length, variants.length, phases.length]
      .some((length) => length !== tileCount)) {
      throw new RangeError("Generated water layout arrays must match world dimensions");
    }
  }

  index(x: number, y: number): number {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) {
      throw new RangeError(`Water layout coordinate ${x},${y} is outside ${this.width}x${this.height}`);
    }
    return y * this.width + x;
  }

  baseTypeIndexAt(x: number, y: number): number { return this.baseTypes[this.index(x, y)]!; }
  baseTypeAt(x: number, y: number): WaterTypeId { return this.typeIds[this.baseTypeIndexAt(x, y)]!; }
  overlayMaskAt(x: number, y: number): number { return this.overlays[this.index(x, y)]!; }
  transitionMaskAt(x: number, y: number): number { return this.transitions[this.index(x, y)]!; }
  variantAt(x: number, y: number): number { return this.variants[this.index(x, y)]!; }
  phaseAt(x: number, y: number): number { return this.phases[this.index(x, y)]!; }

  hasOverlay(x: number, y: number, id: WaterTypeId): boolean {
    const typeIndex = this.typeIds.indexOf(id);
    return typeIndex >= 0 && (this.overlayMaskAt(x, y) & (1 << typeIndex)) !== 0;
  }

  chunk(chunkX: number, chunkY: number): Readonly<WaterLayoutChunkSnapshot> {
    const startX = chunkX * this.chunkSize;
    const startY = chunkY * this.chunkSize;
    if (startX < 0 || startY < 0 || startX >= this.width || startY >= this.height) {
      throw new RangeError(`Water chunk ${chunkX},${chunkY} is outside the layout`);
    }
    return Object.freeze({
      chunkX,
      chunkY,
      startX,
      startY,
      width: Math.min(this.chunkSize, this.width - startX),
      height: Math.min(this.chunkSize, this.height - startY),
    });
  }
}

export class WaterLayoutPlanner {
  constructor(private readonly catalog: Readonly<WaterTypeCatalogV1> = DEFAULT_WATER_TYPE_CATALOG) {}

  plan(
    grid: Readonly<WorldGrid>,
    analysis: Readonly<WorldAnalysisIndex>,
    islands: readonly Readonly<GeneratedIsland>[],
    manifest: Readonly<{ waterLayout: Readonly<WorldManifestWaterLayoutV1> }>,
    seed: number,
  ): GeneratedWaterLayout {
    if (manifest.waterLayout.catalogFingerprint !== this.catalog.fingerprint) {
      throw new RangeError("World water layout catalog fingerprint does not match the active catalog");
    }
    const tileCount = grid.width * grid.height;
    const baseTypes = new Uint8Array(tileCount);
    const overlays = new Uint32Array(tileCount);
    const transitions = new Uint8Array(tileCount);
    const variants = new Uint8Array(tileCount);
    const phases = new Uint8Array(tileCount);
    const deep = waterTypeIndex(this.catalog, WATER_TYPE_IDS.deep);
    const islandsById = new Map(islands.map((island) => [island.id, island]));
    const orderedBaseTypes = this.catalog.types
      .filter(({ role, automaticallyPlaced }) => role === "base" && automaticallyPlaced)
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id, "en"));
    const overlayTypes = this.catalog.types
      .filter(({ role, automaticallyPlaced }) => role === "overlay" && automaticallyPlaced)
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id, "en"));

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const index = y * grid.width + x;
        const terrain = analysis.terrainAt(index);
        const island = islandsById.get(analysis.islandIdAt(index));
        const selected = orderedBaseTypes.find((definition) => definition.eligibleTerrain.includes(terrain)
          && placementMatches(definition.placementStrategy, definition.id, grid, manifest.waterLayout.regions, island, x, y));
        const base = selected ? waterTypeIndex(this.catalog, selected.id) : deep;
        baseTypes[index] = base;
        for (const definition of overlayTypes) {
          if (definition.eligibleTerrain.includes(terrain)
            && placementMatches(definition.placementStrategy, definition.id, grid, manifest.waterLayout.regions, island, x, y)) {
            overlays[index] |= 1 << waterTypeIndex(this.catalog, definition.id);
          }
        }
        variants[index] = Math.floor(seededValue(seed + 9_173, x, y) * 4) & 3;
        phases[index] = Math.floor(seededValue(seed + 13_117, x, y) * 8) & 7;
      }
    }

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const index = y * grid.width + x;
        transitions[index] = transitionMask(baseTypes, grid.width, grid.height, x, y);
      }
    }

    return new GeneratedWaterLayout(
      this.catalog,
      grid.width,
      grid.height,
      grid.chunkSize,
      baseTypes,
      overlays,
      transitions,
      variants,
      phases,
    );
  }
}

function placementMatches(
  strategy: WaterTypeCatalogV1["types"][number]["placementStrategy"],
  typeId: WaterTypeId,
  grid: Readonly<WorldGrid>,
  regions: readonly Readonly<WorldManifestWaterRegionV1>[],
  island: Readonly<GeneratedIsland> | undefined,
  x: number,
  y: number,
): boolean {
  switch (strategy) {
    case "terrain-deep":
    case "terrain-reef":
    case "island-shelf":
      return true;
    case "protected-shallow":
      return island?.kind === "atoll" || protectedShallow(grid, x, y);
    case "coherent-ellipse":
    case "coherent-ribbon":
      return regionContains(regions, typeId, x, y);
    case "context-required":
      return false;
  }
}

export function createManifestWaterLayout(
  seed: number,
  width: number,
  height: number,
  catalog: Readonly<WaterTypeCatalogV1> = DEFAULT_WATER_TYPE_CATALOG,
): WorldManifestWaterLayoutV1 {
  const ellipse = (
    id: string,
    typeId: "abyss" | "rough",
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    regionSeed: number,
  ): WorldManifestWaterRegionV1 => ({
    id: id as `water:${string}`,
    typeId,
    strategy: "ellipse",
    seed: regionSeed,
    center: { x: centerX, y: centerY },
    radiusX,
    radiusY,
  });
  const jitterX = (seededValue(seed + 401, 1, 0) - 0.5) * width * 0.08;
  const jitterY = (seededValue(seed + 401, 0, 1) - 0.5) * height * 0.08;
  return Object.freeze({
    version: WATER_LAYOUT_VERSION,
    catalogFingerprint: catalog.fingerprint,
    regions: Object.freeze([
      ellipse("water:abyss:000", "abyss", width * 0.18 + jitterX, height * 0.18 + jitterY, width * 0.3, height * 0.25, seed + 2_003),
      {
        id: "water:current:000" as const,
        typeId: "current" as const,
        strategy: "ribbon" as const,
        seed: seed + 3_001,
        start: { x: width * 0.04, y: height * 0.4 },
        end: { x: width * 0.96, y: height * 0.58 },
        width: Math.max(2, height * 0.045),
      },
      ellipse("water:rough:000", "rough", width * 0.8 - jitterX, height * 0.2 - jitterY, width * 0.2, height * 0.13, seed + 4_009),
    ]),
  });
}

function protectedShallow(grid: Readonly<WorldGrid>, x: number, y: number): boolean {
  let blocked = 0;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (!grid.inBounds(nx, ny) || grid.getTerrain(nx, ny) === TerrainType.Land || grid.getTerrain(nx, ny) === TerrainType.Rock) blocked++;
  }
  return blocked >= 2;
}

function regionContains(
  regions: readonly Readonly<WorldManifestWaterRegionV1>[],
  typeId: WaterTypeId,
  x: number,
  y: number,
): boolean {
  return regions.some((region) => {
    if (region.typeId !== typeId) return false;
    if (region.strategy === "ellipse") {
      const dx = (x - region.center.x) / region.radiusX;
      const dy = (y - region.center.y) / region.radiusY;
      const wobble = (seededValue(region.seed, Math.floor(x / 4), Math.floor(y / 4)) - 0.5) * 0.24;
      return dx * dx + dy * dy <= 1 + wobble;
    }
    const vx = region.end.x - region.start.x;
    const vy = region.end.y - region.start.y;
    const lengthSquared = vx * vx + vy * vy;
    const t = Math.max(0, Math.min(1, ((x - region.start.x) * vx + (y - region.start.y) * vy) / lengthSquared));
    const px = region.start.x + vx * t;
    const py = region.start.y + vy * t + Math.sin(t * Math.PI * 4 + region.seed) * region.width * 0.8;
    return Math.hypot(x - px, y - py) <= region.width;
  });
}

function transitionMask(base: Uint8Array, width: number, height: number, x: number, y: number): number {
  const own = base[y * width + x]!;
  const neighbors = [
    [0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8],
    [1, -1, 16], [1, 1, 32], [-1, 1, 64], [-1, -1, 128],
  ] as const;
  let mask = 0;
  for (const [dx, dy, bit] of neighbors) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height || base[ny * width + nx] !== own) mask |= bit;
  }
  if ((mask & 3) !== 3) mask &= ~16;
  if ((mask & 6) !== 6) mask &= ~32;
  if ((mask & 12) !== 12) mask &= ~64;
  if ((mask & 9) !== 9) mask &= ~128;
  return mask;
}
