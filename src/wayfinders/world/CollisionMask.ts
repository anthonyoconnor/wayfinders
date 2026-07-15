/** GR-2.4 keeps 32 px navigation cells and refines only mixed cells at 8 px. */
export const COLLISION_SUBCELL_SIZE = 8 as const;
export const COLLISION_SUBCELLS_PER_TILE = 4 as const;
export const COLLISION_SUBCELL_COUNT = COLLISION_SUBCELLS_PER_TILE * COLLISION_SUBCELLS_PER_TILE;
export const EMPTY_COLLISION_MASK = 0;
export const FULL_COLLISION_MASK = (1 << COLLISION_SUBCELL_COUNT) - 1;

/**
 * A row-major 16-bit mask. Bit zero is the north-west subcell, +x is east and
 * +y is south. Only genuinely mixed masks are stored by WorldGrid.
 */
export type CollisionSubcellMask = number;

export function isMixedCollisionMask(mask: number): boolean {
  return Number.isInteger(mask) && mask > EMPTY_COLLISION_MASK && mask < FULL_COLLISION_MASK;
}

export function collisionSubcellBit(x: number, y: number): number {
  if (
    !Number.isInteger(x)
    || !Number.isInteger(y)
    || x < 0
    || y < 0
    || x >= COLLISION_SUBCELLS_PER_TILE
    || y >= COLLISION_SUBCELLS_PER_TILE
  ) throw new RangeError(`Collision subcell (${x}, ${y}) is outside the 4x4 patch`);
  return 1 << (y * COLLISION_SUBCELLS_PER_TILE + x);
}

export function isCollisionSubcellSolid(mask: CollisionSubcellMask, x: number, y: number): boolean {
  return (mask & collisionSubcellBit(x, y)) !== 0;
}

export function solidRowsToCollisionMask(rows: readonly string[]): CollisionSubcellMask {
  if (rows.length !== COLLISION_SUBCELLS_PER_TILE) {
    throw new RangeError(`Collision patch must contain exactly ${COLLISION_SUBCELLS_PER_TILE} rows`);
  }
  let mask = EMPTY_COLLISION_MASK;
  for (let y = 0; y < COLLISION_SUBCELLS_PER_TILE; y++) {
    const row = rows[y];
    if (row.length !== COLLISION_SUBCELLS_PER_TILE || /[^01]/u.test(row)) {
      throw new RangeError(`Collision row ${y} must contain exactly four 0 or 1 values`);
    }
    for (let x = 0; x < COLLISION_SUBCELLS_PER_TILE; x++) {
      if (row[x] === "1") mask |= collisionSubcellBit(x, y);
    }
  }
  return mask;
}

export function collisionMaskToSolidRows(mask: CollisionSubcellMask): readonly string[] {
  if (!Number.isInteger(mask) || mask < EMPTY_COLLISION_MASK || mask > FULL_COLLISION_MASK) {
    throw new RangeError(`Invalid 4x4 collision mask ${mask}`);
  }
  const rows: string[] = [];
  for (let y = 0; y < COLLISION_SUBCELLS_PER_TILE; y++) {
    let row = "";
    for (let x = 0; x < COLLISION_SUBCELLS_PER_TILE; x++) {
      row += isCollisionSubcellSolid(mask, x, y) ? "1" : "0";
    }
    rows.push(row);
  }
  return Object.freeze(rows);
}
