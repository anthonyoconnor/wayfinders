import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readFreshAvailableAuthoredIslandCatalog } from "../scripts/authored-map-island-catalog.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function copyDiskCatalogFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-map-island-catalog-"));
  temporaryRoots.push(root);
  const sourceRoot = process.cwd();
  const relativeFiles = [
    "assets-src/gr3/production-recipes.json",
    "assets-src/gr3/generated/production-index.json",
    "assets-src/gr3/reviews.json",
  ];
  for (const relative of relativeFiles) {
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(sourceRoot, ...relative.split("/")), target);
  }
  const index = JSON.parse(await readFile(
    path.join(sourceRoot, "assets-src", "gr3", "generated", "production-index.json"),
    "utf8",
  ));
  for (const entry of index.entries) {
    const relative = entry.collisionDraftFile;
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(sourceRoot, ...relative.split("/")), target);
  }
  return root;
}

describe("fresh disk authored-island catalog", () => {
  it("observes availability changes made after an earlier read instead of using the module snapshot", async () => {
    const root = await copyDiskCatalogFixture();
    const before = await readFreshAvailableAuthoredIslandCatalog(root);
    const manifestPath = path.join(root, "assets-src", "gr3", "production-recipes.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const selected = manifest.recipes.find((recipe) => (
      recipe.lifecycle === "source" && recipe.family === "island" && recipe.availableInGame === true
    ));
    expect(selected).toBeDefined();
    expect(before.islands.some(({ assetId }) => assetId === selected.id)).toBe(true);

    selected.availableInGame = false;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const after = await readFreshAvailableAuthoredIslandCatalog(root);
    expect(after.islands.some(({ assetId }) => assetId === selected.id)).toBe(false);
    expect(after.islands).toHaveLength(before.islands.length - 1);
    expect(after.revision).not.toBe(before.revision);
  }, 15_000);
});
