# Wayfinders architecture map

This is the first stop for deciding where a code change belongs. It documents
current ownership, public seams, and dependency direction. Runtime and gameplay
behavior belongs in `Wayfinders_Technical_Design.md`.

## Startup order

1. `src/main.ts` selects the game, asset-library, or isolated-trial application
   mode and supplies validated prototype configuration. Game and asset-library
   modes also load the shared audio catalog once; a catalog failure is retained
   as an explicit silent/unavailable result rather than blocking startup.
2. In game mode, `GameSimulation` plans a `WorldManifest`, rasterizes
   `WorldGrid`, builds one `WorldAnalysisIndex`, and composes gameplay features.
3. `WayfindersScene` creates game presentation and translates input into
   simulation commands.
4. The asset-library mode resolves a typed asset-workspace registry and starts
   one workspace-scoped library, Great Hall, or Audio preview scene without
   gameplay simulation. The trial mode starts `AssetTrialScene` with one
   isolated open-water `WorldGrid`, movement authority, and selected candidate.
5. Presentation controllers and renderers consume read models, revisions, and
   the shared active-chunk delta where applicable.
6. Diagnostics and development tools consume bounded read models and counters;
   they do not own gameplay state.

## Ownership

| Area | Owns | Must not own |
| --- | --- | --- |
| `config` | validated prototype tuning values and change notification | live gameplay state |
| `world` | named scale profiles, manifests, generation, logical tiles, analysis, and spatial indexes | Phaser objects |
| `navigation` | collision topology, movement authority, and route/range mechanics | feature rewards or UI |
| `exploration` / `features` | feature state, commands, selectors, and mutation results | scene lifecycle |
| `core` / `app` | `GameSimulation` composition and deterministic cross-feature ordering | feature-specific presentation rules |
| `audio` | validated stored-audio catalog contracts, renderer-neutral gain state, and bounded voice-accounting policy | Phaser objects, gameplay authority, decoded media, or repository writes |
| `rendering` | Phaser lifecycle, resource activation, and read-model adaptation | authoritative gameplay decisions |
| `assets` | typed asset workspaces, semantic package and candidate contracts, loading, preparation, local authoring, island availability, general-family review/promotion, isolated trials, and play-only stored-audio preview | navigation authority outside declared collision metadata, gameplay-session state, or audio creation/editing/mixing/writes |

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
not import Phaser. The renderer-neutral `audio` policy is consumed by both the
Phaser audio adapter and the play-only asset workspace; only the rendering
adapter may own Phaser sound instances.

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
  objects. Its independent `CloudLayerRenderer` consumes the same delta and the
  knowledge overlay's pure current-clear predicate and owns bounded
  cloud/shadow sprite pairs whose creation and motion are independent of fog.
  Fog affects only whether a pair's current padded footprint is presented; live
  sight can uncover a moving pair without rebuilding it. The renderer owns a
  bounded live frequency of zero through twelve pairs per active chunk and
  deterministically rebuilds only its resources when that debug value changes.
  The scene supplies
  only the home landmark's presentation position so the home-centre chunk can
  replace its ordinary candidates with three opening routes; fog and simulation
  rules never depend on clouds. Shared package textures, the
  player-boat visual, and the four-frame cloud sheet remain a small scene-owned
  set. Feature-specific presentation belongs in controllers and renderers.
- `src/wayfinders/audio/index.ts` is the public stored-audio and mixer seam. It
  validates the canonical catalog, resolves catalog-relative runtime URLs, and
  owns in-memory master/category gain plus bounded deterministic voice
  decisions. `src/wayfinders/rendering/audio/index.ts` adapts that policy to
  Phaser preload/playback/unlock and owns every created sound instance through
  scene teardown. Neither seam imports or mutates `GameSimulation`.
- Asset tools share runtime package validation, presentation factories, and the
  accepted hybrid collision contract. Narrow same-origin development-server
  operations serialize source intake, candidate save or deletion, review, and exact-
  fingerprint promotion. The disposable candidate trial owns only an isolated
  open-water `WorldGrid`, movement authority, and candidate presentation; it
  does not create `GameSimulation`, mutate the runtime world catalog, or add a
  gameplay-persistence seam.
- `AssetWorkspaceRegistry` is the asset-library composition seam. The shell owns
  accessible tab navigation, URL history, and the three permanent mount regions.
  Library workspaces own their catalog partition, collision profiles,
  namespaced selection, and scene lifetime. The view-only Great Hall workspace
  validates and varies a checked-in twenty-generation V1 fixture, then passes it
  to the same bounded semantic renderer used by the game. A pure adapter maps
  structured `GreatHallChronicle` fields into that contract; neither host gives
  the fixture or renderer gameplay authority. `AssetWorkspaceSceneFactory` selects the isolated scene
  kind at composition. Stopping a workspace aborts its DOM listeners and Phaser
  bindings before another workspace starts.
- The Audio workspace adapts the same validated catalog used by game mode and
  creates one browser media element only for the selected stored file. It owns
  playback, pause/resume, stop, browser-reported timing, and teardown only; it
  exposes no upload, creation, metadata edit, mix, or repository-write seam.
- The Islands workspace owns its focused properties, availability-status,
  sea-trial, collision, and imported-island deletion UI. Its save and guarded
  deletion adapters commit through rollback-safe repository transactions.
  `availableAuthoredIslandCatalog`
  exposes only validated, stable-ID-ordered planning inputs; repository
  fingerprints remain private and review/promotion do not apply to islands.
- `WorldGenerator` accepts the renderer-neutral authored-island catalog at
  composition. It owns deterministic selection without replacement, bounded
  placement, manifest provenance, exact saved-mask rasterization, and
  procedural shortfall. World code does not import asset-pipeline modules.
- `availableAuthoredIslandPresentationCatalog` is the presentation-only sibling
  snapshot of prepared visible layers. `WayfindersScene` preloads it and
  `WorldRenderer` resolves manifest-recorded asset IDs, aligns layers to planned
  collision bounds, and owns them with the island centre's active chunk.
  Missing or revision-mismatched presentation falls back coherently to developer
  graphics; it never changes world or navigation authority.

Diagnostics are distributed with their owner: simulation traces and counters
live in `core`, presentation/resource counters in `WayfindersScene` and its
renderers, and output adaptation in `src/developerLog.ts`. Diagnostics never own
authoritative mutation. The cloud enable switch and telemetry are scene-owned
presentation diagnostics and never enter `GameSimulation.debug`.

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
