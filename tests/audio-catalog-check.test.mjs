import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkAudioCatalog } from "../scripts/audio-catalog-check.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const REFERENCE_WAV = path.join(
  REPOSITORY_ROOT,
  "public",
  "assets",
  "audio",
  "v1",
  "ui",
  "toggle.wav",
);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only audio catalog checker", () => {
  it("validates the real checked-in catalog and exact stored WAV set", async () => {
    await expect(checkAudioCatalog(REPOSITORY_ROOT)).resolves.toMatchObject({
      libraryId: "wayfinders.audio.v1",
      assetCount: 11,
    });
  });

  it("rejects a catalog path whose stored WAV is missing", async () => {
    const root = await audioFixture({ missingAssetId: "ui.confirm" });
    await expect(checkAudioCatalog(root)).rejects.toThrow(/ui\.confirm is missing/u);
  });

  it("rejects a corrupt file before it can enter runtime loading", async () => {
    const root = await audioFixture({ corruptAssetId: "sfx.discovery" });
    await expect(checkAudioCatalog(root)).rejects.toThrow(/RIFF\/WAVE headers|too small/u);
  });

  it("rejects a stored WAV that is absent from catalog metadata", async () => {
    const root = await audioFixture({ unlistedFile: "v1/ui/unlisted.wav" });
    await expect(checkAudioCatalog(root)).rejects.toThrow(/Unlisted stored WAVs: v1\/ui\/unlisted\.wav/u);
  });
});

async function audioFixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-audio-check-"));
  temporaryRoots.push(root);
  const audioRoot = path.join(root, "public", "assets", "audio");
  const catalog = fixtureCatalog();
  await mkdir(audioRoot, { recursive: true });
  await writeFile(
    path.join(audioRoot, "audio-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8",
  );
  for (const asset of catalog.assets) {
    if (asset.id === options.missingAssetId) continue;
    const target = path.resolve(audioRoot, asset.file);
    await mkdir(path.dirname(target), { recursive: true });
    if (asset.id === options.corruptAssetId) await writeFile(target, "not a wave file", "utf8");
    else await copyFile(REFERENCE_WAV, target);
  }
  if (options.unlistedFile) {
    const target = path.join(audioRoot, options.unlistedFile);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(REFERENCE_WAV, target);
  }
  return root;
}

function fixtureCatalog() {
  return {
    schemaVersion: 1,
    libraryId: "wayfinders.audio.v1",
    categories: {
      music: { displayName: "Music", voiceLimit: 2 },
      ambience: { displayName: "Ambience", voiceLimit: 3 },
      sfx: { displayName: "Sound effects", voiceLimit: 8 },
      ui: { displayName: "Interface", voiceLimit: 2 },
    },
    assets: [
      fixtureAsset("music.home", "music", true),
      fixtureAsset("ambience.ocean", "ambience", true),
      fixtureAsset("sfx.discovery", "sfx", false),
      fixtureAsset("ui.confirm", "ui", false),
    ],
  };
}

function fixtureAsset(id, category, loop) {
  const fileName = id.slice(category.length + 1);
  return {
    id,
    displayName: id,
    category,
    file: `./v1/${category}/${fileName}.wav`,
    loop,
    baseVolume: 0.5,
    description: `${category} test asset`,
  };
}
