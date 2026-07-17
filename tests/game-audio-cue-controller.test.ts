import { describe, expect, it } from "vitest";
import { GameEvents, type GameEventMap } from "../src/wayfinders/core/GameEvents";
import type {
  GameAudioPlayRequest,
  GameAudioPlayResult,
} from "../src/wayfinders/rendering/audio/GameAudioController";
import {
  GameAudioCueController,
  type GameAudioCueAudioSnapshot,
  type GameAudioCueAudioTarget,
} from "../src/wayfinders/rendering/audio/GameAudioCueController";

class FakeCueAudioTarget implements GameAudioCueAudioTarget {
  enabled = true;
  available = true;
  suspended = false;
  rejectReason?: "asset-unavailable";
  readonly playRequests: GameAudioPlayRequest[] = [];
  readonly stopRequests: string[] = [];
  readonly activeVoiceIds = new Set<string>();
  private readonly listeners = new Set<(snapshot: Readonly<GameAudioCueAudioSnapshot>) => void>();

  getSnapshot(): Readonly<GameAudioCueAudioSnapshot> {
    return {
      enabled: this.enabled,
      available: this.available,
      suspended: this.suspended,
      diagnostics: {
        activeVoices: [...this.activeVoiceIds].map((voiceId) => ({ voiceId })),
      },
    };
  }

