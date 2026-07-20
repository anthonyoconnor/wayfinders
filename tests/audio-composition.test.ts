import { describe, expect, it } from "vitest";

import { composeApplicationScenes } from "../src/wayfinders/app/ApplicationSceneComposition";
import { resolveAssetWorkspace } from "../src/wayfinders/assets/AssetWorkspaceRegistry";
import type { AssetWorkspaceModule } from "../src/wayfinders/assets/workspaces/AssetWorkspace";
import type { AudioCatalogLoadResult } from "../src/wayfinders/audio";

interface SceneToken {
  readonly kind: "game" | "workspace" | "trial";
  readonly id?: string;
}

const unavailableAudio: AudioCatalogLoadResult = Object.freeze({
  ok: false,
  error: new Error("catalog unavailable"),
});

describe("audio application composition", () => {
  it("hands one loaded catalog result to game composition", async () => {
    let loadCount = 0;
    let gameCatalog: AudioCatalogLoadResult | undefined;
    const composition = await composeApplicationScenes<SceneToken>(
      { mode: "game" },
      {
        loadAudioCatalog: async () => {
          loadCount++;
          return unavailableAudio;
        },
        createGameScene: (catalog) => {
          gameCatalog = catalog;
          return { kind: "game" };
        },
        createAssetWorkspaceScene: () => {
          throw new Error("Game composition must not create an asset workspace scene");
        },
        createAssetTrialScene: () => {
          throw new Error("Game composition must not create a trial scene");
        },
      },
    );

    expect(composition).toMatchObject({ mode: "game", initialScene: { kind: "game" } });
    expect(loadCount).toBe(1);
    expect(gameCatalog).toBe(unavailableAudio);
    expect(composition.mode === "game" && composition.audioCatalogResult).toBe(unavailableAudio);
  });

  it("reuses the initial asset catalog result when a later workspace scene is created", async () => {
    const initialWorkspace = resolveAssetWorkspace("?mode=assets&workspace=islands");
    const nextWorkspace = resolveAssetWorkspace("?mode=assets&workspace=audio");
    const handoffs: Array<Readonly<{
      workspace: Readonly<AssetWorkspaceModule>;
      catalog: AudioCatalogLoadResult;
    }>> = [];
    let loadCount = 0;
    const composition = await composeApplicationScenes<SceneToken>(
      { mode: "assets", initialWorkspace },
      {
        loadAudioCatalog: async () => {
          loadCount++;
          return unavailableAudio;
        },
        createGameScene: () => {
          throw new Error("Asset composition must not create a game scene");
        },
        createAssetWorkspaceScene: (workspace, catalog) => {
          handoffs.push({ workspace, catalog });
          return { kind: "workspace", id: workspace.id };
        },
        createAssetTrialScene: () => {
          throw new Error("Asset composition must not create a trial scene");
        },
      },
    );

    expect(composition.mode).toBe("assets");
    if (composition.mode !== "assets") throw new Error("Expected asset composition");
    expect(composition.initialScene).toEqual({ kind: "workspace", id: initialWorkspace.id });
    expect(composition.createWorkspaceScene(nextWorkspace)).toEqual({
      kind: "workspace",
      id: nextWorkspace.id,
    });
    expect(loadCount).toBe(1);
    expect(handoffs.map(({ workspace }) => workspace)).toEqual([
      initialWorkspace,
      nextWorkspace,
    ]);
    expect(handoffs.every(({ catalog }) => catalog === unavailableAudio)).toBe(true);
  });

  it("keeps trial composition audio-free", async () => {
    let loadCount = 0;
    const trialRequest = {
      candidateId: "production.island.test-cay",
      candidateFingerprint: "a".repeat(64),
    };
    const composition = await composeApplicationScenes<SceneToken>(
      { mode: "asset-trial", trialRequest },
      {
        loadAudioCatalog: async () => {
          loadCount++;
          return unavailableAudio;
        },
        createGameScene: () => {
          throw new Error("Trial composition must not create a game scene");
        },
        createAssetWorkspaceScene: () => {
          throw new Error("Trial composition must not create an asset workspace scene");
        },
        createAssetTrialScene: (request) => ({
          kind: "trial",
          id: `${request.candidateId}:${request.candidateFingerprint}`,
        }),
      },
    );

    expect(loadCount).toBe(0);
    expect(composition).toEqual({
      mode: "asset-trial",
      initialScene: {
        kind: "trial",
        id: `${trialRequest.candidateId}:${trialRequest.candidateFingerprint}`,
      },
    });
    expect("audioCatalogResult" in composition).toBe(false);
  });
});
