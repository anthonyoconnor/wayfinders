export const SAILING_AMBIENCE_OCEAN_GAIN = 1;
export const SAILING_AMBIENCE_WAKE_START_SPEED = 0.04;
export const SAILING_AMBIENCE_WAKE_STOP_SPEED = 0.015;
export const SAILING_AMBIENCE_WAKE_ATTACK_SECONDS = 0.35;
export const SAILING_AMBIENCE_WAKE_RELEASE_SECONDS = 0.55;
export const SAILING_AMBIENCE_GAIN_EPSILON = 0.001;

export interface SailingAmbienceInput {
  /** Current signed ship speed from the presentation pose. */
  speed: number;
  /** Configured full ship speed used only to normalize the wake layer. */
  fullSpeed: number;
  /** Exact-dock presentation gate. */
  atDock: boolean;
  /** Wreck and generation-handover presentation holds silence the wake. */
  lifecycleHeld: boolean;
}

export interface SailingAmbienceStateSnapshot {
  readonly revision: number;
  readonly oceanTargetGain: number;
  readonly oceanCurrentGain: number;
  readonly wakeTargetGain: number;
  readonly wakeCurrentGain: number;
  readonly wakeEngaged: boolean;
}

/**
 * Renderer-neutral, allocation-free-on-stable-input ambience policy.
 *
 * It consumes only current presentation state. Signed speed is normalized by
 * magnitude, so turning or reversing cannot restart the wake. Dock and
 * lifecycle gates affect only the wake; the non-positional ocean bed remains.
 */
export class SailingAmbienceState {
  private revision = 0;
  private wakeTargetGain = 0;
  private wakeCurrentGain = 0;
  private wakeEngaged = false;
  private snapshot: Readonly<SailingAmbienceStateSnapshot> = createSnapshot(
    0,
    0,
    0,
    false,
  );

  getSnapshot(): Readonly<SailingAmbienceStateSnapshot> {
    return this.snapshot;
  }

  update(
    input: Readonly<SailingAmbienceInput>,
    deltaSeconds: number,
  ): Readonly<SailingAmbienceStateSnapshot> {
    const normalizedSpeed = normalizeSpeed(input.speed, input.fullSpeed);
    const held = input.atDock || input.lifecycleHeld;
    const nextWakeEngaged = held
      ? false
      : this.wakeEngaged
        ? normalizedSpeed > SAILING_AMBIENCE_WAKE_STOP_SPEED
        : normalizedSpeed >= SAILING_AMBIENCE_WAKE_START_SPEED;
    const nextWakeTargetGain = nextWakeEngaged ? normalizedSpeed : 0;
    const nextWakeCurrentGain = smoothGain(
      this.wakeCurrentGain,
      nextWakeTargetGain,
      deltaSeconds,
    );

    if (
      this.wakeEngaged === nextWakeEngaged
      && Object.is(this.wakeTargetGain, nextWakeTargetGain)
      && Object.is(this.wakeCurrentGain, nextWakeCurrentGain)
    ) {
      return this.snapshot;
    }

    this.wakeEngaged = nextWakeEngaged;
    this.wakeTargetGain = nextWakeTargetGain;
    this.wakeCurrentGain = nextWakeCurrentGain;
    this.revision++;
    this.snapshot = createSnapshot(
      this.revision,
      this.wakeTargetGain,
      this.wakeCurrentGain,
      this.wakeEngaged,
    );
    return this.snapshot;
  }
}

function normalizeSpeed(speed: number, fullSpeed: number): number {
  if (!Number.isFinite(speed) || !Number.isFinite(fullSpeed) || fullSpeed <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(speed) / fullSpeed));
}

function smoothGain(current: number, target: number, deltaSeconds: number): number {
  if (Object.is(current, target)) return current;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current;
  const duration = target > current
    ? SAILING_AMBIENCE_WAKE_ATTACK_SECONDS
    : SAILING_AMBIENCE_WAKE_RELEASE_SECONDS;
  const alpha = 1 - Math.exp(-Math.min(deltaSeconds, 0.25) / duration);
  const next = current + (target - current) * alpha;
  return Math.abs(target - next) <= SAILING_AMBIENCE_GAIN_EPSILON ? target : next;
}

function createSnapshot(
  revision: number,
  wakeTargetGain: number,
  wakeCurrentGain: number,
  wakeEngaged: boolean,
): Readonly<SailingAmbienceStateSnapshot> {
  return Object.freeze({
    revision,
    oceanTargetGain: SAILING_AMBIENCE_OCEAN_GAIN,
    oceanCurrentGain: SAILING_AMBIENCE_OCEAN_GAIN,
    wakeTargetGain,
    wakeCurrentGain,
    wakeEngaged,
  });
}
