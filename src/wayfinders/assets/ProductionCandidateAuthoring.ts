import {
  AUTHORED_ASSET_IDS,
  type AuthoredAssetId,
} from "./AuthoredAssetContracts.ts";
import type { RuntimeCollisionProfile } from "./CollisionProfileRegistry.ts";
import {
  validateProductionAssetRecipeManifest,
  type ProductionAssetFamily,
  type ProductionAssetRecipe,
} from "./ProductionAssetRecipe.ts";

export const PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION = 1 as const;
export const PRODUCTION_CANDIDATE_TILE_SIZE = 32 as const;
export const PRODUCTION_CANDIDATE_SUBCELL_SIZE = 8 as const;

const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const FINGERPRINT = /^[a-f0-9]{64}$/u;
const FAMILIES = new Set<ProductionAssetFamily>([
  "island",
  "vessel",
  "shoal",
  "world-feature",
  "environment",
]);
const HYBRID_COLLISION_FAMILIES = new Set<ProductionAssetFamily>([
  "island",
  "vessel",
  "world-feature",
]);
const RUNTIME_ASSET_IDS = new Set<AuthoredAssetId>(Object.values(AUTHORED_ASSET_IDS));

export interface ProductionCandidateIdentityRequest {
  readonly formatVersion: typeof PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION;
  readonly recipeId: string;
  readonly candidateFingerprint: string;
}

export interface ProductionCandidateLayerSettings {
  readonly id: string;
  readonly defaultVisible: boolean;
  readonly opacity: number;
}

export interface ProductionCandidateSettings {
  readonly name: string;
  readonly family: ProductionAssetFamily;
  readonly targetWidth: number;
  readonly targetHeight: number;
  /** Array order is the persisted compositing order. */
  readonly layers: readonly Readonly<ProductionCandidateLayerSettings>[];
  /** Null keeps the candidate independent from the three pilot runtime slots. */
  readonly runtimeBindingAssetId: AuthoredAssetId | null;
}

export interface ProductionCandidateAuthoredHybridMask {
  readonly kind: "hybrid-grid-draft";
  readonly tileSize: typeof PRODUCTION_CANDIDATE_TILE_SIZE;
  readonly subcellSize: typeof PRODUCTION_CANDIDATE_SUBCELL_SIZE;
  readonly grid: Readonly<{
    readonly width: number;
    readonly height: number;
    readonly subcellColumns: number;
    readonly subcellRows: number;
  }>;
  readonly solidSubcells: readonly Readonly<{ readonly x: number; readonly y: number }>[];
}

export interface ProductionCandidateExplicitlyPassableCollision {
  readonly kind: "empty";
  readonly passable: true;
  readonly reason: string;
}

export type ProductionCandidateAuthoredCollision =
  | ProductionCandidateAuthoredHybridMask
  | ProductionCandidateExplicitlyPassableCollision;

export interface ProductionCandidateAuthoringRequest extends ProductionCandidateIdentityRequest {
  readonly settings: Readonly<ProductionCandidateSettings>;
  readonly collision: Readonly<ProductionCandidateAuthoredCollision>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} must contain only ${sortedExpected.join(", ")}`);
  }
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== "string" || !STABLE_ID.test(value)) {
    throw new RangeError(`${label} must be a stable lowercase ID`);
  }
  return value;
}

function fingerprint(value: unknown, label: string): string {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 fingerprint`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function name(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 120) {
    throw new TypeError("settings.name must be a trimmed name of at most 120 characters");
  }
  return value;
}

function passableReason(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 240) {
    throw new TypeError("collision.reason must be a trimmed reason of at most 240 characters");
  }
  return value;
}

function family(value: unknown): ProductionAssetFamily {
  if (typeof value !== "string" || !FAMILIES.has(value as ProductionAssetFamily)) {
    throw new RangeError("settings.family is not supported");
  }
  return value as ProductionAssetFamily;
}

