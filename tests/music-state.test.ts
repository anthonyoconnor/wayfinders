import { describe, expect, it } from "vitest";
import {
  MUSIC_DUCK_GAIN,
  MusicState,
  selectMusicState,
  type MusicDuckReason,
  type MusicStateInput,
} from "../src/wayfinders/audio";

describe("AUD-4 music state", () => {
  it.each([
    ["dock", input({ atDock: true }), "home-harbor"],
    ["Supported departure", input({ inSupportedWater: true }), "home-harbor"],
    ["expedition start", input({ expeditionActive: true }), "open-water"],
    ["return", input({ expeditionActive: true, inSupportedWater: true }), "home-harbor"],
    ["home interaction", input({ expeditionActive: true, homeInteractionActive: true }), "home-harbor"],
    ["wreck hold", input({ duckReason: "wreck" }), "home-harbor"],
    ["handover", input({ atDock: true, duckReason: "succession" }), "home-harbor"],
    ["completion", input({ atDock: true, duckReason: "completion" }), "home-harbor"],
    ["Continue", input({ atDock: true }), "home-harbor"],
    ["Start new game", input({ atDock: true }), "home-harbor"],
  ] as const)("selects %s without hidden-world input", (_name, value, expected) => {
    expect(selectMusicState(value)).toBe(expected);
  });

  it("crossfades home harbor to open water over 1.5 seconds", () => {
    const state = new MusicState();
    state.update(input({ expeditionActive: true }), 0);
    for (let index = 0; index < 3; index++) state.update(input({ expeditionActive: true }), 0.25);
    expect(state.getSnapshot().stateId).toBe("open-water");
    expect(state.getSnapshot().homeStateGain).toBeCloseTo(0.5);
    expect(state.getSnapshot().openWaterStateGain).toBeCloseTo(0.5);
    for (let index = 0; index < 3; index++) state.update(input({ expeditionActive: true }), 0.25);
    expect(state.getSnapshot()).toMatchObject({
      homeStateGain: 0,
      openWaterStateGain: 1,
    });
  });

  it("ducks by lifecycle priority and releases independently of the crossfade", () => {
    const state = new MusicState();
    const ducked = state.update(input({ duckReason: "completion" }), 0.12);
    expect(ducked).toMatchObject({
      duckReason: "completion",
      duckTargetGain: MUSIC_DUCK_GAIN,
      duckCurrentGain: MUSIC_DUCK_GAIN,
      homeStateGain: 1,
      homeCurrentGain: MUSIC_DUCK_GAIN,
    });

    for (let index = 0; index < 3; index++) state.update(input(), 0.25);
    expect(state.getSnapshot()).toMatchObject({
      duckReason: "none",
      duckCurrentGain: 1,
      homeCurrentGain: 1,
    });
  });

  it("reverses a rapid transition from its current gains", () => {
    const state = new MusicState();
    state.update(input({ expeditionActive: true }), 0.3);
    const outgoing = state.getSnapshot();
    const reversed = state.update(input({ inSupportedWater: true, expeditionActive: true }), 0.15);
    expect(reversed.homeStateGain).toBeGreaterThan(outgoing.homeStateGain);
    expect(reversed.openWaterStateGain).toBeLessThan(outgoing.openWaterStateGain);
  });

  it("retains snapshot identity on stable settled frames", () => {
    const state = new MusicState();
    const initial = state.getSnapshot();
    expect(state.update(input(), 1 / 30)).toBe(initial);
    expect(state.update(input(), Number.NaN)).toBe(initial);
  });
});

function input(patch: Partial<MusicStateInput> = {}): MusicStateInput {
  return {
    atDock: false,
    inSupportedWater: false,
    expeditionActive: false,
    homeInteractionActive: false,
    duckReason: "none" as MusicDuckReason,
    ...patch,
  };
}
