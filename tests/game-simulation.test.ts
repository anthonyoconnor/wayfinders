import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { patchPrototypeConfig, resetPrototypeConfig } from "../src/wayfinders/config/prototypeConfig";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import { KnowledgeState } from "../src/wayfinders/world/TileData";
import { configurePrototypeForTestProfile } from "./helpers";

beforeEach(() => configurePrototypeForTestProfile());
afterEach(() => resetPrototypeConfig());

describe("GameSimulation exploration integration", () => {
  it("creates a broad Personal corridor while retaining a bounded current sight area", () => {
    const simulation = new GameSimulation();
    expect(simulation.snapshot()).not.toHaveProperty("debug");
    const centerY = simulation.generated.landmarks.homeCenter.y;

    let firstUnknownX = simulation.generated.landmarks.dock.x;
    while (
      firstUnknownX < simulation.world.width - 1
      && simulation.world.getKnowledge(firstUnknownX, centerY) === KnowledgeState.Supported
    ) {
      firstUnknownX++;
    }
    expect(simulation.teleport({ x: firstUnknownX - 1, y: centerY })).toBe(true);
    simulation.ship.heading = 0;

    for (let step = 0; step < 75; step++) {
      simulation.update({ turn: 0, throttle: 1 }, 1 / 30);
    }

    const snapshot = simulation.snapshot();
    expect(snapshot.knowledge.personal).toBeGreaterThan(40);
    expect(snapshot.knowledge.unknown).toBeGreaterThan(snapshot.knowledge.personal);
    expect(snapshot.knowledge.visibleNow).toBeLessThanOrEqual(81);

    const trailX = Math.max(firstUnknownX, simulation.ship.currentTileX - 3);
    const trailColumn = [-2, -1, 0, 1, 2]
      .map((offset) => simulation.world.getKnowledge(trailX, centerY + offset));
    expect(trailColumn.every((state) => state === KnowledgeState.Personal)).toBe(true);
  });

  it("presents one forward frontier and one padded return route that clears at the dock", () => {
    const simulation = new GameSimulation(undefined, undefined, {
      forwardGuidanceEnabled: true,
    });
    const centerY = simulation.generated.landmarks.homeCenter.y;
    let firstUnknownX = simulation.generated.landmarks.dock.x;
    while (
      firstUnknownX < simulation.world.width - 1
      && simulation.world.getKnowledge(firstUnknownX, centerY) === KnowledgeState.Supported
    ) firstUnknownX++;
    expect(simulation.teleport({ x: firstUnknownX - 1, y: centerY })).toBe(true);
    simulation.ship.heading = 0;

    for (let step = 0; step < 110; step++) simulation.update({ turn: 0, throttle: 1 }, 1 / 30);

    const outbound = simulation.snapshot();
    const corridorRiskCount = outbound.risk.comfortable
      + outbound.risk.warning
      + outbound.risk.critical
      + outbound.risk.impossible;
    expect(outbound.risk.returnPathTiles).toBeGreaterThan(1);
    expect(outbound.risk.returnCorridorTiles).toBeGreaterThan(0);
    expect(outbound.risk.returnCorridorTiles).toBeLessThan(outbound.knowledge.personal);
    expect(corridorRiskCount).toBe(outbound.risk.returnCorridorTiles);
    expect(outbound.risk.forwardFrontier).toBe(simulation.forwardRange.frontierCount);
    expect(outbound.risk.forwardFrontier).toBeGreaterThan(0);
    expect(outbound.risk.forwardHeading).toBe(simulation.ship.heading);
    expect(outbound.risk.forwardConeHalfAngleDegrees).toBe(60);
    expect(simulation.returnPaths.pathIndices[0]).toBe(
      simulation.world.index(simulation.ship.currentTileX, simulation.ship.currentTileY),
    );
    expect(simulation.world.getKnowledgeAtIndex(
      simulation.returnPaths.pathIndices[simulation.returnPaths.pathIndices.length - 1],
    )).toBe(KnowledgeState.Supported);
    const frontierMinimumCost = simulation.forwardRange.budget - simulation.config.provisions.unknownCost;
    expect(simulation.forwardRange.presentationCandidateIndices).toHaveLength(
      simulation.forwardRange.frontierCount,
    );
    expect(simulation.forwardRange.presentationCandidateIndices.every((index) => (
      simulation.forwardRange.presentationMask[index] === 1
      && simulation.forwardRange.mask[index] === 1
      && simulation.forwardRange.costs[index] > frontierMinimumCost
      && simulation.forwardRange.costs[index] <= simulation.forwardRange.budget
    ))).toBe(true);

    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(true);
    const returned = simulation.snapshot();
    expect(returned.risk.returnPathTiles).toBe(1);
    expect(returned.risk.returnCorridorTiles).toBe(0);
    expect(returned.risk.returnLevel).toBe(0);
  });

  it("rotates the forward presentation while turning in place without recalculating logical reach", () => {
    const simulation = new GameSimulation(undefined, undefined, {
      forwardGuidanceEnabled: true,
    });
    const range = simulation.forwardRange;
    const logicalMask = range.mask.slice();
    const candidates = range.candidateIndices;
    const overlayRevision = simulation.overlaysRevision;
    const tile = simulation.snapshot().tile;

    simulation.update({ turn: 1, throttle: 0 }, 0.25);
    const turned = simulation.snapshot();

    expect(turned.tile).toEqual(tile);
    expect(turned.risk.forwardHeading).toBe(45);
    expect(turned.risk.forwardConeHalfAngleDegrees).toBe(60);
    expect(simulation.forwardRange).toBe(range);
    expect(simulation.forwardRange.mask).toEqual(logicalMask);
    expect(simulation.forwardRange.candidateIndices).toBe(candidates);
    expect(simulation.overlaysRevision).toBeGreaterThan(overlayRevision);
  });

  it("teleports without revealing a connecting line between distant tiles", () => {
    const simulation = new GameSimulation();
    const target = { x: 4, y: 4 };
    const midpoint = { x: Math.floor(simulation.world.width / 4), y: Math.floor(simulation.world.height / 4) };
    expect(simulation.world.getKnowledge(midpoint.x, midpoint.y)).toBe(KnowledgeState.Unknown);

    expect(simulation.teleport(target)).toBe(true);

    expect(simulation.world.getKnowledge(target.x, target.y)).toBe(KnowledgeState.Personal);
    expect(simulation.world.getKnowledge(midpoint.x, midpoint.y)).toBe(KnowledgeState.Unknown);
  });

  it("holds the visible wreck for four seconds before respawning the next generation", () => {
    const simulation = new GameSimulation();
    expect(simulation.teleport({ x: 4, y: 4 })).toBe(true);
    expect(simulation.world.getKnowledge(4, 4)).toBe(KnowledgeState.Personal);
    const lostShip = simulation.ship;
    const world = simulation.world;
    simulation.setProvisions(0);
    expect(simulation.stranded).toBe(true);
    expect(simulation.forceWreck()).toBe(true);

    expect(simulation.world).toBe(world);
    expect(simulation.ship).toBe(lostShip);
    expect(simulation.wreckPresentationActive).toBe(true);
    expect(simulation.respawnSecondsRemaining).toBe(4);
    expect(simulation.pendingWreckId).toBe(1);
    expect(simulation.snapshot().expedition).toMatchObject({
      generation: 1,
      atDock: false,
      wreckPresentationActive: true,
      respawnSecondsRemaining: 4,
      pendingWreckId: 1,
    });
    expect(simulation.generation).toBe(1);
    expect(simulation.failedExpeditions).toBe(1);
    expect(simulation.atDock).toBe(false);
    expect(simulation.ship.provisions).toBe(0);
    expect(simulation.world.isVisibleNow(4, 4)).toBe(true);
    expect(simulation.wrecks).toHaveLength(1);
    expect(simulation.wrecks[0]).toMatchObject({ generation: 1, tileX: 4, tileY: 4 });
    expect(simulation.world.getKnowledge(4, 4)).toBe(KnowledgeState.Unknown);

    const wreckPosition = { x: simulation.ship.worldX, y: simulation.ship.worldY, heading: simulation.ship.heading };
    simulation.update({ turn: 1, throttle: 1 }, 3.999);
    expect(simulation.forceWreck()).toBe(false);
    simulation.addProvisions(5);
    simulation.refreshVisibility();
    expect(simulation.teleport(simulation.generated.landmarks.homeReturnTile)).toBe(false);
    expect(simulation.ship).toBe(lostShip);
    expect({ x: simulation.ship.worldX, y: simulation.ship.worldY, heading: simulation.ship.heading }).toEqual(
      wreckPosition,
    );
    expect(simulation.ship.provisions).toBe(0);
    expect(simulation.wrecks[0].discovered).toBe(false);
    expect(simulation.generation).toBe(1);
    expect(simulation.respawnSecondsRemaining).toBeCloseTo(0.001, 6);

    simulation.update({ turn: 1, throttle: 1 }, 0.001);

    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.respawnSecondsRemaining).toBe(0);
    expect(simulation.pendingWreckId).toBeNull();
    expect(simulation.ship).not.toBe(lostShip);
    expect(simulation.generation).toBe(2);
    expect(simulation.atDock).toBe(true);
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);
    expect(simulation.world.isVisibleNow(4, 4)).toBe(false);
  });

  it("charges the outward Unknown leg at roughly twice the Personal return leg", () => {
    // Keep this ratio-focused scenario independent of the lower gameplay defaults.
    patchPrototypeConfig({
      world: { width: 96, height: 96 },
      provisions: { personalCost: 0.5, unknownCost: 1 },
    });
    const simulation = new GameSimulation();
    const startingCapacity = simulation.ship.provisions - simulation.ship.provisionAccumulator;
    const outwardTargetX = simulation.ship.currentTileX + 15;

    for (let step = 0; step < 600 && simulation.ship.currentTileX < outwardTargetX; step++) {
      simulation.update({ turn: 0, throttle: 1 }, 1 / 30);
    }
    expect(simulation.ship.currentTileX).toBe(outwardTargetX);
    const capacityAtTurn = simulation.ship.provisions - simulation.ship.provisionAccumulator;
    const outwardCost = startingCapacity - capacityAtTurn;
    expect(outwardCost).toBeGreaterThanOrEqual(4);

    simulation.ship.heading = 180;
    for (let step = 0; step < 600 && simulation.world.getKnowledge(
      simulation.ship.currentTileX,
      simulation.ship.currentTileY,
    ) !== KnowledgeState.Supported; step++) {
      simulation.update({ turn: 0, throttle: 1 }, 1 / 30);
    }

    expect(simulation.world.getKnowledge(simulation.ship.currentTileX, simulation.ship.currentTileY)).toBe(
      KnowledgeState.Supported,
    );
    const capacityAfterReturn = simulation.ship.provisions - simulation.ship.provisionAccumulator;
    const returnCost = capacityAtTurn - capacityAfterReturn;
    expect(returnCost).toBeGreaterThan(0);
    expect(returnCost).toBeLessThan(outwardCost * 0.7);
  });

  it("honours a live non-zero Supported cost when cargo is empty away from the dock", () => {
    patchPrototypeConfig({ provisions: { supportedCost: 1 } });
    const simulation = new GameSimulation();
    const dock = simulation.generated.landmarks.dock;
    expect(simulation.teleport({ x: dock.x + 1, y: dock.y })).toBe(true);
    simulation.setProvisions(0);
    const before = { x: simulation.ship.worldX, y: simulation.ship.worldY };
    simulation.update({ turn: 0, throttle: 1 }, 0.5);

    expect(simulation.stranded).toBe(true);
    expect(simulation.generation).toBe(1);
    expect(simulation.wrecks).toHaveLength(0);
    expect({ x: simulation.ship.worldX, y: simulation.ship.worldY }).toEqual(before);
  });
});
