import { describe, expect, it } from "vitest";

import {
  AuthoredMapValidationError,
  authoredMapContentFingerprintV1,
  createCurrentAuthoredMapDefinitionV1,
  maximumAuthoredMapCanonicalBytesV1,
  parseAuthoredMapDefinitionV1,
  serializeAuthoredMapDefinitionV1,
  verifyAuthoredMapDefinitionIdentityV1,
} from "../src/wayfinders/app/authoredMaps";
import { createAuthoredFishingShoalV1, createFishingShoalId } from "../src/wayfinders/features/fishing";
import { AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID } from "../src/wayfinders/world/authored";
import { createWorldProfileConfig } from "./fixtures/worldProfiles";

describe("MAP-1.1 authored-map codec", () => {
  it("normalizes stable arrays, round-trips exact canonical bytes, and fingerprints semantic content", async () => {
    const config = createWorldProfileConfig("P0");
    const baseSeed = 13_371;
    const first = await createCurrentAuthoredMapDefinitionV1({
      id: "codec-map",
      displayName: "Codec map",
      baseSeed,
      islands: [
        { sourceId: 2, authoredAssetId: "island.two", assetRevision: "r2", center: { x: 8, y: 8 } },
        { sourceId: 1, authoredAssetId: "island.one", assetRevision: "r1", center: { x: 70, y: 70 } },
      ],
      shoals: [
        createAuthoredFishingShoalV1(baseSeed, createFishingShoalId(8), { x: 8, y: 50 }, "rich"),
        createAuthoredFishingShoalV1(baseSeed, createFishingShoalId(2), { x: 8, y: 30 }, "lean"),
      ],
      config,
    });
    const bytes = serializeAuthoredMapDefinitionV1(first);
    const replay = parseAuthoredMapDefinitionV1(bytes);

    expect(serializeAuthoredMapDefinitionV1(replay)).toBe(bytes);
    expect(replay.world.islands.map(({ sourceId }) => sourceId)).toEqual([1, 2]);
    expect(replay.fishing.shoals.map(({ id }) => id)).toEqual([
      createFishingShoalId(2),
      createFishingShoalId(8),
    ]);
    expect(Object.isFrozen(replay.world.islands[0].center)).toBe(true);
    expect(await authoredMapContentFingerprintV1(replay)).toBe(replay.contentFingerprint);
    await expect(verifyAuthoredMapDefinitionIdentityV1(
      replay,
      replay.id,
      replay.contentFingerprint,
    )).resolves.toEqual(replay);
    const tampered = structuredClone(replay);
    (tampered as { displayName: string }).displayName = "Tampered content";
    await expect(verifyAuthoredMapDefinitionIdentityV1(
      tampered,
      replay.id,
      replay.contentFingerprint,
    )).rejects.toThrow("does not match its retained fingerprint");
    expect(new TextEncoder().encode(bytes).length).toBeLessThan(maximumAuthoredMapCanonicalBytesV1());
  });

  it("rejects unknown fields at an actionable JSON path", async () => {
    const definition = await createCurrentAuthoredMapDefinitionV1({
      id: "strict-map",
      displayName: "Strict map",
      baseSeed: 1,
      islands: [{
        sourceId: 1,
        authoredAssetId: "island.one",
        assetRevision: "r1",
        center: { x: 8, y: 8 },
      }],
      shoals: [],
      config: createWorldProfileConfig("P0"),
    });
    const mutable = structuredClone(definition) as unknown as Record<string, unknown>;
    (mutable.world as Record<string, unknown>).surprise = true;

    expect(() => parseAuthoredMapDefinitionV1(JSON.stringify(mutable))).toThrowError(
      new AuthoredMapValidationError("$.world.surprise", "is not allowed"),
    );
  });

  it("bounds island source IDs to the signed-int32 world authority", async () => {
    const definition = await createCurrentAuthoredMapDefinitionV1({
      id: "source-id-bound",
      displayName: "Source ID bound",
      baseSeed: 1,
      islands: [{
        sourceId: AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID,
        authoredAssetId: "island.one",
        assetRevision: "r1",
        center: { x: 8, y: 8 },
      }],
      shoals: [],
      config: createWorldProfileConfig("P0"),
    });
    expect(definition.world.islands[0].sourceId).toBe(AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID);

    const aliased = structuredClone(definition);
    (aliased.world.islands[0] as { sourceId: number }).sourceId = 0x1_0000_0001;
    expect(() => parseAuthoredMapDefinitionV1(JSON.stringify(aliased))).toThrowError(
      new AuthoredMapValidationError(
        "$.world.islands[0].sourceId",
        `must not exceed ${AUTHORED_WORLD_ISLAND_MAX_SOURCE_ID}`,
      ),
    );
  });
});
