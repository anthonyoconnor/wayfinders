import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import {
  DiscoverySystem,
  DiscoveryType,
  generateDiscoveryDefinitions,
} from "../src/wayfinders/exploration/DiscoverySystem";
import type { GeneratedIsland } from "../src/wayfinders/world/IslandGenerator";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

function inspectionTile(simulation: GameSimulation, island: GeneratedIsland): { x: number; y: number } {
  let result: { x: number; y: number } | undefined;
  let closest = Number.POSITIVE_INFINITY;
  for (let y = island.bounds.minY; y <= island.bounds.maxY; y++) {
    for (let x = island.bounds.minX; x <= island.bounds.maxX; x++) {
      if (!simulation.world.inBounds(x, y) || simulation.world.isMovementBlocked(x, y)) continue;
      if (simulation.world.getTile(x, y).islandId !== island.id) continue;
      const distance = Math.hypot(x - island.center.x, y - island.center.y);
      if (distance >= closest) continue;
      closest = distance;
      result = { x, y };
    }
  }
  if (!result) throw new Error(`No inspection tile for island ${island.id}`);
  return result;
}

describe("deterministic discovery catalog", () => {
  it("creates stable names and content without changing generated islands", () => {
    const firstWorld = new WorldGenerator().generate(13_371);
    const before = firstWorld.islands.map((island) => ({ ...island, center: { ...island.center }, bounds: { ...island.bounds } }));
    const first = generateDiscoveryDefinitions(firstWorld.seed, firstWorld.islands);
    const secondWorld = new WorldGenerator().generate(13_371);
    const second = generateDiscoveryDefinitions(secondWorld.seed, secondWorld.islands);
    const otherWorld = new WorldGenerator().generate(13_372);
    const other = generateDiscoveryDefinitions(otherWorld.seed, otherWorld.islands);

    expect(second).toEqual(first);
    expect(secondWorld.islands).toEqual(before);
    expect(other.map(({ name }) => name)).not.toEqual(first.map(({ name }) => name));
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
    expect(new Set(first.map(({ name }) => name)).size).toBe(first.length);
    expect(first.every(({ rewardId, rewardLabel, detail }) => rewardId && rewardLabel && detail)).toBe(true);
    expect(first.some(({ type, settlementId }) => type === DiscoveryType.Settlement && settlementId)).toBe(true);
    expect(first.some(({ type, resourceId }) => type === DiscoveryType.Resource && resourceId)).toBe(true);
  });

  it("uses current sight rather than a movement observation trail", () => {
    const generated = new WorldGenerator().generate();
    const system = new DiscoverySystem(generated.grid, generated.seed, generated.islands);
    const island = generated.islands[1];
    let revealIndex = -1;
    generated.grid.forEachTile((x, y, index) => {
      if (revealIndex < 0 && generated.grid.getTile(x, y).islandId === island.id) revealIndex = index;
    });
    expect(revealIndex).toBeGreaterThanOrEqual(0);

    expect(system.observeCurrentSight(1, 1, []).found).toHaveLength(0);
    expect(system.observeCurrentSight(1, 1, [revealIndex]).found).toHaveLength(1);
    expect(system.observeCurrentSight(1, 1, [revealIndex]).found).toHaveLength(0);
  });

  it("caches sorted record views and exposes a change revision", () => {
    const generated = new WorldGenerator().generate();
    const system = new DiscoverySystem(generated.grid, generated.seed, generated.islands);
    const islandId = generated.islands[1].id;
    let revealIndex = -1;
    generated.grid.forEachTile((_x, _y, index) => {
      if (revealIndex < 0 && generated.grid.getIslandIdAtIndex(index) === islandId) revealIndex = index;
    });
    expect(revealIndex).toBeGreaterThanOrEqual(0);

    expect(system.recordsRevision).toBe(0);
    expect(system.provisional).toBe(system.provisional);
    expect(system.returned).toBe(system.returned);
    expect(system.allRecords).toBe(system.allRecords);
    expect(system.observeCurrentSight(1, 1, []).found).toHaveLength(0);
    expect(system.recordsRevision).toBe(0);

    expect(system.observeCurrentSight(1, 1, [revealIndex]).found).toHaveLength(1);
    expect(system.recordsRevision).toBe(1);
    const provisional = system.provisional;
    const allProvisional = system.allRecords;
    expect(system.provisional).toBe(provisional);
    expect(system.allRecords).toBe(allProvisional);

    expect(system.commitExpedition(1)).toHaveLength(1);
    expect(system.recordsRevision).toBe(2);
    expect(system.provisional).not.toBe(provisional);
    expect(system.returned).toBe(system.returned);
    expect(system.allRecords).not.toBe(allProvisional);
  });
});

describe("discovery expedition lifecycle", () => {
  it("keeps a sighting provisional until exact-dock return", () => {
    const simulation = new GameSimulation();
    const island = simulation.generated.islands[1];
    expect(simulation.teleport(inspectionTile(simulation, island))).toBe(true);

    expect(simulation.expeditionActive).toBe(true);
    expect(simulation.provisionalDiscoveries).toHaveLength(1);
    expect(simulation.returnedDiscoveries).toHaveLength(0);
    const provisional = simulation.provisionalDiscoveries[0];
    expect(provisional.returned).toBe(false);
    expect(provisional.islandId).toBe(island.id);

    const remoteSupportedIndex = [...simulation.world.getSupportedKnowledgeIndices()]
      .find((index) => {
        const point = simulation.world.pointFromIndex(index);
        return !simulation.world.isMovementBlocked(point.x, point.y)
          && index !== simulation.world.index(
            simulation.generated.landmarks.homeReturnTile.x,
            simulation.generated.landmarks.homeReturnTile.y,
          );
      });
    if (remoteSupportedIndex === undefined) throw new Error("No remote Supported tile");
    expect(simulation.teleport(simulation.world.pointFromIndex(remoteSupportedIndex))).toBe(true);
    expect(simulation.provisionalDiscoveries).toHaveLength(1);
    expect(simulation.returnedDiscoveries).toHaveLength(0);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.provisionalDiscoveries).toHaveLength(0);
    expect(simulation.returnedDiscoveries).toHaveLength(1);
    expect(simulation.returnedDiscoveries[0]).toMatchObject({ id: provisional.id, returned: true });
    expect(simulation.currentNavigator.successfulVoyages[0].discoveryIds).toEqual([provisional.id]);
  });

  it("loses only provisional discoveries on wreck and keeps runtime wrecks separate", () => {
    const simulation = new GameSimulation();
    const firstIsland = simulation.generated.islands[1];
    expect(simulation.teleport(inspectionTile(simulation, firstIsland))).toBe(true);
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    expect(simulation.returnedDiscoveries).toHaveLength(1);

    const secondIsland = simulation.generated.islands[2];
    expect(simulation.teleport(inspectionTile(simulation, secondIsland))).toBe(true);
    expect(simulation.provisionalDiscoveries).toHaveLength(1);
    expect(simulation.forceWreck()).toBe(true);

    expect(simulation.provisionalDiscoveries).toHaveLength(0);
    expect(simulation.returnedDiscoveries).toHaveLength(1);
    expect(simulation.wrecks).toHaveLength(1);
    expect(simulation.wrecks[0].id).toBe(1);
    expect(simulation.returnedDiscoveries[0].type).not.toBeUndefined();
  });
});
