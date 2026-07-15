import type {
  AuthoredBoxCollision,
  AuthoredCollisionSolidRows,
  AuthoredHybridGridCollision,
} from "./AuthoredAssetContracts";
import {
  RUNTIME_COLLISION_OBJECT_KINDS,
  type RuntimeCollisionObjectKind,
  type RuntimeCollisionProfile,
} from "./CollisionProfileRegistry";
import {
  COLLISION_SUBCELL_SIZE,
  COLLISION_SUBCELLS_PER_TILE,
  EMPTY_COLLISION_MASK,
  FULL_COLLISION_MASK,
  collisionMaskToSolidRows,
  collisionSubcellBit,
  isCollisionSubcellMask,
  isCollisionSubcellSolid,
  solidRowsToCollisionMask,
  type CollisionSubcellMask,
} from "../world/CollisionMask";

const DEFAULT_HISTORY_LIMIT = 100;

export interface CollisionEditorGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly subcellSize: number;
  /** One fully-open or fully-solid fallback mask per navigation cell. */
  readonly coarseMasks: readonly CollisionSubcellMask[];
}

export interface CollisionEditorTarget {
  readonly objectKind: RuntimeCollisionObjectKind;
  readonly editable: boolean;
  readonly grid?: Readonly<CollisionEditorGrid>;
  /** Dense effective masks at the moment this target was opened. */
  readonly baseMasks?: readonly CollisionSubcellMask[];
  readonly profile: RuntimeCollisionProfile;
}

/** Coordinates in the dense, asset-local 8-pixel subcell grid. */
export interface CollisionEditorSubcellPoint {
  readonly x: number;
  readonly y: number;
}

/** One 8 px detail subcell or one aligned 32 px navigation cell. */
export type CollisionEditorBrushSize = 1 | typeof COLLISION_SUBCELLS_PER_TILE;

/** Rectangle in the dense, asset-local 8-pixel subcell grid. */
export interface CollisionEditorSelection extends CollisionEditorSubcellPoint {
  readonly width: number;
  readonly height: number;
}

export type CollisionEditorCommand =
  | Readonly<{ kind: "paint-stroke"; points: readonly Readonly<CollisionEditorSubcellPoint>[] }>
  | Readonly<{ kind: "erase-stroke"; points: readonly Readonly<CollisionEditorSubcellPoint>[] }>
  | Readonly<{
    kind: "flood-fill";
    start: Readonly<CollisionEditorSubcellPoint>;
    solid: boolean;
    selection?: Readonly<CollisionEditorSelection>;
  }>
  | Readonly<{ kind: "fill-selection"; selection: Readonly<CollisionEditorSelection>; solid: boolean }>
  | Readonly<{ kind: "revert-coarse-cell"; x: number; y: number }>
  | Readonly<{ kind: "set-box"; profile: Readonly<AuthoredBoxCollision> }>
  | Readonly<{ kind: "set-empty" }>
  | Readonly<{ kind: "reset" }>;

export interface CollisionEditorSnapshot {
  readonly objectKind: RuntimeCollisionObjectKind;
  readonly editable: boolean;
  /** A canonical profile when exportable; otherwise the current profile kind. */
  readonly profile: RuntimeCollisionProfile;
  /** A defensive copy of the dense masks, when this target has a grid. */
  readonly masks?: Uint16Array;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly exportable: boolean;
  readonly serializationError?: string;
}

export interface CollisionEditorHullProbeInput {
  /** Asset-local hull center in pixels. */
  readonly centerX: number;
  readonly centerY: number;
  readonly halfWidth: number;
  readonly halfHeight?: number;
  /** Treat space outside a grid-backed target as solid. Defaults to false. */
  readonly outsideIsSolid?: boolean;
}

export interface CollisionEditorSubcellHullHit {
  readonly kind: "subcell";
  readonly cellX: number;
  readonly cellY: number;
  readonly subcellX: number;
  readonly subcellY: number;
}

export interface CollisionEditorBoxHullHit {
  readonly kind: "box";
}

export interface CollisionEditorOutsideHullHit {
  readonly kind: "outside";
}

export type CollisionEditorHullHit =
  | CollisionEditorSubcellHullHit
  | CollisionEditorBoxHullHit
  | CollisionEditorOutsideHullHit;

export interface CollisionEditorHullProbeResult {
  readonly collides: boolean;
  readonly hits: readonly Readonly<CollisionEditorHullHit>[];
}

