import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  productionManifestFingerprint,
  runProductionPromotion,
} from "../scripts/production-asset-promotion.mjs";
import {
  PRODUCTION_PREPARATION_PIPELINE_VERSION,
  canonicalJson,
} from "../scripts/production-asset-pipeline.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function createRepository(decision = "approved") {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-production-promotion-"));
  roots.push(root);
  const id = "production.island.test-cay";
  const candidateBytes = Buffer.from("prepared candidate image");
  const thumbnailBytes = Buffer.from("prepared thumbnail");
  const sourceBytes = Buffer.from("source");
  const sourceFile = "assets-src/gr1/test-cay-source.png";
  const candidateDirectory = "assets-src/gr3/candidates/production-island-test-cay";
  const layerFile = `${candidateDirectory}/base.png`;
  const thumbnailFile = `${candidateDirectory}/thumbnail.png`;
  const collisionDraftFile = `${candidateDirectory}/collision-draft.json`;
  const reportFile = `${candidateDirectory}/preparation-report.json`;
  const manifest = {
    formatVersion: 1,
    recipes: [{
      id,
      name: "Test Cay",
      family: "island",
      lifecycle: "source",
      collection: "Test sources",
      sortOrder: 1,
      tags: ["island", "test"],
      provenance: { kind: "selected-source", sourceFile },
      layers: [{
        id: "base",
        name: "Base island",
        role: "base",
        sourceFile,
        defaultVisible: true,
        opacity: 1,
        blendMode: "normal",
        preparation: {
          mode: "connected-border",
          targetWidth: 32,
          targetHeight: 32,
          thumbnailMaximum: 32,
          matteColor: [255, 0, 255],
          innerTolerance: 48,
          outerTolerance: 104,
          trimAlphaThreshold: 8,
          padding: 0,
        },
      }],
      animations: [],
      collision: { mode: "blank-draft", tileSize: 32, subcellSize: 8 },
      runtimeBinding: { assetId: "home.island.primary", collisionIntent: "preserve" },
    }],
  };
  const recipeHash = sha256(Buffer.from(canonicalJson(manifest.recipes[0]), "utf8"));
  const sourceHashes = [{ layerId: "base", file: sourceFile, sha256: sha256(sourceBytes) }];
  const jobKey = sha256(Buffer.from(canonicalJson({
    pipelineVersion: PRODUCTION_PREPARATION_PIPELINE_VERSION,
    recipeHash,
    sourceHashes,
  }), "utf8"));
  const index = {
    formatVersion: 1,
    pipelineVersion: PRODUCTION_PREPARATION_PIPELINE_VERSION,
    manifestSha256: productionManifestFingerprint(manifest),
    entries: [{
      id,
      family: "island",
      lifecycle: "candidate",
      jobKey,
      sourceFiles: [sourceFile],
      layers: [{
        id: "base",
        file: layerFile,
        width: 32,
        height: 32,
        sha256: sha256(candidateBytes),
      }],
      thumbnailFile,
      collisionDraftFile,
      runtimeBinding: { assetId: "home.island.primary", collisionIntent: "preserve" },
    }],
  };
  const reviews = {
    formatVersion: 1,
    decisions: decision === "pending" ? [] : [{
      recipeId: id,
      candidateFingerprint: jobKey,
      decision,
    }],
  };
  const collisionDraft = {
    formatVersion: 1,
    recipeId: id,
    candidateFingerprint: jobKey,
    kind: "hybrid-grid-draft",
    tileSize: 32,
    subcellSize: 8,
    solidSubcells: [],
  };
  const collisionBytes = Buffer.from(`${JSON.stringify(collisionDraft, null, 2)}\n`);
  const report = {
    formatVersion: 1,
    pipelineVersion: PRODUCTION_PREPARATION_PIPELINE_VERSION,
    recipeId: id,
    family: "island",
    lifecycle: "candidate",
    jobKey,
    recipeHash,
    sources: sourceHashes,
    outputs: {
      layers: [{ id: "base", file: layerFile, sha256: sha256(candidateBytes) }],
      thumbnail: { file: thumbnailFile, sha256: sha256(thumbnailBytes) },
      collisionDraft: { file: collisionDraftFile, sha256: sha256(collisionBytes) },
    },
  };

  await Promise.all([
    writeJson(path.join(root, "assets-src/gr3/production-recipes.json"), manifest),
    writeJson(path.join(root, "assets-src/gr3/generated/production-index.json"), index),
    writeJson(path.join(root, "assets-src/gr3/reviews.json"), reviews),
    writeJson(path.join(root, collisionDraftFile), collisionDraft),
    writeJson(path.join(root, reportFile), report),
  ]);
  await Promise.all([
    mkdir(path.dirname(path.join(root, sourceFile)), { recursive: true }),
    mkdir(path.dirname(path.join(root, layerFile)), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, sourceFile), sourceBytes),
    writeFile(path.join(root, layerFile), candidateBytes),
    writeFile(path.join(root, thumbnailFile), thumbnailBytes),
  ]);
  return { root, id, jobKey, candidateBytes, sourceFile, sourceBytes, collisionBytes };
}

