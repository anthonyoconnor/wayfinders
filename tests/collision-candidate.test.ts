import { describe, expect, it } from "vitest";
import homeIslandPackage from "../src/wayfinders/assets/packages/home-island.json";
import playerBoatPackage from "../src/wayfinders/assets/packages/player-boat.json";
import {
  COLLISION_CANDIDATE_BUNDLE_KIND,
  COLLISION_CANDIDATE_BUNDLE_VERSION,
  applyCollisionCandidate,
  collisionFingerprint,
  createCollisionCandidate,
  validateCollisionCandidateBundle,
} from "../src/wayfinders/assets/CollisionCandidate.ts";
import {
  validateAuthoredAssetMetadata,
  type AuthoredAssetMetadata,
  type AuthoredCollisionProfile,
  type AuthoredHomeIslandMetadata,
} from "../src/wayfinders/assets/AuthoredAssetContracts.ts";

const REPLACEMENT_HOME_COLLISION = {
  kind: "hybrid-grid",
  subcellSize: 8,
  mixedCells: [{ x: 1, y: 1, solidRows: ["1000", "0000", "0000", "0000"] }],
} as const;

function acceptedHome(): Readonly<AuthoredHomeIslandMetadata> {
  const metadata = validateAuthoredAssetMetadata(homeIslandPackage);
  if (metadata.kind !== "home-island") throw new Error("Expected authored home metadata");
  return metadata;
}

function candidate(
  current: Readonly<AuthoredAssetMetadata>,
  collisionIntent: "replace" | "reset-to-coarse",
  collision?: Readonly<AuthoredCollisionProfile>,
): Record<string, unknown> {
  return {
    bundleKind: COLLISION_CANDIDATE_BUNDLE_KIND,
    bundleVersion: COLLISION_CANDIDATE_BUNDLE_VERSION,
    assetId: current.assetId,
    baseRuntimeRevision: current.runtimeRevision,
    baseCollisionFingerprint: collisionFingerprint(current),
    collisionIntent,
    ...(collisionIntent === "replace" ? { collision } : {}),
  };
}

