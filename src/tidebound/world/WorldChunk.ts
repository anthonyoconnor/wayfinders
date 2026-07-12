export class WorldChunk {
  readonly terrain: Uint8Array;
  readonly knowledge: Uint8Array;
  readonly visibleNow: Uint8Array;
  readonly movementBlocked: Uint8Array;
  readonly sightBlocked: Uint8Array;
  readonly expeditionStamp: Uint32Array;
  readonly islandId: Int32Array;
  readonly resourceId: Int32Array;

  active = false;
  visible = false;
  dirty = true;
  modified = false;
  revision = 0;

  constructor(
    readonly chunkX: number,
    readonly chunkY: number,
    readonly size: number,
  ) {
    if (!Number.isInteger(size) || size <= 0) throw new RangeError("Chunk size must be a positive integer");

    const tileCount = size * size;
    this.terrain = new Uint8Array(tileCount);
    this.knowledge = new Uint8Array(tileCount);
    this.visibleNow = new Uint8Array(tileCount);
    this.movementBlocked = new Uint8Array(tileCount);
    this.sightBlocked = new Uint8Array(tileCount);
    this.expeditionStamp = new Uint32Array(tileCount);
    this.islandId = new Int32Array(tileCount);
    this.resourceId = new Int32Array(tileCount);
    this.islandId.fill(-1);
    this.resourceId.fill(-1);
  }

  index(localX: number, localY: number): number {
    if (localX < 0 || localY < 0 || localX >= this.size || localY >= this.size) {
      throw new RangeError(`Local tile (${localX}, ${localY}) is outside chunk ${this.chunkX},${this.chunkY}`);
    }
    return localY * this.size + localX;
  }

  markDirty(modified = true): void {
    this.dirty = true;
    this.modified ||= modified;
    this.revision++;
  }
}
