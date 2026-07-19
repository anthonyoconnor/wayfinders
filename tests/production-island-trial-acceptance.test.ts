import { describe, expect, it } from "vitest";

import {
  ASSET_LIBRARY_CATALOG,
  type ProductionCandidateLibraryEntry,
} from "../src/wayfinders/assets/AssetLibraryCatalog";
import {
  createProductionAssetTrial,
  type ProductionAssetTrial,
  type ProductionAssetTrialBoatPosition,
} from "../src/wayfinders/assets/ProductionAssetTrial";
import {
  firstShipCollisionTime,
  isShipCenterCollisionFree,
} from "../src/wayfinders/navigation/CollisionGeometry";
import { makeConfig } from "./helpers";

const PRODUCTION_ISLANDS = Object.freeze([
  { id: "production.island.tropical.sunweave-lagoon", width: 640, height: 576 },
  { id: "production.island.tropical.mangrove-forks", width: 576, height: 640 },
  { id: "production.island.tropical.moonhook-cay", width: 448, height: 384 },
  { id: "production.island.tropical.three-fin-atoll", width: 512, height: 512 },
  { id: "production.island.desert.saffron-haven", width: 640, height: 512 },
  { id: "production.island.desert.copperwind-port", width: 576, height: 448 },
  { id: "production.island.desert.glass-dune-isle", width: 512, height: 384 },
  { id: "production.island.desert.scorpion-mesa", width: 448, height: 512 },
  { id: "production.island.forest.cedar-crown", width: 640, height: 576 },
  { id: "production.island.forest.mosswater-reach", width: 576, height: 448 },
  { id: "production.island.forest.splitpine-wilds", width: 512, height: 512 },
  { id: "production.island.forest.ferncoil-isle", width: 448, height: 512 },
  { id: "production.island.winter.frostharbor", width: 640, height: 576 },
  { id: "production.island.winter.emberhearth-isle", width: 576, height: 512 },
  { id: "production.island.winter.whitefang-skerry", width: 384, height: 576 },
  { id: "production.island.winter.blueglass-atoll", width: 512, height: 512 },
  { id: "production.island.barren.cinder-crown", width: 576, height: 576 },
  { id: "production.island.barren.ashen-hook", width: 448, height: 512 },
  { id: "production.island.barren.saltbone-flats", width: 640, height: 448 },
  { id: "production.island.barren.blackneedle-isle", width: 512, height: 512 },
] as const);

const RESET_IDS = Object.freeze(["west", "east", "north", "south"] as const);
type ResetId = (typeof RESET_IDS)[number];

function productionIslandCandidate(id: string): Readonly<ProductionCandidateLibraryEntry> {
  const entry = ASSET_LIBRARY_CATALOG.find((candidate) => candidate.id === id);
  if (entry?.entryType !== "production-candidate") {
    throw new Error(`Missing prepared production candidate ${id}`);
  }
  return entry;
}

function isOnApproachSide(
  direction: ResetId,
  x: number,
  y: number,
  trial: Readonly<ProductionAssetTrial>,
): boolean {
  switch (direction) {
    case "west": return x < trial.island.origin.worldX;
    case "east": return x > trial.island.origin.worldX;
    case "north": return y < trial.island.origin.worldY;
    case "south": return y > trial.island.origin.worldY;
  }
}

function isInsideIslandCanvas(
  x: number,
  y: number,
  trial: Readonly<ProductionAssetTrial>,
): boolean {
  return x >= trial.island.topLeftWorldX
    && x <= trial.island.topLeftWorldX + trial.island.pixelWidth
    && y >= trial.island.topLeftWorldY
    && y <= trial.island.topLeftWorldY + trial.island.pixelHeight;
}

function isShorelineApproach(
  x: number,
  y: number,
  direction: ResetId,
  trial: Readonly<ProductionAssetTrial>,
  config: ReturnType<typeof makeConfig>,
): boolean {
  if (!isInsideIslandCanvas(x, y, trial) || !isOnApproachSide(direction, x, y, trial)) return false;

  const reach = config.navigation.tileSize;
  return [
    [x - reach, y],
    [x + reach, y],
    [x, y - reach],
    [x, y + reach],
  ].some(([targetX, targetY]) => firstShipCollisionTime(
    trial.world,
    x,
    y,
    targetX,
    targetY,
    config,
  ) !== undefined);
}

