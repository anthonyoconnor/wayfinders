import type { AuthoredAssetId } from "../AuthoredAssetContracts";
import type { AssetLibraryEntry } from "../AssetLibraryCatalog";
import type { RuntimeCollisionObjectKind } from "../CollisionProfileRegistry";

export interface AssetWorkspaceBase {
  readonly id: string;
  readonly label: string;
  readonly kind:
    | "library"
    | "achievement-icons-preview"
    | "great-hall-preview"
    | "audio-preview"
    | "cloud-preview"
    | "water-preview";
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

export interface AchievementIconAssetWorkspaceModule extends AssetWorkspaceBase {
  readonly kind: "achievement-icons-preview";
}

export interface AudioAssetWorkspaceModule extends AssetWorkspaceBase {
  readonly kind: "audio-preview";
}

export interface WaterAssetWorkspaceModule extends AssetWorkspaceBase {
  readonly kind: "water-preview";
}

export interface CloudAssetWorkspaceModule extends AssetWorkspaceBase {
  readonly kind: "cloud-preview";
}

export type AssetWorkspaceModule =
  | AssetLibraryWorkspaceModule
  | AchievementIconAssetWorkspaceModule
  | GreatHallAssetWorkspaceModule
  | AudioAssetWorkspaceModule
  | CloudAssetWorkspaceModule
  | WaterAssetWorkspaceModule;

export function assetWorkspaceSelectionKey(workspaceId: string): string {
  return `wayfinders:asset-workspace:${workspaceId}:selection`;
}

export function assetWorkspaceSceneKey(workspaceId: string): string {
  return `AssetViewerScene:${workspaceId}`;
}
