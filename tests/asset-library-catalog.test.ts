import { describe, expect, it } from "vitest";
import productionIndex from "../assets-src/gr3/generated/production-index.json";
import productionRecipes from "../assets-src/gr3/production-recipes.json";
import { AUTHORED_ASSET_IDS } from "../src/wayfinders/assets/AuthoredAssetContracts";
import {
  ASSET_LIBRARY_CATALOG,
  ASSET_LIBRARY_GROUPS,
  assetLibraryEntryById,
  buildAssetLibraryCatalog,
  conceptIslandReferenceEntry,
  conceptShoalReferenceEntry,
  islandReferenceEntry,
  waterReferenceEntry,
} from "../src/wayfinders/assets/AssetLibraryCatalog";

const ESTABLISHED_IDS = [
  AUTHORED_ASSET_IDS.homeIsland,
  AUTHORED_ASSET_IDS.playerBoat,
  AUTHORED_ASSET_IDS.fishingShoal,
  "reference.island.01.crescent-cay",
  "reference.island.02.fishhook-village",
  "reference.island.03.volcanic-spearhead",
  "reference.island.04.river-delta",
  "reference.island.05.dumbbell-shrine",
  "reference.island.06.star-atoll",
  "reference.island.07.lightning-ridge",
  "reference.island.08.horseshoe-port",
  "reference.island.09.triangle-pastures",
  "reference.island.10.comet-archipelago",
  "reference.island.11.mangrove-hand",
  "reference.island.12.lighthouse-teardrop",
  "reference.island.13.boomerang-oasis",
  "reference.island.14.maze-marsh",
  "reference.island.15.terrace-fortress",
  "reference.island.16.bone-rock",
  "reference.island.17.spiral-outpost",
  "reference.island.18.antler-wilderness",
  "reference.island.19.trident-capital",
  "reference.island.20.rock-shard",
] as const;

