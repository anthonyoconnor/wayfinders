import { describe, expect, it, vi } from "vitest";
import {
  MapRepositoryRequestError,
  createMapRepositoryClient,
} from "../src/wayfinders/assets/mapEditor/MapRepositoryClient";
import type { AuthoredMapDefinitionV1 } from "../src/wayfinders/app/authoredMaps";

const fingerprint = "a".repeat(64);
const definition = Object.freeze({
  id: "test-map",
  contentFingerprint: fingerprint,
}) as unknown as Readonly<AuthoredMapDefinitionV1>;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MAP-1.2 browser map repository client", () => {
  it("reads a no-store catalog and an immutable current definition", async () => {
    const catalog = {
      formatVersion: 1,
      catalogRevision: 3,
      maps: [{
        id: "test-map",
        displayName: "Test map",
        mapRepositoryRevision: 2,
        currentFingerprint: fingerprint,
        retainedFingerprints: [fingerprint],
      }],
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => (
      String(input) === "/maps/catalog.json"
        ? jsonResponse(catalog)
        : new Response(JSON.stringify(definition), { status: 200 })
    ));
    const verifyLoadedDefinition = vi.fn(async (candidate: typeof definition) => candidate);
    const client = createMapRepositoryClient({
      parseDefinition: (source) => JSON.parse(source) as typeof definition,
      verifyLoadedDefinition,
      validateSaveResponse: (value) => value as never,
    }, fetcher);

    await expect(client.loadCatalog()).resolves.toEqual(catalog);
    await expect(client.loadDefinition("test-map", fingerprint)).resolves.toEqual(definition);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(String(fetcher.mock.calls[1]![0])).toBe(`/maps/v1/test-map/${fingerprint}.map.json`);
    expect(verifyLoadedDefinition).toHaveBeenCalledWith(definition, {
      mapId: "test-map",
      contentFingerprint: fingerprint,
    });
  });

  it("posts only the validated semantic envelope and validates the trusted response", async () => {
    const saveResponse = {
      changed: true,
      created: false,
      catalogRevision: 4,
      mapRepositoryRevision: 3,
      currentFingerprint: fingerprint,
      retainedFingerprints: [fingerprint],
      definition,
      definitionUrl: `/maps/v1/test-map/${fingerprint}.map.json`,
    };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      jsonResponse({ ok: true, ...saveResponse })
    ));
    const validateSaveResponse = vi.fn((value: unknown) => value as typeof saveResponse);
    const client = createMapRepositoryClient({
      parseDefinition: () => definition,
      verifyLoadedDefinition: async (candidate) => candidate,
      validateSaveResponse,
    }, fetcher);

    await expect(client.save({
      formatVersion: 1,
      mapId: "test-map",
      expectedCatalogRevision: 3,
      expectedMapRepositoryRevision: 2,
      definition,
    })).resolves.toEqual(saveResponse);
    const request = fetcher.mock.calls[0]![1]!;
    expect(fetcher.mock.calls[0]![0]).toBe("/__wayfinders/maps/save");
    expect(request).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(request.body))).toEqual({
      formatVersion: 1,
      mapId: "test-map",
      expectedCatalogRevision: 3,
      expectedMapRepositoryRevision: 2,
      definition,
    });
    expect(validateSaveResponse).toHaveBeenCalledWith(saveResponse);
  });

  it("preserves stale and semantic failures as typed errors without changing client state", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      ok: false,
      error: { code: "map-revision-conflict", message: "Map revision is stale" },
    }, 409));
    const client = createMapRepositoryClient({
      parseDefinition: () => definition,
      verifyLoadedDefinition: async (candidate) => candidate,
      validateSaveResponse: (value) => value as never,
    }, fetcher);

    const error = await client.save({
      formatVersion: 1,
      mapId: "test-map",
      expectedCatalogRevision: 1,
      definition,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(MapRepositoryRequestError);
    expect(error).toMatchObject({ message: "Map revision is stale", status: 409, stale: true, invalid: false });
  });
});