function runtimeBinding(value: unknown): AuthoredAssetId | null {
  if (value === null) return null;
  if (typeof value !== "string" || !RUNTIME_ASSET_IDS.has(value as AuthoredAssetId)) {
    throw new RangeError("settings.runtimeBindingAssetId must be null or a pilot runtime asset ID");
  }
  return value as AuthoredAssetId;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateProductionCandidateIdentityRequest(
  input: unknown,
): Readonly<ProductionCandidateIdentityRequest> {
  const parsed = record(input, "Candidate identity request");
  exactKeys(parsed, ["formatVersion", "recipeId", "candidateFingerprint"], "Candidate identity request");
  if (parsed.formatVersion !== PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION) {
    throw new RangeError(
      `Candidate identity request formatVersion must be ${PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION}`,
    );
  }
  return Object.freeze({
    formatVersion: PRODUCTION_CANDIDATE_AUTHORING_FORMAT_VERSION,
    recipeId: stableId(parsed.recipeId, "recipeId"),
    candidateFingerprint: fingerprint(parsed.candidateFingerprint, "candidateFingerprint"),
  });
}

export function validateProductionCandidateAuthoringRequest(
  input: unknown,
): Readonly<ProductionCandidateAuthoringRequest> {
  const parsed = record(input, "Candidate authoring request");
  exactKeys(
    parsed,
    ["formatVersion", "recipeId", "candidateFingerprint", "settings", "collision"],
    "Candidate authoring request",
  );
  const identity = validateProductionCandidateIdentityRequest({
    formatVersion: parsed.formatVersion,
    recipeId: parsed.recipeId,
    candidateFingerprint: parsed.candidateFingerprint,
  });

  const settingsInput = record(parsed.settings, "settings");
  exactKeys(
    settingsInput,
    ["name", "family", "targetWidth", "targetHeight", "layers", "runtimeBindingAssetId"],
    "settings",
  );
  const targetWidth = integer(settingsInput.targetWidth, "settings.targetWidth", 1, 4_096);
  const targetHeight = integer(settingsInput.targetHeight, "settings.targetHeight", 1, 4_096);
  const selectedFamily = family(settingsInput.family);
  if (!Array.isArray(settingsInput.layers) || settingsInput.layers.length === 0 || settingsInput.layers.length > 32) {
    throw new RangeError("settings.layers must contain between 1 and 32 layers");
  }
  const layerIds = new Set<string>();
  const layers = settingsInput.layers.map((layerInput, index): ProductionCandidateLayerSettings => {
    const layer = record(layerInput, `settings.layers[${index}]`);
    exactKeys(layer, ["id", "defaultVisible", "opacity"], `settings.layers[${index}]`);
    const id = stableId(layer.id, `settings.layers[${index}].id`);
    if (layerIds.has(id)) throw new RangeError(`settings.layers repeats ${id}`);
    layerIds.add(id);
    return Object.freeze({
      id,
      defaultVisible: boolean(layer.defaultVisible, `settings.layers[${index}].defaultVisible`),
      opacity: finite(layer.opacity, `settings.layers[${index}].opacity`, 0, 1),
    });
  });

  const collisionInput = record(parsed.collision, "collision");
  let collision: ProductionCandidateAuthoredCollision;
  if (collisionInput.kind === "empty") {
    exactKeys(collisionInput, ["kind", "passable", "reason"], "collision");
    if (collisionInput.passable !== true) {
      throw new RangeError("Empty candidate collision must be explicitly passable");
    }
    if (selectedFamily === "island") {
      throw new RangeError("island candidates cannot be explicitly passable");
    }
    collision = {
      kind: "empty",
      passable: true,
      reason: passableReason(collisionInput.reason),
    };
  } else if (collisionInput.kind === "hybrid-grid-draft") {
    exactKeys(
      collisionInput,
      ["kind", "tileSize", "subcellSize", "grid", "solidSubcells"],
      "collision",
    );
    if (!HYBRID_COLLISION_FAMILIES.has(selectedFamily)) {
      throw new RangeError(`${selectedFamily} candidates cannot use an authored solid hybrid mask`);
    }
    if (targetWidth % PRODUCTION_CANDIDATE_TILE_SIZE !== 0
      || targetHeight % PRODUCTION_CANDIDATE_TILE_SIZE !== 0) {
      throw new RangeError("Solid candidate dimensions must align to the 32 px navigation grid");
    }
    if (collisionInput.tileSize !== PRODUCTION_CANDIDATE_TILE_SIZE
      || collisionInput.subcellSize !== PRODUCTION_CANDIDATE_SUBCELL_SIZE) {
      throw new RangeError("Candidate collision must use 32 px cells and 8 px subcells");
    }
    const gridInput = record(collisionInput.grid, "collision.grid");
    exactKeys(gridInput, ["width", "height", "subcellColumns", "subcellRows"], "collision.grid");
    const grid = Object.freeze({
      width: integer(gridInput.width, "collision.grid.width", 1, 128),
      height: integer(gridInput.height, "collision.grid.height", 1, 128),
      subcellColumns: integer(gridInput.subcellColumns, "collision.grid.subcellColumns", 1, 512),
      subcellRows: integer(gridInput.subcellRows, "collision.grid.subcellRows", 1, 512),
    });
    if (
      grid.width * PRODUCTION_CANDIDATE_TILE_SIZE !== targetWidth
      || grid.height * PRODUCTION_CANDIDATE_TILE_SIZE !== targetHeight
      || grid.subcellColumns * PRODUCTION_CANDIDATE_SUBCELL_SIZE !== targetWidth
      || grid.subcellRows * PRODUCTION_CANDIDATE_SUBCELL_SIZE !== targetHeight
    ) {
      throw new RangeError("collision.grid must match the authored candidate dimensions");
    }
    if (!Array.isArray(collisionInput.solidSubcells)) {
      throw new TypeError("collision.solidSubcells must be an array");
    }
    if (collisionInput.solidSubcells.length > grid.subcellColumns * grid.subcellRows) {
      throw new RangeError("collision.solidSubcells exceeds the collision grid capacity");
    }
    const coordinates = new Set<string>();
    const solidSubcells = collisionInput.solidSubcells.map((pointInput, index) => {
      const point = record(pointInput, `collision.solidSubcells[${index}]`);
      exactKeys(point, ["x", "y"], `collision.solidSubcells[${index}]`);
      const x = integer(point.x, `collision.solidSubcells[${index}].x`, 0, grid.subcellColumns - 1);
      const y = integer(point.y, `collision.solidSubcells[${index}].y`, 0, grid.subcellRows - 1);
      const key = `${x},${y}`;
      if (coordinates.has(key)) throw new RangeError(`collision.solidSubcells repeats ${key}`);
      coordinates.add(key);
      return Object.freeze({ x, y });
    }).sort((left, right) => left.y - right.y || left.x - right.x);
    collision = {
      kind: "hybrid-grid-draft",
      tileSize: PRODUCTION_CANDIDATE_TILE_SIZE,
      subcellSize: PRODUCTION_CANDIDATE_SUBCELL_SIZE,
      grid,
      solidSubcells,
    };
  } else {
    throw new RangeError("collision.kind must be hybrid-grid-draft or empty");
  }

  return deepFreeze({
    ...identity,
    settings: {
      name: name(settingsInput.name),
      family: selectedFamily,
      targetWidth,
      targetHeight,
      layers,
      runtimeBindingAssetId: runtimeBinding(settingsInput.runtimeBindingAssetId),
    },
    collision,
  });
}

/** Compares canonical structured authoring state, including ordered layers and collision. */
export function productionCandidateAuthoringRequestsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(validateProductionCandidateAuthoringRequest(left))
    === JSON.stringify(validateProductionCandidateAuthoringRequest(right));
}