describe("asset library catalog", () => {
  it("keeps the established 23 identities and adds production and concept previews once", () => {
    expect(ASSET_LIBRARY_CATALOG).toHaveLength(45);
    expect(ASSET_LIBRARY_CATALOG.filter((entry) => entry.entryType === "authored-package"))
      .toHaveLength(3);

    for (const id of ESTABLISHED_IDS) {
      expect(ASSET_LIBRARY_CATALOG.filter((entry) => entry.id === id), id).toHaveLength(1);
    }

    const examples = ASSET_LIBRARY_CATALOG.filter((entry) =>
      entry.entryType === "reference-image" && entry.reference.collectionId === "gr1-island-examples");
    expect(examples).toHaveLength(20);
    expect(examples.map((entry) => entry.reference.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(examples.every((entry) => entry.reference.runtimeStatus === "reference-only")).toBe(true);

    const candidates = ASSET_LIBRARY_CATALOG.filter((entry) => entry.entryType === "production-candidate");
    expect(candidates).toHaveLength(5);
    expect(new Set(candidates.map((entry) => entry.id)).size).toBe(5);
    expect(candidates.every((entry) => entry.recipe.lifecycle === "source")).toBe(true);

    const conceptReferences = ASSET_LIBRARY_CATALOG.filter((entry) =>
      entry.entryType === "reference-image" && entry.reference.collectionId.startsWith("concept-example-"));
    expect(conceptReferences).toHaveLength(16);
    expect(conceptReferences.filter((entry) => entry.reference.kind === "island")).toHaveLength(12);
    expect(conceptReferences.filter((entry) => entry.reference.kind === "shoal")).toHaveLength(4);
    expect(ASSET_LIBRARY_CATALOG.filter((entry) =>
      entry.entryType === "reference-image" && entry.reference.kind === "environment")).toHaveLength(1);
  });

  it("joins each source recipe to its prepared layers, thumbnail and collision draft", () => {
    const candidate = assetLibraryEntryById("production.island.small-fishing-cay");
    expect(candidate).toMatchObject({
      entryType: "production-candidate",
      lifecycle: "candidate",
      reviewState: "pending",
      categoryId: "islands",
      recipe: {
        id: "production.island.small-fishing-cay",
        lifecycle: "source",
        provenance: { sourceFile: "assets-src/gr1/island-small-fishing-cay-source.png" },
      },
      collisionDraftFile: expect.stringMatching(/collision-draft\.json$/u),
      collisionDraft: {
        kind: "hybrid-grid-draft",
        tileSize: 32,
        subcellSize: 8,
        grid: { width: 15, height: 15, subcellColumns: 60, subcellRows: 60 },
      },
    });
    if (candidate?.entryType !== "production-candidate") throw new Error("Expected production candidate");
    expect(candidate.thumbnailUrl).toMatch(/thumbnail\.png/u);
    expect(candidate.sourceLayers).toEqual([expect.objectContaining({
      id: "source.base",
      url: expect.stringMatching(/island-small-fishing-cay-source\.png/u),
    })]);
    expect(candidate.candidateLayers).toEqual([expect.objectContaining({
      id: "layer.base",
      url: expect.stringMatching(/base\.png/u),
      pixelSize: { width: 480, height: 480 },
    })]);
    expect(candidate.layers).toEqual(candidate.candidateLayers);
    expect(candidate.collisionDraft.solidSubcells).toEqual([]);
    expect(candidate.fingerprint).toBe(
      productionIndex.entries.find((entry) => entry.id === candidate.id)?.jobKey,
    );
  });

  it("shows only a decision for the candidate's current fingerprint", () => {
    const prepared = productionIndex.entries[0];
    const approved = buildAssetLibraryCatalog({}, {
      productionReviews: {
        formatVersion: 1,
        decisions: [{
          recipeId: prepared.id,
          candidateFingerprint: prepared.jobKey,
          decision: "approved",
        }],
      },
    });
    expect(approved.find((entry) => entry.id === prepared.id)).toMatchObject({ reviewState: "approved" });

    const stale = buildAssetLibraryCatalog({}, {
      productionReviews: {
        formatVersion: 1,
        decisions: [{
          recipeId: prepared.id,
          candidateFingerprint: "0".repeat(64),
          decision: "rejected",
        }],
      },
    });
    expect(stale.find((entry) => entry.id === prepared.id)).toMatchObject({ reviewState: "pending" });
  });

  it("derives stable identities and optional reference metadata from filenames", () => {
    const established = islandReferenceEntry(
      "../../../assets-src/gr1/island-examples/island-08-horseshoe-port-inhabited.png",
      "/built/island-08.png",
    );
    expect(established).toMatchObject({
      id: "reference.island.08.horseshoe-port",
      name: "Horseshoe Port",
      categoryId: "islands",
      thumbnailUrl: "/built/island-08.png",
      reference: {
        kind: "island",
        sequence: 8,
        shapeSlug: "horseshoe-port",
        settlement: "inhabited",
      },
    });

    const conceptIsland = conceptIslandReferenceEntry(
      "island_atoll_large_shell_masons_inhabited_01.png",
      "/concept/island.png",
    );
    expect(conceptIsland).toMatchObject({
      id: "reference.concept.island.atoll-large-shell-masons.01",
      reference: { kind: "island", settlement: "inhabited", sequence: 1 },
    });

    const conceptShoal = conceptShoalReferenceEntry("shoal_rich_feeding_ground_01.png", "/concept/shoal.png");
    expect(conceptShoal).toMatchObject({
      id: "reference.concept.shoal.rich-feeding-ground.01",
      categoryId: "world-features",
      reference: { kind: "shoal", sequence: 1 },
    });
    expect(conceptShoal.reference).not.toHaveProperty("settlement");

    const water = waterReferenceEntry("water-contact-sheet.png", "/water.png");
    expect(water).toMatchObject({
      id: "reference.environment.water-contact-sheet",
      categoryId: "world-features",
      reference: { kind: "environment" },
    });
    expect(water.reference).not.toHaveProperty("sequence");
  });

  it("retains complete package metadata alongside normalized layers and thumbnails", () => {
    const home = assetLibraryEntryById(AUTHORED_ASSET_IDS.homeIsland);
    const boat = assetLibraryEntryById(AUTHORED_ASSET_IDS.playerBoat);
    const shoal = assetLibraryEntryById(AUTHORED_ASSET_IDS.fishingShoal);

    expect(home).toMatchObject({
      entryType: "authored-package",
      categoryId: "islands",
      thumbnailUrl: expect.any(String),
      package: {
        runtimeRevision: expect.any(Number),
        metadata: { kind: "home-island", grid: { width: 15, height: 15 } },
      },
    });
    if (home?.entryType !== "authored-package") throw new Error("Expected authored home package");
    expect(home.package.runtimeRevision).toBe(home.package.metadata.runtimeRevision);
    expect(home.layers).toEqual([expect.objectContaining({
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
    expect(first.filter((entry) =>
      entry.entryType === "reference-image" && entry.reference.collectionId === "gr1-island-examples")
      .map((entry) => entry.id)).toEqual([
      "reference.island.01.crescent-cay",
      "reference.island.02.fishhook-village",
      "reference.island.20.rock-shard",
    ]);
    expect(ASSET_LIBRARY_GROUPS.map((group) => [group.id, group.entries.length])).toEqual([
      ["islands", 38],
      ["vessels", 1],
      ["world-features", 6],
    ]);
  });

  it("rejects malformed filenames and duplicate stable IDs", () => {
    expect(() => islandReferenceEntry("island-no-sequence.png", "/bad.png"))
      .toThrow(/filename does not match/u);
    expect(() => conceptIslandReferenceEntry("island_bad.png", "/bad.png"))
      .toThrow(/filename does not match/u);
    expect(() => conceptShoalReferenceEntry("shoal_bad.png", "/bad.png"))
      .toThrow(/filename does not match/u);
    expect(() => buildAssetLibraryCatalog({
      "one/island-01-crescent-cay-uninhabited.png": "/one.png",
      "two/island-01-crescent-cay-uninhabited.png": "/two.png",
    })).toThrow(/Duplicate asset library ID/u);
  });

  it("rejects malformed recipe/index joins and duplicate prepared candidates", () => {
    expect(() => buildAssetLibraryCatalog({}, {
      productionRecipeManifest: { ...productionRecipes, formatVersion: 999 },
    })).toThrow(/formatVersion/u);

    const duplicateIndex = structuredClone(productionIndex);
    duplicateIndex.entries.push(structuredClone(duplicateIndex.entries[0]));
    expect(() => buildAssetLibraryCatalog({}, { productionIndex: duplicateIndex }))
      .toThrow(/Duplicate production index ID/u);

    const orphanedIndex = structuredClone(productionIndex);
    orphanedIndex.entries[0].id = "production.island.not-in-recipes";
    expect(() => buildAssetLibraryCatalog({}, { productionIndex: orphanedIndex }))
      .toThrow(/no source recipe/u);
  });
});
