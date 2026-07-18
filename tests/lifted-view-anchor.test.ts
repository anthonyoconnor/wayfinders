import { describe, expect, it } from "vitest";

import type { MovementResult } from "../src/wayfinders/core/types";
import { LiftedViewAnchor } from "../src/wayfinders/rendering/LiftedViewAnchor";
import { WorldTopology, WRAPPING_WORLD_TOPOLOGY } from "../src/wayfinders/world/WorldTopology";

const topology = new WorldTopology(4, 3, 10, 3, WRAPPING_WORLD_TOPOLOGY);

function movement(
  dx: number,
  dy: number,
  imageOffsetX = 0,
  imageOffsetY = 0,
): MovementResult {
  return {
    movedDistancePixels: Math.hypot(dx, dy),
    liftedDisplacement: { x: dx, y: dy },
    worldImageOffset: { x: imageOffsetX, y: imageOffsetY },
    collided: false,
    enteredTiles: [],
    segments: [],
    tileChanged: dx !== 0 || dy !== 0,
  };
}

describe("LiftedViewAnchor", () => {
  it("consumes accepted seam and corner offsets without inferring a canonical jump", () => {
    const anchor = new LiftedViewAnchor(topology, { x: 38, y: 28 });

    expect(anchor.advance({ x: 3, y: 4 }, movement(5, 6, 40, 30))).toEqual({ x: 43, y: 34 });
    expect(anchor.advance({ x: 7, y: 8 }, movement(4, 4))).toEqual({ x: 47, y: 38 });
  });

  it("keeps immediate reverse travel in the same short lifted image", () => {
    const anchor = new LiftedViewAnchor(topology, { x: 2, y: 15 });

    expect(anchor.advance({ x: 38, y: 15 }, movement(-4, 0, -40, 0))).toEqual({ x: -2, y: 15 });
    expect(anchor.advance({ x: 2, y: 15 }, movement(4, 0, 40, 0))).toEqual({ x: 2, y: 15 });
  });

  it("places explicit relocation targets in the nearest requested image", () => {
    const anchor = new LiftedViewAnchor(topology, { x: 38, y: 15 });

    expect(anchor.relocate({ x: 2, y: 15 })).toEqual({ x: 42, y: 15 });
    expect(anchor.relocate({ x: 38, y: 15 }, { x: -3, y: 15 })).toEqual({ x: -2, y: 15 });
  });

  it("rebases whole spans after repeated laps and reports the camera shift", () => {
    const anchor = new LiftedViewAnchor(topology, { x: 3, y: 4 });
    anchor.relocate({ x: 3, y: 4 }, { x: 203, y: -146 });

    expect(anchor.point).toEqual({ x: 203, y: -146 });
    expect(anchor.rebaseIfNeeded(4)).toEqual({ x: 200, y: -150 });
    expect(anchor.point).toEqual({ x: 3, y: 4 });
    expect(topology.normalizeWorld(anchor.point.x, anchor.point.y)).toEqual({ x: 3, y: 4 });
  });

  it("rejects noncanonical authoritative poses and invalid rebase limits", () => {
    expect(() => new LiftedViewAnchor(topology, { x: 40, y: 0 })).toThrow(/outside the world/);
    const anchor = new LiftedViewAnchor(topology, { x: 0, y: 0 });
    expect(() => anchor.rebaseIfNeeded(0)).toThrow(/positive safe integer/);
  });
});
