export type AudioPreviewPlaybackStatus =
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "stopped"
  | "error";

export interface AudioPreviewAsset {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly sourceUrl: string;
  readonly loop: boolean;
}

export interface AudioPreviewState {
  readonly asset: Readonly<AudioPreviewAsset>;
  readonly status: AudioPreviewPlaybackStatus;
  readonly currentTimeSeconds: number;
  readonly durationSeconds?: number;
  readonly error?: string;
}

export type AudioPreviewMediaEvent =
  | "loadedmetadata"
  | "durationchange"
  | "timeupdate"
  | "playing"
  | "pause"
  | "ended"
  | "error";

export interface AudioPreviewMediaPort {
  loop: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly errorCode?: number;
  setCurrentTime(seconds: number): void;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  subscribe(event: AudioPreviewMediaEvent, listener: () => void): () => void;
  /** Stops playback, detaches the source, and releases the media resource. */
  release(): void;
}

export type AudioPreviewMediaFactory = (sourceUrl: string) => AudioPreviewMediaPort;

export function formatAudioPreviewTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

const MEDIA_EVENTS: readonly AudioPreviewMediaEvent[] = Object.freeze([
  "loadedmetadata",
  "durationchange",
  "timeupdate",
  "playing",
  "pause",
  "ended",
  "error",
]);

function finiteMediaTime(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function mediaErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1: return "The browser aborted loading this audio file.";
    case 2: return "The browser could not load this audio file.";
    case 3: return "The browser could not decode this audio file.";
    case 4: return "The browser does not support this audio file.";
    default: return "The browser could not load or decode this audio file.";
  }
}

function playbackErrorMessage(error: unknown): string {
  const detail = error instanceof Error && error.message.trim().length > 0
    ? ` ${error.message.trim()}`
    : "";
  return `Playback could not start.${detail}`;
}

export function createBrowserAudioPreviewMedia(sourceUrl: string): AudioPreviewMediaPort {
  const media = new Audio(sourceUrl);
  media.preload = "metadata";

  return {
    get loop() { return media.loop; },
    set loop(value: boolean) { media.loop = value; },
    get currentTime() { return media.currentTime; },
    get duration() { return media.duration; },
    get errorCode() { return media.error?.code; },
    setCurrentTime(seconds: number): void {
      media.currentTime = seconds;
    },
    load(): void {
      media.load();
    },
    async play(): Promise<void> {
      await media.play();
    },
    pause(): void {
      media.pause();
    },
    subscribe(event: AudioPreviewMediaEvent, listener: () => void): () => void {
      media.addEventListener(event, listener);
      return () => media.removeEventListener(event, listener);
    },
    release(): void {
      media.pause();
      media.removeAttribute("src");
      media.load();
    },
  };
}

/**
 * Owns exactly one browser media element. Catalog data is accepted as readonly
 * input and is never annotated with preview state.
 */
export class AudioPreviewPlayer {
  private media?: AudioPreviewMediaPort;
  private unsubscribe: (() => void)[] = [];
  private stateValue?: AudioPreviewState;
  private generation = 0;
  private playbackIntent = 0;
  private playbackRequested = false;
  private destroyed = false;

  constructor(
    private readonly stateChanged: (state: Readonly<AudioPreviewState>) => void,
    private readonly createMedia: AudioPreviewMediaFactory = createBrowserAudioPreviewMedia,
  ) {}

  get state(): Readonly<AudioPreviewState> | undefined {
    return this.stateValue;
  }

  select(asset: Readonly<AudioPreviewAsset>): boolean {
    if (this.destroyed || this.stateValue?.asset.id === asset.id) return false;
    this.releaseMedia();
    const generation = ++this.generation;
    const media = this.createMedia(asset.sourceUrl);
    media.loop = asset.loop;
    this.media = media;
    this.stateValue = Object.freeze({
      asset,
      status: "loading",
      currentTimeSeconds: 0,
    });
    this.bindMedia(media, generation);
    this.emit();
    media.load();
    return true;
  }

  async playFromStart(): Promise<void> {
    const media = this.media;
    const generation = this.generation;
    if (!media || !this.stateValue || this.destroyed) return;
    const playbackIntent = ++this.playbackIntent;
    this.playbackRequested = true;
    media.setCurrentTime(0);
    this.update({ currentTimeSeconds: 0, error: undefined });
    await this.requestPlay(media, generation, playbackIntent);
  }

