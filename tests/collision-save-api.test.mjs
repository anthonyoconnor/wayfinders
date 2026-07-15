import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  COLLISION_SAVE_ROUTE,
  CollisionIntakeError,
  assertCollisionSaveEnvelope,
  collisionSaveOrigin,
  createCollisionSaveMiddleware,
  createCollisionSaver,
  isSameCollisionSaveOrigin,
  readJsonRequestBody,
  serializeCollisionSaves,
} from "../scripts/collision-save-api.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function startServer(saveCollision, maximumBytes) {
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
  const origin = collisionSaveOrigin(address.port);
  middleware = createCollisionSaveMiddleware({ expectedOrigin: origin, saveCollision, maximumBytes });
  return origin;
}

async function post(origin, body, headers = {}) {
  return fetch(`${origin}${COLLISION_SAVE_ROUTE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body,
  });
}

describe("local collision-save API", () => {
  it("uses one exact loopback origin", () => {
    expect(collisionSaveOrigin(5173)).toBe("http://127.0.0.1:5173");
    expect(isSameCollisionSaveOrigin("http://127.0.0.1:5173", collisionSaveOrigin(5173))).toBe(true);
    expect(isSameCollisionSaveOrigin("http://localhost:5173", collisionSaveOrigin(5173))).toBe(false);
    expect(isSameCollisionSaveOrigin(undefined, collisionSaveOrigin(5173))).toBe(false);
    expect(() => collisionSaveOrigin(0)).toThrow(/valid TCP port/);
    expect(assertCollisionSaveEnvelope({ bundleKind: "collision" })).toEqual({ bundleKind: "collision" });
    expect(() => assertCollisionSaveEnvelope({ bundleKind: "asset" })).toThrow(/only accepts collision/);
  });

  it("accepts JSON only from the development server origin on the exact route", async () => {
    const saved = [];
    const origin = await startServer(async (candidate) => {
      saved.push(candidate);
      return { assetId: candidate.assetId, message: "accepted" };
    });

    const candidate = { bundleKind: "collision", assetId: "home.island.primary" };
    const response = await post(origin, JSON.stringify(candidate));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      assetId: "home.island.primary",
      message: "accepted",
    });
    expect(saved).toEqual([candidate]);

    const wrongOrigin = await post(origin, "{}", { Origin: "http://localhost:5173" });
    expect(wrongOrigin.status).toBe(403);
    const wrongType = await post(origin, "{}", { "Content-Type": "text/plain" });
    expect(wrongType.status).toBe(415);
    const visualBundle = await post(origin, JSON.stringify({ bundleKind: "asset", bundleVersion: 1 }));
    expect(visualBundle.status).toBe(400);
    expect(saved).toEqual([candidate]);
    const wrongRoute = await fetch(`${origin}${COLLISION_SAVE_ROUTE}?candidate=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: "{}",
    });
    expect(wrongRoute.status).toBe(404);
    const wrongMethod = await fetch(`${origin}${COLLISION_SAVE_ROUTE}`, { headers: { Origin: origin } });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
  });

  it("rejects malformed and oversized bodies before saving", async () => {
    let saveCount = 0;
    const origin = await startServer(async () => {
      saveCount++;
      return { message: "accepted" };
    }, 16);

    const malformed = await post(origin, "{oops");
    expect(malformed.status).toBe(400);
    const oversized = await post(origin, JSON.stringify({ collision: "too large" }));
    expect(oversized.status).toBe(413);
    expect(saveCount).toBe(0);

    const chunked = Readable.from([Buffer.from("{\"collision\":"), Buffer.from("\"too large\"}")]);
    chunked.headers = { "content-type": "application/json" };
    await expect(readJsonRequestBody(chunked, 16)).rejects.toThrow(/16-byte limit/);
  });

  it("returns authoritative intake failures without a stack trace", async () => {
    const origin = await startServer(async () => {
      throw new CollisionIntakeError("Stale collision candidate revision 2; current revision is 3");
    });
    const response = await post(origin, JSON.stringify({ bundleKind: "collision" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Stale collision candidate revision 2; current revision is 3",
    });
  });

  it("serializes work even after an earlier save fails", async () => {
    const order = [];
    const save = serializeCollisionSaves(async (value) => {
      order.push(`start-${value}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${value}`);
      if (value === 1) throw new Error("first failed");
      return value;
    });
    const first = save(1);
    const second = save(2);
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("writes private temporary candidates, invokes intake once, and always cleans up", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "wayfinders-save-api-test-"));
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const observed = [];
    try {
      const save = createCollisionSaver({
        repositoryRoot,
        temporaryRoot,
        intake: async (candidateFile, receivedRoot) => {
          observed.push({
            candidateFile,
            receivedRoot,
            candidate: JSON.parse(await readFile(candidateFile, "utf8")),
          });
          return { message: "pipeline accepted candidate" };
        },
      });
      await expect(save({ assetId: "home.island.primary", collisionIntent: "replace" })).resolves.toEqual({
        assetId: "home.island.primary",
        message: "pipeline accepted candidate",
      });
      expect(observed).toHaveLength(1);
      expect(observed[0].receivedRoot).toBe(repositoryRoot);
      expect(observed[0].candidate).toEqual({ assetId: "home.island.primary", collisionIntent: "replace" });
      expect(path.dirname(observed[0].candidateFile).startsWith(temporaryRoot)).toBe(true);
      expect(await readdir(temporaryRoot)).toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
