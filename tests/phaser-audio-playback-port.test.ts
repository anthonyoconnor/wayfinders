import type Phaser from "phaser";
import { describe, expect, it } from "vitest";
import { PhaserAudioPlaybackPort } from "../src/wayfinders/rendering/audio/PhaserAudioPlaybackPort";

type Listener = () => void;

class FakeEmitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }
}

class FakeSound extends FakeEmitter {
  pendingRemove = false;
  stopCalls = 0;
  destroyCalls = 0;
  volume = 1;

  play(): boolean { return !this.pendingRemove; }
  pause(): boolean { return !this.pendingRemove; }
  resume(): boolean { return !this.pendingRemove; }
  stop(): boolean {
    this.stopCalls++;
    return !this.pendingRemove;
  }
  setVolume(volume: number): this {
    this.volume = volume;
    return this;
  }
  destroy(): void {
    if (this.pendingRemove) return;
    this.destroyCalls++;
    this.emit("destroy");
    this.pendingRemove = true;
  }
}

class FakeSoundManager extends FakeEmitter {
  locked = false;
  unlockCalls = 0;
  readonly onBlurPausedSounds: FakeSound[] = [];
  readonly sounds: FakeSound[] = [];

  add(): FakeSound {
    const sound = new FakeSound();
    this.sounds.push(sound);
    return sound;
  }

  unlock(): void {
    this.unlockCalls++;
  }
}

class FakeAudioContext {
  state = "suspended";
  resumeCalls = 0;

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
  }
}

describe("AUD-1 Phaser audio playback port", () => {
  it("resumes Web Audio in the explicit enable gesture without a focus cycle", async () => {
    const manager = new FakeSoundManager() as FakeSoundManager & { context: FakeAudioContext };
    manager.locked = true;
    manager.context = new FakeAudioContext();
    const gameEvents = new FakeEmitter();
    const scene = {
      sound: manager,
      cache: { audio: { exists: () => true } },
      game: {
        hasFocus: false,
        config: { audio: { noAudio: false } },
        device: { audio: { webAudio: true, audioData: true } },
        events: gameEvents,
      },
    } as unknown as Phaser.Scene;

    const port = new PhaserAudioPlaybackPort(scene);
    const lifecycle: string[] = [];
    port.subscribe((event) => lifecycle.push(event));
    await port.requestUnlock();

    expect(manager.context.resumeCalls).toBe(1);
    expect(port.locked).toBe(false);
    expect(port.suspended).toBe(false);
    expect(lifecycle).toEqual(["resumed", "unlocked"]);
    port.destroy();
  });

  it("arms Phaser's HTML5 touch unlock before the first explicit Enable gesture", () => {
    const manager = new FakeSoundManager();
    manager.locked = true;
    const gameEvents = new FakeEmitter();
    const scene = {
      sound: manager,
      cache: { audio: { exists: () => true } },
      game: {
        hasFocus: true,
        config: { audio: { noAudio: false } },
        device: { audio: { webAudio: false, audioData: true } },
        events: gameEvents,
      },
    } as unknown as Phaser.Scene;

    const port = new PhaserAudioPlaybackPort(scene);
    expect(manager.unlockCalls).toBe(1);
    port.requestUnlock();
    expect(manager.unlockCalls).toBe(1);
    port.destroy();
  });

  it("removes an owned destroyed one-shot from Phaser's HTML5 blur-resume ledger", () => {
    const manager = new FakeSoundManager();
    const gameEvents = new FakeEmitter();
    const scene = {
      sound: manager,
      cache: { audio: { exists: () => true } },
      game: {
        hasFocus: true,
        config: { audio: { noAudio: false } },
        device: { audio: { webAudio: false, audioData: true } },
        events: gameEvents,
      },
    } as unknown as Phaser.Scene;
    const port = new PhaserAudioPlaybackPort(scene);
    const voice = port.createVoice("sfx.discovery")!;
    expect(voice.play({ loop: false, volume: 0.5 })).toBe(true);

    port.subscribe((event) => {
      if (event === "suspended") voice.destroy();
    });
    // Phaser's HTML5 manager handles the game blur first and records the sound
    // for focus resumption before the scene-owned playback port is notified.
    manager.onBlurPausedSounds.push(manager.sounds[0]!);
    gameEvents.emit("blur");

    expect(manager.sounds[0]).toMatchObject({ pendingRemove: true, destroyCalls: 1 });
    expect(manager.onBlurPausedSounds).toEqual([]);
    port.destroy();
  });
});
