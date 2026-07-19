import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CloudAssetAuthoringError,
  createCloudAssetAuthoringService,
} from "../scripts/cloud-asset-authoring.mjs";
import { commitAtomicFileTransaction } from "../scripts/repository-collision-transaction.mjs";
import {
  CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
  cloudAssetAuthoringSettingsFromPackage,
} from "../src/wayfinders/assets/CloudAssetAuthoring.ts";
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
    formatVersion: CLOUD_ASSET_AUTHORING_FORMAT_VERSION,
    assetId: "presentation.clouds.primary",
    runtimeRevision: cloudPackage.runtimeRevision,
    variantId,
  };
}

function settings(cloudPackage) {
  return JSON.parse(JSON.stringify(cloudAssetAuthoringSettingsFromPackage(cloudPackage)));
}

function saveRequest(cloudPackage, variantId, activeInGame, authoredSettings = settings(cloudPackage)) {
  return {
    ...identity(cloudPackage, variantId),
    activeInGame,
    settings: authoredSettings,
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

    const saved = await service.save(saveRequest(initial, variant.id, activeInGame));
    expect(saved).toMatchObject({
      assetId: initial.assetId,
      variantId: variant.id,
      activeInGame,
      changed: true,
      availabilityChanged: true,
      settingsChanged: false,
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
    const noOp = await service.save(saveRequest(written, variant.id, activeInGame));
    expect(noOp).toMatchObject({
      variantId: variant.id,
      activeInGame,
      changed: false,
      availabilityChanged: false,
      settingsChanged: false,
      previousRuntimeRevision: written.runtimeRevision,
      runtimeRevision: written.runtimeRevision,
    });
    expect(await readFile(packagePath, "utf8")).toBe(beforeNoOp);
  });

  it("persists settings-only and combined saves atomically while preserving non-editable presentation", async () => {
    const { root, packagePath } = await repository();
    const initial = await readPackage(packagePath);
    const variant = initial.variants.find((entry) => entry !== null);
    const service = createCloudAssetAuthoringService({ repositoryRoot: root });
    const authoredSettings = settings(initial);
    authoredSettings.candidatesPerChunk = 9;
    authoredSettings.chunkDensity = 0.55;
    authoredSettings.shadow.offsetPixels = { x: 72, y: 60 };

    const settingsOnly = await service.save(saveRequest(
      initial,
      variant.id,
      variant.activeInGame,
      authoredSettings,
    ));
    expect(settingsOnly).toMatchObject({
      activeInGame: variant.activeInGame,
      settings: authoredSettings,
      changed: true,
      availabilityChanged: false,
      settingsChanged: true,
      previousRuntimeRevision: initial.runtimeRevision,
      runtimeRevision: initial.runtimeRevision + 1,
    });
    const afterSettings = await readPackage(packagePath);
    expect(afterSettings.variants).toEqual(initial.variants);
    expect(cloudAssetAuthoringSettingsFromPackage(afterSettings)).toEqual(authoredSettings);
    expect(afterSettings.presentation.depth).toBe(initial.presentation.depth);
    expect(afterSettings.presentation.cloudTintsRgb).toEqual(initial.presentation.cloudTintsRgb);
    expect(afterSettings.presentation.clearPaddingTiles).toBe(initial.presentation.clearPaddingTiles);
    expect(afterSettings.presentation.shadow.depth).toBe(initial.presentation.shadow.depth);
    expect(afterSettings.presentation.shadow.tintRgb).toEqual(initial.presentation.shadow.tintRgb);

    const combinedSettings = settings(afterSettings);
    combinedSettings.scale = { minimum: 0.3, maximum: 0.8 };
    const combined = await service.save(saveRequest(
      afterSettings,
      variant.id,
      !variant.activeInGame,
      combinedSettings,
    ));
    expect(combined).toMatchObject({
      activeInGame: !variant.activeInGame,
      changed: true,
      availabilityChanged: true,
      settingsChanged: true,
      previousRuntimeRevision: afterSettings.runtimeRevision,
      runtimeRevision: afterSettings.runtimeRevision + 1,
    });
    const afterCombined = await readPackage(packagePath);
    expect(afterCombined.runtimeRevision).toBe(initial.runtimeRevision + 2);
    expect(afterCombined.variants.find((entry) => entry?.id === variant.id)?.activeInGame)
      .toBe(!variant.activeInGame);
    expect(cloudAssetAuthoringSettingsFromPackage(afterCombined)).toEqual(combinedSettings);
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

    await expect(service.save({
      ...stale,
      activeInGame: !variant.activeInGame,
      settings: settings(initial),
    }))
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
      ...saveRequest(initial, variant.id, !variant.activeInGame),
    })).rejects.toEqual(expect.objectContaining({
      name: CloudAssetAuthoringError.name,
      message: expect.stringMatching(/did not round-trip exactly/),
    }));
    expect(await readFile(packagePath, "utf8")).toBe(original);
  });
});
