import { describe, expect, it } from "vitest";
import {
  AudioMixer,
  validateAudioCatalog,
  type AudioCatalog,
} from "../src/wayfinders/audio";
import type {
  AudioPlaybackLifecycleEvent,
  AudioPlaybackPort,
  AudioPlaybackVoice,
  AudioPlaybackVoiceConfig,
} from "../src/wayfinders/rendering/audio/AudioPlaybackPort";
import { GameAudioController } from "../src/wayfinders/rendering/audio/GameAudioController";
import { DEFAULT_GAME_SETTINGS } from "../src/wayfinders/config/gameSettings";
import {
  phaserAudioCacheKey,
  queueGameAudioCatalog,
  type GameAudioLoader,
} from "../src/wayfinders/rendering/audio/GameAudioPreload";

class FakeVoice implements AudioPlaybackVoice {
  readonly volumes: number[] = [];
  readonly playConfigs: AudioPlaybackVoiceConfig[] = [];
  private readonly ended = new Set<() => void>();
  playResult = true;
  stopCalls = 0;
  destroyCalls = 0;
  pauseCalls = 0;
  resumeCalls = 0;

  play(config: Readonly<AudioPlaybackVoiceConfig>): boolean {
    this.playConfigs.push({ ...config });
    this.volumes.push(config.volume);
    return this.playResult;
  }

  pause(): boolean {
    this.pauseCalls++;
    return true;
  }

  resume(): boolean {
    this.resumeCalls++;
    return true;
  }

  stop(): boolean {
    this.stopCalls++;
    return true;
  }

  setVolume(volume: number): void {
    this.volumes.push(volume);
  }

  onEnded(listener: () => void): () => void {
    this.ended.add(listener);
    return () => this.ended.delete(listener);
  }

  finish(): void {
    for (const listener of [...this.ended]) listener();
  }

  destroy(): void {
    this.destroyCalls++;
    this.ended.clear();
  }
}

class FakePlaybackPort implements AudioPlaybackPort {
  readonly assets = new Set<string>();
  readonly voices: FakeVoice[] = [];
  private readonly listeners = new Set<(event: AudioPlaybackLifecycleEvent) => void>();
  locked: boolean;
  suspended = false;
  unlockRequests = 0;
  destroyCalls = 0;
  nextPlayResult = true;

  constructor(
    readonly available = true,
    locked = true,
  ) {
    this.locked = locked;
  }

  hasAsset(assetId: string): boolean {
    return this.assets.has(assetId);
  }

  createVoice(_assetId: string): AudioPlaybackVoice {
    const voice = new FakeVoice();
    voice.playResult = this.nextPlayResult;
    this.nextPlayResult = true;
    this.voices.push(voice);
    return voice;
  }

  requestUnlock(): void {
    this.unlockRequests++;
  }

