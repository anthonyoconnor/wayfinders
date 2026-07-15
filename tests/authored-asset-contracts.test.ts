import { describe, expect, it } from "vitest";
import {
  AUTHORED_ASSET_CONTRACT_VERSION,
  AUTHORED_ASSET_IDS,
  AUTHORED_TERRAINS,
  authoredCellBlocksMovement,
  authoredCellBlocksSight,
  validateAuthoredAssetMetadata,
} from "../src/wayfinders/assets/AuthoredAssetContracts";

function homeFixture(): Record<string, unknown> {
  const cells = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const land = x >= 1 && x <= 3 && y >= 1 && y <= 3 && !(x === 3 && y === 2);
      cells.push({
        x,
        y,
        terrain: land ? AUTHORED_TERRAINS.land : AUTHORED_TERRAINS.shallowOcean,
        belongsToHomeIsland: land,
      });
    }
  }
  return {
    contractVersion: AUTHORED_ASSET_CONTRACT_VERSION,
    assetId: AUTHORED_ASSET_IDS.homeIsland,
    kind: "home-island",
    sourceAssetId: "generated.home-island.source.v1",
    runtimeRevision: 1,
    tileSize: 32,
    collision: {
      kind: "hybrid-grid",
      subcellSize: 8,
      mixedCells: [{
        x: 0,
        y: 0,
        solidRows: ["0000", "0110", "0110", "0000"],
      }],
    },
    grid: { width: 5, height: 5, placementOrigin: { x: 2, y: 2 }, cells },
    anchors: {
      homeCenter: { x: 2, y: 2 },
      harbour: { x: 3, y: 2 },
      dock: { x: 4, y: 2 },
      homeReturn: { x: 4, y: 2 },
      service: { x: 4, y: 2 },
    },
    render: {
      pixelSize: { width: 160, height: 160 },
      slices: [{
        id: "complete",
        imageId: "home.island.primary.complete",
        gridBounds: { x: 0, y: 0, width: 5, height: 5 },
        pixelOffset: { x: 0, y: 0 },
        pixelSize: { width: 160, height: 160 },
        scale: 1,
        depth: 5,
      }],
    },
  };
}

function boatFixture(): Record<string, unknown> {
  return {
    contractVersion: 1,
    assetId: AUTHORED_ASSET_IDS.playerBoat,
    kind: "player-boat",
    sourceAssetId: "generated.player-boat.source.v1",
    runtimeRevision: 1,
    tileSize: 32,
    collision: {
      kind: "box",
      offset: { x: 0, y: 0 },
      halfSize: { width: 14, height: 14 },
    },
    visual: {
      imageId: "player.boat.primary.frames",
      frameSize: { width: 48, height: 48 },
      origin: { x: 0.5, y: 0.5 },
      sourceHeadingDegrees: 0,
      headingMode: "directional",
      directionCount: 8,
      motionFramesPerDirection: 3,
      framesPerSecond: 6,
      scale: 1,
      depth: 50,
    },
    wake: {
      imageId: "player.boat.primary.wake",
      frameSize: { width: 64, height: 32 },
      origin: { x: 0.78, y: 0.5 },
      offset: { x: -12, y: 0 },
      frameCount: 4,
      framesPerSecond: 8,
      sourceHeadingDegrees: 0,
      minimumSpeedPixelsPerSecond: 2,
      fullSpeedPixelsPerSecond: 80,
      scale: 1,
      depth: 49,
    },
  };
}

function shoalFixture(): Record<string, unknown> {
  return {
    contractVersion: 1,
    assetId: AUTHORED_ASSET_IDS.fishingShoal,
    kind: "fishing-shoal",
    sourceAssetId: "generated.fishing-shoal.source.v1",
    runtimeRevision: 1,
    tileSize: 32,
    collision: { kind: "empty" },
    grid: {
      width: 1,
      height: 1,
      placementOrigin: { x: 0, y: 0 },
      serviceAnchor: { x: 0, y: 0 },
      passable: true,
    },
    visual: {
      imageId: "shoal.fishing.primary.complete",
      pixelSize: { width: 96, height: 64 },
      origin: { x: 0.5, y: 0.75 },
      scale: 1,
      depth: 43,
    },
    visibilitySource: "fishing-shoal-read-model",
  };
}

