import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProductionCandidateAuthoringMiddleware,
  PRODUCTION_CANDIDATE_SAVE_ROUTE,
  PRODUCTION_CANDIDATE_VALIDATE_ROUTE,
} from "../scripts/production-candidate-authoring-api.mjs";
import { ProductionCandidateAuthoringError } from "../scripts/production-candidate-authoring.mjs";

const servers = [];
const fingerprint = "a".repeat(64);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()))));
});
function saveRequest() {
  return {
    formatVersion: 1,
    recipeId: "production.island.test-cay",
    candidateFingerprint: fingerprint,
    settings: {
      name: "Test Cay",
      family: "island",
      targetWidth: 32,
      targetHeight: 32,
      layers: [{ id: "base", defaultVisible: true, opacity: 1 }],
      runtimeBindingAssetId: null,
      availableInGame: false,
    },
    collision: {
      kind: "hybrid-grid-draft",
      tileSize: 32,
      subcellSize: 8,
      grid: { width: 1, height: 1, subcellColumns: 4, subcellRows: 4 },
      solidSubcells: [{ x: 1, y: 2 }],
    },
  };
}

function identityRequest() {
  const { formatVersion, recipeId, candidateFingerprint } = saveRequest();
  return { formatVersion, recipeId, candidateFingerprint };
}

async function start(authoring, maximumBytes = 8 * 1_048_576) {
  let origin;
  const server = createServer((request, response) => {
    createProductionCandidateAuthoringMiddleware({ expectedOrigin: origin, authoring, maximumBytes })(
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

describe("local production candidate authoring API", () => {
  it("routes validated save and validation envelopes only from the exact development origin", async () => {
    const received = [];
    const origin = await start({
      save: async (value) => {
        received.push(["save", value]);
        return { fingerprint: "b".repeat(64), reviewState: "pending" };
      },
      validate: async (value) => {
        received.push(["validate", value]);
        return { fingerprint: value.candidateFingerprint, validationState: "current" };
      },
    });
    const saved = await post(origin, PRODUCTION_CANDIDATE_SAVE_ROUTE, saveRequest());
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, reviewState: "pending" });
    const validated = await post(origin, PRODUCTION_CANDIDATE_VALIDATE_ROUTE, identityRequest());
    expect(validated.status).toBe(200);
    expect(await validated.json()).toMatchObject({ ok: true, validationState: "current" });
    expect(received.map(([kind]) => kind)).toEqual(["save", "validate"]);

    expect((await post(origin, PRODUCTION_CANDIDATE_SAVE_ROUTE, saveRequest(), {
      Origin: "http://localhost:5173",
    })).status).toBe(403);
    expect(received).toHaveLength(2);
  });

  it("rejects malformed, non-JSON, oversized, wrong-method and query routes before the service", async () => {
    let calls = 0;
    const authoring = {
      save: async () => { calls++; },
      validate: async () => { calls++; },
    };
    const origin = await start(authoring, 256);
    expect((await post(origin, PRODUCTION_CANDIDATE_VALIDATE_ROUTE, {
      ...identityRequest(),
      outputPath: "C:/outside.png",
    })).status).toBe(400);
    expect((await post(origin, PRODUCTION_CANDIDATE_VALIDATE_ROUTE, identityRequest(), {
      "Content-Type": "text/plain",
    })).status).toBe(415);
    expect((await post(origin, PRODUCTION_CANDIDATE_SAVE_ROUTE, saveRequest())).status).toBe(413);
    const wrongMethod = await fetch(`${origin}${PRODUCTION_CANDIDATE_VALIDATE_ROUTE}`, {
      headers: { Origin: origin },
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect((await post(origin, `${PRODUCTION_CANDIDATE_VALIDATE_ROUTE}?id=1`, identityRequest())).status).toBe(404);
    expect(calls).toBe(0);
  });

  it("returns stale candidate failures as actionable 422 responses", async () => {
    const origin = await start({
      save: async () => { throw new ProductionCandidateAuthoringError("Stale candidate fingerprint; refresh"); },
      validate: async () => identityRequest(),
    });
    const response = await post(origin, PRODUCTION_CANDIDATE_SAVE_ROUTE, saveRequest());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "Stale candidate fingerprint; refresh" });
  });
});
