import type { AuthoredAssetId } from "../AuthoredAssetContracts";
import type { AssetLibraryEntry } from "../AssetLibraryCatalog";
import type { RuntimeCollisionObjectKind } from "../CollisionProfileRegistry";

export interface AssetWorkspaceBase {
  readonly id: string;
  readonly label: string;
  readonly kind: "library" | "great-hall-preview" | "audio-preview";
}

export interface AssetLibraryWorkspaceModule extends AssetWorkspaceBase {
  readonly kind: "library";
  readonly initialAssetId: AuthoredAssetId;
  readonly collisionObjectKinds: readonly RuntimeCollisionObjectKind[];
  accepts(entry: Readonly<AssetLibraryEntry>): boolean;
}

export interface GreatHallAssetWorkspaceModule extends AssetWorkspaceBase {
  readonly kind: "great-hall-preview";
}

export interface AudioAssetWorkspaceModule extends AssetWorkspaceBase {
  readonly kind: "audio-preview";
}

export type AssetWorkspaceModule =
  | AssetLibraryWorkspaceModule
  | GreatHallAssetWorkspaceModule
  | AudioAssetWorkspaceModule;

export function assetWorkspaceSelectionKey(workspaceId: string): string {
  return `wayfinders:asset-workspace:${workspaceId}:selection`;
}

export function assetWorkspaceSceneKey(workspaceId: string): string {
  return `AssetViewerScene:${workspaceId}`;
}
