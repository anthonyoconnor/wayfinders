import { prototypeConfig, type PrototypeConfig } from "../../config/prototypeConfig";
import { resolveAuthoredHomeIslandPlacement } from "../../assets/AuthoredHomeIsland";
import {
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalog,
  type AuthoredIslandCatalogEntry,
} from "../AuthoredIslandCatalog";
import { IslandPlacementIndex } from "../IslandPlacementIndex";
import { WorldGrid } from "../WorldGrid";
import {
  WORLD_GENERATOR_VERSION,
  WorldGenerator,
  type GeneratedWorld,
  type WorldAnalysisIdentity,
} from "../WorldGenerator";
import { WRAPPING_WORLD_TOPOLOGY } from "../WorldTopology";
import {
  createAuthoredIslandPlacementProfile,
  finishIslandPlacement,
  islandPlacementProfileExtent,
  islandPlacementRejection,
  type IslandPlacementProfile,
} from "./AuthoredIslandPlacement";
import {
  AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
  AUTHORED_WORLD_LAYOUT_CONTRACT_VERSION,
  type AuthoredWorldCompileResultV1,
  type AuthoredWorldDiagnosticV1,
  type AuthoredWorldIslandV1,
  type AuthoredWorldLayoutDimensionsV1,
  type AuthoredWorldLayoutV1,
} from "./AuthoredWorldLayoutContracts";
import { currentAuthoredWorldLayoutSettingsFingerprint } from "./AuthoredWorldLayoutFingerprint";

export const AUTHORED_WORLD_SETTINGS_PROFILE_ID = "authored-map-v1";

export function currentAuthoredWorldLayoutDimensionsV1(
  config: PrototypeConfig,
): Readonly<AuthoredWorldLayoutDimensionsV1> {
  return Object.freeze({
    width: config.world.width,
    height: config.world.height,
    chunkSize: config.navigation.chunkSize,
    tileSize: config.navigation.tileSize,
    artTileSize: config.navigation.artTileSize,
  });
}

export function createCurrentAuthoredWorldLayoutV1(
  baseSeed: number,
  islands: readonly Readonly<AuthoredWorldIslandV1>[],
  config: PrototypeConfig = prototypeConfig,
): Readonly<AuthoredWorldLayoutV1> {
  return Object.freeze({
    contractVersion: AUTHORED_WORLD_LAYOUT_CONTRACT_VERSION,
    settingsFingerprint: currentAuthoredWorldLayoutSettingsFingerprint(config),
    generatorVersion: WORLD_GENERATOR_VERSION,
    dimensions: currentAuthoredWorldLayoutDimensionsV1(config),
    topology: Object.freeze({ ...WRAPPING_WORLD_TOPOLOGY }),
    baseSeed,
    islands: Object.freeze(islands.map((island) => Object.freeze({
      ...island,
      center: Object.freeze({ ...island.center }),
    })).sort((left, right) => left.sourceId - right.sourceId)),
  });
}

export interface AuthoredWorldCompilerOptionsV1 {
  readonly config?: PrototypeConfig;
  readonly analysisIdentity?: Readonly<WorldAnalysisIdentity>;
}

/**
 * Compiles explicit authored instances through the ordinary planned-world,
 * rasterization, analysis, and water contracts. Expected invalid layouts are
 * returned as diagnostics and never expose a partial grid.
 */
