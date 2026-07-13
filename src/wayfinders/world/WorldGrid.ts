import { prototypeConfig } from "../config/prototypeConfig";
import type { GridPoint } from "../core/types";
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
  private readonly loadedChunks: WorldChunk[] = [];
  private readonly chunkColumns: number;
  private readonly chunkRows: number;
  private readonly chunksByIndex: Array<WorldChunk | undefined>;
  private readonly knowledgeCounts: number[];
  private readonly personalKnowledgeIndices = new Set<number>();
  private readonly supportedKnowledgeIndices = new Set<number>();
  private readonly supportedPersonalBoundaryIndices = new Set<number>();
  private readonly visibleIndices = new Set<number>();
  private readonly visibilityDirtyChunks = new Set<WorldChunk>();

  knowledgeVersion = 0;
  terrainVersion = 0;
  visibilityVersion = 0;
  /** Advances only when passable Supported-water connectivity can change. */
  supportedTopologyVersion = 0;

  constructor(
    readonly width = prototypeConfig.world.width,
    readonly height = prototypeConfig.world.height,
    readonly chunkSize = prototypeConfig.navigation.chunkSize,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("World dimensions must be positive integers");
    }
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError("Chunk size must be a positive integer");
    this.chunkColumns = Math.ceil(width / chunkSize);
    this.chunkRows = Math.ceil(height / chunkSize);
    this.chunksByIndex = new Array<WorldChunk | undefined>(this.chunkColumns * this.chunkRows);
    this.knowledgeCounts = [this.tileCount, 0, 0];
  }

  get tileCount(): number {
    return this.width * this.height;
  }

  get currentVisibleCount(): number {
    return this.visibleIndices.size;
  }

  getKnowledgeCount(knowledge: KnowledgeState): number {
    const count = this.knowledgeCounts[knowledge];
    if (count === undefined) throw new RangeError(`Invalid knowledge state ${knowledge}`);
    return count;
  }

  getPersonalKnowledgeIndices(): ReadonlySet<number> {
    return this.personalKnowledgeIndices;
  }

  getSupportedKnowledgeIndices(): ReadonlySet<number> {
    return this.supportedKnowledgeIndices;
  }

  /** Passable Supported cells cardinally adjacent to passable Personal water. */
  getSupportedPersonalBoundaryIndices(): ReadonlySet<number> {
    return this.supportedPersonalBoundaryIndices;
  }

  getVisibleIndices(): ReadonlySet<number> {
    return this.visibleIndices;
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
    const directIndex = this.directChunkIndex(chunkX, chunkY);
    if (directIndex >= 0) {
      const directChunk = this.chunksByIndex[directIndex];
      if (directChunk) return directChunk;
    }

    const key = WorldGrid.chunkKey(chunkX, chunkY);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new WorldChunk(chunkX, chunkY, this.chunkSize);
      this.chunks.set(key, chunk);
      this.loadedChunks.push(chunk);
    }
    if (directIndex >= 0) this.chunksByIndex[directIndex] = chunk;
    return chunk;
  }

  getChunk(chunkX: number, chunkY: number): WorldChunk | undefined {
    const directIndex = this.directChunkIndex(chunkX, chunkY);
    if (directIndex >= 0) return this.chunksByIndex[directIndex];
    return this.chunks.get(WorldGrid.chunkKey(chunkX, chunkY));
  }

  getChunkAt(x: number, y: number, create = true): WorldChunk | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const chunkX = Math.floor(x / this.chunkSize);
    const chunkY = Math.floor(y / this.chunkSize);
    return create ? this.getOrCreateChunk(chunkX, chunkY) : this.getChunk(chunkX, chunkY);
  }

  getLoadedChunks(): readonly WorldChunk[] {
    return this.loadedChunks;
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

    const supportedPassabilityChanged = chunk.knowledge[index] === KnowledgeState.Supported
      && chunk.movementBlocked[index] !== movementBlocked;
    chunk.terrain[index] = terrain;
    chunk.movementBlocked[index] = movementBlocked;
    chunk.sightBlocked[index] = sightBlocked;
    this.refreshSupportedPersonalBoundaryNear(this.index(x, y));
    chunk.markDirty();
    this.terrainVersion++;
    if (supportedPassabilityChanged) this.supportedTopologyVersion++;
    return true;
  }

  getKnowledge(x: number, y: number): KnowledgeState {
    const { chunk, index } = this.locate(x, y);
    return chunk.knowledge[index] as KnowledgeState;
  }

  getKnowledgeAtIndex(worldIndex: number): KnowledgeState {
    const chunk = this.chunkAtIndex(worldIndex);
    return chunk.knowledge[this.localIndexFromWorldIndex(worldIndex)] as KnowledgeState;
  }

  setKnowledgeAtIndex(worldIndex: number, knowledge: KnowledgeState, expeditionStamp?: number): boolean {
    const chunk = this.chunkAtIndex(worldIndex);
    const index = this.localIndexFromWorldIndex(worldIndex);
    const nextStamp = expeditionStamp
      ?? (knowledge === KnowledgeState.Personal ? chunk.expeditionStamp[index] : 0);
    if (knowledge !== KnowledgeState.Unknown && knowledge !== KnowledgeState.Personal && knowledge !== KnowledgeState.Supported) {
      throw new RangeError(`Invalid knowledge state ${knowledge}`);
    }
    if (!Number.isInteger(nextStamp) || nextStamp < 0 || nextStamp > 0xffff_ffff) {
      throw new RangeError(`Invalid expedition stamp ${nextStamp}`);
    }
    if (
      (knowledge === KnowledgeState.Personal && nextStamp === 0)
      || (knowledge !== KnowledgeState.Personal && nextStamp !== 0)
    ) throw new RangeError(`Knowledge state ${knowledge} is incompatible with expedition stamp ${nextStamp}`);
    if (chunk.knowledge[index] === knowledge && chunk.expeditionStamp[index] === nextStamp) return false;
    const previousKnowledge = chunk.knowledge[index] as KnowledgeState;
    chunk.knowledge[index] = knowledge;
    chunk.expeditionStamp[index] = nextStamp;
    if (previousKnowledge !== knowledge) {
      this.knowledgeCounts[previousKnowledge]--;
      this.knowledgeCounts[knowledge]++;
      this.removeKnowledgeIndex(worldIndex, previousKnowledge);
      this.addKnowledgeIndex(worldIndex, knowledge);
      this.refreshSupportedPersonalBoundaryNear(worldIndex);
      if (
        chunk.movementBlocked[index] === 0
        && (previousKnowledge === KnowledgeState.Supported || knowledge === KnowledgeState.Supported)
      ) {
        this.supportedTopologyVersion++;
      }
    }
    chunk.markKnowledgeDirty();
    this.knowledgeVersion++;
    return true;
  }

  setKnowledge(x: number, y: number, knowledge: KnowledgeState, expeditionStamp?: number): boolean {
    return this.setKnowledgeAtIndex(this.index(x, y), knowledge, expeditionStamp);
  }

  /**
   * Replaces persisted knowledge in one bulk operation. The input is validated
   * before any live state changes, indexes/counts are rebuilt, and each affected
   * chunk is invalidated at most once.
   */
  replaceKnowledge(knowledge: Uint8Array, expeditionStamps: Uint32Array): boolean {
    if (knowledge.length !== this.tileCount || expeditionStamps.length !== this.tileCount) {
      throw new RangeError(`Knowledge arrays must contain exactly ${this.tileCount} cells`);
    }
    for (let index = 0; index < this.tileCount; index++) {
      const state = knowledge[index] as KnowledgeState;
      const stamp = expeditionStamps[index];
      if (state !== KnowledgeState.Unknown && state !== KnowledgeState.Personal && state !== KnowledgeState.Supported) {
        throw new RangeError(`Invalid knowledge state ${state} at world index ${index}`);
      }
      if (
        (state === KnowledgeState.Personal && stamp === 0)
        || (state !== KnowledgeState.Personal && stamp !== 0)
      ) throw new RangeError(`Invalid expedition stamp ${stamp} at world index ${index}`);
    }

    const dirtyChunks = new Set<WorldChunk>();
    let supportedTopologyChanged = false;
    this.knowledgeCounts.fill(0);
    this.personalKnowledgeIndices.clear();
    this.supportedKnowledgeIndices.clear();
    for (let index = 0; index < this.tileCount; index++) {
      const chunk = this.chunkAtIndex(index);
      const localIndex = this.localIndexFromWorldIndex(index);
      const state = knowledge[index] as KnowledgeState;
      const stamp = expeditionStamps[index];
      if (chunk.knowledge[localIndex] !== state || chunk.expeditionStamp[localIndex] !== stamp) {
        const previousState = chunk.knowledge[localIndex] as KnowledgeState;
        if (
          chunk.movementBlocked[localIndex] === 0
          && previousState !== state
          && (previousState === KnowledgeState.Supported || state === KnowledgeState.Supported)
        ) supportedTopologyChanged = true;
        chunk.knowledge[localIndex] = state;
        chunk.expeditionStamp[localIndex] = stamp;
        dirtyChunks.add(chunk);
      }
      this.knowledgeCounts[state]++;
      this.addKnowledgeIndex(index, state);
    }
    if (dirtyChunks.size === 0) return false;
    this.rebuildSupportedPersonalBoundaries();
    for (const chunk of dirtyChunks) chunk.markKnowledgeDirty();
    this.knowledgeVersion++;
    if (supportedTopologyChanged) this.supportedTopologyVersion++;
    return true;
  }

  isVisibleNow(x: number, y: number): boolean {
    const { chunk, index } = this.locate(x, y);
    return chunk.visibleNow[index] !== 0;
  }

  isVisibleNowAtIndex(worldIndex: number): boolean {
    const chunk = this.chunkAtIndex(worldIndex);
    return chunk.visibleNow[this.localIndexFromWorldIndex(worldIndex)] !== 0;
  }

  setVisibleNow(x: number, y: number, visible: boolean): boolean {
    return this.setVisibleNowAtIndex(this.index(x, y), visible);
  }

  setVisibleNowAtIndex(worldIndex: number, visible: boolean): boolean {
    const chunk = this.chunkAtIndex(worldIndex);
    const index = this.localIndexFromWorldIndex(worldIndex);
    const value = visible ? 1 : 0;
    if (chunk.visibleNow[index] === value) return false;
    chunk.visibleNow[index] = value;
    if (visible) this.visibleIndices.add(worldIndex);
    else this.visibleIndices.delete(worldIndex);
    chunk.markDirty(false);
    this.visibilityVersion++;
    return true;
  }

  clearVisibility(): void {
    if (this.visibleIndices.size === 0) return;

    for (const worldIndex of this.visibleIndices) {
      const chunk = this.chunkAtIndex(worldIndex);
      chunk.visibleNow[this.localIndexFromWorldIndex(worldIndex)] = 0;
      this.visibilityDirtyChunks.add(chunk);
    }
    for (const chunk of this.visibilityDirtyChunks) chunk.markDirty(false);
    this.visibilityDirtyChunks.clear();
    this.visibleIndices.clear();
    this.visibilityVersion++;
  }

  isMovementBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const { chunk, index } = this.locate(x, y);
    return chunk.movementBlocked[index] !== 0;
  }

  isMovementBlockedAtIndex(worldIndex: number): boolean {
    const chunk = this.chunkAtIndex(worldIndex);
    return chunk.movementBlocked[this.localIndexFromWorldIndex(worldIndex)] !== 0;
  }

  setMovementBlocked(x: number, y: number, blocked: boolean): boolean {
    const { chunk, index } = this.locate(x, y);
    const value = blocked ? 1 : 0;
    if (chunk.movementBlocked[index] === value) return false;
    chunk.movementBlocked[index] = value;
    this.refreshSupportedPersonalBoundaryNear(this.index(x, y));
    chunk.markDirty();
    this.terrainVersion++;
    if (chunk.knowledge[index] === KnowledgeState.Supported) this.supportedTopologyVersion++;
    return true;
  }

  isSightBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const { chunk, index } = this.locate(x, y);
    return chunk.sightBlocked[index] !== 0;
  }

  isSightBlockedAtIndex(worldIndex: number): boolean {
    const chunk = this.chunkAtIndex(worldIndex);
    return chunk.sightBlocked[this.localIndexFromWorldIndex(worldIndex)] !== 0;
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

  getExpeditionStampAtIndex(worldIndex: number): number {
    const chunk = this.chunkAtIndex(worldIndex);
    return chunk.expeditionStamp[this.localIndexFromWorldIndex(worldIndex)];
  }

  setExpeditionStamp(x: number, y: number, expeditionId: number): boolean {
    const { chunk, index } = this.locate(x, y);
    if (!Number.isInteger(expeditionId) || expeditionId < 0 || expeditionId > 0xffff_ffff) {
      throw new RangeError(`Invalid expedition stamp ${expeditionId}`);
    }
    const knowledge = chunk.knowledge[index] as KnowledgeState;
    if (
      (knowledge === KnowledgeState.Personal && expeditionId === 0)
      || (knowledge !== KnowledgeState.Personal && expeditionId !== 0)
    ) throw new RangeError(`Knowledge state ${knowledge} is incompatible with expedition stamp ${expeditionId}`);
    if (chunk.expeditionStamp[index] === expeditionId) return false;
    chunk.expeditionStamp[index] = expeditionId;
    chunk.markKnowledgeDirty();
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

  getIslandId(x: number, y: number): number {
    const { chunk, index } = this.locate(x, y);
    return chunk.islandId[index];
  }

  getIslandIdAtIndex(worldIndex: number): number {
    const chunk = this.chunkAtIndex(worldIndex);
    return chunk.islandId[this.localIndexFromWorldIndex(worldIndex)];
  }

  setResourceId(x: number, y: number, resourceId: number): boolean {
    const { chunk, index } = this.locate(x, y);
    if (chunk.resourceId[index] === resourceId) return false;
    chunk.resourceId[index] = resourceId;
    chunk.markDirty();
    return true;
  }

  getResourceId(x: number, y: number): number {
    const { chunk, index } = this.locate(x, y);
    return chunk.resourceId[index];
  }

  getResourceIdAtIndex(worldIndex: number): number {
    const chunk = this.chunkAtIndex(worldIndex);
    return chunk.resourceId[this.localIndexFromWorldIndex(worldIndex)];
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
    this.visibleIndices.clear();
    this.visibilityDirtyChunks.clear();
    for (let chunkY = 0; chunkY < this.chunkRows; chunkY++) {
      for (let chunkX = 0; chunkX < this.chunkColumns; chunkX++) {
        const chunk = this.getOrCreateChunk(chunkX, chunkY);
        chunk.terrain.fill(terrain);
        chunk.knowledge.fill(knowledge);
        chunk.visibleNow.fill(0);
        chunk.movementBlocked.fill(movementBlocked);
        chunk.sightBlocked.fill(sightBlocked);
        chunk.expeditionStamp.fill(0);
        chunk.islandId.fill(-1);
        chunk.resourceId.fill(-1);
        chunk.markKnowledgeDirty();
      }
    }
    this.knowledgeCounts.fill(0);
    this.knowledgeCounts[knowledge] = this.tileCount;
    this.personalKnowledgeIndices.clear();
    this.supportedKnowledgeIndices.clear();
    this.supportedPersonalBoundaryIndices.clear();
    if (knowledge !== KnowledgeState.Unknown) {
      const indices = knowledge === KnowledgeState.Personal
        ? this.personalKnowledgeIndices
        : this.supportedKnowledgeIndices;
      for (let index = 0; index < this.tileCount; index++) indices.add(index);
    }
    this.terrainVersion++;
    this.knowledgeVersion++;
    this.visibilityVersion++;
    this.supportedTopologyVersion++;
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
    const chunkX = Math.floor(x / this.chunkSize);
    const chunkY = Math.floor(y / this.chunkSize);
    const localX = x - chunkX * this.chunkSize;
    const localY = y - chunkY * this.chunkSize;
    const chunk = this.getOrCreateChunk(chunkX, chunkY);
    return { chunk, index: localY * this.chunkSize + localX };
  }

  private chunkAtIndex(worldIndex: number): WorldChunk {
    this.assertWorldIndex(worldIndex);
    const x = worldIndex % this.width;
    const y = Math.floor(worldIndex / this.width);
    return this.getOrCreateChunk(Math.floor(x / this.chunkSize), Math.floor(y / this.chunkSize));
  }

  private localIndexFromWorldIndex(worldIndex: number): number {
    const x = worldIndex % this.width;
    const y = Math.floor(worldIndex / this.width);
    return (y % this.chunkSize) * this.chunkSize + (x % this.chunkSize);
  }

  private assertWorldIndex(worldIndex: number): void {
    if (!Number.isInteger(worldIndex) || worldIndex < 0 || worldIndex >= this.tileCount) {
      throw new RangeError(`Invalid world index ${worldIndex}`);
    }
  }

  private directChunkIndex(chunkX: number, chunkY: number): number {
    if (
      !Number.isInteger(chunkX)
      || !Number.isInteger(chunkY)
      || chunkX < 0
      || chunkY < 0
      || chunkX >= this.chunkColumns
      || chunkY >= this.chunkRows
    ) return -1;
    return chunkY * this.chunkColumns + chunkX;
  }

  private addKnowledgeIndex(worldIndex: number, knowledge: KnowledgeState): void {
    if (knowledge === KnowledgeState.Personal) this.personalKnowledgeIndices.add(worldIndex);
    else if (knowledge === KnowledgeState.Supported) this.supportedKnowledgeIndices.add(worldIndex);
  }

  private removeKnowledgeIndex(worldIndex: number, knowledge: KnowledgeState): void {
    if (knowledge === KnowledgeState.Personal) this.personalKnowledgeIndices.delete(worldIndex);
    else if (knowledge === KnowledgeState.Supported) this.supportedKnowledgeIndices.delete(worldIndex);
  }

  private refreshSupportedPersonalBoundaryNear(worldIndex: number): void {
    this.refreshSupportedPersonalBoundary(worldIndex);
    const x = worldIndex % this.width;
    const y = Math.floor(worldIndex / this.width);
    if (x > 0) this.refreshSupportedPersonalBoundary(worldIndex - 1);
    if (x + 1 < this.width) this.refreshSupportedPersonalBoundary(worldIndex + 1);
    if (y > 0) this.refreshSupportedPersonalBoundary(worldIndex - this.width);
    if (y + 1 < this.height) this.refreshSupportedPersonalBoundary(worldIndex + this.width);
  }

  private refreshSupportedPersonalBoundary(index: number): void {
    if (
      this.getKnowledgeAtIndex(index) !== KnowledgeState.Supported
      || this.isMovementBlockedAtIndex(index)
    ) {
      this.supportedPersonalBoundaryIndices.delete(index);
      return;
    }

    const x = index % this.width;
    const y = Math.floor(index / this.width);
    const adjacent = (x > 0 && this.isPassablePersonalIndex(index - 1))
      || (x + 1 < this.width && this.isPassablePersonalIndex(index + 1))
      || (y > 0 && this.isPassablePersonalIndex(index - this.width))
      || (y + 1 < this.height && this.isPassablePersonalIndex(index + this.width));
    if (adjacent) this.supportedPersonalBoundaryIndices.add(index);
    else this.supportedPersonalBoundaryIndices.delete(index);
  }

  private rebuildSupportedPersonalBoundaries(): void {
    this.supportedPersonalBoundaryIndices.clear();
    for (const index of this.supportedKnowledgeIndices) this.refreshSupportedPersonalBoundary(index);
  }

  private isPassablePersonalIndex(index: number): boolean {
    return this.getKnowledgeAtIndex(index) === KnowledgeState.Personal
      && !this.isMovementBlockedAtIndex(index);
  }
}
