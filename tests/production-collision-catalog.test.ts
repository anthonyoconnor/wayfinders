import { describe, expect, it } from "vitest";
import {
  availableAuthoredIslandCatalog,
  availableAuthoredIslandPresentationCatalog,
  buildAssetLibraryCatalog,
} from "../src/wayfinders/assets/AssetLibraryCatalog";

describe("GR-3.6 production collision catalog", () => {
  it("keeps the shoreline seed method and warnings with the editable mask", () => {
    const id = "production.island.seeded";
    const fingerprint = "a".repeat(64);
    const sourceFile = "assets-src/gr3/intake/production-island-seeded-source.png";
    const layerFile = "assets-src/gr3/candidates/production-island-seeded/base.png";
    const thumbnailFile = "assets-src/gr3/candidates/production-island-seeded/thumbnail.png";
    const collisionDraftFile = "assets-src/gr3/candidates/production-island-seeded/collision-draft.json";
    const catalog = buildAssetLibraryCatalog({}, {
      productionRecipeManifest: {
        formatVersion: 1,
        recipes: [{
          id,
          name: "Seeded Island",
          family: "island",
          lifecycle: "source",
          collection: "Island production sources",
          sortOrder: 10,
          tags: ["island", "source"],
          provenance: { kind: "selected-source", sourceFile },
          layers: [{
            id: "base",
            name: "Base visual",
            role: "island-composite",
            sourceFile,
            defaultVisible: true,
            opacity: 1,
            blendMode: "normal",
            preparation: {
              mode: "preserve",
              targetWidth: 32,
              targetHeight: 32,
              thumbnailMaximum: 32,
            },
          }],
          animations: [],
          collision: { mode: "shoreline-seed", tileSize: 32, subcellSize: 8 },
          availableInGame: true,
        }],
      },
      productionIndex: {
        formatVersion: 1,
        pipelineVersion: 2,
        manifestSha256: "b".repeat(64),
        entries: [{
          id,
          family: "island",
          lifecycle: "candidate",
          jobKey: fingerprint,
          sourceFiles: [sourceFile],
          layers: [{
            id: "base",
            file: layerFile,
            width: 32,
            height: 32,
            sha256: "c".repeat(64),
          }],
          thumbnailFile,
          collisionDraftFile,
        }],
      },
      productionReviews: { formatVersion: 1, decisions: [] },
      productionSourceImages: { [sourceFile]: "/source.png" },
      productionCandidateImages: {
        [layerFile]: "/base.png",
        [thumbnailFile]: "/thumbnail.png",
      },
      productionCollisionDrafts: {
        [collisionDraftFile]: {
          formatVersion: 1,
          recipeId: id,
          candidateFingerprint: fingerprint,
          kind: "hybrid-grid-draft",
          tileSize: 32,
          subcellSize: 8,
          method: "prepared-alpha-connected-shoreline-v1",
          warnings: ["Review a detached structure."],
          grid: { width: 1, height: 1, subcellColumns: 4, subcellRows: 4 },
          solidSubcells: [{ x: 1, y: 1 }],
        },
      },
      conceptIslandImages: {},
      conceptShoalImages: {},
      waterReferenceImages: {},
    });

    const candidate = catalog.find((entry) => entry.id === id);
    expect(candidate).toMatchObject({
      entryType: "production-candidate",
      collisionDraft: {
        method: "prepared-alpha-connected-shoreline-v1",
        warnings: ["Review a detached structure."],
        solidSubcells: [{ x: 1, y: 1 }],
      },
    });
    expect(candidate?.details.find((section) => section.id === "collision")?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "method", value: "Prepared Alpha Connected Shoreline V1" }),
        expect.objectContaining({ id: "warning-1", value: "Review a detached structure." }),
      ]),
    );
    expect(availableAuthoredIslandCatalog(catalog)).toMatchObject({
      revision: expect.stringMatching(/^catalog-/u),
      islands: [{
        assetId: id,
        name: "Seeded Island",
        revision: fingerprint,
        gridWidth: 1,
        gridHeight: 1,
        solidSubcells: [{ x: 1, y: 1 }],
      }],
    });
    expect(availableAuthoredIslandPresentationCatalog(catalog)).toMatchObject({
      revision: expect.stringMatching(/^catalog-/u),
      islands: [{
        assetId: id,
        gridWidth: 1,
        gridHeight: 1,
        layers: [{
          id: "layer.base",
          plane: "island-composite",
          url: "/base.png",
          textureKey: expect.stringContaining(id),
          pixelWidth: 32,
          pixelHeight: 32,
        }],
      }],
    });
  });
});
