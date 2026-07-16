import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodePng } from "../scripts/asset-pipeline.mjs";
import {
  createProductionAssetIntaker,
  ProductionAssetIntakeCancelledError,
} from "../scripts/production-asset-intake.mjs";
import { ProductionAssetIntakeValidationError } from "../src/wayfinders/assets/ProductionAssetIntake.ts";
import { validateProductionAssetRecipeManifest } from "../src/wayfinders/assets/ProductionAssetRecipe.ts";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-production-intake-"));
  roots.push(root);
  const gr3 = path.join(root, "assets-src", "gr3");
  await mkdir(path.join(gr3, "generated"), { recursive: true });
  await writeFile(path.join(gr3, "production-recipes.json"), `${JSON.stringify({ formatVersion: 1, recipes: [] }, null, 2)}\n`);
  await writeFile(path.join(gr3, "generated", "production-index.json"), "baseline index\n");
  return root;
}

function png() {
  const pixels = Buffer.alloc(32 * 32 * 4, 255);
  return encodePng(32, 32, pixels);
}

function request(id = "production.island.test-cay") {
  return {
    formatVersion: 1,
    source: { kind: "upload", fileName: "test-cay.png", pngBase64: png().toString("base64") },
    name: "Test Cay",
    id,
    idConfirmed: true,
    family: "island",
    targetWidth: 32,
    targetHeight: 32,
    layerRole: "base",
    collisionSemantics: "solid",
    runtimeCategory: "home-island",
  };
}

async function missing(filename) {
  await expect(stat(filename)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("GR-3.5 repository intake transaction", () => {
  it("persists one source recipe and prepared candidate across a fresh manifest read", async () => {
    const root = await repository();
    const phases = [];
    const prepareRecipe = async (recipe) => {
      const candidate = path.join(root, "assets-src", "gr3", "candidates", recipe.id.replaceAll(".", "-"));
      await mkdir(candidate, { recursive: true });
      await writeFile(path.join(candidate, "preparation-report.json"), `${JSON.stringify({ recipeId: recipe.id })}\n`);
    };
    const intake = createProductionAssetIntaker({ repositoryRoot: root, prepareRecipe });

    await expect(intake(request(), { onProgress: (phase) => phases.push(phase) })).resolves.toMatchObject({
      recipeId: "production.island.test-cay",
    });
    const manifest = validateProductionAssetRecipeManifest(JSON.parse(
      await readFile(path.join(root, "assets-src", "gr3", "production-recipes.json"), "utf8"),
    ));
    expect(manifest.recipes).toHaveLength(1);
    expect(manifest.recipes[0]).toMatchObject({
      id: "production.island.test-cay",
      lifecycle: "source",
      provenance: { sourceFile: "assets-src/gr3/intake/production-island-test-cay-source.png" },
      collision: { mode: "blank-draft" },
    });
    expect(phases).toEqual(["validating", "writing", "preparing", "completed"]);
    expect(await readFile(path.join(root, manifest.recipes[0].provenance.sourceFile))).toEqual(png());
  });

  it("rejects re-import without changing the original identity or source", async () => {
    const root = await repository();
    const intake = createProductionAssetIntaker({ repositoryRoot: root, prepareRecipe: async () => undefined });
    await intake(request());
    const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
    const before = await readFile(manifestPath);

    await expect(intake(request())).rejects.toMatchObject({
      fieldErrors: { id: expect.stringMatching(/already exists/u) },
    });
    expect(await readFile(manifestPath)).toEqual(before);
  });

  it("removes source, recipe, candidate, and index changes after preparation failure", async () => {
    const root = await repository();
    const id = "production.island.failed-cay";
    const candidate = path.join(root, "assets-src", "gr3", "candidates", id.replaceAll(".", "-"));
    const index = path.join(root, "assets-src", "gr3", "generated", "production-index.json");
    const intake = createProductionAssetIntaker({
      repositoryRoot: root,
      prepareRecipe: async () => {
        await mkdir(candidate, { recursive: true });
        await writeFile(path.join(candidate, "partial.png"), "partial");
        await writeFile(index, "partial index\n");
        throw new Error("synthetic preparation failure");
      },
    });

    await expect(intake(request(id))).rejects.toThrow("synthetic preparation failure");
    const manifest = JSON.parse(await readFile(path.join(root, "assets-src", "gr3", "production-recipes.json"), "utf8"));
    expect(manifest.recipes).toEqual([]);
    expect(await readFile(index, "utf8")).toBe("baseline index\n");
    await missing(path.join(root, "assets-src", "gr3", "intake", `${id.replaceAll(".", "-")}-source.png`));
    await missing(candidate);
  });

  it("honors cancellation before repository mutation", async () => {
    const root = await repository();
    const controller = new AbortController();
    controller.abort();
    const intake = createProductionAssetIntaker({ repositoryRoot: root, prepareRecipe: async () => undefined });
    await expect(intake(request(), { signal: controller.signal })).rejects.toBeInstanceOf(
      ProductionAssetIntakeCancelledError,
    );
    const manifest = JSON.parse(await readFile(path.join(root, "assets-src", "gr3", "production-recipes.json"), "utf8"));
    expect(manifest.recipes).toEqual([]);
  });

  it("rolls back a cancellation requested while preparation is active", async () => {
    const root = await repository();
    const controller = new AbortController();
    const id = "production.island.cancelled-cay";
    const candidate = path.join(root, "assets-src", "gr3", "candidates", id.replaceAll(".", "-"));
    const intake = createProductionAssetIntaker({
      repositoryRoot: root,
      prepareRecipe: async () => {
        await mkdir(candidate, { recursive: true });
        await writeFile(path.join(candidate, "partial.png"), "partial");
        controller.abort();
      },
    });
    await expect(intake(request(id), { signal: controller.signal })).rejects.toBeInstanceOf(
      ProductionAssetIntakeCancelledError,
    );
    const manifest = JSON.parse(await readFile(path.join(root, "assets-src", "gr3", "production-recipes.json"), "utf8"));
    expect(manifest.recipes).toEqual([]);
    await missing(candidate);
    await missing(path.join(root, "assets-src", "gr3", "intake", `${id.replaceAll(".", "-")}-source.png`));
  });

  it("reports malformed PNGs as a recoverable source-field error", async () => {
    const root = await repository();
    const intake = createProductionAssetIntaker({ repositoryRoot: root, prepareRecipe: async () => undefined });
    await expect(intake({
      ...request(),
      source: { kind: "upload", fileName: "bad.png", pngBase64: Buffer.from("not png").toString("base64") },
    })).rejects.toBeInstanceOf(ProductionAssetIntakeValidationError);
  });
});
