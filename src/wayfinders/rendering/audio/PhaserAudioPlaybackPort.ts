import type Phaser from "phaser";
import type {
  AudioPlaybackLifecycleEvent,
  AudioPlaybackPort,
  AudioPlaybackVoice,
  AudioPlaybackVoiceConfig,
} from "./AudioPlaybackPort";
import { phaserAudioCacheKey } from "./GameAudioPreload";

// Phaser's public union exposes unlock only on the concrete managers even
// though every runtime manager owns the method. Keep that mismatch here.
interface PhaserSoundManagerPort {
  readonly locked: boolean;
  /** Phaser HTML5 manager's blur-resume ledger; absent for Web Audio/no-audio. */
  readonly onBlurPausedSounds?: Phaser.Sound.BaseSound[];
  add(key: string): Phaser.Sound.BaseSound;
  unlock?(): void;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

interface PhaserVolumeSound extends Phaser.Sound.BaseSound {
  setVolume(volume: number): this;
}

const PHASER_SOUND_EVENTS = {
  complete: "complete",
  destroy: "destroy",
  paused: "pauseall",
  resumed: "resumeall",
  unlocked: "unlocked",
} as const;

const PHASER_GAME_EVENTS = {
  blur: "blur",
  focus: "focus",
} as const;

class PhaserAudioPlaybackVoice implements AudioPlaybackVoice {
  private readonly endListeners = new Set<() => void>();
  private destroyed = false;

  constructor(
    private readonly sound: PhaserVolumeSound,
    private readonly onDestroy: () => void,
  ) {
    sound.on(PHASER_SOUND_EVENTS.complete, this.handleEnded);
    sound.on(PHASER_SOUND_EVENTS.destroy, this.handleSoundDestroyed);
  }

  play(config: Readonly<AudioPlaybackVoiceConfig>): boolean {
    if (this.destroyed) return false;
    return this.sound.play({ loop: config.loop, volume: config.volume });
  }

  pause(): boolean {
    return !this.destroyed && this.sound.pause();
  }

  resume(): boolean {
    return !this.destroyed && this.sound.resume();
  }

  stop(): boolean {
    return !this.destroyed && this.sound.stop();
  }

  setVolume(volume: number): void {
    if (!this.destroyed) this.sound.setVolume(volume);
  }

  onEnded(listener: () => void): () => void {
    if (this.destroyed) return () => undefined;
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sound.off(PHASER_SOUND_EVENTS.complete, this.handleEnded);
    this.sound.off(PHASER_SOUND_EVENTS.destroy, this.handleSoundDestroyed);
    this.endListeners.clear();
    this.sound.destroy();
    this.onDestroy();
  }

  private readonly handleEnded = (): void => {
    if (this.destroyed) return;
    for (const listener of [...this.endListeners]) listener();
  };

  private readonly handleSoundDestroyed = (): void => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sound.off(PHASER_SOUND_EVENTS.complete, this.handleEnded);
    this.sound.off(PHASER_SOUND_EVENTS.destroy, this.handleSoundDestroyed);
    for (const listener of [...this.endListeners]) listener();
    this.endListeners.clear();
    this.onDestroy();
  };
}

/**
 * Adapts Phaser's global Sound Manager without taking ownership of the manager.
 * Only voices created through this port and listeners installed here are torn
 * down by destroy().
 */
export class PhaserAudioPlaybackPort implements AudioPlaybackPort {
  private readonly manager: PhaserSoundManagerPort;
  private readonly listeners = new Set<(event: AudioPlaybackLifecycleEvent) => void>();
  private readonly voices = new Set<PhaserAudioPlaybackVoice>();
  private readonly html5UnlockArmed: boolean;
  private destroyed = false;
  private gameSuspended: boolean;

  readonly available: boolean;

