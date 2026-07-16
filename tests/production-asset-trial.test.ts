import { describe, expect, it } from "vitest";
import { isShipCenterCollisionFree } from "../src/wayfinders/navigation/CollisionGeometry.ts";
import {
  createProductionAssetTrial,
  type ProductionAssetTrialCandidate,
} from "../src/wayfinders/assets/ProductionAssetTrial.ts";
import { isCollisionSubcellSolid } from "../src/wayfinders/world/CollisionMask.ts";
import { TerrainType } from "../src/wayfinders/world/TileData.ts";
import { makeConfig } from "./helpers.ts";

const FINGERPRINT = "a".repeat(64);

function islandCandidate(
  overrides: Partial<ProductionAssetTrialCandidate> = {},
): Readonly<ProductionAssetTrialCandidate> {
  const solidSubcells = Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 3, y: 3 }),
    Object.freeze({ x: 4, y: 0 }),
    Object.freeze({ x: 7, y: 7 }),
  ]);
  return Object.freeze({
    id: "production.island.trial-fixture",
    entryType: "production-candidate",
    lifecycle: "candidate",
    fingerprint: FINGERPRINT,
    reviewState: "pending",
    recipe: Object.freeze({ family: "island" }),
    candidateLayers: Object.freeze([Object.freeze({
      id: "layer.base",
      name: "Base island",
      order: 0,
      url: "/candidate/base.png",
      defaultVisible: true,
      opacity: 1,
      blendMode: "normal",
      pixelSize: Object.freeze({ width: 64, height: 64 }),
    })]),
    collisionDraft: Object.freeze({
      kind: "hybrid-grid-draft",
      tileSize: 32,
      subcellSize: 8,
      method: "test-fixture",
      warnings: Object.freeze([]),
      grid: Object.freeze({
        width: 2,
        height: 2,
        subcellColumns: 8,
        subcellRows: 8,
      }),
      solidSubcells,
    }),
    ...overrides,
  });
}

function trialSnapshot(candidate: Readonly<ProductionAssetTrialCandidate>) {
  const trial = createProductionAssetTrial(candidate, candidate.fingerprint);
  const masks: Array<readonly [number, number, number]> = [];
  trial.world.forEachFineCollisionMask((x, y, mask) => masks.push([x, y, mask]));
  return {
    candidateId: trial.candidateId,
    candidateFingerprint: trial.candidateFingerprint,
    reviewState: trial.reviewState,
    world: [trial.world.width, trial.world.height],
    worldPixelSize: trial.worldPixelSize,
    island: trial.island,
    spawn: trial.spawn,
    resetPositions: trial.resetPositions,
    masks,
  };
}

describe("GR-3.8 isolated production-asset trial contract", () => {
  it("builds the same bounded open-water layout, origin, masks and resets deterministically", () => {
    const candidate = islandCandidate();
    const first = trialSnapshot(candidate);
    const second = trialSnapshot(candidate);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      candidateId: candidate.id,
      candidateFingerprint: FINGERPRINT,
      reviewState: "pending",
      world: [10, 10],
      worldPixelSize: { width: 320, height: 320 },
      island: {
        tileX: 4,
        tileY: 4,
        widthTiles: 2,
        heightTiles: 2,
        pixelWidth: 64,
        pixelHeight: 64,
        topLeftWorldX: 128,
        topLeftWorldY: 128,
        origin: { normalizedX: 0.5, normalizedY: 0.5, worldX: 160, worldY: 160 },
      },
    });

    const trial = createProductionAssetTrial(candidate, FINGERPRINT);
    trial.world.forEachTile((x, y) => {
      expect(trial.world.getTerrain(x, y)).toBe(TerrainType.DeepOcean);
      expect(trial.world.isMovementBlocked(x, y)).toBe(false);
    });
  });

  it("fails closed when the requested fingerprint is stale", () => {
    expect(() => createProductionAssetTrial(islandCandidate(), "b".repeat(64)))
      .toThrow(/changed; reopen its current library record/u);
  });

  it("allows a pending candidate without requiring review approval", () => {
    const trial = createProductionAssetTrial(islandCandidate({ reviewState: "pending" }), FINGERPRINT);
    expect(trial.reviewState).toBe("pending");
    expect(trial.layers).toEqual(islandCandidate().candidateLayers);
  });

  it("maps every saved global subcell to the exact row-major 32/8 world mask", () => {
    const candidate = islandCandidate();
    const draft = candidate.collisionDraft;
    if (draft.kind !== "hybrid-grid-draft") throw new Error("Expected hybrid-grid fixture");
    const trial = createProductionAssetTrial(candidate, FINGERPRINT);
    const solids = new Set(draft.solidSubcells.map(({ x, y }) => `${x},${y}`));

    for (let subcellY = 0; subcellY < draft.grid.subcellRows; subcellY++) {
      for (let subcellX = 0; subcellX < draft.grid.subcellColumns; subcellX++) {
        const cellX = trial.island.tileX + Math.floor(subcellX / 4);
        const cellY = trial.island.tileY + Math.floor(subcellY / 4);
        const mask = trial.world.getFineCollisionMask(cellX, cellY) ?? 0;
        expect(
          isCollisionSubcellSolid(mask, subcellX % 4, subcellY % 4),
          `${subcellX},${subcellY}`,
        ).toBe(solids.has(`${subcellX},${subcellY}`));
      }
    }
    expect(trial.world.fineCollisionCellCount).toBe(3);
  });

  it("provides four deterministic hull-safe reset positions outside the island canvas", () => {
    const solidSubcells = Object.freeze(Array.from({ length: 64 }, (_, index) => Object.freeze({
      x: index % 8,
      y: Math.floor(index / 8),
    })));
    const candidate = islandCandidate({
      collisionDraft: Object.freeze({
        ...islandCandidate().collisionDraft,
        solidSubcells,
      }),
    });
    const config = makeConfig();
    const trial = createProductionAssetTrial(candidate, FINGERPRINT, config);
    const ids = new Set<string>();

    expect(trial.resetPositions).toHaveLength(4);
    expect(trial.spawn).toBe(trial.resetPositions[0]);
    for (const position of trial.resetPositions) {
      ids.add(position.id);
      const insideIsland = position.tile.x >= trial.island.tileX
        && position.tile.x < trial.island.tileX + trial.island.widthTiles
        && position.tile.y >= trial.island.tileY
        && position.tile.y < trial.island.tileY + trial.island.heightTiles;
      expect(insideIsland).toBe(false);
      expect(isShipCenterCollisionFree(
        trial.world,
        position.world.x,
        position.world.y,
        config,
      )).toBe(true);
    }
    expect(ids).toEqual(new Set(["west", "east", "north", "south"]));
  });

  it("rejects non-islands and collision canvases that could borrow unrelated geometry", () => {
    expect(() => createProductionAssetTrial(islandCandidate({
      recipe: Object.freeze({ family: "shoal" }),
    }), FINGERPRINT)).toThrow(/support island candidates/u);

    expect(() => createProductionAssetTrial(islandCandidate({
      candidateLayers: Object.freeze([Object.freeze({
        ...islandCandidate().candidateLayers[0],
        pixelSize: Object.freeze({ width: 480, height: 480 }),
      })]),
    }), FINGERPRINT)).toThrow(/must use the 64x64 collision canvas/u);
  });
});
