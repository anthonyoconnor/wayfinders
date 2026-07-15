import {
  AUTHORED_ASSET_IDS,
  validateAuthoredAssetMetadata,
  type AuthoredAssetId,
  type AuthoredAssetMetadata,
  type AuthoredCollisionProfile,
} from "./AuthoredAssetContracts.ts";

export const COLLISION_CANDIDATE_BUNDLE_KIND = "collision" as const;
export const COLLISION_CANDIDATE_BUNDLE_VERSION = 1 as const;

export const ASSET_COLLISION_INTENTS = Object.freeze([
  "preserve",
  "replace",
  "reset-to-coarse",
] as const);

export type AssetCollisionIntent = (typeof ASSET_COLLISION_INTENTS)[number];
export type CollisionCandidateIntent = Exclude<AssetCollisionIntent, "preserve">;

interface CollisionCandidateBase {
  bundleKind: typeof COLLISION_CANDIDATE_BUNDLE_KIND;
  bundleVersion: typeof COLLISION_CANDIDATE_BUNDLE_VERSION;
  assetId: AuthoredAssetId;
  baseRuntimeRevision: number;
  baseCollisionFingerprint: string;
}

export interface ReplaceCollisionCandidateBundle extends CollisionCandidateBase {
  collisionIntent: "replace";
  collision: Readonly<AuthoredCollisionProfile>;
}

export interface ResetCollisionCandidateBundle extends CollisionCandidateBase {
  collisionIntent: "reset-to-coarse";
}

export type CollisionCandidateBundle =
  | ReplaceCollisionCandidateBundle
  | ResetCollisionCandidateBundle;

export type ExactAuthoredAssetMetadataValidator = (
  value: unknown,
) => Readonly<AuthoredAssetMetadata>;

const AUTHORED_ASSET_ID_SET = new Set<string>(Object.values(AUTHORED_ASSET_IDS));
const FINGERPRINT_PATTERN = /^collision-v1-[0-9a-f]{16}$/u;
const FNV64_OFFSET = 14_695_981_039_346_656_037n;
const FNV64_PRIME = 1_099_511_628_211n;
const FNV64_MASK = 0xffff_ffff_ffff_ffffn;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function assertOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new RangeError(`${label} cannot contain ${key}`);
  }
}

function normalizeJson(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain only finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => normalizeJson(entry, `${label}[${index}]`)));
  }
  const input = record(value, label);
  const output: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(input).sort()) {
    output[key] = normalizeJson(input[key], `${label}.${key}`);
  }
  return Object.freeze(output);
}

function authoredAssetId(value: unknown): AuthoredAssetId {
  if (typeof value !== "string" || !AUTHORED_ASSET_ID_SET.has(value)) {
    throw new RangeError(`Unsupported collision candidate assetId ${String(value)}`);
  }
  return value as AuthoredAssetId;
}

export function validateAssetCollisionIntent(
  value: unknown,
  label = "collisionIntent",
): AssetCollisionIntent {
  if (!ASSET_COLLISION_INTENTS.includes(value as AssetCollisionIntent)) {
    throw new RangeError(`${label} must be preserve, replace or reset-to-coarse`);
  }
  return value as AssetCollisionIntent;
}

function expectedCollisionKind(assetId: AuthoredAssetId): AuthoredCollisionProfile["kind"] {
  switch (assetId) {
    case AUTHORED_ASSET_IDS.homeIsland: return "hybrid-grid";
    case AUTHORED_ASSET_IDS.playerBoat: return "box";
    case AUTHORED_ASSET_IDS.fishingShoal: return "empty";
  }
}

function canonicalCollision(metadata: Readonly<AuthoredAssetMetadata>): JsonValue {
  const collision = metadata.collision;
  if (!collision) return Object.freeze({ state: "coarse" });
  switch (collision.kind) {
    case "hybrid-grid": return Object.freeze({
      kind: collision.kind,
      subcellSize: collision.subcellSize,
      mixedCells: Object.freeze([...collision.mixedCells]
        .sort((left, right) => left.y - right.y || left.x - right.x)
        .map((cell) => Object.freeze({
          x: cell.x,
          y: cell.y,
          solidRows: Object.freeze([...cell.solidRows]),
        }))),
    });
    case "box": return Object.freeze({
      kind: collision.kind,
      offset: Object.freeze({ x: collision.offset.x, y: collision.offset.y }),
      halfSize: Object.freeze({ width: collision.halfSize.width, height: collision.halfSize.height }),
    });
    case "empty": return Object.freeze({ kind: collision.kind });
  }
}

