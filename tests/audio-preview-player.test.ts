import { describe, expect, it } from "vitest";
import {
  AudioPreviewPlayer,
  type AudioPreviewAsset,
  type AudioPreviewMediaEvent,
  type AudioPreviewMediaPort,
  type AudioPreviewState,
} from "../src/wayfinders/assets/audioPreview/AudioPreviewPlayer";

class FakePreviewMedia implements AudioPreviewMediaPort {
  loop = false;
  currentTime = 0;
  duration = Number.NaN;
  errorCode?: number;
  loadCount = 0;
  playCount = 0;
  pauseCount = 0;
  releaseCount = 0;
  playError?: Error;
  playGate?: Promise<void>;
  private readonly listeners = new Map<AudioPreviewMediaEvent, Set<() => void>>();

  setCurrentTime(seconds: number): void {
    this.currentTime = seconds;
  }

  load(): void {
    ++this.loadCount;
  }

  async play(): Promise<void> {
    ++this.playCount;
    await this.playGate;
    if (this.playError) throw this.playError;
    this.emit("playing");
  }

  pause(): void {
    ++this.pauseCount;
    this.emit("pause");
  }

  subscribe(event: AudioPreviewMediaEvent, listener: () => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  release(): void {
    ++this.releaseCount;
  }

  emit(event: AudioPreviewMediaEvent): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

const LOOP = Object.freeze({
  id: "music.home-harbor",
  displayName: "Home Harbor",
  description: "Home music",
  category: "music",
  sourceUrl: "/assets/audio/v1/music/home-harbor.wav",
  loop: true,
} satisfies AudioPreviewAsset);

const CUE = Object.freeze({
  id: "sfx.discovery",
  displayName: "Discovery",
  description: "Discovery cue",
  category: "sfx",
  sourceUrl: "/assets/audio/v1/sfx/discovery.wav",
  loop: false,
} satisfies AudioPreviewAsset);

describe("AUD-1 play-only audio preview player", () => {
  it("owns only the selected media and releases all previous listeners and playback", async () => {
    const media: FakePreviewMedia[] = [];
    const states: Readonly<AudioPreviewState>[] = [];
    const player = new AudioPreviewPlayer(
      (state) => states.push(state),
      () => {
        const next = new FakePreviewMedia();
        media.push(next);
        return next;
      },
    );
    const originalLoop = { ...LOOP };

    expect(player.select(LOOP)).toBe(true);
    expect(media[0]?.loop).toBe(true);
    expect(media[0]?.loadCount).toBe(1);
    await player.playFromStart();
    expect(player.state?.status).toBe("playing");

    expect(player.select(CUE)).toBe(true);
    expect(media[0]?.releaseCount).toBe(1);
    expect(media[0]?.listenerCount).toBe(0);
    expect(media[1]?.loop).toBe(false);
    expect(player.state?.asset.id).toBe(CUE.id);
    expect(LOOP).toEqual(originalLoop);

    media[0]?.emit("error");
    expect(player.state?.asset.id).toBe(CUE.id);
    expect(states.at(-1)?.status).toBe("loading");
  });

  it("reports browser duration and progress and supports pause, resume, and stop", async () => {
    const media = new FakePreviewMedia();
    const player = new AudioPreviewPlayer(() => {}, () => media);
    player.select(CUE);
    media.duration = 2.75;
    media.emit("loadedmetadata");
    expect(player.state).toMatchObject({ status: "ready", durationSeconds: 2.75 });

    await player.playFromStart();
    media.currentTime = 1.25;
    media.emit("timeupdate");
    expect(player.state?.currentTimeSeconds).toBe(1.25);

    await player.pauseOrResume();
    expect(player.state?.status).toBe("paused");
    await player.pauseOrResume();
    expect(player.state?.status).toBe("playing");

    player.stop();
    expect(player.state).toMatchObject({ status: "stopped", currentTimeSeconds: 0 });
    expect(media.currentTime).toBe(0);
  });

  it("surfaces decode and rejected-play errors without an unhandled rejection", async () => {
    const media = new FakePreviewMedia();
    const player = new AudioPreviewPlayer(() => {}, () => media);
    player.select(CUE);
    media.errorCode = 3;
    media.emit("error");
    expect(player.state).toMatchObject({
      status: "error",
      error: "The browser could not decode this audio file.",
    });

    media.playError = new Error("User activation is required.");
    await expect(player.playFromStart()).resolves.toBeUndefined();
    expect(player.state).toMatchObject({
      status: "error",
      error: "Playback could not start. User activation is required.",
    });
  });

  it("keeps Stop authoritative when an earlier play request settles later", async () => {
    const media = new FakePreviewMedia();
    let releasePlay!: () => void;
    media.playGate = new Promise<void>((resolve) => { releasePlay = resolve; });
    const player = new AudioPreviewPlayer(() => {}, () => media);
    player.select(CUE);

    const pendingPlay = player.playFromStart();
    player.stop();
    releasePlay();
    await pendingPlay;

    expect(player.state).toMatchObject({ status: "stopped", currentTimeSeconds: 0 });
    expect(media.currentTime).toBe(0);
  });

  it("tears media down exactly once", () => {
    const media = new FakePreviewMedia();
    const player = new AudioPreviewPlayer(() => {}, () => media);
    player.select(LOOP);
    player.destroy();
    player.destroy();
    expect(media.releaseCount).toBe(1);
    expect(media.listenerCount).toBe(0);
    expect(player.state).toBeUndefined();
  });
});
