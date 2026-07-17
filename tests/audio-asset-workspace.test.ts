import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatAudioPreviewTime } from "../src/wayfinders/assets/audioPreview/AudioPreviewPlayer";
import { validateAudioCatalog } from "../src/wayfinders/audio";
import {
  audioWorkspaceCatalogSource,
  groupAudioWorkspaceAssets,
  type AudioWorkspaceCatalog,
} from "../src/wayfinders/assets/workspaces/AudioWorkspaceCatalog";

const catalog = Object.freeze({
  libraryId: "wayfinders.audio.test",
  categories: Object.freeze([
    Object.freeze({ id: "music", displayName: "Music" }),
    Object.freeze({ id: "sfx", displayName: "Sound effects" }),
  ]),
  assets: Object.freeze([
    Object.freeze({
      id: "music.home",
      displayName: "Home",
      description: "Home loop",
      category: "music",
      sourceUrl: "/audio/home.wav",
      loop: true,
    }),
    Object.freeze({
      id: "sfx.confirm",
      displayName: "Confirm",
      description: "Confirm cue",
      category: "sfx",
      sourceUrl: "/audio/confirm.wav",
      loop: false,
    }),
  ]),
} satisfies AudioWorkspaceCatalog);

describe("AUD-1 Audio asset workspace", () => {
  it("adapts the validated shared catalog and its stable runtime URLs", () => {
    const runtimeCatalog = validateAudioCatalog(JSON.parse(readFileSync(
      new URL("../public/assets/audio/audio-catalog.json", import.meta.url),
      "utf8",
    )));
    const source = audioWorkspaceCatalogSource({ ok: true, catalog: runtimeCatalog });
    expect(source.catalog?.categories.map(({ id }) => id)).toEqual(["music", "ambience", "sfx", "ui"]);
    expect(source.catalog?.assets[0]).toMatchObject({
      id: "music.home-harbor",
      sourceUrl: "/assets/audio/v1/music/home-harbor.wav",
      loop: true,
    });
    expect(audioWorkspaceCatalogSource({ ok: false, error: new Error("Catalog failed") })).toEqual({
      error: "Catalog failed",
    });
  });

  it("groups the shared readonly catalog in declared category order", () => {
    const before = JSON.stringify(catalog);
    expect(groupAudioWorkspaceAssets(catalog).map((group) => ({
      category: group.category.id,
      assets: group.assets.map((asset) => asset.id),
    }))).toEqual([
      { category: "music", assets: ["music.home"] },
      { category: "sfx", assets: ["sfx.confirm"] },
    ]);
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("rejects a workspace view whose asset category is not declared", () => {
    expect(() => groupAudioWorkspaceAssets({
      ...catalog,
      assets: [{ ...catalog.assets[0]!, category: "unknown" }],
    })).toThrow("unknown category unknown");
  });

  it("formats browser-reported progress without catalog duration metadata", () => {
    expect(formatAudioPreviewTime(undefined)).toBe("--:--");
    expect(formatAudioPreviewTime(0)).toBe("0:00");
    expect(formatAudioPreviewTime(65.9)).toBe("1:05");
  });

  it("contains only play-only controls and no mutation transport", () => {
    const scene = readFileSync(
      new URL("../src/wayfinders/assets/audioPreview/AudioAssetWorkspaceScene.ts", import.meta.url),
      "utf8",
    );
    expect(scene).toContain('data-audio-action="play"');
    expect(scene).toContain('data-audio-action="pause-resume"');
    expect(scene).toContain('data-audio-action="stop"');
    expect(scene).toContain('data-audio-output="progress"');
    expect(scene).toContain('data-audio-output="duration"');
    expect(scene).toContain("renderLoadFailure");
    expect(scene).not.toContain("fetch(");
    expect(scene).not.toContain("XMLHttpRequest");
    expect(scene).not.toContain("FormData");
    expect(scene).not.toContain("method: \"POST\"");
    expect(scene).not.toContain("method: \"PUT\"");
    expect(scene).not.toContain("method: \"DELETE\"");
    expect(scene).not.toContain("<input");
    expect(scene).not.toContain("<textarea");
    expect(scene).not.toContain("<select");
  });
});
