import {
  SAILING_AMBIENCE_GAIN_EPSILON,
  SailingAmbienceState,
  type SailingAmbienceInput,
  type SailingAmbienceStateSnapshot,
} from "../../audio";
import type {
  GameAudioPlayRequest,
  GameAudioPlayResult,
} from "./GameAudioController";

export const OCEAN_AMBIENCE_VOICE_ID = "ambience:ocean";
export const WAKE_AMBIENCE_VOICE_ID = "ambience:wake";

const OCEAN_ASSET_ID = "ambience.ocean";
const WAKE_ASSET_ID = "ambience.wake";
const OCEAN_PRIORITY = 900;
const WAKE_PRIORITY = 800;

export interface SailingAmbienceAudioSnapshot {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly suspended: boolean;
  readonly diagnostics: Readonly<{
    activeVoices: readonly Readonly<{ voiceId: string }>[];
  }>;
}

export interface SailingAmbienceAudioTarget {
  getSnapshot(): Readonly<SailingAmbienceAudioSnapshot>;
  subscribe(listener: (snapshot: Readonly<SailingAmbienceAudioSnapshot>) => void): () => void;
  play(request: Readonly<GameAudioPlayRequest>): GameAudioPlayResult;
  setVoiceTransitionGain(voiceId: string, transitionGain: number): boolean;
  stopVoice(voiceId: string): boolean;
}

export interface SailingAmbienceDiagnostics {
  readonly state: Readonly<SailingAmbienceStateSnapshot>;
  readonly activeVoiceCount: number;
  readonly peakActiveVoiceCount: number;
  readonly oceanVoiceActive: boolean;
  readonly wakeVoiceActive: boolean;
  readonly oceanStarts: number;
  readonly wakeStarts: number;
  readonly wakeStops: number;
}

/** Adapts the pure sailing state onto two controller-owned Phaser loops. */
export class SailingAmbienceController {
  private readonly state = new SailingAmbienceState();
  private readonly removeAudioListener: () => void;

  private audioReady = false;
  private audioSuspended = false;
  private oceanVoiceActive = false;
  private wakeVoiceActive = false;
  private oceanStartBlocked = false;
  private wakeStartBlocked = false;
  private oceanAppliedGain = Number.NaN;
  private wakeAppliedGain = Number.NaN;
  private peakActiveVoiceCount = 0;
  private oceanStarts = 0;
  private wakeStarts = 0;
  private wakeStops = 0;
  private destroyed = false;

  constructor(private readonly audio: SailingAmbienceAudioTarget) {
    this.captureAudioSnapshot(audio.getSnapshot());
    this.removeAudioListener = audio.subscribe(this.captureAudioSnapshot);
  }

  update(
    input: Readonly<SailingAmbienceInput>,
    deltaSeconds: number,
  ): Readonly<SailingAmbienceStateSnapshot> {
    const state = this.state.update(input, deltaSeconds);
    if (this.destroyed || !this.audioReady || this.audioSuspended) return state;

    this.reconcileOcean(state);
    this.reconcileWake(state);
    this.recordPeak();
    return state;
  }