function directionBiasedSteps(direction: ResetId, step: number): readonly (readonly [number, number])[] {
  switch (direction) {
    case "west": return [[step, 0], [0, -step], [0, step], [-step, 0]];
    case "east": return [[-step, 0], [0, -step], [0, step], [step, 0]];
    case "north": return [[0, step], [-step, 0], [step, 0], [0, -step]];
    case "south": return [[0, -step], [-step, 0], [step, 0], [0, step]];
  }
}

function hasReachableShorelineApproach(
  reset: Readonly<ProductionAssetTrialBoatPosition>,
  trial: Readonly<ProductionAssetTrial>,
  config: ReturnType<typeof makeConfig>,
): boolean {
  const step = trial.collisionDraft.subcellSize;
  const halfExtent = config.movement.shipCollisionHalfExtent;
  const maximumX = trial.worldPixelSize.width - halfExtent;
  const maximumY = trial.worldPixelSize.height - halfExtent;
  const queue: Array<Readonly<{ x: number; y: number }>> = [{ ...reset.world }];
  const visited = new Set([`${reset.world.x},${reset.world.y}`]);
  const steps = directionBiasedSteps(reset.id, step);

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (isShorelineApproach(current.x, current.y, reset.id, trial, config)) return true;

    for (const [deltaX, deltaY] of steps) {
      const x = current.x + deltaX;
      const y = current.y + deltaY;
      const key = `${x},${y}`;
      if (
        x < halfExtent
        || x > maximumX
        || y < halfExtent
        || y > maximumY
        || visited.has(key)
      ) continue;
      visited.add(key);
      if (firstShipCollisionTime(trial.world, current.x, current.y, x, y, config) === undefined) {
        queue.push({ x, y });
      }
    }
  }

  return false;
}

// This checks machine-disprovable artifact geometry only; concept fidelity and
// presentation quality remain live sea-trial acceptance work.
describe("production island authored-collision acceptance", () => {
  it("keeps all 20 prepared canvases aligned and approachable from every sea-trial reset", () => {
    const config = makeConfig();
    expect(new Set(PRODUCTION_ISLANDS.map(({ id }) => id)).size).toBe(20);

    for (const expected of PRODUCTION_ISLANDS) {
      const candidate = productionIslandCandidate(expected.id);
      const trial = createProductionAssetTrial(candidate, candidate.fingerprint, config);
      const draft = trial.collisionDraft;
      const label = expected.id;

      expect(candidate.recipe.family, label).toBe("island");
      expect(draft.solidSubcells.length, `${label} collision must contain authored land`).toBeGreaterThan(0);
      expect(draft.grid.width * draft.tileSize, `${label} collision width`).toBe(expected.width);
      expect(draft.grid.height * draft.tileSize, `${label} collision height`).toBe(expected.height);
      expect(trial.island.pixelWidth, `${label} trial width`).toBe(expected.width);
      expect(trial.island.pixelHeight, `${label} trial height`).toBe(expected.height);
      expect(candidate.candidateLayers, `${label} prepared layers`).not.toHaveLength(0);
      for (const layer of candidate.candidateLayers) {
        expect(layer.pixelSize, `${label} ${layer.id} canvas`).toEqual({
          width: expected.width,
          height: expected.height,
        });
      }

      expect(trial.resetPositions.map(({ id }) => id), `${label} reset directions`).toEqual(RESET_IDS);
      expect(trial.spawn, `${label} initial spawn`).toBe(trial.resetPositions[0]);
      for (const reset of trial.resetPositions) {
        expect(isShipCenterCollisionFree(
          trial.world,
          reset.world.x,
          reset.world.y,
          config,
        ), `${label} ${reset.id} reset must not spawn on collision`).toBe(true);
        expect(
          hasReachableShorelineApproach(reset, trial, config),
          `${label} ${reset.id} reset needs a reachable waterborne shoreline approach`,
        ).toBe(true);
      }
    }
  });
});
