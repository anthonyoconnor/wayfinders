import { describe, expect, it } from "vitest";

import {
  CollisionEditorModel,
  createCollisionEditorBaseMasks,
  type CollisionEditorGrid,
  type CollisionEditorTarget,
} from "../src/wayfinders/assets/CollisionEditorModel.ts";
import type { RuntimeCollisionProfile } from "../src/wayfinders/assets/CollisionProfileRegistry.ts";
import {
  EMPTY_COLLISION_MASK,
  FULL_COLLISION_MASK,
  collisionSubcellBit,
  solidRowsToCollisionMask,
} from "../src/wayfinders/world/CollisionMask.ts";

function editorGrid(
  width: number,
  height: number,
  coarseMasks: readonly number[] = Array.from({ length: width * height }, () => EMPTY_COLLISION_MASK),
): CollisionEditorGrid {
  return { width, height, tileSize: 32, subcellSize: 8, coarseMasks };
}

function gridTarget(
  grid: Readonly<CollisionEditorGrid>,
  profile: RuntimeCollisionProfile = { kind: "hybrid-grid", subcellSize: 8, mixedCells: [] },
  editable = true,
): CollisionEditorTarget {
  return {
    objectKind: "home-island",
    editable,
    grid,
    baseMasks: createCollisionEditorBaseMasks(grid, profile),
    profile,
  };
}

