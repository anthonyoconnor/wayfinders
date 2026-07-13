import type { ShipState } from "../core/types";

export type ShipRenderPose = Pick<ShipState, "worldX" | "worldY" | "heading" | "speed">;

export function interpolateShipPose(
  previous: Readonly<ShipRenderPose>,
  current: Readonly<ShipRenderPose>,
  alpha: number,
): ShipRenderPose {
  const amount = Math.max(0, Math.min(1, alpha));
  const headingDelta = ((current.heading - previous.heading + 540) % 360) - 180;
  return {
    worldX: previous.worldX + (current.worldX - previous.worldX) * amount,
    worldY: previous.worldY + (current.worldY - previous.worldY) * amount,
    heading: previous.heading + headingDelta * amount,
    speed: current.speed,
  };
}
