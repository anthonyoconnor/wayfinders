import {
  AUDIO_CATEGORIES,
  type AudioCatalog,
  type AudioCategory,
  type AudioMixer,
  type AudioMixerSnapshot,
} from "../../audio";
import type {
  AudioPlaybackLifecycleEvent,
  AudioPlaybackPort,
  AudioPlaybackVoice,
} from "./AudioPlaybackPort";

export type GameAudioUnlockState =
  | "locked"
  | "unlocking"
  | "unlocked"
  | "unavailable"
  | "destroyed";

export type GameAudioPlayRejectionReason =
  | "destroyed"
  | "unavailable"
  | "locked"
  | "suspended"
  | "unknown-asset"
  | "asset-unavailable"
  | "invalid-request"
  | "duplicate-voice-id"
  | "category-limit"
  | "total-limit"
  | "playback-failed";

export interface GameAudioPlayRequest {
  readonly assetId: string;
  /** Stable identity for a long-lived layer; generated when omitted. */
  readonly voiceId?: string;
  /** Integer from 0 through 1000. Higher priority may replace an older voice. */
  readonly priority?: number;
  /** Additional clamped gain used by fades and continuous layers. */
  readonly transitionGain?: number;
}

export type GameAudioPlayResult =
  | Readonly<{
    kind: "started";
    voiceId: string;
    replacedVoiceId?: string;
  }>
  | Readonly<{
    kind: "retained";
    voiceId: string;
  }>
  | Readonly<{
    kind: "rejected";
    reason: GameAudioPlayRejectionReason;
  }>;

export interface GameAudioCategorySnapshot {
  readonly id: AudioCategory;
  readonly displayName: string;
  readonly volume: number;
  readonly voiceLimit: number;
  readonly activeVoices: number;
}

export interface GameAudioOwnedVoiceSnapshot {
  readonly voiceId: string;
  readonly assetId: string;
  readonly category: AudioCategory;
  readonly loop: boolean;
  readonly priority: number;
  readonly transitionGain: number;
  readonly effectiveGain: number;
}

export interface GameAudioDiagnostics {
  readonly activeVoiceCount: number;
  readonly ownedLoopCount: number;
  readonly peakActiveVoiceCount: number;
  readonly playAttempts: number;
  readonly startedVoices: number;
  readonly rejectedPlays: number;
  readonly stoppedVoices: number;
  readonly playbackErrors: number;
  readonly lastRejection?: GameAudioPlayRejectionReason;
  readonly unavailableAssetIds: readonly string[];
  readonly activeVoices: readonly Readonly<GameAudioOwnedVoiceSnapshot>[];
}

export interface GameAudioSnapshot {
  readonly unlockState: GameAudioUnlockState;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly browserLocked: boolean;
  readonly suspended: boolean;
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly categories: Readonly<Record<AudioCategory, Readonly<GameAudioCategorySnapshot>>>;
  readonly mixer: Readonly<AudioMixerSnapshot>;
  readonly diagnostics: Readonly<GameAudioDiagnostics>;
}

export interface GameAudioControllerOptions {
  readonly catalog: Readonly<AudioCatalog>;
  readonly mixer: AudioMixer;
  readonly playback: AudioPlaybackPort;
}

interface OwnedVoice {
  readonly voiceId: string;
  readonly assetId: string;
  readonly category: AudioCategory;
  readonly loop: boolean;
  readonly priority: number;
  readonly playback: AudioPlaybackVoice;
  transitionGain: number;
  removeEndedListener: () => void;
}

/**
 * Owns game audio voices and lifecycle without knowing about simulation state.
 * Discrete events missed while locked, suspended, or unavailable are rejected
 * immediately and are never queued for later playback.
 */
export class GameAudioController {
  private readonly catalog: Readonly<AudioCatalog>;
  private readonly mixer: AudioMixer;
  private readonly playback: AudioPlaybackPort;
  private readonly assetsById: ReadonlyMap<string, Readonly<AudioCatalog["assets"][number]>>;
  private readonly voices = new Map<string, OwnedVoice>();
  private readonly subscribers = new Set<(snapshot: Readonly<GameAudioSnapshot>) => void>();
  private readonly unavailableAssetIds = new Set<string>();
  private removePlaybackListener: () => void;

