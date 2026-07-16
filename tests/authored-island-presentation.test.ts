import { describe, expect, it, vi } from "vitest";
import {
  createAuthoredIslandPresentationRuntime,
  preloadAuthoredIslandPresentations,
  type AuthoredIslandPresentationCatalog,
} from "../src/wayfinders/assets/AuthoredIslandPresentation";

function catalog(): Readonly<AuthoredIslandPresentationCatalog> {
  return {
    revision: "catalog-test",
    islands: [{
      assetId: "production.island.test-cay",
      name: "Test Cay",
      revision: "island-test",
      gridWidth: 2,
      gridHeight: 1,
      layers: [
        { id: "base", url: "/base.png", textureKey: "island.base", pixelWidth: 64, pixelHeight: 32, opacity: 1, blendMode: "normal" },
        { id: "detail", url: "/detail.png", textureKey: "island.detail", pixelWidth: 64, pixelHeight: 32, opacity: 0.8, blendMode: "multiply" },
      ],
    }],
  };
}

describe("GR-4.4 authored island presentation runtime", () => {
  it("preloads each missing layer under its immutable texture key", () => {
    const image = vi.fn();
    const scene = {
      textures: { exists: (key: string) => key === "island.base" },
      load: { image },
    };

    preloadAuthoredIslandPresentations(scene as never, catalog());

    expect(image).toHaveBeenCalledTimes(1);
    expect(image).toHaveBeenCalledWith("island.detail", "/detail.png");
  });

  it("exposes only complete islands and reports one coherent fallback", () => {
    const incompleteScene = {
      textures: { exists: (key: string) => key === "island.base" },
    };
    const incomplete = createAuthoredIslandPresentationRuntime(incompleteScene as never, catalog());
    expect(incomplete.revision).toBe("catalog-test");
    expect(incomplete.entry("production.island.test-cay")).toBeUndefined();
    expect(incomplete.diagnostics).toEqual([{
      assetId: "production.island.test-cay",
      message: "texture island.detail did not load",
    }]);

    const completeScene = { textures: { exists: () => true } };
    const complete = createAuthoredIslandPresentationRuntime(completeScene as never, catalog());
    expect(complete.entry("production.island.test-cay")).toMatchObject({ gridWidth: 2, gridHeight: 1 });
    expect(complete.diagnostics).toEqual([]);
  });
});
