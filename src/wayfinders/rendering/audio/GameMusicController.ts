import {
  MUSIC_GAIN_EPSILON,
  MusicState,
  type MusicDuckReason,
  type MusicStateSnapshot,
} from "../../audio";
import type { GameEvents } from "../../core/GameEvents";
import type {
  GameAudioPlayRequest,
  GameAudioPlayResult,
} from "./GameAudioController";

export const HOME_HARBOR_MUSIC_VOICE_ID = "music:home-harbor";
export const OPEN_WATER_MUSIC_VOICE_ID = "music:open-water";

const HOME_HARBOR_ASSET_ID = "music.home-harbor";
const OPEN_WATER_ASSET_ID = "music.open-water";
const MUSIC_PRIORITY = 700;

const DUCK_PRIORITY: Readonly<Record<MusicDuckReason, number>> = Object.freeze({
  none: 0,
  return: 100,
  wreck: 200,
  succession: 300,
  completion: 400,
});

const DUCK_HOLD_SECONDS: Readonly<Record<Exclude<MusicDuckReason, "none">, number>> = Object.freeze({
  return: 0.8,
  wreck: 1,
  succession: 1.25,
  completion: 1.5,
});

export interface GameMusicAudioSnapshot {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly suspended: boolean;
  readonly diagnostics: Readonly<{
    activeVoices: readonly Readonly<{ voiceId: string }>[];
  }>;
}

export interface GameMusicAudioTarget {
  getSnapshot(): Readonly<GameMusicAudioSnapshot>;
  subscribe(listener: (snapshot: Readonly<GameMusicAudioSnapshot>) => void): () => void;
  play(request: Readonly<GameAudioPlayRequest>): GameAudioPlayResult;
  setVoiceTransitionGain(voiceId: string, transitionGain: number): boolean;
  stopVoice(voiceId: string): boolean;
}

export interface GameMusicDiagnostics {
  readonly state: Readonly<MusicStateSnapshot>;
  readonly activeVoiceCount: number;
  readonly peakActiveVoiceCount: number;
  readonly homeVoiceActive: boolean;
  readonly openWaterVoiceActive: boolean;
  readonly starts: number;
  readonly stops: number;
  readonly crossfades: number;
  readonly duckTriggers: Readonly<Record<Exclude<MusicDuckReason, "none">, number>>;
  readonly transientDuckReason: MusicDuckReason;
  readonly transientDuckSecondsRemaining: number;
}

export interface GameMusicInput {
  atDock: boolean;
  inSupportedWater: boolean;
  expeditionActive: boolean;
  homeInteractionActive: boolean;
  lifecycleDuckReason: MusicDuckReason;
}

interface MusicVoiceState {
  active: boolean;
  startBlocked: boolean;
  appliedGain: number;
}

/** Owns two stable score voices and adapts lifecycle events to bounded ducking. */
export class GameMusicController {
  private readonly state = new MusicState();
  private readonly removeAudioListener: () => void;
  private readonly eventUnsubscribers: Array<() => void>;
  private readonly homeVoice: MusicVoiceState = voiceState();
  private readonly openWaterVoice: MusicVoiceState = voiceState();
  private readonly stateInput = {
    atDock: true,
    inSupportedWater: true,
    expeditionActive: false,
    homeInteractionActive: false,
    duckReason: "none" as MusicDuckReason,
  };
  private readonly duckTriggers = {
    return: 0,
    wreck: 0,
    succession: 0,
    completion: 0,
  };

  private audioReady = false;
  private audioSuspended = false;
  private transientDuckReason: MusicDuckReason = "none";
  private transientDuckSecondsRemaining = 0;
  private lastSelectedState = this.state.getSnapshot().stateId;
  private peakActiveVoiceCount = 0;
  private starts = 0;
  private stops = 0;
  private crossfades = 0;
  private destroyed = false;

  constructor(
    private readonly audio: GameMusicAudioTarget,
    events: GameEvents,
  ) {
    this.captureAudioSnapshot(audio.getSnapshot());
    this.removeAudioListener = audio.subscribe(this.captureAudioSnapshot);
    this.eventUnsubscribers = [
      events.on("expeditionReturned", () => this.triggerDuck("return")),
      events.on("shipWrecked", () => this.triggerDuck("wreck")),
      events.on("navigatorTenureCompleted", () => this.triggerDuck("succession")),
      events.on("gameCompleted", () => this.triggerDuck("completion")),
      events.on("completedWorldContinued", () => this.releaseDuck("completion")),
      events.on("worldRegenerated", () => this.releaseDuck()),
    ];
  }

  releaseDuck(reason?: Exclude<MusicDuckReason, "none">): void {
    if (this.destroyed || (reason && this.transientDuckReason !== reason)) return;
    this.transientDuckReason = "none";
    this.transientDuckSecondsRemaining = 0;
  }