  subscribe(listener: (snapshot: Readonly<GameAudioCueAudioSnapshot>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(request: Readonly<GameAudioPlayRequest>): GameAudioPlayResult {
    this.playRequests.push(request);
    if (this.rejectReason) return { kind: "rejected", reason: this.rejectReason };
    const voiceId = request.voiceId ?? "missing-id";
    this.activeVoiceIds.add(voiceId);
    this.notify();
    return { kind: "started", voiceId };
  }

  stopVoice(voiceId: string): boolean {
    this.stopRequests.push(voiceId);
    const stopped = this.activeVoiceIds.delete(voiceId);
    this.notify();
    return stopped;
  }

  completeAll(): void {
    this.activeVoiceIds.clear();
    this.notify();
  }

  notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function fixture() {
  const audio = new FakeCueAudioTarget();
  const events = new GameEvents();
  const tasks: Array<() => void> = [];
  let nowMs = 1_000;
  const controller = new GameAudioCueController(audio, events, {
    now: () => nowMs,
    scheduleMicrotask: (task) => tasks.push(task),
  });
  return {
    audio,
    events,
    controller,
    tasks,
    advance: (milliseconds: number) => { nowMs += milliseconds; },
    flush: () => {
      const task = tasks.shift();
      expect(task).toBeTypeOf("function");
      task!();
    },
  };
}

describe("AUD-3 game audio cue controller", () => {
  it.each([
    "islandSighted",
    "surveySiteSighted",
    "fishingShoalSighted",
    "wreckDiscovered",
  ] as const)("plays the discovery cue for live %s events", (eventName) => {
    const { audio, events, flush } = fixture();
    events.emit(eventName, eventPayload<typeof eventName>());
    flush();

    expect(audio.playRequests).toHaveLength(1);
    expect(audio.playRequests[0]).toMatchObject({ assetId: "sfx.discovery" });
  });

  it.each([
    "islandDossierSurveyed",
    "surveySiteSurveyed",
    "fishingShoalSurveyed",
    "wreckSurveyed",
  ] as const)("plays the survey cue for live %s events", (eventName) => {
    const { audio, events, flush } = fixture();
    events.emit(eventName, eventPayload<typeof eventName>());
    flush();

    expect(audio.playRequests).toHaveLength(1);
    expect(audio.playRequests[0]).toMatchObject({ assetId: "sfx.survey-complete" });
  });

  it("batches an idol survey into one high-priority discovery cue", () => {
    const { audio, controller, events, tasks, flush } = fixture();
    events.emit("surveySiteSurveyed", eventPayload<"surveySiteSurveyed">());
    events.emit("idolLocationDiscovered", eventPayload<"idolLocationDiscovered">());
    controller.enqueueUiAction("confirm");

    expect(tasks).toHaveLength(1);
    flush();
    expect(audio.playRequests).toEqual([{
      assetId: "sfx.discovery",
      voiceId: "cue:idol-discovery:1",
      priority: 900,
    }]);
    expect(controller.getSnapshot()).toMatchObject({
      processedBatches: 1,
      playedCues: 1,
      recentDecisions: [{
        kind: "played",
        sourceCount: 3,
        source: "idolLocationDiscovered",
      }],
    });
  });

  it("plays one ordinary survey cue even when the accepted UI action joins its batch", () => {
    const { audio, controller, events, flush } = fixture();
    events.emit("wreckSurveyed", eventPayload<"wreckSurveyed">());
    controller.enqueueUiAction("confirm");
    flush();

    expect(audio.playRequests).toHaveLength(1);
    expect(audio.playRequests[0]).toMatchObject({
      assetId: "sfx.survey-complete",
      priority: 610,
    });
  });

  it("collapses return and dock replenishment into one return cue", () => {
    const { audio, events, flush } = fixture();
    events.emit("expeditionReturned", eventPayload<"expeditionReturned">());
    events.emit("shipReplenished", { generation: 2, bundles: 8, reason: "dock" });
    events.emit("returnStateChanged", undefined);
    flush();

    expect(audio.playRequests).toHaveLength(1);
    expect(audio.playRequests[0]).toMatchObject({
      assetId: "sfx.dock-return",
      priority: 800,
    });
  });

  it("plays one wreck cue and ignores the related failure event", () => {
    const { audio, events, flush, tasks } = fixture();
    events.emit("shipWrecked", eventPayload<"shipWrecked">());
    events.emit("expeditionFailed", eventPayload<"expeditionFailed">());
    expect(tasks).toHaveLength(1);
    flush();

    expect(audio.playRequests).toHaveLength(1);
    expect(audio.playRequests[0]).toMatchObject({ assetId: "sfx.wreck", priority: 1_000 });
  });

  it("does not subscribe high-rate state or world regeneration to cues", () => {
    const { audio, events, tasks } = fixture();
    events.emit("provisionConsumed", { remaining: 7 });
    events.emit("shipEnteredTile", { x: 2, y: 3 });
    events.emit("knowledgeChanged", { count: 4 });
    events.emit("returnStateChanged", undefined);
    events.emit("worldRegenerated", { seed: 42 });

    expect(tasks).toHaveLength(0);
    expect(audio.playRequests).toHaveLength(0);
  });

  it("uses teleport as a barrier against same-transaction discovery cues", () => {
    const { audio, controller, events, flush } = fixture();
    events.emit("shipTeleported", { x: 10, y: 12 });
    events.emit("islandSighted", eventPayload<"islandSighted">());
    flush();

    expect(audio.playRequests).toHaveLength(0);
    expect(controller.getSnapshot().recentDecisions.at(-1)).toMatchObject({
      kind: "suppressed",
      reason: "developer-action",
    });
  });

  it("drops a blocked batch instead of replaying it after audio becomes enabled", () => {
    const { audio, controller, events, flush } = fixture();
    audio.enabled = false;
    audio.notify();
    events.emit("islandSighted", eventPayload<"islandSighted">());
    flush();
    audio.enabled = true;
    audio.notify();

    expect(audio.playRequests).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      processedBatches: 1,
      suppressedBatches: 1,
      recentDecisions: [{ reason: "audio-blocked" }],
    });
  });

  it("prunes completed voices, bounds diagnostics, and unsubscribes on destroy", () => {
    const { audio, controller, events, advance, flush, tasks } = fixture();
    for (let index = 0; index < 20; index++) {
      controller.enqueueUiAction(index % 2 === 0 ? "confirm" : "cancel");
      flush();
      audio.completeAll();
      advance(200);
    }

    expect(controller.getSnapshot()).toMatchObject({
      activeCueCount: 0,
      processedBatches: 20,
      playedCues: 20,
    });
    expect(controller.getSnapshot().recentDecisions).toHaveLength(16);

    controller.enqueue("shipWrecked");
    controller.destroy();
    expect(audio.stopRequests).toHaveLength(0);
    expect(controller.getSnapshot().pendingSourceCount).toBe(0);
    events.emit("shipWrecked", eventPayload<"shipWrecked">());
    expect(tasks).toHaveLength(1);
    tasks.shift()!();
    expect(audio.playRequests).toHaveLength(20);
  });
});

function eventPayload<K extends keyof GameEventMap>(): GameEventMap[K] {
  return undefined as GameEventMap[K];
}
