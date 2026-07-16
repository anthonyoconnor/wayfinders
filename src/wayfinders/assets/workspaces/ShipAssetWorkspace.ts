import { AUTHORED_ASSET_IDS } from "../AuthoredAssetContracts";
import type { AssetLibraryEntry } from "../AssetLibraryCatalog";
import type { AssetWorkspaceModule } from "./AssetWorkspace";

export const SHIP_ASSET_WORKSPACE = Object.freeze({
  id: "ships",
  label: "Ships",
  initialAssetId: AUTHORED_ASSET_IDS.playerBoat,
  collisionObjectKinds: ["player-ship", "wreck"] as const,
  accepts: (entry: Readonly<AssetLibraryEntry>) => entry.categoryId === "vessels",
} satisfies AssetWorkspaceModule);
