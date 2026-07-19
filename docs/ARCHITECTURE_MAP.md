# Wayfinders architecture map

This is the first stop for deciding where a code change belongs. It documents
current ownership, public seams, and dependency direction. Runtime and gameplay
behavior belongs in `Wayfinders_Technical_Design.md`.

## Startup order

1. `src/main.ts` selects the game, asset-library, or isolated-trial application
   mode and supplies validated prototype configuration. Game and asset-library
   modes also load the shared audio catalog once; a catalog failure is retained
   as an explicit silent/unavailable result rather than blocking startup.
2. In game mode, `GameSimulation` plans a two-axis-wrapping `WorldManifestV2`,
   rasterizes the canonical `WorldGrid`, builds one topology-aware
   `WorldAnalysisIndex`, resolves the presentation-only
   `GeneratedWaterLayout`, and composes gameplay features.
3. `WayfindersScene` creates game presentation and translates input into
   simulation commands.
4. The asset-library mode resolves a typed asset-workspace registry and starts
   one workspace-scoped library, Icons, Great Hall, Audio, Water, or Clouds preview scene
   without gameplay simulation. The Water workspace starts `WaterPreviewScene`
   over the validated water package
   and real seeded generated-water facts, without creating gameplay simulation.
   The Icons workspace starts `AchievementIconPreviewScene` over the exhaustive
   presentation-kind catalog and checked-in animated sheet without creating
   gameplay simulation or an asset-authoring path.
   The trial mode starts `AssetTrialScene` with one explicitly bounded
   open-water `WorldGrid`, movement authority, and selected candidate.
5. Presentation controllers and renderers consume read models, revisions, and
   the shared active-chunk delta where applicable.
6. Diagnostics and development tools consume bounded read models and counters;
   they do not own gameplay state.

## Ownership

| Area | Owns | Must not own |
| --- | --- | --- |
| `config` | validated prototype tuning values and change notification | live gameplay state |
| `world` | explicit topology, canonical/lifted coordinate primitives, named scale profiles, manifests, generation, logical tiles, analysis, and spatial indexes | Phaser objects |
| `navigation` | collision topology, movement authority, and route/range mechanics | feature rewards or UI |
| `exploration` / `features` | feature state, commands, selectors, and mutation results | scene lifecycle |
| `core` / `app` | `GameSimulation` composition and deterministic cross-feature ordering | feature-specific presentation rules |
| `audio` | validated stored-audio catalog contracts, renderer-neutral gain and sailing-ambience state, and bounded voice-accounting policy | Phaser objects, gameplay authority, decoded media, hidden-world queries, or repository writes |
| `rendering` | Phaser lifecycle, lifted view placement, periodic image activation, resource ownership, and read-model adaptation | authoritative gameplay decisions |
| `assets` | typed asset workspaces, semantic package and candidate contracts, loading, preparation, local authoring, island availability, general-family review/promotion, isolated trials, and play-only stored-audio preview | navigation authority outside declared collision metadata, gameplay-session state, or browser audio creation/editing/mixing/writes |

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
- `WorldTopology` owns per-axis boundary behavior, canonicalization,
  minimum-image displacement, direction-preserving cardinal steps, wrapped
  bounds decomposition, and periodic chunk-image enumeration. Generated game
  worlds use `WRAPPING_WORLD_TOPOLOGY`; authored collision canvases, isolated
  sea trials, and other named asset contexts use `BOUNDED_WORLD_TOPOLOGY`.
- `WorldGenerator` owns plan, rasterize, and analyze stages. `WorldManifestV2`
  is durable generated identity and records topology, exact wrapped island
  footprints, and explicit water-ribbon image offsets; `WorldGrid` is canonical
  runtime tile authority;
  `WorldAnalysisIndex` is the shared source for connectivity and coastline
  analysis; `WaterTypeCatalogV1`, `WaterLayoutPlanner`, and
  `GeneratedWaterLayout` own renderer-neutral water presentation facts after
  periodic analysis without changing terrain authority. Generated arrays and
  chunk snapshots stay canonical. Transition masks are
  directional and currently governed by the deep-to-coastal atlas contract,
  rather than treating every different neighbour as a compatible blend pair.
- `WorldSpatialIndex` owns deterministic canonical chunk buckets, periodic
  footprint decomposition, split seam queries, deduplication, and minimum-image
  nearby ordering.
  `WorldDescriptorRegistry` adapts heterogeneous descriptors at composition;
  feature systems remain responsible for exact range, state, and approach
  checks.
- `MovementAuthority` publishes canonical final state plus the accepted lifted
  displacement, whole-world image offset, ordered canonical tile entries, and
  short lifted travel segments. Collision and `GridGraph` consume the same
  direction-preserving topology edges. Return paths retain edge image offsets
  for presentation while return queries remain synchronous authority.
  `ForwardRangeSystem` owns exact forward-range mechanics; `GameSimulation`
  owns cooperative scheduling and publication of derived guidance.
