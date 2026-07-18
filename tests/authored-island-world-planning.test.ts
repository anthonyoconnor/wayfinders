import { describe, expect, it } from "vitest";

import {
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalogEntry,
} from "../src/wayfinders/world/AuthoredIslandCatalog";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { serializeWorldManifestV2 } from "../src/wayfinders/world/manifest";
import { TerrainType } from "../src/wayfinders/world/TileData";
import { createWorldProfileConfig } from "./fixtures/worldProfiles";

function entry(index: number): Readonly<AuthoredIslandCatalogEntry> {
  return {
    assetId: `production.island.test-${index.toString().padStart(2, "0")}`,
    name: `Test Island ${index}`,
    revision: `revision-${index}`,
    gridWidth: 2,
    gridHeight: 2,
    solidSubcells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 4, y: 4 },
    ],
  };
}

function catalog(entries: readonly Readonly<AuthoredIslandCatalogEntry>[]) {
  return validateAuthoredIslandCatalog({ revision: "catalog-test", islands: entries });
}

function sparseEntry(): Readonly<AuthoredIslandCatalogEntry> {
  return {
    assetId: "production.island.sparse-silhouette",
    name: "Sparse Silhouette",
    revision: "revision-sparse",
    gridWidth: 7,
    gridHeight: 7,
    solidSubcells: [{ x: 0, y: 12 }, { x: 12, y: 12 }],
  };
}

describe("GR-4.3 authored-island world planning", () => {
  it("uses each available authored island once and fills only the shortfall procedurally", () => {
    const config = createWorldProfileConfig("P0");
    const generated = new WorldGenerator(config, catalog([entry(3), entry(1), entry(2)])).generate(84_221);
    const authored = generated.manifest.islands.filter(({ sourceKind }) => sourceKind === "authored");
    const procedural = generated.manifest.islands.filter(({ sourceKind }) => sourceKind === "procedural");

    expect(generated.manifest.islands).toHaveLength(config.islands.count);
    expect(authored.map(({ authoredAssetId }) => authoredAssetId)).toEqual([
      "production.island.test-01",
      "production.island.test-02",
      "production.island.test-03",
    ]);
    expect(new Set(authored.map(({ authoredAssetId }) => authoredAssetId)).size).toBe(authored.length);
    expect(procedural).toHaveLength(config.islands.count - authored.length);
  });

  it("is independent of catalog traversal order and chooses a deterministic subset without replacement", () => {
    const config = createWorldProfileConfig("P0");
    const entries = Array.from({ length: config.islands.count + 4 }, (_, index) => entry(index + 1));
    const first = new WorldGenerator(config, catalog(entries)).plan(13_371);
    const reordered = new WorldGenerator(config, catalog([...entries].reverse())).plan(13_371);
    const selected = first.manifest.islands.map(({ authoredAssetId }) => authoredAssetId);

    expect(first.manifest.islands.every(({ sourceKind }) => sourceKind === "authored")).toBe(true);
    expect(new Set(selected).size).toBe(config.islands.count);
    expect(serializeWorldManifestV2(reordered.manifest)).toBe(serializeWorldManifestV2(first.manifest));
  });

  it("rasterizes the saved 32/8 mask as authoritative collision", () => {
    const config = createWorldProfileConfig("P0");
    const generated = new WorldGenerator(config, catalog([entry(1)])).generate(7_003);
    const island = generated.islands.find(({ authoredAssetId }) => authoredAssetId === entry(1).assetId);
    if (!island) throw new Error("Expected the authored island in the generated world");

    expect(generated.grid.getFineCollisionMask(island.bounds.minX, island.bounds.minY)).toBe(0b0000_0000_0000_0011);
    expect(generated.grid.getFineCollisionMask(island.bounds.minX + 1, island.bounds.minY + 1)).toBe(1);
    expect(generated.grid.getFineCollisionMask(island.bounds.minX + 1, island.bounds.minY)).toBe(0);
  });

  it("leaves distant transparent canvas cells as ocean and grows only a bounded shelf", () => {
    const config = createWorldProfileConfig("P0");
    const authored = sparseEntry();
    const generated = new WorldGenerator(config, catalog([authored])).generate(7_003);
    const island = generated.islands.find(({ authoredAssetId }) => authoredAssetId === authored.assetId);
    if (!island) throw new Error("Expected the sparse authored island in the generated world");

    const solid = { x: island.bounds.minX + 3, y: island.bounds.minY + 3 };
    const shelf = { x: solid.x - 1, y: solid.y };
    const exteriorShelf = { x: island.bounds.minX - 1, y: solid.y };
    const transparentCorner = { x: island.bounds.minX, y: island.bounds.minY };
    expect(generated.grid.getTerrain(solid.x, solid.y)).toBe(TerrainType.Land);
    expect(generated.grid.getIslandId(solid.x, solid.y)).toBe(island.id);
    expect(generated.grid.getTerrain(shelf.x, shelf.y)).toBe(TerrainType.ShallowOcean);
    expect(generated.grid.getIslandId(shelf.x, shelf.y)).toBe(island.id);
    expect(generated.grid.getTerrain(exteriorShelf.x, exteriorShelf.y)).toBe(TerrainType.ShallowOcean);
    expect(generated.grid.getIslandId(exteriorShelf.x, exteriorShelf.y)).toBe(-1);
    expect(generated.grid.getTerrain(transparentCorner.x, transparentCorner.y)).toBe(TerrainType.DeepOcean);
    expect(generated.grid.getIslandId(transparentCorner.x, transparentCorner.y)).toBe(-1);
    expect(generated.grid.getFineCollisionMask(transparentCorner.x, transparentCorner.y)).toBeUndefined();

    const footprintArea = generated.analysis.getIslandIndices(island.id).length;
    expect(footprintArea).toBeGreaterThan(1);
    expect(footprintArea).toBeLessThan(7 * 7);
  });
});
