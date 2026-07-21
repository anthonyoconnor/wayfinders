export type StartupState = "starting" | "ready" | "error";

export interface StartupPresentation {
  setStatus(message: string, state?: Exclude<StartupState, "ready">): void;
  reveal(): void;
}

type FrameRequest = (callback: FrameRequestCallback) => number;

function requireStartupElement<T extends HTMLElement>(documentRoot: Document, selector: string): T {
  const element = documentRoot.querySelector<T>(selector);
  if (!element) throw new Error(`Required startup-shell element is missing: ${selector}`);
  return element;
}

export function mountStartupPresentation(documentRoot: Document): StartupPresentation {
  const root = requireStartupElement<HTMLElement>(documentRoot, "#startup-screen");
  const status = requireStartupElement<HTMLElement>(documentRoot, "#startup-status");

  return {
    setStatus(message, state = "starting"): void {
      status.textContent = message;
      root.dataset.state = state;
      documentRoot.documentElement.dataset.startupState = state;
    },
    reveal(): void {
      root.dataset.state = "ready";
      documentRoot.documentElement.dataset.startupState = "ready";
      documentRoot.documentElement.dataset.sceneReady = "true";
    },
  };
}

/**
 * Keeps the startup surface in place until an initial scene is active, then
 * gives the browser two animation frames to present its canvas before reveal.
 */
export function waitForInitialScenePaint(
  isInitialSceneActive: () => boolean,
  reveal: () => void,
  requestFrame: FrameRequest = window.requestAnimationFrame.bind(window),
): void {
  let activeFrameCount = 0;

  const poll = (): void => {
    activeFrameCount = isInitialSceneActive() ? activeFrameCount + 1 : 0;
    if (activeFrameCount >= 2) {
      reveal();
      return;
    }
    requestFrame(poll);
  };

  requestFrame(poll);
}