describe("GR-3.4 production promotion", () => {
  it("publishes only an exactly approved candidate with preserved runtime collision lineage", async () => {
    const {
      root,
      id,
      jobKey,
      candidateBytes,
      sourceFile,
      sourceBytes,
      collisionBytes,
    } = await createRepository("approved");
    const summary = await runProductionPromotion("promote", { repositoryRoot: root, selectedId: id });
    expect(summary.counts).toEqual({
      candidates: 1,
      approved: 1,
      rejected: 0,
      pending: 0,
      published: 1,
    });
    expect(summary.budgets.passed).toBe(true);

    const publicDirectory = path.join(root, "public/assets/gr3/production/production-island-test-cay");
    expect(await readFile(path.join(publicDirectory, "base.png"))).toEqual(candidateBytes);
    const publicManifest = JSON.parse(await readFile(
      path.join(root, "public/assets/gr3/production/production-assets.json"),
      "utf8",
    ));
    expect(publicManifest.entries[0]).toMatchObject({
      id,
      candidateFingerprint: jobKey,
      sources: [{ file: sourceFile, sha256: sha256(sourceBytes) }],
      runtimeBinding: { assetId: "home.island.primary", collisionIntent: "preserve" },
      collision: {
        mode: "preserve-runtime",
        runtimeAssetId: "home.island.primary",
        candidateDraftSha256: sha256(collisionBytes),
        candidateDraftPromoted: false,
      },
    });
    await expect(runProductionPromotion("check", { repositoryRoot: root })).resolves.toMatchObject({
      counts: { published: 1 },
    });
  });

  it("keeps pending and rejected candidates out of public production output", async () => {
    const pending = await createRepository("pending");
    await expect(runProductionPromotion("promote", {
      repositoryRoot: pending.root,
      selectedId: pending.id,
    })).rejects.toThrow(/must be approved/);
    const summary = await runProductionPromotion("promote", { repositoryRoot: pending.root });
    expect(summary.counts).toMatchObject({ pending: 1, published: 0 });

    const rejected = await createRepository("rejected");
    const rejectedSummary = await runProductionPromotion("promote", { repositoryRoot: rejected.root });
    expect(rejectedSummary.counts).toMatchObject({ rejected: 1, published: 0 });
  });

  it("rejects stale reviews and detects modified public output", async () => {
    const { root, jobKey, candidateBytes } = await createRepository("approved");
    const reviewsPath = path.join(root, "assets-src/gr3/reviews.json");
    const reviews = JSON.parse(await readFile(reviewsPath, "utf8"));
    reviews.decisions[0].candidateFingerprint = "b".repeat(64);
    await writeJson(reviewsPath, reviews);
    await expect(runProductionPromotion("promote", { repositoryRoot: root })).rejects.toThrow(/stale/);

    reviews.decisions[0].candidateFingerprint = jobKey;
    await writeJson(reviewsPath, reviews);
    await runProductionPromotion("promote", { repositoryRoot: root });
    const publicLayer = path.join(
      root,
      "public/assets/gr3/production/production-island-test-cay/base.png",
    );
    await writeFile(publicLayer, Buffer.concat([candidateBytes, Buffer.from("stale")]));
    await expect(runProductionPromotion("check", { repositoryRoot: root }))
      .rejects.toThrow(/base.png is stale/);
  });

  it("rejects an old report even if an index is re-stamped for a changed recipe manifest", async () => {
    const { root } = await createRepository("approved");
    const manifestPath = path.join(root, "assets-src/gr3/production-recipes.json");
    const indexPath = path.join(root, "assets-src/gr3/generated/production-index.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.recipes[0].layers[0].preparation.targetWidth = 64;
    await writeJson(manifestPath, manifest);
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    index.manifestSha256 = productionManifestFingerprint(manifest);
    await writeJson(indexPath, index);

    await expect(runProductionPromotion("promote", { repositoryRoot: root }))
      .rejects.toThrow(/stale for its current recipe/);
  });

  it("removes orphaned public files on the next promotion and rejects them in check mode", async () => {
    const { root } = await createRepository("approved");
    await runProductionPromotion("promote", { repositoryRoot: root });
    const orphan = path.join(root, "public/assets/gr3/production/stale.png");
    await writeFile(orphan, "stale");
    await expect(runProductionPromotion("check", { repositoryRoot: root }))
      .rejects.toThrow(/Stale public production output/);
    await runProductionPromotion("promote", { repositoryRoot: root });
    await expect(readFile(orphan)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