  update(
    input: Readonly<GameMusicInput>,
    deltaSeconds: number,
  ): Readonly<MusicStateSnapshot> {
    const safeDeltaSeconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    const effectiveDuckReason = higherPriorityReason(
      input.lifecycleDuckReason,
      this.transientDuckReason,
    );
    this.stateInput.atDock = input.atDock;
    this.stateInput.inSupportedWater = input.inSupportedWater;
    this.stateInput.expeditionActive = input.expeditionActive;
    this.stateInput.homeInteractionActive = input.homeInteractionActive;
    this.stateInput.duckReason = effectiveDuckReason;
    const snapshot = this.state.update(this.stateInput, safeDeltaSeconds);

    if (snapshot.stateId !== this.lastSelectedState) {
      this.lastSelectedState = snapshot.stateId;
      this.crossfades++;
    }
    this.advanceTransientDuck(safeDeltaSeconds);
    if (this.destroyed || !this.audioReady || this.audioSuspended) return snapshot;

    this.reconcileTrack(
      HOME_HARBOR_MUSIC_VOICE_ID,
      HOME_HARBOR_ASSET_ID,
      this.homeVoice,
      snapshot.homeStateGain,
      snapshot.homeCurrentGain,
    );
    this.reconcileTrack(
      OPEN_WATER_MUSIC_VOICE_ID,
      OPEN_WATER_ASSET_ID,
      this.openWaterVoice,
      snapshot.openWaterStateGain,
      snapshot.openWaterCurrentGain,
    );
    this.peakActiveVoiceCount = Math.max(
      this.peakActiveVoiceCount,
      Number(this.homeVoice.active) + Number(this.openWaterVoice.active),
    );
    return snapshot;
  }

  getSnapshot(): Readonly<GameMusicDiagnostics> {
    return Object.freeze({
      state: this.state.getSnapshot(),
      activeVoiceCount: Number(this.homeVoice.active) + Number(this.openWaterVoice.active),
      peakActiveVoiceCount: this.peakActiveVoiceCount,
      homeVoiceActive: this.homeVoice.active,
      openWaterVoiceActive: this.openWaterVoice.active,
      starts: this.starts,
      stops: this.stops,
      crossfades: this.crossfades,
      duckTriggers: Object.freeze({ ...this.duckTriggers }),
      transientDuckReason: this.transientDuckReason,
      transientDuckSecondsRemaining: this.transientDuckSecondsRemaining,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const unsubscribe of this.eventUnsubscribers) unsubscribe();
    this.eventUnsubscribers.length = 0;
    this.removeAudioListener();
    this.stopTrack(HOME_HARBOR_MUSIC_VOICE_ID, this.homeVoice);
    this.stopTrack(OPEN_WATER_MUSIC_VOICE_ID, this.openWaterVoice);
  }

  private triggerDuck(reason: Exclude<MusicDuckReason, "none">): void {
    if (this.destroyed) return;
    this.duckTriggers[reason]++;
    if (DUCK_PRIORITY[reason] < DUCK_PRIORITY[this.transientDuckReason]) return;
    this.transientDuckReason = reason;
    this.transientDuckSecondsRemaining = DUCK_HOLD_SECONDS[reason];
  }

  private advanceTransientDuck(deltaSeconds: number): void {
    if (this.transientDuckReason === "none" || deltaSeconds <= 0) return;
    this.transientDuckSecondsRemaining = Math.max(
      0,
      this.transientDuckSecondsRemaining - deltaSeconds,
    );
    if (this.transientDuckSecondsRemaining > 0) return;
    this.transientDuckReason = "none";
  }

  private readonly captureAudioSnapshot = (snapshot: Readonly<GameMusicAudioSnapshot>): void => {
    if (this.destroyed) return;
    const wasReady = this.audioReady;
    this.audioReady = snapshot.available && snapshot.enabled;
    this.audioSuspended = snapshot.suspended;
    const homeActive = hasVoice(snapshot, HOME_HARBOR_MUSIC_VOICE_ID);
    const openWaterActive = hasVoice(snapshot, OPEN_WATER_MUSIC_VOICE_ID);
    reconcileObservedVoice(this.homeVoice, homeActive);
    reconcileObservedVoice(this.openWaterVoice, openWaterActive);
    if (this.audioReady && !wasReady) {
      this.homeVoice.startBlocked = false;
      this.openWaterVoice.startBlocked = false;
    }
  };

  private reconcileTrack(
    voiceId: string,
    assetId: string,
    voice: MusicVoiceState,
    stateGain: number,
    outputGain: number,
  ): void {
    if (stateGain <= MUSIC_GAIN_EPSILON) {
      this.stopTrack(voiceId, voice);
      return;
    }
    if (!voice.active) {
      if (voice.startBlocked) return;
      const result = this.audio.play({
        assetId,
        voiceId,
        priority: MUSIC_PRIORITY,
        transitionGain: outputGain,
      });
      if (result.kind === "rejected") {
        voice.startBlocked = true;
        return;
      }
      voice.active = true;
      voice.appliedGain = outputGain;
      if (result.kind === "started") this.starts++;
      return;
    }
    if (Math.abs(voice.appliedGain - outputGain) <= MUSIC_GAIN_EPSILON) return;
    if (this.audio.setVoiceTransitionGain(voiceId, outputGain)) voice.appliedGain = outputGain;
  }

  private stopTrack(voiceId: string, voice: MusicVoiceState): void {
    if (voice.active && this.audio.stopVoice(voiceId)) this.stops++;
    voice.active = false;
    voice.startBlocked = false;
    voice.appliedGain = Number.NaN;
  }
}

function voiceState(): MusicVoiceState {
  return { active: false, startBlocked: false, appliedGain: Number.NaN };
}

function hasVoice(snapshot: Readonly<GameMusicAudioSnapshot>, voiceId: string): boolean {
  return snapshot.diagnostics.activeVoices.some((voice) => voice.voiceId === voiceId);
}

function reconcileObservedVoice(voice: MusicVoiceState, active: boolean): void {
  if (voice.active && !active) {
    voice.appliedGain = Number.NaN;
    voice.startBlocked = false;
  }
  voice.active = active;
}

function higherPriorityReason(left: MusicDuckReason, right: MusicDuckReason): MusicDuckReason {
  return DUCK_PRIORITY[left] >= DUCK_PRIORITY[right] ? left : right;
}