interface EditorState {
  readonly profile: RuntimeCollisionProfile;
  readonly masks?: Uint16Array;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

/** Expands a pointer hit into the aligned subcells covered by the active brush. */
export function collisionBrushFootprint(
  point: Readonly<CollisionEditorSubcellPoint>,
  brushSize: CollisionEditorBrushSize,
  width: number,
  height: number,
): readonly Readonly<CollisionEditorSubcellPoint>[] {
  const boundedWidth = positiveInteger(width, "brush grid width");
  const boundedHeight = positiveInteger(height, "brush grid height");
  if (
    !Number.isInteger(point.x)
    || !Number.isInteger(point.y)
    || point.x < 0
    || point.y < 0
    || point.x >= boundedWidth
    || point.y >= boundedHeight
  ) throw new RangeError(`Brush point (${point.x}, ${point.y}) is outside the collision grid`);
  if (brushSize !== 1 && brushSize !== COLLISION_SUBCELLS_PER_TILE) {
    throw new RangeError("Collision brush size must be one 8 px subcell or one 32 px navigation cell");
  }

  const startX = brushSize === 1
    ? point.x
    : Math.floor(point.x / COLLISION_SUBCELLS_PER_TILE) * COLLISION_SUBCELLS_PER_TILE;
  const startY = brushSize === 1
    ? point.y
    : Math.floor(point.y / COLLISION_SUBCELLS_PER_TILE) * COLLISION_SUBCELLS_PER_TILE;
  const points: CollisionEditorSubcellPoint[] = [];
  for (let y = startY; y < Math.min(startY + brushSize, boundedHeight); y++) {
    for (let x = startX; x < Math.min(startX + brushSize, boundedWidth); x++) {
      points.push(Object.freeze({ x, y }));
    }
  }
  return Object.freeze(points);
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function validMask(value: number, label: string): CollisionSubcellMask {
  if (!Number.isInteger(value) || value < EMPTY_COLLISION_MASK || value > FULL_COLLISION_MASK) {
    throw new RangeError(`${label} must be a 16-bit collision mask`);
  }
  return value;
}

function collisionRows(mask: CollisionSubcellMask): AuthoredCollisionSolidRows {
  const rows = collisionMaskToSolidRows(mask);
  return Object.freeze([rows[0], rows[1], rows[2], rows[3]]) as AuthoredCollisionSolidRows;
}

function cloneProfile(profile: RuntimeCollisionProfile): RuntimeCollisionProfile {
  switch (profile.kind) {
    case "coarse-grid": return Object.freeze({ kind: "coarse-grid" });
    case "empty": return Object.freeze({ kind: "empty" });
    case "box": return Object.freeze({
      kind: "box",
      offset: Object.freeze({ x: profile.offset.x, y: profile.offset.y }),
      halfSize: Object.freeze({ width: profile.halfSize.width, height: profile.halfSize.height }),
    });
    case "hybrid-grid": return Object.freeze({
      kind: "hybrid-grid",
      subcellSize: profile.subcellSize,
      mixedCells: Object.freeze(profile.mixedCells.map((cell) => Object.freeze({
        x: cell.x,
        y: cell.y,
        solidRows: collisionRows(solidRowsToCollisionMask(cell.solidRows)),
      }))),
    });
  }
}

function validateBox(profile: Readonly<AuthoredBoxCollision>): AuthoredBoxCollision {
  const offset = {
    x: finite(profile.offset.x, "box offset.x"),
    y: finite(profile.offset.y, "box offset.y"),
  };
  const halfSize = {
    width: finite(profile.halfSize.width, "box halfSize.width"),
    height: finite(profile.halfSize.height, "box halfSize.height"),
  };
  if (halfSize.width <= 0 || halfSize.height <= 0) {
    throw new RangeError("box half sizes must be positive");
  }
  return Object.freeze({
    kind: "box",
    offset: Object.freeze(offset),
    halfSize: Object.freeze(halfSize),
  });
}

function normalizeGrid(grid: Readonly<CollisionEditorGrid>): CollisionEditorGrid {
  const width = positiveInteger(grid.width, "grid.width");
  const height = positiveInteger(grid.height, "grid.height");
  const tileSize = positiveInteger(grid.tileSize, "grid.tileSize");
  const subcellSize = positiveInteger(grid.subcellSize, "grid.subcellSize");
  if (
    subcellSize !== COLLISION_SUBCELL_SIZE
    || tileSize !== subcellSize * COLLISION_SUBCELLS_PER_TILE
  ) {
    throw new RangeError("collision editor grids require 32-pixel cells and 8-pixel subcells");
  }
  if (grid.coarseMasks.length !== width * height) {
    throw new RangeError(`grid.coarseMasks must contain exactly ${width * height} masks`);
  }
  const coarseMasks = grid.coarseMasks.map((mask, index) => {
    validMask(mask, `grid.coarseMasks[${index}]`);
    if (mask !== EMPTY_COLLISION_MASK && mask !== FULL_COLLISION_MASK) {
      throw new RangeError(`grid.coarseMasks[${index}] must be fully open or fully solid`);
    }
    return mask;
  });
  return Object.freeze({
    width,
    height,
    tileSize,
    subcellSize,
    coarseMasks: Object.freeze(coarseMasks),
  });
}

/** Builds the dense effective masks represented by a profile over a coarse grid. */
export function createCollisionEditorBaseMasks(
  gridInput: Readonly<CollisionEditorGrid>,
  profile: RuntimeCollisionProfile,
): Uint16Array {
  const grid = normalizeGrid(gridInput);
  if (profile.kind === "empty" || profile.kind === "box") {
    return new Uint16Array(grid.width * grid.height);
  }
  const masks = Uint16Array.from(grid.coarseMasks);
  if (profile.kind === "coarse-grid") return masks;
  if (profile.subcellSize !== grid.subcellSize) {
    throw new RangeError(`hybrid profile subcellSize must be ${grid.subcellSize}`);
  }
  const occupied = new Set<number>();
  for (const [mixedIndex, cell] of profile.mixedCells.entries()) {
    if (
      !Number.isInteger(cell.x)
      || !Number.isInteger(cell.y)
      || cell.x < 0
      || cell.y < 0
      || cell.x >= grid.width
      || cell.y >= grid.height
    ) {
      throw new RangeError(`hybrid mixedCells[${mixedIndex}] is outside the ${grid.width}x${grid.height} grid`);
    }
    const index = cell.y * grid.width + cell.x;
    if (occupied.has(index)) throw new RangeError(`hybrid profile contains duplicate cell ${cell.x},${cell.y}`);
    occupied.add(index);
    const mask = solidRowsToCollisionMask(cell.solidRows);
    if (!isCollisionSubcellMask(mask)) {
      throw new RangeError(`hybrid cell (${cell.x}, ${cell.y}) must be a valid 16-bit collision patch`);
    }
    masks[index] = mask;
  }
  return masks;
}

function serializeHybridProfile(
  grid: Readonly<CollisionEditorGrid>,
  masks: Uint16Array,
): AuthoredHybridGridCollision {
  const mixedCells = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const index = y * grid.width + x;
      const mask = masks[index];
      const coarseMask = grid.coarseMasks[index];
      if (mask === coarseMask) continue;
      mixedCells.push(Object.freeze({ x, y, solidRows: collisionRows(mask) }));
    }
  }
  return Object.freeze({
    kind: "hybrid-grid",
    subcellSize: COLLISION_SUBCELL_SIZE,
    mixedCells: Object.freeze(mixedCells),
  });
}