export function productionCandidateMaskFile(recipeId: string): string {
  const id = stableId(recipeId, "recipeId");
  return `assets-src/gr3/candidate-masks/${id.replaceAll(".", "-")}-mask.png`;
}

/**
 * Applies only fields exposed by the structured pending-candidate editor.
 * Source paths, preparation method, layer meaning, animation, provenance and
 * stable identity remain server-owned.
 */
export function applyProductionCandidateAuthoringRequest(
  current: Readonly<ProductionAssetRecipe>,
  requestInput: unknown,
): Readonly<ProductionAssetRecipe> {
  const request = validateProductionCandidateAuthoringRequest(requestInput);
  if (current.id !== request.recipeId) throw new RangeError("Authoring request does not match the current recipe");
  if (current.lifecycle !== "source") throw new RangeError(`${current.id} is not a pending source recipe`);
  const currentLayers = new Map(current.layers.map((layer) => [layer.id, layer]));
  if (currentLayers.size !== request.settings.layers.length
    || request.settings.layers.some(({ id }) => !currentLayers.has(id))) {
    throw new RangeError("Authoring request layers must name every current recipe layer exactly once");
  }
  const layers = request.settings.layers.map((settings) => {
    const layer = currentLayers.get(settings.id);
    if (!layer) throw new RangeError(`Unknown current recipe layer ${settings.id}`);
    return {
      ...layer,
      defaultVisible: settings.defaultVisible,
      opacity: settings.opacity,
      preparation: {
        ...layer.preparation,
        targetWidth: request.settings.targetWidth,
        targetHeight: request.settings.targetHeight,
      },
    };
  });
  const tags = [
    request.settings.family,
    ...current.tags.filter((tag) => tag !== current.family && tag !== request.settings.family),
  ];
  const updated = {
    ...current,
    name: request.settings.name,
    family: request.settings.family,
    tags,
    layers,
    collision: request.collision.kind === "hybrid-grid-draft"
      ? {
        mode: "mask-file" as const,
        maskFile: productionCandidateMaskFile(current.id),
        tileSize: PRODUCTION_CANDIDATE_TILE_SIZE,
        subcellSize: PRODUCTION_CANDIDATE_SUBCELL_SIZE,
      }
      : {
        mode: "empty" as const,
        reason: request.collision.reason,
      },
    ...(request.settings.runtimeBindingAssetId
      ? {
        runtimeBinding: {
          assetId: request.settings.runtimeBindingAssetId,
          collisionIntent: "preserve" as const,
        },
      }
      : { runtimeBinding: undefined }),
  };
  const validated = validateProductionAssetRecipeManifest({ formatVersion: 1, recipes: [updated] });
  return validated.recipes[0];
}

