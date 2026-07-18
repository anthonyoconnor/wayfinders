import type { GeneratedIsland } from "../IslandGenerator";
import { seededValue } from "../SeededRandom";
import { TerrainType } from "../TileData";
import type { WorldGrid } from "../WorldGrid";
import type { WorldTopology } from "../WorldTopology";
import type { WorldAnalysisIndex } from "../analysis";
import type { WorldManifestWaterLayoutV2, WorldManifestWaterRegionV2 } from "../manifest";
import {
  DEFAULT_WATER_TYPE_CATALOG,
  WATER_TYPE_IDS,
  type WaterTypeCatalogV1,
  type WaterTypeId,
  waterTypeIndex,
} from "./WaterTypeCatalog";

export const WATER_LAYOUT_VERSION = "wayfinders-water-layout-v2";

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
    manifest: Readonly<{ waterLayout: Readonly<WorldManifestWaterLayoutV2> }>,
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
    const coastal = waterTypeIndex(this.catalog, WATER_TYPE_IDS.coastal);
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

    reserveDeepCoastalTransitionCollar(
      baseTypes,
      analysis,
      grid.topology,
      deep,
      coastal,
    );

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const index = y * grid.width + x;
        transitions[index] = transitionMask(
          baseTypes,
          grid.topology,
          x,
          y,
          deep,
          coastal,
        );
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

/**
 * The current blend sheet only supports deep-to-coastal transitions. Preserve
 * a one-tile deep host collar when a contextual far-water profile such as
 * abyss reaches an island, so every coastal shelf still receives that blend.
 */
function reserveDeepCoastalTransitionCollar(
  base: Uint8Array,
  analysis: Readonly<WorldAnalysisIndex>,
  topology: Readonly<WorldTopology>,
  deepIndex: number,
  coastalIndex: number,
): void {
  const replace = new Uint8Array(base.length);
  for (let y = 0; y < topology.tileHeight; y++) {
    for (let x = 0; x < topology.tileWidth; x++) {
      const index = y * topology.tileWidth + x;
      if (analysis.terrainAt(index) !== TerrainType.DeepOcean || base[index] === coastalIndex) continue;
      for (let dy = -1; dy <= 1 && replace[index] === 0; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const neighbor = topology.canonicalizeTile(x + dx, y + dy);
          if (!neighbor || (neighbor.x === x && neighbor.y === y)) continue;
          if (base[neighbor.y * topology.tileWidth + neighbor.x] === coastalIndex) {
            replace[index] = 1;
            break;
          }
        }
      }
    }
  }
  for (let index = 0; index < base.length; index++) if (replace[index] !== 0) base[index] = deepIndex;
}

function placementMatches(
  strategy: WaterTypeCatalogV1["types"][number]["placementStrategy"],
  typeId: WaterTypeId,
  grid: Readonly<WorldGrid>,
  regions: readonly Readonly<WorldManifestWaterRegionV2>[],
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
      return regionContains(regions, typeId, grid.topology, x, y);
    case "context-required":
      return false;
  }
}

export function createManifestWaterLayout(
  seed: number,
  width: number,
  height: number,
  catalog: Readonly<WaterTypeCatalogV1> = DEFAULT_WATER_TYPE_CATALOG,
): WorldManifestWaterLayoutV2 {
  const ellipse = (
    id: string,
    typeId: "abyss" | "rough",
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    regionSeed: number,
  ): WorldManifestWaterRegionV2 => ({
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
        imageOffset: { x: 0, y: 0 },
        width: Math.max(2, height * 0.045),
      },
      ellipse("water:rough:000", "rough", width * 0.8 - jitterX, height * 0.2 - jitterY, width * 0.2, height * 0.13, seed + 4_009),
    ]),
  });
}

function protectedShallow(grid: Readonly<WorldGrid>, x: number, y: number): boolean {
  let blocked = 0;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const neighbor = grid.topology.canonicalizeTile(x + dx, y + dy);
    if (!neighbor) {
      blocked++;
      continue;
    }
    // A collapsed wrapped axis is not a synthetic blocked side.
    if (neighbor.x === x && neighbor.y === y) continue;
    const terrain = grid.getTerrain(neighbor.x, neighbor.y);
    if (terrain === TerrainType.Land || terrain === TerrainType.Rock) blocked++;
  }
  return blocked >= 2;
}

