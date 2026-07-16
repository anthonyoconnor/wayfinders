import {
  ASSET_WORKSPACES,
  adjacentAssetWorkspaceId,
  assetWorkspaceById,
  assetWorkspaceHref,
  type AssetWorkspaceId,
} from "./AssetWorkspaceRegistry";
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
): AssetWorkspaceTabs {
  const abort = new AbortController();
  let activeWorkspace = initialWorkspace;
  root.hidden = false;
  root.innerHTML = `
    <div class="asset-workspace-tabs__inner" role="tablist" aria-label="Asset workspaces">
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
  const sync = (workspace: Readonly<AssetWorkspaceModule>, focus: boolean, push: boolean) => {
    if (workspace.id !== activeWorkspace.id) {
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
    if (push) window.history.pushState({ assetWorkspace: workspace.id }, "", assetWorkspaceHref(workspace.id as AssetWorkspaceId));
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
  window.addEventListener("popstate", () => {
    sync(assetWorkspaceById(new URLSearchParams(window.location.search).get("workspace") ?? undefined)
      ?? ASSET_WORKSPACES[0], true, false);
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
