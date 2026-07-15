import { describe, expect, it } from "vitest";
import { collectDebugEntityBounds } from "../src/wayfinders/rendering/DebugEntityBounds.ts";

describe("developer collision and entity bounds", () => {
  it("collects the live ship, wrecks, shoals, sites, approaches, and home dock", () => {
    const bounds = collectDebugEntityBounds({
      ship: { worldX: 20, worldY: 30 },
      wrecks: [{ worldX: 40, worldY: 50 }],
      fishingShoals: [{ tile: { x: 2, y: 3 } }],
      surveySites: [{ tile: { x: 4, y: 5 }, serviceAnchor: { x: 5, y: 5 } }],
      islandDossiers: [{ canonicalApproach: { x: 6, y: 7 } }],
      homeDock: { x: 8, y: 9 },
    }, 32, 14);

    expect(bounds.map(({ kind }) => kind)).toEqual([
      "player-ship",
      "wreck",
      "fishing-shoal",
      "survey-site",
      "survey-service",
      "island-approach",
      "home-dock",
    ]);
    expect(bounds[0]).toMatchObject({
      role: "ship-collider",
      centerX: 20,
      centerY: 30,
      halfWidth: 14,
      halfHeight: 14,
    });
    expect(bounds[2]).toMatchObject({
      role: "item",
      centerX: 80,
      centerY: 112,
      halfWidth: 16,
      halfHeight: 16,
    });
    expect(bounds[4]).toMatchObject({
      role: "service",
      centerX: 176,
      centerY: 176,
      halfWidth: 9.6,
      halfHeight: 9.6,
    });
    expect(Object.isFrozen(bounds)).toBe(true);
    expect(bounds.every(Object.isFrozen)).toBe(true);
  });
});
