import { AUTHORED_ASSET_IDS } from "../AuthoredAssetContracts";
import type { AssetLibraryEntry } from "../AssetLibraryCatalog";
import type { AssetWorkspaceModule } from "./AssetWorkspace";

export const FISHING_SHOAL_ASSET_WORKSPACE = Object.freeze({
  id: "fishing-shoals",
  label: "Fishing shoals",
  kind: "library",
  initialAssetId: AUTHORED_ASSET_IDS.fishingShoal,
  collisionObjectKinds: ["fishing-shoal", "survey-site", "survey-service"] as const,
  accepts: (entry: Readonly<AssetLibraryEntry>) => entry.categoryId === "world-features",
} satisfies AssetWorkspaceModule);
