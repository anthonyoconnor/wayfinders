import Phaser from "phaser";
import {
  appendDeveloperLog,
  clearDeveloperLog,
  developerLogText,
} from "./developerLog";
import {
  prototypeConfig,
} from "./wayfinders/config/prototypeConfig";
import {
  applicationModeHref,
  resolveAssetTrialApplicationRequest,
  resolveWayfindersApplicationMode,
} from "./wayfinders/assets/AssetAppMode";
import { AssetTrialScene } from "./wayfinders/assets/AssetTrialScene";
import { createAssetWorkspaceScene } from "./wayfinders/assets/AssetWorkspaceSceneFactory";
import {
  AVAILABLE_AUTHORED_ISLAND_CATALOG,
  AVAILABLE_AUTHORED_ISLAND_PRESENTATION_CATALOG,
} from "./wayfinders/assets/AssetLibraryCatalog";
import {
  resolveAssetWorkspace,
  type AssetWorkspaceId,
} from "./wayfinders/assets/AssetWorkspaceRegistry";
import {
  mountAssetWorkspaceTabs,
  type AssetWorkspaceTabs,
} from "./wayfinders/assets/AssetWorkspaceTabs";
import { assetWorkspaceSceneKey } from "./wayfinders/assets/workspaces/AssetWorkspace";
import { composeApplicationScenes } from "./wayfinders/app/ApplicationSceneComposition";
import { tryLoadAudioCatalog } from "./wayfinders/audio";
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
const assetModeLink = requireElement<HTMLAnchorElement>("#asset-mode-link");
const appShell = requireElement<HTMLDivElement>("#app");
const assetWorkspaceTabsRoot = requireElement<HTMLElement>("#asset-workspace-tabs");
let suppressEscapeUntilKeyUp = false;
const applicationMode = resolveWayfindersApplicationMode(window.location.search);
const initialAssetWorkspace = resolveAssetWorkspace(window.location.search);
const permanentAssetTools = applicationMode === "assets";

function setDeveloperToolsOpen(open: boolean): void {
  const effectiveOpen = permanentAssetTools || open;
  toolsPanel.hidden = !effectiveOpen;
  toolsToggle.setAttribute("aria-expanded", String(effectiveOpen));
  document.documentElement.dataset.developerTools = effectiveOpen ? "open" : "closed";

  if (!permanentAssetTools) {
    if (effectiveOpen) toolsClose.focus();
    else toolsToggle.focus();
  }
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
    width: gameHost.clientWidth || window.innerWidth,
    height: gameHost.clientHeight || window.innerHeight,
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
  if (event.key !== "Escape" || permanentAssetTools) return;
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

assetModeLink.href = applicationModeHref(applicationMode);
assetModeLink.textContent = applicationMode === "assets"
  ? "Back to game"
  : applicationMode === "asset-trial" ? "Return to asset tools" : "Asset tools";
toolsToggle.hidden = permanentAssetTools;
toolsClose.hidden = permanentAssetTools;
toolsToggle.textContent = applicationMode === "assets"
  ? "Asset controls"
  : applicationMode === "asset-trial" ? "Trial controls" : "Developer tools";
const toolsTitle = document.querySelector<HTMLElement>("#developer-tools-title");
if (toolsTitle) toolsTitle.textContent = applicationMode === "assets"
  ? "Asset workbench"
  : applicationMode === "asset-trial" ? "Sea trial" : "Developer tools";
const toolsEyebrow = document.querySelector<HTMLElement>(".developer-tools__header .eyebrow");
if (toolsEyebrow) toolsEyebrow.textContent = applicationMode === "assets"
  ? "Production tooling"
  : applicationMode === "asset-trial" ? "Disposable candidate world" : "Prototype sandbox";
if (applicationMode !== "game") setDeveloperToolsOpen(true);
document.documentElement.dataset.appReady = "true";
document.documentElement.dataset.applicationMode = applicationMode;

export let wayfindersGame: Phaser.Game | undefined;
let assetWorkspaceTabs: AssetWorkspaceTabs | undefined;

async function startApplication(): Promise<void> {
  try {
    const compositionRequest = applicationMode === "assets"
      ? { mode: applicationMode, initialWorkspace: initialAssetWorkspace } as const
      : applicationMode === "asset-trial"
        ? {
          mode: applicationMode,
          trialRequest: resolveAssetTrialApplicationRequest(window.location.search)!,
        } as const
        : { mode: applicationMode } as const;
    const sceneComposition = await composeApplicationScenes(compositionRequest, {
      loadAudioCatalog: tryLoadAudioCatalog,
      createAssetWorkspaceScene,
      createAssetTrialScene: (request) => new AssetTrialScene(request),
      createGameScene: (audioCatalogResult) => new WayfindersScene(
        new GameSimulation(prototypeConfig, undefined, {
          authoredIslandCatalog: AVAILABLE_AUTHORED_ISLAND_CATALOG,
        }),
        AVAILABLE_AUTHORED_ISLAND_PRESENTATION_CATALOG,
        audioCatalogResult,
      ),
    });
    if ("audioCatalogResult" in sceneComposition && !sceneComposition.audioCatalogResult.ok) {
      log(`Audio unavailable: ${sceneComposition.audioCatalogResult.error.message}`);
    }

    wayfindersGame = createWayfindersGame([sceneComposition.initialScene]);
    if (sceneComposition.mode === "assets") {
      let activeWorkspace = initialAssetWorkspace;
      const registeredWorkspaceIds = new Set<AssetWorkspaceId>([
        initialAssetWorkspace.id as AssetWorkspaceId,
      ]);
      assetWorkspaceTabs = mountAssetWorkspaceTabs(
        assetWorkspaceTabsRoot,
        appShell,
        initialAssetWorkspace,
        (workspace) => {
          const previousKey = assetWorkspaceSceneKey(activeWorkspace.id);
          const nextKey = assetWorkspaceSceneKey(workspace.id);
          wayfindersGame!.scene.stop(previousKey);
          if (!registeredWorkspaceIds.has(workspace.id as AssetWorkspaceId)) {
            wayfindersGame!.scene.add(
              nextKey,
              sceneComposition.createWorkspaceScene(workspace),
              false,
            );
            registeredWorkspaceIds.add(workspace.id as AssetWorkspaceId);
          }
          wayfindersGame!.scene.start(nextKey);
          activeWorkspace = workspace;
        },
      );
    }
    window.dispatchEvent(
      new CustomEvent("wayfinders:shell-ready", {
        detail: { shell: wayfindersShell, game: wayfindersGame },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The renderer could not be started.";
    setStatus(message, "error");
    log(message);
    console.error(error);
  }
}

void startApplication();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    assetWorkspaceTabs?.destroy();
    wayfindersGame?.destroy(true);
  });
}
