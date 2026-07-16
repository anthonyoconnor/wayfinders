import { FISHING_SHOAL_ASSET_WORKSPACE } from "./workspaces/FishingShoalAssetWorkspace";
import { GREAT_HALL_ASSET_WORKSPACE } from "./workspaces/GreatHallAssetWorkspace";
import { ISLAND_ASSET_WORKSPACE } from "./workspaces/IslandAssetWorkspace";
import { SHIP_ASSET_WORKSPACE } from "./workspaces/ShipAssetWorkspace";
import type { AssetWorkspaceModule } from "./workspaces/AssetWorkspace";

export const ASSET_WORKSPACES = Object.freeze([
  ISLAND_ASSET_WORKSPACE,
  SHIP_ASSET_WORKSPACE,
  FISHING_SHOAL_ASSET_WORKSPACE,
  GREAT_HALL_ASSET_WORKSPACE,
] as const);

export type AssetWorkspaceId = (typeof ASSET_WORKSPACES)[number]["id"];

export const DEFAULT_ASSET_WORKSPACE_ID: AssetWorkspaceId = "islands";

export function assetWorkspaceById(id: string | undefined): Readonly<AssetWorkspaceModule> | undefined {
  return ASSET_WORKSPACES.find((workspace) => workspace.id === id);
}

export function resolveAssetWorkspace(search: string): Readonly<AssetWorkspaceModule> {
  const requested = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("workspace");
  return assetWorkspaceById(requested ?? undefined)
    ?? assetWorkspaceById(DEFAULT_ASSET_WORKSPACE_ID)!;
}

export function assetWorkspaceHref(id: AssetWorkspaceId): string {
  return `?mode=assets&workspace=${encodeURIComponent(id)}`;
}

export function adjacentAssetWorkspaceId(
  id: AssetWorkspaceId,
  direction: -1 | 1,
): AssetWorkspaceId {
  const index = ASSET_WORKSPACES.findIndex((workspace) => workspace.id === id);
  const next = (index + direction + ASSET_WORKSPACES.length) % ASSET_WORKSPACES.length;
  return ASSET_WORKSPACES[next]!.id;
}
