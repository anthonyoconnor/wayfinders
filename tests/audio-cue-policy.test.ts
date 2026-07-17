import { describe, expect, it } from "vitest";
import {
  AudioCuePolicy,
  type ActiveAudioCueVoice,
} from "../src/wayfinders/audio";

describe("AUD-3 audio cue policy", () => {
  it.each([
    ["ui.confirm", "ui-confirm", "ui.confirm"],
    ["ui.cancel", "ui-cancel", "ui.cancel"],
    ["ui.toggle", "ui-toggle", "ui.toggle"],
    ["islandSighted", "discovery", "sfx.discovery"],
    ["surveySiteSighted", "discovery", "sfx.discovery"],
    ["fishingShoalSighted", "discovery", "sfx.discovery"],
    ["wreckDiscovered", "discovery", "sfx.discovery"],
    ["islandDossierSurveyed", "survey", "sfx.survey-complete"],
    ["surveySiteSurveyed", "survey", "sfx.survey-complete"],
    ["fishingShoalSurveyed", "survey", "sfx.survey-complete"],
    ["wreckSurveyed", "survey", "sfx.survey-complete"],
    ["idolLocationDiscovered", "idol-discovery", "sfx.discovery"],
    ["expeditionReturned", "dock-return", "sfx.dock-return"],
    ["shipReplenishedDock", "dock-return", "sfx.dock-return"],
    ["shipWrecked", "wreck", "sfx.wreck"],
  ] as const)("maps %s to its stable cue family", (source, family, assetId) => {
    expect(new AudioCuePolicy().decideBatch([source], 1_000)).toMatchObject({
      kind: "play",
      intention: { source, family, assetId },
    });
  });

  it.each([
    "provisionConsumed",
    "shipEnteredTile",
    "knowledgeChanged",
    "returnStateChanged",
  ] as const)("keeps high-rate source %s silent", (source) => {
    expect(new AudioCuePolicy().decideBatch([source], 1_000)).toEqual({
      kind: "suppressed",
      reason: "no-cue",
    });
  });

  it("selects only the highest-priority intention in a synchronous batch", () => {
    const decision = new AudioCuePolicy().decideBatch([
      "ui.confirm",
      "surveySiteSurveyed",
      "islandSighted",
      "idolLocationDiscovered",
    ], 1_000);

    expect(decision).toMatchObject({
      kind: "play",
      intention: {
        source: "idolLocationDiscovered",
        family: "idol-discovery",
        priority: 900,
      },
    });
  });

  it("uses source order as a stable tie-break", () => {
    const decision = new AudioCuePolicy().decideBatch([
      "surveySiteSighted",
      "islandSighted",
    ], 1_000);

    expect(decision).toMatchObject({
      kind: "play",
      intention: { source: "surveySiteSighted" },
    });
  });

  it("suppresses whole developer-action batches", () => {
    for (const source of ["shipTeleported", "worldRegenerated"] as const) {
      expect(new AudioCuePolicy().decideBatch(["islandSighted", source], 1_000)).toEqual({
        kind: "suppressed",
        reason: "developer-action",
      });
    }
  });

  it("enforces family cooldowns with an injected clock value", () => {
    const policy = new AudioCuePolicy();
    expect(policy.decideBatch(["islandSighted"], 1_000).kind).toBe("play");
    expect(policy.decideBatch(["surveySiteSighted"], 1_649)).toMatchObject({
      kind: "suppressed",
      reason: "cooldown",
      family: "discovery",
    });
    expect(policy.decideBatch(["surveySiteSighted"], 1_650).kind).toBe("play");
  });

  it("rejects excess survey voices but deterministically replaces discovery", () => {
    const surveyVoices: readonly ActiveAudioCueVoice[] = [
      voice("survey:b", "survey", 600, 900),
      voice("survey:a", "survey", 600, 900),
    ];
    expect(new AudioCuePolicy().decideBatch(
      ["surveySiteSurveyed"],
      1_000,
      surveyVoices,
    )).toMatchObject({ kind: "suppressed", reason: "voice-limit" });

    const discoveryVoices: readonly ActiveAudioCueVoice[] = [
      voice("discovery:b", "discovery", 400, 900),
      voice("discovery:a", "discovery", 400, 900),
    ];
    expect(new AudioCuePolicy().decideBatch(
      ["wreckDiscovered"],
      1_000,
      discoveryVoices,
    )).toMatchObject({ kind: "play", replaceVoiceId: "discovery:a" });
  });

  it("allows idol discovery to replace an ordinary survey or discovery voice", () => {
    const active: readonly ActiveAudioCueVoice[] = [
      voice("survey", "survey", 600, 800),
      voice("discovery", "discovery", 400, 700),
    ];

    expect(new AudioCuePolicy().decideBatch(
      ["idolLocationDiscovered"],
      1_000,
      active,
    )).toMatchObject({ kind: "play", replaceVoiceId: "discovery" });
  });

  it("has an explicit empty-batch decision", () => {
    expect(new AudioCuePolicy().decideBatch([], 1_000)).toEqual({
      kind: "suppressed",
      reason: "empty-batch",
    });
  });
});

function voice(
  voiceId: string,
  family: ActiveAudioCueVoice["family"],
  priority: number,
  startedAtMs: number,
): ActiveAudioCueVoice {
  return { voiceId, family, priority, startedAtMs };
}
