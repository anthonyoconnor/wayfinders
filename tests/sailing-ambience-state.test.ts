import { describe, expect, it } from "vitest";
import {
  SAILING_AMBIENCE_GAIN_EPSILON,
  SailingAmbienceState,
  type SailingAmbienceInput,
} from "../src/wayfinders/audio";

describe("AUD-2 sailing ambience state", () => {
  it("keeps the ocean bed present and the wake silent at rest", () => {
    const state = new SailingAmbienceState();
    const initial = state.getSnapshot();

    expect(state.update(input({ speed: 0 }), 1 / 30)).toBe(initial);
    expect(initial).toMatchObject({
      oceanTargetGain: 1,
      oceanCurrentGain: 1,
      wakeTargetGain: 0,
      wakeCurrentGain: 0,
      wakeEngaged: false,
    });
  });

  it("uses absolute normalized speed without changing state on direction reversal", () => {
    const state = new SailingAmbienceState();
    const forward = state.update(input({ speed: 2, fullSpeed: 4 }), 0.1);
    expect(forward.wakeTargetGain).toBe(0.5);
    expect(forward.wakeCurrentGain).toBeGreaterThan(0);
    expect(forward.wakeCurrentGain).toBeLessThan(0.5);

    const reversed = state.update(input({ speed: -2, fullSpeed: 4 }), 0);
    expect(reversed).toBe(forward);
  });

  it("applies start and stop hysteresis around low ship speed", () => {
    const state = new SailingAmbienceState();
    expect(state.update(input({ speed: 0.1, fullSpeed: 4 }), 0.1).wakeEngaged).toBe(false);
    expect(state.update(input({ speed: 0.2, fullSpeed: 4 }), 0.1).wakeEngaged).toBe(true);
    expect(state.update(input({ speed: 0.1, fullSpeed: 4 }), 0.1).wakeEngaged).toBe(true);
    const stopped = state.update(input({ speed: 0.04, fullSpeed: 4 }), 0.1);
    expect(stopped.wakeEngaged).toBe(false);
    expect(stopped.wakeTargetGain).toBe(0);
  });

  it("silences the wake target at dock and during wreck or handover holds", () => {
    const state = new SailingAmbienceState();
    state.update(input({ speed: 4 }), 0.2);
    expect(state.update(input({ speed: 4, atDock: true }), 0.1)).toMatchObject({
      wakeEngaged: false,
      wakeTargetGain: 0,
    });

    state.update(input({ speed: 4 }), 0.2);
    expect(state.update(input({ speed: 4, lifecycleHeld: true }), 0.1)).toMatchObject({
      wakeEngaged: false,
      wakeTargetGain: 0,
    });
  });

  it("smooths teleport or regeneration speed resets, then allocates no stable snapshot", () => {
    const state = new SailingAmbienceState();
    settle(state, input({ speed: 4 }));
    expect(state.getSnapshot().wakeCurrentGain).toBe(1);

    const firstRelease = state.update(input({ speed: 0 }), 0.1);
    expect(firstRelease.wakeCurrentGain).toBeGreaterThan(0);
    expect(firstRelease.wakeCurrentGain).toBeLessThan(1);
    settle(state, input({ speed: 0 }));
    const settled = state.getSnapshot();
    expect(settled.wakeCurrentGain).toBe(0);
    expect(state.update(input({ speed: 0 }), 1 / 30)).toBe(settled);
  });

  it("treats invalid speed inputs as rest without producing invalid gains", () => {
    const state = new SailingAmbienceState();
    const snapshot = state.update(input({ speed: Number.NaN, fullSpeed: 0 }), Number.NaN);
    expect(snapshot.wakeTargetGain).toBe(0);
    expect(snapshot.wakeCurrentGain).toBe(0);
  });
});

function input(patch: Partial<SailingAmbienceInput> = {}): SailingAmbienceInput {
  return {
    speed: 0,
    fullSpeed: 4,
    atDock: false,
    lifecycleHeld: false,
    ...patch,
  };
}

function settle(state: SailingAmbienceState, value: SailingAmbienceInput): void {
  for (let index = 0; index < 200; index++) state.update(value, 0.1);
  expect(Math.abs(state.getSnapshot().wakeCurrentGain - state.getSnapshot().wakeTargetGain))
    .toBeLessThanOrEqual(SAILING_AMBIENCE_GAIN_EPSILON);
}
