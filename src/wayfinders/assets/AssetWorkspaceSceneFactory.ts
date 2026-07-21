import Phaser from "phaser";
import type { AudioCatalogLoadResult } from "../audio";
import { AchievementIconPreviewScene } from "./achievementIcons/AchievementIconPreviewScene";
import { AssetViewerScene } from "./AssetViewerScene";
import { AudioAssetWorkspaceScene } from "./audioPreview/AudioAssetWorkspaceScene";
import { CloudAssetWorkspaceScene } from "./cloudPreview/CloudAssetWorkspaceScene";
import { GreatHallPreviewScene } from "./greatHall/GreatHallPreviewScene";
import { MapEditorWorkspaceScene } from "./mapEditor/MapEditorWorkspaceScene";
import { ProsperityTrafficAssetPreviewScene } from "./prosperityTraffic/ProsperityTrafficAssetPreviewScene";
import type { AssetWorkspaceNavigationController } from "./AssetWorkspaceNavigationGuard";
import { audioWorkspaceCatalogSource } from "./workspaces/AudioWorkspaceCatalog";
import type { AssetWorkspaceModule } from "./workspaces/AssetWorkspace";
import { WaterPreviewScene } from "./water/WaterPreviewScene";

export function createAssetWorkspaceScene(
  workspace: Readonly<AssetWorkspaceModule>,
  audioCatalogResult?: AudioCatalogLoadResult,
  navigation?: Readonly<AssetWorkspaceNavigationController>,
): Phaser.Scene {
  switch (workspace.kind) {
    case "achievement-icons-preview": return new AchievementIconPreviewScene(workspace);
    case "great-hall-preview": return new GreatHallPreviewScene(workspace);
    case "map-editor": return new MapEditorWorkspaceScene(workspace, { navigation });
    case "audio-preview": return new AudioAssetWorkspaceScene(
      workspace,
      audioWorkspaceCatalogSource(audioCatalogResult),
    );
    case "cloud-preview": return new CloudAssetWorkspaceScene(workspace);
    case "prosperity-traffic-preview": return new ProsperityTrafficAssetPreviewScene(workspace);
    case "water-preview": return new WaterPreviewScene(workspace);
    case "library": return new AssetViewerScene(workspace);
  }
}