describe("GR-1.1 authored asset contracts", () => {
  it("accepts complete home, boat and shoal package metadata", () => {
    const home = validateAuthoredAssetMetadata(homeFixture());
    const boat = validateAuthoredAssetMetadata(boatFixture());
    const shoal = validateAuthoredAssetMetadata(shoalFixture());
    expect(home.assetId).toBe(AUTHORED_ASSET_IDS.homeIsland);
    expect(boat.assetId).toBe(AUTHORED_ASSET_IDS.playerBoat);
    expect(shoal.assetId).toBe(AUTHORED_ASSET_IDS.fishingShoal);
    expect(home.collision).toMatchObject({ kind: "hybrid-grid", subcellSize: 8 });
    expect(boat.collision).toEqual({
      kind: "box",
      offset: { x: 0, y: 0 },
      halfSize: { width: 14, height: 14 },
    });
    expect(shoal.collision).toEqual({ kind: "empty" });
  });

  it("preserves omitted collision metadata as the legacy V1 contract", () => {
    for (const fixture of [homeFixture(), boatFixture(), shoalFixture()]) {
      delete fixture.collision;
      const validated = validateAuthoredAssetMetadata(fixture);
      expect(Object.hasOwn(validated, "collision")).toBe(false);
      expect(Object.hasOwn(JSON.parse(JSON.stringify(validated)), "collision")).toBe(false);
    }
  });

  it("validates sparse 4x4 mixed-cell collision patches", () => {
    const duplicate = homeFixture();
    const duplicateCollision = duplicate.collision as { mixedCells: Record<string, unknown>[] };
    duplicateCollision.mixedCells.push(structuredClone(duplicateCollision.mixedCells[0]));
    expect(() => validateAuthoredAssetMetadata(duplicate)).toThrow(/duplicate cell 0,0/);

    const outside = homeFixture();
    const outsideCollision = outside.collision as { mixedCells: Record<string, unknown>[] };
    outsideCollision.mixedCells[0].x = 5;
    expect(() => validateAuthoredAssetMetadata(outside)).toThrow(/outside the 5x5 asset grid/);

    const misaligned = homeFixture();
    (misaligned.collision as Record<string, unknown>).subcellSize = 4;
    expect(() => validateAuthoredAssetMetadata(misaligned)).toThrow(/32-pixel navigation cells and 8-pixel/);
  });

  it("rejects malformed rows and accepts explicit uniform cell overrides", () => {
    const wrongRowCount = homeFixture();
    const wrongCountCell = (wrongRowCount.collision as { mixedCells: { solidRows: string[] }[] }).mixedCells[0];
    wrongCountCell.solidRows.pop();
    expect(() => validateAuthoredAssetMetadata(wrongRowCount)).toThrow(/exactly 4 rows/);

    const invalidValue = homeFixture();
    const invalidCell = (invalidValue.collision as { mixedCells: { solidRows: string[] }[] }).mixedCells[0];
    invalidCell.solidRows[1] = "0102";
    expect(() => validateAuthoredAssetMetadata(invalidValue)).toThrow(/zero-or-one/);

    for (const value of ["0000", "1111"]) {
      const uniform = homeFixture();
      const uniformCell = (uniform.collision as { mixedCells: { solidRows: string[] }[] }).mixedCells[0];
      uniformCell.solidRows = Array.from({ length: 4 }, () => value);
      expect(validateAuthoredAssetMetadata(uniform).collision).toMatchObject({
        mixedCells: [{ solidRows: [value, value, value, value] }],
      });
    }
  });

  it("enforces each package kind's collision profile", () => {
    const wrongHomeKind = homeFixture();
    wrongHomeKind.collision = { kind: "empty" };
    expect(() => validateAuthoredAssetMetadata(wrongHomeKind)).toThrow(/home-island collision.kind/);

    const offCenterBoat = boatFixture();
    const offCenterCollision = offCenterBoat.collision as { offset: { x: number; y: number } };
    offCenterCollision.offset.x = 1;
    expect(() => validateAuthoredAssetMetadata(offCenterBoat)).toThrow(/must be centered/);

    const oversizedBoat = boatFixture();
    const oversizedCollision = oversizedBoat.collision as { halfSize: { width: number; height: number } };
    oversizedCollision.halfSize.width = 16;
    expect(() => validateAuthoredAssetMetadata(oversizedBoat)).toThrow(/smaller than half tileSize/);

    const rectangularBoat = boatFixture();
    const rectangularCollision = rectangularBoat.collision as { halfSize: { width: number; height: number } };
    rectangularCollision.halfSize.width = 12;
    expect(() => validateAuthoredAssetMetadata(rectangularBoat)).toThrow(/square runtime hull/);

    const blockedShoal = shoalFixture();
    blockedShoal.collision = {
      kind: "box",
      offset: { x: 0, y: 0 },
      halfSize: { width: 4, height: 4 },
    };
    expect(() => validateAuthoredAssetMetadata(blockedShoal)).toThrow(/fishing-shoal collision.kind/);
  });

  it("requires a complete unique home cell map", () => {
    const missing = homeFixture();
    const grid = missing.grid as { cells: unknown[] };
    grid.cells.pop();
    expect(() => validateAuthoredAssetMetadata(missing)).toThrow(/define every cell/);

    const duplicate = homeFixture();
    const duplicateGrid = duplicate.grid as { cells: Record<string, unknown>[] };
    duplicateGrid.cells[1] = { ...duplicateGrid.cells[0] };
    expect(() => validateAuthoredAssetMetadata(duplicate)).toThrow(/duplicate cell/);
  });

  it("expands a compact fixed authored row map without procedural tile assembly", () => {
    const compact = homeFixture();
    const grid = compact.grid as Record<string, unknown>;
    delete grid.cells;
    grid.cellRows = ["SSSSS", "SLLLS", "SLLSS", "SLLLS", "SSSSS"];
    const validated = validateAuthoredAssetMetadata(compact);
    expect(validated.kind).toBe("home-island");
    if (validated.kind !== "home-island") throw new Error("Expected home-island metadata");
    expect(validated.grid.cells).toHaveLength(25);
    expect(validated.grid.cells.find(({ x, y }) => x === 2 && y === 2)?.terrain).toBe(AUTHORED_TERRAINS.land);
  });

  it("rejects overlapping or out-of-range authored render slices", () => {
    const overlapping = homeFixture();
    const render = overlapping.render as { slices: Record<string, unknown>[] };
    render.slices = [
      {
        id: "left",
        imageId: "left",
        gridBounds: { x: 0, y: 0, width: 3, height: 5 },
        pixelOffset: { x: 0, y: 0 },
        pixelSize: { width: 96, height: 160 },
        scale: 1,
        depth: 5,
      },
      {
        id: "right",
        imageId: "right",
        gridBounds: { x: 2, y: 0, width: 3, height: 5 },
        pixelOffset: { x: 64, y: 0 },
        pixelSize: { width: 96, height: 160 },
        scale: 1,
        depth: 5,
      },
    ];
    expect(() => validateAuthoredAssetMetadata(overlapping)).toThrow(/overlap/);

    const outside = homeFixture();
    const outsideRender = outside.render as { slices: Record<string, unknown>[] };
    outsideRender.slices[0].gridBounds = { x: 1, y: 0, width: 5, height: 5 };
    expect(() => validateAuthoredAssetMetadata(outside)).toThrow(/exceeds the asset grid/);
  });

  it("rejects invalid anchors and a blocked dock approach", () => {
    const invalidAnchor = homeFixture();
    (invalidAnchor.anchors as Record<string, unknown>).dock = { x: 9, y: 2 };
    expect(() => validateAuthoredAssetMetadata(invalidAnchor)).toThrow(/outside/);

    const blocked = homeFixture();
    const blockedAnchors = blocked.anchors as Record<string, unknown>;
    blockedAnchors.harbour = { x: 3, y: 2 };
    blockedAnchors.dock = { x: 3, y: 2 };
    blockedAnchors.homeReturn = { x: 3, y: 2 };
    blockedAnchors.service = { x: 3, y: 2 };
    const blockedGrid = blocked.grid as { cells: Record<string, unknown>[] };
    for (const cell of blockedGrid.cells) {
      if (cell.x === 3 && (cell.y === 1 || cell.y === 3)) cell.terrain = AUTHORED_TERRAINS.land;
      if (cell.x === 4 && cell.y === 2) cell.terrain = AUTHORED_TERRAINS.land;
    }
    expect(() => validateAuthoredAssetMetadata(blocked)).toThrow(/dock has no passable/);
  });

  it("keeps fishing shoals passable and read-model gated", () => {
    const blocked = shoalFixture();
    (blocked.grid as Record<string, unknown>).passable = false;
    expect(() => validateAuthoredAssetMetadata(blocked)).toThrow(/must remain true/);

    const leaked = shoalFixture();
    leaked.visibilitySource = "catalog";
    expect(() => validateAuthoredAssetMetadata(leaked)).toThrow(/fishing-shoal-read-model/);
  });

  it("supports rotation-safe and directional boat contracts without ambiguous origins", () => {
    const directional = validateAuthoredAssetMetadata(boatFixture());
    expect(directional.kind).toBe("player-boat");

    const mismatched = boatFixture();
    const visual = mismatched.visual as Record<string, unknown>;
    visual.headingMode = "rotate";
    expect(() => validateAuthoredAssetMetadata(mismatched)).toThrow(/must use one direction/);

    const badOrigin = boatFixture();
    (badOrigin.visual as Record<string, unknown>).origin = { x: 1.2, y: 0.5 };
    expect(() => validateAuthoredAssetMetadata(badOrigin)).toThrow(/normalized coordinates/);
  });

  it("derives inspectable collision and sight blocking from authored terrain", () => {
    const land = { x: 0, y: 0, terrain: AUTHORED_TERRAINS.land, belongsToHomeIsland: true };
    const shallow = { x: 1, y: 0, terrain: AUTHORED_TERRAINS.shallowOcean, belongsToHomeIsland: false };
    expect(authoredCellBlocksMovement(land)).toBe(true);
    expect(authoredCellBlocksSight(land)).toBe(true);
    expect(authoredCellBlocksMovement(shallow)).toBe(false);
    expect(authoredCellBlocksSight(shallow)).toBe(false);
  });
});