function fnv64(value: string): string {
  let hash = FNV64_OFFSET;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Stable across object identity and hybrid mixed-cell insertion order. */
export function collisionFingerprint(metadata: Readonly<AuthoredAssetMetadata>): string {
  const canonical = JSON.stringify({
    assetId: metadata.assetId,
    collision: canonicalCollision(metadata),
  });
  return `collision-v1-${fnv64(canonical)}`;
}

export function validateCollisionCandidateBundle(value: unknown): Readonly<CollisionCandidateBundle> {
  const parsed = record(value, "collision candidate bundle");
  if (parsed.bundleKind !== COLLISION_CANDIDATE_BUNDLE_KIND) {
    throw new RangeError(`Unsupported collision candidate bundle kind ${String(parsed.bundleKind)}`);
  }
  if (parsed.bundleVersion !== COLLISION_CANDIDATE_BUNDLE_VERSION) {
    throw new RangeError(`Unsupported collision candidate bundle version ${String(parsed.bundleVersion)}`);
  }
  const assetId = authoredAssetId(parsed.assetId);
  const baseRuntimeRevision = positiveInteger(parsed.baseRuntimeRevision, "baseRuntimeRevision");
  if (typeof parsed.baseCollisionFingerprint !== "string" || !FINGERPRINT_PATTERN.test(parsed.baseCollisionFingerprint)) {
    throw new RangeError("baseCollisionFingerprint must be a collision-v1 fingerprint");
  }
  const collisionIntent = validateAssetCollisionIntent(parsed.collisionIntent);
  if (collisionIntent === "preserve") {
    throw new RangeError("A collision-only candidate must replace collision or reset it to coarse");
  }

  const commonKeys = new Set([
    "bundleKind",
    "bundleVersion",
    "assetId",
    "baseRuntimeRevision",
    "baseCollisionFingerprint",
    "collisionIntent",
  ]);
  if (collisionIntent === "reset-to-coarse") {
    assertOnlyKeys(parsed, commonKeys, "collision candidate bundle");
    return Object.freeze({
      bundleKind: COLLISION_CANDIDATE_BUNDLE_KIND,
      bundleVersion: COLLISION_CANDIDATE_BUNDLE_VERSION,
      assetId,
      baseRuntimeRevision,
      baseCollisionFingerprint: parsed.baseCollisionFingerprint,
      collisionIntent,
    });
  }

  assertOnlyKeys(parsed, new Set([...commonKeys, "collision"]), "collision candidate bundle");
  const collision = normalizeJson(parsed.collision, "collision");
  const collisionInput = record(collision, "collision");
  const expectedKind = expectedCollisionKind(assetId);
  if (collisionInput.kind !== expectedKind) {
    throw new RangeError(`${assetId} collision candidate must use a ${expectedKind} profile`);
  }
  return Object.freeze({
    bundleKind: COLLISION_CANDIDATE_BUNDLE_KIND,
    bundleVersion: COLLISION_CANDIDATE_BUNDLE_VERSION,
    assetId,
    baseRuntimeRevision,
    baseCollisionFingerprint: parsed.baseCollisionFingerprint,
    collisionIntent,
    collision: collision as unknown as Readonly<AuthoredCollisionProfile>,
  });
}

/**
 * Applies only the collision field to an accepted package. The exact metadata
 * validator remains injectable for tooling, while runtime code defaults to the
 * same contract validator used by package loading.
 */
export function applyCollisionCandidate(
  currentMetadata: Readonly<AuthoredAssetMetadata>,
  candidateInput: unknown,
  validateMetadata: ExactAuthoredAssetMetadataValidator = validateAuthoredAssetMetadata,
): Readonly<AuthoredAssetMetadata> {
  const current = validateMetadata(currentMetadata);
  const candidate = validateCollisionCandidateBundle(candidateInput);
  if (candidate.assetId !== current.assetId) {
    throw new RangeError(`Collision candidate targets ${candidate.assetId}, not ${current.assetId}`);
  }
  if (candidate.baseRuntimeRevision !== current.runtimeRevision) {
    throw new RangeError(
      `Stale collision candidate revision ${candidate.baseRuntimeRevision}; current revision is ${current.runtimeRevision}`,
    );
  }
  const currentFingerprint = collisionFingerprint(current);
  if (candidate.baseCollisionFingerprint !== currentFingerprint) {
    throw new RangeError("Collision candidate base fingerprint does not match the accepted profile");
  }

  const nextInput = { ...current } as Record<string, unknown>;
  nextInput.runtimeRevision = current.runtimeRevision + 1;
  if (candidate.collisionIntent === "replace") nextInput.collision = candidate.collision;
  else delete nextInput.collision;

  const next = validateMetadata(nextInput);
  if (next.assetId !== current.assetId || next.kind !== current.kind) {
    throw new TypeError("Exact metadata validation changed the collision candidate target");
  }
  if (next.runtimeRevision !== current.runtimeRevision + 1) {
    throw new RangeError("Collision candidate must increment runtimeRevision exactly once");
  }
  return next;
}

/** Builds a portable collision-only candidate from the currently accepted package. */
export function createCollisionCandidate(
  currentMetadata: Readonly<AuthoredAssetMetadata>,
  collision: Readonly<AuthoredCollisionProfile> | undefined,
  collisionIntent: CollisionCandidateIntent,
  validateMetadata: ExactAuthoredAssetMetadataValidator = validateAuthoredAssetMetadata,
): Readonly<CollisionCandidateBundle> {
  const current = validateMetadata(currentMetadata);
  if (collisionIntent === "replace" && collision === undefined) {
    throw new RangeError("replace collisionIntent requires explicit collision metadata");
  }
  if (collisionIntent === "reset-to-coarse" && collision !== undefined) {
    throw new RangeError("reset-to-coarse collision candidate cannot contain collision metadata");
  }
  const input = {
    bundleKind: COLLISION_CANDIDATE_BUNDLE_KIND,
    bundleVersion: COLLISION_CANDIDATE_BUNDLE_VERSION,
    assetId: current.assetId,
    baseRuntimeRevision: current.runtimeRevision,
    baseCollisionFingerprint: collisionFingerprint(current),
    collisionIntent,
    ...(collisionIntent === "replace" ? { collision } : {}),
  };
  const candidate = validateCollisionCandidateBundle(input);
  const applied = applyCollisionCandidate(current, candidate, validateMetadata);
  if (candidate.collisionIntent === "reset-to-coarse") return candidate;
  if (applied.collision === undefined) {
    throw new TypeError("Exact metadata validation removed replacement collision metadata");
  }
  return Object.freeze({ ...candidate, collision: applied.collision });
}