  subscribe(listener: (event: AudioPlaybackLifecycleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AudioPlaybackLifecycleEvent): void {
    if (event === "unlocked") this.locked = false;
    if (event === "suspended") this.suspended = true;
    if (event === "resumed") this.suspended = false;
    for (const listener of [...this.listeners]) listener(event);
  }

  destroy(): void {
    this.destroyCalls++;
    this.listeners.clear();
  }
}

class GestureUnlockPlaybackPort extends FakePlaybackPort {
  override async requestUnlock(): Promise<void> {
    this.unlockRequests++;
    this.locked = false;
    if (this.suspended) this.emit("resumed");
  }
}

describe("AUD-1 game audio controller", () => {
  it("starts playback immediately after the explicit enable promise resolves", async () => {
    const port = new GestureUnlockPlaybackPort(true, true);
    port.suspended = true;
    const { controller } = fixture(port);

    controller.enableSound();
    expect(controller.getSnapshot().unlockState).toBe("unlocking");
    await Promise.resolve();

    expect(controller.getSnapshot().unlockState).toBe("unlocked");
    expect(controller.getSnapshot().suspended).toBe(false);
    expect(controller.play({ assetId: "sfx.discovery", voiceId: "first-cue" })).toEqual({
      kind: "started",
      voiceId: "first-cue",
    });
  });

  it("queues every catalog file beneath stable Phaser cache keys", () => {
    const calls: Array<{ key: string; urls: string | string[] }> = [];
    const loader: GameAudioLoader = {
      audio(key, urls) {
        calls.push({ key, urls });
      },
    };

    queueGameAudioCatalog(loader, CATALOG);

    expect(calls).toHaveLength(CATALOG.assets.length);
    expect(calls[0]).toEqual({
      key: phaserAudioCacheKey("music.home-harbor"),
      urls: "/assets/audio/v1/music/home-harbor.wav",
    });
    expect(calls.map(({ key }) => key)).toEqual(
      CATALOG.assets.map(({ id }) => phaserAudioCacheKey(id)),
    );
  });

  it("rejects locked cues without replaying them after explicit unlock", () => {
    const { controller, port } = fixture();

    expect(controller.getSnapshot()).toMatchObject({
      unlockState: "locked",
      enabled: false,
      browserLocked: true,
    });
    expect(controller.play({ assetId: "sfx.discovery" })).toEqual({
      kind: "rejected",
      reason: "locked",
    });
    expect(port.voices).toHaveLength(0);

    controller.enableSound();
    expect(port.unlockRequests).toBe(1);
    expect(controller.getSnapshot().unlockState).toBe("unlocking");
    port.emit("unlocked");

    expect(controller.getSnapshot().unlockState).toBe("unlocked");
    expect(port.voices).toHaveLength(0);
    const result = controller.play({ assetId: "sfx.discovery", voiceId: "next-cue" });
    expect(result).toEqual({ kind: "started", voiceId: "next-cue" });
    expect(port.voices).toHaveLength(1);
    port.voices[0]!.finish();
    expect(controller.getSnapshot().diagnostics.activeVoiceCount).toBe(0);
    expect(port.voices[0]!.destroyCalls).toBe(1);
  });

  it("enables default-on audio when the browser releases its gesture lock", () => {
    const port = new FakePlaybackPort(true, true);
    for (const asset of CATALOG.assets) port.assets.add(asset.id);
    const controller = new GameAudioController({
      catalog: CATALOG,
      mixer: new AudioMixer(CATALOG, DEFAULT_GAME_SETTINGS.audio),
      playback: port,
      enabledByDefault: true,
    });

    expect(controller.getSnapshot()).toMatchObject({
      unlockState: "locked",
      enabled: false,
      enabledOnUnlock: true,
      browserLocked: true,
    });
    port.emit("unlocked");
    expect(controller.getSnapshot()).toMatchObject({
      unlockState: "unlocked",
      enabled: true,
      browserLocked: false,
    });
  });

  it("reconciles mixer changes onto owned voices without restarting them", () => {
    const { controller, port } = unlockedFixture();
    expect(controller.play({
      assetId: "music.home-harbor",
      voiceId: "music",
      transitionGain: 0.5,
    })).toMatchObject({ kind: "started" });
    const voice = port.voices[0]!;
    expect(voice.volumes.at(-1)).toBeCloseTo(0.08);

    controller.setMasterVolume(0.5);
    expect(voice.volumes.at(-1)).toBeCloseTo(0.05);
    controller.setCategoryVolume("music", 0.2);
    expect(voice.volumes.at(-1)).toBeCloseTo(0.025);
    controller.setVoiceTransitionGain("music", 1);
    expect(voice.volumes.at(-1)).toBeCloseTo(0.05);
    controller.setMuted(true);
    expect(voice.volumes.at(-1)).toBe(0);
    const callsAfterMute = voice.volumes.length;
    controller.setMuted(true);
    expect(voice.volumes).toHaveLength(callsAfterMute);
    controller.setMuted(false);
    expect(voice.volumes.at(-1)).toBeCloseTo(0.05);
    expect(port.voices).toHaveLength(1);
  });

  it("retains loops, discards stale one-shots, and never starts missed focus cues", () => {
    const { controller, port } = unlockedFixture();
    controller.play({ assetId: "music.home-harbor", voiceId: "music" });
    controller.play({ assetId: "sfx.discovery", voiceId: "cue" });
    expect(controller.getSnapshot().diagnostics.activeVoiceCount).toBe(2);

    port.emit("suspended");
    expect(controller.getSnapshot()).toMatchObject({ suspended: true });
    expect(controller.getSnapshot().diagnostics.activeVoices.map(({ voiceId }) => voiceId)).toEqual(["music"]);
    expect(port.voices[1]!.stopCalls).toBe(1);
    expect(controller.play({ assetId: "sfx.discovery", voiceId: "missed" })).toEqual({
      kind: "rejected",
      reason: "suspended",
    });

    port.emit("resumed");
    expect(controller.getSnapshot().suspended).toBe(false);
    expect(controller.getSnapshot().diagnostics.activeVoices.map(({ voiceId }) => voiceId)).toEqual(["music"]);
    expect(port.voices).toHaveLength(2);
  });

  it("keeps playback and controller ownership aligned across voice replacement", () => {
    const { controller, port } = unlockedFixture();
    expect(controller.play({ assetId: "ui.confirm", voiceId: "low", priority: 2 })).toMatchObject({
      kind: "started",
    });
    expect(controller.play({ assetId: "ui.confirm", voiceId: "lower", priority: 1 })).toEqual({
      kind: "rejected",
      reason: "category-limit",
    });
    expect(controller.play({ assetId: "ui.confirm", voiceId: "equal", priority: 2 })).toEqual({
      kind: "started",
      voiceId: "equal",
      replacedVoiceId: "low",
    });
    expect(port.voices[0]!.stopCalls).toBe(1);
    expect(port.voices[0]!.destroyCalls).toBe(1);
    expect(controller.getSnapshot().diagnostics.activeVoices.map(({ voiceId }) => voiceId)).toEqual(["equal"]);
  });

  it("degrades unavailable, missing, and failed playback to diagnostics", () => {
    const unavailable = fixture(new FakePlaybackPort(false, false));
    unavailable.controller.enableSound();
    expect(unavailable.controller.getSnapshot().unlockState).toBe("unavailable");
    expect(unavailable.controller.play({ assetId: "sfx.discovery" })).toEqual({
      kind: "rejected",
      reason: "unavailable",
    });
    expect(unavailable.port.unlockRequests).toBe(0);

    const missing = unlockedFixture();
    missing.port.assets.delete("sfx.discovery");
    expect(missing.controller.play({ assetId: "sfx.discovery" })).toEqual({
      kind: "rejected",
      reason: "asset-unavailable",
    });
    expect(missing.controller.getSnapshot().diagnostics.unavailableAssetIds).toEqual(["sfx.discovery"]);

    const failed = unlockedFixture();
    failed.port.nextPlayResult = false;
    expect(failed.controller.play({ assetId: "sfx.discovery" })).toEqual({
      kind: "rejected",
      reason: "playback-failed",
    });
    expect(failed.controller.getSnapshot().diagnostics.activeVoiceCount).toBe(0);
    expect(failed.port.voices[0]!.destroyCalls).toBe(1);
  });

  it("destroys owned voices and playback listeners exactly once", () => {
    const { controller, port, mixer } = unlockedFixture();
    controller.play({ assetId: "music.home-harbor", voiceId: "music" });
    let notifications = 0;
    controller.subscribe(() => { notifications++; });

    controller.destroy();
    const notificationsAfterDestroy = notifications;
    controller.destroy();
    port.emit("suspended");

    expect(port.voices[0]!.stopCalls).toBe(1);
    expect(port.voices[0]!.destroyCalls).toBe(1);
    expect(port.destroyCalls).toBe(1);
    expect(mixer.getSnapshot().activeVoiceCount).toBe(0);
    expect(controller.getSnapshot().unlockState).toBe("destroyed");
    expect(notifications).toBe(notificationsAfterDestroy);
  });
});

function fixture(port = new FakePlaybackPort()): {
  controller: GameAudioController;
  port: FakePlaybackPort;
  mixer: AudioMixer;
} {
  for (const asset of CATALOG.assets) port.assets.add(asset.id);
  const mixer = new AudioMixer(CATALOG, DEFAULT_GAME_SETTINGS.audio);
  return {
    controller: new GameAudioController({ catalog: CATALOG, mixer, playback: port }),
    port,
    mixer,
  };
}

function unlockedFixture(): ReturnType<typeof fixture> {
  const result = fixture(new FakePlaybackPort(true, false));
  result.controller.enableSound();
  expect(result.controller.getSnapshot().unlockState).toBe("unlocked");
  return result;
}

const CATALOG: Readonly<AudioCatalog> = validateAudioCatalog({
  schemaVersion: 1,
  libraryId: "wayfinders.audio.v1",
  categories: {
    music: { displayName: "Music", voiceLimit: 2 },
    ambience: { displayName: "Ambience", voiceLimit: 2 },
    sfx: { displayName: "Sound effects", voiceLimit: 2 },
    ui: { displayName: "Interface", voiceLimit: 1 },
  },
  assets: [
    {
      id: "music.home-harbor",
      displayName: "Home Harbor",
      category: "music",
      file: "./v1/music/home-harbor.wav",
      loop: true,
      baseVolume: 0.5,
      description: "Home music",
    },
    {
      id: "ambience.ocean",
      displayName: "Ocean",
      category: "ambience",
      file: "./v1/ambience/ocean.wav",
      loop: true,
      baseVolume: 0.5,
      description: "Ocean ambience",
    },
    {
      id: "sfx.discovery",
      displayName: "Discovery",
      category: "sfx",
      file: "./v1/sfx/discovery.wav",
      loop: false,
      baseVolume: 0.5,
      description: "Discovery cue",
    },
    {
      id: "ui.confirm",
      displayName: "Confirm",
      category: "ui",
      file: "./v1/ui/confirm.wav",
      loop: false,
      baseVolume: 0.5,
      description: "Confirm cue",
    },
  ],
});
