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

  it("halts an out-of-provisions ship beyond Supported water and resumes after a bundle is added", () => {
    const simulation = new GameSimulation();
    expect(simulation.teleport({ x: 4, y: 4 })).toBe(true);
    expect(simulation.world.getKnowledge(4, 4)).toBe(KnowledgeState.Personal);
    simulation.ship.heading = 0;
    simulation.setProvisions(0);
    const before = { x: simulation.ship.worldX, y: simulation.ship.worldY };

    simulation.update({ turn: 0, throttle: 1 }, 1);
    expect(simulation.stranded).toBe(true);
    expect({ x: simulation.ship.worldX, y: simulation.ship.worldY }).toEqual(before);

    simulation.addProvisions(1);
    simulation.update({ turn: 0, throttle: 1 }, 0.25);
    expect(simulation.stranded).toBe(false);
    expect(simulation.ship.worldX).toBeGreaterThan(before.x);
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

  it("honours a live non-zero Supported cost when cargo is empty", () => {
    patchPrototypeConfig({ provisions: { supportedCost: 1 } });
    const simulation = new GameSimulation();
    simulation.setProvisions(0);
    const before = simulation.ship.worldX;

    simulation.update({ turn: 0, throttle: 1 }, 0.5);

    expect(simulation.stranded).toBe(true);
    expect(simulation.ship.worldX).toBe(before);
  });
});
