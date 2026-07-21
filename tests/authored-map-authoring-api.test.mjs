import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAuthoredMapAuthoringMiddleware,
  createAuthoredMapStaticMiddleware,
} from "../scripts/authored-map-authoring-api.mjs";
import {
  AuthoredMapRepositoryConflictError,
  AuthoredMapRepositoryValidationError,
} from "../scripts/authored-map-repository.mjs";
import {
  AUTHORED_MAP_SAVE_ROUTE,
  maximumAuthoredMapSaveRequestBytesV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapRepositoryContracts.ts";
import { maximumAuthoredMapCanonicalBytesV1 } from "../src/wayfinders/app/authoredMaps/AuthoredMapCodec.ts";

const FINGERPRINT = "a".repeat(64);
const servers = [];
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()))));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function saveRequest() {
  return {
    formatVersion: 1,
    mapId: "alpha",
    expectedCatalogRevision: 0,
    definition: { id: "alpha" },
  };
}

async function startSaveServer(saveMap, maximumBytes = maximumAuthoredMapSaveRequestBytesV1()) {
  let origin;
  const server = createServer((request, response) => {
    createAuthoredMapAuthoringMiddleware({ expectedOrigin: origin, saveMap, maximumBytes })(
      request,
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

async function startStaticServer(repositoryRoot) {
  const middleware = createAuthoredMapStaticMiddleware({ repositoryRoot });
  const server = createServer((request, response) => middleware(request, response, () => {
    response.statusCode = 404;
    response.end();
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function post(origin, value, { route = AUTHORED_MAP_SAVE_ROUTE, headers = {} } = {}) {
  return fetch(`${origin}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

describe("local authored map API", () => {
  it("derives its body bound from the full canonical capacity plus the largest exact envelope", () => {
    const marker = "__AUTHORED_MAP_DEFINITION__";
    const envelope = JSON.stringify({
      formatVersion: 1,
      mapId: "m".repeat(64),
      expectedCatalogRevision: Number.MAX_SAFE_INTEGER,
      expectedMapRepositoryRevision: Number.MAX_SAFE_INTEGER,
      definition: marker,
    });
    const envelopeOverhead = new TextEncoder().encode(envelope).length
      - new TextEncoder().encode(JSON.stringify(marker)).length;
    expect(maximumAuthoredMapSaveRequestBytesV1()).toBe(
      maximumAuthoredMapCanonicalBytesV1() + envelopeOverhead,
    );
  });

  it("accepts one exact-origin, validated envelope and returns the trusted repository result", async () => {
    const received = [];
    const origin = await startSaveServer(async (value) => {
      received.push(value);
      return {
        changed: true,
        created: true,
        catalogRevision: 1,
        mapRepositoryRevision: 1,
        currentFingerprint: FINGERPRINT,
        retainedFingerprints: [FINGERPRINT],
        definition: { id: "alpha" },
        definitionUrl: `/maps/v1/alpha/${FINGERPRINT}.map.json`,
      };
    });
    const response = await post(origin, saveRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toMatchObject({
      ok: true,
      changed: true,
      created: true,
      catalogRevision: 1,
      mapRepositoryRevision: 1,
      currentFingerprint: FINGERPRINT,
    });
    expect(received).toEqual([saveRequest()]);

    expect((await post(origin, saveRequest(), {
      headers: { Origin: "http://localhost:5173" },
    })).status).toBe(403);
    expect(received).toHaveLength(1);
  });

  it("rejects malformed, non-JSON, oversized, wrong-method, and query requests before saving", async () => {
    let calls = 0;
    const origin = await startSaveServer(async () => { calls++; }, 256);
    expect((await post(origin, { ...saveRequest(), outputPath: "C:/outside.json" })).status).toBe(400);
    expect((await post(origin, saveRequest(), { headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await post(origin, JSON.stringify({ payload: "x".repeat(300) }))).status).toBe(413);
    const wrongMethod = await fetch(`${origin}${AUTHORED_MAP_SAVE_ROUTE}`, {
      headers: { Origin: origin },
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect((await post(origin, saveRequest(), { route: `${AUTHORED_MAP_SAVE_ROUTE}?map=alpha` })).status)
      .toBe(404);
    expect(calls).toBe(0);
  });

  it("maps optimistic conflicts to 409 and semantic/compiler failures to 422", async () => {
    const conflictOrigin = await startSaveServer(async () => {
      throw new AuthoredMapRepositoryConflictError(
        "catalog-revision-conflict",
        "Catalog changed",
        { currentCatalogRevision: 4 },
      );
    });
    const conflict = await post(conflictOrigin, saveRequest());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      ok: false,
      error: {
        code: "catalog-revision-conflict",
        message: "Catalog changed",
        details: { currentCatalogRevision: 4 },
      },
    });

    const validationOrigin = await startSaveServer(async () => {
      throw new AuthoredMapRepositoryValidationError(
        "map-validation-failed",
        "Map has blocking diagnostics",
        { diagnostics: [{ code: "blocked" }] },
      );
    });
    const validation = await post(validationOrigin, saveRequest());
    expect(validation.status).toBe(422);
    expect(await validation.json()).toMatchObject({
      ok: false,
      error: { code: "map-validation-failed", details: { diagnostics: [{ code: "blocked" }] } },
    });
  });

  it("serves fresh catalog and immutable definition files with exact static routes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wayfinders-authored-map-static-"));
    temporaryRoots.push(root);
    const definitionDirectory = path.join(root, "public", "maps", "v1", "alpha");
    await mkdir(definitionDirectory, { recursive: true });
    await writeFile(path.join(root, "public", "maps", "catalog.json"), "{\"catalog\":true}\n");
    await writeFile(path.join(definitionDirectory, `${FINGERPRINT}.map.json`), "{\"map\":true}\n");
    const origin = await startStaticServer(root);

    const catalog = await fetch(`${origin}/maps/catalog.json`);
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get("cache-control")).toBe("no-cache");
    expect(await catalog.text()).toBe("{\"catalog\":true}\n");
    const definitionResponse = await fetch(`${origin}/maps/v1/alpha/${FINGERPRINT}.map.json`);
    expect(definitionResponse.status).toBe(200);
    expect(definitionResponse.headers.get("cache-control")).toContain("immutable");
    expect(await definitionResponse.text()).toBe("{\"map\":true}\n");

    const head = await fetch(`${origin}/maps/v1/alpha/${FINGERPRINT}.map.json`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await fetch(`${origin}/maps/v1/alpha/${FINGERPRINT}.map.json?x=1`)).status).toBe(404);
    expect((await fetch(`${origin}/maps/v1/../${FINGERPRINT}.map.json`)).status).toBe(404);
    expect((await fetch(`${origin}/maps/v1/alpha/${"b".repeat(64)}.map.json`)).status).toBe(404);
  });
});
