import {
  WORLD_MANIFEST_ISLAND_KINDS,
  WORLD_MANIFEST_ISLAND_SIZES,
  WORLD_MANIFEST_LANDMARK_KINDS,
  WORLD_MANIFEST_SCHEMA_VERSION,
  stableIslandId,
  stableLandmarkId,
  type WorldManifestBoundsV2,
  type WorldManifestDimensionsV2,
  type WorldManifestInputV2,
  type WorldManifestIslandKind,
  type WorldManifestIslandSize,
  type WorldManifestIslandV2,
  type WorldManifestLandmarkKind,
  type WorldManifestLandmarkV2,
  type WorldManifestV2,
  type WorldManifestWaterLayoutV2,
  type WorldManifestWaterRegionV2,
  type WorldManifestWrappedFootprintV2,
} from "./WorldManifestContracts";
import type { WorldTopologyDefinition } from "../WorldTopology";

const TOP_LEVEL_REQUIRED = [
  "schemaVersion",
  "generatorVersion",
  "seed",
  "settingsProfileId",
  "authoredIslandCatalogRevision",
  "dimensions",
  "topology",
  "landmarks",
  "islands",
  "waterLayout",
] as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:-]*$/u;

const islandKinds = new Set<string>(WORLD_MANIFEST_ISLAND_KINDS);
const islandSizes = new Set<string>(WORLD_MANIFEST_ISLAND_SIZES);
const landmarkKinds = new Set<string>(WORLD_MANIFEST_LANDMARK_KINDS);

export class WorldManifestValidationError extends TypeError {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "WorldManifestValidationError";
  }
}

/** Creates a normalized, recursively frozen version-2 manifest. */
export function createWorldManifestV2(input: WorldManifestInputV2): WorldManifestV2 {
  return validateWorldManifestV2({
    ...input,
    schemaVersion: WORLD_MANIFEST_SCHEMA_VERSION,
  });
}

/**
 * Validates untrusted JSON-compatible input and returns a normalized manifest.
 * Descriptor arrays are sorted by stable ID so input traversal order is not a fact.
 */
export function validateWorldManifestV2(value: unknown): WorldManifestV2 {
  const source = exactRecord(
    value,
    "$",
    TOP_LEVEL_REQUIRED,
    ["settingsFingerprint"],
  );
  const schemaVersion = safeInteger(source.schemaVersion, "$.schemaVersion", 1);
  if (schemaVersion !== WORLD_MANIFEST_SCHEMA_VERSION) {
    fail("$.schemaVersion", `unsupported version ${schemaVersion}; expected ${WORLD_MANIFEST_SCHEMA_VERSION}`);
  }

  const generatorVersion = identifier(source.generatorVersion, "$.generatorVersion");
  const seed = safeInteger(source.seed, "$.seed");
  const settingsProfileId = identifier(source.settingsProfileId, "$.settingsProfileId");
  const authoredIslandCatalogRevision = identifier(
    source.authoredIslandCatalogRevision,
    "$.authoredIslandCatalogRevision",
  );
  const settingsFingerprint = source.settingsFingerprint === undefined
    ? undefined
    : identifier(source.settingsFingerprint, "$.settingsFingerprint");
  const dimensions = validateDimensions(source.dimensions);
  const topology = validateTopology(source.topology);
  const islands = validateIslands(source.islands, dimensions, topology);
  const landmarks = validateLandmarks(source.landmarks, dimensions);
  const waterLayout = validateWaterLayout(source.waterLayout, dimensions, topology);

  return deepFreeze({
    schemaVersion: WORLD_MANIFEST_SCHEMA_VERSION,
    generatorVersion,
    seed,
    settingsProfileId,
    authoredIslandCatalogRevision,
    ...(settingsFingerprint === undefined ? {} : { settingsFingerprint }),
    dimensions,
    topology,
    landmarks,
    islands,
    waterLayout,
  });
}

