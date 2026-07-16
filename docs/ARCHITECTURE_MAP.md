# Wayfinders architecture map

This map is the first stop for agents deciding where a change belongs. It
describes current ownership and the dependency direction being introduced by
the AM architecture track. Detailed implemented gameplay contracts remain in
Wayfinders_Technical_Design.md.

## Startup order

1. src/main.ts resolves application mode and creates the session configuration.
2. GameSimulation plans a versioned WorldManifest, rasterizes logical tiles,
   builds one WorldAnalysisIndex, and seeds features from that shared index.
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

- GameSession is the command/read-model boundary. It returns typed
  SessionMutation revision flags and retains `compatibilitySimulation` only so
  presentation can migrate incrementally.
- GameSimulation remains the gameplay composition facade. New feature code is
  registered through a feature public barrel; fishing is the reference slice.
- SessionConfig is an immutable, isolated startup value. SessionBuilder and
  tests/support/TestSessionBuilder are the supported construction paths.
- prototypeConfig remains only as the live developer-panel compatibility
  input. GameSimulation no longer changes it during regeneration.
- WorldGrid chunks are storage units, not presentation activation. AM-3 and AM-5
  separate descriptor lookup from the later active-chunk lifecycle boundary.
- WorldSpatialIndex is the reusable deterministic chunk-bucket index.
  WorldDescriptorRegistry is the composition-owned heterogeneous adapter;
  feature systems still perform exact sight, range, state and approach checks.
- GameSimulation coalesces all interaction lookups per ship tile and all
  visibility lookups per visibility revision. Feature read-model arrays are
  revision-cached and built from local candidates plus known record IDs.
- WayfindersScene remains Phaser's lifecycle owner while presentation
  controllers are extracted by feature. Stationary viewports skip marker scans,
  diagnostics use a narrow cached projection, and PresentationWorkMonitor
  exposes query/change/marker/time counters.
- WorldGenerator has explicit plan, rasterize, and analyze stages. Its
  canonical WorldManifest is durable identity; WorldGrid remains runtime
  authority. Fishing, surveys, and dossiers reuse WorldAnalysisIndex instead
  of adding feature-owned connectivity or coastline scans.

## Feature folder convention

Each migrated feature lives under `src/wayfinders/features/<feature>` and has
one public `index.ts`. Contracts and renderer-neutral presentation adapters are
public seams. Commands, selectors, state and system modules are private details
re-exported deliberately from the public index when needed. Feature unit tests
use small explicit worlds and never instantiate Phaser or GameSimulation.

Run `npm run check:architecture` to enforce these rules. The checker rejects
Phaser/rendering imports from features and private cross-feature or presentation
imports with a file, line and suggested public boundary.

## Change-location rule

A normal feature change belongs in one feature-owned folder, its tests, and at
most one composition/registration point. A change requiring edits to both
GameSimulation and WayfindersScene is a signal to define or use a command,
selector, mutation result or presentation adapter first.
