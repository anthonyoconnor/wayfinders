import { describe, expect, it } from "vitest";

import { WorldGenerator } from "../../src/wayfinders/world/WorldGenerator";
import { serializeWorldManifestV1 } from "../../src/wayfinders/world/manifest";
import { createWorldGenerationProfileConfig } from "../../src/wayfinders/world/WorldGenerationProfiles";

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
      expect(serializeWorldManifestV1(replay.manifest)).toBe(serializeWorldManifestV1(planned.manifest));
      // Rasterization performs the authoritative dock/open-edge and atoll
      // connectivity assertions. Placement has already enforced exact channels.
      expect(() => generator.rasterize(planned)).not.toThrow();
    },
    5_000,
  );

  it("handles the documented 500-island stress profile without an unbounded search", () => {
    const config = createWorldGenerationProfileConfig("P2-500");
    const generator = new WorldGenerator(config);
    const planned = generator.plan(50_003);
    const replay = generator.plan(50_003);

    expect(planned.islands.length).toBeLessThanOrEqual(500);
    expect(serializeWorldManifestV1(replay.manifest)).toBe(serializeWorldManifestV1(planned.manifest));
    expect(() => generator.rasterize(planned)).not.toThrow();
  }, 10_000);
});
