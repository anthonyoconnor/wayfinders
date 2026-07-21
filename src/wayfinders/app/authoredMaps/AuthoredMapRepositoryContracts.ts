import type { AuthoredMapDefinitionV1 } from "./AuthoredMapContracts";
import {
  maximumAuthoredMapCanonicalBytesV1,
  validateAuthoredMapDefinitionV1,
} from "./AuthoredMapCodec";

export const AUTHORED_MAP_REPOSITORY_FORMAT_VERSION = 1 as const;
export const AUTHORED_MAP_CATALOG_URL = "/maps/catalog.json" as const;
export const AUTHORED_MAP_SAVE_ROUTE = "/__wayfinders/maps/save" as const;

export const AUTHORED_MAP_STABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const AUTHORED_MAP_CONTENT_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

const MAXIMUM_MAP_ID_BYTES = 64;
const MAXIMUM_DISPLAY_NAME_SCALARS = 80;
const MAXIMUM_DISPLAY_NAME_BYTES = 320;
const MAXIMUM_RETAINED_FINGERPRINTS = 1_000_000;

const CATALOG_KEYS = Object.freeze(["formatVersion", "catalogRevision", "maps"] as const);
const CATALOG_ENTRY_KEYS = Object.freeze([
  "id",
  "displayName",
  "mapRepositoryRevision",
  "currentFingerprint",
  "retainedFingerprints",
] as const);
const SAVE_REQUEST_REQUIRED_KEYS = Object.freeze([
  "formatVersion",
  "mapId",
  "expectedCatalogRevision",
  "definition",
] as const);
const SAVE_REQUEST_OPTIONAL_KEYS = Object.freeze(["expectedMapRepositoryRevision"] as const);
const SAVE_RESPONSE_KEYS = Object.freeze([
  "changed",
  "created",
  "catalogRevision",
  "mapRepositoryRevision",
  "currentFingerprint",
  "retainedFingerprints",
  "definition",
  "definitionUrl",
] as const);

export interface AuthoredMapCatalogEntryV1 {
  readonly id: string;
  readonly displayName: string;
  readonly mapRepositoryRevision: number;
  readonly currentFingerprint: string;
  readonly retainedFingerprints: readonly string[];
}

export interface AuthoredMapCatalogV1 {
  readonly formatVersion: typeof AUTHORED_MAP_REPOSITORY_FORMAT_VERSION;
  readonly catalogRevision: number;
  readonly maps: readonly Readonly<AuthoredMapCatalogEntryV1>[];
}

export interface AuthoredMapSaveRequestV1 {
  readonly formatVersion: typeof AUTHORED_MAP_REPOSITORY_FORMAT_VERSION;
  readonly mapId: string;
  readonly expectedCatalogRevision: number;
  readonly expectedMapRepositoryRevision?: number;
  readonly definition: unknown;
}

export interface AuthoredMapSaveResponseV1 {
  readonly changed: boolean;
  readonly created: boolean;
  readonly catalogRevision: number;
  readonly mapRepositoryRevision: number;
  readonly currentFingerprint: string;
  readonly retainedFingerprints: readonly string[];
  readonly definition: Readonly<AuthoredMapDefinitionV1>;
  readonly definitionUrl: string;
}

export const EMPTY_AUTHORED_MAP_CATALOG_V1: Readonly<AuthoredMapCatalogV1> = Object.freeze({
  formatVersion: AUTHORED_MAP_REPOSITORY_FORMAT_VERSION,
  catalogRevision: 0,
  maps: Object.freeze([]),
});

export function validateAuthoredMapStableId(value: unknown, label = "map ID"): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAXIMUM_MAP_ID_BYTES
    || !AUTHORED_MAP_STABLE_ID_PATTERN.test(value)
  ) {
    throw new RangeError(
      `${label} must be 1-${MAXIMUM_MAP_ID_BYTES} lowercase ASCII bytes separated only by single hyphens`,
    );
  }
  return value;
}

