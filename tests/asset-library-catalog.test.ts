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
  type ReferenceImageLibraryEntry,
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
    expect(ASSET_LIBRARY_CATALOG).toHaveLength(46);
    expect(ASSET_LIBRARY_CATALOG.filter((entry) => entry.entryType === "authored-package"))
      .toHaveLength(3);

    for (const id of ESTABLISHED_IDS) {
      expect(ASSET_LIBRARY_CATALOG.filter((entry) => entry.id === id), id).toHaveLength(1);
    }

    const referenceEntries = ASSET_LIBRARY_CATALOG.filter(
      (entry): entry is Readonly<ReferenceImageLibraryEntry> => entry.entryType === "reference-image",
    );
    const examples = referenceEntries.filter((entry) =>
      entry.reference.collectionId === "gr1-island-examples");
    expect(examples).toHaveLength(20);
    expect(examples.map((entry) => entry.reference.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(examples.every((entry) => entry.reference.runtimeStatus === "reference-only")).toBe(true);

    const candidates = ASSET_LIBRARY_CATALOG.filter((entry) => entry.entryType === "production-candidate");
    expect(candidates).toHaveLength(6);
    expect(new Set(candidates.map((entry) => entry.id)).size).toBe(6);
    expect(candidates.every((entry) => entry.recipe.lifecycle === "source")).toBe(true);

    const conceptReferences = referenceEntries.filter((entry) =>
      entry.reference.collectionId.startsWith("concept-example-"));
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
        method: "prepared-alpha-connected-shoreline-v1",
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
    if (candidate.collisionDraft.kind !== "hybrid-grid-draft") {
      throw new Error("Expected hybrid-grid collision draft");
    }
    expect(candidate.collisionDraft.solidSubcells.length).toBeGreaterThan(0);
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
    expect(stale.find((entry) => entry.id === prepared.id)).toMatchObject({ reviewState: "stale" });
  });

  it("previews a passable multi-layer shoal candidate from a non-island source path", () => {
    const fingerprint = "a".repeat(64);
    const basePreparation = {
      mode: "connected-border",
      targetWidth: 96,
      targetHeight: 64,
      thumbnailMaximum: 96,
      matteColor: [255, 0, 255],
      innerTolerance: 48,
      outerTolerance: 104,
      trimAlphaThreshold: 8,
      padding: 4,
    } as const;
    const sourceFiles = [
      "assets-src/gr1/shoals/silver-current-source.png",
      "assets-src/gr1/shoals/silver-current-glint-source.png",
    ];
    const recipe = {
      id: "production.shoal.silver-current",
      name: "Silver Current",
      family: "shoal",
      lifecycle: "source",
      collection: "Shoal production sources",
      sortOrder: 1,
      tags: ["shoal", "source"],
      provenance: { kind: "selected-source", sourceFile: sourceFiles[0] },
      layers: [
        {
          id: "base",
          name: "Shoal",
          role: "base",
          sourceFile: sourceFiles[0],
          defaultVisible: true,
          opacity: 1,
          blendMode: "normal",
          preparation: basePreparation,
        },
        {
          id: "glint",
          name: "Glint",
          role: "effect",
          sourceFile: sourceFiles[1],
          defaultVisible: true,
          opacity: 0.7,
          blendMode: "screen",
          preparation: basePreparation,
        },
      ],
      animations: [],
      collision: { mode: "empty", reason: "Fishing shoals are passable" },
      runtimeBinding: { assetId: "shoal.fishing.primary", collisionIntent: "preserve" },
    };
    const layerFiles = ["base", "glint"].map((id) =>
      `assets-src/gr3/candidates/production-shoal-silver-current/${id}.png`);
    const thumbnailFile = "assets-src/gr3/candidates/production-shoal-silver-current/thumbnail.png";
    const collisionDraftFile = "assets-src/gr3/candidates/production-shoal-silver-current/collision-draft.json";
    const catalog = buildAssetLibraryCatalog({}, {
      productionRecipeManifest: { formatVersion: 1, recipes: [recipe] },
      productionIndex: {
        formatVersion: 1,
        pipelineVersion: 1,
        manifestSha256: "b".repeat(64),
        entries: [{
          id: recipe.id,
          family: "shoal",
          lifecycle: "candidate",
          jobKey: fingerprint,
          sourceFiles,
          layers: layerFiles.map((file, index) => ({
            id: index === 0 ? "base" : "glint",
            file,
            width: 96,
            height: 64,
            sha256: "c".repeat(64),
          })),
          thumbnailFile,
          collisionDraftFile,
        }],
      },
      productionReviews: { formatVersion: 1, decisions: [] },
      productionSourceImages: Object.fromEntries(sourceFiles.map((file) => [file, `/${file}`])),
      productionCandidateImages: {
        [layerFiles[0]]: "/candidate/base.png",
        [layerFiles[1]]: "/candidate/glint.png",
        [thumbnailFile]: "/candidate/thumbnail.png",
      },
      productionCollisionDrafts: {
        [collisionDraftFile]: {
          formatVersion: 1,
          recipeId: recipe.id,
          candidateFingerprint: fingerprint,
          kind: "empty",
          passable: true,
          reason: "Fishing shoals are passable",
        },
      },
      conceptIslandImages: {},
      conceptShoalImages: {},
      waterReferenceImages: {},
    });
    const candidate = catalog.find((entry) => entry.id === recipe.id);
    expect(candidate).toMatchObject({
      entryType: "production-candidate",
      categoryId: "world-features",
      collisionDraft: { kind: "empty", passable: true },
    });
    expect(candidate?.layers).toHaveLength(2);
    expect(candidate?.layers.map((layer) => layer.blendMode)).toEqual(["normal", "screen"]);
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
      ["islands", 39],
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
