export const AUDIO_CATEGORIES = Object.freeze([
  "music",
  "ambience",
  "sfx",
  "ui",
] as const);

export type AudioCategory = (typeof AUDIO_CATEGORIES)[number];

export const AUDIO_CATALOG_SCHEMA_VERSION = 1 as const;
export const AUDIO_LIBRARY_ID = "wayfinders.audio.v1" as const;
export const AUDIO_CATALOG_URL = "/assets/audio/audio-catalog.json" as const;

export interface AudioCategoryDefinition {
  readonly displayName: string;
  readonly voiceLimit: number;
}

export interface AudioAssetDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly category: AudioCategory;
  /** Safe path relative to `audio-catalog.json`. */
  readonly file: string;
  readonly loop: boolean;
  readonly baseVolume: number;
  readonly description: string;
}

export interface AudioCatalog {
  readonly schemaVersion: typeof AUDIO_CATALOG_SCHEMA_VERSION;
  readonly libraryId: typeof AUDIO_LIBRARY_ID;
  readonly categories: Readonly<Record<AudioCategory, Readonly<AudioCategoryDefinition>>>;
  readonly assets: readonly Readonly<AudioAssetDefinition>[];
}

export interface AudioCatalogFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type AudioCatalogFetcher = (url: string) => Promise<AudioCatalogFetchResponse>;

export type AudioCatalogLoadResult =
  | Readonly<{ ok: true; catalog: Readonly<AudioCatalog> }>
  | Readonly<{ ok: false; error: Error }>;

const EXACT_CATALOG_FIELDS = Object.freeze([
  "schemaVersion",
  "libraryId",
  "categories",
  "assets",
] as const);
const EXACT_CATEGORY_FIELDS = Object.freeze([
  "displayName",
  "voiceLimit",
] as const);
const EXACT_ASSET_FIELDS = Object.freeze([
  "id",
  "displayName",
  "category",
  "file",
  "loop",
  "baseVolume",
  "description",
] as const);
const AUDIO_CATEGORY_SET = new Set<string>(AUDIO_CATEGORIES);
const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const AUDIO_FILE = /^\.\/v1\/(music|ambience|sfx|ui)\/[a-z0-9]+(?:-[a-z0-9]+)*\.wav$/u;
const MAX_ASSET_COUNT = 256;
const MAX_CATEGORY_VOICE_LIMIT = 15;

/** Validates, canonicalizes, and freezes the shared runtime audio catalog. */
export function validateAudioCatalog(value: unknown): Readonly<AudioCatalog> {
  const input = exactRecord(value, "Audio catalog", EXACT_CATALOG_FIELDS);
  if (input.schemaVersion !== AUDIO_CATALOG_SCHEMA_VERSION) {
    throw new RangeError(`Audio catalog schemaVersion must be ${AUDIO_CATALOG_SCHEMA_VERSION}`);
  }
  if (input.libraryId !== AUDIO_LIBRARY_ID) {
    throw new RangeError(`Audio catalog libraryId must be ${AUDIO_LIBRARY_ID}`);
  }

  const categoriesInput = exactRecord(input.categories, "Audio catalog categories", AUDIO_CATEGORIES);
  const categories = Object.freeze({
    music: validateCategory(categoriesInput.music, "music"),
    ambience: validateCategory(categoriesInput.ambience, "ambience"),
    sfx: validateCategory(categoriesInput.sfx, "sfx"),
    ui: validateCategory(categoriesInput.ui, "ui"),
  });

  if (!Array.isArray(input.assets)) throw new TypeError("Audio catalog assets must be an array");
  if (input.assets.length === 0 || input.assets.length > MAX_ASSET_COUNT) {
    throw new RangeError(`Audio catalog assets must contain between 1 and ${MAX_ASSET_COUNT} records`);
  }

  const ids = new Set<string>();
  const files = new Set<string>();
  const categoryCounts: Record<AudioCategory, number> = {
    music: 0,
    ambience: 0,
    sfx: 0,
    ui: 0,
  };
  const assets = input.assets.map((asset, index): Readonly<AudioAssetDefinition> => {
    const label = `Audio catalog assets[${index}]`;
    const record = exactRecord(asset, label, EXACT_ASSET_FIELDS);
    const id = stableId(record.id, `${label}.id`);
    if (ids.has(id)) throw new RangeError(`Audio catalog repeats asset ID ${id}`);
    ids.add(id);

    const category = audioCategory(record.category, `${label}.category`);
    if (!id.startsWith(`${category}.`)) {
      throw new RangeError(`${label}.id must begin with its category ${category}.`);
    }
    const file = audioFile(record.file, category, `${label}.file`);
    if (files.has(file)) throw new RangeError(`Audio catalog repeats asset file ${file}`);
    files.add(file);
    categoryCounts[category]++;

    if (typeof record.loop !== "boolean") throw new TypeError(`${label}.loop must be a boolean`);
    return Object.freeze({
      id,
      displayName: displayString(record.displayName, `${label}.displayName`),
      category,
      file,
      loop: record.loop,
      baseVolume: unitInterval(record.baseVolume, `${label}.baseVolume`),
      description: descriptionString(record.description, `${label}.description`),
    });
  });

  for (const category of AUDIO_CATEGORIES) {
    if (categoryCounts[category] === 0) {
      throw new RangeError(`Audio catalog category ${category} must contain at least one asset`);
    }
  }

  return Object.freeze({
    schemaVersion: AUDIO_CATALOG_SCHEMA_VERSION,
    libraryId: AUDIO_LIBRARY_ID,
    categories,
    assets: Object.freeze(assets),
  });
}