function regionContains(
  regions: readonly Readonly<WorldManifestWaterRegionV2>[],
  typeId: WaterTypeId,
  topology: Readonly<WorldTopology>,
  x: number,
  y: number,
): boolean {
  return regions.some((region) => {
    if (region.typeId !== typeId) return false;
    if (region.strategy === "ellipse") {
      const displacement = topology.minimumImageTileDisplacement(region.center, { x, y });
      const dx = displacement.x / region.radiusX;
      const dy = displacement.y / region.radiusY;
      // Keep coherent variation in region-local lifted coordinates so the
      // canonical seam cannot introduce a second, unrelated noise sample.
      const wobble = (seededValue(
        region.seed,
        Math.floor(displacement.x / 4),
        Math.floor(displacement.y / 4),
      ) - 0.5) * 0.24;
      return dx * dx + dy * dy <= 1 + wobble;
    }
    return ribbonContains(region, topology, x, y);
  });
}

function ribbonContains(
  region: Readonly<Extract<WorldManifestWaterRegionV2, { strategy: "ribbon" }>>,
  topology: Readonly<WorldTopology>,
  canonicalX: number,
  canonicalY: number,
): boolean {
  const endX = region.end.x + region.imageOffset.x;
  const endY = region.end.y + region.imageOffset.y;
  const vx = endX - region.start.x;
  const vy = endY - region.start.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return false;

  // A region's imageOffset is authoritative. Test canonical point images
  // against that declared lifted segment instead of shortening the segment to
  // the minimum image: offset zero therefore preserves the long interior
  // ribbon, while an explicit whole-world offset produces the declared seam
  // winding.
  const imageXs = periodicPointImages(
    canonicalX,
    Math.min(region.start.x, endX),
    Math.max(region.start.x, endX),
    region.width,
    topology.tileWidth,
    topology.wrapsX,
  );
  const imageYs = periodicPointImages(
    canonicalY,
    Math.min(region.start.y, endY),
    Math.max(region.start.y, endY),
    region.width * 1.8,
    topology.tileHeight,
    topology.wrapsY,
  );
  for (const x of imageXs) {
    for (const y of imageYs) {
      const t = Math.max(0, Math.min(
        1,
        ((x - region.start.x) * vx + (y - region.start.y) * vy) / lengthSquared,
      ));
      const px = region.start.x + vx * t;
      const py = region.start.y + vy * t
        + Math.sin(t * Math.PI * 4 + region.seed) * region.width * 0.8;
      if (Math.hypot(x - px, y - py) <= region.width) return true;
    }
  }
  return false;
}

function periodicPointImages(
  canonical: number,
  minimum: number,
  maximum: number,
  padding: number,
  span: number,
  wraps: boolean,
): number[] {
  if (!wraps) return [canonical];
  const firstImage = Math.ceil((minimum - padding - canonical) / span);
  const lastImage = Math.floor((maximum + padding - canonical) / span);
  const images: number[] = [];
  for (let image = firstImage; image <= lastImage; image++) images.push(canonical + image * span);
  return images;
}

/**
 * The checked-in transition atlas is directional: it starts as deep water and
 * introduces coastal pixels only along the flagged edges. It is not a generic
 * alpha mask, so applying it to the coastal side or to unrelated profile pairs
 * would replace the correct base with an opaque deep/coastal square.
 */
function transitionMask(
  base: Uint8Array,
  topology: Readonly<WorldTopology>,
  x: number,
  y: number,
  deepIndex: number,
  coastalIndex: number,
): number {
  const own = base[y * topology.tileWidth + x]!;
  if (own !== deepIndex) return 0;
  const neighbors = [
    [0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8],
    [1, -1, 16], [1, 1, 32], [-1, 1, 64], [-1, -1, 128],
  ] as const;
  let mask = 0;
  for (const [dx, dy, bit] of neighbors) {
    const neighbor = topology.canonicalizeTile(x + dx, y + dy);
    if (!neighbor || (neighbor.x === x && neighbor.y === y)) continue;
    if (base[neighbor.y * topology.tileWidth + neighbor.x] === coastalIndex) mask |= bit;
  }
  if ((mask & 3) !== 3) mask &= ~16;
  if ((mask & 6) !== 6) mask &= ~32;
  if ((mask & 12) !== 12) mask &= ~64;
  if ((mask & 9) !== 9) mask &= ~128;
  return mask;
}
