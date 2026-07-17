import Phaser from "phaser";
import type { AudioCatalogLoadResult } from "../audio";
import { AssetViewerScene } from "./AssetViewerScene";
import { AudioAssetWorkspaceScene } from "./audioPreview/AudioAssetWorkspaceScene";
import { GreatHallPreviewScene } from "./greatHall/GreatHallPreviewScene";
import { audioWorkspaceCatalogSource } from "./workspaces/AudioWorkspaceCatalog";
import type { AssetWorkspaceModule } from "./workspaces/AssetWorkspace";
import { WaterPreviewScene } from "./water/WaterPreviewScene";

export function createAssetWorkspaceScene(
  workspace: Readonly<AssetWorkspaceModule>,
  audioCatalogResult?: AudioCatalogLoadResult,
): Phaser.Scene {
  switch (workspace.kind) {
    case "great-hall-preview": return new GreatHallPreviewScene(workspace);
    case "audio-preview": return new AudioAssetWorkspaceScene(
      workspace,
      audioWorkspaceCatalogSource(audioCatalogResult),
    );
    case "water-preview": return new WaterPreviewScene(workspace);
    case "library": return new AssetViewerScene(workspace);
  }
}
