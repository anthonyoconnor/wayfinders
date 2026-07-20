import { describe, expect, it } from "vitest";
import {
  AUDIO_CATALOG_URL,
  loadAudioCatalog,
  resolveAudioAssetUrl,
  tryLoadAudioCatalog,
  validateAudioCatalog,
} from "../src/wayfinders/audio";
import { testAudioCatalogInput } from "./fixtures/audioCatalog";

function mutableCatalog(): Record<string, unknown> {
  return testAudioCatalogInput();
}

function mutableAssets(catalog: Record<string, unknown>): Record<string, unknown>[] {
  return catalog.assets as Record<string, unknown>[];
}

function mutableCategories(catalog: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return catalog.categories as Record<string, Record<string, unknown>>;
}

describe("audio catalog V1", () => {
  it("validates and freezes a complete catalog", () => {
    const catalog = validateAudioCatalog(testAudioCatalogInput());

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.libraryId).toBe("wayfinders.audio.v1");
    expect(catalog.assets).toHaveLength(4);
    expect(new Set(catalog.assets.map(({ id }) => id)).size).toBe(catalog.assets.length);
    expect(Object.keys(catalog.categories)).toEqual(["music", "ambience", "sfx", "ui"]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.categories.music)).toBe(true);
    expect(Object.isFrozen(catalog.assets)).toBe(true);
    expect(Object.isFrozen(catalog.assets[0])).toBe(true);
    expect(resolveAudioAssetUrl(catalog.assets[0]!)).toBe(
      "/assets/audio/v1/music/home-harbor.wav",
    );
  });

  it("loads the canonical URL and converts fetch or validation failure to silent-start results", async () => {
    const requested: string[] = [];
    const catalog = await loadAudioCatalog(async (url) => {
      requested.push(url);
      return { ok: true, status: 200, json: async () => testAudioCatalogInput() };
    });
    expect(requested).toEqual([AUDIO_CATALOG_URL]);
    expect(catalog.assets).toHaveLength(4);

    const missing = await tryLoadAudioCatalog(async () => ({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("must not parse a failed response");
      },
    }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.message).toMatch(/HTTP 404/u);

    const corrupt = await tryLoadAudioCatalog(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ schemaVersion: 999 }),
    }));
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error).toBeInstanceOf(Error);
  });

  it("requires exact root, category, and asset fields", () => {
    const unknownRoot = mutableCatalog();
    unknownRoot.extra = true;
    expect(() => validateAudioCatalog(unknownRoot)).toThrow(/unknown field extra/u);

    const missingLibrary = mutableCatalog();
    delete missingLibrary.libraryId;
    expect(() => validateAudioCatalog(missingLibrary)).toThrow(/missing libraryId/u);

    const unknownCategoryField = mutableCatalog();
    mutableCategories(unknownCategoryField).music!.editable = false;
    expect(() => validateAudioCatalog(unknownCategoryField)).toThrow(/unknown field editable/u);

    const gameMixerField = mutableCatalog();
    gameMixerField.masterVolume = 0.8;
    expect(() => validateAudioCatalog(gameMixerField)).toThrow(/unknown field masterVolume/u);

    const categoryMixerField = mutableCatalog();
    mutableCategories(categoryMixerField).music!.defaultVolume = 0.42;
    expect(() => validateAudioCatalog(categoryMixerField)).toThrow(/unknown field defaultVolume/u);

    const unknownAssetField = mutableCatalog();
    mutableAssets(unknownAssetField)[0]!.duration = 10;
    expect(() => validateAudioCatalog(unknownAssetField)).toThrow(/unknown field duration/u);
  });

  it("rejects unsupported identity, duplicate IDs and files, and unknown categories", () => {
    const schema = mutableCatalog();
    schema.schemaVersion = 2;
    expect(() => validateAudioCatalog(schema)).toThrow(/schemaVersion/u);

    const library = mutableCatalog();
    library.libraryId = "another.library";
    expect(() => validateAudioCatalog(library)).toThrow(/libraryId/u);

    const duplicateId = mutableCatalog();
    mutableAssets(duplicateId)[1]!.id = mutableAssets(duplicateId)[0]!.id;
    expect(() => validateAudioCatalog(duplicateId)).toThrow(/repeats asset ID/u);

    const duplicateFile = mutableCatalog();
    mutableAssets(duplicateFile)[1]!.id = "music.alternate";
    mutableAssets(duplicateFile)[1]!.category = "music";
    mutableAssets(duplicateFile)[1]!.file = mutableAssets(duplicateFile)[0]!.file;
    expect(() => validateAudioCatalog(duplicateFile)).toThrow(/repeats asset file/u);

    const category = mutableCatalog();
    mutableAssets(category)[0]!.category = "voice";
    expect(() => validateAudioCatalog(category)).toThrow(/must be one of/u);
  });

  it.each([
    "../outside.wav",
    "./v1/music/../outside.wav",
    "/assets/audio/v1/music/home.wav",
    "https://example.test/home.wav",
    ".\\v1\\music\\home.wav",
    "./v1/music/home.mp3",
    "./v1/music/home.wav?revision=1",
  ])("rejects unsafe or non-WAV file path %s", (file) => {
    const candidate = mutableCatalog();
    mutableAssets(candidate)[0]!.file = file;
    expect(() => validateAudioCatalog(candidate)).toThrow(/safe .*\.wav path/u);
  });

  it("keeps each file in its declared category and requires every category", () => {
    const wrongDirectory = mutableCatalog();
    mutableAssets(wrongDirectory)[0]!.file = "./v1/sfx/home-harbor.wav";
    expect(() => validateAudioCatalog(wrongDirectory)).toThrow(/music directory/u);

    const emptyCategory = mutableCatalog();
    emptyCategory.assets = mutableAssets(emptyCategory).filter(({ category }) => category !== "ui");
    expect(() => validateAudioCatalog(emptyCategory)).toThrow(/category ui must contain/u);

    const missingCategory = mutableCatalog();
    delete mutableCategories(missingCategory).ui;
    expect(() => validateAudioCatalog(missingCategory)).toThrow(/missing ui/u);
  });

  it.each([
    ["assetVolume", Number.POSITIVE_INFINITY],
    ["voiceLimit", 0],
    ["voiceLimit", 1.5],
    ["voiceLimit", 16],
  ] as const)("rejects invalid %s value %s", (field, value) => {
    const candidate = mutableCatalog();
    if (field === "assetVolume") mutableAssets(candidate)[0]!.baseVolume = value;
    if (field === "voiceLimit") mutableCategories(candidate).music!.voiceLimit = value;
    expect(() => validateAudioCatalog(candidate)).toThrow(/between 0 and 1|integer between/u);
  });
});
