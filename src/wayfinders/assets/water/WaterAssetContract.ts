import type Phaser from "phaser";
import { DEFAULT_WATER_TYPE_CATALOG, type WaterTypeId } from "../../world/water";
import { prototypeConfig } from "../../config/prototypeConfig";

export const WATER_ASSET_CONTRACT_VERSION = 1 as const;
export const WATER_TEXTURE_KEYS = Object.freeze({
  animated: "wayfinders.water.animated",
  static: "wayfinders.water.static",
  transitions: "wayfinders.water.transitions",
  overlays: "wayfinders.water.overlays",
  homeDepthHandoff: "wayfinders.water.home-depth-handoff",
  homeShore: "wayfinders.water.home-shore",
  shoalLean: "wayfinders.water.shoal.lean",
  shoalSteady: "wayfinders.water.shoal.steady",
  shoalRich: "wayfinders.water.shoal.rich",
} as const);

export const WATER_ASSET_URLS = Object.freeze({
  metadata: new URL("../packages/water.json", import.meta.url).href,
  animated: "/assets/gr1/water/water-tiles.png",
  static: "/assets/gr1/water/water-static.png",
  transitions: "/assets/gr1/water/water-depth-transitions.png",
  overlays: "/assets/gr1/water/water-overlays.png",
  homeDepthHandoff: "/assets/gr1/water/water-home-depth-handoff.png",
  homeShore: "/assets/gr1/water/water-home-shore-overlay.png",
  shoalLean: "/assets/gr1/water/shoals/shoal-lean.png",
  shoalSteady: "/assets/gr1/water/shoals/shoal-steady.png",
  shoalRich: "/assets/gr1/water/shoals/shoal-rich.png",
} as const);

export const WATER_METADATA_KEY = "wayfinders.water.package";
export const WATER_TILE_SIZE = 32;
export const WATER_SHEET_MARGIN = 2;
export const WATER_SHEET_SPACING = 4;
export const WATER_HOME_FRAME_SIZE = 480;
export const WATER_HOME_HANDOFF_FRAME_SIZE = 800;
export const WATER_HOME_HANDOFF_MARGIN = 160;
export const WATER_TRANSITION_MASKS = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19, 23, 27, 31, 38, 39,
  46, 47, 55, 63, 76, 77, 78, 79, 95, 110, 111, 127, 137, 139, 141, 143, 155, 159,
  175, 191, 205, 207, 223, 239, 255,
] as const);

export interface WaterAssetProfileV1 {
  readonly id: WaterTypeId;
  readonly rowStart: number;
  readonly frameCount: number;
  readonly framesPerSecond: number;
}

export interface WaterAssetPackageV1 {
  readonly contractVersion: typeof WATER_ASSET_CONTRACT_VERSION;
  readonly assetId: string;
  readonly kind: "water-tile-package";
  readonly tileSize: typeof WATER_TILE_SIZE;
  readonly variantCount: 4;
  readonly profiles: readonly Readonly<WaterAssetProfileV1>[];
}

export interface WaterAssetRuntime {
  readonly package: Readonly<WaterAssetPackageV1>;
  readonly profiles: ReadonlyMap<WaterTypeId, Readonly<WaterAssetProfileV1>>;
  hasTexture(key: string): boolean;
}

export function preloadWaterAssetPackage(scene: Phaser.Scene): void {
  scene.load.json(WATER_METADATA_KEY, WATER_ASSET_URLS.metadata);
  const frameConfig = {
    frameWidth: WATER_TILE_SIZE,
    frameHeight: WATER_TILE_SIZE,
    margin: WATER_SHEET_MARGIN,
    spacing: WATER_SHEET_SPACING,
  };
  scene.load.spritesheet(WATER_TEXTURE_KEYS.animated, WATER_ASSET_URLS.animated, frameConfig);
  scene.load.spritesheet(WATER_TEXTURE_KEYS.static, WATER_ASSET_URLS.static, frameConfig);
  scene.load.spritesheet(WATER_TEXTURE_KEYS.transitions, WATER_ASSET_URLS.transitions, frameConfig);
  scene.load.spritesheet(WATER_TEXTURE_KEYS.overlays, WATER_ASSET_URLS.overlays, frameConfig);
  scene.load.spritesheet(
    WATER_TEXTURE_KEYS.homeDepthHandoff,
    WATER_ASSET_URLS.homeDepthHandoff,
    {
      frameWidth: WATER_HOME_HANDOFF_FRAME_SIZE,
      frameHeight: WATER_HOME_HANDOFF_FRAME_SIZE,
      margin: WATER_SHEET_MARGIN,
      spacing: WATER_SHEET_SPACING,
    },
  );
  scene.load.spritesheet(WATER_TEXTURE_KEYS.homeShore, WATER_ASSET_URLS.homeShore, {
    frameWidth: WATER_HOME_FRAME_SIZE,
    frameHeight: WATER_HOME_FRAME_SIZE,
    margin: WATER_SHEET_MARGIN,
    spacing: WATER_SHEET_SPACING,
  });
  scene.load.image(WATER_TEXTURE_KEYS.shoalLean, WATER_ASSET_URLS.shoalLean);
  scene.load.image(WATER_TEXTURE_KEYS.shoalSteady, WATER_ASSET_URLS.shoalSteady);
  scene.load.image(WATER_TEXTURE_KEYS.shoalRich, WATER_ASSET_URLS.shoalRich);
}

