import {
  ASSET_WORKSPACES,
  adjacentAssetWorkspaceId,
  assetWorkspaceById,
  assetWorkspaceHref,
  type AssetWorkspaceId,
} from "./AssetWorkspaceRegistry";
import type { AssetWorkspaceNavigationController } from "./AssetWorkspaceNavigationGuard";
import type { AssetWorkspaceModule } from "./workspaces/AssetWorkspace";

export interface AssetWorkspaceTabs {
  readonly activeWorkspace: Readonly<AssetWorkspaceModule>;
  destroy(): void;
}

export function mountAssetWorkspaceTabs(
  root: HTMLElement,
  panel: HTMLElement,
  initialWorkspace: Readonly<AssetWorkspaceModule>,
  activate: (workspace: Readonly<AssetWorkspaceModule>) => void,
  navigation?: Readonly<AssetWorkspaceNavigationController>,
): AssetWorkspaceTabs {
  const abort = new AbortController();
  let activeWorkspace = initialWorkspace;
  root.hidden = false;
  root.innerHTML = `
    <div class="asset-workspace-tabs__inner" role="tablist" aria-label="Developer workspaces">
      ${ASSET_WORKSPACES.map((workspace) => `
        <button
          id="asset-workspace-tab-${workspace.id}"
          type="button"
          role="tab"
          aria-controls="${panel.id}"
          data-asset-workspace="${workspace.id}"
        >${workspace.label}</button>
      `).join("")}
    </div>`;
  panel.setAttribute("role", "tabpanel");

  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-asset-workspace]")];
  let historyIndex = historyStateIndex(window.history.state) ?? 0;
  let restoringHistory = false;
  window.history.replaceState(
    workspaceHistoryState(window.history.state, initialWorkspace.id, historyIndex),
    "",
    window.location.href,
  );

  const sync = (workspace: Readonly<AssetWorkspaceModule>, focus: boolean, push: boolean): boolean => {
    if (workspace.id !== activeWorkspace.id) {
      if (navigation && !navigation.confirmWorkspaceChange(activeWorkspace.id)) {
        const activeButton = buttons.find(({ dataset }) => dataset.assetWorkspace === activeWorkspace.id);
        if (focus) activeButton?.focus();
        return false;
      }
      activeWorkspace = workspace;
      activate(workspace);
    }
    for (const button of buttons) {
      const selected = button.dataset.assetWorkspace === workspace.id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    panel.setAttribute("aria-labelledby", `asset-workspace-tab-${workspace.id}`);
    document.documentElement.dataset.assetWorkspace = workspace.id;
    if (push) {
      historyIndex++;
      window.history.pushState(
        workspaceHistoryState(window.history.state, workspace.id, historyIndex),
        "",
        assetWorkspaceHref(workspace.id as AssetWorkspaceId),
      );
    }
    return true;
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const workspace = assetWorkspaceById(button.dataset.assetWorkspace);
      if (workspace) sync(workspace, false, true);
    }, { signal: abort.signal });
    button.addEventListener("keydown", (event) => {
      const id = button.dataset.assetWorkspace as AssetWorkspaceId;
      let nextId: AssetWorkspaceId | undefined;
      if (event.key === "ArrowLeft") nextId = adjacentAssetWorkspaceId(id, -1);
      else if (event.key === "ArrowRight") nextId = adjacentAssetWorkspaceId(id, 1);
      else if (event.key === "Home") nextId = ASSET_WORKSPACES[0].id;
      else if (event.key === "End") nextId = ASSET_WORKSPACES.at(-1)!.id;
      if (!nextId) return;
      event.preventDefault();
      sync(assetWorkspaceById(nextId)!, true, true);
    }, { signal: abort.signal });
  }
  window.addEventListener("popstate", (event) => {
    if (restoringHistory) {
      restoringHistory = false;
      return;
    }
    const targetIndex = historyStateIndex(event.state);
    const accepted = sync(
      assetWorkspaceById(new URLSearchParams(window.location.search).get("workspace") ?? undefined)
        ?? ASSET_WORKSPACES[0],
      true,
      false,
    );
    if (accepted) {
      if (targetIndex !== undefined) historyIndex = targetIndex;
      return;
    }
    if (targetIndex !== undefined && targetIndex !== historyIndex) {
      restoringHistory = true;
      window.history.go(historyIndex - targetIndex);
      return;
    }
    window.history.pushState(
      workspaceHistoryState(window.history.state, activeWorkspace.id, historyIndex),
      "",
      assetWorkspaceHref(activeWorkspace.id as AssetWorkspaceId),
    );
  }, { signal: abort.signal });
  sync(initialWorkspace, false, false);

  return {
    get activeWorkspace() { return activeWorkspace; },
    destroy(): void {
      abort.abort();
      root.replaceChildren();
      root.hidden = true;
      panel.removeAttribute("role");
      panel.removeAttribute("aria-labelledby");
      delete document.documentElement.dataset.assetWorkspace;
    },
  };
}

function historyStateIndex(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("assetWorkspaceIndex" in value)) return undefined;
  const index = (value as { readonly assetWorkspaceIndex?: unknown }).assetWorkspaceIndex;
  return Number.isSafeInteger(index) ? index as number : undefined;
}

function workspaceHistoryState(value: unknown, workspaceId: string, index: number): Record<string, unknown> {
  const prior = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return { ...prior, assetWorkspace: workspaceId, assetWorkspaceIndex: index };
}
