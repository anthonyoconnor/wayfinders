import { describe, expect, it } from "vitest";
import { SessionBuilder } from "../src/wayfinders/app/SessionBuilder";
import {
  createSessionConfig,
  patchSessionConfig,
  type SessionConfig,
} from "../src/wayfinders/config/SessionConfig";
import {
  DEFAULT_PROTOTYPE_CONFIG,
  prototypeConfig,
  type PrototypeConfig,
} from "../src/wayfinders/config/prototypeConfig";
import { TestSessionBuilder } from "./support/TestSessionBuilder";

function mutable(config: SessionConfig): PrototypeConfig {
  return config as unknown as PrototypeConfig;
}

describe("SessionConfig", () => {
  it("deep-clones and freezes the source configuration", () => {
    const source = {
      navigation: { ...DEFAULT_PROTOTYPE_CONFIG.navigation },
      world: { ...DEFAULT_PROTOTYPE_CONFIG.world },
      islands: { ...DEFAULT_PROTOTYPE_CONFIG.islands },
      provisions: { ...DEFAULT_PROTOTYPE_CONFIG.provisions },
      returnRisk: { ...DEFAULT_PROTOTYPE_CONFIG.returnRisk },
      overlays: { ...DEFAULT_PROTOTYPE_CONFIG.overlays },
      movement: { ...DEFAULT_PROTOTYPE_CONFIG.movement },
      simulation: { ...DEFAULT_PROTOTYPE_CONFIG.simulation },
    } satisfies PrototypeConfig;
    const session = createSessionConfig(source);

    source.world.seed = 99;
    expect(session.world.seed).toBe(DEFAULT_PROTOTYPE_CONFIG.world.seed);
    expect(session.world).not.toBe(source.world);
    expect(Object.isFrozen(session)).toBe(true);
    for (const section of Object.values(session)) expect(Object.isFrozen(section)).toBe(true);
    expect(() => {
      mutable(session).world.seed = 101;
    }).toThrow(TypeError);
  });

  it("patches into a new validated snapshot without mutating its input or global defaults", () => {
    const liveSeed = prototypeConfig.world.seed;
    const base = createSessionConfig();
    const patched = patchSessionConfig(base, {
      world: { seed: 47_011 },
      provisions: { startingBundles: 7 },
    });

    expect(patched.world.seed).toBe(47_011);
    expect(patched.provisions.startingBundles).toBe(7);
    expect(base.world.seed).toBe(liveSeed);
    expect(base.provisions.startingBundles).toBe(prototypeConfig.provisions.startingBundles);
    expect(prototypeConfig.world.seed).toBe(liveSeed);
  });

  it("rejects invalid or unknown patches atomically without changing globals", () => {
    const before = createSessionConfig();

    expect(() => patchSessionConfig(before, {
      movement: { shipCollisionHalfExtent: before.navigation.tileSize },
    })).toThrow("movement.shipCollisionHalfExtent must be smaller than half navigation.tileSize");
    expect(() => patchSessionConfig(before, {
      world: { unknownSetting: 1 },
    } as never)).toThrow("Unknown session config value: world.unknownSetting");

    expect(before).toEqual(createSessionConfig());
    expect(prototypeConfig.world.seed).toBe(before.world.seed);
  });
});

describe("SessionBuilder", () => {
  it("keeps built definitions isolated from later builder patches", () => {
    const builder = new SessionBuilder().withConfig({ world: { seed: 10_001 } });
    const first = builder.build();
    const second = builder.withConfig({ world: { seed: 10_002 } }).build();

    expect(first.config.world.seed).toBe(10_001);
    expect(second.config.world.seed).toBe(10_002);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.config).not.toBe(second.config);
  });

  it("offers concise, isolated setup through TestSessionBuilder", () => {
    const session = new TestSessionBuilder()
      .withSeed(20_001)
      .withWorldSize(128, 128)
      .withStartingBundles(21)
      .build();

    expect(session.config.world).toMatchObject({ seed: 20_001, width: 128, height: 128 });
    expect(session.config.provisions.startingBundles).toBe(21);
    expect(prototypeConfig.world.seed).toBe(DEFAULT_PROTOTYPE_CONFIG.world.seed);
  });
});