function masksEqual(left: Uint16Array | undefined, right: Uint16Array | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function profilesEqual(left: RuntimeCollisionProfile, right: RuntimeCollisionProfile): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "coarse-grid":
    case "empty": return true;
    case "box": return right.kind === "box"
      && left.offset.x === right.offset.x
      && left.offset.y === right.offset.y
      && left.halfSize.width === right.halfSize.width
      && left.halfSize.height === right.halfSize.height;
    case "hybrid-grid": {
      if (right.kind !== "hybrid-grid" || left.subcellSize !== right.subcellSize) return false;
      if (left.mixedCells.length !== right.mixedCells.length) return false;
      return left.mixedCells.every((cell, index) => {
        const other = right.mixedCells[index];
        return cell.x === other.x
          && cell.y === other.y
          && cell.solidRows.every((row, rowIndex) => row === other.solidRows[rowIndex]);
      });
    }
  }
}

function statesEqual(left: Readonly<EditorState>, right: Readonly<EditorState>): boolean {
  return profilesEqual(left.profile, right.profile) && masksEqual(left.masks, right.masks);
}

function cloneState(state: Readonly<EditorState>): EditorState {
  return Object.freeze({
    profile: cloneProfile(state.profile),
    ...(state.masks ? { masks: state.masks.slice() } : {}),
  });
}

