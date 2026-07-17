import {
  AudioCuePolicy,
  type ActiveAudioCueVoice,
  type AudioCueFamily,
  type AudioCueSource,
  type AudioUiCueAction,
} from "../../audio";
import type { GameEvents } from "../../core/GameEvents";
import type {
  GameAudioPlayRequest,
  GameAudioPlayResult,
} from "./GameAudioController";

const MAX_PENDING_SOURCES = 32;
const MAX_RECENT_DECISIONS = 16;

export interface GameAudioCueAudioSnapshot {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly suspended: boolean;
  readonly diagnostics: Readonly<{
    activeVoices: readonly Readonly<{ voiceId: string }>[];
  }>;
}

export interface GameAudioCueAudioTarget {
  getSnapshot(): Readonly<GameAudioCueAudioSnapshot>;
  subscribe(listener: (snapshot: Readonly<GameAudioCueAudioSnapshot>) => void): () => void;
  play(request: Readonly<GameAudioPlayRequest>): GameAudioPlayResult;
  stopVoice(voiceId: string): boolean;
}

export interface GameAudioCueControllerOptions {
  readonly now?: () => number;
  readonly scheduleMicrotask?: (task: () => void) => void;
  readonly policy?: AudioCuePolicy;
}

export interface GameAudioCueDecisionRecord {
  readonly atMs: number;
  readonly kind: "played" | "suppressed" | "rejected";
  readonly sourceCount: number;
  readonly source?: AudioCueSource;
  readonly family?: AudioCueFamily;
  readonly assetId?: string;
  readonly voiceId?: string;
  readonly reason?: string;
}

export interface GameAudioCueDiagnostics {
  readonly pendingSourceCount: number;
  readonly activeCueCount: number;
  readonly peakActiveCueCount: number;
  readonly processedBatches: number;
  readonly playedCues: number;
  readonly suppressedBatches: number;
  readonly rejectedCues: number;
  readonly droppedSources: number;
  readonly recentDecisions: readonly Readonly<GameAudioCueDecisionRecord>[];
}

interface OwnedCueVoice extends ActiveAudioCueVoice {
  readonly assetId: string;
}

/** Batches synchronous game events and adapts one pure cue decision to playback. */
export class GameAudioCueController {
  private readonly policy: AudioCuePolicy;
  private readonly now: () => number;
  private readonly scheduleMicrotask: (task: () => void) => void;
  private readonly eventUnsubscribers: Array<() => void>;
  private readonly removeAudioListener: () => void;
  private readonly pendingSources: AudioCueSource[] = [];
  private readonly activeVoices = new Map<string, OwnedCueVoice>();
  private readonly recentDecisions: GameAudioCueDecisionRecord[] = [];

  private audioReady = false;
  private audioSuspended = false;
  private flushScheduled = false;
  private destroyed = false;
  private nextVoiceId = 1;
  private peakActiveCueCount = 0;
  private processedBatches = 0;
  private playedCues = 0;
  private suppressedBatches = 0;
  private rejectedCues = 0;
  private droppedSources = 0;

  constructor(
    private readonly audio: GameAudioCueAudioTarget,
    events: GameEvents,
    options: Readonly<GameAudioCueControllerOptions> = {},
  ) {
    this.policy = options.policy ?? new AudioCuePolicy();
    this.now = options.now ?? defaultNow;
    this.scheduleMicrotask = options.scheduleMicrotask ?? queueMicrotask;
    this.captureAudioSnapshot(audio.getSnapshot());
    this.removeAudioListener = audio.subscribe(this.captureAudioSnapshot);
    this.eventUnsubscribers = this.bindGameEvents(events);
  }

  enqueueUiAction(action: AudioUiCueAction): void {
    this.enqueue(`ui.${action}`);
  }

  enqueue(source: AudioCueSource): void {
    if (this.destroyed) return;
    if (this.pendingSources.length >= MAX_PENDING_SOURCES) {
      this.droppedSources++;
      return;
    }
    this.pendingSources.push(source);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.scheduleMicrotask(this.flush);
  }