export function createWaterAssetRuntime(
  scene: Phaser.Scene,
  expectedTileSize = prototypeConfig.navigation.tileSize,
): Readonly<WaterAssetRuntime> {
  const metadata = validateWaterAssetPackage(scene.cache.json.get(WATER_METADATA_KEY));
  if (metadata.tileSize !== expectedTileSize) {
    throw new RangeError(`Water package tile size ${metadata.tileSize} does not match runtime tile size ${expectedTileSize}`);
  }
  const requiredTextures = Object.values(WATER_TEXTURE_KEYS);
  for (const key of requiredTextures) {
    if (!scene.textures.exists(key)) throw new RangeError(`Water texture ${key} did not load`);
  }
  return Object.freeze({
    package: metadata,
    profiles: new Map(metadata.profiles.map((profile) => [profile.id, profile])),
    hasTexture: (key: string) => scene.textures.exists(key),
  });
}

export function validateWaterAssetPackage(value: unknown): Readonly<WaterAssetPackageV1> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Water asset package must be an object");
  }
  const source = value as Record<string, unknown>;
  if (source.contractVersion !== WATER_ASSET_CONTRACT_VERSION) throw new RangeError("Unsupported water asset contract");
  if (source.kind !== "water-tile-package") throw new RangeError("Water package kind must be water-tile-package");
  if (typeof source.assetId !== "string" || source.assetId.length === 0) throw new RangeError("Water package requires an assetId");
  if (source.tileSize !== WATER_TILE_SIZE || source.variantCount !== 4) throw new RangeError("Water package tile geometry is invalid");
  if (!Array.isArray(source.profiles)) throw new RangeError("Water package requires profiles");
  const knownIds = new Set(DEFAULT_WATER_TYPE_CATALOG.types.map(({ id }) => id));
  const seen = new Set<string>();
  const profiles = source.profiles.map((candidate): WaterAssetProfileV1 => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) throw new RangeError("Water profile must be an object");
    const profile = candidate as Record<string, unknown>;
    if (typeof profile.id !== "string" || !knownIds.has(profile.id as WaterTypeId)) throw new RangeError(`Unknown water profile ${String(profile.id)}`);
    if (seen.has(profile.id)) throw new RangeError(`Duplicate water profile ${profile.id}`);
    seen.add(profile.id);
    for (const key of ["rowStart", "frameCount", "framesPerSecond"] as const) {
      const number = profile[key];
      const invalidMinimum = key === "rowStart" ? (number as number) < 0 : (number as number) <= 0;
      const invalidInteger = key !== "framesPerSecond" && !Number.isSafeInteger(number);
      if (typeof number !== "number" || !Number.isFinite(number) || invalidMinimum || invalidInteger) {
        throw new RangeError(`Water profile ${profile.id} has invalid ${key}`);
      }
    }
    return Object.freeze({
      id: profile.id as WaterTypeId,
      rowStart: Math.trunc(profile.rowStart as number),
      frameCount: Math.trunc(profile.frameCount as number),
      framesPerSecond: profile.framesPerSecond as number,
    });
  });
  for (const id of knownIds) if (!seen.has(id)) throw new RangeError(`Water package is missing profile ${id}`);
  return Object.freeze({
    contractVersion: WATER_ASSET_CONTRACT_VERSION,
    assetId: source.assetId,
    kind: "water-tile-package",
    tileSize: WATER_TILE_SIZE,
    variantCount: 4,
    profiles: Object.freeze(profiles),
  });
}
