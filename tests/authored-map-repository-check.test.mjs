import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkAuthoredMapRepository } from "../scripts/authored-map-repository-check.mjs";
import { serializeAuthoredMapCatalogV1 } from "../src/wayfinders/app/authoredMaps/AuthoredMapRepositoryContracts.ts";

const FINGERPRINT = "a".repeat(64);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function canonicalDefinition(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fakeDependencies(overrides = {}) {
  return {
    readIslandCatalog: async () => ({ revision: "fresh", islands: [] }),
    parseDefinition: async (source) => JSON.parse(Buffer.from(source).toString("utf8")),
    serializeDefinition: canonicalDefinition,
    fingerprintDefinition: async (value) => value.contentFingerprint,
    compileDefinition: async () => ({ ok: true, value: {} }),
    ...overrides,
  };
}

async function fixture({ withMap = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-authored-map-check-"));
  temporaryRoots.push(root);
  const mapsRoot = path.join(root, "public", "maps");
  await mkdir(mapsRoot, { recursive: true });
  const definition = {
    id: "alpha",
    displayName: "Alpha",
    contentFingerprint: FINGERPRINT,
    payload: "one",
  };
  const catalog = withMap ? {
    formatVersion: 1,
    catalogRevision: 1,
    maps: [{
      id: "alpha",
      displayName: "Alpha",
      mapRepositoryRevision: 1,
      currentFingerprint: FINGERPRINT,
      retainedFingerprints: [FINGERPRINT],
    }],
  } : { formatVersion: 1, catalogRevision: 0, maps: [] };
  await writeFile(path.join(mapsRoot, "catalog.json"), serializeAuthoredMapCatalogV1(catalog));
  if (withMap) {
    const definitionDirectory = path.join(mapsRoot, "v1", "alpha");
    await mkdir(definitionDirectory, { recursive: true });
    await writeFile(path.join(definitionDirectory, `${FINGERPRINT}.map.json`), canonicalDefinition(definition));
  }
  return { root, mapsRoot, definition, catalog };
}

describe("authored map repository checker", () => {
  it("accepts the checked-in empty catalog without consulting external asset state", async () => {
    const { root } = await fixture({ withMap: false });
    const result = await checkAuthoredMapRepository(root, fakeDependencies({
      readIslandCatalog: async () => { throw new Error("must not read assets for an empty catalog"); },
    }));
    expect(result).toEqual({ catalogRevision: 0, mapCount: 0, definitionCount: 0, currentHeadCount: 0 });
  });

  it("validates canonical retained revisions and compiles each current head against fresh assets", async () => {
    const { root } = await fixture();
    const observed = [];
    const result = await checkAuthoredMapRepository(root, fakeDependencies({
      readIslandCatalog: async () => ({ revision: "disk-current", islands: [] }),
      compileDefinition: async (definition, { availableAuthoredIslandCatalog }) => {
        observed.push([definition.id, availableAuthoredIslandCatalog.revision]);
        return { ok: true, value: {} };
      },
    }));
    expect(result).toEqual({ catalogRevision: 1, mapCount: 1, definitionCount: 1, currentHeadCount: 1 });
    expect(observed).toEqual([["alpha", "disk-current"]]);
  });

  it("rejects noncanonical catalogs, missing files, orphan files, bad hashes, and invalid current heads", async () => {
    const noncanonical = await fixture({ withMap: false });
    await writeFile(
      path.join(noncanonical.mapsRoot, "catalog.json"),
      JSON.stringify({ formatVersion: 1, catalogRevision: 0, maps: [] }),
    );
    await expect(checkAuthoredMapRepository(noncanonical.root, fakeDependencies()))
      .rejects.toThrow("catalog is not canonical");

    const missing = await fixture();
    await rm(path.join(missing.mapsRoot, "v1", "alpha", `${FINGERPRINT}.map.json`));
    await expect(checkAuthoredMapRepository(missing.root, fakeDependencies()))
      .rejects.toThrow("missing referenced file");

    const orphan = await fixture();
    await writeFile(path.join(orphan.mapsRoot, "unexpected.json"), "{}\n");
    await expect(checkAuthoredMapRepository(orphan.root, fakeDependencies()))
      .rejects.toThrow("unexpected entry unexpected.json");

    const badHash = await fixture();
    await expect(checkAuthoredMapRepository(badHash.root, fakeDependencies({
      fingerprintDefinition: async () => "b".repeat(64),
    }))).rejects.toThrow("hashes to");

    const invalidHead = await fixture();
    await expect(checkAuthoredMapRepository(invalidHead.root, fakeDependencies({
      compileDefinition: async () => ({
        ok: false,
        diagnostics: [{ code: "blocked", path: "$.world", message: "No global ocean" }],
      }),
    }))).rejects.toThrow("No global ocean");
  });

  it("rejects unsafe map directories and noncanonical immutable definition bytes", async () => {
    const unsafe = await fixture({ withMap: false });
    await mkdir(path.join(unsafe.mapsRoot, "v1", "..unsafe"), { recursive: true });
    await expect(checkAuthoredMapRepository(unsafe.root, fakeDependencies()))
      .rejects.toThrow("unsafe map directory");

    const emptyOrphanDirectory = await fixture({ withMap: false });
    await mkdir(path.join(emptyOrphanDirectory.mapsRoot, "v1", "orphan"), { recursive: true });
    await expect(checkAuthoredMapRepository(emptyOrphanDirectory.root, fakeDependencies()))
      .rejects.toThrow("unlisted map directory");

    const noncanonical = await fixture();
    const definitionPath = path.join(noncanonical.mapsRoot, "v1", "alpha", `${FINGERPRINT}.map.json`);
    await writeFile(definitionPath, JSON.stringify(noncanonical.definition));
    await expect(checkAuthoredMapRepository(noncanonical.root, fakeDependencies()))
      .rejects.toThrow("is not canonical");
  });
});
