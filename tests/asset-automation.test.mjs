import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createThumbnail,
  decodePng,
  encodePng,
  intakeCandidate,
} from "../scripts/asset-pipeline.mjs";
import {
  createCollisionCandidate,
} from "../src/wayfinders/assets/CollisionCandidate.ts";
import { validateAuthoredAssetMetadata } from "../src/wayfinders/assets/AuthoredAssetContracts.ts";

async function readOptional(file) {
  return readFile(file).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
}

async function fileStamp(file) {
  const details = await stat(file);
  return { size: details.size, mtimeMs: details.mtimeMs };
}

describe("GR-2.3 deterministic PNG automation", () => {
  it("round-trips RGBA pixels through the deterministic encoder", () => {
    const pixels = Buffer.from([
      255, 0, 0, 255,
      0, 255, 0, 192,
      0, 0, 255, 128,
      255, 255, 255, 0,
    ]);
    const encoded = encodePng(2, 2, pixels);
    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.pixels).toEqual(pixels);
    expect(encodePng(2, 2, pixels)).toEqual(encoded);
  });

  it("creates byte-identical bounded thumbnails", async () => {
    const source = await readFile(new URL("../public/assets/gr1/images/home-island.png", import.meta.url));
    const first = createThumbnail(source);
    const second = createThumbnail(source);
    expect(first.width).toBe(192);
    expect(first.height).toBe(192);
    expect(second.buffer).toEqual(first.buffer);
    expect(decodePng(first.buffer).pixels).toHaveLength(192 * 192 * 4);
  });

  it("dry-runs collision-only intake without materializing art", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "wayfinders-collision-intake-"));
    const candidateFile = path.join(temporaryDirectory, "home.collision-candidate.json");
    try {
      const packageFile = new URL("../src/wayfinders/assets/packages/home-island.json", import.meta.url);
      const manifestFile = new URL("../assets-src/gr2/asset-catalog.json", import.meta.url);
      const archiveFile = new URL(
        "../assets-src/gr2/candidates/home-island-primary.collision-candidate.json",
        import.meta.url,
      );
      const manifestBytes = await readFile(manifestFile);
      const manifest = JSON.parse(manifestBytes.toString("utf8"));
      const homeEntry = manifest.entries.find(({ assetId }) => assetId === "home.island.primary");
      if (!homeEntry) throw new Error("Expected home-island catalog entry");
      const runtimeFiles = homeEntry.images.map(({ runtimeFile }) => new URL(`../${runtimeFile}`, import.meta.url));
      const before = {
        package: await readFile(packageFile),
        manifest: manifestBytes,
        archive: await readOptional(archiveFile),
        art: await Promise.all(runtimeFiles.map((file) => fileStamp(file))),
      };
      const current = validateAuthoredAssetMetadata(JSON.parse(before.package.toString("utf8")));
      const candidate = createCollisionCandidate(current, undefined, "reset-to-coarse");
      await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`, "utf8");
      await expect(intakeCandidate(candidateFile, true, true)).resolves.toBeUndefined();
      await expect(intakeCandidate(candidateFile, false, true)).rejects.toThrow(/rerun with --replace/);
      expect(await readFile(packageFile)).toEqual(before.package);
      expect(await readFile(manifestFile)).toEqual(before.manifest);
      expect(await readOptional(archiveFile)).toEqual(before.archive);
      expect(await Promise.all(runtimeFiles.map((file) => fileStamp(file)))).toEqual(before.art);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 15_000);
});