function validateWaterLayout(
  value: unknown,
  dimensions: Readonly<WorldManifestDimensionsV2>,
  topology: Readonly<WorldTopologyDefinition>,
): WorldManifestWaterLayoutV2 {
  const source = exactRecord(value, "$.waterLayout", ["version", "catalogFingerprint", "regions"]);
  const version = identifier(source.version, "$.waterLayout.version");
  const catalogFingerprint = identifier(source.catalogFingerprint, "$.waterLayout.catalogFingerprint");
  if (!Array.isArray(source.regions)) fail("$.waterLayout.regions", "must be an array");
  const ids = new Set<string>();
  const regions = source.regions.map((entry, index): WorldManifestWaterRegionV2 => {
    const path = `$.waterLayout.regions[${index}]`;
    const raw = plainRecord(entry, path);
    const strategy = stringValue(raw.strategy, `${path}.strategy`);
    const required = strategy === "ellipse"
      ? ["id", "typeId", "strategy", "seed", "center", "radiusX", "radiusY"]
      : strategy === "ribbon"
        ? ["id", "typeId", "strategy", "seed", "start", "end", "imageOffset", "width"]
        : fail(`${path}.strategy`, "must be ellipse or ribbon");
    const region = exactRecord(entry, path, required);
    const id = identifier(region.id, `${path}.id`);
    if (!id.startsWith("water:")) fail(`${path}.id`, "must start with water:");
    if (ids.has(id)) fail(`${path}.id`, `duplicates stable ID ${id}`);
    ids.add(id);
    const seed = safeInteger(region.seed, `${path}.seed`);
    if (strategy === "ellipse") {
      const typeId = identifier(region.typeId, `${path}.typeId`);
      return {
        id: id as `water:${string}`,
        typeId,
        strategy,
        seed,
        center: canonicalFinitePoint(region.center, `${path}.center`, dimensions),
        radiusX: finiteNumber(region.radiusX, `${path}.radiusX`, 0, false),
        radiusY: finiteNumber(region.radiusY, `${path}.radiusY`, 0, false),
      };
    }
    const typeId = identifier(region.typeId, `${path}.typeId`);
    const start = canonicalFinitePoint(region.start, `${path}.start`, dimensions);
    const end = canonicalFinitePoint(region.end, `${path}.end`, dimensions);
    const imageOffset = validateImageOffset(
      region.imageOffset,
      `${path}.imageOffset`,
      dimensions,
      topology,
    );
    if (end.x + imageOffset.x === start.x && end.y + imageOffset.y === start.y) {
      fail(path, "ribbon must have a non-zero lifted displacement");
    }
    return {
      id: id as `water:${string}`,
      typeId,
      strategy: "ribbon",
      seed,
      start,
      end,
      imageOffset,
      width: finiteNumber(region.width, `${path}.width`, 0, false),
    };
  }).sort(compareIds);
  return { version, catalogFingerprint, regions };
}

function canonicalFinitePoint(
  value: unknown,
  path: string,
  dimensions: Readonly<WorldManifestDimensionsV2>,
): { x: number; y: number } {
  const source = exactRecord(value, path, ["x", "y"]);
  return {
    x: finiteNumberBelow(source.x, `${path}.x`, dimensions.width),
    y: finiteNumberBelow(source.y, `${path}.y`, dimensions.height),
  };
}

/** Compact canonical JSON: UTF-16 code-unit key order, stable descriptor order, no trailing newline. */
export function serializeWorldManifestV2(manifest: WorldManifestV2): string {
  return canonicalJson(validateWorldManifestV2(manifest));
}

/** Canonical UTF-8 bytes suitable for hashing, persistence, or deterministic comparisons. */
export function encodeWorldManifestV2(manifest: WorldManifestV2): Uint8Array {
  return new TextEncoder().encode(serializeWorldManifestV2(manifest));
}

