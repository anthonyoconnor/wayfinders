import { describe, expect, it } from "vitest";
import { GameEvents, type GameEventMap } from "../src/wayfinders/core/GameEvents";
import type {
  GameAudioPlayRequest,
  GameAudioPlayResult,
} from "../src/wayfinders/rendering/audio/GameAudioController";
import {
  GameMusicController,
  HOME_HARBOR_MUSIC_VOICE_ID,
  OPEN_WATER_MUSIC_VOICE_ID,
  type GameMusicAudioSnapshot,
  type GameMusicAudioTarget,
  type GameMusicInput,
} from "../src/wayfinders/rendering/audio/GameMusicController";

class FakeMusicAudioTarget implements GameMusicAudioTarget {
  enabled = false;
  available = true;
  suspended = false;
  readonly voices = new Set<string>();
  readonly playCalls: GameAudioPlayRequest[] = [];
  readonly gainCalls: Array<{ voiceId: string; gain: number }> = [];
  readonly stopCalls: string[] = [];
  private readonly listeners = new Set<(snapshot: Readonly<GameMusicAudioSnapshot>) => void>();

  getSnapshot(): Readonly<GameMusicAudioSnapshot> {
    return {
      enabled: this.enabled,
      available: this.available,
      suspended: this.suspended,
      diagnostics: { activeVoices: [...this.voices].map((voiceId) => ({ voiceId })) },
    };
  }

