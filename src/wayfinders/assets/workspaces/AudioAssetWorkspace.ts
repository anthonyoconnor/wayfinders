import type { AudioAssetWorkspaceModule } from "./AssetWorkspace";

export const AUDIO_ASSET_WORKSPACE = Object.freeze({
  id: "audio",
  label: "Audio",
  kind: "audio-preview",
} satisfies AudioAssetWorkspaceModule);
