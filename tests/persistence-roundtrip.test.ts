import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

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
  it("tracks authoritative persistence changes separately from presentation changes", () => {
    const simulation = new GameSimulation();
    const initialSaveRevision = simulation.saveRevision;
    const initialPresentationRevision = simulation.revision;

    simulation.update({ turn: 0, throttle: 1 }, simulation.config.simulation.fixedStepMs / 1_000);
    expect(simulation.saveRevision).toBe(initialSaveRevision + 1);
    // In-tile movement used to be invisible to autosave dirtiness.
    expect(simulation.revision).toBe(initialPresentationRevision);

    const afterMovement = simulation.saveRevision;
    simulation.refreshRiskOverlays();
    simulation.setDebugVisibility("navigationGrid", true);
    expect(simulation.saveRevision).toBe(afterMovement);

    const beforeHeading = simulation.saveRevision;
    simulation.update({ turn: 1, throttle: 0 }, simulation.config.simulation.fixedStepMs / 1_000);
    expect(simulation.saveRevision).toBe(beforeHeading + 1);

    expect(simulation.teleport({ x: 4, y: 4 })).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    const beforeWreckHold = simulation.saveRevision;
    simulation.update({ turn: 0, throttle: 0 }, 0.25);
    expect(simulation.saveRevision).toBe(beforeWreckHold + 1);
  });

  it("caches canonical knowledge by world identity and version without sharing mutable snapshots", () => {
    const simulation = new GameSimulation();
    const chunkRead = vi.spyOn(simulation.world, "getChunk");
    const first = simulation.createSave();
    expect(chunkRead).toHaveBeenCalled();

    chunkRead.mockClear();
    simulation.setProvisions(simulation.ship.provisions - 1);
    chunkRead.mockClear();
    const second = simulation.createSave();
    expect(chunkRead).not.toHaveBeenCalled();
    expect(second.knowledge.runs).not.toBe(first.knowledge.runs);
    expect(second.knowledge.runs[0]).not.toBe(first.knowledge.runs[0]);

    const originalLength = second.knowledge.runs[0][1];
    (first.knowledge.runs[0] as unknown as number[])[1] = originalLength + 100;
    expect(simulation.createSave().knowledge.runs[0][1]).toBe(originalLength);

    const supportedIndex = simulation.world.getSupportedKnowledgeIndices().values().next().value;
    expect(supportedIndex).toBeTypeOf("number");
    simulation.world.setKnowledgeAtIndex(supportedIndex as number, 0, 0);
    chunkRead.mockClear();
    simulation.createSave();
    expect(chunkRead).toHaveBeenCalled();

    simulation.regenerate(simulation.generated.seed + 1);
    const regeneratedRead = vi.spyOn(simulation.world, "getChunk");
    simulation.createSave();
    expect(regeneratedRead).toHaveBeenCalled();
  });

  it("round-trips inherited routes, wrecks, generations and island dossiers", () => {
    const original = new GameSimulation();
    expect(original.teleport(original.islandDossierDefinitions[1].canonicalApproach)).toBe(true);
    expect(original.teleport(original.generated.landmarks.homeReturnTile)).toBe(true);
    expect(original.returnedIslandDossiers).toHaveLength(1);

    expect(original.teleport({ x: 4, y: 4 })).toBe(true);
    expect(original.forceWreck()).toBe(true);
    original.update({ turn: 0, throttle: 0 }, original.config.simulation.wreckPresentationSeconds);
    expect(original.generation).toBe(2);
    expect(original.wrecks).toHaveLength(1);
    expect(original.acknowledgeGenerationHandover()).toBe(true);
    expect(original.teleport({ x: 4, y: 4 })).toBe(true);
    expect(original.wrecks[0].discovered).toBe(true);

    expect(original.teleport(original.islandDossierDefinitions[2].canonicalApproach)).toBe(true);
    expect(original.provisionalIslandDossiers).toHaveLength(1);
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
    expect(restored.returnedIslandDossiers).toEqual(original.returnedIslandDossiers);
    expect(restored.provisionalIslandDossiers).toEqual(original.provisionalIslandDossiers);
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
    expect(restored.provisionalIslandDossiers).toHaveLength(0);
    expect(restored.returnedIslandDossiers).toHaveLength(2);
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
