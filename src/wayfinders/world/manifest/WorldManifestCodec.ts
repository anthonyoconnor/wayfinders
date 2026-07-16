import {
  WORLD_MANIFEST_ISLAND_KINDS,
  WORLD_MANIFEST_ISLAND_SIZES,
  WORLD_MANIFEST_LANDMARK_KINDS,
  WORLD_MANIFEST_SCHEMA_VERSION,
  stableIslandId,
  stableLandmarkId,
  type WorldManifestBoundsV1,
  type WorldManifestDimensionsV1,
  type WorldManifestInputV1,
  type WorldManifestIslandKind,
  type WorldManifestIslandSize,
  type WorldManifestIslandV1,
  type WorldManifestLandmarkKind,
  type WorldManifestLandmarkV1,
  type WorldManifestV1,
} from "./WorldManifestContracts";

const TOP_LEVEL_REQUIRED = [
  "schemaVersion",
  "generatorVersion",
  "seed",
  "settingsProfileId",
  "authoredIslandCatalogRevision",
  "dimensions",
  "landmarks",
  "islands",
] as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

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

/** Creates a normalized, recursively frozen version-1 manifest. */
export function createWorldManifestV1(input: WorldManifestInputV1): WorldManifestV1 {
  return validateWorldManifestV1({
    ...input,
    schemaVersion: WORLD_MANIFEST_SCHEMA_VERSION,
  });
}

/**
 * Validates untrusted JSON-compatible input and returns a normalized manifest.
 * Descriptor arrays are sorted by stable ID so input traversal order is not a fact.
 */
export function validateWorldManifestV1(value: unknown): WorldManifestV1 {
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
  const islands = validateIslands(source.islands, dimensions);
  const landmarks = validateLandmarks(source.landmarks, dimensions);

  return deepFreeze({
    schemaVersion: WORLD_MANIFEST_SCHEMA_VERSION,
    generatorVersion,
    seed,
    settingsProfileId,
    authoredIslandCatalogRevision,
    ...(settingsFingerprint === undefined ? {} : { settingsFingerprint }),
    dimensions,
    landmarks,
    islands,
  });
}

/** Compact canonical JSON: UTF-16 code-unit key order, stable descriptor order, no trailing newline. */
export function serializeWorldManifestV1(manifest: WorldManifestV1): string {
  return canonicalJson(validateWorldManifestV1(manifest));
}

/** Canonical UTF-8 bytes suitable for hashing, persistence, or deterministic comparisons. */
export function encodeWorldManifestV1(manifest: WorldManifestV1): Uint8Array {
  return new TextEncoder().encode(serializeWorldManifestV1(manifest));
}

/** Parses UTF-8 or JSON text, validates it, and returns a normalized frozen manifest. */
export function parseWorldManifestV1(source: string | Uint8Array): WorldManifestV1 {
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
  return validateWorldManifestV1(parsed);
}

function validateDimensions(value: unknown): WorldManifestDimensionsV1 {
  const source = exactRecord(value, "$.dimensions", ["width", "height", "chunkSize"]);
  return {
    width: safeInteger(source.width, "$.dimensions.width", 1),
    height: safeInteger(source.height, "$.dimensions.height", 1),
    chunkSize: safeInteger(source.chunkSize, "$.dimensions.chunkSize", 1),
  };
}

function validateLandmarks(
  value: unknown,
  dimensions: Readonly<WorldManifestDimensionsV1>,
): WorldManifestLandmarkV1[] {
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
    fail("$.landmarks", `must contain exactly ${WORLD_MANIFEST_LANDMARK_KINDS.length} version-1 landmarks`);
  }
  return landmarks.sort(compareIds);
}

function validateIslands(
  value: unknown,
  dimensions: Readonly<WorldManifestDimensionsV1>,
): WorldManifestIslandV1[] {
  if (!Array.isArray(value)) fail("$.islands", "must be an array");
  const seenIds = new Set<string>();
  const seenSourceIds = new Set<number>();
  const seenAuthoredAssetIds = new Set<string>();
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
      "bounds",
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
      if (seenAuthoredAssetIds.has(authoredAssetId)) {
        fail(`${path}.authoredAssetId`, `duplicates authored asset ID ${authoredAssetId}`);
      }
      seenAuthoredAssetIds.add(authoredAssetId);
    } else if (source.authoredAssetId !== undefined) {
      fail(`${path}.authoredAssetId`, "is only valid for authored islands");
    }
    const bounds = validateBounds(source.bounds, `${path}.bounds`, center, outerRadius, dimensions, sourceKind);
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
      bounds,
      sourceKind,
      ...(authoredAssetId === undefined ? {} : { authoredAssetId }),
    };
  }).sort(compareIds);
}

function validateBounds(
  value: unknown,
  path: string,
  center: Readonly<{ x: number; y: number }>,
  outerRadius: number,
  dimensions: Readonly<WorldManifestDimensionsV1>,
  sourceKind: "authored" | "procedural",
): WorldManifestBoundsV1 {
  const source = exactRecord(value, path, ["minX", "minY", "maxX", "maxY"]);
  const bounds = {
    minX: safeInteger(source.minX, `${path}.minX`, 0, dimensions.width - 1),
    minY: safeInteger(source.minY, `${path}.minY`, 0, dimensions.height - 1),
    maxX: safeInteger(source.maxX, `${path}.maxX`, 0, dimensions.width - 1),
    maxY: safeInteger(source.maxY, `${path}.maxY`, 0, dimensions.height - 1),
  };
  if (bounds.minX > bounds.maxX) fail(path, "minX must not exceed maxX");
  if (bounds.minY > bounds.maxY) fail(path, "minY must not exceed maxY");
  if (sourceKind === "procedural") {
    const extent = Math.ceil(outerRadius);
    if (
      bounds.minX > center.x - extent
      || bounds.minY > center.y - extent
      || bounds.maxX < center.x + extent
      || bounds.maxY < center.y + extent
    ) fail(path, `must contain the island's outer-radius extent of ${extent} cells`);
  } else if (
    center.x < bounds.minX || center.x > bounds.maxX || center.y < bounds.minY || center.y > bounds.maxY
  ) fail(path, "must contain the authored island center");
  return bounds;
}

function point(
  value: unknown,
  path: string,
  dimensions: Readonly<WorldManifestDimensionsV1>,
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
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not a version-1 manifest field");
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
    fail(path, "must be a portable identifier (letters, numbers, dot, underscore, slash, or hyphen)");
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
