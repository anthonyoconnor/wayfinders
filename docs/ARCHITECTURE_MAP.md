# Wayfinders architecture map

This map is the first stop for agents deciding where a change belongs. It
describes current ownership and the dependency direction being introduced by
the AM architecture track. Detailed implemented gameplay contracts remain in
Wayfinders_Technical_Design.md.

## Startup order

1. src/main.ts resolves application mode and creates the session configuration.
2. GameSimulation generates the authoritative world and composes gameplay
   systems.
3. WayfindersScene creates Phaser presentation and translates input into
   simulation commands.
4. Renderers consume simulation read models and revision counters.
5. Development diagnostics consume counters/read models; they do not own
   gameplay state.

## Ownership

| Area | Owns | Must not own |
| --- | --- | --- |
| config | validation and immutable session values | live gameplay state |
| world | logical tiles, generation, manifests and spatial indexes | Phaser objects |
| navigation | movement authority, topology and route/range queries | feature rewards or UI |
| exploration/features | feature state, commands, selectors and mutation results | scene lifecycle |
| core/app | deterministic ordering and composition | feature-specific presentation rules |
| rendering/presentation | Phaser resources and read-model adaptation | authoritative decisions |
| assets | semantic asset contracts and loading/presentation metadata | navigation authority |
| diagnostics | timings, counters and sampled read models | mutation |

## Approved dependency direction

    config
      ↓
    world → navigation
      ↓       ↓
    features/exploration
      ↓
    core/app composition
      ↓
    presentation/rendering
      ↓
    diagnostics and developer tools

Assets may be consumed by presentation. Only semantic collision metadata may
cross from assets into navigation, through an explicit registered contract.
Presentation may import public domain contracts but never private feature state.
Features may not import Phaser.

## Current compatibility seams

- GameSimulation is the compatibility facade and current composition root. AM-2
  will introduce GameSession contracts behind it.
- prototypeConfig is the live tuning compatibility object. New sessions and
  tests should use detached configuration values; AM-2 makes this instance-safe.
- WorldGrid chunks are storage units, not presentation activation. AM-3 and AM-5
  introduce spatial and active-chunk lifecycle boundaries.
- WayfindersScene remains Phaser's lifecycle owner while presentation
  controllers are extracted by feature.

## Change-location rule

A normal feature change belongs in one feature-owned folder, its tests, and at
most one composition/registration point. A change requiring edits to both
GameSimulation and WayfindersScene is a signal to define or use a command,
selector, mutation result or presentation adapter first.
