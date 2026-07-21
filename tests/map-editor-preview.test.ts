import { describe, expect, it } from "vitest";
import {
  MapEditorPreviewSpatialIndex,
  mapEditorDragTile,
  mapEditorIslandPreviewFootprint,
  mapEditorPeriodicAliases,
  snapMapEditorTile,
} from "../src/wayfinders/assets/mapEditor/MapEditorPreview";

describe("MAP-1.2 compact editor preview", () => {
  it("snaps lifted pointer positions to canonical wrapping tiles", () => {
    expect(snapMapEditorTile(3.9, 4.1, 96, 64)).toEqual({ x: 3, y: 4 });
    expect(snapMapEditorTile(-0.1, 64.2, 96, 64)).toEqual({ x: 95, y: 0 });
    expect(snapMapEditorTile(192, -65, 96, 64)).toEqual({ x: 0, y: 63 });
  });

  it("preserves the object grab offset across ordinary and seam-crossing drags", () => {
    expect(mapEditorDragTile(
      { x: 10, y: 10 },
      { x: 7, y: 8 },
      { x: 7, y: 8 },
      192,
      192,
    )).toEqual({ x: 10, y: 10 });
    expect(mapEditorDragTile(
      { x: 10, y: 10 },
      { x: 7, y: 8 },
      { x: 8, y: 10 },
      192,
      192,
    )).toEqual({ x: 11, y: 12 });
    expect(mapEditorDragTile(
      { x: 191, y: 40 },
      { x: 1, y: 40 },
      { x: 2, y: 40 },
      192,
      192,
    )).toEqual({ x: 0, y: 40 });
    expect(mapEditorDragTile(
      { x: 0, y: 40 },
      { x: 191, y: 40 },
      { x: 190, y: 40 },
      192,
      192,
    )).toEqual({ x: 191, y: 40 });
  });

  it("does not project current catalog geometry onto a stale island revision", () => {
    expect(mapEditorIslandPreviewFootprint(
      { x: 30, y: 40 },
      "revision-old",
      { revision: "revision-current", gridWidth: 12, gridHeight: 8 },
    )).toEqual({
      exactRevision: false,
      bounds: { minX: 30, minY: 40, maxX: 30, maxY: 40 },
    });
    expect(mapEditorIslandPreviewFootprint(
      { x: 30, y: 40 },
      "revision-current",
      { revision: "revision-current", gridWidth: 12, gridHeight: 8 },
    )).toEqual({
      exactRevision: true,
      bounds: { minX: 24, minY: 36, maxX: 35, maxY: 43 },
    });
  });

  it("derives edge and corner ghosts while retaining one canonical image", () => {
    expect(mapEditorPeriodicAliases({ minX: -2, minY: 5, maxX: 3, maxY: 10 }, 96, 64)).toEqual([
      { x: 0, y: 0 },
      { x: 96, y: 0 },
    ]);
    expect(mapEditorPeriodicAliases({ minX: -2, minY: -3, maxX: 3, maxY: 2 }, 96, 64)).toEqual([
      { x: 0, y: 0 },
      { x: 96, y: 0 },
      { x: 0, y: 64 },
      { x: 96, y: 64 },
    ]);
  });

  it("indexes periodic views and deduplicates multi-bucket viewport queries", () => {
    const index = new MapEditorPreviewSpatialIndex(96, 64, 4);
    index.rebuild([
      { id: "island:1", bounds: { minX: -2, minY: 5, maxX: 3, maxY: 10 } },
      { id: "shoal:2", bounds: { minX: 40, minY: 20, maxX: 40, maxY: 20 } },
    ]);

    expect(index.allViews().map(({ key }) => key)).toEqual([
      "island:1@0,0",
      "island:1@96,0",
      "shoal:2@0,0",
    ]);
    expect(index.query({ minX: 0, minY: 0, maxX: 8, maxY: 16 }).map(({ key }) => key)).toEqual([
      "island:1@0,0",
    ]);
    expect(index.query({ minX: 92, minY: 0, maxX: 95, maxY: 16 }).map(({ key }) => key)).toEqual([
      "island:1@96,0",
    ]);
    expect(index.query({ minX: 0, minY: 0, maxX: 95, maxY: 63 })).toHaveLength(3);
  });

  it("keeps a close viewport query bounded as placed content grows", () => {
    const index = new MapEditorPreviewSpatialIndex(192, 192, 16);
    index.rebuild(Array.from({ length: 144 }, (_, ordinal) => {
      const x = ordinal % 12 * 16 + 8;
      const y = Math.floor(ordinal / 12) * 16 + 8;
      return { id: `placed:${ordinal}`, bounds: { minX: x, minY: y, maxX: x, maxY: y } };
    }));

    expect(index.allViews()).toHaveLength(144);
    expect(index.query({ minX: 0, minY: 0, maxX: 15, maxY: 15 }).map(({ record }) => record.id))
      .toEqual(["placed:0"]);
  });

  it("rejects duplicate record identity and world-sized footprints", () => {
    const index = new MapEditorPreviewSpatialIndex(8, 8);
    expect(() => index.rebuild([
      { id: "same", bounds: { minX: 1, minY: 1, maxX: 1, maxY: 1 } },
      { id: "same", bounds: { minX: 2, minY: 2, maxX: 2, maxY: 2 } },
    ])).toThrow("unique");
    expect(() => mapEditorPeriodicAliases(
      { minX: 0, minY: 0, maxX: 7, maxY: 0 },
      8,
      8,
    )).toThrow("strictly smaller");
  });
});