  constructor(private readonly scene: Phaser.Scene) {
    this.manager = scene.sound as PhaserSoundManagerPort;
    this.available = soundIsAvailable(scene);
    this.gameSuspended = !scene.game.hasFocus;
    this.html5UnlockArmed = this.available
      && this.manager.locked
      && Array.isArray(this.manager.onBlurPausedSounds);
    if (this.html5UnlockArmed) this.manager.unlock?.();
    this.manager.on(PHASER_SOUND_EVENTS.unlocked, this.handleUnlocked);
    this.manager.on(PHASER_SOUND_EVENTS.paused, this.handleManagerPaused);
    this.manager.on(PHASER_SOUND_EVENTS.resumed, this.handleManagerResumed);
    scene.game.events.on(PHASER_GAME_EVENTS.blur, this.handleGameBlur);
    scene.game.events.on(PHASER_GAME_EVENTS.focus, this.handleGameFocus);
  }

  get locked(): boolean {
    return this.available && this.manager.locked;
  }

  get suspended(): boolean {
    return this.gameSuspended;
  }

  hasAsset(assetId: string): boolean {
    return this.available && !this.destroyed && this.scene.cache.audio.exists(phaserAudioCacheKey(assetId));
  }

  createVoice(assetId: string): AudioPlaybackVoice | undefined {
    if (!this.hasAsset(assetId)) return undefined;
    try {
      let voice!: PhaserAudioPlaybackVoice;
      const sound = this.manager.add(phaserAudioCacheKey(assetId)) as PhaserVolumeSound;
      voice = new PhaserAudioPlaybackVoice(sound, () => {
        this.voices.delete(voice);
        this.removeHtml5BlurReference(sound);
      });
      this.voices.add(voice);
      return voice;
    } catch {
      return undefined;
    }
  }

  requestUnlock(): void {
    if (!this.available || this.destroyed || !this.locked) return;
    // Phaser's HTML5 fallback must install its touchend listener before the
    // first activation. It was armed in the constructor; installing it again
    // from the later synthetic click would miss that gesture and duplicate
    // loader listeners.
    if (this.html5UnlockArmed) return;
    this.manager.unlock?.();
  }

  subscribe(listener: (event: AudioPlaybackLifecycleEvent) => void): () => void {
    if (this.destroyed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.manager.off(PHASER_SOUND_EVENTS.unlocked, this.handleUnlocked);
    this.manager.off(PHASER_SOUND_EVENTS.paused, this.handleManagerPaused);
    this.manager.off(PHASER_SOUND_EVENTS.resumed, this.handleManagerResumed);
    this.scene.game.events.off(PHASER_GAME_EVENTS.blur, this.handleGameBlur);
    this.scene.game.events.off(PHASER_GAME_EVENTS.focus, this.handleGameFocus);
    for (const voice of [...this.voices]) voice.destroy();
    this.voices.clear();
    this.listeners.clear();
  }

  private emit(event: AudioPlaybackLifecycleEvent): void {
    if (this.destroyed) return;
    for (const listener of [...this.listeners]) listener(event);
  }

  private readonly handleUnlocked = (): void => this.emit("unlocked");

  private readonly handleManagerPaused = (): void => {
    if (this.gameSuspended) return;
    this.gameSuspended = true;
    this.emit("suspended");
  };

  private readonly handleManagerResumed = (): void => {
    if (!this.gameSuspended) return;
    this.gameSuspended = false;
    this.emit("resumed");
  };

  private readonly handleGameBlur = (): void => this.handleManagerPaused();
  private readonly handleGameFocus = (): void => this.handleManagerResumed();

  private removeHtml5BlurReference(sound: Phaser.Sound.BaseSound): void {
    const pausedSounds = this.manager.onBlurPausedSounds;
    if (!pausedSounds) return;
    // Phaser 3.90's HTML5 manager stores playing sounds before later game-blur
    // listeners run. The controller deliberately destroys stale one-shots in
    // that later listener; remove this exact owned reference so the manager
    // cannot call onFocus() on a destroyed sound during the next focus event.
    for (let index = pausedSounds.length - 1; index >= 0; index--) {
      if (pausedSounds[index] === sound) pausedSounds.splice(index, 1);
    }
  }
}

export function createPhaserAudioPlaybackPort(scene: Phaser.Scene): AudioPlaybackPort {
  return new PhaserAudioPlaybackPort(scene);
}

function soundIsAvailable(scene: Phaser.Scene): boolean {
  const audioConfig = scene.game.config.audio;
  const deviceAudio = scene.game.device.audio;
  return !audioConfig.noAudio && (deviceAudio.webAudio || deviceAudio.audioData);
}