/** Fetches the one canonical checked-in catalog and rejects invalid content. */
export async function loadAudioCatalog(
  fetcher: AudioCatalogFetcher = defaultAudioCatalogFetcher,
): Promise<Readonly<AudioCatalog>> {
  const response = await fetcher(AUDIO_CATALOG_URL);
  if (!response.ok) {
    throw new Error(`Audio catalog request failed with HTTP ${response.status}`);
  }
  return validateAudioCatalog(await response.json());
}

/** Converts catalog/network failures into an explicit silent-start result. */
export async function tryLoadAudioCatalog(
  fetcher: AudioCatalogFetcher = defaultAudioCatalogFetcher,
): Promise<AudioCatalogLoadResult> {
  try {
    return Object.freeze({ ok: true, catalog: await loadAudioCatalog(fetcher) });
  } catch (error) {
    return Object.freeze({ ok: false, error: normalizeError(error) });
  }
}

/** Resolves a validated catalog-relative file to its browser runtime URL. */
export function resolveAudioAssetUrl(
  asset: Readonly<AudioAssetDefinition>,
  catalogUrl: string = AUDIO_CATALOG_URL,
): string {
  const cleanCatalogUrl = catalogUrl.split(/[?#]/u, 1)[0] ?? "";
  const finalSlash = cleanCatalogUrl.lastIndexOf("/");
  if (finalSlash < 0 || !asset.file.startsWith("./")) {
    throw new RangeError("Audio asset URL requires a catalog URL with a directory and a safe relative file");
  }
  return `${cleanCatalogUrl.slice(0, finalSlash + 1)}${asset.file.slice(2)}`;
}

export function audioAssetById(
  catalog: Readonly<AudioCatalog>,
  assetId: string,
): Readonly<AudioAssetDefinition> {
  const asset = catalog.assets.find(({ id }) => id === assetId);
  if (!asset) throw new RangeError(`Unknown audio asset ID ${assetId}`);
  return asset;
}

function validateCategory(value: unknown, category: AudioCategory): Readonly<AudioCategoryDefinition> {
  const label = `Audio catalog categories.${category}`;
  const input = exactRecord(value, label, EXACT_CATEGORY_FIELDS);
  return Object.freeze({
    displayName: displayString(input.displayName, `${label}.displayName`),
    voiceLimit: integer(input.voiceLimit, `${label}.voiceLimit`, 1, MAX_CATEGORY_VOICE_LIMIT),
  });
}

function exactRecord<const TFields extends readonly string[]>(
  value: unknown,
  label: string,
  expectedFields: TFields,
): Record<TFields[number], unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const expected = new Set<string>(expectedFields);
  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new TypeError(`${label} is missing ${field}`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new RangeError(`${label} contains unknown field ${field}`);
  }
  return value as Record<TFields[number], unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function audioCategory(value: unknown, label: string): AudioCategory {
  if (typeof value !== "string" || !AUDIO_CATEGORY_SET.has(value)) {
    throw new RangeError(`${label} must be one of ${AUDIO_CATEGORIES.join(", ")}`);
  }
  return value as AudioCategory;
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 96 || !STABLE_ID.test(value)) {
    throw new RangeError(`${label} must be a stable lowercase ID of at most 96 characters`);
  }
  return value;
}

function audioFile(value: unknown, category: AudioCategory, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const match = AUDIO_FILE.exec(value);
  if (!match) {
    throw new RangeError(`${label} must be a safe ./v1/<category>/<name>.wav path`);
  }
  if (match[1] !== category) throw new RangeError(`${label} must be stored under the ${category} directory`);
  return value;
}

function displayString(value: unknown, label: string): string {
  return boundedString(value, label, 80);
}

function descriptionString(value: unknown, label: string): string {
  return boundedString(value, label, 240);
}

function boundedString(value: unknown, label: string, maximumLength: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximumLength
    || value.trim() !== value
  ) {
    throw new TypeError(`${label} must be a trimmed non-empty string of at most ${maximumLength} characters`);
  }
  return value;
}

function unitInterval(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

async function defaultAudioCatalogFetcher(url: string): Promise<AudioCatalogFetchResponse> {
  if (typeof globalThis.fetch !== "function") throw new Error("Audio catalog loading requires fetch");
  return globalThis.fetch(url);
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
