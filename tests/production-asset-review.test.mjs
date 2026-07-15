import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  reviewProductionCandidate,
  validateProductionReviewRequest,
  validateProductionReviewStore,
} from "../scripts/production-asset-review.mjs";

const roots = [];
const fingerprintA = "a".repeat(64);
const fingerprintB = "b".repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-production-review-"));
  roots.push(root);
  const gr3 = path.join(root, "assets-src", "gr3");
  const generated = path.join(gr3, "generated");
  const runtime = path.join(root, "src", "wayfinders", "assets", "packages");
  await Promise.all([
    mkdir(generated, { recursive: true }),
    mkdir(runtime, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(gr3, "production-recipes.json"), JSON.stringify({
      formatVersion: 1,
      recipes: [{ id: "production.island.zeta" }, { id: "production.island.alpha" }],
    })),
    writeFile(path.join(generated, "production-index.json"), JSON.stringify({
      formatVersion: 1,
      entries: [
        { id: "production.island.zeta", jobKey: fingerprintB },
        { id: "production.island.alpha", jobKey: fingerprintA },
      ],
    })),
    writeFile(path.join(gr3, "reviews.json"), '{"formatVersion":1,"decisions":[]}\n'),
    writeFile(path.join(runtime, "runtime-sentinel.json"), '{"accepted":true}\n'),
  ]);
  return { root, gr3, runtime };
}

async function storedReviews(gr3) {
  return JSON.parse(await readFile(path.join(gr3, "reviews.json"), "utf8"));
}

describe("GR-3.3 production candidate decisions", () => {
  it("accepts only the small trusted decision envelope and canonical store", () => {
    expect(validateProductionReviewRequest({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "approved",
    })).toEqual({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "approved",
    });
    expect(() => validateProductionReviewRequest({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "pending",
    })).toThrow(/approved or rejected/);
    expect(() => validateProductionReviewRequest({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "approved",
      outputFile: "public/runtime.png",
    })).toThrow(/must contain only/);
    expect(() => validateProductionReviewStore({
      formatVersion: 1,
      decisions: [
        { recipeId: "same", candidateFingerprint: fingerprintA, decision: "approved" },
        { recipeId: "same", candidateFingerprint: fingerprintB, decision: "rejected" },
      ],
    })).toThrow(/more than one decision/);
  });

  it("stores approvals and replacement rejections for the current candidate", async () => {
    const { root, gr3 } = await createRepository();
    await expect(reviewProductionCandidate({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "approved",
    }, { repositoryRoot: root })).resolves.toMatchObject({ decision: "approved" });
    await reviewProductionCandidate({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "rejected",
    }, { repositoryRoot: root });
    expect(await storedReviews(gr3)).toEqual({
      formatVersion: 1,
      decisions: [{
        recipeId: "production.island.alpha",
        candidateFingerprint: fingerprintA,
        decision: "rejected",
      }],
    });
  });

  it("sorts decisions stably by recipe ID regardless of review order", async () => {
    const { root, gr3 } = await createRepository();
    await reviewProductionCandidate({
      recipeId: "production.island.zeta",
      candidateFingerprint: fingerprintB,
      decision: "approved",
    }, { repositoryRoot: root });
    await reviewProductionCandidate({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "rejected",
    }, { repositoryRoot: root });
    expect((await storedReviews(gr3)).decisions.map(({ recipeId }) => recipeId)).toEqual([
      "production.island.alpha",
      "production.island.zeta",
    ]);
  });

  it("rejects stale fingerprints and unknown IDs without changing the store", async () => {
    const { root, gr3 } = await createRepository();
    const before = await readFile(path.join(gr3, "reviews.json"));
    await expect(reviewProductionCandidate({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintB,
      decision: "approved",
    }, { repositoryRoot: root })).rejects.toThrow(/Stale candidate fingerprint/);
    await expect(reviewProductionCandidate({
      recipeId: "production.island.unknown",
      candidateFingerprint: fingerprintA,
      decision: "approved",
    }, { repositoryRoot: root })).rejects.toThrow(/Unknown production recipe/);
    expect(await readFile(path.join(gr3, "reviews.json"))).toEqual(before);
  });

  it("does not mutate runtime asset files while recording a review", async () => {
    const { root, runtime } = await createRepository();
    const runtimeFile = path.join(runtime, "runtime-sentinel.json");
    const before = await readFile(runtimeFile);
    await reviewProductionCandidate({
      recipeId: "production.island.alpha",
      candidateFingerprint: fingerprintA,
      decision: "approved",
    }, { repositoryRoot: root });
    expect(await readFile(runtimeFile)).toEqual(before);
  });
});
