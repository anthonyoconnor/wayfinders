import { describe, expect, it } from "vitest";

import { DEFAULT_GAME_SETTINGS } from "../src/wayfinders/config/gameSettings";
import {
  generateIdolLocationCatalog,
} from "../src/wayfinders/exploration/IdolLocationCatalog";
import {
  IDOL_LOCATION_CONTENT_VERSION,
  compareIdolLocationIds,
  createIdolLocationHostKey,
  createIdolLocationId,
  isCurrentIdolLocationId,
  parseIdolLocationId,
} from "../src/wayfinders/exploration/IdolLocationContracts";
import { createSurveySiteId } from "../src/wayfinders/exploration/SurveySiteContracts";

const ISLAND_DOSSIERS = Object.freeze(
  Array.from({ length: DEFAULT_GAME_SETTINGS.world.islands.count }, (_, index) => (
    Object.freeze({ islandId: index + 1 })
  )),
);

const SURVEY_SITES = Object.freeze([
  Object.freeze({ id: createSurveySiteId("historic-wreck", 0) }),
  Object.freeze({ id: createSurveySiteId("coastal-ruin", 0) }),
  Object.freeze({ id: createSurveySiteId("tidal-cave", 0) }),
]);

describe("idol-location contracts", () => {
  it("uses canonical versioned one-based IDs", () => {
    const first = createIdolLocationId(1);
    const third = createIdolLocationId(3);

    expect(first).toBe("idol-location:v1:0001");
    expect(parseIdolLocationId(first)).toEqual({
      contentVersion: IDOL_LOCATION_CONTENT_VERSION,
      ordinal: 1,
    });
    expect(isCurrentIdolLocationId(third)).toBe(true);
    expect(compareIdolLocationIds(first, third)).toBeLessThan(0);
    expect(parseIdolLocationId("idol-location:v1:0000")).toBeUndefined();
    expect(parseIdolLocationId("idol-location:v2:0001")).toEqual({ contentVersion: 2, ordinal: 1 });
    expect(isCurrentIdolLocationId("idol-location:v2:0001")).toBe(false);
    expect(() => createIdolLocationId(0)).toThrow(RangeError);
    expect(() => createIdolLocationId(10_000)).toThrow(RangeError);
  });
});

describe("deterministic idol-location catalog", () => {
  it("places the default world's three idols reproducibly and independently of input order", () => {
    const seed = DEFAULT_GAME_SETTINGS.world.seed;
    const count = DEFAULT_GAME_SETTINGS.world.idolCount;
    const first = generateIdolLocationCatalog(seed, count, ISLAND_DOSSIERS, SURVEY_SITES);
    const replay = generateIdolLocationCatalog(seed, count, ISLAND_DOSSIERS, SURVEY_SITES);
    const reordered = generateIdolLocationCatalog(
      seed,
      count,
      [...ISLAND_DOSSIERS].reverse(),
      [...SURVEY_SITES].reverse(),
    );

    expect(count).toBe(3);
    expect(first).toHaveLength(3);
    expect(replay).toEqual(first);
    expect(reordered).toEqual(first);
    expect(first.map(({ host }) => createIdolLocationHostKey(host))).toEqual([
      "island-dossier:15",
      "survey-site:survey-site:v1:coastal-ruin:0000",
      "island-dossier:2",
    ]);
    expect(first.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3]);
    expect(first.map(({ displayLabel }) => displayLabel)).toEqual([
      "Lost Idol 1",
      "Lost Idol 2",
      "Lost Idol 3",
    ]);
    expect(new Set(first.map(({ host }) => createIdolLocationHostKey(host))).size).toBe(3);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every(Object.isFrozen)).toBe(true);
    expect(first.every(({ host }) => Object.isFrozen(host))).toBe(true);
  });

  it("uses only unique island-dossier and generic survey-site hosts", () => {
    const capacity = ISLAND_DOSSIERS.length + SURVEY_SITES.length;
    const catalog = generateIdolLocationCatalog(
      DEFAULT_GAME_SETTINGS.world.seed,
      capacity,
      ISLAND_DOSSIERS,
      SURVEY_SITES,
    );
    const hostKeys = catalog.map(({ host }) => createIdolLocationHostKey(host));

    expect(catalog).toHaveLength(capacity);
    expect(new Set(hostKeys).size).toBe(capacity);
    expect(new Set(catalog.map(({ host }) => host.kind))).toEqual(
      new Set(["island-dossier", "survey-site"]),
    );
    expect(hostKeys.every((key) => (
      key.startsWith("island-dossier:") || key.startsWith("survey-site:")
    ))).toBe(true);
  });

  it("rejects impossible counts, invalid inputs, duplicate hosts, and unsupported content", () => {
    const capacity = ISLAND_DOSSIERS.length + SURVEY_SITES.length;
    const generate = (count: number) => generateIdolLocationCatalog(
      DEFAULT_GAME_SETTINGS.world.seed,
      count,
      ISLAND_DOSSIERS,
      SURVEY_SITES,
    );

    expect(() => generate(capacity + 1)).toThrow(
      `Configured idol-location count ${capacity + 1} exceeds ${capacity} eligible survey hosts`,
    );
    for (const count of [0, -1, 1.5]) {
      expect(() => generate(count)).toThrow("Idol-location count must be a positive integer");
    }
    expect(() => generateIdolLocationCatalog(
      DEFAULT_GAME_SETTINGS.world.seed,
      1,
      [ISLAND_DOSSIERS[0], ISLAND_DOSSIERS[0]],
      SURVEY_SITES,
    )).toThrow("Duplicate eligible idol-location host island-dossier:1");
    expect(() => generateIdolLocationCatalog(
      DEFAULT_GAME_SETTINGS.world.seed,
      1,
      ISLAND_DOSSIERS,
      [SURVEY_SITES[0], SURVEY_SITES[0]],
    )).toThrow("Duplicate eligible idol-location host survey-site:");
    expect(() => generateIdolLocationCatalog(
      DEFAULT_GAME_SETTINGS.world.seed,
      1,
      ISLAND_DOSSIERS,
      SURVEY_SITES,
      IDOL_LOCATION_CONTENT_VERSION + 1,
    )).toThrow("Unsupported idol-location content version 2");
    expect(() => generateIdolLocationCatalog(
      Number.MAX_SAFE_INTEGER + 1,
      1,
      ISLAND_DOSSIERS,
      SURVEY_SITES,
    )).toThrow("Idol-location world seed must be a safe integer");
  });
});
