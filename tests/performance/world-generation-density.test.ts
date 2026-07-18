import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import { WorldGenerator } from "../../src/wayfinders/world/WorldGenerator";
import { serializeWorldManifestV2 } from "../../src/wayfinders/world/manifest";
import {
  WORLD_GENERATION_PROFILES,
  createWorldGenerationProfileConfig,
} from "../../src/wayfinders/world/WorldGenerationProfiles";

const FIXED_P2_SEEDS = Object.freeze(Array.from(
  { length: 100 },
  (_, index) => 10_007 + index * 7_919,
));

describe("P2 deterministic generation acceptance", () => {
  it.each(FIXED_P2_SEEDS)(
    "rasterizes 300 connected, channel-safe islands for fixed seed %i",
    (seed) => {
      const config = createWorldGenerationProfileConfig("P2");
      const generator = new WorldGenerator(config);
      const planned = generator.plan(seed);
      const replay = generator.plan(seed);

      expect(planned.islands).toHaveLength(300);
      expect(serializeWorldManifestV2(replay.manifest)).toBe(serializeWorldManifestV2(planned.manifest));
      // Rasterization performs the authoritative dock-connected global-ocean
      // and atoll connectivity assertions. Placement already enforced channels.
      expect(() => generator.rasterize(planned)).not.toThrow();
    },
    5_000,
  );

  it("handles the documented 500-island stress profile without an unbounded search", () => {
    const profile = WORLD_GENERATION_PROFILES["P2-500"];
    const config = createWorldGenerationProfileConfig("P2-500");
    const generator = new WorldGenerator(config);
    const startedAt = performance.now();
    const planned = generator.plan(50_003);
    const rasterized = generator.rasterize(planned);
    const durationMs = performance.now() - startedAt;
    const replay = generator.plan(50_003);
    const declaredBounds = {
      randomCandidatesPerIsland: profile.placementAttemptLimit,
      fallbackCandidatesPerIsland: profile.dimensions.width * profile.dimensions.height,
      configuredIslandCount: profile.density.islandCount,
    };

    expect(planned.islands.length).toBeLessThanOrEqual(500);
    expect(rasterized.islands).toEqual(planned.islands);
    expect(profile.placementAttemptLimit).toBe(config.islands.placementAttempts);
    expect(serializeWorldManifestV2(replay.manifest)).toBe(serializeWorldManifestV2(planned.manifest));
    expect(
      durationMs,
      `P2-500 generation budget miss: ${JSON.stringify({ durationMs, thresholdMs: 7_500, declaredBounds })}`,
    ).toBeLessThan(7_500);
  }, 9_000);
});
