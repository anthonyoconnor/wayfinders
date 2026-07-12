import { describe, expect, it } from "vitest";
import { KnowledgeSystem } from "../src/tidebound/exploration/KnowledgeSystem.ts";
import { ReturnPathSystem } from "../src/tidebound/exploration/ReturnPathSystem.ts";
import { traceGridCenters, VisibilitySystem } from "../src/tidebound/exploration/VisibilitySystem.ts";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData.ts";
import { WorldGrid } from "../src/tidebound/world/WorldGrid.ts";
import { makeConfig, makeShip } from "./helpers.ts";

describe("VisibilitySystem and KnowledgeSystem", () => {
it("reveals the circular radius and stamps newly observed cells", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(9, 9, 4);
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

it("keeps a sight blocker visible while hiding cells behind it", () => {
  const config = makeConfig({ navigation: { sightRadius: 4 } });
  const world = new WorldGrid(9, 9, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setSightBlocked(3, 4, true);

  new VisibilitySystem(world, config).updateAt({ x: 1, y: 4 });
  expect(world.isVisibleNow(3, 4)).toBe(true);
  expect(world.isVisibleNow(4, 4)).toBe(false);
  expect(world.isVisibleNow(5, 4)).toBe(false);
});

it("observes every crossed navigation-tile centre without extending current LOS", () => {
  const config = makeConfig({ navigation: { sightRadius: 1 } });
  const world = new WorldGrid(10, 7, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const visibility = new VisibilitySystem(world, config);

  const update = visibility.updateForMovement({ x: 1, y: 3 }, { x: 7, y: 3 });
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

it("keeps visible water ahead Unknown while committing a broad Personal trail behind", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(10, 9, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(4, 4, KnowledgeState.Supported);
  const visibility = new VisibilitySystem(world, config).updateForMovement({ x: 4, y: 4 }, { x: 5, y: 4 });

  new KnowledgeSystem(world).applyTrailingVisibility(visibility, 3);

  expect(world.getKnowledge(4, 4)).toBe(KnowledgeState.Supported);
  expect(world.getKnowledge(4, 2)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(5, 4)).toBe(KnowledgeState.Unknown);
  expect(world.getKnowledge(6, 4)).toBe(KnowledgeState.Unknown);
  expect(world.isVisibleNow(6, 4)).toBe(true);
});

it("does not pre-chart untouched water when the ship reverses direction", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(12, 9, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  const visibility = new VisibilitySystem(world, config);
  const knowledge = new KnowledgeSystem(world);

  knowledge.applyTrailingVisibility(visibility.updateForMovement({ x: 4, y: 4 }, { x: 5, y: 4 }), 4);
  knowledge.applyTrailingVisibility(visibility.updateForMovement({ x: 5, y: 4 }, { x: 4, y: 4 }), 4);

  expect(world.getKnowledge(4, 4)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(5, 4)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(6, 4)).toBe(KnowledgeState.Unknown);
  expect(world.getKnowledge(7, 4)).toBe(KnowledgeState.Unknown);
});

it("remembers a visible blocking landmark ahead without discounting the water around it", () => {
  const config = makeConfig({ navigation: { sightRadius: 3 } });
  const world = new WorldGrid(12, 9, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setTerrain(7, 4, TerrainType.Land);
  const visibility = new VisibilitySystem(world, config).updateForMovement({ x: 4, y: 4 }, { x: 5, y: 4 });

  new KnowledgeSystem(world).applyTrailingVisibility(visibility, 6);

  expect(world.getKnowledge(7, 4)).toBe(KnowledgeState.Personal);
  expect(world.getKnowledge(6, 4)).toBe(KnowledgeState.Unknown);
});

it("keeps diagonal Personal strips cardinally connected to Supported water", () => {
  const config = makeConfig({ navigation: { sightRadius: 2 } });
  const world = new WorldGrid(12, 12, 4);
  world.fill(TerrainType.DeepOcean, KnowledgeState.Unknown);
  world.setKnowledge(3, 3, KnowledgeState.Supported);
  const visibility = new VisibilitySystem(world, config);
  const knowledge = new KnowledgeSystem(world);
  knowledge.applyTrailingVisibility(visibility.updateForMovement({ x: 3, y: 3 }, { x: 4, y: 4 }), 5);
  knowledge.applyTrailingVisibility(visibility.updateForMovement({ x: 4, y: 4 }, { x: 5, y: 5 }), 5);

  expect(world.getKnowledge(4, 4)).toBe(KnowledgeState.Personal);
  const returnPathing = new ReturnPathSystem(world, config);
  const result = returnPathing.calculate(makeShip(6, 0));
  const path = returnPathing.pathToSupported(result, { x: 4, y: 4 });
  expect(path.length).toBeGreaterThan(1);
  expect(path[path.length - 1]).toEqual({ x: 3, y: 3 });
});
});