function overlap(
  leftA: number,
  topA: number,
  rightA: number,
  bottomA: number,
  leftB: number,
  topB: number,
  rightB: number,
  bottomB: number,
): boolean {
  return rightA > leftB && leftA < rightB && bottomA > topB && topA < bottomB;
}

/** Renderer-agnostic, deterministic collision-authoring state and history. */
export class CollisionEditorModel {
  readonly target: Readonly<CollisionEditorTarget>;
  readonly historyLimit: number;

  private readonly grid?: Readonly<CollisionEditorGrid>;
  private readonly baseline: Readonly<EditorState>;
  private state: Readonly<EditorState>;
  private readonly past: EditorState[] = [];
  private readonly future: EditorState[] = [];

  constructor(target: Readonly<CollisionEditorTarget>, historyLimit = DEFAULT_HISTORY_LIMIT) {
    if (!RUNTIME_COLLISION_OBJECT_KINDS.includes(target.objectKind)) {
      throw new RangeError(`Unknown collision editor object kind ${target.objectKind}`);
    }
    if (typeof target.editable !== "boolean") throw new TypeError("target.editable must be boolean");
    this.historyLimit = positiveInteger(historyLimit, "historyLimit");
    this.grid = target.grid ? normalizeGrid(target.grid) : undefined;
    if (this.grid && !target.baseMasks) throw new TypeError("grid-backed targets require baseMasks");
    if (!this.grid && target.baseMasks) throw new TypeError("baseMasks require a grid-backed target");
    if ((target.profile.kind === "hybrid-grid" || target.profile.kind === "coarse-grid") && !this.grid) {
      throw new TypeError(`${target.profile.kind} profiles require a grid-backed target`);
    }
    if (target.profile.kind === "box") validateBox(target.profile);

    let baseMasks: Uint16Array | undefined;
    if (this.grid && target.baseMasks) {
      if (target.baseMasks.length !== this.grid.width * this.grid.height) {
        throw new RangeError(`baseMasks must contain exactly ${this.grid.width * this.grid.height} masks`);
      }
      baseMasks = Uint16Array.from(target.baseMasks.map((mask, index) => validMask(mask, `baseMasks[${index}]`)));
      const represented = createCollisionEditorBaseMasks(this.grid, target.profile);
      if (!masksEqual(baseMasks, represented)) {
        throw new RangeError("baseMasks do not match the target collision profile");
      }
    }

    let profile = cloneProfile(target.profile);
    if (profile.kind === "hybrid-grid" && this.grid && baseMasks) {
      profile = serializeHybridProfile(this.grid, baseMasks);
    }
    const initial = Object.freeze({ profile, ...(baseMasks ? { masks: baseMasks } : {}) });
    this.baseline = cloneState(initial);
    this.state = cloneState(initial);
    this.target = Object.freeze({
      objectKind: target.objectKind,
      editable: target.editable,
      ...(this.grid ? { grid: this.grid, baseMasks: Object.freeze([...baseMasks ?? []]) } : {}),
      profile: cloneProfile(profile),
    });
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get dirty(): boolean {
    return !statesEqual(this.state, this.baseline);
  }

  snapshot(): Readonly<CollisionEditorSnapshot> {
    let profile = cloneProfile(this.state.profile);
    let serializationError: string | undefined;
    try {
      profile = this.serializeProfile();
    } catch (error) {
      serializationError = error instanceof Error ? error.message : String(error);
    }
    return Object.freeze({
      objectKind: this.target.objectKind,
      editable: this.target.editable,
      profile,
      ...(this.state.masks ? { masks: this.state.masks.slice() } : {}),
      dirty: this.dirty,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      exportable: serializationError === undefined,
      ...(serializationError ? { serializationError } : {}),
    });
  }

  execute(command: Readonly<CollisionEditorCommand>): boolean {
    switch (command.kind) {
      case "paint-stroke": return this.paintStroke(command.points);
      case "erase-stroke": return this.eraseStroke(command.points);
      case "flood-fill": return this.floodFill(command.start, command.solid, command.selection);
      case "fill-selection": return this.setSelection(command.selection, command.solid);
      case "revert-coarse-cell": return this.revertCoarseCell(command.x, command.y);
      case "set-box": return this.setBox(command.profile);
      case "set-empty": return this.setExplicitEmpty();
      case "reset": return this.reset();
    }
  }

  getEffectiveMask(cellX: number, cellY: number): CollisionSubcellMask {
    const grid = this.requireGrid();
    this.assertCell(grid, cellX, cellY);
    const masks = this.state.masks;
    if (!masks) throw new TypeError("Grid-backed editor state is missing masks");
    return masks[cellY * grid.width + cellX];
  }

  isSolidAt(subcellX: number, subcellY: number): boolean {
    const grid = this.requireGrid();
    this.assertSubcell(grid, subcellX, subcellY);
    const masks = this.state.masks;
    if (!masks) throw new TypeError("Grid-backed editor state is missing masks");
    const cellX = Math.floor(subcellX / COLLISION_SUBCELLS_PER_TILE);
    const cellY = Math.floor(subcellY / COLLISION_SUBCELLS_PER_TILE);
    return isCollisionSubcellSolid(
      masks[cellY * grid.width + cellX],
      subcellX % COLLISION_SUBCELLS_PER_TILE,
      subcellY % COLLISION_SUBCELLS_PER_TILE,
    );
  }

  paintStroke(points: readonly Readonly<CollisionEditorSubcellPoint>[]): boolean {
    return this.applyStroke(points, true);
  }

  eraseStroke(points: readonly Readonly<CollisionEditorSubcellPoint>[]): boolean {
    return this.applyStroke(points, false);
  }

  floodFill(
    start: Readonly<CollisionEditorSubcellPoint>,
    solid: boolean,
    selection?: Readonly<CollisionEditorSelection>,
  ): boolean {
    this.assertEditable();
    const grid = this.requireGrid();
    this.assertSubcell(grid, start.x, start.y);
    const bounds = selection ? this.validateSelection(grid, selection) : {
      x: 0,
      y: 0,
      width: grid.width * COLLISION_SUBCELLS_PER_TILE,
      height: grid.height * COLLISION_SUBCELLS_PER_TILE,
    };
    if (!this.selectionContains(bounds, start.x, start.y)) {
      throw new RangeError("flood-fill start must be inside the selection");
    }
    const sourceSolid = this.isSolidAt(start.x, start.y);
    if (sourceSolid === solid) return false;

    const width = grid.width * COLLISION_SUBCELLS_PER_TILE;
    const height = grid.height * COLLISION_SUBCELLS_PER_TILE;
    const visited = new Uint8Array(width * height);
    const queue: CollisionEditorSubcellPoint[] = [{ x: start.x, y: start.y }];
    const points: CollisionEditorSubcellPoint[] = [];
    visited[start.y * width + start.x] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const point = queue[cursor];
      if (this.isSolidAt(point.x, point.y) !== sourceSolid) continue;
      points.push(point);
      for (const neighbor of [
        { x: point.x, y: point.y - 1 },
        { x: point.x - 1, y: point.y },
        { x: point.x + 1, y: point.y },
        { x: point.x, y: point.y + 1 },
      ]) {
        if (
          neighbor.x < 0
          || neighbor.y < 0
          || neighbor.x >= width
          || neighbor.y >= height
          || !this.selectionContains(bounds, neighbor.x, neighbor.y)
        ) continue;
        const index = neighbor.y * width + neighbor.x;
        if (visited[index] !== 0) continue;
        visited[index] = 1;
        queue.push(neighbor);
      }
    }
    return this.applyStroke(points, solid);
  }