/** Parses UTF-8 or JSON text, validates it, and returns a normalized frozen manifest. */
export function parseWorldManifestV2(source: string | Uint8Array): WorldManifestV2 {
  let json: string;
  try {
    json = typeof source === "string" ? source : new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch (error) {
    fail("$", `manifest bytes are not valid UTF-8 (${errorMessage(error)})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    fail("$", `manifest is not valid JSON (${errorMessage(error)})`);
  }
  return validateWorldManifestV2(parsed);
}

function validateDimensions(value: unknown): WorldManifestDimensionsV2 {
  const source = exactRecord(value, "$.dimensions", ["width", "height", "chunkSize"]);
  return {
    width: safeInteger(source.width, "$.dimensions.width", 1),
    height: safeInteger(source.height, "$.dimensions.height", 1),
    chunkSize: safeInteger(source.chunkSize, "$.dimensions.chunkSize", 1),
  };
}

function validateTopology(value: unknown): WorldTopologyDefinition {
  const source = exactRecord(value, "$.topology", ["x", "y"]);
  return {
    x: topologyAxis(source.x, "$.topology.x"),
    y: topologyAxis(source.y, "$.topology.y"),
  };
}

function topologyAxis(value: unknown, path: string): "bounded" | "wrap" {
  if (value !== "bounded" && value !== "wrap") fail(path, "must be bounded or wrap");
  return value;
}

function validateImageOffset(
  value: unknown,
  path: string,
  dimensions: Readonly<WorldManifestDimensionsV2>,
  topology: Readonly<WorldTopologyDefinition>,
): { x: number; y: number } {
  const source = exactRecord(value, path, ["x", "y"]);
  const x = safeInteger(source.x, `${path}.x`);
  const y = safeInteger(source.y, `${path}.y`);
  validateAxisImageOffset(x, dimensions.width, topology.x, `${path}.x`);
  validateAxisImageOffset(y, dimensions.height, topology.y, `${path}.y`);
  return { x, y };
}

function validateAxisImageOffset(
  offset: number,
  span: number,
  topology: WorldTopologyDefinition["x"],
  path: string,
): void {
  if (offset % span !== 0) fail(path, `must be a whole-world offset divisible by ${span}`);
  if (topology === "bounded" && offset !== 0) {
    fail(path, "must be zero for a bounded topology axis");
  }
}

function validateLandmarks(
  value: unknown,
  dimensions: Readonly<WorldManifestDimensionsV2>,
): WorldManifestLandmarkV2[] {
  if (!Array.isArray(value)) fail("$.landmarks", "must be an array");
  const seen = new Set<string>();
  const landmarks = value.map((entry, index) => {
    const path = `$.landmarks[${index}]`;
    const source = exactRecord(entry, path, ["id", "kind", "position"]);
    const kind = enumString(source.kind, `${path}.kind`, landmarkKinds) as WorldManifestLandmarkKind;
    const id = stringValue(source.id, `${path}.id`);
    const expectedId = stableLandmarkId(kind);
    if (id !== expectedId) fail(`${path}.id`, `must be ${expectedId} for landmark kind ${kind}`);
    if (seen.has(id)) fail(`${path}.id`, `duplicates stable ID ${id}`);
    seen.add(id);
    return {
      id: expectedId,
      kind,
      position: point(source.position, `${path}.position`, dimensions),
    };
  });

  for (const kind of WORLD_MANIFEST_LANDMARK_KINDS) {
    const expectedId = stableLandmarkId(kind);
    if (!seen.has(expectedId)) fail("$.landmarks", `is missing required landmark ${expectedId}`);
  }
  if (landmarks.length !== WORLD_MANIFEST_LANDMARK_KINDS.length) {
    fail("$.landmarks", `must contain exactly ${WORLD_MANIFEST_LANDMARK_KINDS.length} version-2 landmarks`);
  }
  return landmarks.sort(compareIds);
}

function validateIslands(
  value: unknown,
  dimensions: Readonly<WorldManifestDimensionsV2>,
  topology: Readonly<WorldTopologyDefinition>,
): WorldManifestIslandV2[] {
  if (!Array.isArray(value)) fail("$.islands", "must be an array");
  const seenIds = new Set<string>();
  const seenSourceIds = new Set<number>();
  return value.map((entry, index) => {
    const path = `$.islands[${index}]`;
    const source = exactRecord(entry, path, [
      "id",
      "sourceId",
      "kind",
      "size",
      "center",
      "radiusX",
      "radiusY",
      "outerRadius",
      "rotation",
      "shapeSeed",
      "footprint",
      "sourceKind",
    ], ["authoredAssetId"]);
    const sourceId = safeInteger(source.sourceId, `${path}.sourceId`, 1);
    const expectedId = stableIslandId(sourceId);
    const id = stringValue(source.id, `${path}.id`);
    if (id !== expectedId) fail(`${path}.id`, `must be ${expectedId} for sourceId ${sourceId}`);
    if (seenIds.has(id)) fail(`${path}.id`, `duplicates stable ID ${id}`);
    if (seenSourceIds.has(sourceId)) fail(`${path}.sourceId`, `duplicates source ID ${sourceId}`);
    seenIds.add(id);
    seenSourceIds.add(sourceId);

    const kind = enumString(source.kind, `${path}.kind`, islandKinds) as WorldManifestIslandKind;
    const size = enumString(source.size, `${path}.size`, islandSizes) as WorldManifestIslandSize;
    const center = point(source.center, `${path}.center`, dimensions);
    const radiusX = finiteNumber(source.radiusX, `${path}.radiusX`, 0, false);
    const radiusY = finiteNumber(source.radiusY, `${path}.radiusY`, 0, false);
    const outerRadius = finiteNumber(source.outerRadius, `${path}.outerRadius`, 0, false);
    if (outerRadius < Math.max(radiusX, radiusY)) {
      fail(`${path}.outerRadius`, "must be at least radiusX and radiusY");
    }
    const rotation = finiteNumber(source.rotation, `${path}.rotation`, 0);
    if (rotation >= Math.PI * 2) fail(`${path}.rotation`, "must be less than 2π radians");
    const shapeSeed = safeInteger(source.shapeSeed, `${path}.shapeSeed`, 0, 0xffff_ffff);
    if (source.sourceKind !== "authored" && source.sourceKind !== "procedural") {
      fail(`${path}.sourceKind`, "must be authored or procedural");
    }
    const sourceKind = source.sourceKind as "authored" | "procedural";
    let authoredAssetId: string | undefined;
    if (sourceKind === "authored") {
      authoredAssetId = identifier(source.authoredAssetId, `${path}.authoredAssetId`);
    } else if (source.authoredAssetId !== undefined) {
      fail(`${path}.authoredAssetId`, "is only valid for authored islands");
    }
    const footprint = validateFootprint(
      source.footprint,
      `${path}.footprint`,
      center,
      outerRadius,
      dimensions,
      topology,
      sourceKind,
    );
    return {
      id: expectedId,
      sourceId,
      kind,
      size,
      center,
      radiusX,
      radiusY,
      outerRadius,
      rotation,
      shapeSeed,
      footprint,
      sourceKind,
      ...(authoredAssetId === undefined ? {} : { authoredAssetId }),
    };
  }).sort(compareIds);
}

function validateFootprint(
  value: unknown,
  path: string,
  center: Readonly<{ x: number; y: number }>,
  outerRadius: number,
  dimensions: Readonly<WorldManifestDimensionsV2>,
  topology: Readonly<WorldTopologyDefinition>,
  sourceKind: "authored" | "procedural",
): WorldManifestWrappedFootprintV2 {
  const source = exactRecord(value, path, ["liftedBounds", "pieces"]);
  const bounds = liftedBounds(source.liftedBounds, `${path}.liftedBounds`);
  const footprintWidth = bounds.maxX - bounds.minX + 1;
  const footprintHeight = bounds.maxY - bounds.minY + 1;
  if (footprintWidth >= dimensions.width) {
    fail(`${path}.liftedBounds`, `width ${footprintWidth} must be strictly smaller than world width ${dimensions.width}`);
  }
  if (footprintHeight >= dimensions.height) {
    fail(`${path}.liftedBounds`, `height ${footprintHeight} must be strictly smaller than world height ${dimensions.height}`);
  }
  if (center.x < bounds.minX || center.x > bounds.maxX || center.y < bounds.minY || center.y > bounds.maxY) {
    fail(`${path}.liftedBounds`, "must contain the canonical island center");
  }
  if (sourceKind === "procedural") {
    const extent = Math.ceil(outerRadius);
    if (
      bounds.minX > center.x - extent
      || bounds.minY > center.y - extent
      || bounds.maxX < center.x + extent
      || bounds.maxY < center.y + extent
    ) fail(`${path}.liftedBounds`, `must contain the island's outer-radius extent of ${extent} cells`);
  }

  const expected = decomposeFootprint(bounds, dimensions, topology, `${path}.liftedBounds`);
  if (!Array.isArray(source.pieces)) fail(`${path}.pieces`, "must be an array");
  if (source.pieces.length === 0 || source.pieces.length > 4) {
    fail(`${path}.pieces`, "must contain between one and four canonical pieces");
  }
  const pieces = source.pieces
    .map((piece, index) => canonicalBounds(piece, `${path}.pieces[${index}]`, dimensions))
    .sort(compareBounds);
  for (let index = 1; index < pieces.length; index++) {
    if (sameBounds(pieces[index - 1]!, pieces[index]!)) {
      fail(`${path}.pieces[${index}]`, "duplicates a canonical footprint piece");
    }
  }
  if (pieces.length !== expected.length || pieces.some((piece, index) => !sameBounds(piece, expected[index]!))) {
    fail(`${path}.pieces`, "must exactly match the lifted bounds under the declared topology");
  }
  return { liftedBounds: bounds, pieces };
}

function liftedBounds(value: unknown, path: string): WorldManifestBoundsV2 {
  const source = exactRecord(value, path, ["minX", "minY", "maxX", "maxY"]);
  const bounds = {
    minX: safeInteger(source.minX, `${path}.minX`),
    minY: safeInteger(source.minY, `${path}.minY`),
    maxX: safeInteger(source.maxX, `${path}.maxX`),
    maxY: safeInteger(source.maxY, `${path}.maxY`),
  };
  if (bounds.minX > bounds.maxX) fail(path, "minX must not exceed maxX");
  if (bounds.minY > bounds.maxY) fail(path, "minY must not exceed maxY");
  return bounds;
}

function canonicalBounds(
  value: unknown,
  path: string,
  dimensions: Readonly<WorldManifestDimensionsV2>,
): WorldManifestBoundsV2 {
  const source = exactRecord(value, path, ["minX", "minY", "maxX", "maxY"]);
  const bounds = {
    minX: safeInteger(source.minX, `${path}.minX`, 0, dimensions.width - 1),
    minY: safeInteger(source.minY, `${path}.minY`, 0, dimensions.height - 1),
    maxX: safeInteger(source.maxX, `${path}.maxX`, 0, dimensions.width - 1),
    maxY: safeInteger(source.maxY, `${path}.maxY`, 0, dimensions.height - 1),
  };
  if (bounds.minX > bounds.maxX) fail(path, "minX must not exceed maxX");
  if (bounds.minY > bounds.maxY) fail(path, "minY must not exceed maxY");
  return bounds;
}

function decomposeFootprint(
  bounds: Readonly<WorldManifestBoundsV2>,
  dimensions: Readonly<WorldManifestDimensionsV2>,
  topology: Readonly<WorldTopologyDefinition>,
  path: string,
): WorldManifestBoundsV2[] {
  const xPieces = decomposeAxis(bounds.minX, bounds.maxX, dimensions.width, topology.x, `${path}.minX`);
  const yPieces = decomposeAxis(bounds.minY, bounds.maxY, dimensions.height, topology.y, `${path}.minY`);
  const pieces: WorldManifestBoundsV2[] = [];
  for (const y of yPieces) {
    for (const x of xPieces) {
      pieces.push({ minX: x.min, minY: y.min, maxX: x.max, maxY: y.max });
    }
  }
  return pieces.sort(compareBounds);
}

function decomposeAxis(
  minimum: number,
  maximum: number,
  span: number,
  topology: WorldTopologyDefinition["x"],
  path: string,
): Array<{ min: number; max: number }> {
  if (topology === "bounded") {
    if (minimum < 0 || maximum >= span) {
      fail(path, `is outside the bounded topology span 0..${span - 1}`);
    }
    return [{ min: minimum, max: maximum }];
  }
  const start = positiveModulo(minimum, span);
  const length = maximum - minimum + 1;
  const liftedEnd = start + length - 1;
  return liftedEnd < span
    ? [{ min: start, max: liftedEnd }]
    : [{ min: start, max: span - 1 }, { min: 0, max: liftedEnd - span }];
}

function positiveModulo(value: number, span: number): number {
  const result = value % span;
  return result < 0 ? result + span : result;
}

function compareBounds(left: Readonly<WorldManifestBoundsV2>, right: Readonly<WorldManifestBoundsV2>): number {
  return left.minY - right.minY
    || left.minX - right.minX
    || left.maxY - right.maxY
    || left.maxX - right.maxX;
}

function sameBounds(left: Readonly<WorldManifestBoundsV2>, right: Readonly<WorldManifestBoundsV2>): boolean {
  return left.minX === right.minX
    && left.minY === right.minY
    && left.maxX === right.maxX
    && left.maxY === right.maxY;
}

function point(
  value: unknown,
  path: string,
  dimensions: Readonly<WorldManifestDimensionsV2>,
): { x: number; y: number } {
  const source = exactRecord(value, path, ["x", "y"]);
  return {
    x: safeInteger(source.x, `${path}.x`, 0, dimensions.width - 1),
    y: safeInteger(source.y, `${path}.y`, 0, dimensions.height - 1),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
}

function exactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const source = plainRecord(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not a version-2 manifest field");
  }
  for (const key of required) {
    if (!Object.hasOwn(source, key)) fail(`${path}.${key}`, "is required");
  }
  return source;
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, "must be a plain object");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

function identifier(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (result.length > 128 || !IDENTIFIER_PATTERN.test(result)) {
    fail(path, "must be a portable identifier (letters, numbers, dot, underscore, slash, colon, or hyphen)");
  }
  return result;
}

function enumString(value: unknown, path: string, choices: ReadonlySet<string>): string {
  const result = stringValue(value, path);
  if (!choices.has(result)) fail(path, `must be one of ${[...choices].join(", ")}`);
  return result;
}

function safeInteger(value: unknown, path: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(path, "must be a safe integer");
  if (minimum !== undefined && value < minimum) fail(path, `must be at least ${minimum}`);
  if (maximum !== undefined && value > maximum) fail(path, `must be at most ${maximum}`);
  return Object.is(value, -0) ? 0 : value;
}

function finiteNumber(
  value: unknown,
  path: string,
  minimum?: number,
  inclusive = true,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a finite number");
  if (minimum !== undefined && (inclusive ? value < minimum : value <= minimum)) {
    fail(path, inclusive ? `must be at least ${minimum}` : `must be greater than ${minimum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function finiteNumberBelow(value: unknown, path: string, maximumExclusive: number): number {
  const result = finiteNumber(value, path, 0);
  if (result >= maximumExclusive) fail(path, `must be less than ${maximumExclusive}`);
  return result;
}

function compareIds<T extends { readonly id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(path: string, message: string): never {
  throw new WorldManifestValidationError(path, message);
}
