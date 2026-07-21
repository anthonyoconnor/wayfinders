import type {
  AssetTrialApplicationRequest,
} from "../assets/AssetAppMode";
import type { AssetWorkspaceModule } from "../assets/workspaces/AssetWorkspace";
import type { AudioCatalogLoadResult } from "../audio";
import type { AuthoredMapLaunchRequestV1 } from "./authoredMaps";

export type ApplicationSceneCompositionRequest =
  | Readonly<{
    mode: "game";
    worldSource: Readonly<AuthoredMapLaunchRequestV1>;
  }>
  | Readonly<{
    mode: "assets";
    initialWorkspace: Readonly<AssetWorkspaceModule>;
  }>
  | Readonly<{
    mode: "asset-trial";
    trialRequest: Readonly<AssetTrialApplicationRequest>;
  }>;

export interface ApplicationSceneFactories<Scene> {
  loadAudioCatalog(): Promise<AudioCatalogLoadResult>;
  createGameScene(
    audioCatalogResult: AudioCatalogLoadResult,
    worldSource: Readonly<AuthoredMapLaunchRequestV1>,
  ): Scene;
  createAssetWorkspaceScene(
    workspace: Readonly<AssetWorkspaceModule>,
    audioCatalogResult: AudioCatalogLoadResult,
  ): Scene;
  createAssetTrialScene(request: Readonly<AssetTrialApplicationRequest>): Scene;
}

export type ApplicationSceneComposition<Scene> =
  | Readonly<{
    mode: "game";
    initialScene: Scene;
    audioCatalogResult: AudioCatalogLoadResult;
    worldSource: Readonly<AuthoredMapLaunchRequestV1>;
  }>
  | Readonly<{
    mode: "assets";
    initialScene: Scene;
    audioCatalogResult: AudioCatalogLoadResult;
    createWorkspaceScene(workspace: Readonly<AssetWorkspaceModule>): Scene;
  }>
  | Readonly<{
    mode: "asset-trial";
    initialScene: Scene;
  }>;

/**
 * Selects the application scene without importing Phaser. Factories keep
 * concrete scene construction at the browser composition root while this seam
 * owns the mode-specific audio lifetime and catalog handoff.
 */
export async function composeApplicationScenes<Scene>(
  request: ApplicationSceneCompositionRequest,
  factories: Readonly<ApplicationSceneFactories<Scene>>,
): Promise<ApplicationSceneComposition<Scene>> {
  if (request.mode === "asset-trial") {
    return Object.freeze({
      mode: request.mode,
      initialScene: factories.createAssetTrialScene(request.trialRequest),
    });
  }

  const audioCatalogResult = await factories.loadAudioCatalog();
  if (request.mode === "game") {
    return Object.freeze({
      mode: request.mode,
      initialScene: factories.createGameScene(audioCatalogResult, request.worldSource),
      audioCatalogResult,
      worldSource: request.worldSource,
    });
  }

  return Object.freeze({
    mode: request.mode,
    initialScene: factories.createAssetWorkspaceScene(
      request.initialWorkspace,
      audioCatalogResult,
    ),
    audioCatalogResult,
    createWorkspaceScene: (workspace: Readonly<AssetWorkspaceModule>) => (
      factories.createAssetWorkspaceScene(workspace, audioCatalogResult)
    ),
  });
}
