import { describe, expect, it } from "vitest";
import { KnowledgeSystem } from "../src/wayfinders/exploration/KnowledgeSystem.ts";
import { ReturnPathSystem } from "../src/wayfinders/exploration/ReturnPathSystem.ts";
import { traceGridCenters, VisibilitySystem } from "../src/wayfinders/exploration/VisibilitySystem.ts";
import { solidRowsToCollisionMask } from "../src/wayfinders/world/CollisionMask.ts";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData.ts";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid.ts";
import { BOUNDED_WORLD_TOPOLOGY, WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology.ts";
import { makeConfig, makeShip } from "./helpers.ts";

describe("VisibilitySystem and KnowledgeSystem", () => {
it("maintains O(1) world knowledge and visibility counts across indexed updates", () => {
  const world = new WorldGrid(5, 3, 4, BOUNDED_WORLD_TOPOLOGY);
  expect(world.getKnowledgeCount(KnowledgeState.Unknown)).toBe(15);
  expect(world.getKnowledgeCount(KnowledgeState.Personal)).toBe(0);
  expect(world.getKnowledgeCount(KnowledgeState.Supported)).toBe(0);
  expect(world.currentVisibleCount).toBe(0);

  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(0, 0, KnowledgeState.Supported);
  world.setKnowledge(4, 2, KnowledgeState.Personal, 7);
  world.setKnowledge(4, 2, KnowledgeState.Personal, 8);
  expect(world.getKnowledgeCount(KnowledgeState.Unknown)).toBe(13);
  expect(world.getKnowledgeCount(KnowledgeState.Personal)).toBe(1);
  expect(world.getKnowledgeCount(KnowledgeState.Supported)).toBe(1);
  expect(world.getKnowledgeAtIndex(world.index(4, 2))).toBe(KnowledgeState.Personal);

  const firstVisible = world.index(0, 0);
  const secondVisible = world.index(4, 2);
  world.setVisibleNowAtIndex(firstVisible, true);
  world.setVisibleNow(4, 2, true);
  world.setVisibleNowAtIndex(firstVisible, true);
  expect(world.currentVisibleCount).toBe(2);
  expect(world.isVisibleNowAtIndex(secondVisible)).toBe(true);

  world.clearVisibility();
  expect(world.currentVisibleCount).toBe(0);
  expect(world.isVisibleNowAtIndex(firstVisible)).toBe(false);
  expect(world.isVisibleNowAtIndex(secondVisible)).toBe(false);

  world.fill(TerrainType.DeepOcean, KnowledgeState.Supported);
  expect(world.getKnowledgeCount(KnowledgeState.Unknown)).toBe(0);
  expect(world.getKnowledgeCount(KnowledgeState.Personal)).toBe(0);
  expect(world.getKnowledgeCount(KnowledgeState.Supported)).toBe(15);
  expect(world.currentVisibleCount).toBe(0);
});

it("reveals the circular radius and stamps newly observed cells", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(9, 9, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(4, 4, KnowledgeState.Supported);

  const update = new VisibilitySystem(world, config).updateAt({ x: 4, y: 4 });
  expect(update.currentVisibleIndices.length).toBe(13);
  expect(world.isVisibleNow(6, 4)).toBe(true);
  expect(world.isVisibleNow(7, 4)).toBe(false);

  const knowledge = new KnowledgeSystem(world).applyVisibility(update, 17);
  expect(knowledge.changedCount).toBe(12);
  expect(world.getKnowledge(6, 4)).toBe(KnowledgeState.Personal);
  expect(world.getExpeditionStamp(6, 4)).toBe(17);
  expect(world.getKnowledge(4, 4)).toBe(KnowledgeState.Supported);
});

it("reuses observation bookkeeping without mutating prior updates or retaining stale visibility", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(64, 64, 8, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const visibility = new VisibilitySystem(world, config);

  const first = visibility.updateAt({ x: 10, y: 10 });
  const firstObserved = [...first.observedIndices];
  const firstCurrent = [...first.currentVisibleIndices];
  const staleIndex = world.index(8, 10);
  expect(world.isVisibleNowAtIndex(staleIndex)).toBe(true);

  const second = visibility.updateAt({ x: 50, y: 50 });
  expect(first.observedIndices).toEqual(firstObserved);
  expect(first.currentVisibleIndices).toEqual(firstCurrent);
  expect(world.isVisibleNowAtIndex(staleIndex)).toBe(false);
  expect(world.currentVisibleCount).toBe(second.currentVisibleIndices.length);
  expect(second.currentVisibleIndices.every((index) => world.isVisibleNowAtIndex(index))).toBe(true);
  expect(second.observedIndices).toEqual([...second.observedIndices].sort((left, right) => left - right));
});

it("keeps a sight blocker visible while hiding cells behind it", () => {
  const config = makeConfig({ navigation: { sightRadius: 4 } });
  const world = new WorldGrid(9, 9, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setSightBlocked(3, 4, true);

  new VisibilitySystem(world, config).updateAt({ x: 1, y: 4 });
  expect(world.isVisibleNow(3, 4)).toBe(true);
  expect(world.isVisibleNow(4, 4)).toBe(false);
  expect(world.isVisibleNow(5, 4)).toBe(false);
});

it("wraps sight through both axes and returns each canonical tile exactly once", () => {
  const config = makeConfig({ navigation: { sightRadius: 3 } });
  const world = new WorldGrid(3, 3, 3, WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);

  const update = new VisibilitySystem(world, config).updateAt({ x: 0, y: 0 });

  expect(update.currentVisibleIndices).toHaveLength(world.tileCount);
  expect(new Set(update.currentVisibleIndices).size).toBe(world.tileCount);
  expect(update.observedIndices).toEqual([...Array(world.tileCount).keys()]);
  expect(world.isVisibleNow(2, 0)).toBe(true);
  expect(world.isVisibleNow(0, 2)).toBe(true);
  expect(world.isVisibleNow(2, 2)).toBe(true);
});

it("keeps opposite-edge blockers visible while hiding tiles behind them across seams and corners", () => {
  const config = makeConfig({ navigation: { sightRadius: 4 } });
  const world = new WorldGrid(9, 9, 3, WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setSightBlocked(8, 0, true);
  world.setSightBlocked(8, 8, true);

  new VisibilitySystem(world, config).updateAt({ x: 0, y: 0 });

  expect(world.isVisibleNow(8, 0)).toBe(true);
  expect(world.isVisibleNow(7, 0)).toBe(false);
  expect(world.isVisibleNow(8, 8)).toBe(true);
  expect(world.isVisibleNow(7, 7)).toBe(false);
});

it("observes every crossed navigation-tile centre without extending current LOS", () => {
  const config = makeConfig({ navigation: { sightRadius: 1 } });
  const world = new WorldGrid(10, 7, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const visibility = new VisibilitySystem(world, config);

  const update = visibility.updateForLiftedMovement({ x: 1, y: 3 }, { x: 7, y: 3 });
  new KnowledgeSystem(world).applyVisibility(update, 9);

  expect(update.crossedCenters).toEqual([
    { x: 1, y: 3 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 5, y: 3 },
    { x: 6, y: 3 },
    { x: 7, y: 3 },
  ]);
  expect(world.getKnowledge(4, 2)).toBe(KnowledgeState.Personal);
  expect(world.isVisibleNow(4, 2)).toBe(false);
  expect(world.isVisibleNow(7, 2)).toBe(true);
});

it("fills diagonal crossed-centre traversal deterministically", () => {
  expect(traceGridCenters({ x: 1, y: 1 }, { x: 5, y: 3 })).toEqual([
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 5, y: 3 },
  ]);
});

it("preserves explicit lifted seam traversal without observing a world-wide strip", () => {
  const config = makeConfig({ navigation: { sightRadius: 1 } });
  const world = new WorldGrid(10, 5, 5, WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const visibility = new VisibilitySystem(world, config);

  const update = visibility.updateForCrossedCenters([{ x: 9, y: 2 }, { x: 10, y: 2 }]);
  new KnowledgeSystem(world).applyTrailingVisibility(update, 12);

  expect(update.crossedCenters).toEqual([{ x: 9, y: 2 }, { x: 10, y: 2 }]);
  expect(new Set(update.observedIndices).size).toBe(update.observedIndices.length);
  expect(world.getKnowledge(9, 2)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(0, 2)).toBe(KnowledgeState.Unknown);
  expect(world.getKnowledge(5, 2)).toBe(KnowledgeState.Unknown);
  expect(world.isVisibleNow(9, 2)).toBe(true);
  expect(world.isVisibleNow(0, 2)).toBe(true);
  expect(world.isVisibleNow(1, 2)).toBe(true);
});

it("retains explicit width-two direction through both seam images and immediate reversal", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const eastWorld = new WorldGrid(2, 5, 2, WRAPPING_WORLD_TOPOLOGY);
  const westWorld = new WorldGrid(2, 5, 2, WRAPPING_WORLD_TOPOLOGY);
  eastWorld.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  westWorld.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const eastVisibility = new VisibilitySystem(eastWorld, config);
  const westVisibility = new VisibilitySystem(westWorld, config);

  const east = eastVisibility.updateForCrossedCenters([{ x: 0, y: 2 }, { x: 1, y: 3 }]);
  const west = westVisibility.updateForCrossedCenters([{ x: 0, y: 2 }, { x: -1, y: 3 }]);
  new KnowledgeSystem(eastWorld).applyTrailingVisibility(east, 15);
  new KnowledgeSystem(westWorld).applyTrailingVisibility(west, 16);

  expect(east.crossedCenters).toEqual([{ x: 0, y: 2 }, { x: 1, y: 3 }]);
  expect(west.crossedCenters).toEqual([{ x: 0, y: 2 }, { x: -1, y: 3 }]);
  expect(eastWorld.getKnowledge(1, 2)).toBe(KnowledgeState.Personal);
  expect(westWorld.getKnowledge(1, 2)).toBe(KnowledgeState.Personal);
  expect(eastWorld.getKnowledge(1, 3)).toBe(KnowledgeState.Unknown);
  expect(westWorld.getKnowledge(1, 3)).toBe(KnowledgeState.Unknown);

  const reversed = westVisibility.updateForCrossedCenters([{ x: -1, y: 3 }, { x: 0, y: 2 }]);
  expect(reversed.crossedCenters).toEqual([{ x: -1, y: 3 }, { x: 0, y: 2 }]);
});

it("keeps visible water ahead Unknown while committing a broad Personal trail behind", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(10, 9, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(4, 4, KnowledgeState.Supported);
  const visibility = new VisibilitySystem(world, config).updateForLiftedMovement({ x: 4, y: 4 }, { x: 5, y: 4 });

  new KnowledgeSystem(world).applyTrailingVisibility(visibility, 3);

  expect(world.getKnowledge(4, 4)).toBe(KnowledgeState.Supported);
  expect(world.getKnowledge(4, 2)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(5, 4)).toBe(KnowledgeState.Unknown);
  expect(world.getKnowledge(6, 4)).toBe(KnowledgeState.Unknown);
  expect(world.isVisibleNow(6, 4)).toBe(true);
});

it("does not pre-chart untouched water when the ship reverses direction", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(12, 9, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const visibility = new VisibilitySystem(world, config);
  const knowledge = new KnowledgeSystem(world);

  knowledge.applyTrailingVisibility(visibility.updateForLiftedMovement({ x: 4, y: 4 }, { x: 5, y: 4 }), 4);
  knowledge.applyTrailingVisibility(visibility.updateForLiftedMovement({ x: 5, y: 4 }, { x: 4, y: 4 }), 4);

  expect(world.getKnowledge(4, 4)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(5, 4)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(6, 4)).toBe(KnowledgeState.Unknown);
  expect(world.getKnowledge(7, 4)).toBe(KnowledgeState.Unknown);
});

it("remembers a visible blocking landmark ahead without discounting the water around it", () => {
  const config = makeConfig({ navigation: { sightRadius: 3 } });
  const world = new WorldGrid(12, 9, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setTerrain(7, 4, TerrainType.Land);
  const visibility = new VisibilitySystem(world, config).updateForLiftedMovement({ x: 4, y: 4 }, { x: 5, y: 4 });

  new KnowledgeSystem(world).applyTrailingVisibility(visibility, 6);

  expect(world.getKnowledge(7, 4)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(6, 4)).toBe(KnowledgeState.Unknown);
});

it("does not pre-chart a mixed fine-collision cell merely because its coarse terrain is solid", () => {
  const world = new WorldGrid(4, 1, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setTerrain(2, 0, TerrainType.Land);
  world.setFineCollisionMask(2, 0, solidRowsToCollisionMask([
    "1000",
    "0000",
    "0000",
    "0000",
  ]));
  world.setTerrain(3, 0, TerrainType.Land);

  new KnowledgeSystem(world).applyTrailingVisibility({
    observedIndices: [world.index(2, 0), world.index(3, 0)],
    crossedCenters: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  }, 8);

  expect(world.getKnowledge(2, 0)).toBe(KnowledgeState.Unknown);
  expect(world.getKnowledge(3, 0)).toBe(KnowledgeState.Personal);
});

it("keeps diagonal Personal strips cardinally connected to Supported water", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(12, 12, 4, BOUNDED_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(3, 3, KnowledgeState.Supported);
  const visibility = new VisibilitySystem(world, config);
  const knowledge = new KnowledgeSystem(world);
  knowledge.applyTrailingVisibility(visibility.updateForLiftedMovement({ x: 3, y: 3 }, { x: 4, y: 4 }), 5);
  knowledge.applyTrailingVisibility(visibility.updateForLiftedMovement({ x: 4, y: 4 }, { x: 5, y: 5 }), 5);

  expect(world.getKnowledge(4, 4)).toBe(KnowledgeState.Personal);
  const returnPathing = new ReturnPathSystem(world, config);
  const ship = makeShip(6, 0);
  ship.currentTileX = 4;
  ship.currentTileY = 4;
  const result = returnPathing.calculate(ship);
  const path = returnPathing.pathToSupported(result, { x: 4, y: 4 });
  expect(path.length).toBeGreaterThan(1);
  expect(path[path.length - 1]).toEqual({ x: 3, y: 3 });
});
});