  private enabled = false;
  private unlockPending = false;
  private suspended: boolean;
  private destroyed = false;
  private nextVoiceId = 1;
  private peakActiveVoiceCount = 0;
  private playAttempts = 0;
  private startedVoices = 0;
  private rejectedPlays = 0;
  private stoppedVoices = 0;
  private playbackErrors = 0;
  private lastRejection?: GameAudioPlayRejectionReason;

  constructor(options: Readonly<GameAudioControllerOptions>) {
    this.catalog = options.catalog;
    this.mixer = options.mixer;
    this.playback = options.playback;
    this.assetsById = new Map(options.catalog.assets.map((asset) => [asset.id, asset]));
    this.suspended = options.playback.suspended;
    this.removePlaybackListener = options.playback.subscribe(this.handlePlaybackEvent);
  }

  getSnapshot(): Readonly<GameAudioSnapshot> {
    const mixer = this.mixer.getSnapshot();
    const activeVoices = Object.freeze([...this.voices.values()].map((voice) => Object.freeze({
      voiceId: voice.voiceId,
      assetId: voice.assetId,
      category: voice.category,
      loop: voice.loop,
      priority: voice.priority,
      transitionGain: voice.transitionGain,
      effectiveGain: this.mixer.effectiveGain(voice.assetId, voice.transitionGain),
    })));
    const categories = categoryRecord((category): Readonly<GameAudioCategorySnapshot> => Object.freeze({
      id: category,
      displayName: this.catalog.categories[category].displayName,
      volume: mixer.categoryVolumes[category],
      voiceLimit: mixer.categoryVoiceLimits[category],
      activeVoices: mixer.activeVoicesByCategory[category],
    }));

    return Object.freeze({
      unlockState: this.unlockState(),
      enabled: this.enabled,
      available: this.playback.available,
      browserLocked: this.playback.locked,
      suspended: this.suspended,
      muted: mixer.muted,
      masterVolume: mixer.masterVolume,
      categories: Object.freeze(categories),
      mixer,
      diagnostics: Object.freeze({
        activeVoiceCount: activeVoices.length,
        ownedLoopCount: activeVoices.filter(({ loop }) => loop).length,
        peakActiveVoiceCount: this.peakActiveVoiceCount,
        playAttempts: this.playAttempts,
        startedVoices: this.startedVoices,
        rejectedPlays: this.rejectedPlays,
        stoppedVoices: this.stoppedVoices,
        playbackErrors: this.playbackErrors,
        ...(this.lastRejection ? { lastRejection: this.lastRejection } : {}),
        unavailableAssetIds: Object.freeze([...this.unavailableAssetIds].sort()),
        activeVoices,
      }),
    });
  }

