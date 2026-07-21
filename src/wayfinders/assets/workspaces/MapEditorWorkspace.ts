import type { MapEditorWorkspaceModule } from "./AssetWorkspace";

export const MAP_EDITOR_WORKSPACE = Object.freeze({
  id: "maps",
  label: "Maps",
  kind: "map-editor",
} satisfies MapEditorWorkspaceModule);
