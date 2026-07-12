import { describe, expect, it } from "vitest";
import { KnowledgeSystem } from "../src/tidebound/exploration/KnowledgeSystem.ts";
import { traceGridCenters, VisibilitySystem } from "../src/tidebound/exploration/VisibilitySystem.ts";
import { KnowledgeState, TerrainType } from "../src/tidebound/world/TileData.ts";
import { WorldGrid } from "../src/tidebound/world/WorldGrid.ts";
import { makeConfig } from "./helpers.ts";

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
});
