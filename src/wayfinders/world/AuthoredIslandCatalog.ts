export interface AuthoredIslandCollisionPoint {
  readonly x: number;
  readonly y: number;
}

/** Renderer-neutral island input. Dimensions are navigation cells, not pixels. */
export interface AuthoredIslandCatalogEntry {
  readonly assetId: string;
  readonly name: string;
  readonly revision: string;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly solidSubcells: readonly Readonly<AuthoredIslandCollisionPoint>[];
}

export interface AuthoredIslandCatalog {
  readonly revision: string;
  readonly islands: readonly Readonly<AuthoredIslandCatalogEntry>[];
}

export const EMPTY_AUTHORED_ISLAND_CATALOG: Readonly<AuthoredIslandCatalog> = Object.freeze({
  revision: "none",
  islands: Object.freeze([]),
});

const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Validates, canonicalizes, and freezes world-planning catalog input. */
export function validateAuthoredIslandCatalog(input: unknown): Readonly<AuthoredIslandCatalog> {
  if (!isRecord(input)) throw new TypeError("Authored island catalog must be an object");
  const revision = revisionValue(input.revision, "Authored island catalog revision");
  if (!Array.isArray(input.islands)) throw new TypeError("Authored island catalog islands must be an array");
  const ids = new Set<string>();
  const names = new Set<string>();
  const islands = input.islands.map((value, index): Readonly<AuthoredIslandCatalogEntry> => {
    const label = `Authored island catalog islands[${index}]`;
    if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
    const assetId = stableId(value.assetId, `${label}.assetId`);
    if (ids.has(assetId)) throw new RangeError(`Authored island catalog repeats asset ID ${assetId}`);
    ids.add(assetId);
    const name = nonEmptyString(value.name, `${label}.name`);
    const normalizedName = name.toLocaleLowerCase("en");
    if (names.has(normalizedName)) throw new RangeError(`Authored island catalog repeats name ${name}`);
    names.add(normalizedName);
    const gridWidth = integer(value.gridWidth, `${label}.gridWidth`, 1, 128);
    const gridHeight = integer(value.gridHeight, `${label}.gridHeight`, 1, 128);
    if (!Array.isArray(value.solidSubcells)) throw new TypeError(`${label}.solidSubcells must be an array`);
    if (value.solidSubcells.length === 0) throw new RangeError(`${label} must contain solid collision`);
    if (value.solidSubcells.length > gridWidth * gridHeight * 16) {
      throw new RangeError(`${label}.solidSubcells exceeds the grid capacity`);
    }
    const coordinates = new Set<string>();
    const solidSubcells = value.solidSubcells.map((point, pointIndex) => {
      if (!isRecord(point)) throw new TypeError(`${label}.solidSubcells[${pointIndex}] must be an object`);
      const x = integer(point.x, `${label}.solidSubcells[${pointIndex}].x`, 0, gridWidth * 4 - 1);
      const y = integer(point.y, `${label}.solidSubcells[${pointIndex}].y`, 0, gridHeight * 4 - 1);
      const key = `${x},${y}`;
      if (coordinates.has(key)) throw new RangeError(`${label}.solidSubcells repeats ${key}`);
      coordinates.add(key);
      return Object.freeze({ x, y });
    }).sort((left, right) => left.y - right.y || left.x - right.x);
    return Object.freeze({
      assetId,
      name,
      revision: revisionValue(value.revision, `${label}.revision`),
      gridWidth,
      gridHeight,
      solidSubcells: Object.freeze(solidSubcells),
    });
  }).sort((left, right) => left.assetId.localeCompare(right.assetId, "en"));
  return Object.freeze({ revision, islands: Object.freeze(islands) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 120) {
    throw new TypeError(`${label} must be a trimmed non-empty string of at most 120 characters`);
  }
  return value;
}

function stableId(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (!STABLE_ID.test(result)) throw new RangeError(`${label} must be a stable lowercase ID`);
  return result;
}

function revisionValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 128 || !REVISION.test(value)) {
    throw new RangeError(`${label} must be a portable revision identifier`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}