export function validateAuthoredMapContentFingerprint(
  value: unknown,
  label = "map content fingerprint",
): string {
  if (typeof value !== "string" || !AUTHORED_MAP_CONTENT_FINGERPRINT_PATTERN.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 fingerprint`);
  }
  return value;
}

export function validateAuthoredMapCatalogV1(input: unknown): Readonly<AuthoredMapCatalogV1> {
  const source = exactRecord(input, "Authored map catalog", CATALOG_KEYS);
  if (source.formatVersion !== AUTHORED_MAP_REPOSITORY_FORMAT_VERSION) {
    throw new RangeError("Authored map catalog must use formatVersion 1");
  }
  const catalogRevision = repositoryRevision(source.catalogRevision, "Authored map catalog revision", true);
  if (!Array.isArray(source.maps)) throw new TypeError("Authored map catalog maps must be an array");
  const ids = new Set<string>();
  const maps = source.maps.map((value, index): Readonly<AuthoredMapCatalogEntryV1> => {
    const label = `Authored map catalog maps[${index}]`;
    const entry = exactRecord(value, label, CATALOG_ENTRY_KEYS);
    const id = validateAuthoredMapStableId(entry.id, `${label}.id`);
    if (ids.has(id)) throw new RangeError(`Authored map catalog repeats map ID ${id}`);
    ids.add(id);
    const displayName = validateDisplayName(entry.displayName, `${label}.displayName`);
    const mapRepositoryRevision = repositoryRevision(
      entry.mapRepositoryRevision,
      `${label}.mapRepositoryRevision`,
      false,
    );
    const currentFingerprint = validateAuthoredMapContentFingerprint(
      entry.currentFingerprint,
      `${label}.currentFingerprint`,
    );
    if (!Array.isArray(entry.retainedFingerprints) || entry.retainedFingerprints.length === 0) {
      throw new RangeError(`${label}.retainedFingerprints must contain the current fingerprint`);
    }
    if (entry.retainedFingerprints.length > MAXIMUM_RETAINED_FINGERPRINTS) {
      throw new RangeError(`${label}.retainedFingerprints exceeds the repository safety bound`);
    }
    const retainedSet = new Set<string>();
    const retainedFingerprints = entry.retainedFingerprints.map((fingerprint, fingerprintIndex) => {
      const normalized = validateAuthoredMapContentFingerprint(
        fingerprint,
        `${label}.retainedFingerprints[${fingerprintIndex}]`,
      );
      if (retainedSet.has(normalized)) {
        throw new RangeError(`${label}.retainedFingerprints repeats ${normalized}`);
      }
      retainedSet.add(normalized);
      return normalized;
    });
    if (!retainedSet.has(currentFingerprint)) {
      throw new RangeError(`${label}.retainedFingerprints must include currentFingerprint`);
    }
    const sortedFingerprints = [...retainedFingerprints].sort();
    if (!sameStrings(retainedFingerprints, sortedFingerprints)) {
      throw new RangeError(`${label}.retainedFingerprints must be sorted`);
    }
    return Object.freeze({
      id,
      displayName,
      mapRepositoryRevision,
      currentFingerprint,
      retainedFingerprints: Object.freeze(retainedFingerprints),
    });
  });
  const sortedIds = maps.map(({ id }) => id).slice().sort();
  if (!sameStrings(maps.map(({ id }) => id), sortedIds)) {
    throw new RangeError("Authored map catalog maps must be sorted by stable ID");
  }
  return Object.freeze({
    formatVersion: AUTHORED_MAP_REPOSITORY_FORMAT_VERSION,
    catalogRevision,
    maps: Object.freeze(maps),
  });
}

export function serializeAuthoredMapCatalogV1(catalog: Readonly<AuthoredMapCatalogV1>): string {
  return `${JSON.stringify(validateAuthoredMapCatalogV1(catalog), null, 2)}\n`;
}

export function encodeAuthoredMapCatalogV1(catalog: Readonly<AuthoredMapCatalogV1>): Uint8Array {
  return new TextEncoder().encode(serializeAuthoredMapCatalogV1(catalog));
}

export function parseAuthoredMapCatalogV1(source: string | Uint8Array): Readonly<AuthoredMapCatalogV1> {
  const text = typeof source === "string"
    ? source
    : new TextDecoder("utf-8", { fatal: true }).decode(source);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SyntaxError("Authored map catalog is not valid UTF-8 JSON");
  }
  return validateAuthoredMapCatalogV1(value);
}

export function validateAuthoredMapSaveRequestV1(input: unknown): Readonly<AuthoredMapSaveRequestV1> {
  const source = exactRecordWithOptional(
    input,
    "Authored map save request",
    SAVE_REQUEST_REQUIRED_KEYS,
    SAVE_REQUEST_OPTIONAL_KEYS,
  );
  if (source.formatVersion !== AUTHORED_MAP_REPOSITORY_FORMAT_VERSION) {
    throw new RangeError("Authored map save request must use formatVersion 1");
  }
  const expectedMapRepositoryRevision = source.expectedMapRepositoryRevision === undefined
    ? undefined
    : repositoryRevision(
      source.expectedMapRepositoryRevision,
      "Authored map save request expectedMapRepositoryRevision",
      false,
    );
  if (!isRecord(source.definition)) {
    throw new TypeError("Authored map save request definition must be an object");
  }
  return Object.freeze({
    formatVersion: AUTHORED_MAP_REPOSITORY_FORMAT_VERSION,
    mapId: validateAuthoredMapStableId(source.mapId, "Authored map save request mapId"),
    expectedCatalogRevision: repositoryRevision(
      source.expectedCatalogRevision,
      "Authored map save request expectedCatalogRevision",
      true,
    ),
    ...(expectedMapRepositoryRevision === undefined ? {} : { expectedMapRepositoryRevision }),
    definition: source.definition,
  });
}

export function authoredMapDefinitionUrl(mapId: string, contentFingerprint: string): string {
  const id = validateAuthoredMapStableId(mapId);
  const fingerprint = validateAuthoredMapContentFingerprint(contentFingerprint);
  return `/maps/v1/${encodeURIComponent(id)}/${fingerprint}.map.json`;
}

export function validateAuthoredMapSaveResponseV1(input: unknown): Readonly<AuthoredMapSaveResponseV1> {
  const source = exactRecord(input, "Authored map save response", SAVE_RESPONSE_KEYS);
  if (typeof source.changed !== "boolean" || typeof source.created !== "boolean") {
    throw new TypeError("Authored map save response changed and created must be booleans");
  }
  if (source.created && !source.changed) {
    throw new RangeError("Authored map save response cannot create a map without changing the repository");
  }
  const catalogRevision = repositoryRevision(
    source.catalogRevision,
    "Authored map save response catalogRevision",
    false,
  );
  const mapRepositoryRevision = repositoryRevision(
    source.mapRepositoryRevision,
    "Authored map save response mapRepositoryRevision",
    false,
  );
  const currentFingerprint = validateAuthoredMapContentFingerprint(
    source.currentFingerprint,
    "Authored map save response currentFingerprint",
  );
  if (!Array.isArray(source.retainedFingerprints) || source.retainedFingerprints.length === 0) {
    throw new RangeError("Authored map save response retainedFingerprints must be non-empty");
  }
  const retainedFingerprints = source.retainedFingerprints.map((value, index) => (
    validateAuthoredMapContentFingerprint(
      value,
      `Authored map save response retainedFingerprints[${index}]`,
    )
  ));
  if (new Set(retainedFingerprints).size !== retainedFingerprints.length) {
    throw new RangeError("Authored map save response retainedFingerprints must not repeat values");
  }
  if (!sameStrings(retainedFingerprints, [...retainedFingerprints].sort())) {
    throw new RangeError("Authored map save response retainedFingerprints must be sorted");
  }
  if (!retainedFingerprints.includes(currentFingerprint)) {
    throw new RangeError("Authored map save response retainedFingerprints must include currentFingerprint");
  }
  const definition = validateAuthoredMapDefinitionV1(source.definition);
  if (definition.contentFingerprint !== currentFingerprint) {
    throw new RangeError("Authored map save response definition fingerprint must match currentFingerprint");
  }
  const expectedUrl = authoredMapDefinitionUrl(definition.id, currentFingerprint);
  if (source.definitionUrl !== expectedUrl) {
    throw new RangeError(`Authored map save response definitionUrl must be ${expectedUrl}`);
  }
  return Object.freeze({
    changed: source.changed,
    created: source.created,
    catalogRevision,
    mapRepositoryRevision,
    currentFingerprint,
    retainedFingerprints: Object.freeze(retainedFingerprints),
    definition,
    definitionUrl: expectedUrl,
  });
}

/** Exact compact JSON envelope overhead plus the greatest canonical definition. */
export function maximumAuthoredMapSaveRequestBytesV1(): number {
  const marker = "__AUTHORED_MAP_DEFINITION__";
  const envelope = JSON.stringify({
    formatVersion: AUTHORED_MAP_REPOSITORY_FORMAT_VERSION,
    mapId: "m".repeat(MAXIMUM_MAP_ID_BYTES),
    expectedCatalogRevision: Number.MAX_SAFE_INTEGER,
    expectedMapRepositoryRevision: Number.MAX_SAFE_INTEGER,
    definition: marker,
  });
  const envelopeBytes = new TextEncoder().encode(envelope).length;
  const markerBytes = new TextEncoder().encode(JSON.stringify(marker)).length;
  return envelopeBytes - markerBytes + maximumAuthoredMapCanonicalBytesV1();
}

function repositoryRevision(value: unknown, label: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RangeError(`${label} must be a safe integer of at least ${minimum}`);
  }
  return value as number;
}

function validateDisplayName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a trimmed non-empty string`);
  }
  let scalarCount = 0;
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    if (scalar >= 0xd800 && scalar <= 0xdfff) {
      throw new RangeError(`${label} must contain only Unicode scalar values`);
    }
    scalarCount++;
  }
  if (scalarCount > MAXIMUM_DISPLAY_NAME_SCALARS) {
    throw new RangeError(`${label} must contain at most ${MAXIMUM_DISPLAY_NAME_SCALARS} Unicode scalars`);
  }
  if (new TextEncoder().encode(value).length > MAXIMUM_DISPLAY_NAME_BYTES) {
    throw new RangeError(`${label} must contain at most ${MAXIMUM_DISPLAY_NAME_BYTES} UTF-8 bytes`);
  }
  return value;
}

function exactRecord<const TKeys extends readonly string[]>(
  value: unknown,
  label: string,
  keys: TKeys,
): Record<TKeys[number], unknown> {
  const source = record(value, label);
  const expected = new Set<string>(keys);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) throw new TypeError(`${label} is missing ${key}`);
  }
  for (const key of Object.keys(source)) {
    if (!expected.has(key)) throw new RangeError(`${label} contains unknown field ${key}`);
  }
  return source as Record<TKeys[number], unknown>;
}

function exactRecordWithOptional<
  const TRequired extends readonly string[],
  const TOptional extends readonly string[],
>(
  value: unknown,
  label: string,
  required: TRequired,
  optional: TOptional,
): Record<TRequired[number], unknown> & Partial<Record<TOptional[number], unknown>> {
  const source = record(value, label);
  const expected = new Set<string>([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) throw new TypeError(`${label} is missing ${key}`);
  }
  for (const key of Object.keys(source)) {
    if (!expected.has(key)) throw new RangeError(`${label} contains unknown field ${key}`);
  }
  return source as Record<TRequired[number], unknown> & Partial<Record<TOptional[number], unknown>>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
