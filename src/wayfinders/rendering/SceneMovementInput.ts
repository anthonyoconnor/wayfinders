import type { MovementInput } from "../core/types";

export interface SceneMovementKeyState {
  readonly left: boolean;
  readonly right: boolean;
  readonly forward: boolean;
  readonly reverse: boolean;
  readonly alternateLeft: boolean;
  readonly alternateRight: boolean;
  readonly alternateForward: boolean;
  readonly alternateReverse: boolean;
}

export interface SceneMovementInputContext {
  readonly developerToolsOpen: boolean;
  readonly developerNumberFocused: boolean;
  readonly textEntryFocused: boolean;
  readonly generationHandoverActive: boolean;
  readonly greatHallOpen: boolean;
  readonly surveyActionActive: boolean;
}

const STOPPED_INPUT: Readonly<MovementInput> = Object.freeze({ turn: 0, throttle: 0 });

export function isSceneMovementInputSuppressed(
  context: Readonly<SceneMovementInputContext>,
): boolean {
  const liveDeveloperNumber = context.developerToolsOpen
    && context.developerNumberFocused;
  return context.generationHandoverActive
    || context.greatHallOpen
    || context.surveyActionActive
    || (context.textEntryFocused && !liveDeveloperNumber);
}

/**
 * Resolves keyboard navigation without making the developer drawer modal.
 * Focused developer number fields keep WASD sailing live while reserving the
 * alternate arrow keys for native spinbutton editing.
 */
export function resolveSceneMovementInput(
  keys: Readonly<SceneMovementKeyState>,
  context: Readonly<SceneMovementInputContext>,
): Readonly<MovementInput> {
  if (isSceneMovementInputSuppressed(context)) return STOPPED_INPUT;

  const useAlternateKeys = !context.textEntryFocused;
  const pressed = (primary: boolean, alternate: boolean): number => (
    primary || (useAlternateKeys && alternate) ? 1 : 0
  );

  return {
    turn: pressed(keys.right, keys.alternateRight) - pressed(keys.left, keys.alternateLeft),
    throttle:
      pressed(keys.forward, keys.alternateForward)
      - pressed(keys.reverse, keys.alternateReverse),
  };
}
