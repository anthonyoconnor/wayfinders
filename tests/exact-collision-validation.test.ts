import { describe, expect, it } from "vitest";
import homeIslandPackage from "../src/wayfinders/assets/packages/home-island.json";
import playerBoatPackage from "../src/wayfinders/assets/packages/player-boat.json";
import {
  validateExactAuthoredAssetMetadata,
  validateExactCollisionPackageSet,
  validateExactHomeIslandCollision,
} from "../src/wayfinders/assets/ExactCollisionValidation";
import { validateAuthoredAssetMetadata } from "../src/wayfinders/assets/AuthoredAssetContracts";
import { validateAuthoredHomeIslandCollision } from "../src/wayfinders/assets/AuthoredHomeIsland";
import { makeConfig } from "./helpers";

function dockCornerCollision() {
  const metadata = structuredClone(homeIslandPackage);
  metadata.collision = {
    kind: "hybrid-grid",
    subcellSize: 8,
    mixedCells: [{
      ...metadata.anchors.dock,
      solidRows: ["1000", "0000", "0000", "0000"],
    }],
  };
  return metadata;
}

function resultOf(action: () => unknown): string {
  try {
    action();
    return "accepted";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("GR-2.5 exact collision candidate validation", () => {
  it("accepts the current home collision with the runtime sweep geometry", () => {
    const metadata = validateAuthoredAssetMetadata(homeIslandPackage);
    if (metadata.kind !== "home-island") throw new TypeError("Expected home-island fixture");
    expect(validateExactHomeIslandCollision(metadata)).toBe(metadata);
    expect(validateExactAuthoredAssetMetadata(metadata)).toStrictEqual(metadata);
  });

  it("rejects a clear anchor whose exact navigation edges cannot escape the asset", () => {
    const metadata = structuredClone(homeIslandPackage);
    const enclosingCells = [
      [10, 7], [13, 7],
      [11, 6], [12, 6],
      [11, 8], [12, 8],
    ];
    metadata.collision = {
      kind: "hybrid-grid",
      subcellSize: 8,
      mixedCells: enclosingCells.map(([x, y]) => ({
        x,
        y,
        solidRows: ["1111", "1111", "1111", "1110"],
      })),
    };
    expect(() => validateExactAuthoredAssetMetadata(metadata))
      .toThrow(/dock has no ship-clearance-safe path/);
  });

  it("rejects a solid subcell inside the required dock hull", () => {
    const metadata = dockCornerCollision();
    expect(() => validateExactAuthoredAssetMetadata(metadata))
      .toThrow(/anchors\.dock lacks ship clearance/);
  });

  it("matches the real WorldGrid and GridGraph validator across hull sizes", () => {
    const fixtures = [homeIslandPackage, dockCornerCollision()];
    for (const input of fixtures) {
      const metadata = validateAuthoredAssetMetadata(input);
      if (metadata.kind !== "home-island") throw new TypeError("Expected home-island fixture");
      for (const shipHalfExtent of [7, 14]) {
        const config = makeConfig({ movement: { shipCollisionHalfExtent: shipHalfExtent } });
        expect(resultOf(() => validateExactHomeIslandCollision(metadata, { shipHalfExtent })))
          .toBe(resultOf(() => validateAuthoredHomeIslandCollision(metadata, config)));
      }
    }
  });

  it("revalidates accepted home clearance against a proposed authored player hull", () => {
    const homeIsland = dockCornerCollision();
    const smallerPlayer = structuredClone(playerBoatPackage);
    smallerPlayer.collision.halfSize.width = 7;
    smallerPlayer.collision.halfSize.height = 7;

    expect(() => validateExactCollisionPackageSet({ homeIsland, playerBoat: smallerPlayer }))
      .not.toThrow();
    expect(() => validateExactCollisionPackageSet({ homeIsland, playerBoat: playerBoatPackage }))
      .toThrow(/anchors\.dock lacks ship clearance/);
  });
});
