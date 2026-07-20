# Wayfinders settings guide

This is the operational index for configurable normal-game defaults. The
values themselves have one executable owner:
`src/wayfinders/config/gameSettings.ts` exports the typed, deeply frozen
`DEFAULT_GAME_SETTINGS`. `tests/game-settings.test.ts` locks the key product
defaults and stable benchmark dimensions.

Three names mean three different things:

- `DEFAULT_GAME_SETTINGS` defines a normal new game and its initial
  presentation.
- `WORLD_GENERATION_PROFILES` defines stable benchmark and scale fixtures; it
  never derives from normal-game defaults.
- `prototypeConfig`, scene overlay toggles, mixer controls, and browser debug
  commands are temporary session/developer overrides. They do not rewrite
  either default contract.

Changing a world-shape or generation value affects a newly constructed game;
an existing session sees it only after explicit regeneration. “Presentation”
means no authoritative gameplay state changes. “Benchmarks” is always **no**
below because named profiles own separate explicit values.

## `world`

Owner: `DEFAULT_GAME_SETTINGS.world`; the config adapter supplies generation
and simulation consumers.

| Setting path(s) | Validation | Change scope |
| --- | --- | --- |
| `width`, `height` | positive whole tiles; large enough for the starting region and largest periodic island | new game or regeneration |
| `seed` | safe integer | new game or regeneration |
| `chunkSize` | positive whole tiles | new game or regeneration; presentation resource partitioning |
| `homeIslandRadius`, `shallowWaterRadius`, `hiddenObstacleRadius` | positive whole tiles; shallow radius is not smaller than home radius | new game or regeneration |
| `supportedWaterRadius` | non-negative and not smaller than shallow radius | new game or regeneration |
| `supportedBoundaryNoise`, `hiddenObstacleDistance` | non-negative finite values | new game or regeneration |
| `supportedNoiseScale` | positive finite value | new game or regeneration |
| `maxEnclosedUnknownTiles` | non-negative whole tile count | subsequent successful returns in the session |
| `idolCount` | positive whole count | new game or regeneration |
| `islands.count`, `islands.archipelagoClusters` | non-negative whole counts (`count` is positive) | new game or regeneration |
| `islands.minRadius`, `maxRadius`, `apronWidth`, `archipelagoRadius` | positive finite values; max radius is not smaller than min radius | new game or regeneration |
| `islands.minimumChannelWidth`, `homeClearance`, `safeCorridorHalfWidth` | non-negative finite values | new game or regeneration |
| `islands.placementAttempts` | positive whole count | new game or regeneration |
| `islands.archipelagoBias`, `edgeNoise` | `[0, 1]` | new game or regeneration |
| `islands.highIslandWeight`, `lowCayWeight`, `atollWeight`, `rockySkerryWeight` | non-negative; at least one weight is positive | new game or regeneration |

## `audio`

Owner: `DEFAULT_GAME_SETTINGS.audio`; the scene initializes the mixer and
browser-aware controller from it.

| Setting path(s) | Validation | Change scope |
| --- | --- | --- |
| `enabled`, `muted` | boolean | initial presentation; browser permission still gates playback |
| `masterVolume` | `[0, 1]` | initial presentation; mixer control can override for the session |
| `categoryVolumes.music`, `ambience`, `sfx`, `ui` | `[0, 1]` | initial presentation; category controls can override for the session |

The checked-in audio catalog does not own these values. It owns category and
asset labels, file paths, base gains, loop flags, descriptions, and voice
limits. Sound configured on begins once the browser permits audio; **Enable
sound** is only an unlock fallback, and mute is the explicit player off control.

## `overlays`

Owner: `DEFAULT_GAME_SETTINGS.overlays`; `WayfindersScene` owns the mutable
per-session visibility state.

| Setting path(s) | Validation | Change scope |
| --- | --- | --- |
| `navigationGrid`, `collisionBoxes`, `currentSight` | boolean | initial presentation/debug visibility only |
| `forwardRange`, `returnViability` | boolean | initial guidance presentation; hidden forward range also suspends its optional derived search, while route authority is unchanged |

These values initialize scene-owned state. Developer controls and
`window.__WAYFINDERS__.setOverlay` affect only the current session; the
forward-range switch also sends its derived-work demand command to that
session's `GameSimulation`.

## `gameplay`

Owner: `DEFAULT_GAME_SETTINGS.gameplay`; the config adapter supplies
authoritative simulation consumers.

| Setting path(s) | Validation | Change scope |
| --- | --- | --- |
| `sightRadius` | non-negative whole tiles | new game; supported live override refreshes visibility |
| `provisions.startingBundles` | non-negative whole bundles | new game or next expedition initialization |
| `provisions.surveyCost` | positive whole bundles | subsequent survey decisions |
| `provisions.supportedCost`, `personalCost`, `unknownCost` | non-negative with at most four decimal places | subsequent movement and derived guidance |
| `returnRisk.comfortable`, `warning`, `critical` | non-negative and ordered comfortable ≥ warning ≥ critical | derived guidance presentation |
| `movement.shipSpeed`, `turnRate` | non-negative finite values | subsequent fixed-step movement |
| `movement.shipCollisionHalfExtent`, `collisionEpsilon` | positive; hull is under half a tile and epsilon is under one tile | new movement authority/session |
| `fixedStepMs` | positive finite duration | new simulation clock |
| `maxFrameDeltaMs` | finite duration not smaller than one fixed step | new simulation clock |

## `presentation`

Owner: `DEFAULT_GAME_SETTINGS.presentation`; the config adapter and scene own
the corresponding rendering/session behavior.

| Setting path(s) | Validation | Change scope |
| --- | --- | --- |
| `navigationTileSize`, `artTileSize` | positive finite pixels | new game presentation and collision scale |
| `wreckPresentationSeconds` | positive finite duration | subsequent wreck presentation |
| `fogNoise`, `fogBlend`, `forwardOverlayOpacity`, `returnOverlayOpacity` | `[0, 1]` | presentation only |
| `returnThreadWidth`, `forwardConeHalfAngleDegrees` | positive; cone half-angle is at most 180° | presentation/derived guidance only |
| `returnThreadCurveRadius` | non-negative finite pixels | presentation only |
| `returnPathPadding` | non-negative whole tiles | derived guidance presentation |

The full cross-field validation contract remains in
`validateGameSettings` and `validatePrototypeConfig`. Named benchmark profiles
are changed only in `WorldGenerationProfiles.ts`, followed by the relevant
performance lane; ordinary settings changes never alter them implicitly.