  subscribe(listener: (snapshot: Readonly<GameAudioSnapshot>) => void): () => void {
    if (this.destroyed) return () => undefined;
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Must be invoked from an explicit player action. */
  enableSound(): void {
    if (this.destroyed || !this.playback.available || this.enabled || this.unlockPending) return;
    this.unlockPending = true;
    if (!this.playback.locked) {
      this.completeUnlock();
      return;
    }

    this.notify();
    try {
      const result = this.playback.requestUnlock();
      void Promise.resolve(result).then(
        () => {
          if (!this.destroyed && !this.playback.locked) this.completeUnlock();
        },
        () => this.failUnlock(),
      );
    } catch {
      this.failUnlock();
    }
  }

  setMuted(muted: boolean): void {
    if (this.destroyed) return;
    if (this.mixer.setMuted(muted).kind === "none") return;
    this.reconcileVoiceGains();
    this.notify();
  }

  setMasterVolume(volume: number): void {
    if (this.destroyed) return;
    if (this.mixer.setMasterVolume(volume).kind === "none") return;
    this.reconcileVoiceGains();
    this.notify();
  }

  setCategoryVolume(category: AudioCategory, volume: number): void {
    if (this.destroyed) return;
    if (this.mixer.setCategoryVolume(category, volume).kind === "none") return;
    this.reconcileVoiceGains();
    this.notify();
  }

  play(request: Readonly<GameAudioPlayRequest>): GameAudioPlayResult {
    this.playAttempts++;
    const blocked = this.playBlockReason();
    if (blocked) return this.reject(blocked);

    const asset = this.assetsById.get(request.assetId);
    if (!asset) return this.reject("unknown-asset");
    const voiceId = request.voiceId ?? `game-audio-${this.nextVoiceId++}`;
    const priority = request.priority ?? 0;
    const transitionGain = finiteClampedGain(request.transitionGain ?? 1);
    if (
      !validVoiceId(voiceId)
      || !Number.isSafeInteger(priority)
      || priority < 0
      || priority > 1_000
      || transitionGain === undefined
    ) {
      return this.reject("invalid-request");
    }

    const existing = this.voices.get(voiceId);
    if (existing) {
      if (existing.assetId !== asset.id) return this.reject("duplicate-voice-id");
      this.setVoiceTransitionGain(voiceId, transitionGain);
      return Object.freeze({ kind: "retained", voiceId });
    }

    if (!this.playbackHasAsset(asset.id)) {
      this.unavailableAssetIds.add(asset.id);
      return this.reject("asset-unavailable");
    }

    const playbackVoice = this.createPlaybackVoice(asset.id);
    if (!playbackVoice) {
      this.unavailableAssetIds.add(asset.id);
      return this.reject("asset-unavailable");
    }

    const decision = this.mixer.requestVoice({ voiceId, assetId: asset.id, priority });
    if (decision.kind === "rejected") {
      this.safeDestroyUnownedVoice(playbackVoice);
      return this.reject(decision.reason);
    }
    if (decision.kind === "replaced") this.releaseOwnedVoice(decision.replacedVoiceId, true);

    const owned: OwnedVoice = {
      voiceId,
      assetId: asset.id,
      category: asset.category,
      loop: asset.loop,
      priority,
      transitionGain,
      playback: playbackVoice,
      removeEndedListener: () => undefined,
    };
    owned.removeEndedListener = playbackVoice.onEnded(() => this.handleVoiceEnded(voiceId));
    this.voices.set(voiceId, owned);

    let started = false;
    try {
      started = playbackVoice.play({
        loop: asset.loop,
        volume: this.mixer.effectiveGain(asset.id, transitionGain),
      });
    } catch {
      this.playbackErrors++;
    }
    if (!started) {
      this.releaseOwnedVoice(voiceId, true);
      return this.reject("playback-failed");
    }

    this.startedVoices++;
    this.peakActiveVoiceCount = Math.max(this.peakActiveVoiceCount, this.voices.size);
    this.notify();
    return Object.freeze({
      kind: "started",
      voiceId,
      ...(decision.kind === "replaced" ? { replacedVoiceId: decision.replacedVoiceId } : {}),
    });
  }

  setVoiceTransitionGain(voiceId: string, transitionGain: number): boolean {
    if (this.destroyed) return false;
    const gain = finiteClampedGain(transitionGain);
    if (gain === undefined) return false;
    const voice = this.voices.get(voiceId);
    if (!voice || Object.is(voice.transitionGain, gain)) return false;
    voice.transitionGain = gain;
    if (!this.setPlaybackVoiceVolume(voice)) this.releaseOwnedVoice(voiceId, true);
    this.notify();
    return true;
  }

  stopVoice(voiceId: string): boolean {
    if (this.destroyed || !this.voices.has(voiceId)) return false;
    this.releaseOwnedVoice(voiceId, true);
    this.notify();
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.unlockPending = false;
    this.removePlaybackListener();
    this.removePlaybackListener = () => undefined;
    for (const voiceId of [...this.voices.keys()]) this.releaseOwnedVoice(voiceId, true);
    this.mixer.clearVoices();
    try {
      this.playback.destroy();
    } catch {
      this.playbackErrors++;
    }
    this.notify();
    this.subscribers.clear();
  }

  private unlockState(): GameAudioUnlockState {
    if (this.destroyed) return "destroyed";
    if (!this.playback.available) return "unavailable";
    if (this.enabled) return "unlocked";
    return this.unlockPending ? "unlocking" : "locked";
  }

  private playBlockReason(): GameAudioPlayRejectionReason | undefined {
    if (this.destroyed) return "destroyed";
    if (!this.playback.available) return "unavailable";
    if (!this.enabled || this.playback.locked) return "locked";
    if (this.suspended) return "suspended";
    return undefined;
  }

  private readonly handlePlaybackEvent = (event: AudioPlaybackLifecycleEvent): void => {
    if (this.destroyed) return;
    if (event === "unlocked") {
      if (this.unlockPending) this.completeUnlock();
      else this.notify();
      return;
    }
    if (event === "suspended") {
      if (this.suspended) return;
      this.suspended = true;
      // A short cue should not resume out of context after focus returns.
      for (const voice of [...this.voices.values()]) {
        if (!voice.loop) this.releaseOwnedVoice(voice.voiceId, true);
      }
      this.notify();
      return;
    }
    if (!this.suspended) return;
    this.suspended = false;
    // Phaser resumes retained loops. Events missed while suspended were never queued.
    this.notify();
  };

  private completeUnlock(): void {
    if (this.destroyed || !this.playback.available) return;
    this.enabled = true;
    this.unlockPending = false;
    this.notify();
  }

  private failUnlock(): void {
    if (this.destroyed) return;
    this.unlockPending = false;
    this.playbackErrors++;
    this.notify();
  }

  private handleVoiceEnded(voiceId: string): void {
    if (!this.voices.has(voiceId)) return;
    this.releaseOwnedVoice(voiceId, false);
    this.notify();
  }

  private releaseOwnedVoice(voiceId: string, stop: boolean): void {
    const voice = this.voices.get(voiceId);
    if (!voice) {
      this.mixer.releaseVoice(voiceId);
      return;
    }
    this.voices.delete(voiceId);
    this.mixer.releaseVoice(voiceId);
    voice.removeEndedListener();
    if (stop) {
      try {
        voice.playback.stop();
      } catch {
        this.playbackErrors++;
      }
    }
    try {
      voice.playback.destroy();
    } catch {
      this.playbackErrors++;
    }
    this.stoppedVoices++;
  }

  private reconcileVoiceGains(): void {
    for (const voice of [...this.voices.values()]) {
      if (!this.setPlaybackVoiceVolume(voice)) this.releaseOwnedVoice(voice.voiceId, true);
    }
  }

  private setPlaybackVoiceVolume(voice: OwnedVoice): boolean {
    try {
      voice.playback.setVolume(this.mixer.effectiveGain(voice.assetId, voice.transitionGain));
      return true;
    } catch {
      this.playbackErrors++;
      return false;
    }
  }

  private playbackHasAsset(assetId: string): boolean {
    try {
      return this.playback.hasAsset(assetId);
    } catch {
      this.playbackErrors++;
      return false;
    }
  }

  private createPlaybackVoice(assetId: string): AudioPlaybackVoice | undefined {
    try {
      return this.playback.createVoice(assetId);
    } catch {
      this.playbackErrors++;
      return undefined;
    }
  }

  private safeDestroyUnownedVoice(voice: AudioPlaybackVoice): void {
    try {
      voice.destroy();
    } catch {
      this.playbackErrors++;
    }
  }

  private reject(reason: GameAudioPlayRejectionReason): GameAudioPlayResult {
    this.rejectedPlays++;
    this.lastRejection = reason;
    this.notify();
    return Object.freeze({ kind: "rejected", reason });
  }

  private notify(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const subscriber of [...this.subscribers]) subscriber(snapshot);
  }
}

function categoryRecord<T>(value: (category: AudioCategory) => T): Record<AudioCategory, T> {
  return {
    music: value(AUDIO_CATEGORIES[0]),
    ambience: value(AUDIO_CATEGORIES[1]),
    sfx: value(AUDIO_CATEGORIES[2]),
    ui: value(AUDIO_CATEGORIES[3]),
  };
}

function validVoiceId(value: string): boolean {
  return value.length > 0 && value.length <= 160 && value.trim() === value;
}

function finiteClampedGain(value: number): number | undefined {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}
