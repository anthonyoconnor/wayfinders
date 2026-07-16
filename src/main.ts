import Phaser from "phaser";
import {
  appendDeveloperLog,
  clearDeveloperLog,
  developerLogText,
} from "./developerLog";
import {
  prototypeConfig,
} from "./wayfinders/config/prototypeConfig";
import { applicationModeHref, resolveWayfindersApplicationMode } from "./wayfinders/assets/AssetAppMode";
import { AssetViewerScene } from "./wayfinders/assets/AssetViewerScene";
import { GameSimulation } from "./wayfinders/core/GameSimulation";
import { WayfindersScene } from "./wayfinders/rendering/WayfindersScene";
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
const developerLogCopy = requireElement<HTMLButtonElement>("#developer-log-copy");
const developerLogClear = requireElement<HTMLButtonElement>("#developer-log-clear");
const developerLogFeedback = requireElement<HTMLOutputElement>("#developer-log-feedback");
const rendererStatus = requireElement<HTMLElement>("#renderer-status");
const phaserVersion = requireElement<HTMLElement>("#phaser-version");
const assetModeLink = requireElement<HTMLAnchorElement>("#asset-mode-link");
let suppressEscapeUntilKeyUp = false;
const applicationMode = resolveWayfindersApplicationMode(window.location.search);

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
  appendDeveloperLog(developerLog, message);
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
developerLogClear.addEventListener("click", () => {
  clearDeveloperLog(developerLog);
  developerLogFeedback.value = "Event log cleared.";
});
developerLogCopy.addEventListener("click", () => {
  const text = developerLogText(developerLog);
  const copiedEntryCount = developerLog.childElementCount;
  if (text.length === 0) {
    developerLogFeedback.value = "Event log is empty.";
    return;
  }
  if (!navigator.clipboard?.writeText) {
    developerLogFeedback.value = "Clipboard access is unavailable in this browser.";
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => {
      developerLogFeedback.value = `Copied ${copiedEntryCount} event log entries.`;
    },
    () => {
      developerLogFeedback.value = "The browser could not copy the event log.";
    },
  );
});
gameHost.addEventListener("pointerdown", () => gameHost.focus({ preventScroll: true }));

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!toolsPanel.hidden) {
    suppressEscapeUntilKeyUp = true;
    setDeveloperToolsOpen(false);
  } else if (!suppressEscapeUntilKeyUp) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
});
window.addEventListener("keyup", (event) => {
  if (event.key !== "Escape" || !suppressEscapeUntilKeyUp) return;
  suppressEscapeUntilKeyUp = false;
  event.preventDefault();
  event.stopImmediatePropagation();
});
window.addEventListener("blur", () => { suppressEscapeUntilKeyUp = false; });

phaserVersion.textContent = Phaser.VERSION;
assetModeLink.href = applicationModeHref(applicationMode);
assetModeLink.textContent = applicationMode === "assets" ? "Back to game" : "Asset tools";
toolsToggle.textContent = applicationMode === "assets" ? "Asset controls" : "Developer tools";
const toolsTitle = document.querySelector<HTMLElement>("#developer-tools-title");
if (toolsTitle) toolsTitle.textContent = applicationMode === "assets" ? "Asset workbench" : "Developer tools";
const toolsEyebrow = document.querySelector<HTMLElement>(".developer-tools__header .eyebrow");
if (toolsEyebrow) toolsEyebrow.textContent = applicationMode === "assets" ? "GR-2 tooling" : "Prototype sandbox";
const riskLegend = document.querySelector<HTMLElement>("#risk-legend");
if (riskLegend && applicationMode === "assets") riskLegend.hidden = true;
if (applicationMode === "assets") setDeveloperToolsOpen(true);
document.documentElement.dataset.appReady = "true";
document.documentElement.dataset.applicationMode = applicationMode;

export let wayfindersGame: Phaser.Game | undefined;

try {
  const scenes = applicationMode === "assets"
    ? [new AssetViewerScene()]
    : [new WayfindersScene(new GameSimulation(prototypeConfig))];
  wayfindersGame = createWayfindersGame(scenes);
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
