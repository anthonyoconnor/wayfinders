import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CloudAssetAuthoringError,
  createCloudAssetAuthoringService,
} from "../scripts/cloud-asset-authoring.mjs";
import { commitAtomicFileTransaction } from "../scripts/repository-collision-transaction.mjs";
import { CLOUD_ASSET_PACKAGE } from "../src/wayfinders/assets/CloudAssetCatalog.ts";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function packageSnapshot() {
  return JSON.parse(JSON.stringify(CLOUD_ASSET_PACKAGE));
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-cloud-authoring-"));
  roots.push(root);
  const packagePath = path.join(
    root,
    "src",
    "wayfinders",
    "assets",
    "packages",
    "cloud-atmosphere.json",
  );
  await mkdir(path.dirname(packagePath), { recursive: true });
  await writeFile(packagePath, `${JSON.stringify(packageSnapshot(), null, 2)}\n`);
  return { root, packagePath };
}

async function readPackage(packagePath) {
  return JSON.parse(await readFile(packagePath, "utf8"));
}

function identity(cloudPackage, variantId) {
  return {
    formatVersion: 1,
    assetId: "presentation.clouds.primary",
    runtimeRevision: cloudPackage.runtimeRevision,
    variantId,
  };
}

describe("cloud asset repository authoring", () => {
  it("persists activation changes with one revision increment and leaves no-op saves byte-identical", async () => {
    const { root, packagePath } = await repository();
    const initial = await readPackage(packagePath);
    const index = initial.variants.findIndex((variant) => variant !== null);
    const variant = initial.variants[index];
    const activeInGame = !variant.activeInGame;
    const service = createCloudAssetAuthoringService({ repositoryRoot: root });

    const saved = await service.save({
      ...identity(initial, variant.id),
      activeInGame,
    });
    expect(saved).toMatchObject({
      assetId: initial.assetId,
      variantId: variant.id,
      activeInGame,
      changed: true,
      previousRuntimeRevision: initial.runtimeRevision,
      runtimeRevision: initial.runtimeRevision + 1,
    });
    const written = await readPackage(packagePath);
    const expectedVariants = [...initial.variants];
    expectedVariants[index] = { ...variant, activeInGame };
    expect(written).toEqual({
      ...initial,
      runtimeRevision: initial.runtimeRevision + 1,
      variants: expectedVariants,
    });

    const beforeNoOp = await readFile(packagePath, "utf8");
    const noOp = await service.save({
      ...identity(written, variant.id),
      activeInGame,
    });
    expect(noOp).toMatchObject({
      variantId: variant.id,
      activeInGame,
      changed: false,
      previousRuntimeRevision: written.runtimeRevision,
      runtimeRevision: written.runtimeRevision,
    });
    expect(await readFile(packagePath, "utf8")).toBe(beforeNoOp);
  });

  it("deletes one catalog entry as a fixed-slot tombstone", async () => {
    const { root, packagePath } = await repository();
    const initial = await readPackage(packagePath);
    const index = initial.variants.findIndex((variant) => variant !== null);
    const variant = initial.variants[index];
    const service = createCloudAssetAuthoringService({ repositoryRoot: root });

    const removed = await service.remove(identity(initial, variant.id));
    expect(removed).toMatchObject({
      assetId: initial.assetId,
      deletedVariantId: variant.id,
      previousRuntimeRevision: initial.runtimeRevision,
      runtimeRevision: initial.runtimeRevision + 1,
    });
    const written = await readPackage(packagePath);
    expect(written.runtimeRevision).toBe(initial.runtimeRevision + 1);
    expect(written.variants).toHaveLength(initial.variants.length);
    expect(written.variants[index]).toBeNull();
    expect(written.variants.filter((entry) => entry !== null)).toEqual(
      initial.variants.filter((_, slot) => slot !== index && initial.variants[slot] !== null),
    );
  });

  it("rejects stale and unknown variants without changing the package", async () => {
    const { root, packagePath } = await repository();
    const initial = await readPackage(packagePath);
    const variant = initial.variants.find((entry) => entry !== null);
    const original = await readFile(packagePath, "utf8");
    const service = createCloudAssetAuthoringService({ repositoryRoot: root });
    const stale = {
      ...identity(initial, variant.id),
      runtimeRevision: initial.runtimeRevision + 1,
    };

    await expect(service.save({ ...stale, activeInGame: !variant.activeInGame }))
      .rejects.toThrow(/Stale cloud package revision/);
    await expect(service.remove(stale)).rejects.toThrow(/Stale cloud package revision/);
    await expect(service.remove(identity(initial, "missing-cloud")))
      .rejects.toThrow(/Unknown cloud variant missing-cloud/);
    expect(await readFile(packagePath, "utf8")).toBe(original);
  });

  it("rolls the original package back when the authored value does not round-trip exactly", async () => {
    const { root, packagePath } = await repository();
    const initial = await readPackage(packagePath);
    const variant = initial.variants.find((entry) => entry !== null);
    const original = await readFile(packagePath, "utf8");
    const commitTransaction = async (changes, verify) => {
      const corrupted = JSON.parse(changes[0].bytes.toString("utf8"));
      const index = corrupted.variants.findIndex((entry) => entry?.id === variant.id);
      corrupted.variants[index] = { ...corrupted.variants[index], name: `${variant.name} altered` };
      await commitAtomicFileTransaction([{
        ...changes[0],
        bytes: Buffer.from(`${JSON.stringify(corrupted, null, 2)}\n`, "utf8"),
      }], verify);
    };
    const service = createCloudAssetAuthoringService({ repositoryRoot: root, commitTransaction });

    await expect(service.save({
      ...identity(initial, variant.id),
      activeInGame: !variant.activeInGame,
    })).rejects.toEqual(expect.objectContaining({
      name: CloudAssetAuthoringError.name,
      message: expect.stringMatching(/did not round-trip exactly/),
    }));
    expect(await readFile(packagePath, "utf8")).toBe(original);
  });
});