  async pauseOrResume(): Promise<void> {
    const media = this.media;
    const generation = this.generation;
    if (!media || !this.stateValue || this.destroyed) return;
    if (this.stateValue.status === "playing") {
      ++this.playbackIntent;
      this.playbackRequested = false;
      media.pause();
      if (this.isCurrent(media, generation) && this.stateValue.status === "playing") {
        this.update({ status: "paused" });
      }
      return;
    }
    if (this.stateValue.status !== "paused") return;
    const playbackIntent = ++this.playbackIntent;
    this.playbackRequested = true;
    await this.requestPlay(media, generation, playbackIntent);
  }

  stop(): void {
    const media = this.media;
    if (!media || !this.stateValue || this.destroyed) return;
    ++this.playbackIntent;
    this.playbackRequested = false;
    this.update({
      status: "stopped",
      currentTimeSeconds: 0,
      error: undefined,
    });
    media.pause();
    media.setCurrentTime(0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseMedia();
    this.stateValue = undefined;
  }

  private bindMedia(media: AudioPreviewMediaPort, generation: number): void {
    const current = () => this.isCurrent(media, generation);
    const syncDuration = () => {
      if (!current()) return;
      const durationSeconds = finiteMediaTime(media.duration);
      if (this.stateValue?.status === "loading") {
        this.update({ durationSeconds, status: "ready" });
      } else {
        this.update({ durationSeconds });
      }
    };
    const syncTime = () => {
      if (!current()) return;
      this.update({ currentTimeSeconds: finiteMediaTime(media.currentTime) ?? 0 });
    };

    const listeners: Readonly<Record<AudioPreviewMediaEvent, () => void>> = {
      loadedmetadata: syncDuration,
      durationchange: syncDuration,
      timeupdate: syncTime,
      playing: () => {
        if (current() && this.playbackRequested) {
          this.update({ status: "playing", error: undefined });
        }
      },
      pause: () => {
        if (!current()) return;
        this.playbackRequested = false;
        if (this.stateValue?.status === "playing") this.update({ status: "paused" });
      },
      ended: () => {
        if (!current()) return;
        this.playbackRequested = false;
        this.update({
          status: "stopped",
          currentTimeSeconds: finiteMediaTime(media.duration) ?? 0,
        });
      },
      error: () => {
        if (!current()) return;
        this.playbackRequested = false;
        this.update({ status: "error", error: mediaErrorMessage(media.errorCode) });
      },
    };
    for (const event of MEDIA_EVENTS) {
      this.unsubscribe.push(media.subscribe(event, listeners[event]));
    }
  }

  private async requestPlay(
    media: AudioPreviewMediaPort,
    generation: number,
    playbackIntent: number,
  ): Promise<void> {
    try {
      await media.play();
      if (
        this.isCurrent(media, generation)
        && this.playbackIntent === playbackIntent
        && this.playbackRequested
        && this.stateValue?.status !== "playing"
      ) {
        this.update({ status: "playing", error: undefined });
      }
    } catch (error) {
      if (
        this.isCurrent(media, generation)
        && this.playbackIntent === playbackIntent
        && this.playbackRequested
      ) {
        this.playbackRequested = false;
        this.update({ status: "error", error: playbackErrorMessage(error) });
      }
    }
  }

  private isCurrent(media: AudioPreviewMediaPort, generation: number): boolean {
    return !this.destroyed && this.media === media && this.generation === generation;
  }

  private update(patch: Partial<Omit<AudioPreviewState, "asset">>): void {
    if (!this.stateValue) return;
    const next: AudioPreviewState = Object.freeze({
      ...this.stateValue,
      ...patch,
    });
    if (
      next.status === this.stateValue.status
      && next.currentTimeSeconds === this.stateValue.currentTimeSeconds
      && next.durationSeconds === this.stateValue.durationSeconds
      && next.error === this.stateValue.error
    ) return;
    this.stateValue = next;
    this.emit();
  }

  private emit(): void {
    if (this.stateValue) this.stateChanged(this.stateValue);
  }

  private releaseMedia(): void {
    ++this.generation;
    ++this.playbackIntent;
    this.playbackRequested = false;
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    this.media?.release();
    this.media = undefined;
  }
}