  getSnapshot(): Readonly<SailingAmbienceDiagnostics> {
    return Object.freeze({
      state: this.state.getSnapshot(),
      activeVoiceCount: Number(this.oceanVoiceActive) + Number(this.wakeVoiceActive),
      peakActiveVoiceCount: this.peakActiveVoiceCount,
      oceanVoiceActive: this.oceanVoiceActive,
      wakeVoiceActive: this.wakeVoiceActive,
      oceanStarts: this.oceanStarts,
      wakeStarts: this.wakeStarts,
      wakeStops: this.wakeStops,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.removeAudioListener();
    if (this.wakeVoiceActive && this.audio.stopVoice(WAKE_AMBIENCE_VOICE_ID)) this.wakeStops++;
    if (this.oceanVoiceActive) this.audio.stopVoice(OCEAN_AMBIENCE_VOICE_ID);
    this.oceanVoiceActive = false;
    this.wakeVoiceActive = false;
    this.oceanAppliedGain = Number.NaN;
    this.wakeAppliedGain = Number.NaN;
  }

  private readonly captureAudioSnapshot = (snapshot: Readonly<SailingAmbienceAudioSnapshot>): void => {
    if (this.destroyed) return;
    const wasReady = this.audioReady;
    this.audioReady = snapshot.available && snapshot.enabled;
    this.audioSuspended = snapshot.suspended;

    let oceanActive = false;
    let wakeActive = false;
    for (const voice of snapshot.diagnostics.activeVoices) {
      if (voice.voiceId === OCEAN_AMBIENCE_VOICE_ID) oceanActive = true;
      else if (voice.voiceId === WAKE_AMBIENCE_VOICE_ID) wakeActive = true;
    }
    if (this.oceanVoiceActive && !oceanActive) {
      this.oceanAppliedGain = Number.NaN;
      this.oceanStartBlocked = false;
    }
    if (this.wakeVoiceActive && !wakeActive) {
      this.wakeAppliedGain = Number.NaN;
      this.wakeStartBlocked = false;
    }
    this.oceanVoiceActive = oceanActive;
    this.wakeVoiceActive = wakeActive;

    if (this.audioReady && !wasReady) {
      this.oceanStartBlocked = false;
      this.wakeStartBlocked = false;
    }
  };

  private reconcileOcean(state: Readonly<SailingAmbienceStateSnapshot>): void {
    if (!this.oceanVoiceActive) {
      if (this.oceanStartBlocked) return;
      const result = this.audio.play({
        assetId: OCEAN_ASSET_ID,
        voiceId: OCEAN_AMBIENCE_VOICE_ID,
        priority: OCEAN_PRIORITY,
        transitionGain: state.oceanCurrentGain,
      });
      if (result.kind === "rejected") {
        this.oceanStartBlocked = true;
        return;
      }
      this.oceanVoiceActive = true;
      this.oceanAppliedGain = state.oceanCurrentGain;
      if (result.kind === "started") this.oceanStarts++;
      return;
    }
    if (Math.abs(this.oceanAppliedGain - state.oceanCurrentGain) <= SAILING_AMBIENCE_GAIN_EPSILON) return;
    if (this.audio.setVoiceTransitionGain(OCEAN_AMBIENCE_VOICE_ID, state.oceanCurrentGain)) {
      this.oceanAppliedGain = state.oceanCurrentGain;
    }
  }

  private reconcileWake(state: Readonly<SailingAmbienceStateSnapshot>): void {
    if (!this.wakeVoiceActive) {
      if (!state.wakeEngaged || this.wakeStartBlocked) return;
      const result = this.audio.play({
        assetId: WAKE_ASSET_ID,
        voiceId: WAKE_AMBIENCE_VOICE_ID,
        priority: WAKE_PRIORITY,
        transitionGain: state.wakeCurrentGain,
      });
      if (result.kind === "rejected") {
        this.wakeStartBlocked = true;
        return;
      }
      this.wakeVoiceActive = true;
      this.wakeAppliedGain = state.wakeCurrentGain;
      if (result.kind === "started") this.wakeStarts++;
      return;
    }

    if (!state.wakeEngaged && state.wakeCurrentGain <= SAILING_AMBIENCE_GAIN_EPSILON) {
      if (this.audio.stopVoice(WAKE_AMBIENCE_VOICE_ID)) this.wakeStops++;
      this.wakeVoiceActive = false;
      this.wakeAppliedGain = Number.NaN;
      this.wakeStartBlocked = false;
      return;
    }

    if (Math.abs(this.wakeAppliedGain - state.wakeCurrentGain) <= SAILING_AMBIENCE_GAIN_EPSILON) return;
    if (this.audio.setVoiceTransitionGain(WAKE_AMBIENCE_VOICE_ID, state.wakeCurrentGain)) {
      this.wakeAppliedGain = state.wakeCurrentGain;
    }
  }

  private recordPeak(): void {
    this.peakActiveVoiceCount = Math.max(
      this.peakActiveVoiceCount,
      Number(this.oceanVoiceActive) + Number(this.wakeVoiceActive),
    );
  }
}