  getSnapshot(): Readonly<GameAudioCueDiagnostics> {
    return Object.freeze({
      pendingSourceCount: this.pendingSources.length,
      activeCueCount: this.activeVoices.size,
      peakActiveCueCount: this.peakActiveCueCount,
      processedBatches: this.processedBatches,
      playedCues: this.playedCues,
      suppressedBatches: this.suppressedBatches,
      rejectedCues: this.rejectedCues,
      droppedSources: this.droppedSources,
      recentDecisions: Object.freeze(this.recentDecisions.map((decision) => Object.freeze({ ...decision }))),
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.flushScheduled = false;
    this.pendingSources.length = 0;
    for (const unsubscribe of this.eventUnsubscribers) unsubscribe();
    this.eventUnsubscribers.length = 0;
    this.removeAudioListener();
    for (const voiceId of this.activeVoices.keys()) this.audio.stopVoice(voiceId);
    this.activeVoices.clear();
  }

  private readonly flush = (): void => {
    this.flushScheduled = false;
    if (this.destroyed || this.pendingSources.length === 0) return;
    const sourceCount = this.pendingSources.length;
    const sources = this.pendingSources.splice(0);
    const atMs = this.now();
    this.processedBatches++;

    if (!this.audioReady || this.audioSuspended) {
      this.suppressedBatches++;
      this.record({ atMs, kind: "suppressed", sourceCount, reason: "audio-blocked" });
      return;
    }

    const decision = this.policy.decideBatch(sources, atMs, [...this.activeVoices.values()]);
    if (decision.kind === "suppressed") {
      this.suppressedBatches++;
      this.record({
        atMs,
        kind: "suppressed",
        sourceCount,
        ...(decision.source ? { source: decision.source } : {}),
        ...(decision.family ? { family: decision.family } : {}),
        reason: decision.reason,
      });
      return;
    }

    if (decision.replaceVoiceId) {
      this.audio.stopVoice(decision.replaceVoiceId);
      this.activeVoices.delete(decision.replaceVoiceId);
    }
    const voiceId = `cue:${decision.intention.family}:${this.nextVoiceId++}`;
    const result = this.audio.play({
      assetId: decision.intention.assetId,
      voiceId,
      priority: decision.intention.priority,
    });
    if (result.kind === "rejected") {
      this.rejectedCues++;
      this.record({
        atMs,
        kind: "rejected",
        sourceCount,
        source: decision.intention.source,
        family: decision.intention.family,
        assetId: decision.intention.assetId,
        reason: result.reason,
      });
      return;
    }
    if (result.kind === "started" && result.replacedVoiceId) {
      this.activeVoices.delete(result.replacedVoiceId);
    }
    this.activeVoices.set(voiceId, {
      voiceId,
      family: decision.intention.family,
      assetId: decision.intention.assetId,
      priority: decision.intention.priority,
      startedAtMs: atMs,
    });
    this.playedCues++;
    this.peakActiveCueCount = Math.max(this.peakActiveCueCount, this.activeVoices.size);
    this.record({
      atMs,
      kind: "played",
      sourceCount,
      source: decision.intention.source,
      family: decision.intention.family,
      assetId: decision.intention.assetId,
      voiceId,
    });
  };

  private readonly captureAudioSnapshot = (snapshot: Readonly<GameAudioCueAudioSnapshot>): void => {
    if (this.destroyed) return;
    this.audioReady = snapshot.available && snapshot.enabled;
    this.audioSuspended = snapshot.suspended;
    for (const voiceId of this.activeVoices.keys()) {
      let retained = false;
      for (const active of snapshot.diagnostics.activeVoices) {
        if (active.voiceId === voiceId) {
          retained = true;
          break;
        }
      }
      if (!retained) this.activeVoices.delete(voiceId);
    }
  };

  private bindGameEvents(events: GameEvents): Array<() => void> {
    return [
      events.on("islandSighted", () => this.enqueue("islandSighted")),
      events.on("surveySiteSighted", () => this.enqueue("surveySiteSighted")),
      events.on("fishingShoalSighted", () => this.enqueue("fishingShoalSighted")),
      events.on("wreckDiscovered", () => this.enqueue("wreckDiscovered")),
      events.on("islandDossierSurveyed", () => this.enqueue("islandDossierSurveyed")),
      events.on("surveySiteSurveyed", () => this.enqueue("surveySiteSurveyed")),
      events.on("fishingShoalSurveyed", () => this.enqueue("fishingShoalSurveyed")),
      events.on("wreckSurveyed", () => this.enqueue("wreckSurveyed")),
      events.on("idolLocationDiscovered", () => this.enqueue("idolLocationDiscovered")),
      events.on("expeditionReturned", () => this.enqueue("expeditionReturned")),
      events.on("shipReplenished", ({ reason }) => {
        if (reason === "dock") this.enqueue("shipReplenishedDock");
      }),
      events.on("shipWrecked", () => this.enqueue("shipWrecked")),
      events.on("shipTeleported", () => this.enqueue("shipTeleported")),
    ];
  }

  private record(decision: GameAudioCueDecisionRecord): void {
    if (this.recentDecisions.length === MAX_RECENT_DECISIONS) this.recentDecisions.shift();
    this.recentDecisions.push(Object.freeze({ ...decision }));
  }
}

function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