- `WayfindersScene` owns Phaser lifecycle, one `LiftedViewAnchor`, and one
  `ActiveChunkSet`. The view anchor consumes accepted movement displacement;
  canonical endpoints never infer wrap direction. Each active entry has a
  view identity, a canonical chunk owner, and a whole-world pixel offset. The
  hard `25`-entry cap applies to periodic images, including multiple images of
  one canonical chunk. Its deltas bound terrain aliases, canonical overlay and
  water textures, feature views, and periodic authored-art images. Its
  independent `CloudLayerRenderer` consumes the same delta and the
  knowledge overlay's pure current-clear predicate and owns bounded
  cloud/shadow sprite pairs whose creation and motion are independent of fog.
  Fog affects only whether a pair's current padded footprint is presented; live
  sight can uncover a moving pair without rebuilding it. The renderer owns a
  bounded live frequency of zero through twelve descriptors per referenced
  canonical chunk and deterministically rebuilds only its resources when that
  debug value changes.
  The scene supplies
  only the home landmark's presentation position so the home-centre chunk can
  replace its ordinary candidates with three opening routes; fog and simulation
  rules never depend on clouds. Shared package textures, the
  player-boat visual, and the single 24-frame cloud sheet remain scene-owned.
  Feature-specific presentation belongs in controllers and renderers.
  `WaterRenderer` consumes that same delta and owns exactly one base and one
  surface canvas texture per referenced canonical chunk. Periodic image aliases
  share those textures, aliases add no redraw work, and a visible canonical
  surface redraws at most once per presentation frame. A successfully loaded
  authored-home presentation and each complete, revision-matched imported
  presentation with land/composite ownership and composite/apron water
  ownership claim their canvas plus a
  one-tile collar: the renderer presents deep base water there and suppresses
  the generic tile transition without changing terrain or layout authority.
  Procedural islands and imported presentations without authored water keep
  ordinary generated water. `WorldRenderer` owns the lifted deferred-gap ocean
  backdrop and the periodic authored island planes; it does not draw generic
  water or waves.
- `src/wayfinders/audio/index.ts` is the public stored-audio and mixer seam. It
  validates the canonical catalog, resolves catalog-relative runtime URLs, and
  owns in-memory master/category gain, bounded deterministic voice decisions,
  the allocation-free-on-stable-input wake smoothing and music crossfade/duck
  policies, and the pure event-batch cue priority, cooldown, voice-cap, and
  replacement policy.
  `src/wayfinders/rendering/audio/index.ts` adapts that policy to Phaser
  preload/playback/unlock, batches existing typed game events at a microtask
  boundary, and owns the ocean, wake, home-harbor, and open-water loops plus
  every other created sound instance through scene teardown. `WayfindersScene`
  supplies only current rendered ship speed, exact dock, current Supported-water
  knowledge, expedition state, existing wreck/handover/completion gates, home
  interaction, and accepted presentation actions. Cue and music adapters
  subscribe to the existing `GameEvents`; they do not introduce another event
  bus.
  Neither audio seam imports or mutates `GameSimulation`, scans the world, or
  reads hidden terrain.
- `scripts/generate-audio-assets.mjs` is an offline, deterministic production
  renderer for the complete stored WAV set. It has no runtime imports or
  browser surface and verifies its output paths against the canonical catalog
  before overwriting audio files.
- Asset tools share runtime package validation, presentation factories, and the
  accepted hybrid collision contract. Narrow same-origin development-server
  operations serialize source intake, candidate save or deletion, review, and exact-
  fingerprint promotion. Cloud availability, bounded presentation settings,
  and fixed-slot catalog deletion use their own optimistic runtime-revision
  requests through the same repository lock and atomic-file transaction. The
  disposable candidate trial owns only an isolated
  open-water `WorldGrid`, movement authority, and candidate presentation; it
  does not create `GameSimulation`, mutate the runtime world catalog, or add a
  gameplay-persistence seam.
- `AssetWorkspaceRegistry` is the asset-library composition seam. The shell owns
  accessible tab navigation, URL history, and the three permanent mount regions.
  Library workspaces own their catalog partition, collision profiles,
  namespaced selection, and scene lifetime. The Water workspace is a focused
  production inspection surface that reads the validated runtime water package
  and the same seeded `GeneratedWaterLayout` facts as the game. Its zoom, seed,
  overlay, and pause controls own no package, terrain, or gameplay authority.
  The Clouds workspace reads the validated cloud package, lists its non-deleted
  fixed frame slots, and projects the same pure chunk-descriptor and route model
  as `CloudLayerRenderer` over a real seeded `96 x 96` generated world. Its
  bounded live draft owns package frequency, density, opacity, scale, motion,
  and paired-shadow transform. The starting chunk uses the same seeded slots as
  every other chunk and has no landmark-specific descriptor seam.
  Preview seed, speed, guides, and pause are local inspection controls. One
  guarded save atomically persists the complete settings draft together with
  the selected frame's availability; guarded deletion remains a separate
  fixed-slot operation. The workspace cannot edit atlas geometry, tints,
  layer depths, fog coverage, debug state, terrain, or gameplay state. A
  deleted slot remains `null` so physical frame identities never shift.
  The view-only Icons workspace consumes one exhaustive typed mapping from the
  ten Great Hall presentation kinds to sprite-sheet rows. It presents every
  loop together with preview-only pause and speed controls; the shared semantic
  Great Hall renderer consumes the same sheet and mapping. Neither surface may
  derive achievement identity from pixels. The view-only Great Hall workspace
  validates and varies a checked-in twenty-generation V1 fixture, then passes it
  to the same bounded semantic renderer used by the game. A pure adapter maps
  structured `GreatHallChronicle` fields into that contract; neither host gives
  the fixture or renderer gameplay authority. `AssetWorkspaceSceneFactory`
  selects the isolated scene kind at composition. Stopping a workspace aborts
  its DOM listeners, cancels
  its preview-local animation frame, and removes its Phaser bindings before
  another workspace starts.
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
  collision bounds, and activates each visible periodic image by footprint
  intersection. A single `island-composite` plane may carry land and its
  authored water transition together; optional `water-apron`, ordinary land,
  and `shore-effect` planes render at depths `1.7`, `4.x`, and `4.75`
  respectively. One canonical descriptor and prepared texture set back every
  image view, even when the descriptor's canonical centre is outside the
  viewport.
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
