import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSET_REVIEW_ROUTE,
  assetReviewOrigin,
  createAssetReviewMiddleware,
} from "../scripts/asset-review-api.mjs";
import { ProductionAssetReviewError } from "../scripts/production-asset-review.mjs";

const servers = [];
const fingerprint = "a".repeat(64);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function startServer(reviewCandidate, maximumBytes) {
  let middleware;
  const server = createServer((request, response) => middleware(request, response, () => {
    response.statusCode = 404;
    response.end("Not found");
  }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Expected a TCP test server");
  const origin = assetReviewOrigin(address.port);
  middleware = createAssetReviewMiddleware({ expectedOrigin: origin, reviewCandidate, maximumBytes });
  return origin;
}

function requestValue(overrides = {}) {
  return {
    recipeId: "production.island.alpha",
    candidateFingerprint: fingerprint,
    decision: "approved",
    ...overrides,
  };
}

async function post(origin, value, headers = {}) {
  return fetch(`${origin}${ASSET_REVIEW_ROUTE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

describe("local production asset-review API", () => {
  it("accepts a trusted review only from the exact development origin", async () => {
    const received = [];
    const origin = await startServer(async (request) => {
      received.push(request);
      return { ...request, message: "review stored" };
    });
    const response = await post(origin, requestValue());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, decision: "approved", message: "review stored" });
    expect(received).toEqual([requestValue()]);

    expect((await post(origin, requestValue(), { Origin: "http://localhost:5173" })).status).toBe(403);
    expect((await post(origin, requestValue(), { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post(origin, requestValue({ outputFile: "public/runtime.png" }))).status).toBe(400);
    expect(received).toHaveLength(1);
  });

  it("requires the exact route and POST method", async () => {
    const origin = await startServer(async (request) => request);
    const wrongRoute = await fetch(`${origin}${ASSET_REVIEW_ROUTE}?id=alpha`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(requestValue()),
    });
    expect(wrongRoute.status).toBe(404);
    const wrongMethod = await fetch(`${origin}${ASSET_REVIEW_ROUTE}`, { headers: { Origin: origin } });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
  });

  it("rejects malformed and oversized bodies before review", async () => {
    let count = 0;
    const origin = await startServer(async (request) => {
      count++;
      return request;
    }, 16);
    expect((await post(origin, "{oops")).status).toBe(400);
    expect((await post(origin, requestValue())).status).toBe(413);
    expect(count).toBe(0);
  });

  it("returns stale and unknown candidate failures as actionable 422 responses", async () => {
    const origin = await startServer(async () => {
      throw new ProductionAssetReviewError("Stale candidate fingerprint; refresh the asset library");
    });
    const response = await post(origin, requestValue());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Stale candidate fingerprint; refresh the asset library",
    });
  });
});
