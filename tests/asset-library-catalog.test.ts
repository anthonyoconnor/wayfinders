import { describe, expect, it } from "vitest";
import { AUTHORED_ASSET_IDS } from "../src/wayfinders/assets/AuthoredAssetContracts";
import {
  ASSET_LIBRARY_CATALOG,
  ASSET_LIBRARY_GROUPS,
  assetLibraryEntryById,
  buildAssetLibraryCatalog,
  islandReferenceEntry,
} from "../src/wayfinders/assets/AssetLibraryCatalog";

describe("asset library catalog", () => {
  it("combines every authored package with all 20 island reference images", () => {
    expect(ASSET_LIBRARY_CATALOG).toHaveLength(23);
    expect(ASSET_LIBRARY_CATALOG.filter((entry) => entry.entryType === "authored-package"))
      .toHaveLength(3);

    const examples = ASSET_LIBRARY_CATALOG.filter((entry) => entry.entryType === "reference-image");
    expect(examples).toHaveLength(20);
    expect(examples.map((entry) => entry.reference.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(examples.every((entry) => entry.reference.runtimeStatus === "reference-only")).toBe(true);
  });

  it("derives stable reference identity and searchable details from the filename", () => {
    const entry = islandReferenceEntry(
      "../../../assets-src/gr1/island-examples/island-08-horseshoe-port-inhabited.png",
      "/built/island-08.png",
    );

    expect(entry).toMatchObject({
      id: "reference.island.08.horseshoe-port",
      name: "Horseshoe Port",
      subtitle: "Inhabited island example",
      categoryId: "islands",
      collection: "Island examples",
      reference: {
        sequence: 8,
        shapeSlug: "horseshoe-port",
        settlement: "inhabited",
        runtimeStatus: "reference-only",
      },
    });
    expect(entry.tags).toEqual(expect.arrayContaining(["island", "reference", "inhabited", "horseshoe"]));
    expect(entry.layers).toEqual([expect.objectContaining({
      role: "reference",
      url: "/built/island-08.png",
    })]);
    expect(entry).not.toHaveProperty("package");
  });

  it("retains complete package metadata alongside normalized layers and animations", () => {
    const home = assetLibraryEntryById(AUTHORED_ASSET_IDS.homeIsland);
    const boat = assetLibraryEntryById(AUTHORED_ASSET_IDS.playerBoat);
    const shoal = assetLibraryEntryById(AUTHORED_ASSET_IDS.fishingShoal);

    expect(home).toMatchObject({
      entryType: "authored-package",
      categoryId: "islands",
      package: {
        runtimeRevision: expect.any(Number),
        metadata: { kind: "home-island", grid: { width: 15, height: 15 } },
      },
    });
    if (home?.entryType !== "authored-package") throw new Error("Expected authored home package");
    expect(home.package.runtimeRevision).toBe(home.package.metadata.runtimeRevision);
    expect(home?.layers).toEqual([expect.objectContaining({
      imageId: "home.island.primary.complete",
      pixelSize: { width: 480, height: 480 },
    })]);

    expect(boat).toMatchObject({
      entryType: "authored-package",
      package: { metadata: { kind: "player-boat" } },
    });
    expect(boat?.layers.map((layer) => layer.role)).toEqual(["base", "effect"]);
    expect(boat?.animations.map((animation) => animation.id)).toEqual([
      "animation.movement",
      "animation.wake",
    ]);

    expect(shoal).toMatchObject({
      entryType: "authored-package",
      categoryId: "world-features",
      package: { metadata: { kind: "fishing-shoal" } },
    });
  });

  it("sorts and groups deterministically regardless of glob enumeration order", () => {
    const examples = {
      "island-20-rock-shard-uninhabited.png": "/20.png",
      "island-02-fishhook-village-inhabited.png": "/02.png",
      "island-01-crescent-cay-uninhabited.png": "/01.png",
    };
    const first = buildAssetLibraryCatalog(examples);
    const second = buildAssetLibraryCatalog(Object.fromEntries(Object.entries(examples).reverse()));

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first.filter((entry) => entry.entryType === "reference-image").map((entry) => entry.id)).toEqual([
      "reference.island.01.crescent-cay",
      "reference.island.02.fishhook-village",
      "reference.island.20.rock-shard",
    ]);
    expect(ASSET_LIBRARY_GROUPS.map((group) => [group.id, group.entries.length])).toEqual([
      ["islands", 21],
      ["vessels", 1],
      ["world-features", 1],
    ]);
  });

  it("rejects malformed example names and duplicate stable IDs", () => {
    expect(() => islandReferenceEntry("island-no-sequence.png", "/bad.png"))
      .toThrow(/filename does not match/);
    expect(() => buildAssetLibraryCatalog({
      "one/island-01-crescent-cay-uninhabited.png": "/one.png",
      "two/island-01-crescent-cay-uninhabited.png": "/two.png",
    })).toThrow(/Duplicate asset library ID/);
  });
});
