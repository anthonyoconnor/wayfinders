import { describe, expect, it } from "vitest";
import { interpolateShipPose } from "../src/wayfinders/rendering/ShipPose";

describe("ship presentation interpolation", () => {
  it("interpolates position and follows the shortest heading across north", () => {
    const pose = interpolateShipPose(
      { worldX: 10, worldY: 20, heading: 350, speed: 2 },
      { worldX: 30, worldY: 40, heading: 10, speed: 4 },
      0.5,
    );

    expect(pose).toEqual({ worldX: 20, worldY: 30, heading: 360, speed: 4 });
  });

  it("clamps interpolation to the fixed-step interval", () => {
    const previous = { worldX: 1, worldY: 2, heading: 45, speed: 0 };
    const current = { worldX: 5, worldY: 6, heading: 90, speed: 3 };

    expect(interpolateShipPose(previous, current, -1).worldX).toBe(1);
    expect(interpolateShipPose(previous, current, 2).worldX).toBe(5);
  });

  it("interpolates the supplied short lifted seam segment", () => {
    const pose = interpolateShipPose(
      { worldX: 3_070, worldY: 64, heading: 0, speed: 3 },
      { worldX: 3_078, worldY: 64, heading: 0, speed: 3 },
      0.5,
    );

    expect(pose.worldX).toBe(3_074);
    expect(pose.worldY).toBe(64);
  });
});
