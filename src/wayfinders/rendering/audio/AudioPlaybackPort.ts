/**
 * The presentation controller depends on this small surface instead of Phaser.
 * Tests and non-audio environments can supply deterministic implementations.
 */
export type AudioPlaybackLifecycleEvent = "unlocked" | "suspended" | "resumed";

export interface AudioPlaybackVoiceConfig {
  readonly loop: boolean;
  readonly volume: number;
}

export interface AudioPlaybackVoice {
  play(config: Readonly<AudioPlaybackVoiceConfig>): boolean;
  pause(): boolean;
  resume(): boolean;
  stop(): boolean;
  setVolume(volume: number): void;
  onEnded(listener: () => void): () => void;
  destroy(): void;
}

export interface AudioPlaybackPort {
  /** False for Phaser's no-audio manager or another unsupported environment. */
  readonly available: boolean;
  /** The browser/manager lock, independent of the game's explicit enable choice. */
  readonly locked: boolean;
  /** True while the game is blurred or playback has otherwise been suspended. */
  readonly suspended: boolean;

  hasAsset(assetId: string): boolean;
  createVoice(assetId: string): AudioPlaybackVoice | undefined;
  requestUnlock(): void | Promise<void>;
  subscribe(listener: (event: AudioPlaybackLifecycleEvent) => void): () => void;

  /** Removes adapter listeners only; it must not destroy Phaser's global manager. */
  destroy(): void;
}
