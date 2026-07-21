import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_SETTINGS,
  prototypeConfigFromGameSettings,
  validateGameSettings,
  type GameSettings,
} from "../src/wayfinders/config/gameSettings";
import {
  prototypeConfig,
  validatePrototypeConfig,
} from "../src/wayfinders/config/prototypeConfig";
import { WORLD_GENERATION_PROFILES } from "../src/wayfinders/world/WorldGenerationProfiles";

describe("default game settings contract", () => {
  it("owns normal new-game defaults in the five named sections", () => {
    expect(Object.keys(DEFAULT_GAME_SETTINGS)).toEqual([
      "world",
      "audio",
      "overlays",
      "gameplay",
      "presentation",
    ]);
    expect(Object.isFrozen(DEFAULT_GAME_SETTINGS)).toBe(true);
    expect(() => validateGameSettings(DEFAULT_GAME_SETTINGS)).not.toThrow();
  });

  it("starts a 192 by 192 world with sound on and developer route overlays hidden", () => {
    expect(DEFAULT_GAME_SETTINGS.world).toMatchObject({ width: 192, height: 192 });
    expect(prototypeConfig.world).toMatchObject({ width: 192, height: 192 });
    expect(DEFAULT_GAME_SETTINGS.audio.enabled).toBe(true);
    expect(DEFAULT_GAME_SETTINGS.audio.muted).toBe(false);
    expect(DEFAULT_GAME_SETTINGS.audio.categoryVolumes.sfx).toBe(0.1);
    expect(DEFAULT_GAME_SETTINGS.overlays.forwardRange).toBe(false);
    expect(DEFAULT_GAME_SETTINGS.overlays.fishingTrafficRoutes).toBe(false);
    expect(DEFAULT_GAME_SETTINGS.overlays.tradeTrafficRoutes).toBe(false);
  });

  it("derives normal simulation defaults without giving benchmark profiles ownership", () => {
    const config = prototypeConfigFromGameSettings(DEFAULT_GAME_SETTINGS);
    expect(config.world).toMatchObject({ width: 192, height: 192 });
    expect(config.provisions.startingBundles).toBe(DEFAULT_GAME_SETTINGS.gameplay.provisions.startingBundles);

    expect(WORLD_GENERATION_PROFILES.P0.dimensions).toEqual({ width: 96, height: 96 });
    expect(WORLD_GENERATION_PROFILES.P1.dimensions).toEqual({ width: 192, height: 192 });
    expect(WORLD_GENERATION_PROFILES.P2.dimensions).toEqual({ width: 384, height: 384 });
    expect(DEFAULT_GAME_SETTINGS.world.islands.count).toBe(20);
    expect(WORLD_GENERATION_PROFILES.P1.config.islands.count).toBe(32);
  });

  it("validates player-facing audio and overlay values at their canonical owner", () => {
    const invalidAudio = JSON.parse(JSON.stringify(DEFAULT_GAME_SETTINGS)) as GameSettings;
    invalidAudio.audio.categoryVolumes.sfx = 1.1;
    expect(() => validateGameSettings(invalidAudio)).toThrow("audio.categoryVolumes.sfx must be between 0 and 1");

    const invalidOverlay = JSON.parse(JSON.stringify(DEFAULT_GAME_SETTINGS)) as GameSettings;
    invalidOverlay.overlays.forwardRange = "visible" as unknown as boolean;
    expect(() => validateGameSettings(invalidOverlay)).toThrow("overlays.forwardRange must be a boolean");

    const invalidTrafficOverlay = JSON.parse(JSON.stringify(DEFAULT_GAME_SETTINGS)) as GameSettings;
    invalidTrafficOverlay.overlays.fishingTrafficRoutes = "visible" as unknown as boolean;
    expect(() => validateGameSettings(invalidTrafficOverlay)).toThrow(
      "overlays.fishingTrafficRoutes must be a boolean",
    );
  });

  it("preserves settings-specific paths for shared simulation tuning validation", () => {
    const invalidSettings = JSON.parse(JSON.stringify(DEFAULT_GAME_SETTINGS)) as GameSettings;
    invalidSettings.world.islands.minRadius = 0;
    expect(() => validateGameSettings(invalidSettings)).toThrow(
      "world.islands.minRadius must be positive",
    );

    const invalidPrototype = prototypeConfigFromGameSettings(DEFAULT_GAME_SETTINGS);
    invalidPrototype.islands.minRadius = 0;
    expect(() => validatePrototypeConfig(invalidPrototype)).toThrow(
      "islands.minRadius must be positive",
    );
  });
});
