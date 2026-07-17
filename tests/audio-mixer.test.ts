import { describe, expect, it } from "vitest";
import {
  AudioMixer,
  validateAudioCatalog,
} from "../src/wayfinders/audio";
import { testAudioCatalogInput } from "./fixtures/audioCatalog";

const CATALOG = validateAudioCatalog(testAudioCatalogInput());

describe("audio mixer", () => {
  it("starts from catalog defaults and multiplies the complete effective gain", () => {
    const mixer = new AudioMixer(CATALOG);
    const snapshot = mixer.getSnapshot();

    expect(snapshot).toMatchObject({
      revision: 0,
      muted: false,
      masterVolume: 0.8,
      categoryVolumes: { music: 0.42, ambience: 0.275, sfx: 0.75, ui: 0.6 },
      categoryVoiceLimits: { music: 2, ambience: 3, sfx: 8, ui: 2 },
      totalVoiceLimit: 15,
      activeVoiceCount: 0,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.categoryVolumes)).toBe(true);
    expect(mixer.effectiveGain("music.home-harbor", 0.5)).toBeCloseTo(
      0.8 * 0.42 * 0.38 * 0.5,
    );
  });

  it("clamps finite controls, mutes every category, and rejects non-finite gains", () => {
    const mixer = new AudioMixer(CATALOG);

    expect(mixer.setMasterVolume(2)).toMatchObject({ kind: "changed", revision: 1 });
    expect(mixer.setCategoryVolume("sfx", -1)).toMatchObject({ kind: "changed", revision: 2 });
    expect(mixer.effectiveGain("sfx.discovery")).toBe(0);
    expect(mixer.setCategoryVolume("sfx", 0.5)).toMatchObject({ kind: "changed", revision: 3 });
    expect(mixer.setMuted(true)).toMatchObject({ kind: "changed", revision: 4 });
    expect(mixer.effectiveGain("sfx.discovery")).toBe(0);
    expect(mixer.getSnapshot()).toMatchObject({
      muted: true,
      masterVolume: 1,
      categoryVolumes: { sfx: 0.5 },
    });

    expect(() => mixer.setMasterVolume(Number.NaN)).toThrow(/finite/u);
    expect(() => mixer.setCategoryVolume("music", Number.POSITIVE_INFINITY)).toThrow(/finite/u);
    expect(() => mixer.effectiveGain("music.home-harbor", Number.NaN)).toThrow(/finite/u);
  });

  it("preserves revision and snapshot identity for stable-state no-op updates", () => {
    const mixer = new AudioMixer(CATALOG);
    const initial = mixer.getSnapshot();

    expect(mixer.setMuted(false)).toEqual({ kind: "none", previousRevision: 0, revision: 0 });
    expect(mixer.setMasterVolume(0.8)).toMatchObject({ kind: "none", revision: 0 });
    expect(mixer.setCategoryVolume("music", 0.42)).toMatchObject({ kind: "none", revision: 0 });
    expect(mixer.releaseVoice("not-active")).toMatchObject({ kind: "none", revision: 0 });
    expect(mixer.clearVoices()).toMatchObject({ kind: "none", revision: 0 });
    expect(mixer.getSnapshot()).toBe(initial);

    mixer.setMasterVolume(1.5);
    const changed = mixer.getSnapshot();
    expect(changed).not.toBe(initial);
    expect(changed.revision).toBe(1);
    expect(mixer.setMasterVolume(7)).toMatchObject({ kind: "none", revision: 1 });
    expect(mixer.getSnapshot()).toBe(changed);
  });

  it("accounts for voices and rejects a lower-priority voice at a category limit", () => {
    const mixer = new AudioMixer(CATALOG);
    for (let index = 0; index < 8; index++) {
      expect(mixer.requestVoice({
        voiceId: `discovery-${index}`,
        assetId: "sfx.discovery",
        priority: 10,
      }).kind).toBe("accepted");
    }
    const beforeRejection = mixer.getSnapshot();
    const rejected = mixer.requestVoice({
      voiceId: "low-priority",
      assetId: "sfx.discovery",
      priority: 9,
    });

    expect(rejected).toMatchObject({
      kind: "rejected",
      reason: "category-limit",
      mutation: { kind: "none", revision: 8 },
    });
    expect(mixer.getSnapshot()).toBe(beforeRejection);
    expect(beforeRejection).toMatchObject({
      activeVoiceCount: 8,
      activeVoicesByCategory: { sfx: 8 },
    });
  });

  it("replaces the oldest lowest-priority eligible voice without exceeding a limit", () => {
    const mixer = new AudioMixer(CATALOG, { totalVoiceLimit: 2 });
    mixer.requestVoice({ voiceId: "music", assetId: "music.home-harbor", priority: 20 });
    mixer.requestVoice({ voiceId: "ordinary", assetId: "sfx.discovery", priority: 5 });

    const decision = mixer.requestVoice({
      voiceId: "important",
      assetId: "ui.confirm",
      priority: 10,
    });
    expect(decision).toMatchObject({
      kind: "replaced",
      replacedVoiceId: "ordinary",
      voice: { voiceId: "important", category: "ui", priority: 10 },
      mutation: { kind: "changed", previousRevision: 2, revision: 3 },
    });
    expect(mixer.getSnapshot()).toMatchObject({
      activeVoiceCount: 2,
      activeVoicesByCategory: { music: 1, ambience: 0, sfx: 0, ui: 1 },
    });
    expect(mixer.getSnapshot().activeVoices.map(({ voiceId }) => voiceId)).toEqual([
      "music",
      "important",
    ]);
  });

  it("uses registration order to replace an equal-priority category voice", () => {
    const mixer = new AudioMixer(CATALOG);
    mixer.requestVoice({ voiceId: "first", assetId: "ui.confirm", priority: 4 });
    mixer.requestVoice({ voiceId: "second", assetId: "ui.confirm", priority: 4 });
    const decision = mixer.requestVoice({ voiceId: "third", assetId: "ui.confirm", priority: 4 });

    expect(decision).toMatchObject({ kind: "replaced", replacedVoiceId: "first" });
    expect(mixer.getSnapshot().activeVoices.map(({ voiceId }) => voiceId)).toEqual(["second", "third"]);
  });

  it("rejects duplicate voice IDs and releases or clears accounted voices exactly once", () => {
    const mixer = new AudioMixer(CATALOG);
    mixer.requestVoice({ voiceId: "cue", assetId: "ui.confirm", priority: 1 });
    expect(mixer.requestVoice({ voiceId: "cue", assetId: "ui.confirm", priority: 100 })).toMatchObject({
      kind: "rejected",
      reason: "duplicate-voice-id",
      mutation: { kind: "none", revision: 1 },
    });
    expect(mixer.releaseVoice("cue")).toMatchObject({ kind: "changed", revision: 2 });
    expect(mixer.releaseVoice("cue")).toMatchObject({ kind: "none", revision: 2 });

    mixer.requestVoice({ voiceId: "one", assetId: "music.home-harbor", priority: 1 });
    mixer.requestVoice({ voiceId: "two", assetId: "ambience.ocean", priority: 1 });
    expect(mixer.clearVoices()).toMatchObject({ kind: "changed", revision: 5 });
    expect(mixer.getSnapshot().activeVoiceCount).toBe(0);
  });

  it("rejects invalid program inputs before mutating the ledger", () => {
    const mixer = new AudioMixer(CATALOG);
    expect(() => mixer.requestVoice({ voiceId: "cue", assetId: "missing", priority: 1 }))
      .toThrow(/Unknown audio asset ID/u);
    expect(() => mixer.requestVoice({ voiceId: "cue", assetId: "ui.confirm", priority: -1 }))
      .toThrow(/priority/u);
    expect(() => new AudioMixer(CATALOG, { totalVoiceLimit: 16 })).toThrow(/no greater than 15/u);
    expect(mixer.getSnapshot().revision).toBe(0);
  });
});
