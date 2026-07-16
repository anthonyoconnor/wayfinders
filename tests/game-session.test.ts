import { describe, expect, it } from "vitest";
import { GameSession } from "../src/wayfinders/app/GameSession";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph";
import { TestSessionBuilder } from "./support/TestSessionBuilder";

function destinationOutsideHomeChunk(session: GameSession) {
  const simulation = session.compatibilitySimulation;
  const graph = new GridGraph(simulation.world, simulation.config);
  const homeChunkX = Math.floor(simulation.ship.currentTileX / simulation.world.chunkSize);
  const homeChunkY = Math.floor(simulation.ship.currentTileY / simulation.world.chunkSize);
  for (let index = 0; index < simulation.world.tileCount; index++) {
    const tile = simulation.world.pointFromIndex(index);
    if (
      Math.floor(tile.x / simulation.world.chunkSize) === homeChunkX
      && Math.floor(tile.y / simulation.world.chunkSize) === homeChunkY
    ) continue;
    if (graph.isNavigationNodePassable(index)) return tile;
  }
  throw new Error("No passable destination outside the home chunk");
}

describe("GameSession command boundary", () => {
  it("owns immutable configuration while keeping the compatibility runtime detached", () => {
    const definition = new TestSessionBuilder().withSeed(31_337).build();
    const session = new GameSession(definition);

    expect(session.config).toBe(definition.config);
    expect(Object.isFrozen(session.config)).toBe(true);
    expect(session.compatibilitySimulation.config).not.toBe(session.config);
    expect(session.compatibilitySimulation.config.world).not.toBe(session.config.world);

    session.compatibilitySimulation.config.world.seed = 99;
    expect(session.config.world.seed).toBe(31_337);
  });

  it("returns typed revision and chunk invalidation from commands", () => {
    const session = new GameSession(new TestSessionBuilder().withSeed(31_338).build());
    const destination = destinationOutsideHomeChunk(session);
    const before = session.read();

    const result = session.teleport(destination);
    expect(result.value).toBe(true);
    expect(result.mutation.command).toBe("teleport");
    expect(result.mutation.shipTile).toEqual({
      from: before.snapshot.tile,
      to: destination,
    });
    expect(result.mutation.changed.simulation).toBe(true);
    expect(result.mutation.changed.knowledge).toBe(true);
    expect(result.mutation.changedChunkKeys.length).toBe(2);
    expect(result.mutation.changedEntities).toEqual([]);

    const after = session.read();
    expect(after.snapshot.tile).toEqual(destination);
    expect(after.revisions.simulation).toBe(result.mutation.after.simulation);
  });

  it("reports a no-op command without broad invalidation", () => {
    const session = new GameSession();
    const result = session.advance({ turn: 0, throttle: 0 }, 1 / 30);

    expect(result.value.tileChanged).toBe(false);
    expect(result.mutation.shipTile).toBeUndefined();
    expect(Object.values(result.mutation.changed).every((changed) => !changed)).toBe(true);
    expect(result.mutation.changedChunkKeys).toEqual([]);
  });
});
