import Phaser from "phaser";
import { TideboundScene } from "./tidebound/rendering/TideboundScene";
import "./styles.css";

type ShellState = "starting" | "ready" | "error";

export interface WayfindersShell {
  readonly gameHost: HTMLDivElement;
  readonly developerToolsRoot: HTMLDivElement;
  readonly sceneToolsSlot: HTMLDivElement;
  setDeveloperToolsOpen(open: boolean): void;
  setStatus(message: string, state?: ShellState): void;
  log(message: string): void;
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required application-shell element is missing: ${selector}`);
  return element;
}

const gameHost = requireElement<HTMLDivElement>("#game-host");
const statusElement = requireElement<HTMLParagraphElement>("#game-status");
const toolsToggle = requireElement<HTMLButtonElement>("#developer-tools-toggle");
const toolsPanel = requireElement<HTMLElement>("#developer-tools-panel");
const toolsClose = requireElement<HTMLButtonElement>("#developer-tools-close");
const developerToolsRoot = requireElement<HTMLDivElement>("#developer-tools-root");
const sceneToolsSlot = requireElement<HTMLDivElement>("#scene-tools-slot");
const developerLog = requireElement<HTMLDivElement>("#developer-log");
const rendererStatus = requireElement<HTMLElement>("#renderer-status");
const phaserVersion = requireElement<HTMLElement>("#phaser-version");

function setDeveloperToolsOpen(open: boolean): void {
  toolsPanel.hidden = !open;
  toolsToggle.setAttribute("aria-expanded", String(open));
  document.documentElement.dataset.developerTools = open ? "open" : "closed";

  if (open) toolsClose.focus();
  else toolsToggle.focus();
}

function setStatus(message: string, state: ShellState = "ready"): void {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

function log(message: string): void {
  const entry = document.createElement("p");
  entry.textContent = message;
  developerLog.append(entry);
  developerLog.scrollTop = developerLog.scrollHeight;
}

export const wayfindersShell: WayfindersShell = {
  gameHost,
  developerToolsRoot,
  sceneToolsSlot,
  setDeveloperToolsOpen,
  setStatus,
  log,
};

export function createWayfindersGame(
  scenes: Phaser.Types.Scenes.SceneType[] = [],
): Phaser.Game {
  setStatus("Starting WebGL renderer…", "starting");

  return new Phaser.Game({
    type: Phaser.WEBGL,
    parent: gameHost,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#061923",
    transparent: false,
    antialias: true,
    render: {
      antialiasGL: true,
      powerPreference: "high-performance",
      roundPixels: false,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      activePointers: 3,
    },
    scene: scenes,
    banner: false,
    callbacks: {
      postBoot: () => {
        rendererStatus.textContent = "WebGL ready";
        if (scenes.length === 0) setStatus("Renderer ready; awaiting scene binding.");
      },
    },
  });
}

toolsToggle.addEventListener("click", () => setDeveloperToolsOpen(toolsPanel.hidden));
toolsClose.addEventListener("click", () => setDeveloperToolsOpen(false));
gameHost.addEventListener("pointerdown", () => gameHost.focus({ preventScroll: true }));

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !toolsPanel.hidden) setDeveloperToolsOpen(false);
});

phaserVersion.textContent = Phaser.VERSION;
document.documentElement.dataset.appReady = "true";

export let wayfindersGame: Phaser.Game | undefined;

try {
  wayfindersGame = createWayfindersGame([TideboundScene]);
  window.dispatchEvent(
    new CustomEvent("wayfinders:shell-ready", {
      detail: { shell: wayfindersShell, game: wayfindersGame },
    }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "The renderer could not be started.";
  log(message);
  console.error(error);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => wayfindersGame?.destroy(true));
}