export function compileAuthoredWorldLayoutV1(
  layout: Readonly<AuthoredWorldLayoutV1>,
  collisionCatalog: Readonly<AuthoredIslandCatalog>,
  options: Readonly<AuthoredWorldCompilerOptionsV1> = {},
): AuthoredWorldCompileResultV1 {
  const config = options.config ?? prototypeConfig;
  const diagnostics: AuthoredWorldDiagnosticV1[] = [];
  validateCompatibility(layout, config, diagnostics);
  if (diagnostics.length > 0) return failed(diagnostics);

  const catalog = validateAuthoredIslandCatalog(collisionCatalog);
  const entryById = new Map(catalog.islands.map((entry) => [entry.assetId, entry] as const));
  const seenSourceIds = new Set<number>();
  const resolved: Array<{
    readonly source: Readonly<AuthoredWorldIslandV1>;
    readonly sourceIndex: number;
    readonly entry: Readonly<AuthoredIslandCatalogEntry>;
    readonly profile: IslandPlacementProfile;
  }> = [];

  for (const [sourceIndex, source] of layout.islands.entries()) {
    const path = `$.world.islands[${sourceIndex}]`;
    if (
      !Number.isSafeInteger(source.sourceId)
      || source.sourceId <= 0
      || source.sourceId > AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID
    ) {
      diagnostics.push(issue(
        "invalid-island-source-id",
        `${path}.sourceId`,
        `must be an integer from 1 through ${AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID}`,
        source,
      ));
      continue;
    }
    if (seenSourceIds.has(source.sourceId)) {
      diagnostics.push(issue(
        "duplicate-island-source-id",
        `${path}.sourceId`,
        `duplicates island source ID ${source.sourceId}`,
        source,
      ));
      continue;
    }
    seenSourceIds.add(source.sourceId);
    if (!isCanonicalIntegerPoint(source.center, config.world.width, config.world.height)) {
      diagnostics.push(issue(
        "invalid-island-center",
        `${path}.center`,
        `must be a canonical integer tile inside ${config.world.width}x${config.world.height}`,
        source,
      ));
      continue;
    }
    const entry = entryById.get(source.authoredAssetId);
    if (!entry) {
      diagnostics.push(issue(
        "missing-island-asset",
        `${path}.authoredAssetId`,
        `available collision catalog has no island ${source.authoredAssetId}`,
        source,
      ));
      continue;
    }
    if (entry.revision !== source.assetRevision) {
      diagnostics.push(issue(
        "stale-island-asset",
        `${path}.assetRevision`,
        `island ${source.authoredAssetId} requires revision ${source.assetRevision}; current revision is ${entry.revision}`,
        source,
      ));
      continue;
    }
    const profile = createAuthoredIslandPlacementProfile(source.sourceId, entry, config);
    const extent = islandPlacementProfileExtent(profile);
    if (extent.width >= config.world.width || extent.height >= config.world.height) {
      diagnostics.push(issue(
        "island-footprint-too-large",
        path,
        `footprint ${extent.width}x${extent.height} must be strictly smaller than the world`,
        source,
      ));
      continue;
    }
    resolved.push({ source, sourceIndex, entry, profile });
  }

  if (layout.islands.length === 0) {
    diagnostics.push({
      code: "missing-island",
      path: "$.world.islands",
      message: "must contain at least one non-home island",
    });
  }
  if (diagnostics.length > 0) return failed(diagnostics);

  resolved.sort((left, right) => left.source.sourceId - right.source.sourceId);
  const planningGrid = new WorldGrid(
    config.world.width,
    config.world.height,
    config.navigation.chunkSize,
    WRAPPING_WORLD_TOPOLOGY,
    config.navigation.tileSize,
  );
  const home = resolveAuthoredHomeIslandPlacement({
    x: Math.floor(planningGrid.width / 2),
    y: Math.floor(planningGrid.height / 2),
  });
  const maximumOuterRadius = resolved.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.profile.outerRadius),
    0,
  );
  const placementIndex = new IslandPlacementIndex(
    planningGrid.topology,
    maximumOuterRadius,
    config.islands.minimumChannelWidth,
  );
  const islands: ReturnType<typeof finishIslandPlacement>[] = [];
  for (const candidate of resolved) {
    const rejection = islandPlacementRejection(
      planningGrid.topology,
      home.landmarks.homeCenter,
      home.landmarks.dock,
      candidate.profile,
      candidate.source.center,
      placementIndex,
      config,
    );
    if (rejection) {
      diagnostics.push(issue(
        rejection,
        `$.world.islands[${candidate.sourceIndex}].center`,
        placementMessage(rejection),
        candidate.source,
      ));
      continue;
    }
    const island = finishIslandPlacement(candidate.profile, candidate.source.center);
    islands.push(island);
    placementIndex.add(island);
  }
  if (diagnostics.length > 0) return failed(diagnostics);

  try {
    const generator = new WorldGenerator(config, catalog);
    const plan = generator.planResolvedIslands(layout.baseSeed, islands, {
      settingsProfileId: AUTHORED_WORLD_SETTINGS_PROFILE_ID,
      settingsFingerprint: layout.settingsFingerprint,
      authoredIslandCatalogRevision: catalog.revision,
    });
    const rasterized = generator.rasterize(plan);
    const analysis = generator.analyze(rasterized, options.analysisIdentity);
    const water = generator.planWater(rasterized, analysis);
    const generated: GeneratedWorld = { ...rasterized, analysis, water };
    return Object.freeze({
      ok: true,
      value: Object.freeze({ plan, generated }),
    });
  } catch (error) {
    return failed([{
      code: "world-rasterization",
      path: "$.world",
      message: error instanceof Error ? error.message : String(error),
    }]);
  }
}

