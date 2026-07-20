import { describe, expect, it, vi } from "vitest";
import { ASSET_LIBRARY_CATALOG } from "../src/wayfinders/assets/AssetLibraryCatalog";
import { RUNTIME_COLLISION_OBJECT_KINDS } from "../src/wayfinders/assets/CollisionProfileRegistry";
import {
  ASSET_WORKSPACES,
  adjacentAssetWorkspaceId,
  assetWorkspaceHref,
  resolveAssetWorkspace,
} from "../src/wayfinders/assets/AssetWorkspaceRegistry";
import { mountAssetWorkspaceTabs } from "../src/wayfinders/assets/AssetWorkspaceTabs";
import {
  assetWorkspaceSceneKey,
  assetWorkspaceSelectionKey,
} from "../src/wayfinders/assets/workspaces/AssetWorkspace";

class FakeTabButton extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly dataset: { assetWorkspace: string };
  tabIndex = 0;
  focused = false;

  constructor(workspaceId: string) {
    super();
    this.dataset = { assetWorkspace: workspaceId };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  focus(): void {
    this.focused = true;
  }
}

class FakeTabRoot {
  hidden = true;
  buttons: FakeTabButton[] = [];
  private markup = "";

  set innerHTML(value: string) {
    this.markup = value;
    this.buttons = [...value.matchAll(/data-asset-workspace="([^"]+)"/gu)]
      .map((match) => new FakeTabButton(match[1]!));
  }

  get innerHTML(): string {
    return this.markup;
  }

  querySelectorAll<T>(): T[] {
    return this.buttons as unknown as T[];
  }

  replaceChildren(): void {
    this.markup = "";
    this.buttons = [];
  }
}

class FakeBrowserWindow extends EventTarget {
  readonly pushedUrls: string[] = [];
  readonly location = { search: "?mode=assets&workspace=islands" };
  readonly history = {
    pushState: (_state: unknown, _unused: string, url: string | URL | null): void => {
      const href = String(url ?? "");
      this.pushedUrls.push(href);
      this.location.search = href;
    },
  };
}

function keyboardEvent(key: string): Event {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  return event;
}

