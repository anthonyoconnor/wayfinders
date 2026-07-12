import { prototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
import { gridToChunk, gridToLocal } from "./CoordinateSystem";
import {
  KnowledgeState,
  TerrainType,
  terrainBlocksMovement,
  terrainBlocksSight,
  type TileSnapshot,
} from "./TileData";
import { WorldChunk } from "./WorldChunk";

export class WorldGrid {
  private readonly chunks = new Map<string, WorldChunk>();

  knowledgeVersion = 0;
  terrainVersion = 0;
  visibilityVersion = 0;

  constructor(
    readonly width = prototypeConfig.world.width,
    readonly height = prototypeConfig.world.height,
    readonly chunkSize = prototypeConfig.navigation.chunkSize,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("World dimensions must be positive integers");
    }
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError("Chunk size must be a positive integer");
  }

  get tileCount(): number {
    return this.width * this.height;
  }

  static chunkKey(chunkX: number, chunkY: number): string {
    return `${chunkX},${chunkY}`;
  }

  inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    this.assertInBounds(x, y);
    return y * this.width + x;
  }

  pointFromIndex(index: number): GridPoint {
    if (!Number.isInteger(index) || index < 0 || index >= this.tileCount) throw new RangeError(`Invalid world index ${index}`);
    return { x: index % this.width, y: Math.floor(index / this.width) };
  }

  getOrCreateChunk(chunkX: number, chunkY: number): WorldChunk {
    const key = WorldGrid.chunkKey(chunkX, chunkY);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new WorldChunk(chunkX, chunkY, this.chunkSize);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  getChunk(chunkX: number, chunkY: number): WorldChunk | undefined {
    return this.chunks.get(WorldGrid.chunkKey(chunkX, chunkY));
  }

  getChunkAt(x: number, y: number, create = true): WorldChunk | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const chunkPoint = gridToChunk({ x, y }, this.chunkSize);
    return create ? this.getOrCreateChunk(chunkPoint.x, chunkPoint.y) : this.getChunk(chunkPoint.x, chunkPoint.y);
  }

  getLoadedChunks(): readonly WorldChunk[] {
    return [...this.chunks.values()];
  }

  getTerrain(x: number, y: number): TerrainType {
    const { chunk, index } = this.locate(x, y);
    return chunk.terrain[index] as TerrainType;
  }

  setTerrain(x: number, y: number, terrain: TerrainType): boolean {
    const { chunk, index } = this.locate(x, y);
    const movementBlocked = terrainBlocksMovement(terrain) ? 1 : 0;
    const sightBlocked = terrainBlocksSight(terrain) ? 1 : 0;
    if (
      chunk.terrain[index] === terrain
      && chunk.movementBlocked[index] === movementBlocked
      && chunk.sightBlocked[index] === sightBlocked
    ) return false;

    chunk.terrain[index] = terrain;
    chunk.movementBlocked[index] = movementBlocked;
    chunk.sightBlocked[index] = sightBlocked;
    chunk.markDirty();
    this.terrainVersion++;
    return true;
  }

  getKnowledge(x: number, y: number): KnowledgeState {
    const { chunk, index } = this.locate(x, y);
    return chunk.knowledge[index] as KnowledgeState;
  }

  setKnowledge(x: number, y: number, knowledge: KnowledgeState, expeditionStamp?: number): boolean {
    const { chunk, index } = this.locate(x, y);
    const nextStamp = expeditionStamp ?? chunk.expeditionStamp[index];
    if (chunk.knowledge[index] === knowledge && chunk.expeditionStamp[index] === nextStamp) return false;
    chunk.knowledge[index] = knowledge;
    chunk.expeditionStamp[index] = nextStamp;
    chunk.markDirty();
    this.knowledgeVersion++;
    return true;
  }

  isVisibleNow(x: number, y: number): boolean {
    const { chunk, index } = this.locate(x, y);
    return chunk.visibleNow[index] !== 0;
  }

  setVisibleNow(x: number, y: number, visible: boolean): boolean {
    const { chunk, index } = this.locate(x, y);
    const value = visible ? 1 : 0;
    if (chunk.visibleNow[index] === value) return false;
    chunk.visibleNow[index] = value;
    chunk.markDirty(false);
    this.visibilityVersion++;
    return true;
  }

  clearVisibility(): void {
    let changed = false;
    for (const chunk of this.chunks.values()) {
      if (!chunk.visibleNow.some(Boolean)) continue;
      chunk.visibleNow.fill(0);
      chunk.markDirty(false);
      changed = true;
    }
    if (changed) this.visibilityVersion++;
  }

  isMovementBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const { chunk, index } = this.locate(x, y);
    return chunk.movementBlocked[index] !== 0;
  }

  setMovementBlocked(x: number, y: number, blocked: boolean): boolean {
    const { chunk, index } = this.locate(x, y);
    const value = blocked ? 1 : 0;
    if (chunk.movementBlocked[index] === value) return false;
    chunk.movementBlocked[index] = value;
    chunk.markDirty();
    this.terrainVersion++;
    return true;
  }

  isSightBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const { chunk, index } = this.locate(x, y);
    return chunk.sightBlocked[index] !== 0;
  }

  setSightBlocked(x: number, y: number, blocked: boolean): boolean {
    const { chunk, index } = this.locate(x, y);
    const value = blocked ? 1 : 0;
    if (chunk.sightBlocked[index] === value) return false;
    chunk.sightBlocked[index] = value;
    chunk.markDirty();
    this.terrainVersion++;
    return true;
  }

  getExpeditionStamp(x: number, y: number): number {
    const { chunk, index } = this.locate(x, y);
    return chunk.expeditionStamp[index];
  }

  setExpeditionStamp(x: number, y: number, expeditionId: number): boolean {
    const { chunk, index } = this.locate(x, y);
    if (chunk.expeditionStamp[index] === expeditionId) return false;
    chunk.expeditionStamp[index] = expeditionId;
    chunk.markDirty();
    this.knowledgeVersion++;
    return true;
  }

  setIslandId(x: number, y: number, islandId: number): boolean {
    const { chunk, index } = this.locate(x, y);
    if (chunk.islandId[index] === islandId) return false;
    chunk.islandId[index] = islandId;
    chunk.markDirty();
    return true;
  }

  setResourceId(x: number, y: number, resourceId: number): boolean {
    const { chunk, index } = this.locate(x, y);
    if (chunk.resourceId[index] === resourceId) return false;
    chunk.resourceId[index] = resourceId;
    chunk.markDirty();
    return true;
  }

  getTile(x: number, y: number): TileSnapshot {
    const { chunk, index } = this.locate(x, y);
    return {
      terrain: chunk.terrain[index] as TerrainType,
      knowledge: chunk.knowledge[index] as KnowledgeState,
      visibleNow: chunk.visibleNow[index] !== 0,
      movementBlocked: chunk.movementBlocked[index] !== 0,
      sightBlocked: chunk.sightBlocked[index] !== 0,
      expeditionStamp: chunk.expeditionStamp[index],
      islandId: chunk.islandId[index],
      resourceId: chunk.resourceId[index],
    };
  }

  fill(terrain: TerrainType, knowledge: KnowledgeState): void {
    const movementBlocked = terrainBlocksMovement(terrain) ? 1 : 0;
    const sightBlocked = terrainBlocksSight(terrain) ? 1 : 0;
    const chunkColumns = Math.ceil(this.width / this.chunkSize);
    const chunkRows = Math.ceil(this.height / this.chunkSize);
    for (let chunkY = 0; chunkY < chunkRows; chunkY++) {
      for (let chunkX = 0; chunkX < chunkColumns; chunkX++) {
        const chunk = this.getOrCreateChunk(chunkX, chunkY);
        chunk.terrain.fill(terrain);
        chunk.knowledge.fill(knowledge);
        chunk.visibleNow.fill(0);
        chunk.movementBlocked.fill(movementBlocked);
        chunk.sightBlocked.fill(sightBlocked);
        chunk.expeditionStamp.fill(0);
        chunk.islandId.fill(-1);
        chunk.resourceId.fill(-1);
        chunk.markDirty();
      }
    }
    this.terrainVersion++;
    this.knowledgeVersion++;
    this.visibilityVersion++;
  }

  forEachTile(visitor: (x: number, y: number, index: number) => void): void {
    let index = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++, index++) visitor(x, y, index);
    }
  }

  private assertInBounds(x: number, y: number): void {
    if (!this.inBounds(x, y)) throw new RangeError(`Tile (${x}, ${y}) is outside ${this.width}x${this.height} world`);
  }

  private locate(x: number, y: number): { chunk: WorldChunk; index: number } {
    this.assertInBounds(x, y);
    const chunkPoint = gridToChunk({ x, y }, this.chunkSize);
    const localPoint = gridToLocal({ x, y }, this.chunkSize);
    const chunk = this.getOrCreateChunk(chunkPoint.x, chunkPoint.y);
    return { chunk, index: chunk.index(localPoint.x, localPoint.y) };
  }
}
