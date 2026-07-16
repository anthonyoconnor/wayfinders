import type { AuthoredAssetId } from "../AuthoredAssetContracts";
import type { AssetLibraryEntry } from "../AssetLibraryCatalog";
import type { RuntimeCollisionObjectKind } from "../CollisionProfileRegistry";

export interface AssetWorkspaceModule {
  readonly id: string;
  readonly label: string;
  readonly initialAssetId: AuthoredAssetId;
  readonly collisionObjectKinds: readonly RuntimeCollisionObjectKind[];
  accepts(entry: Readonly<AssetLibraryEntry>): boolean;
}

export function assetWorkspaceSelectionKey(workspaceId: string): string {
  return `wayfinders:asset-workspace:${workspaceId}:selection`;
}

export function assetWorkspaceSceneKey(workspaceId: string): string {
  return `AssetViewerScene:${workspaceId}`;
}