describe("GR-2.5 collision-only package candidates", () => {
  it("creates normalized replacement and reset bundles directly from accepted metadata", () => {
    const current = acceptedHome();
    const replacement = createCollisionCandidate(current, REPLACEMENT_HOME_COLLISION, "replace");
    const reset = createCollisionCandidate(current, undefined, "reset-to-coarse");

    expect(replacement).toMatchObject({
      bundleKind: "collision",
      bundleVersion: 1,
      assetId: current.assetId,
      baseRuntimeRevision: current.runtimeRevision,
      baseCollisionFingerprint: collisionFingerprint(current),
      collisionIntent: "replace",
      collision: REPLACEMENT_HOME_COLLISION,
    });
    expect(reset).toMatchObject({
      collisionIntent: "reset-to-coarse",
      baseRuntimeRevision: current.runtimeRevision,
    });
    expect(Object.hasOwn(reset, "collision")).toBe(false);
    expect(() => createCollisionCandidate(current, undefined, "replace")).toThrow(/requires explicit/);
    expect(() => createCollisionCandidate(current, REPLACEMENT_HOME_COLLISION, "reset-to-coarse"))
      .toThrow(/cannot contain/);
  });

  it("replaces only collision metadata and increments runtimeRevision exactly once", () => {
    const current = acceptedHome();
    const result = applyCollisionCandidate(
      current,
      candidate(current, "replace", REPLACEMENT_HOME_COLLISION),
    );

    expect(result.runtimeRevision).toBe(current.runtimeRevision + 1);
    expect(result.collision).toEqual(REPLACEMENT_HOME_COLLISION);
    expect({ ...result, runtimeRevision: current.runtimeRevision, collision: current.collision })
      .toEqual(current);
    expect(current.collision).toEqual(homeIslandPackage.collision);
  });

  it("resets to the package's coarse fallback without retaining a collision field", () => {
    const current = acceptedHome();
    const result = applyCollisionCandidate(current, candidate(current, "reset-to-coarse"));
    if (result.kind !== "home-island") throw new Error("Expected authored home metadata");

    expect(result.runtimeRevision).toBe(current.runtimeRevision + 1);
    expect(Object.hasOwn(result, "collision")).toBe(false);
    expect(result.render).toEqual(current.render);
    expect(result.grid).toEqual(current.grid);
    expect(result.anchors).toEqual(current.anchors);
  });

  it("rejects stale revisions and changed base collision fingerprints independently", () => {
    const current = acceptedHome();
    const stale = candidate(current, "reset-to-coarse");
    stale.baseRuntimeRevision = current.runtimeRevision - 1;
    expect(() => applyCollisionCandidate(current, stale)).toThrow(/Stale collision candidate revision/);

    const mismatched = candidate(current, "reset-to-coarse");
    const changedBase = applyCollisionCandidate(current, candidate(
      current,
      "replace",
      REPLACEMENT_HOME_COLLISION,
    ));
    mismatched.baseRuntimeRevision = changedBase.runtimeRevision;
    expect(() => applyCollisionCandidate(changedBase, mismatched)).toThrow(/fingerprint does not match/);
  });

  it("fingerprints normalized collision deterministically regardless of mixed-cell order", () => {
    const firstInput = structuredClone(homeIslandPackage) as Record<string, unknown>;
    firstInput.collision = {
      kind: "hybrid-grid",
      subcellSize: 8,
      mixedCells: [
        { x: 3, y: 2, solidRows: ["1000", "0000", "0000", "0000"] },
        { x: 2, y: 2, solidRows: ["0001", "0000", "0000", "0000"] },
      ],
    };
    const secondInput = structuredClone(firstInput) as Record<string, unknown>;
    (secondInput.collision as { mixedCells: unknown[] }).mixedCells.reverse();
    const first = validateAuthoredAssetMetadata(firstInput);
    const second = validateAuthoredAssetMetadata(secondInput);

    expect(collisionFingerprint(first)).toBe(collisionFingerprint(second));
    expect(collisionFingerprint(first)).toMatch(/^collision-v1-[0-9a-f]{16}$/u);
    expect(collisionFingerprint(first)).not.toBe(collisionFingerprint(acceptedHome()));
  });

  it("is strictly discriminated and cannot carry visual or source replacement data", () => {
    const current = acceptedHome();
    const extra = candidate(current, "reset-to-coarse");
    extra.images = [];
    expect(() => validateCollisionCandidateBundle(extra)).toThrow(/cannot contain images/);
    expect(() => validateCollisionCandidateBundle({
      ...candidate(current, "reset-to-coarse"),
      bundleKind: "asset",
    })).toThrow(/bundle kind/);
    expect(() => validateCollisionCandidateBundle({
      ...candidate(current, "reset-to-coarse"),
      bundleVersion: 2,
    })).toThrow(/bundle version/);
  });

  it("requires a profile on replacement, forbids one on reset, and enforces the asset profile kind", () => {
    const current = acceptedHome();
    expect(() => validateCollisionCandidateBundle(candidate(current, "replace"))).toThrow(/collision must be an object/);
    expect(() => validateCollisionCandidateBundle({
      ...candidate(current, "reset-to-coarse"),
      collision: REPLACEMENT_HOME_COLLISION,
    })).toThrow(/cannot contain collision/);
    expect(() => validateCollisionCandidateBundle(candidate(
      current,
      "replace",
      { kind: "empty" },
    ))).toThrow(/hybrid-grid profile/);
  });

  it("uses the injected exact metadata validator for target-specific bounds and normalization", () => {
    const current = acceptedHome();
    let validationCalls = 0;
    const exactValidator = (value: unknown) => {
      validationCalls++;
      return validateAuthoredAssetMetadata(value);
    };
    const invalidCollision = {
      ...REPLACEMENT_HOME_COLLISION,
      mixedCells: [{ x: 99, y: 1, solidRows: ["1000", "0000", "0000", "0000"] }],
    } as const;

    expect(() => applyCollisionCandidate(
      current,
      candidate(current, "replace", invalidCollision),
      exactValidator,
    )).toThrow(/outside the 25x25 asset grid/);
    expect(validationCalls).toBe(2);
  });

  it("rejects a valid candidate applied to a different accepted package", () => {
    const home = acceptedHome();
    const boat = validateAuthoredAssetMetadata(playerBoatPackage);
    expect(() => applyCollisionCandidate(
      boat,
      candidate(home, "reset-to-coarse"),
    )).toThrow(/targets home\.island\.primary/);
  });
});
