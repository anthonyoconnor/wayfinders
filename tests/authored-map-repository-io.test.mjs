import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AuthoredMapRepositoryConflictError,
  AuthoredMapRepositoryValidationError,
  createAuthoredMapRepositoryService,
  definitionFilePath,
} from "../scripts/authored-map-repository.mjs";
import { checkAuthoredMapRepository } from "../scripts/authored-map-repository-check.mjs";
import { commitAtomicFileTransaction } from "../scripts/repository-collision-transaction.mjs";
import {
  EMPTY_AUTHORED_MAP_CATALOG_V1,
  serializeAuthoredMapCatalogV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapRepositoryContracts.ts";

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);
const FINGERPRINT_C = "c".repeat(64);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRepository(catalog = EMPTY_AUTHORED_MAP_CATALOG_V1) {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-authored-maps-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "public", "maps"), { recursive: true });
  await writeFile(
    path.join(root, "public", "maps", "catalog.json"),
    serializeAuthoredMapCatalogV1(catalog),
    "utf8",
  );
  return root;
}

function definition(id, displayName, contentFingerprint, payload = "payload") {
  return { id, displayName, contentFingerprint, payload };
}

function request(definitionValue, expectedCatalogRevision, expectedMapRepositoryRevision) {
  return {
    formatVersion: 1,
    mapId: definitionValue.id,
    expectedCatalogRevision,
    ...(expectedMapRepositoryRevision === undefined ? {} : { expectedMapRepositoryRevision }),
    definition: definitionValue,
  };
}

function fakeDependencies(overrides = {}) {
  return {
    readIslandCatalog: async () => ({ revision: "fresh", islands: [] }),
    parseDefinition: async (source) => JSON.parse(Buffer.from(source).toString("utf8")),
    serializeDefinition: (value) => `${JSON.stringify(value, null, 2)}\n`,
    fingerprintDefinition: async (value) => value.contentFingerprint,
    compileDefinition: async () => ({ ok: true, value: {} }),
    ...overrides,
  };
}

async function catalogAt(root) {
  return JSON.parse(await readFile(path.join(root, "public", "maps", "catalog.json"), "utf8"));
}

