import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodePng } from "../scripts/asset-pipeline.mjs";
import {
  createProductionCandidateAuthoringService,
  ProductionCandidateAuthoringError,
} from "../scripts/production-candidate-authoring.mjs";
import { validateProductionAssetRecipeManifest } from "../src/wayfinders/assets/ProductionAssetRecipe.ts";

const roots = [];
const recipeId = "production.island.test-cay";
const oldFingerprint = "a".repeat(64);
const newFingerprint = "b".repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function recipe() {
  return {
    id: recipeId,
    name: "Test Cay",
    family: "island",
    lifecycle: "source",
    collection: "Island production sources",
    sortOrder: 10,
    tags: ["island", "test-cay", "source"],
    provenance: {
      kind: "selected-source",
      sourceFile: "assets-src/gr3/intake/production-island-test-cay-source.png",
    },
    layers: [{
      id: "base",
      name: "Base",
      role: "base",
      sourceFile: "assets-src/gr3/intake/production-island-test-cay-source.png",
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
      preparation: { mode: "preserve", targetWidth: 64, targetHeight: 64, thumbnailMaximum: 192 },
    }],
    animations: [],
    collision: { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
    runtimeBinding: { assetId: "home.island.primary", collisionIntent: "preserve" },
  };
}

function collisionDraft(fingerprint, solidSubcells = [{ x: 0, y: 0 }]) {
  return {
    formatVersion: 1,
    recipeId,
    candidateFingerprint: fingerprint,
    kind: "hybrid-grid-draft",
    tileSize: 32,
    subcellSize: 8,
    grid: { width: 2, height: 2, subcellColumns: 8, subcellRows: 8 },
    solidSubcells,
  };
}

function index(fingerprint) {
  return {
    formatVersion: 1,
    entries: [{
      id: recipeId,
      jobKey: fingerprint,
      collisionDraftFile: "assets-src/gr3/candidates/production-island-test-cay/collision-draft.json",
    }],
  };
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-candidate-authoring-"));
  roots.push(root);
  const gr3 = path.join(root, "assets-src", "gr3");
  const candidate = path.join(gr3, "candidates", "production-island-test-cay");
  await mkdir(path.join(gr3, "generated"), { recursive: true });
  await mkdir(path.join(gr3, "intake"), { recursive: true });
  await mkdir(candidate, { recursive: true });
  await writeFile(path.join(gr3, "production-recipes.json"), `${JSON.stringify({
    formatVersion: 1,
    recipes: [recipe()],
  }, null, 2)}\n`);
  await writeFile(path.join(gr3, "generated", "production-index.json"), `${JSON.stringify(index(oldFingerprint), null, 2)}\n`);
  await writeFile(path.join(gr3, "reviews.json"), `${JSON.stringify({
    formatVersion: 1,
    decisions: [{ recipeId, candidateFingerprint: oldFingerprint, decision: "approved" }],
  }, null, 2)}\n`);
  await writeFile(path.join(gr3, "intake", "production-island-test-cay-source.png"), "source");
  await writeFile(path.join(candidate, "base.png"), "baseline layer");
  await writeFile(path.join(candidate, "collision-draft.json"), `${JSON.stringify(collisionDraft(oldFingerprint), null, 2)}\n`);
  return root;
}

function request(fingerprint = oldFingerprint) {
  return {
    formatVersion: 1,
    recipeId,
    candidateFingerprint: fingerprint,
    settings: {
      name: "Authored Test Cay",
      family: "island",
      targetWidth: 64,
      targetHeight: 64,
      layers: [{ id: "base", defaultVisible: false, opacity: 0.65 }],
      runtimeBindingAssetId: "home.island.primary",
      availableInGame: true,
    },
    collision: {
      kind: "hybrid-grid-draft",
      tileSize: 32,
      subcellSize: 8,
      grid: { width: 2, height: 2, subcellColumns: 8, subcellRows: 8 },
      solidSubcells: [{ x: 3, y: 2 }, { x: 1, y: 0 }],
    },
  };
}

function passableRequest(fingerprint = oldFingerprint) {
  return {
    ...request(fingerprint),
    settings: {
      ...request(fingerprint).settings,
      family: "shoal",
      targetWidth: 95,
      targetHeight: 61,
      availableInGame: false,
    },
    collision: {
      kind: "empty",
      passable: true,
      reason: "Interaction visual remains passable",
    },
  };
}

async function writePreparedCandidate(root, fingerprint, draft = request().collision) {
  const gr3 = path.join(root, "assets-src", "gr3");
  const candidate = path.join(gr3, "candidates", "production-island-test-cay");
  await writeFile(path.join(candidate, "base.png"), "refreshed layer");
  await writeFile(path.join(candidate, "collision-draft.json"), `${JSON.stringify({
    formatVersion: 1,
    recipeId,
    candidateFingerprint: fingerprint,
    ...draft,
  }, null, 2)}\n`);
  await writeFile(path.join(gr3, "generated", "production-index.json"), `${JSON.stringify(index(fingerprint), null, 2)}\n`);
}

async function missing(filename) {
  await expect(stat(filename)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("GR-3.7 production candidate repository authoring", () => {
  it("permanently deletes an imported island and all of its repository-owned files", async () => {
    const root = await repository();
    const gr3 = path.join(root, "assets-src", "gr3");
    const manifestPath = path.join(gr3, "production-recipes.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.recipes[0].collision = {
      mode: "mask-file",
      maskFile: "assets-src/gr3/candidate-masks/production-island-test-cay-mask.png",
      tileSize: 32,
      subcellSize: 8,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const maskPath = path.join(gr3, "candidate-masks", "production-island-test-cay-mask.png");
    await mkdir(path.dirname(maskPath), { recursive: true });
    await writeFile(maskPath, "mask");
    const candidateDirectory = path.join(gr3, "candidates", "production-island-test-cay");
    await writeFile(path.join(candidateDirectory, "preparation-report.json"), "report");
    const sourcePath = path.join(gr3, "intake", "production-island-test-cay-source.png");
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => undefined,
    });

    await expect(service.remove({
      formatVersion: 1,
      recipeId,
      candidateFingerprint: oldFingerprint,
    })).resolves.toMatchObject({
      recipeId,
      deletedFingerprint: oldFingerprint,
      message: "Test Cay was permanently deleted",
    });
    expect(JSON.parse(await readFile(manifestPath, "utf8")).recipes).toEqual([]);
    expect(JSON.parse(await readFile(path.join(gr3, "generated", "production-index.json"), "utf8")).entries)
      .toEqual([]);
    expect(JSON.parse(await readFile(path.join(gr3, "reviews.json"), "utf8")).decisions).toEqual([]);
    await Promise.all([candidateDirectory, sourcePath, maskPath].map(missing));
  });

  it("restores records and files when an imported-island deletion fails", async () => {
    const root = await repository();
    const gr3 = path.join(root, "assets-src", "gr3");
    const files = [
      path.join(gr3, "production-recipes.json"),
      path.join(gr3, "generated", "production-index.json"),
      path.join(gr3, "reviews.json"),
      path.join(gr3, "intake", "production-island-test-cay-source.png"),
      path.join(gr3, "candidates", "production-island-test-cay", "base.png"),
      path.join(gr3, "candidates", "production-island-test-cay", "collision-draft.json"),
    ];
    const before = new Map(await Promise.all(files.map(async (filename) => [filename, await readFile(filename)])));
    let removals = 0;
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => undefined,
      removePath: async (targetPath, options) => {
        removals++;
        if (removals === 2) throw new Error("synthetic delete failure");
        await rm(targetPath, options);
      },
    });

    await expect(service.remove({
      formatVersion: 1,
      recipeId,
      candidateFingerprint: oldFingerprint,
    })).rejects.toThrow("synthetic delete failure");
    for (const [filename, bytes] of before) expect(await readFile(filename), filename).toEqual(bytes);
  });

  it("rejects a stale deletion request before changing repository files", async () => {
    const root = await repository();
    const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
    const before = await readFile(manifestPath);
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => undefined,
    });

    await expect(service.remove({
      formatVersion: 1,
      recipeId,
      candidateFingerprint: newFingerprint,
    })).rejects.toThrow(/Stale candidate fingerprint/u);
    expect(await readFile(manifestPath)).toEqual(before);
  });

  it("persists island availability and an exact mask atomically without a review state", async () => {
    const root = await repository();
    const prepared = [];
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async (updated) => {
        prepared.push(updated);
        const mask = decodePng(
          await readFile(path.join(root, updated.collision.maskFile)),
          updated.collision.maskFile,
        );
        const alpha = (x, y) => mask.pixels[(y * mask.width + x) * 4 + 3];
        expect(alpha(8, 0)).toBe(255);
        expect(alpha(24, 16)).toBe(255);
        expect(alpha(0, 0)).toBe(0);
        await writePreparedCandidate(root, newFingerprint);
      },
    });

    const saved = await service.save(request());
    expect(saved).toMatchObject({
      recipeId,
      previousFingerprint: oldFingerprint,
      fingerprint: newFingerprint,
      validationState: "current",
      availableInGame: true,
      settings: { name: "Authored Test Cay" },
      collision: { solidSubcells: [{ x: 1, y: 0 }, { x: 3, y: 2 }] },
    });
    expect(prepared).toHaveLength(1);
    const manifest = validateProductionAssetRecipeManifest(JSON.parse(
      await readFile(path.join(root, "assets-src", "gr3", "production-recipes.json"), "utf8"),
    ));
    expect(manifest.recipes[0]).toMatchObject({
      name: "Authored Test Cay",
      layers: [{ defaultVisible: false, opacity: 0.65 }],
      collision: {
        mode: "mask-file",
        maskFile: "assets-src/gr3/candidate-masks/production-island-test-cay-mask.png",
      },
      availableInGame: true,
    });
    expect(JSON.parse(await readFile(path.join(root, "assets-src", "gr3", "reviews.json"), "utf8")))
      .toEqual({ formatVersion: 1, decisions: [] });
    await expect(service.validate({
      formatVersion: 1,
      recipeId,
      candidateFingerprint: newFingerprint,
    })).resolves.toMatchObject({ fingerprint: newFingerprint, availableInGame: true });
  });

  it("rejects a stale fingerprint before invoking preparation or changing repository files", async () => {
    const root = await repository();
    const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
    const before = await readFile(manifestPath);
    let prepares = 0;
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => { prepares++; },
    });
    await expect(service.save(request("c".repeat(64)))).rejects.toBeInstanceOf(ProductionCandidateAuthoringError);
    expect(prepares).toBe(0);
    expect(await readFile(manifestPath)).toEqual(before);
  });

  it("leaves an island unavailable when enabling it fails collision validation", async () => {
    const root = await repository();
    const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
    const before = await readFile(manifestPath);
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => undefined,
    });
    await expect(service.save({
      ...request(),
      collision: { ...request().collision, solidSubcells: [] },
    })).rejects.toThrow(/available island must contain saved solid collision/u);
    expect(await readFile(manifestPath)).toEqual(before);
  });

  it("rejects a duplicate island name before changing repository files", async () => {
    const root = await repository();
    const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.recipes.push({
      ...recipe(),
      id: "production.island.taken-name",
      name: "Taken Name",
      availableInGame: false,
      provenance: {
        ...recipe().provenance,
        sourceFile: "assets-src/gr3/intake/production-island-taken-name-source.png",
      },
      layers: recipe().layers.map((layer) => ({
        ...layer,
        sourceFile: "assets-src/gr3/intake/production-island-taken-name-source.png",
      })),
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await readFile(manifestPath);
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => undefined,
    });
    await expect(service.save({
      ...request(),
      settings: { ...request().settings, name: "taken name" },
    })).rejects.toThrow(/Duplicate production asset recipe name/u);
    expect(await readFile(manifestPath)).toEqual(before);
  });

  it("reports prepared-output drift as an actionable authoring error", async () => {
    const root = await repository();
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => { throw new Error("prepared layer is missing"); },
      prepareRecipe: async () => undefined,
    });

    await expect(service.validate({
      formatVersion: 1,
      recipeId,
      candidateFingerprint: oldFingerprint,
    })).rejects.toMatchObject({
      name: "ProductionCandidateAuthoringError",
      message: expect.stringMatching(/stale or invalid: prepared layer is missing/u),
    });
  });

  it("round-trips explicitly passable semantics and removes a superseded semantic mask", async () => {
    const root = await repository();
    const maskPath = path.join(
      root,
      "assets-src",
      "gr3",
      "candidate-masks",
      "production-island-test-cay-mask.png",
    );
    await mkdir(path.dirname(maskPath), { recursive: true });
    await writeFile(maskPath, "superseded mask");
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async (updated) => {
        expect(updated).toMatchObject({
          family: "shoal",
          collision: { mode: "empty", reason: "Interaction visual remains passable" },
          layers: [{ preparation: { targetWidth: 95, targetHeight: 61 } }],
        });
        await missing(maskPath);
        await writePreparedCandidate(root, newFingerprint, passableRequest().collision);
      },
    });

    await expect(service.save(passableRequest())).resolves.toMatchObject({
      previousFingerprint: oldFingerprint,
      fingerprint: newFingerprint,
      validationState: "current",
      settings: { family: "shoal", targetWidth: 95, targetHeight: 61 },
      collision: {
        kind: "empty",
        passable: true,
        reason: "Interaction visual remains passable",
      },
    });
    await missing(maskPath);
  });

  it("does not expose an obsolete island review state", async () => {
    const root = await repository();
    await writeFile(path.join(root, "assets-src", "gr3", "reviews.json"), `${JSON.stringify({
      formatVersion: 1,
      decisions: [{ recipeId, candidateFingerprint: newFingerprint, decision: "approved" }],
    }, null, 2)}\n`);
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => undefined,
    });

    await expect(service.validate({
      formatVersion: 1,
      recipeId,
      candidateFingerprint: oldFingerprint,
    })).resolves.toMatchObject({
      fingerprint: oldFingerprint,
      validationState: "current",
      availableInGame: false,
    });
  });

  it("rolls recipe, review, mask, candidate files and index back after preparation failure", async () => {
    const root = await repository();
    const gr3 = path.join(root, "assets-src", "gr3");
    const candidate = path.join(gr3, "candidates", "production-island-test-cay");
    const paths = {
      manifest: path.join(gr3, "production-recipes.json"),
      reviews: path.join(gr3, "reviews.json"),
      index: path.join(gr3, "generated", "production-index.json"),
      layer: path.join(candidate, "base.png"),
      collision: path.join(candidate, "collision-draft.json"),
    };
    const before = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, filename]) =>
      [key, await readFile(filename)])));
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => {
        await writePreparedCandidate(root, newFingerprint);
        await writeFile(path.join(candidate, "partial.tmp"), "partial");
        throw new Error("synthetic preparation failure");
      },
    });

    await expect(service.save(request())).rejects.toThrow("synthetic preparation failure");
    for (const [key, filename] of Object.entries(paths)) expect(await readFile(filename), key).toEqual(before[key]);
    await missing(path.join(candidate, "partial.tmp"));
    await missing(path.join(gr3, "candidate-masks", "production-island-test-cay-mask.png"));
  });

  it("rolls back when prepared collision does not round-trip exactly", async () => {
    const root = await repository();
    const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
    const before = await readFile(manifestPath);
    const service = createProductionCandidateAuthoringService({
      repositoryRoot: root,
      validateRecipe: async () => undefined,
      prepareRecipe: async () => writePreparedCandidate(root, newFingerprint, {
        ...request().collision,
        solidSubcells: [{ x: 7, y: 7 }],
      }),
    });
    await expect(service.save(request())).rejects.toThrow(/does not match/u);
    expect(await readFile(manifestPath)).toEqual(before);
  });
});
