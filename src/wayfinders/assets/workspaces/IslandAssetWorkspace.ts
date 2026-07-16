import { AUTHORED_ASSET_IDS } from "../AuthoredAssetContracts";
import type { AssetLibraryEntry } from "../AssetLibraryCatalog";
import type { AssetWorkspaceModule } from "./AssetWorkspace";

export const ISLAND_ASSET_WORKSPACE = Object.freeze({
  id: "islands",
  label: "Islands",
  initialAssetId: AUTHORED_ASSET_IDS.homeIsland,
  collisionObjectKinds: [
    "home-island",
    "generated-island",
    "island-approach",
    "home-dock",
  ] as const,
  accepts: (entry: Readonly<AssetLibraryEntry>) => entry.categoryId === "islands",
} satisfies AssetWorkspaceModule);
