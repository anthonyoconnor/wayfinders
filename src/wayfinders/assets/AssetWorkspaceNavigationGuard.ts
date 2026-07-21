export interface AssetWorkspaceDirtyNavigationGuard {
  readonly discardMessage?: string;
  hasUnsavedChanges(): boolean;
  isNavigationBlocked?(): boolean;
}

export interface AssetWorkspaceNavigationController {
  register(
    workspaceId: string,
    guard: Readonly<AssetWorkspaceDirtyNavigationGuard>,
  ): () => void;
  confirmWorkspaceChange(activeWorkspaceId: string): boolean;
  destroy(): void;
}

interface NavigationWindow {
  confirm(message?: string): boolean;
  addEventListener(type: "beforeunload", listener: EventListener): void;
  removeEventListener(type: "beforeunload", listener: EventListener): void;
}

interface ActiveGuard {
  readonly token: symbol;
  readonly workspaceId: string;
  readonly guard: Readonly<AssetWorkspaceDirtyNavigationGuard>;
}

const DEFAULT_DISCARD_MESSAGE = "Discard unsaved workspace changes and undo history?";

/** Shell-owned protection for dirty workspace drafts and page navigation. */
export function createAssetWorkspaceNavigationController(
  browserWindow: NavigationWindow = window,
): AssetWorkspaceNavigationController {
  let active: ActiveGuard | undefined;

  const beforeUnload: EventListener = (event) => {
    if (!active || (!active.guard.hasUnsavedChanges() && !active.guard.isNavigationBlocked?.())) return;
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = "";
  };
  browserWindow.addEventListener("beforeunload", beforeUnload);

  return {
    register(workspaceId, guard) {
      const registration = Object.freeze({ token: Symbol(workspaceId), workspaceId, guard });
      active = registration;
      return () => {
        if (active?.token === registration.token) active = undefined;
      };
    },
    confirmWorkspaceChange(activeWorkspaceId) {
      if (!active || active.workspaceId !== activeWorkspaceId) return true;
      if (active.guard.isNavigationBlocked?.()) return false;
      if (!active.guard.hasUnsavedChanges()) return true;
      return browserWindow.confirm(active.guard.discardMessage ?? DEFAULT_DISCARD_MESSAGE);
    },
    destroy() {
      active = undefined;
      browserWindow.removeEventListener("beforeunload", beforeUnload);
    },
  };
}