describe("GR-4.0 isolated asset workspaces", () => {
  it("registers the initial workspaces in stable tab order with one owned catalog partition", () => {
    expect(ASSET_WORKSPACES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "islands", label: "Islands" },
      { id: "ships", label: "Ships" },
      { id: "traffic", label: "Ship traffic" },
      { id: "fishing-shoals", label: "Fishing shoals" },
      { id: "water", label: "Water" },
      { id: "clouds", label: "Clouds" },
      { id: "icons", label: "Icons" },
      { id: "great-hall", label: "Great Hall" },
      { id: "audio", label: "Audio" },
    ]);
    const libraryWorkspaces = ASSET_WORKSPACES.filter((workspace) => workspace.kind === "library");
    for (const entry of ASSET_LIBRARY_CATALOG) {
      expect(libraryWorkspaces.filter((workspace) => workspace.accepts(entry)), entry.id).toHaveLength(1);
    }
    for (const workspace of libraryWorkspaces) {
      expect(ASSET_LIBRARY_CATALOG.some((entry) =>
        entry.id === workspace.initialAssetId && workspace.accepts(entry))).toBe(true);
    }
    for (const objectKind of RUNTIME_COLLISION_OBJECT_KINDS) {
      expect(
        libraryWorkspaces.filter((workspace) =>
          workspace.collisionObjectKinds.some((ownedKind) => ownedKind === objectKind)),
        objectKind,
      ).toHaveLength(1);
    }
  });

  it("resolves direct links, defaults invalid values, and builds stable history URLs", () => {
    expect(resolveAssetWorkspace("?mode=assets&workspace=ships").id).toBe("ships");
    expect(resolveAssetWorkspace("?mode=assets&workspace=traffic").id).toBe("traffic");
    expect(resolveAssetWorkspace("?mode=assets&workspace=fishing-shoals").id).toBe("fishing-shoals");
    expect(resolveAssetWorkspace("?mode=assets&workspace=water").id).toBe("water");
    expect(resolveAssetWorkspace("?mode=assets&workspace=clouds").id).toBe("clouds");
    expect(resolveAssetWorkspace("?mode=assets&workspace=icons").id).toBe("icons");
    expect(resolveAssetWorkspace("?mode=assets&workspace=great-hall").id).toBe("great-hall");
    expect(resolveAssetWorkspace("?mode=assets&workspace=audio").id).toBe("audio");
    expect(resolveAssetWorkspace("?mode=assets&workspace=unknown").id).toBe("islands");
    expect(assetWorkspaceHref("islands")).toBe("?mode=assets&workspace=islands");
    expect(assetWorkspaceHref("traffic")).toBe("?mode=assets&workspace=traffic");
    expect(assetWorkspaceHref("water")).toBe("?mode=assets&workspace=water");
    expect(assetWorkspaceHref("clouds")).toBe("?mode=assets&workspace=clouds");
    expect(assetWorkspaceHref("icons")).toBe("?mode=assets&workspace=icons");
    expect(assetWorkspaceHref("great-hall")).toBe("?mode=assets&workspace=great-hall");
    expect(assetWorkspaceHref("audio")).toBe("?mode=assets&workspace=audio");
  });

  it("supports wrapping arrow navigation and namespaces scene and selection state", () => {
    expect(adjacentAssetWorkspaceId("islands", -1)).toBe("audio");
    expect(adjacentAssetWorkspaceId("islands", 1)).toBe("ships");
    expect(adjacentAssetWorkspaceId("ships", 1)).toBe("traffic");
    expect(adjacentAssetWorkspaceId("traffic", 1)).toBe("fishing-shoals");
    expect(adjacentAssetWorkspaceId("fishing-shoals", 1)).toBe("water");
    expect(adjacentAssetWorkspaceId("water", 1)).toBe("clouds");
    expect(adjacentAssetWorkspaceId("clouds", 1)).toBe("icons");
    expect(adjacentAssetWorkspaceId("icons", 1)).toBe("great-hall");
    expect(adjacentAssetWorkspaceId("great-hall", 1)).toBe("audio");
    expect(adjacentAssetWorkspaceId("audio", 1)).toBe("islands");
    expect(assetWorkspaceSceneKey("ships")).toBe("AssetViewerScene:ships");
    expect(assetWorkspaceSceneKey("traffic")).toBe("AssetViewerScene:traffic");
    expect(assetWorkspaceSceneKey("icons")).toBe("AssetViewerScene:icons");
    expect(assetWorkspaceSceneKey("great-hall")).toBe("AssetViewerScene:great-hall");
    expect(assetWorkspaceSceneKey("water")).toBe("AssetViewerScene:water");
    expect(assetWorkspaceSceneKey("clouds")).toBe("AssetViewerScene:clouds");
    expect(assetWorkspaceSelectionKey("ships")).toBe("wayfinders:asset-workspace:ships:selection");
  });

  it("mounts accessible tabs, activates pointer and keyboard navigation, follows history, and tears down", () => {
    const root = new FakeTabRoot();
    const panelAttributes = new Map<string, string>();
    const panel = {
      id: "asset-workspace-panel",
      setAttribute: (name: string, value: string) => panelAttributes.set(name, value),
      removeAttribute: (name: string) => panelAttributes.delete(name),
    };
    const browser = new FakeBrowserWindow();
    const documentElement = { dataset: {} as Record<string, string | undefined> };
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", { documentElement });

    try {
      const activated: string[] = [];
      const tabs = mountAssetWorkspaceTabs(
        root as unknown as HTMLElement,
        panel as unknown as HTMLElement,
        ASSET_WORKSPACES[0],
        (workspace) => activated.push(workspace.id),
      );
      expect(root.hidden).toBe(false);
      expect(root.innerHTML).toContain('role="tablist"');
      expect(root.innerHTML.match(/role="tab"/gu)).toHaveLength(ASSET_WORKSPACES.length);
      expect(root.buttons).toHaveLength(ASSET_WORKSPACES.length);
      expect(root.buttons.map((button) => button.attributes.get("aria-selected"))).toEqual([
        "true", "false", "false", "false", "false", "false", "false", "false", "false",
      ]);
      expect(root.buttons.map(({ tabIndex }) => tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1, -1]);
      expect(panelAttributes.get("role")).toBe("tabpanel");
      expect(panelAttributes.get("aria-labelledby")).toBe("asset-workspace-tab-islands");
      expect(documentElement.dataset.assetWorkspace).toBe("islands");

      root.buttons[1]!.dispatchEvent(new Event("click"));
      expect(tabs.activeWorkspace.id).toBe("ships");
      expect(activated).toEqual(["ships"]);
      expect(browser.pushedUrls).toEqual(["?mode=assets&workspace=ships"]);
      expect(root.buttons[1]!.attributes.get("aria-selected")).toBe("true");
      expect(root.buttons[1]!.tabIndex).toBe(0);
      expect(root.buttons[0]!.tabIndex).toBe(-1);

      const arrowRight = keyboardEvent("ArrowRight");
      root.buttons[1]!.dispatchEvent(arrowRight);
      expect(arrowRight.defaultPrevented).toBe(true);
      expect(tabs.activeWorkspace.id).toBe("traffic");
      expect(root.buttons[2]!.focused).toBe(true);

      root.buttons[2]!.dispatchEvent(keyboardEvent("End"));
      expect(tabs.activeWorkspace.id).toBe("audio");
      expect(root.buttons.at(-1)!.focused).toBe(true);
      root.buttons.at(-1)!.dispatchEvent(keyboardEvent("Home"));
      expect(tabs.activeWorkspace.id).toBe("islands");
      expect(root.buttons[0]!.focused).toBe(true);
      root.buttons[0]!.dispatchEvent(keyboardEvent("ArrowLeft"));
      expect(tabs.activeWorkspace.id).toBe("audio");
      expect(browser.pushedUrls).toEqual([
        "?mode=assets&workspace=ships",
        "?mode=assets&workspace=traffic",
        "?mode=assets&workspace=audio",
        "?mode=assets&workspace=islands",
        "?mode=assets&workspace=audio",
      ]);

      browser.location.search = "?mode=assets&workspace=clouds";
      const pushesBeforePopstate = browser.pushedUrls.length;
      browser.dispatchEvent(new Event("popstate"));
      expect(tabs.activeWorkspace.id).toBe("clouds");
      expect(root.buttons[5]!.focused).toBe(true);
      expect(browser.pushedUrls).toHaveLength(pushesBeforePopstate);

      const detachedButton = root.buttons[1]!;
      const activationsBeforeDestroy = [...activated];
      tabs.destroy();
      expect(root.hidden).toBe(true);
      expect(root.innerHTML).toBe("");
      expect(panelAttributes.has("role")).toBe(false);
      expect(panelAttributes.has("aria-labelledby")).toBe(false);
      expect(documentElement.dataset.assetWorkspace).toBeUndefined();
      browser.location.search = "?mode=assets&workspace=ships";
      detachedButton.dispatchEvent(new Event("click"));
      detachedButton.dispatchEvent(keyboardEvent("ArrowRight"));
      browser.dispatchEvent(new Event("popstate"));
      expect(activated).toEqual(activationsBeforeDestroy);
      expect(browser.pushedUrls).toHaveLength(pushesBeforePopstate);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