  fillSelection(selection: Readonly<CollisionEditorSelection>): boolean {
    return this.setSelection(selection, true);
  }

  eraseSelection(selection: Readonly<CollisionEditorSelection>): boolean {
    return this.setSelection(selection, false);
  }

  revertCoarseCell(cellX: number, cellY: number): boolean {
    this.assertEditable();
    const grid = this.requireGrid();
    this.assertCell(grid, cellX, cellY);
    const masks = this.requireMasks().slice();
    const index = cellY * grid.width + cellX;
    if (masks[index] === grid.coarseMasks[index]) return false;
    masks[index] = grid.coarseMasks[index];
    return this.commit(this.gridState(masks));
  }

  setBox(profile: Readonly<AuthoredBoxCollision>): boolean {
    this.assertEditable();
    const next = Object.freeze({
      profile: validateBox(profile),
      ...(this.state.masks ? { masks: this.state.masks.slice() } : {}),
    });
    return this.commit(next);
  }

  setExplicitEmpty(): boolean {
    this.assertEditable();
    const next = Object.freeze({
      profile: Object.freeze({ kind: "empty" } as const),
      ...(this.state.masks ? { masks: new Uint16Array(this.state.masks.length) } : {}),
    });
    return this.commit(next);
  }

  reset(): boolean {
    this.assertEditable();
    return this.commit(cloneState(this.baseline));
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(cloneState(this.state));
    if (this.future.length > this.historyLimit) this.future.shift();
    this.state = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.pushPast(this.state);
    this.state = next;
    return true;
  }

