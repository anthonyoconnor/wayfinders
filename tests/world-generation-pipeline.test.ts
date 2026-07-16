import { describe, expect, it, vi } from "vitest";

import { generateFishingShoalCatalog } from "../src/wayfinders/exploration/FishingShoalCatalog";
import { generateIslandDossierCatalog } from "../src/wayfinders/exploration/IslandDossierCatalog";
import { generateSurveySiteCatalog } from "../src/wayfinders/exploration/SurveySiteCatalog";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { serializeWorldManifestV1 } from "../src/wayfinders/world/manifest";
import { createWorldProfileConfig } from "./fixtures/worldProfiles";

describe("world generation pipeline", () => {
  it("replays byte-equivalent manifest facts before rasterization", () => {
    const generator = new WorldGenerator(createWorldProfileConfig("P2"));
    const first = generator.plan(84_221);
    const replay = generator.plan(84_221);

    expect(first.manifest.settingsProfileId).toBe("P2");
    expect(first.manifest.islands).toHaveLength(300);
    expect(serializeWorldManifestV1(replay.manifest)).toBe(serializeWorldManifestV1(first.manifest));
  });

  it("shares one analysis build across all current feature seeders", () => {
    const config = createWorldProfileConfig("P0");
    const generated = new WorldGenerator(config).generate(13_371);
    const fullGridIteration = vi.spyOn(generated.grid, "forEachTile");

    generateIslandDossierCatalog(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
      undefined,
      config,
      generated.analysis,
    );
    generateSurveySiteCatalog(
      generated.grid,
      generated.seed,
      generated.islands,
      generated.landmarks.homeReturnTile,
      undefined,
      config,
      generated.analysis,
    );
    generateFishingShoalCatalog(
      generated.grid,
      generated.seed,
      generated.landmarks.homeReturnTile,
      undefined,
      config,
      generated.analysis,
    );

    expect(generated.analysis.buildDiagnostics.sourceGridScans).toBe(1);
    expect(fullGridIteration).not.toHaveBeenCalled();
  });
});