  subscribe(listener: (snapshot: Readonly<GameMusicAudioSnapshot>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(request: Readonly<GameAudioPlayRequest>): GameAudioPlayResult {
    this.playCalls.push({ ...request });
    const voiceId = request.voiceId ?? "missing-id";
    if (this.voices.has(voiceId)) return { kind: "retained", voiceId };
    this.voices.add(voiceId);
    this.emit();
    return { kind: "started", voiceId };
  }

  setVoiceTransitionGain(voiceId: string, gain: number): boolean {
    if (!this.voices.has(voiceId)) return false;
    this.gainCalls.push({ voiceId, gain });
    return true;
  }

  stopVoice(voiceId: string): boolean {
    if (!this.voices.delete(voiceId)) return false;
    this.stopCalls.push(voiceId);
    this.emit();
    return true;
  }

  emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

describe("AUD-4 game music controller", () => {
  it("reconciles only the current score after explicit audio enable", () => {
    const { audio, controller } = fixture();
    controller.update(input(), 0);
    expect(audio.playCalls).toEqual([]);

    audio.enabled = true;
    audio.emit();
    controller.update(input(), 0);
    expect(audio.playCalls).toEqual([{
      assetId: "music.home-harbor",
      voiceId: HOME_HARBOR_MUSIC_VOICE_ID,
      priority: 700,
      transitionGain: 1,
    }]);
  });

  it("crossfades with at most two voices and stops the outgoing loop", () => {
    const { audio, controller } = enabledFixture();
    controller.update(input(), 0);
    const openWater = input({ expeditionActive: true });
    for (let index = 0; index < 6; index++) {
      controller.update(openWater, 0.25);
      expect(audio.voices.size).toBeLessThanOrEqual(2);
    }

    expect(audio.playCalls.map(({ assetId }) => assetId)).toEqual([
      "music.home-harbor",
      "music.open-water",
    ]);
    expect(audio.stopCalls).toEqual([HOME_HARBOR_MUSIC_VOICE_ID]);
    expect(audio.voices).toEqual(new Set([OPEN_WATER_MUSIC_VOICE_ID]));
    expect(controller.getSnapshot()).toMatchObject({
      activeVoiceCount: 1,
      peakActiveVoiceCount: 2,
      starts: 2,
      stops: 1,
      crossfades: 1,
    });
  });

  it("does no playback work on a stable state or focus notification", () => {
    const { audio, controller } = enabledFixture();
    controller.update(input(), 0);
    const before = operationCounts(audio);
    controller.update(input(), 1 / 30);
    audio.suspended = true;
    audio.emit();
    controller.update(input(), 1);
    audio.suspended = false;
    audio.emit();
    controller.update(input(), 0);
    expect(operationCounts(audio)).toEqual(before);
  });

  it("reverses rapid state changes without orphaning loops", () => {
    const { audio, controller } = enabledFixture();
    controller.update(input(), 0);
    const openWater = input({ expeditionActive: true });
    const supportedReturn = input({ expeditionActive: true, inSupportedWater: true });
    controller.update(openWater, 0.25);
    controller.update(supportedReturn, 0.25);
    controller.update(openWater, 0.25);
    controller.update(supportedReturn, 0.25);
    expect(audio.voices.size).toBeLessThanOrEqual(2);

    for (let index = 0; index < 6; index++) controller.update(supportedReturn, 0.25);
    expect(audio.voices).toEqual(new Set([HOME_HARBOR_MUSIC_VOICE_ID]));
  });

  it("gives completion priority over succession and releases after the modal action", () => {
    const { audio, controller, events } = enabledFixture();
    controller.update(input(), 0);
    events.emit("navigatorTenureCompleted", eventPayload<"navigatorTenureCompleted">());
    events.emit("gameCompleted", eventPayload<"gameCompleted">());
    controller.update(input({ lifecycleDuckReason: "completion" }), 0.12);

    expect(controller.getSnapshot()).toMatchObject({
      state: { duckReason: "completion" },
      duckTriggers: { succession: 1, completion: 1 },
      transientDuckReason: "completion",
    });
    expect(audio.gainCalls.at(-1)?.gain).toBeCloseTo(0.28);

    events.emit("completedWorldContinued", { seed: 42 });
    controller.update(input(), 0.25);
    expect(controller.getSnapshot()).toMatchObject({
      state: { duckReason: "none" },
      transientDuckReason: "none",
    });
  });

  it("binds return and wreck ducking and tears down idempotently", () => {
    const { audio, controller, events } = enabledFixture();
    controller.update(input(), 0);
    events.emit("expeditionReturned", eventPayload<"expeditionReturned">());
    controller.update(input(), 0.12);
    expect(controller.getSnapshot()).toMatchObject({
      state: { duckReason: "return" },
      duckTriggers: { return: 1 },
    });
    events.emit("shipWrecked", eventPayload<"shipWrecked">());
    controller.update(input({ lifecycleDuckReason: "wreck" }), 0.12);
    expect(controller.getSnapshot()).toMatchObject({
      state: { duckReason: "wreck" },
      duckTriggers: { wreck: 1 },
    });

    controller.destroy();
    controller.destroy();
    expect(audio.stopCalls).toContain(HOME_HARBOR_MUSIC_VOICE_ID);
    expect(audio.voices.size).toBe(0);
    events.emit("gameCompleted", eventPayload<"gameCompleted">());
    expect(controller.getSnapshot().duckTriggers.completion).toBe(0);
  });
});

function fixture() {
  const audio = new FakeMusicAudioTarget();
  const events = new GameEvents();
  const controller = new GameMusicController(audio, events);
  return { audio, events, controller };
}

function enabledFixture() {
  const value = fixture();
  value.audio.enabled = true;
  value.audio.emit();
  return value;
}

function input(patch: Partial<GameMusicInput> = {}): GameMusicInput {
  return {
    atDock: false,
    inSupportedWater: false,
    expeditionActive: false,
    homeInteractionActive: false,
    lifecycleDuckReason: "none",
    ...patch,
  };
}

function operationCounts(audio: FakeMusicAudioTarget) {
  return {
    plays: audio.playCalls.length,
    gains: audio.gainCalls.length,
    stops: audio.stopCalls.length,
  };
}

function eventPayload<K extends keyof GameEventMap>(): GameEventMap[K] {
  return undefined as GameEventMap[K];
}
