import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { patchPrototypeConfig, resetPrototypeConfig } from "../src/tidebound/config/prototypeConfig";
import { GameSimulation } from "../src/tidebound/core/GameSimulation";
import { KnowledgeState } from "../src/tidebound/world/TileData";

beforeEach(() => resetPrototypeConfig());
afterEach(() => resetPrototypeConfig());

describe("GameSimulation exploration integration", () => {
  it("creates a broad Personal corridor while retaining a bounded current sight area", () => {
    const simulation = new GameSimulation();
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

  it("teleports without revealing a connecting line between distant tiles", () => {
    const simulation = new GameSimulation();
    const target = { x: 4, y: 4 };
    const midpoint = { x: Math.floor(simulation.world.width / 4), y: Math.floor(simulation.world.height / 4) };
    expect(simulation.world.getKnowledge(midpoint.x, midpoint.y)).toBe(KnowledgeState.Unknown);

    expect(simulation.teleport(target)).toBe(true);

    expect(simulation.world.getKnowledge(target.x, target.y)).toBe(KnowledgeState.Personal);
    expect(simulation.world.getKnowledge(midpoint.x, midpoint.y)).toBe(KnowledgeState.Unknown);
  });

  it("wrecks an out-of-provisions ship and respawns the next generation at the dock", () => {
    const simulation = new GameSimulation();
    expect(simulation.teleport({ x: 4, y: 4 })).toBe(true);
    expect(simulation.world.getKnowledge(4, 4)).toBe(KnowledgeState.Personal);
    const lostShip = simulation.ship;
    const world = simulation.world;
    simulation.setProvisions(0);
    expect(simulation.stranded).toBe(true);
    expect(simulation.forceWreck()).toBe(true);

    expect(simulation.world).toBe(world);
    expect(simulation.ship).not.toBe(lostShip);
    expect(simulation.generation).toBe(2);
    expect(simulation.failedExpeditions).toBe(1);
    expect(simulation.atDock).toBe(true);
    expect(simulation.ship.provisions).toBe(simulation.config.provisions.startingBundles);
    expect(simulation.wrecks).toHaveLength(1);
    expect(simulation.wrecks[0]).toMatchObject({ generation: 1, tileX: 4, tileY: 4 });
    expect(simulation.world.getKnowledge(4, 4)).toBe(KnowledgeState.Unknown);
  });

  it("charges the outward Unknown leg at roughly twice the Personal return leg", () => {
    const simulation = new GameSimulation();
    const startingCapacity = simulation.ship.provisions - simulation.ship.provisionAccumulator;

    for (let step = 0; step < 600 && simulation.ship.currentTileX < 68; step++) {
      simulation.update({ turn: 0, throttle: 1 }, 1 / 30);
    }
    expect(simulation.ship.currentTileX).toBe(68);
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
