import { describe, expect, it, vi } from "vitest";
import {
  loadAuthoredMapSourceV1,
  serializeAuthoredMapCatalogV1,
  serializeAuthoredMapDefinitionV1,
} from "../src/wayfinders/app/authoredMaps";
import { createWorldProfileConfig } from "./fixtures/worldProfiles";
import {
  authoredMapTestCollisionCatalog,
  authoredMapTestPresentationCatalog,
  createValidAuthoredMapFixture,
} from "./fixtures/authoredMap";

describe("authored map runtime source loading", () => {
  it("loads an exact retained fingerprint and recompiles a fresh grid", async () => {
    const config = createWorldProfileConfig("P0");
    const fixture = await createValidAuthoredMapFixture(config);
    const catalog = serializeAuthoredMapCatalogV1({
      formatVersion: 1,
      catalogRevision: 7,
      maps: [{
        id: fixture.definition.id,
        displayName: fixture.definition.displayName,
        mapRepositoryRevision: 3,
        currentFingerprint: fixture.definition.contentFingerprint,
        retainedFingerprints: [fixture.definition.contentFingerprint],
      }],
    });
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => new Response(
      String(input).endsWith("catalog.json")
        ? catalog
        : serializeAuthoredMapDefinitionV1(fixture.definition),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const mutablePresentationCatalog = structuredClone(authoredMapTestPresentationCatalog());
    const source = await loadAuthoredMapSourceV1({
      kind: "authored-map",
      mapId: fixture.definition.id,
      contentFingerprint: fixture.definition.contentFingerprint,
    }, {
      config,
      availableCollisionCatalog: authoredMapTestCollisionCatalog(),
      availablePresentationCatalog: mutablePresentationCatalog,
      fetchImplementation,
    });

    expect(source.catalogRepositoryRevision).toBe(7);
    expect(source.compiled.sourceIdentity.contentFingerprint)
      .toBe(fixture.definition.contentFingerprint);
    expect(source.presentationCatalog.revision)
      .toBe(source.compiled.collisionCatalog.revision);
    expect(source.presentationCatalog.islands).toHaveLength(1);
    const originalPresentationUrl = source.presentationCatalog.islands[0]?.layers[0]?.url;
    (mutablePresentationCatalog.islands[0]!.layers[0]! as { url: string }).url =
      "/test/mutated-after-load.png";
    expect(source.presentationCatalog.islands[0]?.layers[0]?.url).toBe(originalPresentationUrl);
    expect(Object.isFrozen(source.presentationCatalog.islands[0]?.layers[0])).toBe(true);
    const restarted = source.compileFresh();
    expect(restarted.generated.grid).not.toBe(source.compiled.generated.grid);
    expect(restarted.generated.manifest).toEqual(source.compiled.generated.manifest);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);

    const tamperedDefinition = serializeAuthoredMapDefinitionV1({
      ...fixture.definition,
      displayName: "Tampered after fingerprinting",
    });
    await expect(loadAuthoredMapSourceV1({
      kind: "authored-map",
      mapId: fixture.definition.id,
      contentFingerprint: fixture.definition.contentFingerprint,
    }, {
      config,
      availableCollisionCatalog: authoredMapTestCollisionCatalog(),
      availablePresentationCatalog: authoredMapTestPresentationCatalog(),
      fetchImplementation: async (input) => new Response(
        String(input).endsWith("catalog.json") ? catalog : tamperedDefinition,
        { status: 200 },
      ),
    })).rejects.toThrow(/bytes do not produce fingerprint/u);

    await expect(loadAuthoredMapSourceV1({
      kind: "authored-map",
      mapId: fixture.definition.id,
      contentFingerprint: fixture.definition.contentFingerprint,
    }, {
      config,
      availableCollisionCatalog: authoredMapTestCollisionCatalog(),
      availablePresentationCatalog: authoredMapTestPresentationCatalog(),
      fetchImplementation: async (input) => new Response(
        String(input).endsWith("catalog.json")
          ? catalog
          : serializeAuthoredMapDefinitionV1(fixture.definition).trimEnd(),
        { status: 200 },
      ),
    })).rejects.toThrow(/definition is not in canonical repository form/u);

    await expect(loadAuthoredMapSourceV1({
      kind: "authored-map",
      mapId: fixture.definition.id,
      contentFingerprint: fixture.definition.contentFingerprint,
    }, {
      config,
      availableCollisionCatalog: authoredMapTestCollisionCatalog(),
      availablePresentationCatalog: authoredMapTestPresentationCatalog(),
      fetchImplementation: async () => new Response(catalog.trimEnd(), { status: 200 }),
    })).rejects.toThrow(/catalog is not in canonical repository form/u);
  }, 15_000);

  it("fails closed when an explicit fingerprint is not retained", async () => {
    const config = createWorldProfileConfig("P0");
    const fixture = await createValidAuthoredMapFixture(config);
    const catalog = serializeAuthoredMapCatalogV1({
      formatVersion: 1,
      catalogRevision: 1,
      maps: [{
        id: fixture.definition.id,
        displayName: fixture.definition.displayName,
        mapRepositoryRevision: 1,
        currentFingerprint: fixture.definition.contentFingerprint,
        retainedFingerprints: [fixture.definition.contentFingerprint],
      }],
    });
    const unavailableFingerprint = "f".repeat(64);

    await expect(loadAuthoredMapSourceV1({
      kind: "authored-map",
      mapId: fixture.definition.id,
      contentFingerprint: unavailableFingerprint,
    }, {
      config,
      availableCollisionCatalog: authoredMapTestCollisionCatalog(),
      availablePresentationCatalog: authoredMapTestPresentationCatalog(),
      fetchImplementation: async () => new Response(catalog, { status: 200 }),
    })).rejects.toThrow(/does not retain fingerprint/u);
  });

  it("bounds catalog bytes before parsing an explicit source", async () => {
    const oversizedCatalog = new Uint8Array(4 * 1024 * 1024 + 1);
    await expect(loadAuthoredMapSourceV1({
      kind: "authored-map",
      mapId: "oversized-map",
      contentFingerprint: "a".repeat(64),
    }, {
      availableCollisionCatalog: authoredMapTestCollisionCatalog(),
      availablePresentationCatalog: authoredMapTestPresentationCatalog(),
      fetchImplementation: async () => new Response(oversizedCatalog, { status: 200 }),
    })).rejects.toThrow(/catalog exceeds the .*response safety bound/u);
  });
});
