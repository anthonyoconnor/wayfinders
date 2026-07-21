import {
  DEFAULT_GAME_SETTINGS,
  prototypeConfigFromGameSettings,
} from "../../config/gameSettings";
import {
  FISHING_SHOAL_CLUE_KINDS,
  FISHING_SHOAL_QUALITIES,
  isCurrentFishingShoalId,
  authoredFishingCapacityProofV1,
} from "../../features/fishing";
import {
  AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
  authoredIslandCapacityProofV1,
} from "../../world/authored";
import {
  AUTHORED_MAP_FORMAT_VERSION,
  type AuthoredMapDefinitionInputV1,
  type AuthoredMapDefinitionV1,
} from "./AuthoredMapContracts";

const MAP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const STABLE_ASSET_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const PORTABLE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_MAP_ID_BYTES = 64;
const MAXIMUM_DISPLAY_NAME_SCALARS = 80;
const MAXIMUM_DISPLAY_NAME_BYTES = 320;
const NORMAL_AUTHORED_MAP_CONFIG = prototypeConfigFromGameSettings(DEFAULT_GAME_SETTINGS);

export class AuthoredMapValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "AuthoredMapValidationError";
  }
}

export function parseAuthoredMapDefinitionV1(
  source: string | Uint8Array,
): Readonly<AuthoredMapDefinitionV1> {
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
  if (bytes.byteLength > maximumAuthoredMapCanonicalBytesV1()) {
    fail("$", `exceeds the ${maximumAuthoredMapCanonicalBytesV1()}-byte authored-map safety bound`);
  }
  let text: string;
  try {
    text = typeof source === "string" ? source : new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch (error) {
    throw new SyntaxError(`Authored map is not valid UTF-8 JSON: ${errorMessage(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Authored map is not valid UTF-8 JSON: ${errorMessage(error)}`);
  }
  return validateAuthoredMapDefinitionV1(value);
}

/** Structural normalization intentionally does not compare against live catalogs/settings. */
export function validateAuthoredMapDefinitionV1(input: unknown): Readonly<AuthoredMapDefinitionV1> {
  return normalizeDefinition(input, true) as Readonly<AuthoredMapDefinitionV1>;
}

export function serializeAuthoredMapDefinitionV1(
  definition: Readonly<AuthoredMapDefinitionV1>,
): string {
  return `${canonicalJson(validateAuthoredMapDefinitionV1(definition))}\n`;
}

export function encodeAuthoredMapDefinitionV1(
  definition: Readonly<AuthoredMapDefinitionV1>,
): Uint8Array {
  return new TextEncoder().encode(serializeAuthoredMapDefinitionV1(definition));
}

/** SHA-256 over normalized semantic content, excluding only contentFingerprint. */
export async function authoredMapContentFingerprintV1(
  definition: Readonly<AuthoredMapDefinitionV1>,
): Promise<string> {
  const normalized = validateAuthoredMapDefinitionV1(definition);
  const { contentFingerprint: _excluded, ...semantic } = normalized;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(semantic)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Verifies that an immutable repository read is the exact definition requested by its URL. */
export async function verifyAuthoredMapDefinitionIdentityV1(
  definition: Readonly<AuthoredMapDefinitionV1>,
  expectedId: string,
  expectedContentFingerprint: string,
): Promise<Readonly<AuthoredMapDefinitionV1>> {
  const normalized = validateAuthoredMapDefinitionV1(definition);
  if (normalized.id !== expectedId) {
    throw new RangeError(`Authored map repository returned ${normalized.id} for requested map ${expectedId}`);
  }
  if (normalized.contentFingerprint !== expectedContentFingerprint) {
    throw new RangeError("Authored map repository returned a definition with the wrong retained fingerprint");
  }
  const computed = await authoredMapContentFingerprintV1(normalized);
  if (computed !== expectedContentFingerprint) {
    throw new RangeError("Authored map repository definition content does not match its retained fingerprint");
  }
  return normalized;
}

export async function withAuthoredMapContentFingerprintV1(
  input: Readonly<AuthoredMapDefinitionInputV1>,
): Promise<Readonly<AuthoredMapDefinitionV1>> {
  const normalizedInput = normalizeDefinition(input, false) as Readonly<AuthoredMapDefinitionInputV1>;
  const placeholder = Object.freeze({ ...normalizedInput, contentFingerprint: "0".repeat(64) });
  const contentFingerprint = await authoredMapContentFingerprintV1(placeholder);
  return Object.freeze({ ...normalizedInput, contentFingerprint });
}

/**
 * Conservative normal-world byte formula. Per-entry terms exceed every bounded
 * semantic field; the geometric proofs, not this value, determine capacity.
 */
export function maximumAuthoredMapCanonicalBytesV1(): number {
  const islands = authoredIslandCapacityProofV1(NORMAL_AUTHORED_MAP_CONFIG).maximumIslandCount;
  const shoals = authoredFishingCapacityProofV1(
    NORMAL_AUTHORED_MAP_CONFIG.world.width,
    NORMAL_AUTHORED_MAP_CONFIG.world.height,
  ).maximumShoalCount;
  return 16_384 + islands * 768 + shoals * 512;
}

function normalizeDefinition(input: unknown, fingerprintRequired: boolean): object {
  const keys = fingerprintRequired
    ? ["formatVersion", "id", "displayName", "contentFingerprint", "contentVersions", "world", "fishing"]
    : ["formatVersion", "id", "displayName", "contentVersions", "world", "fishing"];
  const source = exactRecord(input, "$", keys);
  if (source.formatVersion !== AUTHORED_MAP_FORMAT_VERSION) fail("$.formatVersion", "must be 1");
  const id = string(source.id, "$.id", MAXIMUM_MAP_ID_BYTES, MAP_ID);
  const displayName = displayNameValue(source.displayName, "$.displayName");
  const contentFingerprint = fingerprintRequired
    ? string(source.contentFingerprint, "$.contentFingerprint", 64, SHA256)
    : undefined;
  const contentVersionsSource = exactRecord(
    source.contentVersions,
    "$.contentVersions",
    ["islandDossier", "surveySite", "idolLocation"],
  );
  const contentVersions = Object.freeze({
    islandDossier: positiveInteger(contentVersionsSource.islandDossier, "$.contentVersions.islandDossier"),
    surveySite: positiveInteger(contentVersionsSource.surveySite, "$.contentVersions.surveySite"),
    idolLocation: positiveInteger(contentVersionsSource.idolLocation, "$.contentVersions.idolLocation"),
  });
  const worldSource = exactRecord(source.world, "$.world", [
    "contractVersion", "settingsFingerprint", "generatorVersion", "dimensions", "topology", "baseSeed", "islands",
  ]);
  const dimensionsSource = exactRecord(
    worldSource.dimensions,
    "$.world.dimensions",
    ["width", "height", "chunkSize", "tileSize", "artTileSize"],
  );
  const topologySource = exactRecord(worldSource.topology, "$.world.topology", ["x", "y"]);
  if (topologySource.x !== "bounded" && topologySource.x !== "wrap") fail("$.world.topology.x", "must be bounded or wrap");
  if (topologySource.y !== "bounded" && topologySource.y !== "wrap") fail("$.world.topology.y", "must be bounded or wrap");
  if (!Array.isArray(worldSource.islands)) fail("$.world.islands", "must be an array");
  const islands = worldSource.islands.map((inputIsland, index) => {
    const path = `$.world.islands[${index}]`;
    const island = exactRecord(inputIsland, path, [
      "sourceId", "authoredAssetId", "assetRevision", "center",
    ]);
    const center = point(island.center, `${path}.center`);
    const sourceId = positiveInteger(island.sourceId, `${path}.sourceId`);
    if (sourceId > AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID) {
      fail(`${path}.sourceId`, `must not exceed ${AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID}`);
    }
    return Object.freeze({
      sourceId,
      authoredAssetId: string(island.authoredAssetId, `${path}.authoredAssetId`, 120, STABLE_ASSET_ID),
      assetRevision: string(island.assetRevision, `${path}.assetRevision`, 128, PORTABLE_REVISION),
      center,
    });
  }).sort((left, right) => left.sourceId - right.sourceId);
  const world = Object.freeze({
    contractVersion: positiveInteger(worldSource.contractVersion, "$.world.contractVersion"),
    settingsFingerprint: string(worldSource.settingsFingerprint, "$.world.settingsFingerprint", 128, PORTABLE_REVISION),
    generatorVersion: string(worldSource.generatorVersion, "$.world.generatorVersion", 128, PORTABLE_REVISION),
    dimensions: Object.freeze({
      width: positiveInteger(dimensionsSource.width, "$.world.dimensions.width"),
      height: positiveInteger(dimensionsSource.height, "$.world.dimensions.height"),
      chunkSize: positiveInteger(dimensionsSource.chunkSize, "$.world.dimensions.chunkSize"),
      tileSize: positiveInteger(dimensionsSource.tileSize, "$.world.dimensions.tileSize"),
      artTileSize: positiveInteger(dimensionsSource.artTileSize, "$.world.dimensions.artTileSize"),
    }),
    topology: Object.freeze({ x: topologySource.x, y: topologySource.y }),
    baseSeed: safeInteger(worldSource.baseSeed, "$.world.baseSeed"),
    islands: Object.freeze(islands),
  });

  const fishingSource = exactRecord(source.fishing, "$.fishing", ["contractVersion", "contentVersion", "shoals"]);
  if (!Array.isArray(fishingSource.shoals)) fail("$.fishing.shoals", "must be an array");
  const shoals = fishingSource.shoals.map((inputShoal, index) => {
    const path = `$.fishing.shoals[${index}]`;
    const shoal = exactRecord(inputShoal, path, ["id", "tile", "quality", "clue"]);
    if (!isCurrentFishingShoalId(shoal.id)) fail(`${path}.id`, "must be a current fishing-shoal ID");
    if (!FISHING_SHOAL_QUALITIES.includes(shoal.quality as never)) fail(`${path}.quality`, "must be lean, steady, or rich");
    const clue = exactRecord(shoal.clue, `${path}.clue`, ["kind", "intensity", "label"]);
    if (!FISHING_SHOAL_CLUE_KINDS.includes(clue.kind as never)) fail(`${path}.clue.kind`, "is not a supported clue kind");
    const intensity = positiveInteger(clue.intensity, `${path}.clue.intensity`);
    if (intensity > 3) fail(`${path}.clue.intensity`, "must be between 1 and 3");
    return Object.freeze({
      id: shoal.id,
      tile: point(shoal.tile, `${path}.tile`),
      quality: shoal.quality,
      clue: Object.freeze({
        kind: clue.kind,
        intensity,
        label: boundedSemanticString(clue.label, `${path}.clue.label`, 120, 480),
      }),
    });
  }).sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
  const fishing = Object.freeze({
    contractVersion: positiveInteger(fishingSource.contractVersion, "$.fishing.contractVersion"),
    contentVersion: positiveInteger(fishingSource.contentVersion, "$.fishing.contentVersion"),
    shoals: Object.freeze(shoals),
  });
  return Object.freeze({
    formatVersion: AUTHORED_MAP_FORMAT_VERSION,
    id,
    displayName,
    ...(contentFingerprint === undefined ? {} : { contentFingerprint }),
    contentVersions,
    world,
    fishing,
  });
}

function point(value: unknown, path: string): Readonly<{ x: number; y: number }> {
  const source = exactRecord(value, path, ["x", "y"]);
  return Object.freeze({ x: safeInteger(source.x, `${path}.x`), y: safeInteger(source.y, `${path}.y`) });
}

function displayNameValue(value: unknown, path: string): string {
  const result = boundedSemanticString(value, path, MAXIMUM_DISPLAY_NAME_SCALARS, MAXIMUM_DISPLAY_NAME_BYTES);
  if (result.trim() !== result) fail(path, "must be trimmed");
  return result;
}

function boundedSemanticString(value: unknown, path: string, scalarLimit: number, byteLimit: number): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  let scalars = 0;
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    if (scalar >= 0xd800 && scalar <= 0xdfff) fail(path, "must contain only Unicode scalar values");
    scalars++;
  }
  if (scalars > scalarLimit) fail(path, `must contain at most ${scalarLimit} Unicode scalars`);
  if (new TextEncoder().encode(value).length > byteLimit) fail(path, `must contain at most ${byteLimit} UTF-8 bytes`);
  return value;
}

function string(value: unknown, path: string, maximumBytes: number, pattern: RegExp): string {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > maximumBytes || !pattern.test(value)) {
    fail(path, "has an invalid bounded portable identifier");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const result = safeInteger(value, path);
  if (result <= 0) fail(path, "must be positive");
  return result;
}

function safeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) fail(path, "must be a safe integer");
  return value as number;
}

function exactRecord(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be an object");
  const source = value as Record<string, unknown>;
  const expected = new Set(keys);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(source, key)) fail(`${path}.${key}`, "is required");
  for (const key of Object.keys(source)) if (!expected.has(key)) fail(`${path}.${key}`, "is not allowed");
  return source;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(path: string, message: string): never {
  throw new AuthoredMapValidationError(path, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
