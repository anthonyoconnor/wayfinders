import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GameSimulation, type SimulationSnapshot } from "../src/wayfinders/core/GameSimulation";
import { WorldGenerator } from "../src/wayfinders/world/WorldGenerator";
import { createWorldGenerationProfileConfig } from "../src/wayfinders/world/WorldGenerationProfiles";
import { encodeWorldManifestV2 } from "../src/wayfinders/world/manifest";

const MAP_1_0_SIGNATURES = Object.freeze({
  P0: Object.freeze({
    islandCount: 8,
    manifest: "485cc484a573483b60a8db111c52a74c2870e2884b58feb1d94b47dd5121b80b",
    terrain: "12a743950ae174cc5d93cd859b1e212873dccc197380793f7958a881d91b58ec",
    knowledge: "872c7bf4e98f56af680778cc635085253fe7dd445e61950ae3e7337e203ba74b",
    islandIds: "89a72ba7296142a3662374bd65448dbbfe2f5bce2a3a2449231614103b0cff2c",
    fishingShoalCount: 4,
    fishingDefinitions: "7dd1b7c8a568a9e3bbfddb5e97d0d53cf558d3aeda4852a35ae494b934784f35",
    gameplayObservables: "ba41c5842f1ea919300a81f3ac310640d91752810fc389a661229438600d0da5",
  }),
  P1: Object.freeze({
    islandCount: 32,
    manifest: "49215f2a790110b650829a739c90a6c5f317e125e63de0c3d45087adeb7d4ed2",
    terrain: "718bd7005b42aec37ba4a658aab1e0008727ec19fb15ff29e06ee0da0ae221c0",
    knowledge: "0babc93c95d9e27d1b7a100a1e34c30488ef39f36b68eeda02fb207532b9f5f0",
    islandIds: "2d42dcf13dc371706b01a4930ddf2dfd90cd260198743fb4bc7bb0a680eb83a1",
    fishingShoalCount: 4,
    fishingDefinitions: "51c051c2dd8823b8fec2cc70a7a164c7f7edb0d8dc8b0f8cd1c0a05b876eb079",
    gameplayObservables: "351dc99328282304c3b2853f7e4a1e8693de396dceead65b3ff17264d03d4a27",
  }),
});

describe("MAP-1 procedural source equivalence", () => {
  for (const profile of ["P0", "P1"] as const) {
    it(`preserves the pre-source ${profile} world signatures`, () => {
      const config = createWorldGenerationProfileConfig(profile);
      const generated = new WorldGenerator(config).generate();
      const simulation = new GameSimulation(config);
      const terrain = new Uint8Array(generated.grid.tileCount);
      const knowledge = new Uint8Array(generated.grid.tileCount);
      const islandIds = new Int32Array(generated.grid.tileCount);
      for (let index = 0; index < generated.grid.tileCount; index++) {
        const tile = generated.grid.pointFromIndex(index);
        terrain[index] = generated.grid.getTerrain(tile.x, tile.y);
        knowledge[index] = generated.grid.getKnowledgeAtIndex(index);
        islandIds[index] = generated.grid.getIslandIdAtIndex(index);
      }

      expect({
        islandCount: generated.islands.length,
        manifest: sha256(encodeWorldManifestV2(generated.manifest)),
        terrain: sha256(terrain),
        knowledge: sha256(knowledge),
        islandIds: sha256(new Uint8Array(islandIds.buffer)),
        fishingShoalCount: simulation.fishingShoalDefinitions.length,
        fishingDefinitions: sha256(stableJsonBytes(simulation.fishingShoalDefinitions)),
        gameplayObservables: sha256(stableJsonBytes(gameplayObservableInventory(simulation.snapshot()))),
      }).toEqual(MAP_1_0_SIGNATURES[profile]);
    });
  }
});

/**
 * Locks the complete player-observable initial simulation inventory: seed, ship,
 * tile/world dimensions, knowledge and risk, expedition/navigator state, wrecks,
 * dossier/site/shoal read models, and idol progress. `source` is deliberately
 * excluded because MAP-1.0 adds that provenance field without changing gameplay.
 */
function gameplayObservableInventory(snapshot: Readonly<SimulationSnapshot>): Omit<SimulationSnapshot, "source"> {
  const { source: _source, ...gameplayObservables } = snapshot;
  return gameplayObservables;
}

function stableJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, (_key, nested) => (
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => (
          left < right ? -1 : left > right ? 1 : 0
        )))
      : nested
  )));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
