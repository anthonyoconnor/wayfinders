export enum TerrainType {
  DeepOcean = 0,
  ShallowOcean = 1,
  Reef = 2,
  Rock = 3,
  Land = 4,
}

export enum KnowledgeState {
  Unknown = 0,
  Personal = 1,
  Supported = 2,
}

export interface TileSnapshot {
  terrain: TerrainType;
  knowledge: KnowledgeState;
  visibleNow: boolean;
  movementBlocked: boolean;
  sightBlocked: boolean;
  expeditionStamp: number;
  islandId: number;
  resourceId: number;
}

export function terrainBlocksMovement(terrain: TerrainType): boolean {
  return terrain === TerrainType.Reef || terrain === TerrainType.Rock || terrain === TerrainType.Land;
}

export function terrainBlocksSight(terrain: TerrainType): boolean {
  return terrain === TerrainType.Rock || terrain === TerrainType.Land;
}
