import { describe, expect, it } from "vitest";
import { ForwardRangeSystem } from "../src/wayfinders/exploration/ForwardRangeSystem";
import { ReturnPathSystem } from "../src/wayfinders/exploration/ReturnPathSystem";
import { SupportedConnectivitySystem } from "../src/wayfinders/exploration/SupportedConnectivitySystem";
import { KnowledgeState, TerrainType } from "../src/wayfinders/world/TileData";
import { WorldGrid } from "../src/wayfinders/world/WorldGrid";
import { WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology";
import { makeConfig, makeShip } from "./helpers";

function wrappingOcean(width: number, height: number, knowledge: KnowledgeState): WorldGrid {
  const world = new WorldGrid(width, height, Math.max(width, height), WRAPPING_WORLD_TOPOLOGY);
  world.fill(TerrainType.DeepOcean, knowledge);
  return world;
}

describe("periodic navigation guidance", () => {
  it("maintains Supported/Personal boundaries and Supported connectivity across a seam", () => {
    const boundaryWorld = wrappingOcean(5, 3, KnowledgeState.Unknown);
    boundaryWorld.setKnowledge(0, 1, KnowledgeState.Supported);
    boundaryWorld.setKnowledge(4, 1, KnowledgeState.Personal, 1);
    expect([...boundaryWorld.getSupportedPersonalBoundaryIndices()]).toEqual([
      boundaryWorld.index(0, 1),
    ]);

    const supportedWorld = wrappingOcean(5, 3, KnowledgeState.Supported);
    const system = new SupportedConnectivitySystem(supportedWorld, { x: 0, y: 1 });
    expect(system.pathTo({ x: 4, y: 1 }, supportedWorld.supportedTopologyVersion)).toEqual([
      supportedWorld.index(0, 1),
      supportedWorld.index(4, 1),
    ]);
  });

  it("clips the forward cone with the minimum-image vector across a seam", () => {
    const world = wrappingOcean(7, 3, KnowledgeState.Unknown);
    const config = makeConfig({
      movement: { shipCollisionHalfExtent: 1 },
      provisions: { unknownCost: 1 },
      overlays: { forwardConeHalfAngleDegrees: 30 },
    });
    const ship = makeShip(1);
    ship.currentTileX = 0;
    ship.currentTileY = 1;
    ship.heading = 180;

    const result = new ForwardRangeSystem(world, config).calculate(ship);

    expect(result.mask[world.index(6, 1)]).toBe(1);
    expect(result.presentationMask[world.index(6, 1)]).toBe(1);
    expect(result.presentationMask[world.index(1, 1)]).toBe(0);
    expect(result.presentationMask[world.index(0, 0)]).toBe(0);
    expect(result.presentationMask[world.index(0, 2)]).toBe(0);
  });

  it("publishes the selected width-two direction and lifted return image", () => {
    const world = wrappingOcean(2, 3, KnowledgeState.Unknown);
    world.setKnowledge(0, 1, KnowledgeState.Supported);
    world.setKnowledge(1, 1, KnowledgeState.Personal, 1);
    const config = makeConfig({ movement: { shipCollisionHalfExtent: 1 } });
    const ship = makeShip(3);
    ship.currentTileX = 1;
    ship.currentTileY = 1;

    const result = new ReturnPathSystem(world, config).calculate(ship);

    expect(result.pathIndices).toEqual([world.index(1, 1), world.index(0, 1)]);
    expect(result.parentDirections[world.index(1, 1)]).toBe(0);
    expect(result.parentImageOffsetX[world.index(1, 1)]).toBe(-2);
    expect(result.pathEdges).toEqual([{
      fromIndex: world.index(1, 1),
      toIndex: world.index(0, 1),
      direction: 1,
      imageOffset: { x: 2, y: 0 },
      destinationImageOffset: { x: 2, y: 0 },
      liftedFrom: { x: 1, y: 1 },
      liftedTo: { x: 2, y: 1 },
    }]);
    expect(result.returnCost).toBe(config.provisions.personalCost);
  });
});