function validateCompatibility(
  layout: Readonly<AuthoredWorldLayoutV1>,
  config: PrototypeConfig,
  diagnostics: AuthoredWorldDiagnosticV1[],
): void {
  if (layout.contractVersion !== AUTHORED_WORLD_LAYOUT_CONTRACT_VERSION) {
    diagnostics.push({
      code: "unsupported-layout-contract",
      path: "$.world.contractVersion",
      message: `unsupported version ${layout.contractVersion}; expected ${AUTHORED_WORLD_LAYOUT_CONTRACT_VERSION}`,
    });
  }
  const expectedFingerprint = currentAuthoredWorldLayoutSettingsFingerprint(config);
  if (layout.settingsFingerprint !== expectedFingerprint) {
    diagnostics.push({
      code: "stale-layout-settings",
      path: "$.world.settingsFingerprint",
      message: `requires ${layout.settingsFingerprint}; current settings are ${expectedFingerprint}`,
    });
  }
  if (layout.generatorVersion !== WORLD_GENERATOR_VERSION) {
    diagnostics.push({
      code: "stale-generator-contract",
      path: "$.world.generatorVersion",
      message: `requires ${layout.generatorVersion}; current generator is ${WORLD_GENERATOR_VERSION}`,
    });
  }
  const expectedDimensions = currentAuthoredWorldLayoutDimensionsV1(config);
  if (
    layout.dimensions.width !== expectedDimensions.width
    || layout.dimensions.height !== expectedDimensions.height
    || layout.dimensions.chunkSize !== expectedDimensions.chunkSize
    || layout.dimensions.tileSize !== expectedDimensions.tileSize
    || layout.dimensions.artTileSize !== expectedDimensions.artTileSize
    || layout.topology.x !== WRAPPING_WORLD_TOPOLOGY.x
    || layout.topology.y !== WRAPPING_WORLD_TOPOLOGY.y
  ) {
    diagnostics.push({
      code: "incompatible-world-shape",
      path: "$.world.dimensions",
      message: "must match the current normal-game dimensions, tile scales, chunk size, and wrapping topology",
    });
  }
  if (!Number.isSafeInteger(layout.baseSeed)) {
    diagnostics.push({
      code: "invalid-base-seed",
      path: "$.world.baseSeed",
      message: "must be a safe integer",
    });
  }
}

function isCanonicalIntegerPoint(
  point: Readonly<{ x: number; y: number }>,
  width: number,
  height: number,
): boolean {
  return Number.isSafeInteger(point.x)
    && Number.isSafeInteger(point.y)
    && point.x >= 0
    && point.y >= 0
    && point.x < width
    && point.y < height;
}

function issue(
  code: AuthoredWorldDiagnosticV1["code"],
  path: string,
  message: string,
  source: Readonly<AuthoredWorldIslandV1>,
): AuthoredWorldDiagnosticV1 {
  return {
    code,
    path,
    message,
    sourceId: source.sourceId,
    tile: Object.freeze({ ...source.center }),
  };
}

function failed(
  diagnostics: readonly Readonly<AuthoredWorldDiagnosticV1>[],
): AuthoredWorldCompileResultV1 {
  return Object.freeze({ ok: false, diagnostics: Object.freeze([...diagnostics]) });
}

function placementMessage(code: "home-clearance" | "starter-lane" | "island-channel"): string {
  switch (code) {
    case "home-clearance": return "island intersects the fixed Home clearance";
    case "starter-lane": return "island intersects the protected eastbound departure corridor";
    case "island-channel": return "island violates the minimum periodic channel separation";
  }
}
