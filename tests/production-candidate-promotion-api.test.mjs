import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProductionCandidatePromotionMiddleware,
  PRODUCTION_CANDIDATE_PROMOTION_ROUTE,
} from "../scripts/production-candidate-promotion-api.mjs";
import {
  createProductionCandidatePromoter,
  ProductionCandidatePromotionError,
} from "../scripts/production-candidate-promotion.mjs";

const fingerprint = "a".repeat(64);
const recipeId = "production.vessel.test-ship";
const roots = [];
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function request(candidateFingerprint = fingerprint) {
  return { formatVersion: 1, recipeId, candidateFingerprint };
}

async function repository(decision = "approved") {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-candidate-promotion-"));
  roots.push(root);
  const gr3 = path.join(root, "assets-src", "gr3");
  await mkdir(path.join(gr3, "generated"), { recursive: true });
  await writeFile(path.join(gr3, "production-recipes.json"), `${JSON.stringify({
    formatVersion: 1,
    recipes: [{ id: recipeId, family: "vessel" }],
  })}\n`);
  await writeFile(path.join(gr3, "generated", "production-index.json"), `${JSON.stringify({
    formatVersion: 1,
    entries: [{ id: recipeId, jobKey: fingerprint }],
  })}\n`);
  await writeFile(path.join(gr3, "reviews.json"), `${JSON.stringify({
    formatVersion: 1,
    decisions: decision ? [{ recipeId, candidateFingerprint: fingerprint, decision }] : [],
  })}\n`);
  return root;
}

async function writeReview(root, candidateFingerprint, decision = "approved") {
  await writeFile(path.join(root, "assets-src", "gr3", "reviews.json"), `${JSON.stringify({
    formatVersion: 1,
    decisions: [{ recipeId, candidateFingerprint, decision }],
  })}\n`);
}

async function start(promoteCandidate, maximumBytes = 16_384) {
  let origin;
  const server = createServer((incoming, response) => {
    createProductionCandidatePromotionMiddleware({ expectedOrigin: origin, promoteCandidate, maximumBytes })(
      incoming,
      response,
      () => {
        response.statusCode = 404;
        response.end();
      },
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  return origin;
}

function post(origin, value, headers = {}) {
  return fetch(`${origin}${PRODUCTION_CANDIDATE_PROMOTION_ROUTE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

describe("GR-3.7 production candidate promotion endpoint", () => {
  it("publishes only the exact current approved fingerprint through the existing promotion seam", async () => {
    const root = await repository();
    const calls = [];
    const promoteCandidate = createProductionCandidatePromoter({
      repositoryRoot: root,
      promote: async (selectedId) => {
        calls.push(selectedId);
        return {
          counts: { candidates: 1, approved: 1, published: 1 },
          queue: [{
            id: recipeId,
            candidateFingerprint: fingerprint,
            reviewState: "approved",
            promotionState: "published",
          }],
        };
      },
    });
    await expect(promoteCandidate(request())).resolves.toMatchObject({
      recipeId,
      candidateFingerprint: fingerprint,
      promotionState: "published",
      counts: { published: 1 },
    });
    expect(calls).toEqual([recipeId]);
    await expect(promoteCandidate(request("b".repeat(64)))).rejects.toThrow(/Stale/u);
    expect(calls).toHaveLength(1);
  });

  it("rejects a current but unapproved candidate before promotion", async () => {
    const root = await repository(null);
    let called = false;
    const promoteCandidate = createProductionCandidatePromoter({
      repositoryRoot: root,
      promote: async () => { called = true; },
    });
    await expect(promoteCandidate(request())).rejects.toThrow(/currently approved/u);
    expect(called).toBe(false);
  });

  it("rejects promotion workflow for islands", async () => {
    const root = await repository();
    await writeFile(path.join(root, "assets-src", "gr3", "production-recipes.json"), `${JSON.stringify({
      formatVersion: 1,
      recipes: [{ id: recipeId, family: "island", availableInGame: false }],
    })}\n`);
    let called = false;
    const promoteCandidate = createProductionCandidatePromoter({
      repositoryRoot: root,
      promote: async () => { called = true; },
    });
    await expect(promoteCandidate(request())).rejects.toThrow(/Available in game instead of promotion/u);
    expect(called).toBe(false);
  });

  it("distinguishes a stale approval from a current pending candidate", async () => {
    const root = await repository();
    await writeReview(root, "b".repeat(64));
    let called = false;
    const promoteCandidate = createProductionCandidatePromoter({
      repositoryRoot: root,
      promote: async () => { called = true; },
    });
    await expect(promoteCandidate(request())).rejects.toThrow(/Review decision.*stale/u);
    expect(called).toBe(false);
  });

  it("accepts a validated same-origin body and rejects untrusted, malformed, and oversized requests", async () => {
    const received = [];
    const origin = await start(async (value) => {
      received.push(value);
      return { ...value, promotionState: "published" };
    }, 256);
    const response = await post(origin, request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, promotionState: "published" });
    expect(received).toEqual([request()]);
    expect((await post(origin, request(), { Origin: "http://localhost:5173" })).status).toBe(403);
    expect((await post(origin, { ...request(), outputPath: "public/hijack.png" })).status).toBe(400);
    expect((await post(origin, request(), { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post(origin, "x".repeat(300))).status).toBe(413);
    expect(received).toHaveLength(1);
  });

  it("returns stale service state as an actionable 422 response", async () => {
    const origin = await start(async () => {
      throw new ProductionCandidatePromotionError("Candidate changed after approval");
    });
    const response = await post(origin, request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "Candidate changed after approval" });
  });
});
