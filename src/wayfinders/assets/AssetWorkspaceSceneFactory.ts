import Phaser from "phaser";
import { AssetViewerScene } from "./AssetViewerScene";
import { GreatHallPreviewScene } from "./greatHall/GreatHallPreviewScene";
import type { AssetWorkspaceModule } from "./workspaces/AssetWorkspace";

export function createAssetWorkspaceScene(
  workspace: Readonly<AssetWorkspaceModule>,
): Phaser.Scene {
  return workspace.kind === "great-hall-preview"
    ? new GreatHallPreviewScene(workspace)
    : new AssetViewerScene(workspace);
}