  serializeProfile(): RuntimeCollisionProfile {
    if (this.state.profile.kind !== "hybrid-grid") return cloneProfile(this.state.profile);
    const grid = this.requireGrid();
    return serializeHybridProfile(grid, this.requireMasks());
  }

  probeHull(input: Readonly<CollisionEditorHullProbeInput>): Readonly<CollisionEditorHullProbeResult> {
    const centerX = finite(input.centerX, "hull centerX");
    const centerY = finite(input.centerY, "hull centerY");
    const halfWidth = finite(input.halfWidth, "hull halfWidth");
    const halfHeight = finite(input.halfHeight ?? input.halfWidth, "hull halfHeight");
    if (halfWidth < 0 || halfHeight < 0) throw new RangeError("hull half sizes must be non-negative");
    const left = centerX - halfWidth;
    const right = centerX + halfWidth;
    const top = centerY - halfHeight;
    const bottom = centerY + halfHeight;
    const hits: CollisionEditorHullHit[] = [];

    if (this.state.profile.kind === "empty") return Object.freeze({ collides: false, hits: Object.freeze([]) });
    if (this.state.profile.kind === "box") {
      const profile = this.state.profile;
      if (overlap(
        left,
        top,
        right,
        bottom,
        profile.offset.x - profile.halfSize.width,
        profile.offset.y - profile.halfSize.height,
        profile.offset.x + profile.halfSize.width,
        profile.offset.y + profile.halfSize.height,
      )) hits.push(Object.freeze({ kind: "box" }));
      return Object.freeze({ collides: hits.length > 0, hits: Object.freeze(hits) });
    }

    const grid = this.requireGrid();
    const masks = this.state.profile.kind === "coarse-grid"
      ? grid.coarseMasks
      : this.requireMasks();
    const pixelWidth = grid.width * grid.tileSize;
    const pixelHeight = grid.height * grid.tileSize;
    if (input.outsideIsSolid && (left < 0 || top < 0 || right > pixelWidth || bottom > pixelHeight)) {
      hits.push(Object.freeze({ kind: "outside" }));
    }

    const minimumSubcellX = Math.max(0, Math.floor(left / grid.subcellSize));
    const minimumSubcellY = Math.max(0, Math.floor(top / grid.subcellSize));
    const maximumSubcellX = Math.min(
      grid.width * COLLISION_SUBCELLS_PER_TILE - 1,
      Math.ceil(right / grid.subcellSize) - 1,
    );
    const maximumSubcellY = Math.min(
      grid.height * COLLISION_SUBCELLS_PER_TILE - 1,
      Math.ceil(bottom / grid.subcellSize) - 1,
    );
    for (let subcellY = minimumSubcellY; subcellY <= maximumSubcellY; subcellY++) {
      for (let subcellX = minimumSubcellX; subcellX <= maximumSubcellX; subcellX++) {
        const cellX = Math.floor(subcellX / COLLISION_SUBCELLS_PER_TILE);
        const cellY = Math.floor(subcellY / COLLISION_SUBCELLS_PER_TILE);
        const mask = masks[cellY * grid.width + cellX];
        const localX = subcellX % COLLISION_SUBCELLS_PER_TILE;
        const localY = subcellY % COLLISION_SUBCELLS_PER_TILE;
        if (!isCollisionSubcellSolid(mask, localX, localY)) continue;
        const primitiveLeft = subcellX * grid.subcellSize;
        const primitiveTop = subcellY * grid.subcellSize;
        if (!overlap(
          left,
          top,
          right,
          bottom,
          primitiveLeft,
          primitiveTop,
          primitiveLeft + grid.subcellSize,
          primitiveTop + grid.subcellSize,
        )) continue;
        hits.push(Object.freeze({
          kind: "subcell",
          cellX,
          cellY,
          subcellX: localX,
          subcellY: localY,
        }));
      }
    }
    return Object.freeze({ collides: hits.length > 0, hits: Object.freeze(hits) });
  }

