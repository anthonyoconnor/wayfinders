import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/tidebound/config/prototypeConfig";
import { GameSimulation } from "../src/tidebound/core/GameSimulation";
import type { GeneratedIsland } from "../src/tidebound/world/IslandGenerator";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

function inspectionTile(simulation: GameSimulation, island: GeneratedIsland): { x: number; y: number } {
  for (let y = island.bounds.minY; y <= island.bounds.maxY; y++) {
    for (let x = island.bounds.minX; x <= island.bounds.maxX; x++) {
      if (
        simulation.world.inBounds(x, y)
        && !simulation.world.isMovementBlocked(x, y)
        && simulation.world.getTile(x, y).islandId === island.id
      ) return { x, y };
    }
  }
  throw new Error(`No passable discovery tile for island ${island.id}`);
}

function terrainSignature(simulation: GameSimulation): number[] {
  const signature: number[] = [];
  simulation.world.forEachTile((x, y) => {
    const tile = simulation.world.getTile(x, y);
    signature.push(tile.terrain, tile.islandId, tile.resourceId);
  });
  return signature;
}

function knowledgeSignature(simulation: GameSimulation): number[] {
  const signature: number[] = [];
  for (let index = 0; index < simulation.world.tileCount; index++) {
    signature.push(
      simulation.world.getKnowledgeAtIndex(index),
      simulation.world.getExpeditionStampAtIndex(index),
    );
  }
  return signature;
}

describe("GameSimulation save/load", () => {
  it("round-trips inherited routes, wrecks, generations and discoveries", () => {
    const original = new GameSimulation();
    expect(original.teleport(inspectionTile(original, original.generated.islands[1]))).toBe(true);
    expect(original.teleport(original.generated.landmarks.homeReturnTile)).toBe(true);
    expect(original.returnedDiscoveries).toHaveLength(1);

    expect(original.teleport({ x: 4, y: 4 })).toBe(true);
    expect(original.forceWreck()).toBe(true);
    original.update({ turn: 0, throttle: 0 }, original.config.simulation.wreckPresentationSeconds);
    expect(original.generation).toBe(2);
    expect(original.wrecks).toHaveLength(1);
    expect(original.teleport({ x: 4, y: 4 })).toBe(true);
    expect(original.wrecks[0].discovered).toBe(true);

    expect(original.teleport(inspectionTile(original, original.generated.islands[2]))).toBe(true);
    expect(original.provisionalDiscoveries).toHaveLength(1);
    original.setProvisions(7);
    original.ship.provisionAccumulator = 0.375;
    original.refreshRiskOverlays();
    const originalSnapshot = original.snapshot();
    const originalTerrain = terrainSignature(original);
    const originalKnowledge = knowledgeSignature(original);
    const save = original.createSave();

    expect(save).not.toHaveProperty("forwardRange");
    expect(save).not.toHaveProperty("returnPaths");
    expect(save).not.toHaveProperty("visibility");
    expect(save.terrainPatches).toEqual([]);

    const restored = new GameSimulation();
    restored.restoreSave(save);
    const restoredSnapshot = restored.snapshot();

    expect(restoredSnapshot.ship).toEqual(originalSnapshot.ship);
    expect(restoredSnapshot.knowledge).toEqual(originalSnapshot.knowledge);
    expect(restoredSnapshot.expedition).toEqual(originalSnapshot.expedition);
    expect(restored.wrecks).toEqual(original.wrecks);
    expect(restored.returnedDiscoveries).toEqual(original.returnedDiscoveries);
    expect(restored.provisionalDiscoveries).toEqual(original.provisionalDiscoveries);
    expect(restored.generated.islands).toEqual(original.generated.islands);
    expect(terrainSignature(restored)).toEqual(originalTerrain);
    expect(knowledgeSignature(restored)).toEqual(originalKnowledge);
    expect([...restored.world.getVisibleIndices()].sort((a, b) => a - b)).toEqual(
      [...original.world.getVisibleIndices()].sort((a, b) => a - b),
    );
    expect(restored.forwardRange.presentationCandidateIndices).toEqual(
      original.forwardRange.presentationCandidateIndices,
    );
    expect(restored.forwardRange.presentationMask).toEqual(original.forwardRange.presentationMask);
    expect(restored.returnPaths.pathIndices).toEqual(original.returnPaths.pathIndices);
    expect(restored.returnPaths.corridorIndices).toEqual(original.returnPaths.corridorIndices);
    expect(restored.returnPaths.returnCost).toBe(original.returnPaths.returnCost);

    expect(restored.teleport(restored.generated.landmarks.homeReturnTile)).toBe(true);
    expect(restored.provisionalDiscoveries).toHaveLength(0);
    expect(restored.returnedDiscoveries).toHaveLength(2);
  });

  it("restores an in-progress wreck hold and advances exactly once", () => {
    const original = new GameSimulation();
    expect(original.teleport({ x: 4, y: 4 })).toBe(true);
    expect(original.forceWreck()).toBe(true);
    original.update({ turn: 0, throttle: 0 }, 3.999);
    const save = original.createSave();

    const restored = new GameSimulation();
    restored.restoreSave(save);
    expect(restored.wreckPresentationActive).toBe(true);
    expect(restored.generation).toBe(1);
    expect(restored.respawnSecondsRemaining).toBeCloseTo(0.001, 6);

    restored.update({ turn: 0, throttle: 0 }, 0.001);
    expect(restored.wreckPresentationActive).toBe(false);
    expect(restored.generation).toBe(2);
    expect(restored.atDock).toBe(true);
    restored.update({ turn: 0, throttle: 0 }, 1);
    expect(restored.generation).toBe(2);
  });

  it("rejects corrupt data without mutating the running simulation", () => {
    const simulation = new GameSimulation();
    expect(simulation.teleport({ x: 4, y: 4 })).toBe(true);
    const before = simulation.snapshot();
    const corrupt = structuredClone(simulation.createSave()) as unknown as { schemaVersion: number };
    corrupt.schemaVersion = 99;

    expect(() => simulation.restoreSave(corrupt)).toThrow("Unsupported save schema version 99");
    expect(simulation.snapshot()).toEqual(before);

    const blocked = simulation.createSave();
    const home = simulation.generated.landmarks.homeCenter;
    blocked.ship.currentTileX = home.x;
    blocked.ship.currentTileY = home.y;
    blocked.ship.worldX = (home.x + 0.5) * simulation.config.navigation.tileSize;
    blocked.ship.worldY = (home.y + 0.5) * simulation.config.navigation.tileSize;
    expect(() => simulation.restoreSave(blocked)).toThrow(/blocked/);
    expect(simulation.snapshot()).toEqual(before);
  });
});
