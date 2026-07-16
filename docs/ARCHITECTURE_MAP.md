# Wayfinders architecture map

This is the first stop for deciding where a code change belongs. It documents
current ownership, public seams, and dependency direction. Runtime and gameplay
behavior belongs in `Wayfinders_Technical_Design.md`.

## Startup order

1. `src/main.ts` selects game or asset-tool mode and supplies validated
   prototype configuration.
2. `GameSimulation` plans a `WorldManifest`, rasterizes `WorldGrid`, builds one
   `WorldAnalysisIndex`, and composes gameplay features.
3. `WayfindersScene` creates Phaser presentation and translates input into
   simulation commands.
4. Presentation controllers and renderers consume read models, revisions, and
   the shared active-chunk delta.
5. Diagnostics and development tools consume bounded read models and counters;
   they do not own gameplay state.

## Ownership

| Area | Owns | Must not own |
| --- | --- | --- |
| `config` | validated prototype tuning values and change notification | live gameplay state |
| `world` | named scale profiles, manifests, generation, logical tiles, analysis, and spatial indexes | Phaser objects |
| `navigation` | collision topology, movement authority, and route/range mechanics | feature rewards or UI |
| `exploration` / `features` | feature state, commands, selectors, and mutation results | scene lifecycle |
| `core` / `app` | `GameSimulation` composition and deterministic cross-feature ordering | feature-specific presentation rules |
| `rendering` | Phaser lifecycle, resource activation, and read-model adaptation | authoritative gameplay decisions |
| `assets` | semantic package contracts, loading, authoring, and promotion | navigation authority outside declared collision metadata |

## Dependency direction

```text
config
  ↓
world → navigation
  ↓       ↓
features and exploration
  ↓
core/app composition
  ↓
presentation/rendering
  ↓
diagnostics and developer tools
```

Assets may be consumed by presentation. Only validated semantic collision
metadata crosses from assets into navigation. Presentation may import public
domain contracts but never private feature state. Feature and world code must
not import Phaser.

## Public seams

- `GameSimulation` is the gameplay composition root and the public command and
  read-model surface. Cross-feature ordering belongs there; feature rules do
  not.
- `prototypeConfig` is the validated live tuning store. Test helpers supply
  isolated values, while named world-profile helpers supply benchmarks and
  scale fixtures. World-shape changes take effect only by explicit regeneration.
- `WorldGenerator` owns plan, rasterize, and analyze stages. `WorldManifest` is
  durable generated identity; `WorldGrid` is runtime tile authority;
  `WorldAnalysisIndex` is the shared source for connectivity and coastline
  analysis.
- `WorldSpatialIndex` owns deterministic chunk buckets.
  `WorldDescriptorRegistry` adapts heterogeneous descriptors at composition;
  feature systems remain responsible for exact range, state, and approach
  checks.
- `MovementAuthority` and return queries remain synchronous authority.
  `ForwardRangeSystem` owns exact forward-range mechanics; `GameSimulation`
  owns cooperative scheduling and publication of derived guidance.
- `WayfindersScene` owns Phaser lifecycle and one `ActiveChunkSet`. Its deltas
  bound chunk-local terrain, overlay textures, markers, and authored home-island
  objects. Shared package textures and the player-boat visual remain a small
  scene-owned set. Feature-specific presentation belongs in controllers and
  renderers.
- Asset tools share runtime package validation and presentation factories. They
  do not create another gameplay simulation or infer collision from pixels at
  runtime.

Diagnostics are distributed with their owner: simulation traces and counters
live in `core`, presentation/resource counters in `WayfindersScene` and its
renderers, and output adaptation in `src/developerLog.ts`. Diagnostics never own
authoritative mutation.

## Feature folder convention

Each feature package lives under `src/wayfinders/features/<feature>` and exposes
one intentional `index.ts`. Commands, contracts, selectors, mutation results,
and renderer-neutral presentation adapters may be public. State and system
implementation remain private unless deliberately exported.

Feature unit tests use small explicit worlds and do not instantiate Phaser or
`GameSimulation`. Run `npm.cmd run check:architecture` to enforce feature and
presentation boundaries.

## Change-location rule

A normal feature change belongs in one feature folder, its tests, and at most
one composition or registration point. If a change requires domain decisions
in `GameSimulation` and presentation decisions in `WayfindersScene`, define or
reuse a command, selector, mutation result, or presentation adapter first.