/** Produces the exact semantic PNG pixels consumed by the existing mask-file preparation seam. */
export function productionCandidateMaskPixels(
  requestInput: unknown,
): Readonly<{ width: number; height: number; pixels: Uint8Array }> {
  const request = validateProductionCandidateAuthoringRequest(requestInput);
  if (request.collision.kind !== "hybrid-grid-draft") {
    throw new RangeError("Explicitly passable candidates do not have a semantic mask");
  }
  const { targetWidth: width, targetHeight: height } = request.settings;
  const pixels = new Uint8Array(width * height * 4);
  for (const point of request.collision.solidSubcells) {
    const left = point.x * PRODUCTION_CANDIDATE_SUBCELL_SIZE;
    const top = point.y * PRODUCTION_CANDIDATE_SUBCELL_SIZE;
    for (let y = top; y < top + PRODUCTION_CANDIDATE_SUBCELL_SIZE; y++) {
      for (let x = left; x < left + PRODUCTION_CANDIDATE_SUBCELL_SIZE; x++) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = 255;
      }
    }
  }
  return Object.freeze({ width, height, pixels });
}

/** Adapts a production draft to the sparse profile already understood by CollisionEditorModel. */
export function productionCandidateDraftToEditorProfile(
  draftInput: unknown,
): Readonly<RuntimeCollisionProfile> {
  const draft = record(draftInput, "candidate collision draft");
  if (draft.kind === "empty") {
    if (draft.passable !== true) {
      throw new RangeError("Empty candidate collision draft must be explicitly passable");
    }
    return Object.freeze({ kind: "empty" });
  }
  if (draft.kind !== "hybrid-grid-draft"
    || draft.tileSize !== PRODUCTION_CANDIDATE_TILE_SIZE
    || draft.subcellSize !== PRODUCTION_CANDIDATE_SUBCELL_SIZE) {
    throw new RangeError("Candidate collision draft must use the supported 32/8 px hybrid grid");
  }
  const grid = record(draft.grid, "candidate collision draft grid");
  const width = integer(grid.width, "candidate collision draft grid.width", 1, 128);
  const height = integer(grid.height, "candidate collision draft grid.height", 1, 128);
  const subcellColumns = integer(
    grid.subcellColumns,
    "candidate collision draft grid.subcellColumns",
    1,
    512,
  );
  const subcellRows = integer(grid.subcellRows, "candidate collision draft grid.subcellRows", 1, 512);
  if (subcellColumns !== width * 4 || subcellRows !== height * 4) {
    throw new RangeError("Candidate collision draft subcell grid does not match its navigation grid");
  }
  if (!Array.isArray(draft.solidSubcells)) throw new TypeError("candidate collision draft solids must be an array");
  const masks = new Uint16Array(width * height);
  const seen = new Set<string>();
  for (const [index, pointInput] of draft.solidSubcells.entries()) {
    const point = record(pointInput, `candidate collision draft solids[${index}]`);
    const x = integer(point.x, `candidate collision draft solids[${index}].x`, 0, subcellColumns - 1);
    const y = integer(point.y, `candidate collision draft solids[${index}].y`, 0, subcellRows - 1);
    const key = `${x},${y}`;
    if (seen.has(key)) throw new RangeError(`candidate collision draft repeats ${key}`);
    seen.add(key);
    const cellX = Math.floor(x / 4);
    const cellY = Math.floor(y / 4);
    masks[cellY * width + cellX] |= 1 << ((y % 4) * 4 + (x % 4));
  }
  const mixedCells = [];
  for (let cellY = 0; cellY < height; cellY++) {
    for (let cellX = 0; cellX < width; cellX++) {
      const mask = masks[cellY * width + cellX];
      if (mask === 0) continue;
      const solidRows = Array.from({ length: 4 }, (_, localY) =>
        Array.from({ length: 4 }, (_, localX) =>
          (mask & (1 << (localY * 4 + localX))) !== 0 ? "1" : "0").join(""));
      mixedCells.push(Object.freeze({
        x: cellX,
        y: cellY,
        solidRows: Object.freeze(solidRows) as readonly [string, string, string, string],
      }));
    }
  }
  return deepFreeze({ kind: "hybrid-grid", subcellSize: 8, mixedCells });
}
