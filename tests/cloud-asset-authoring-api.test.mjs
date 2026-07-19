import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_DELETE_ROUTE,
  CLOUD_ASSET_SAVE_ROUTE,
  createCloudAssetAuthoringMiddleware,
} from "../scripts/cloud-asset-authoring-api.mjs";
import { CloudAssetAuthoringError } from "../scripts/cloud-asset-authoring.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()))));
});

function identityRequest() {
  return {
    formatVersion: 1,
    assetId: "presentation.clouds.primary",
    runtimeRevision: 6,
    variantId: "long-broken-wisp",
  };
}

function saveRequest() {
  return { ...identityRequest(), activeInGame: false };
}

async function start(authoring, maximumBytes = 16 * 1_024) {
  let origin;
  const server = createServer((request, response) => {
    createCloudAssetAuthoringMiddleware({ expectedOrigin: origin, authoring, maximumBytes })(
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

function post(origin, route, value, headers = {}) {
  return fetch(`${origin}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

describe("local cloud asset authoring API", () => {
  it("routes validated activation and deletion envelopes only from the exact development origin", async () => {
    const received = [];
    const origin = await start({
      save: async (value) => {
        received.push(["save", value]);
        return { variantId: value.variantId, runtimeRevision: 7, changed: true };
      },
      remove: async (value) => {
        received.push(["remove", value]);
        return { deletedVariantId: value.variantId, runtimeRevision: 7 };
      },
    });

    const saved = await post(origin, CLOUD_ASSET_SAVE_ROUTE, saveRequest());
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(saved.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await saved.json()).toMatchObject({
      ok: true,
      variantId: "long-broken-wisp",
      runtimeRevision: 7,
      changed: true,
    });

    const removed = await post(origin, CLOUD_ASSET_DELETE_ROUTE, identityRequest());
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      ok: true,
      deletedVariantId: "long-broken-wisp",
      runtimeRevision: 7,
    });
    expect(received.map(([kind]) => kind)).toEqual(["save", "remove"]);
    expect(received[0][1]).toEqual(saveRequest());
    expect(received[1][1]).toEqual(identityRequest());

    expect((await post(origin, CLOUD_ASSET_SAVE_ROUTE, saveRequest(), {
      Origin: "http://localhost:5173",
    })).status).toBe(403);
    expect(received).toHaveLength(2);
  });

  it("rejects malformed, non-JSON, oversized, wrong-method and query routes before the service", async () => {
    let calls = 0;
    const authoring = {
      save: async () => { calls++; },
      remove: async () => { calls++; },
    };
    const origin = await start(authoring, 256);
    expect((await post(origin, CLOUD_ASSET_DELETE_ROUTE, {
      ...identityRequest(),
      outputPath: "C:/outside.json",
    })).status).toBe(400);
    expect((await post(origin, CLOUD_ASSET_DELETE_ROUTE, identityRequest(), {
      "Content-Type": "text/plain",
    })).status).toBe(415);
    expect((await post(origin, CLOUD_ASSET_SAVE_ROUTE, JSON.stringify({ payload: "x".repeat(300) }))).status).toBe(413);
    const wrongMethod = await fetch(`${origin}${CLOUD_ASSET_DELETE_ROUTE}`, {
      headers: { Origin: origin },
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect((await post(origin, `${CLOUD_ASSET_DELETE_ROUTE}?id=1`, identityRequest())).status).toBe(404);
    expect(calls).toBe(0);
  });

  it("returns stale package failures as actionable 422 responses", async () => {
    const origin = await start({
      save: async () => {
        throw new CloudAssetAuthoringError("Stale cloud package revision; refresh");
      },
      remove: async () => identityRequest(),
    });
    const response = await post(origin, CLOUD_ASSET_SAVE_ROUTE, saveRequest());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Stale cloud package revision; refresh",
    });
  });
});
