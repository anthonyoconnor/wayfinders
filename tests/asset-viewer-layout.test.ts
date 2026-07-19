import { describe, expect, it, vi } from "vitest";
import { AUTHORED_ASSET_IDS } from "../src/wayfinders/assets/AuthoredAssetContracts";
import { PILOT_HOME_ISLAND_METADATA } from "../src/wayfinders/assets/AuthoredHomeIsland";
import { createAuthoredHomeIslandVisual } from "../src/wayfinders/assets/AuthoredAssetPresentation";
import { authoredHomeViewerOrigin } from "../src/wayfinders/assets/AssetViewerLayout";

vi.mock("phaser", () => ({ default: {} }));

class FakeImage {
  displayWidth = 0;
  displayHeight = 0;
  visible = true;

  constructor(public x: number, public y: number) {}

  setOrigin(): this { return this; }
  setDisplaySize(width: number, height: number): this {
    this.displayWidth = width;
    this.displayHeight = height;
    return this;
  }
  setDepth(): this { return this; }
  setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  destroy(): void {}
}

describe("Home asset viewer layout", () => {
  it("aligns a non-unit-scale displayed slice with its collision-grid bounds", () => {
    const metadata = {
      ...PILOT_HOME_ISLAND_METADATA,
      render: {
        plane: PILOT_HOME_ISLAND_METADATA.render.plane,
        pixelSize: { width: 800, height: 700 },
        slices: [{
          ...PILOT_HOME_ISLAND_METADATA.render.slices[0],
          gridBounds: { x: 5, y: 4, width: 10, height: 8 },
          pixelOffset: { x: 40, y: 50 },
          pixelSize: { width: 640, height: 512 },
          scale: 0.5,
        }],
      },
    };
    const image = new FakeImage(0, 0);
    const scene = {
      add: {
        image: vi.fn((x: number, y: number) => {
          image.x = x;
          image.y = y;
          return image;
        }),
      },
    };
    const assets = {
      metadata: (assetId: string) => assetId === AUTHORED_ASSET_IDS.homeIsland
        ? metadata
        : undefined,
      textureKey: () => "home-preview",
    };

    const visual = createAuthoredHomeIslandVisual(scene as never, assets as never);
    expect(visual).toBeDefined();
    if (!visual) throw new Error("Expected a Home visual");

    const center = { x: 1_000, y: 700 };
    const origin = authoredHomeViewerOrigin(metadata, visual.displayBounds, center);
    visual.setPosition(origin.x, origin.y);

    expect(image).toMatchObject({
      x: 760,
      y: 428,
      displayWidth: 320,
      displayHeight: 256,
    });
    expect(image.x).toBe(center.x - 25 * 32 / 2 + 5 * 32);
    expect(image.y).toBe(center.y - 25 * 32 / 2 + 4 * 32);
  });
});
