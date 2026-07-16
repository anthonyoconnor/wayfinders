import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRODUCTION_ASSET_INTAKE_ROUTE,
  createAssetIntakeMiddleware,
  createProductionAssetIntakeJobs,
} from "../scripts/asset-intake-api.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function start(runIntake, maximumBytes) {
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
  if (typeof address === "string" || address === null) throw new Error("Expected TCP address");
  const origin = `http://127.0.0.1:${address.port}`;
  middleware = createAssetIntakeMiddleware({
    expectedOrigin: origin,
    jobs: createProductionAssetIntakeJobs(runIntake),
    maximumBytes,
  });
  return origin;
}

async function waitFor(origin, jobId, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${origin}${PRODUCTION_ASSET_INTAKE_ROUTE}/${jobId}`, {
    });
    const job = await response.json();
    if (job.status === expected) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${expected}`);
}

describe("local guided asset-intake API", () => {
  it("represents queued progress and completion through same-origin job endpoints", async () => {
    const origin = await start(async (input, { onProgress }) => {
      onProgress("preparing", "Preparing candidate");
      return { recipeId: input.id, message: "Pending candidate created" };
    });
    const response = await fetch(`${origin}${PRODUCTION_ASSET_INTAKE_ROUTE}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "production.island.api-cay" }),
    });
    expect(response.status).toBe(202);
    const started = await response.json();
    expect(started).toMatchObject({ ok: true, status: "queued", phase: "queued" });
    await expect(waitFor(origin, started.jobId, "completed")).resolves.toMatchObject({
      phase: "completed",
      recipeId: "production.island.api-cay",
    });
  });

  it("cancels an active job and rejects untrusted or oversized creation", async () => {
    const origin = await start((_input, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }), 32);
    const create = await fetch(`${origin}${PRODUCTION_ASSET_INTAKE_ROUTE}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    const started = await create.json();
    const cancelled = await fetch(`${origin}${PRODUCTION_ASSET_INTAKE_ROUTE}/${started.jobId}`, {
      method: "DELETE",
      headers: { Origin: origin },
    });
    expect(cancelled.status).toBe(200);
    await expect(waitFor(origin, started.jobId, "cancelled")).resolves.toMatchObject({
      message: expect.stringMatching(/no partial output/u),
    });

    const untrusted = await fetch(`${origin}${PRODUCTION_ASSET_INTAKE_ROUTE}`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(untrusted.status).toBe(403);
    const oversized = await fetch(`${origin}${PRODUCTION_ASSET_INTAKE_ROUTE}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(64) }),
    });
    expect(oversized.status).toBe(413);
  });
});
