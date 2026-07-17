import { describe, expect, it } from "vitest";
import type { SailingAmbienceInput } from "../src/wayfinders/audio";
import {
  OCEAN_AMBIENCE_VOICE_ID,
  SailingAmbienceController,
  WAKE_AMBIENCE_VOICE_ID,
  type SailingAmbienceAudioSnapshot,
  type SailingAmbienceAudioTarget,
} from "../src/wayfinders/rendering/audio/SailingAmbienceController";
import type {
  GameAudioPlayRequest,
  GameAudioPlayResult,
} from "../src/wayfinders/rendering/audio/GameAudioController";

class FakeAudioTarget implements SailingAmbienceAudioTarget {
  readonly playCalls: GameAudioPlayRequest[] = [];
  readonly gainCalls: Array<{ voiceId: string; gain: number }> = [];
  readonly stopCalls: string[] = [];
  readonly voices = new Set<string>();
  private readonly listeners = new Set<(snapshot: Readonly<SailingAmbienceAudioSnapshot>) => void>();
  enabled = false;
  available = true;
  suspended = false;

  getSnapshot(): Readonly<SailingAmbienceAudioSnapshot> {
    return {
      enabled: this.enabled,
      available: this.available,
      suspended: this.suspended,
      diagnostics: {
        activeVoices: [...this.voices].map((voiceId) => ({ voiceId })),
      },
    };
  }

  subscribe(listener: (snapshot: Readonly<SailingAmbienceAudioSnapshot>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(request: Readonly<GameAudioPlayRequest>): GameAudioPlayResult {
    this.playCalls.push({ ...request });
    const voiceId = request.voiceId ?? `voice-${this.playCalls.length}`;
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

describe("AUD-2 sailing ambience controller", () => {
  it("reconciles current movement only after explicit audio enable", () => {
    const audio = new FakeAudioTarget();
    const controller = new SailingAmbienceController(audio);
    const moving = input({ speed: 4 });

    controller.update(moving, 1);
    expect(audio.playCalls).toEqual([]);

    audio.enabled = true;
    audio.emit();
    controller.update(moving, 0);
    expect(audio.playCalls.map(({ assetId, voiceId }) => ({ assetId, voiceId }))).toEqual([
      { assetId: "ambience.ocean", voiceId: OCEAN_AMBIENCE_VOICE_ID },
      { assetId: "ambience.wake", voiceId: WAKE_AMBIENCE_VOICE_ID },
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      activeVoiceCount: 2,
      peakActiveVoiceCount: 2,
      oceanStarts: 1,
      wakeStarts: 1,
    });
  });

  it("never restarts loops on direction changes, mixer notifications, or focus", () => {
    const audio = new FakeAudioTarget();
    audio.enabled = true;
    const controller = new SailingAmbienceController(audio);
    settle(controller, input({ speed: 4 }));
    expect(audio.playCalls).toHaveLength(2);

    const gainCalls = audio.gainCalls.length;
    controller.update(input({ speed: -4 }), 0);
    audio.emit(); // Mixer/mute reconciliation notification with unchanged voices.
    controller.update(input({ speed: -4 }), 0);
    audio.suspended = true;
    audio.emit();
    controller.update(input({ speed: -4 }), 1);
    audio.suspended = false;
    audio.emit();
    controller.update(input({ speed: -4 }), 0);

    expect(audio.playCalls).toHaveLength(2);
    expect(audio.gainCalls).toHaveLength(gainCalls);
  });

  it("fades and stops only the wake after rest, dock, teleport, or regeneration", () => {
    const audio = new FakeAudioTarget();
    audio.enabled = true;
    const controller = new SailingAmbienceController(audio);
    settle(controller, input({ speed: 4 }));

    settle(controller, input({ speed: 0 }));
    expect(audio.stopCalls).toEqual([WAKE_AMBIENCE_VOICE_ID]);
    expect(audio.voices).toEqual(new Set([OCEAN_AMBIENCE_VOICE_ID]));
    expect(controller.getSnapshot()).toMatchObject({
      activeVoiceCount: 1,
      oceanVoiceActive: true,
      wakeVoiceActive: false,
      wakeStops: 1,
    });

    settle(controller, input({ speed: 4 }));
    settle(controller, input({ speed: 4, atDock: true }));
    expect(audio.stopCalls).toEqual([WAKE_AMBIENCE_VOICE_ID, WAKE_AMBIENCE_VOICE_ID]);
  });

  it("holds the wake through suspension and reconciles the latest lifecycle state on resume", () => {
    const audio = new FakeAudioTarget();
    audio.enabled = true;
    const controller = new SailingAmbienceController(audio);
    settle(controller, input({ speed: 4 }));

    audio.suspended = true;
    audio.emit();
    settle(controller, input({ speed: 4, lifecycleHeld: true }));
    expect(audio.stopCalls).toEqual([]);

    audio.suspended = false;
    audio.emit();
    controller.update(input({ speed: 4, lifecycleHeld: true }), 0);
    expect(audio.stopCalls).toEqual([WAKE_AMBIENCE_VOICE_ID]);
    expect(audio.playCalls).toHaveLength(2);
  });

  it("performs no playback work on identical settled frames and tears down both loops", () => {
    const audio = new FakeAudioTarget();
    audio.enabled = true;
    const controller = new SailingAmbienceController(audio);
    settle(controller, input({ speed: 4 }));
    const before = {
      plays: audio.playCalls.length,
      gains: audio.gainCalls.length,
      stops: audio.stopCalls.length,
      state: controller.getSnapshot().state,
    };

    controller.update(input({ speed: 4 }), 1 / 30);
    expect(controller.getSnapshot().state).toBe(before.state);
    expect(audio.playCalls).toHaveLength(before.plays);
    expect(audio.gainCalls).toHaveLength(before.gains);
    expect(audio.stopCalls).toHaveLength(before.stops);

    controller.destroy();
    controller.destroy();
    expect(audio.stopCalls).toEqual([WAKE_AMBIENCE_VOICE_ID, OCEAN_AMBIENCE_VOICE_ID]);
    expect(audio.voices.size).toBe(0);
  });
});

function input(patch: Partial<SailingAmbienceInput> = {}): SailingAmbienceInput {
  return {
    speed: 0,
    fullSpeed: 4,
    atDock: false,
    lifecycleHeld: false,
    ...patch,
  };
}

function settle(controller: SailingAmbienceController, value: SailingAmbienceInput): void {
  for (let index = 0; index < 200; index++) controller.update(value, 0.1);
}
