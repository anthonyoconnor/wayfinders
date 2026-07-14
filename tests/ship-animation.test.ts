import { describe, expect, it } from "vitest";
import {
  validateAuthoredAssetMetadata,
  type AuthoredPlayerBoatMetadata,
} from "../src/wayfinders/assets/AuthoredAssetContracts.ts";
import playerBoatPackage from "../src/wayfinders/assets/packages/player-boat.json";
import { resolveShipAnimationState } from "../src/wayfinders/rendering/ShipAnimation.ts";

function boatMetadata(): Readonly<AuthoredPlayerBoatMetadata> {
  const metadata = validateAuthoredAssetMetadata(playerBoatPackage);
  if (metadata.kind !== "player-boat") throw new TypeError("Expected player boat metadata");
  return metadata;
}

const metadata = boatMetadata();

describe("GR-1.4 ship and wake animation", () => {
  it.each([
    [0, 0],
    [45, 45],
    [90, 90],
    [180, 180],
    [270, 270],
    [359, 359],
    [360, 0],
  ])("keeps the east-authored bow correct at heading %d", (heading, expectedRotation) => {
    const state = resolveShipAnimationState(metadata, heading, 80, 0);
    expect(state.boatRotationDegrees).toBe(expectedRotation);
    expect(state.wake.rotationDegrees).toBe(expectedRotation);
  });

  it("rotates the wake and its trailing offset into world space", () => {
    const east = resolveShipAnimationState(metadata, 0, 80, 0);
    expect(east.wake.offsetX).toBeCloseTo(-18);
    expect(east.wake.offsetY).toBeCloseTo(0);

    const south = resolveShipAnimationState(metadata, 90, 80, 0);
    expect(south.wake.offsetX).toBeCloseTo(0);
    expect(south.wake.offsetY).toBeCloseTo(-18);
  });

  it("uses signed speed so a reversing ship trails its wake behind westward travel", () => {
    const reverse = resolveShipAnimationState(metadata, 0, -80, 0);
    expect(reverse.boatRotationDegrees).toBe(0);
    expect(reverse.wake.rotationDegrees).toBe(180);
    expect(reverse.wake.offsetX).toBeCloseTo(18);
    expect(reverse.wake.offsetY).toBeCloseTo(0);
  });

  it("hides the wake at rest and increases its intensity with speed", () => {
    const rest = resolveShipAnimationState(metadata, 135, 0, 0);
    const slow = resolveShipAnimationState(metadata, 135, metadata.wake.minimumSpeedPixelsPerSecond, 0);
    const full = resolveShipAnimationState(metadata, 135, metadata.wake.fullSpeedPixelsPerSecond, 0);

    expect(rest.wake.visible).toBe(false);
    expect(slow.wake.visible).toBe(true);
    expect(full.wake.alpha).toBeGreaterThan(slow.wake.alpha);
    expect(full.wake.scaleX).toBeGreaterThan(slow.wake.scaleX);
    expect(full.wake.scaleY).toBeGreaterThan(slow.wake.scaleY);
  });

  it("animates with restrained metadata-driven pulses", () => {
    const first = resolveShipAnimationState(metadata, 30, 80, 0);
    const later = resolveShipAnimationState(metadata, 30, 80, 125);

    expect(later.boatScale).not.toBe(first.boatScale);
    expect(Math.abs(later.boatScale - metadata.visual.scale)).toBeLessThanOrEqual(0.01);
    expect(later.wake.alpha).not.toBe(first.wake.alpha);
    expect(later.wake.scaleX).not.toBe(first.wake.scaleX);
  });
});
