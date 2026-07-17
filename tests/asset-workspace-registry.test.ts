import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSET_LIBRARY_CATALOG } from "../src/wayfinders/assets/AssetLibraryCatalog";
import { RUNTIME_COLLISION_OBJECT_KINDS } from "../src/wayfinders/assets/CollisionProfileRegistry";
import {
  ASSET_WORKSPACES,
  adjacentAssetWorkspaceId,
  assetWorkspaceHref,
  resolveAssetWorkspace,
} from "../src/wayfinders/assets/AssetWorkspaceRegistry";
import {
  assetWorkspaceSceneKey,
  assetWorkspaceSelectionKey,
} from "../src/wayfinders/assets/workspaces/AssetWorkspace";

describe("GR-4.0 isolated asset workspaces", () => {
  it("registers the initial workspaces in stable tab order with one owned catalog partition", () => {
    expect(ASSET_WORKSPACES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "islands", label: "Islands" },
      { id: "ships", label: "Ships" },
      { id: "fishing-shoals", label: "Fishing shoals" },
      { id: "water", label: "Water" },
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
    expect(resolveAssetWorkspace("?mode=assets&workspace=fishing-shoals").id).toBe("fishing-shoals");
    expect(resolveAssetWorkspace("?mode=assets&workspace=water").id).toBe("water");
    expect(resolveAssetWorkspace("?mode=assets&workspace=great-hall").id).toBe("great-hall");
    expect(resolveAssetWorkspace("?mode=assets&workspace=audio").id).toBe("audio");
    expect(resolveAssetWorkspace("?mode=assets&workspace=unknown").id).toBe("islands");
    expect(assetWorkspaceHref("islands")).toBe("?mode=assets&workspace=islands");
    expect(assetWorkspaceHref("water")).toBe("?mode=assets&workspace=water");
    expect(assetWorkspaceHref("great-hall")).toBe("?mode=assets&workspace=great-hall");
    expect(assetWorkspaceHref("audio")).toBe("?mode=assets&workspace=audio");
  });

  it("supports wrapping arrow navigation and namespaces scene and selection state", () => {
    expect(adjacentAssetWorkspaceId("islands", -1)).toBe("audio");
    expect(adjacentAssetWorkspaceId("islands", 1)).toBe("ships");
    expect(adjacentAssetWorkspaceId("fishing-shoals", 1)).toBe("water");
    expect(adjacentAssetWorkspaceId("water", 1)).toBe("great-hall");
    expect(adjacentAssetWorkspaceId("great-hall", 1)).toBe("audio");
    expect(adjacentAssetWorkspaceId("audio", 1)).toBe("islands");
    expect(assetWorkspaceSceneKey("ships")).toBe("AssetViewerScene:ships");
    expect(assetWorkspaceSceneKey("great-hall")).toBe("AssetViewerScene:great-hall");
    expect(assetWorkspaceSceneKey("water")).toBe("AssetViewerScene:water");
    expect(assetWorkspaceSelectionKey("ships")).toBe("wayfinders:asset-workspace:ships:selection");
  });

  it("mounts accessible tabs and switches isolated Phaser scenes through one registry seam", () => {
    const tabs = readFileSync(
      new URL("../src/wayfinders/assets/AssetWorkspaceTabs.ts", import.meta.url),
      "utf8",
    );
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const scene = readFileSync(
      new URL("../src/wayfinders/assets/AssetViewerScene.ts", import.meta.url),
      "utf8",
    );

    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain('panel.setAttribute("role", "tabpanel")');
    expect(tabs).toContain('"ArrowLeft"');
    expect(tabs).toContain('"ArrowRight"');
    expect(tabs).toContain('"popstate"');
    expect(main).toContain("wayfindersGame!.scene.stop(previousKey)");
    expect(main).toContain("wayfindersGame!.scene.start(nextKey)");
    expect(main).toContain("createAssetWorkspaceScene(workspace, audioCatalogResult)");
    expect(scene).toContain("this.controlsAbort?.abort()");
    expect(scene).toContain("assetWorkspaceSelectionKey(this.workspace.id)");
    expect(scene).toContain("this.workspaceCatalog");
  });
});