describe("authored map repository service", () => {
  it("creates, reopens, updates, and preserves unrelated immutable revisions", async () => {
    const root = await temporaryRepository();
    const service = createAuthoredMapRepositoryService({
      repositoryRoot: root,
      ...fakeDependencies(),
    });
    const alphaA = definition("alpha", "Alpha", FINGERPRINT_A, "one");
    const created = await service.save(request(alphaA, 0));
    expect(created).toMatchObject({
      changed: true,
      created: true,
      catalogRevision: 1,
      mapRepositoryRevision: 1,
      currentFingerprint: FINGERPRINT_A,
      definitionUrl: `/maps/v1/alpha/${FINGERPRINT_A}.map.json`,
    });
    expect(await readFile(definitionFilePath(root, "alpha", FINGERPRINT_A), "utf8"))
      .toBe(`${JSON.stringify(alphaA, null, 2)}\n`);

    const beforeNoOpCatalog = await readFile(service.catalogPath);
    const beforeNoOpDefinition = await readFile(definitionFilePath(root, "alpha", FINGERPRINT_A));
    const noOp = await service.save(request(alphaA, 1, 1));
    expect(noOp).toMatchObject({ changed: false, created: false, catalogRevision: 1, mapRepositoryRevision: 1 });
    expect(await readFile(service.catalogPath)).toEqual(beforeNoOpCatalog);
    expect(await readFile(definitionFilePath(root, "alpha", FINGERPRINT_A))).toEqual(beforeNoOpDefinition);

    const alphaB = definition("alpha", "Alpha renamed", FINGERPRINT_B, "two");
    const updated = await service.save(request(alphaB, 1, 1));
    expect(updated).toMatchObject({ changed: true, created: false, catalogRevision: 2, mapRepositoryRevision: 2 });
    expect(updated.retainedFingerprints).toEqual([FINGERPRINT_A, FINGERPRINT_B]);

    const beta = definition("beta", "Beta", FINGERPRINT_C, "three");
    await service.save(request(beta, 2));
    expect(await catalogAt(root)).toEqual({
      formatVersion: 1,
      catalogRevision: 3,
      maps: [
        {
          id: "alpha",
          displayName: "Alpha renamed",
          mapRepositoryRevision: 2,
          currentFingerprint: FINGERPRINT_B,
          retainedFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
        },
        {
          id: "beta",
          displayName: "Beta",
          mapRepositoryRevision: 1,
          currentFingerprint: FINGERPRINT_C,
          retainedFingerprints: [FINGERPRINT_C],
        },
      ],
    });
    expect(await readFile(definitionFilePath(root, "alpha", FINGERPRINT_A), "utf8"))
      .toBe(`${JSON.stringify(alphaA, null, 2)}\n`);
  });

  it("rejects stale catalog tokens, stale map tokens, and create races independently", async () => {
    const root = await temporaryRepository();
    const service = createAuthoredMapRepositoryService({ repositoryRoot: root, ...fakeDependencies() });
    const alpha = definition("alpha", "Alpha", FINGERPRINT_A);
    await service.save(request(alpha, 0));

    await expect(service.save(request({ ...alpha, contentFingerprint: FINGERPRINT_B }, 0, 1)))
      .rejects.toMatchObject({
        name: AuthoredMapRepositoryConflictError.name,
        code: "catalog-revision-conflict",
        details: { currentCatalogRevision: 1 },
      });
    await expect(service.save(request({ ...alpha, contentFingerprint: FINGERPRINT_B }, 1, 2)))
      .rejects.toMatchObject({
        name: AuthoredMapRepositoryConflictError.name,
        code: "map-revision-conflict",
        details: { currentMapRepositoryRevision: 1 },
      });
    await expect(service.save(request(alpha, 1)))
      .rejects.toMatchObject({ name: AuthoredMapRepositoryConflictError.name, code: "map-already-exists" });
  });

  it("serializes concurrent creates so only one claimant can publish a stable map ID", async () => {
    const root = await temporaryRepository();
    const service = createAuthoredMapRepositoryService({ repositoryRoot: root, ...fakeDependencies() });
    const results = await Promise.allSettled([
      service.save(request(definition("alpha", "First", FINGERPRINT_A), 0)),
      service.save(request(definition("alpha", "Second", FINGERPRINT_B), 0)),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected?.reason).toMatchObject({
      name: AuthoredMapRepositoryConflictError.name,
      code: "catalog-revision-conflict",
    });
    const catalog = await catalogAt(root);
    expect(catalog).toMatchObject({ catalogRevision: 1, maps: [{ id: "alpha", mapRepositoryRevision: 1 }] });
  });

  it("commits a new immutable definition before the catalog and rolls both back after late failure", async () => {
    const root = await temporaryRepository();
    const observedOrders = [];
    const readerSnapshots = [];
    const service = createAuthoredMapRepositoryService({
      repositoryRoot: root,
      ...fakeDependencies(),
      commitTransaction: async (changes, verify) => {
        observedOrders.push(changes.map(({ targetPath }) => path.relative(root, targetPath).replaceAll("\\", "/")));
        await commitAtomicFileTransaction(changes, async () => {
          await verify();
          throw new Error("late verification failed");
        }, {
          replaceFile: async (source, target, phase) => {
            await rename(source, target);
            if (phase === "commit" && target.endsWith(".map.json")) {
              readerSnapshots.push({
                definition: await readFile(target, "utf8"),
                catalogRevision: (await catalogAt(root)).catalogRevision,
              });
            }
          },
        });
      },
    });
    const alpha = definition("alpha", "Alpha", FINGERPRINT_A);
    await expect(service.save(request(alpha, 0))).rejects.toThrow("late verification failed");
    expect(observedOrders).toEqual([[
      `public/maps/v1/alpha/${FINGERPRINT_A}.map.json`,
      "public/maps/catalog.json",
    ]]);
    expect(readerSnapshots).toEqual([{
      definition: `${JSON.stringify(alpha, null, 2)}\n`,
      catalogRevision: 0,
    }]);
    expect(await catalogAt(root)).toEqual(EMPTY_AUTHORED_MAP_CATALOG_V1);
    await expect(readFile(definitionFilePath(root, "alpha", FINGERPRINT_A)))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(checkAuthoredMapRepository(root, fakeDependencies())).resolves.toEqual({
      catalogRevision: 0,
      mapCount: 0,
      definitionCount: 0,
      currentHeadCount: 0,
    });
  });

  it("reuses identical retained content without rewriting it and rejects a mismatched immutable file", async () => {
    const catalog = {
      formatVersion: 1,
      catalogRevision: 5,
      maps: [{
        id: "alpha",
        displayName: "Alpha",
        mapRepositoryRevision: 7,
        currentFingerprint: FINGERPRINT_A,
        retainedFingerprints: [FINGERPRINT_A, FINGERPRINT_B],
      }],
    };
    const root = await temporaryRepository(catalog);
    const alphaA = definition("alpha", "Alpha", FINGERPRINT_A, "one");
    const alphaB = definition("alpha", "Alpha", FINGERPRINT_B, "two");
    await mkdir(path.dirname(definitionFilePath(root, "alpha", FINGERPRINT_A)), { recursive: true });
    await writeFile(definitionFilePath(root, "alpha", FINGERPRINT_A), `${JSON.stringify(alphaA, null, 2)}\n`);
    await writeFile(definitionFilePath(root, "alpha", FINGERPRINT_B), `${JSON.stringify(alphaB, null, 2)}\n`);
    const transactions = [];
    const service = createAuthoredMapRepositoryService({
      repositoryRoot: root,
      ...fakeDependencies(),
      commitTransaction: async (changes, verify) => {
        transactions.push(changes.map(({ targetPath }) => targetPath));
        await commitAtomicFileTransaction(changes, verify);
      },
    });
    const saved = await service.save(request(alphaB, 5, 7));
    expect(saved).toMatchObject({ catalogRevision: 6, mapRepositoryRevision: 8, currentFingerprint: FINGERPRINT_B });
    expect(transactions[0]).toEqual([service.catalogPath]);

    const corruptRoot = await temporaryRepository(catalog);
    await mkdir(path.dirname(definitionFilePath(corruptRoot, "alpha", FINGERPRINT_B)), { recursive: true });
    await writeFile(definitionFilePath(corruptRoot, "alpha", FINGERPRINT_B), "different bytes\n");
    const corruptService = createAuthoredMapRepositoryService({
      repositoryRoot: corruptRoot,
      ...fakeDependencies(),
    });
    await expect(corruptService.save(request(alphaB, 5, 7))).rejects.toMatchObject({
      name: AuthoredMapRepositoryValidationError.name,
      code: "immutable-map-mismatch",
    });
    expect((await catalogAt(corruptRoot)).catalogRevision).toBe(5);
  });

  it("re-reads fresh island state and recompiles every accepted save under the lock", async () => {
    const root = await temporaryRepository();
    let diskRevision = 0;
    const observed = [];
    const service = createAuthoredMapRepositoryService({
      repositoryRoot: root,
      ...fakeDependencies({
        readIslandCatalog: async () => ({ revision: `disk-${++diskRevision}`, islands: [] }),
        compileDefinition: async (_definition, { availableAuthoredIslandCatalog }) => {
          observed.push(availableAuthoredIslandCatalog.revision);
          return { ok: true, value: {} };
        },
      }),
    });
    await service.save(request(definition("alpha", "Alpha", FINGERPRINT_A), 0));
    await service.save(request(definition("alpha", "Alpha", FINGERPRINT_B), 1, 1));
    expect(observed).toEqual(["disk-1", "disk-2"]);
  });
});
