import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPrototypeConfig } from "../src/tidebound/config/prototypeConfig";
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
});