describe("GR-2.5 collision editor model", () => {
  it("opens dense effective masks and serializes sparse hybrid cells in canonical y/x order", () => {
    const grid = editorGrid(2, 2);
    const profile = {
      kind: "hybrid-grid" as const,
      subcellSize: 8 as const,
      mixedCells: [
        { x: 1, y: 1, solidRows: ["0000", "0010", "0000", "0000"] as const },
        { x: 1, y: 0, solidRows: ["0100", "0000", "0000", "0000"] as const },
        { x: 0, y: 1, solidRows: ["0000", "0000", "0001", "0000"] as const },
      ],
    };
    const model = new CollisionEditorModel(gridTarget(grid, profile));

    expect(model.getEffectiveMask(1, 0)).toBe(solidRowsToCollisionMask(profile.mixedCells[1].solidRows));
    expect(model.serializeProfile()).toEqual({
      kind: "hybrid-grid",
      subcellSize: 8,
      mixedCells: [
        { x: 1, y: 0, solidRows: ["0100", "0000", "0000", "0000"] },
        { x: 0, y: 1, solidRows: ["0000", "0000", "0001", "0000"] },
        { x: 1, y: 1, solidRows: ["0000", "0010", "0000", "0000"] },
      ],
    });
    expect(model.dirty).toBe(false);

    const snapshot = model.snapshot();
    snapshot.masks![0] = FULL_COLLISION_MASK;
    expect(model.getEffectiveMask(0, 0)).toBe(EMPTY_COLLISION_MASK);
  });

  it("treats a multi-point stroke as one history item and clears redo after a divergent edit", () => {
    const model = new CollisionEditorModel(gridTarget(editorGrid(2, 2)));
    const stroke = [{ x: 5, y: 1 }, { x: 0, y: 4 }, { x: 5, y: 1 }];

    expect(model.paintStroke(stroke)).toBe(true);
    expect(model.isSolidAt(5, 1)).toBe(true);
    expect(model.isSolidAt(0, 4)).toBe(true);
    expect(model.paintStroke(stroke)).toBe(false);
    expect(model.undo()).toBe(true);
    expect(model.undo()).toBe(false);
    expect(model.isSolidAt(5, 1)).toBe(false);
    expect(model.isSolidAt(0, 4)).toBe(false);

    expect(model.redo()).toBe(true);
    expect(model.undo()).toBe(true);
    expect(model.canRedo).toBe(true);
    expect(model.execute({ kind: "paint-stroke", points: [{ x: 6, y: 1 }] })).toBe(true);
    expect(model.canRedo).toBe(false);
  });

  it("performs deterministic four-neighbour flood fill within an optional selection", () => {
    const model = new CollisionEditorModel(gridTarget(editorGrid(1, 1)));
    const selection = { x: 1, y: 1, width: 2, height: 2 };

    expect(model.floodFill({ x: 1, y: 1 }, true, selection)).toBe(true);
    expect(model.getEffectiveMask(0, 0)).toBe(solidRowsToCollisionMask([
      "0000",
      "0110",
      "0110",
      "0000",
    ]));
    expect(model.floodFill({ x: 1, y: 1 }, true, selection)).toBe(false);
    expect(() => model.floodFill({ x: 0, y: 0 }, false, selection)).toThrow(/inside the selection/);
    expect(model.undo()).toBe(true);
    expect(model.getEffectiveMask(0, 0)).toBe(EMPTY_COLLISION_MASK);
  });

  it("fills and erases rectangular selections as single undoable commands", () => {
    const model = new CollisionEditorModel(gridTarget(editorGrid(1, 1)));
    const selection = { x: 1, y: 1, width: 2, height: 2 };

    expect(model.fillSelection(selection)).toBe(true);
    expect(model.eraseSelection(selection)).toBe(true);
    expect(model.dirty).toBe(false);
    expect(model.undo()).toBe(true);
    expect(model.getEffectiveMask(0, 0)).toBe(solidRowsToCollisionMask([
      "0000",
      "0110",
      "0110",
      "0000",
    ]));
    expect(() => model.fillSelection({ x: 3, y: 3, width: 2, height: 1 })).toThrow(/exceeds/);
  });

  it("omits masks matching coarse terrain and rejects uniform opposite overrides until reverted", () => {
    const grid = editorGrid(2, 1, [EMPTY_COLLISION_MASK, FULL_COLLISION_MASK]);
    const model = new CollisionEditorModel(gridTarget(grid));

    expect(model.serializeProfile()).toEqual({ kind: "hybrid-grid", subcellSize: 8, mixedCells: [] });
    expect(model.fillSelection({ x: 0, y: 0, width: 4, height: 4 })).toBe(true);
    expect(model.snapshot()).toMatchObject({ exportable: false, serializationError: expect.stringMatching(/uniformly solid/) });
    expect(() => model.serializeProfile()).toThrow(/opposite its open coarse terrain/);
    expect(model.revertCoarseCell(0, 0)).toBe(true);
    expect(model.dirty).toBe(false);

    expect(model.eraseSelection({ x: 4, y: 0, width: 4, height: 4 })).toBe(true);
    expect(() => model.serializeProfile()).toThrow(/opposite its solid coarse terrain/);
    expect(model.revertCoarseCell(1, 0)).toBe(true);
    expect(model.serializeProfile()).toEqual({ kind: "hybrid-grid", subcellSize: 8, mixedCells: [] });
  });

  it("resets to the loaded baseline as one undoable edit", () => {
    const model = new CollisionEditorModel(gridTarget(editorGrid(1, 1)));

    expect(model.reset()).toBe(false);
    expect(model.paintStroke([{ x: 2, y: 3 }])).toBe(true);
    expect(model.dirty).toBe(true);
    expect(model.reset()).toBe(true);
    expect(model.dirty).toBe(false);
    expect(model.canUndo).toBe(true);
    expect(model.undo()).toBe(true);
    expect(model.isSolidAt(2, 3)).toBe(true);
    expect(model.redo()).toBe(true);
    expect(model.dirty).toBe(false);
  });

  it("edits box and explicit-empty profiles with undo and exact local hull probes", () => {
    const model = new CollisionEditorModel({
      objectKind: "player-ship",
      editable: true,
      profile: { kind: "box", offset: { x: 0, y: 0 }, halfSize: { width: 14, height: 14 } },
    });

    expect(model.probeHull({ centerX: 0, centerY: 0, halfWidth: 0 })).toMatchObject({ collides: true });
    expect(model.probeHull({ centerX: 20, centerY: 0, halfWidth: 1 })).toMatchObject({ collides: false });
    expect(model.setBox({
      kind: "box",
      offset: { x: 2, y: -1 },
      halfSize: { width: 8, height: 6 },
    })).toBe(true);
    expect(model.serializeProfile()).toEqual({
      kind: "box",
      offset: { x: 2, y: -1 },
      halfSize: { width: 8, height: 6 },
    });
    expect(model.undo()).toBe(true);
    expect(model.serializeProfile()).toMatchObject({ halfSize: { width: 14, height: 14 } });

    expect(model.setExplicitEmpty()).toBe(true);
    expect(model.serializeProfile()).toEqual({ kind: "empty" });
    expect(model.probeHull({ centerX: 0, centerY: 0, halfWidth: 100 })).toEqual({ collides: false, hits: [] });
    expect(() => model.setBox({
      kind: "box",
      offset: { x: 0, y: 0 },
      halfSize: { width: 0, height: 2 },
    })).toThrow(/positive/);
  });

  it("bounds history while preserving the oldest still-reachable authored state", () => {
    const model = new CollisionEditorModel(gridTarget(editorGrid(1, 1)), 2);

    expect(model.paintStroke([{ x: 0, y: 0 }])).toBe(true);
    expect(model.paintStroke([{ x: 1, y: 0 }])).toBe(true);
    expect(model.paintStroke([{ x: 2, y: 0 }])).toBe(true);
    expect(model.undo()).toBe(true);
    expect(model.undo()).toBe(true);
    expect(model.undo()).toBe(false);
    expect(model.getEffectiveMask(0, 0)).toBe(collisionSubcellBit(0, 0));
  });

  it("probes the edited dense mask with exact subcell hits and optional solid exterior", () => {
    const grid = editorGrid(1, 1);
    const profile = {
      kind: "hybrid-grid" as const,
      subcellSize: 8 as const,
      mixedCells: [{
        x: 0,
        y: 0,
        solidRows: ["0000", "0000", "0100", "0000"] as const,
      }],
    };
    const model = new CollisionEditorModel(gridTarget(grid, profile));

    expect(model.probeHull({ centerX: 12, centerY: 20, halfWidth: 1 })).toEqual({
      collides: true,
      hits: [{ kind: "subcell", cellX: 0, cellY: 0, subcellX: 1, subcellY: 2 }],
    });
    expect(model.probeHull({ centerX: 4, centerY: 4, halfWidth: 1 })).toEqual({ collides: false, hits: [] });
    expect(model.probeHull({ centerX: -1, centerY: 4, halfWidth: 0, outsideIsSolid: true })).toEqual({
      collides: true,
      hits: [{ kind: "outside" }],
    });
  });

  it("rejects inconsistent target data and prevents edits to inspect-only targets", () => {
    const grid = editorGrid(1, 1);
    expect(() => new CollisionEditorModel({
      ...gridTarget(grid),
      baseMasks: [FULL_COLLISION_MASK],
    })).toThrow(/do not match/);
    expect(() => createCollisionEditorBaseMasks(grid, {
      kind: "hybrid-grid",
      subcellSize: 8,
      mixedCells: [{ x: 1, y: 0, solidRows: ["1000", "0000", "0000", "0000"] }],
    })).toThrow(/outside/);

    const readOnly = new CollisionEditorModel(gridTarget(grid, undefined, false));
    expect(() => readOnly.paintStroke([{ x: 0, y: 0 }])).toThrow(/read-only/);
    expect(readOnly.serializeProfile()).toEqual({ kind: "hybrid-grid", subcellSize: 8, mixedCells: [] });
  });
});
