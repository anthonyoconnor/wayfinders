import { describe, expect, it } from "vitest";
import {
  resolveSceneMovementInput,
  type SceneMovementInputContext,
  type SceneMovementKeyState,
} from "../src/wayfinders/rendering/SceneMovementInput.ts";

const RELEASED_KEYS: SceneMovementKeyState = {
  left: false,
  right: false,
  forward: false,
  reverse: false,
  alternateLeft: false,
  alternateRight: false,
  alternateForward: false,
  alternateReverse: false,
};

const READY: SceneMovementInputContext = {
  developerToolsOpen: false,
  developerNumberFocused: false,
  textEntryFocused: false,
  generationHandoverActive: false,
  greatHallOpen: false,
  surveyActionActive: false,
};

describe("scene movement input policy", () => {
  it("keeps WASD and arrow-key sailing active while developer tools remain open", () => {
    expect(resolveSceneMovementInput({
      ...RELEASED_KEYS,
      alternateRight: true,
      alternateForward: true,
    }, {
      ...READY,
      developerToolsOpen: true,
    })).toEqual({ turn: 1, throttle: 1 });
  });

  it("keeps WASD live but reserves arrows while a developer number is focused", () => {
    expect(resolveSceneMovementInput({
      ...RELEASED_KEYS,
      right: true,
      forward: true,
      alternateLeft: true,
      alternateReverse: true,
    }, {
      ...READY,
      developerToolsOpen: true,
      developerNumberFocused: true,
      textEntryFocused: true,
    })).toEqual({ turn: 1, throttle: 1 });
  });

  it("protects other text entry while retaining lifecycle and survey-action locks", () => {
    const moving = { ...RELEASED_KEYS, right: true, forward: true };
    expect(resolveSceneMovementInput(moving, {
      ...READY,
      developerToolsOpen: true,
      textEntryFocused: true,
    })).toEqual({ turn: 0, throttle: 0 });
    expect(resolveSceneMovementInput(moving, {
      ...READY,
      generationHandoverActive: true,
    })).toEqual({ turn: 0, throttle: 0 });
    expect(resolveSceneMovementInput(moving, {
      ...READY,
      greatHallOpen: true,
    })).toEqual({ turn: 0, throttle: 0 });
    expect(resolveSceneMovementInput(moving, {
      ...READY,
      surveyActionActive: true,
    })).toEqual({ turn: 0, throttle: 0 });
  });
});
