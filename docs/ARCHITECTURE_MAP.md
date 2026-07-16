# Wayfinders architecture map

This map is the first stop for agents deciding where a change belongs. It
describes the settled ownership and dependency direction after AM-0 through
AM-6 and their consolidation pass. Detailed implemented gameplay contracts
remain in Wayfinders_Technical_Design.md.

## Startup order

1. src/main.ts resolves application mode and supplies the validated prototype
   tuning configuration.
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
| config | validated prototype tuning values and change notifications | live gameplay state |
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

## Settled runtime seams

- GameSimulation is the gameplay composition root and public command/read-model
  surface. It owns deterministic cross-feature ordering. Feature-specific
  behavior is registered through a public feature barrel; fishing is the
  reference slice.
- prototypeConfig is the deliberate live developer-tuning store. Validation is
  transactional through `patchPrototypeConfig`; tests use isolated values from
  `makeConfig`. World-shape changes take effect through explicit regeneration,
  and systems that support live tuning refresh their derived values.
- WorldGrid chunks are compact authoritative storage units, not presentation
  activation. Descriptor lookup and the active-chunk presentation lifecycle are
  separate concerns.
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
- WayfindersScene owns one ActiveChunkSet derived from the camera. Its bounded
  delta drives terrain, authored home art, knowledge/risk textures, and every
  marker pool. Renderers expose resource telemetry but cannot independently
  widen their lifetime. The ocean backdrop is the deterministic placeholder
  while visible-first activation catches up.
- GameSimulation is the sole ForwardGuidance scheduler and publisher. It
  coalesces requests by revision token, advances one cooperative exact-search
  slice per frame, rejects stale world/knowledge/visibility/origin/provision
  inputs, reclips the sparse frontier to the latest heading, and atomically
  swaps a completed inactive result buffer. MovementAuthority and ReturnQuery
  remain synchronous authority; ForwardGuidance is derived presentation data.
- ForwardRangeSystem owns the exact synchronous query, the sole resumable
  runtime task, and two reusable inactive buffers. Provision travel costs are
  validated to an exact integer scale of at most four decimal places;
  BucketedCostSearch owns resumable queue mechanics.
  A guidance behavior change belongs there and in focused equivalence tests;
  scheduling/publication policy belongs in GameSimulation. A worker or route
  hierarchy requires a new measured budget miss and is not a default extension.

## Feature folder convention

Each feature package lives under `src/wayfinders/features/<feature>` and has
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
