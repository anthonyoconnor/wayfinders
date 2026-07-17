export const MUSIC_CROSSFADE_SECONDS = 1.5;
export const MUSIC_DUCK_GAIN = 0.28;
export const MUSIC_DUCK_ATTACK_SECONDS = 0.12;
export const MUSIC_DUCK_RELEASE_SECONDS = 0.75;
export const MUSIC_GAIN_EPSILON = 0.001;

export type MusicStateId = "home-harbor" | "open-water";
export type MusicDuckReason = "none" | "return" | "wreck" | "succession" | "completion";

export interface MusicStateInput {
  readonly atDock: boolean;
  readonly inSupportedWater: boolean;
  readonly expeditionActive: boolean;
  readonly homeInteractionActive: boolean;
  readonly duckReason: MusicDuckReason;
}

export interface MusicStateSnapshot {
  readonly revision: number;
  readonly stateId: MusicStateId;
  readonly duckReason: MusicDuckReason;
  readonly duckTargetGain: number;
  readonly duckCurrentGain: number;
  readonly homeTargetGain: number;
  readonly homeStateGain: number;
  readonly homeCurrentGain: number;
  readonly openWaterTargetGain: number;
  readonly openWaterStateGain: number;
  readonly openWaterCurrentGain: number;
}

export function selectMusicState(input: Readonly<Omit<MusicStateInput, "duckReason">>): MusicStateId {
  return input.homeInteractionActive
    || input.atDock
    || input.inSupportedWater
    || !input.expeditionActive
    ? "home-harbor"
    : "open-water";
}

/** Renderer-neutral two-state score selection, crossfade, and duck envelope. */
export class MusicState {
  private revision = 0;
  private stateId: MusicStateId = "home-harbor";
  private duckReason: MusicDuckReason = "none";
  private duckCurrentGain = 1;
  private homeStateGain = 1;
  private openWaterStateGain = 0;
  private snapshot: Readonly<MusicStateSnapshot> = createSnapshot(
    0,
    "home-harbor",
    "none",
    1,
    1,
    0,
  );

  getSnapshot(): Readonly<MusicStateSnapshot> {
    return this.snapshot;
  }

  update(
    input: Readonly<MusicStateInput>,
    deltaSeconds: number,
  ): Readonly<MusicStateSnapshot> {
    const nextStateId = selectMusicState(input);
    const nextDuckReason = validDuckReason(input.duckReason) ? input.duckReason : "none";
    const homeTargetGain = nextStateId === "home-harbor" ? 1 : 0;
    const openWaterTargetGain = nextStateId === "open-water" ? 1 : 0;
    const duckTargetGain = nextDuckReason === "none" ? 1 : MUSIC_DUCK_GAIN;
    const safeDeltaSeconds = Number.isFinite(deltaSeconds)
      ? Math.min(0.25, Math.max(0, deltaSeconds))
      : 0;
    const nextHomeStateGain = moveTowards(
      this.homeStateGain,
      homeTargetGain,
      safeDeltaSeconds / MUSIC_CROSSFADE_SECONDS,
    );
    const nextOpenWaterStateGain = moveTowards(
      this.openWaterStateGain,
      openWaterTargetGain,
      safeDeltaSeconds / MUSIC_CROSSFADE_SECONDS,
    );
    const duckDuration = duckTargetGain < this.duckCurrentGain
      ? MUSIC_DUCK_ATTACK_SECONDS
      : MUSIC_DUCK_RELEASE_SECONDS;
    const nextDuckCurrentGain = moveTowards(
      this.duckCurrentGain,
      duckTargetGain,
      safeDeltaSeconds / duckDuration,
    );

    if (
      this.stateId === nextStateId
      && this.duckReason === nextDuckReason
      && Object.is(this.homeStateGain, nextHomeStateGain)
      && Object.is(this.openWaterStateGain, nextOpenWaterStateGain)
      && Object.is(this.duckCurrentGain, nextDuckCurrentGain)
    ) {
      return this.snapshot;
    }

    this.stateId = nextStateId;
    this.duckReason = nextDuckReason;
    this.homeStateGain = nextHomeStateGain;
    this.openWaterStateGain = nextOpenWaterStateGain;
    this.duckCurrentGain = nextDuckCurrentGain;
    this.revision++;
    this.snapshot = createSnapshot(
      this.revision,
      this.stateId,
      this.duckReason,
      this.duckCurrentGain,
      this.homeStateGain,
      this.openWaterStateGain,
    );
    return this.snapshot;
  }
}

function createSnapshot(
  revision: number,
  stateId: MusicStateId,
  duckReason: MusicDuckReason,
  duckCurrentGain: number,
  homeStateGain: number,
  openWaterStateGain: number,
): Readonly<MusicStateSnapshot> {
  const duckTargetGain = duckReason === "none" ? 1 : MUSIC_DUCK_GAIN;
  return Object.freeze({
    revision,
    stateId,
    duckReason,
    duckTargetGain,
    duckCurrentGain,
    homeTargetGain: stateId === "home-harbor" ? 1 : 0,
    homeStateGain,
    homeCurrentGain: homeStateGain * duckCurrentGain,
    openWaterTargetGain: stateId === "open-water" ? 1 : 0,
    openWaterStateGain,
    openWaterCurrentGain: openWaterStateGain * duckCurrentGain,
  });
}

function moveTowards(current: number, target: number, maximumDelta: number): number {
  if (Object.is(current, target) || maximumDelta <= 0) return current;
  const difference = target - current;
  if (Math.abs(difference) <= maximumDelta + MUSIC_GAIN_EPSILON) return target;
  return current + Math.sign(difference) * maximumDelta;
}

function validDuckReason(value: string): value is MusicDuckReason {
  return value === "none"
    || value === "return"
    || value === "wreck"
    || value === "succession"
    || value === "completion";
}