  private applyStroke(
    points: readonly Readonly<CollisionEditorSubcellPoint>[],
    solid: boolean,
  ): boolean {
    this.assertEditable();
    const grid = this.requireGrid();
    for (const point of points) this.assertSubcell(grid, point.x, point.y);
    if (points.length === 0) return false;
    const masks = this.requireMasks().slice();
    let changed = false;
    for (const point of points) {
      const cellX = Math.floor(point.x / COLLISION_SUBCELLS_PER_TILE);
      const cellY = Math.floor(point.y / COLLISION_SUBCELLS_PER_TILE);
      const index = cellY * grid.width + cellX;
      const bit = collisionSubcellBit(
        point.x % COLLISION_SUBCELLS_PER_TILE,
        point.y % COLLISION_SUBCELLS_PER_TILE,
      );
      const next = solid ? masks[index] | bit : masks[index] & ~bit;
      if (next === masks[index]) continue;
      masks[index] = next;
      changed = true;
    }
    return changed && this.commit(this.gridState(masks));
  }

  private setSelection(selection: Readonly<CollisionEditorSelection>, solid: boolean): boolean {
    this.assertEditable();
    const grid = this.requireGrid();
    const bounds = this.validateSelection(grid, selection);
    const points: CollisionEditorSubcellPoint[] = [];
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x++) points.push({ x, y });
    }
    return this.applyStroke(points, solid);
  }

  private gridState(masks: Uint16Array): Readonly<EditorState> {
    if (masksEqual(masks, this.baseline.masks)) return cloneState(this.baseline);
    return Object.freeze({
      profile: Object.freeze({
        kind: "hybrid-grid",
        subcellSize: COLLISION_SUBCELL_SIZE,
        mixedCells: Object.freeze([]),
      }),
      masks,
    });
  }

  private commit(next: Readonly<EditorState>): boolean {
    if (statesEqual(this.state, next)) return false;
    this.pushPast(this.state);
    this.state = cloneState(next);
    this.future.splice(0);
    return true;
  }

  private pushPast(state: Readonly<EditorState>): void {
    this.past.push(cloneState(state));
    if (this.past.length > this.historyLimit) this.past.shift();
  }

  private assertEditable(): void {
    if (!this.target.editable) throw new Error(`Collision target ${this.target.objectKind} is read-only`);
  }

  private requireGrid(): Readonly<CollisionEditorGrid> {
    if (!this.grid) throw new TypeError(`Collision target ${this.target.objectKind} has no editable grid`);
    return this.grid;
  }

  private requireMasks(): Uint16Array {
    if (!this.state.masks) throw new TypeError(`Collision target ${this.target.objectKind} has no dense masks`);
    return this.state.masks;
  }

  private assertCell(grid: Readonly<CollisionEditorGrid>, x: number, y: number): void {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
      throw new RangeError(`Collision cell (${x}, ${y}) is outside the ${grid.width}x${grid.height} grid`);
    }
  }

  private assertSubcell(grid: Readonly<CollisionEditorGrid>, x: number, y: number): void {
    const width = grid.width * COLLISION_SUBCELLS_PER_TILE;
    const height = grid.height * COLLISION_SUBCELLS_PER_TILE;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
      throw new RangeError(`Collision subcell (${x}, ${y}) is outside the ${width}x${height} editor grid`);
    }
  }

  private validateSelection(
    grid: Readonly<CollisionEditorGrid>,
    selection: Readonly<CollisionEditorSelection>,
  ): CollisionEditorSelection {
    const x = selection.x;
    const y = selection.y;
    const width = positiveInteger(selection.width, "selection.width");
    const height = positiveInteger(selection.height, "selection.height");
    this.assertSubcell(grid, x, y);
    const gridWidth = grid.width * COLLISION_SUBCELLS_PER_TILE;
    const gridHeight = grid.height * COLLISION_SUBCELLS_PER_TILE;
    if (x + width > gridWidth || y + height > gridHeight) {
      throw new RangeError(`Collision selection exceeds the ${gridWidth}x${gridHeight} editor grid`);
    }
    return Object.freeze({ x, y, width, height });
  }

  private selectionContains(selection: Readonly<CollisionEditorSelection>, x: number, y: number): boolean {
    return x >= selection.x
      && y >= selection.y
      && x < selection.x + selection.width
      && y < selection.y + selection.height;
  }
}
