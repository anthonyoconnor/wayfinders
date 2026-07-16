# Architecture milestones for a larger Wayfinders world

Audit date: 2026-07-14
Repository snapshot reviewed: Git HEAD 4c2351d, with unrelated asset-package work occurring concurrently
Original scope: architecture and test audit only; no existing source, test, configuration, or asset file was modified during the audit
Implementation status (2026-07-15): AM-0 through AM-6 are implemented, acceptance-tested, and consolidated. AM-7 remains deferred until gameplay persistence is explicitly authorized.

## Executive conclusion

The audit found that ordinary movement math was not the cause of sluggish sailing. The dominant hitch occurred when the ship entered a new tile: GameSimulation synchronously recomputed forward range, and that search repeatedly performed collision geometry work for thousands of graph edges. Ordinary simulation updates were well below a millisecond, while a tile-entry update was commonly around 100–200 ms. At the configured speed of 2.5 tiles per second, that created a visible hitch about every 400 ms.

AM-1 made topology and collision eligibility cacheable. AM-6 made forward guidance a revisioned cooperative service on the only production path after measurement showed caching alone did not meet the frame budget. Movement and authoritative return-to-home checks remain synchronous and deterministic.

For the larger game, a full distributed-world or entity-component-system rewrite is not warranted. A 384 by 384 logical grid is only 147,456 cells and can remain resident as compact authoritative data. The scaling problems are instead eager generation, island placement, retained rendering commands and textures, global interaction scans, repeated world-analysis passes, and two very large orchestration classes. The recommended target is a data-oriented, chunk-activated architecture:

- an explicit, validated prototype tuning configuration;
- a deterministic WorldManifest and compact chunked WorldGrid;
- one shared WorldAnalysisIndex and WorldSpatialIndex;
- synchronous movement and return validation;
- derived, revisioned forward guidance;
- an ActiveChunkSet controlling renderer, overlay, asset, and marker lifetime;
- feature-owned commands, selectors, state, and presentation adapters;
- one explicit GameSimulation composition root with feature-owned behavior behind narrow public APIs.

The milestones reached this architecture incrementally while keeping the game playable. Their historical scope and the final settled decisions are recorded below.

## Audit method and limits

The review covered source structure, configuration access, world generation, navigation, collision checks, rendering and overlays, feature interaction queries, diagnostics, and the complete test suite. Small, temporary benchmark programs were used to time simulation phases at prototype and larger dimensions; they were removed after use.

The performance numbers in this document are diagnostic measurements from one development machine and a development build. They are useful for identifying order-of-magnitude problems, not as portable release benchmarks. During the audit, other processes changed island collision/package assets. Full-suite runs therefore did not have a stable repository snapshot and produced different late-run results. Navigation-focused tests were stable. Milestone AM-0 established a quiet, repeatable baseline before any result was treated as a gate.

## Architecture at the audit snapshot

The audited runtime had a direct, understandable startup path, but too much ownership accumulated at its center:

1. src/main.ts reads the prototype configuration and constructs GameSimulation before Phaser starts.
2. GameSimulation creates/generates the world and owns navigation plus many feature systems.
3. WayfindersScene reads simulation state, drives input and camera behavior, updates most presentation systems, and produces diagnostics.
4. WorldRenderer and overlay renderers eagerly prepare data for all loaded chunks.
5. Many features independently scan or analyze the whole world at construction time and scan all feature definitions during interaction.

The largest architectural pressure points are:

| Area | Current concentration | Consequence |
| --- | --- | --- |
| Simulation orchestration | src/wayfinders/core/GameSimulation.ts, about 1,789 lines | Navigation, feature lifecycle, mutations, queries, and snapshots share one change surface |
| Scene orchestration | src/wayfinders/rendering/WayfindersScene.ts, about 2,155 lines | Input, camera, presentation synchronization, viewport work, and diagnostics are tightly coupled |
| Asset viewer | src/wayfinders/assets/AssetViewerScene.ts, about 2,195 lines | Another large agent-unfriendly ownership boundary |
| Configuration | src/wayfinders/config/prototypeConfig.ts is a mutable singleton imported broadly | Tests and sessions can leak state; rendering and domain code depend on global configuration |
| World storage | WorldGrid has chunks, but reads can implicitly create them | Chunking is storage organization, not a lifecycle or streaming boundary |
| Rendering | terrain and overlays build work for the whole loaded world | CPU/GPU memory grows with total world size rather than visible world size |
| Feature discovery | dossier, survey, fishing, and related systems perform separate analyses/scans | Startup work and maintenance cost grow once per feature |
| Tests | 46 files, 367 tests, about 9,916 lines versus about 22,203 source lines | Broad protection, but slow feedback and substantial fixture/lifecycle duplication |

The current code is not a failed architecture. It is a productive prototype architecture that has reached the point where central orchestration and eager work are becoming constraints.

## Navigation responsiveness audit

### Measured behavior

Representative timings from transient instrumentation were:

| Operation | 96 by 96 prototype | 384 by 384 experiment |
| --- | ---: | ---: |
| Ordinary GameSimulation update, median | about 0.035 ms | about 0.059 ms |
| Tile-entry update, median | about 114 ms | about 199 ms |
| Tile-entry update, observed p95 | about 141 ms | about 384 ms |
| Forward-range phase per crossing | about 129 ms average | about 137 ms average |
| Movement phase per crossing | about 0.04 ms | about 0.02 ms |
| Visibility phase per crossing | about 1.15 ms | about 0.56 ms |
| Return-range phase per crossing | about 1.03 ms | about 0.36 ms |

The absolute timings varied under concurrent machine load, but the attribution was consistent: forward-range calculation was two to three orders of magnitude more expensive than an ordinary update and dominated the tile transition.

### Primary bottleneck

The relevant flow is:

- GameSimulation.update detects a tile change around src/wayfinders/core/GameSimulation.ts:566.
- It recalculates navigation ranges around GameSimulation.ts:1763.
- ForwardRangeSystem performs a Dijkstra-style search in src/wayfinders/exploration/ForwardRangeSystem.ts:99.
- GridGraph.canTraverseKnownCardinalEdge in src/wayfinders/navigation/GridGraph.ts:119 calls filtered collision geometry for explored edges.
- That path does not benefit from the exact static-edge cache used by another GridGraph path around GridGraph.ts:82.

The configured unknown-tile cost is 0.2 and a voyage budget can be 12. That permits a horizon of roughly 60 unknown tiles. On the small prototype map, the forward search therefore explores much of the world. Audit runs saw roughly 7,700 to 10,100 candidate nodes around a crossing. For many candidate edges, fresh collision filtering/geometric intersection is performed.

This explains both parts of the symptom: sailing is smooth between tile boundaries and then pauses sharply at a regular cadence.

### What is not the primary bottleneck

MovementSystem and CollisionGeometry use a bounded swept-segment check against nearby collision data. Their measured contribution was tiny relative to forward guidance. Replacing the movement integrator, changing fixed-step frequency, or introducing a physics engine would add risk without addressing the measured hitch.

The return-range calculation is currently inexpensive at prototype scale. It is also authoritative: survey affordability depends on it in GameSimulation.ts around lines 444–449. It should not be made eventually consistent merely to resemble forward guidance.

### Secondary play-feel contributors

After the CPU hitch is removed, two behaviors may still make control feel softer than desired:

- WayfindersScene starts camera follow with roundPixels enabled and a 0.08 horizontal/vertical lerp around line 247, while the game also uses fractional zoom around lines 352–357. Soft follow plus rounding can add visible lag or small stepping.
- A glancing collision truncates displacement and sets speed to zero in MovementSystem around lines 133–161. This is deterministic and safe, but feels sticky against coastlines.

These are tuning issues, not reasons for the large periodic stall. Address them only after measuring the optimized tile-entry path.

### Recommended navigation design

Use three explicitly different services:

1. MovementAuthority
   - Runs synchronously in the fixed simulation step.
   - Owns exact swept collision and the authoritative ship transform.
   - Has a hard, bounded local-work guarantee.

2. ReturnQuery
   - Runs synchronously when inputs that affect affordability change.
   - Uses exact topology/costs because gameplay commands depend on the answer.
   - Caches by world topology revision, knowledge revision, origin, and resource budget.

3. ForwardGuidance
   - Is derived UI/advice, not authority.
   - Requests are keyed by origin, budget, topology revision, knowledge revision, and relevant ship capabilities.
   - Multiple requests are coalesced; only the newest result is publishable.
   - The last complete result stays visible while a new one is computed.
   - Stale results are discarded rather than applied.
   - It runs incrementally; a worker is justified only by a new measured budget miss.

The first implementation step is a knowledge-aware edge/topology cache. Collision packages and static coast geometry do not change every tile. Resolve an edge into a small traversal classification once per relevant topology/collision revision, then combine it with knowledge and capability rules without re-running general collision geometry. Because voyage costs are discrete and bounded, evaluate a bucketed shortest-path algorithm after caching; it may reduce heap and allocation overhead. Avoid sorting or copying every reachable entry when the consumer needs only buckets, boundaries, or a compact reachability mask.

Acceptance budgets for this work are defined in AM-1.

## Four-times-larger world audit

### Capacity targets

The phrase four times bigger is ambiguous: four times the width and height is sixteen times the area. Architecture work should use explicit tiers:

| Tier | Grid | Area versus prototype | Island target | Purpose |
| --- | ---: | ---: | ---: | --- |
| P0 | 96 by 96 | 1 times | 8 | Current prototype and fast tests |
| P1 | 192 by 192 | 4 times | 32 normal, 100 stress | Intermediate integration target |
| P2 | 384 by 384 | 16 times | at least 300 normal, 500 stress | Intended large-world architecture gate |

If product intent meant four times total area, P1 satisfies it. Designing and testing P2 prevents an accidental architecture ceiling.

### Generation observations

Indicative audit timings were:

| Construction work | P0 | P1 | P2 |
| --- | ---: | ---: | ---: |
| World generator at 8 / 32 / 128 islands | about 115 ms | about 164 ms | about 768 ms |
| Full GameSimulation construction | about 558 ms | about 1.07 s | about 2.85 s |

A 384 by 384 generation attempt targeting 300 islands failed around island 111 with the current placement constraints. This is more important than the raw timing. IslandGenerator checks candidates against every already placed island around src/wayfinders/world/IslandGenerator.ts:222–281, falls back to a broad map scan, and later performs a full connectivity pass. Current radii and minimum-channel rules cannot reliably pack the requested density.

The solution is not merely a faster loop. The generator needs explicit density and archipelago rules, a spatial hash or blue-noise-style candidate index, deterministic bounded retries, and clear failure diagnostics. Hundreds of islands also require product-level decisions about island size distribution and minimum navigable channels.

### Eager authoritative construction

WorldGenerator and WorldGrid currently create/fill the full grid, and GameSimulation constructs it on the main thread before Phaser starts. For P2, retaining a compact logical grid is acceptable; blocking the first playable frame on every analysis and presentation resource is not.

Introduce a WorldManifest first:

- seed, generator version, dimensions, and normalized generation settings;
- stable island, wreck, shoal, site, and landmark descriptors;
- descriptor bounds and home-chunk membership;
- compact topology/collision package references;
- deterministic IDs independent of generation order;
- a format/version field for future migration.

Then rasterize or load compact logical chunks from that manifest. The session may keep all P2 logical cells resident initially. This deliberately avoids premature authoritative streaming, floating-origin complexity, and cross-chunk simulation races.

### Repeated analysis

IslandDossierCatalog, SurveySiteSystem, FishingShoalSystem, and other features independently scan coastlines, passability, or candidate tiles. Each new feature risks adding another whole-world pass and another subtly different definition of coast or connectivity.

Build one immutable WorldAnalysisIndex during generation/load:

- connected water/passability components;
- coastline and boundary runs;
- candidate tiles grouped by chunk and feature-relevant tags;
- island/chunk and tile/island lookup;
- deterministic bounded top-k selection helpers;
- topology revision and generator provenance.

Features should filter indexed candidates, not rescan the world. The index is a reusable domain asset and should have golden invariant tests.

### Presentation and memory

WorldRenderer scans all tiles and retains Graphics command data for the loaded world. Knowledge and risk overlays allocate textures across all chunks even when most are off screen. At P2 there are 144 chunks with the current 32-tile chunk size.

Using current overlay scales, raw canvases alone are estimated around 50.7 MiB at P2 before GPU copies and framework overhead, versus roughly 3.2 MiB at P0. An active five-by-five chunk neighborhood would be around 9 MiB. Terrain display commands, markers, and asset textures add to that.

Make presentation lifetime depend on an ActiveChunkSet:

- visible chunks plus a configurable prefetch ring;
- create terrain meshes/graphics, overlays, and markers on activation;
- pool or destroy them on deactivation;
- give shared island/asset resources one explicit bounded owner;
- cap texture and decoded-asset budgets;
- use coarse or placeholder visuals until high-detail assets are ready;
- never let renderer reads implicitly create authoritative chunks.

Chunk activation is a presentation concern at first. It does not need to change authoritative simulation storage in the same milestone.

### Global per-frame and per-interaction work

The scene currently updates marker viewports broadly, rebuilds some sets/ribbons, and refreshes diagnostics on a timer. Several interaction queries iterate all definitions. With hundreds of islands and feature points, these costs grow with total content even when the ship is stationary.

WorldSpatialIndex should provide:

- tile or chunk to entity IDs;
- entity ID to home chunk and bounds;
- near-position queries with a small deterministic radius;
- changed-entity and changed-chunk sets;
- separate static and dynamic layers when helpful.

Feature systems publish typed change revisions. Presentation adapters update only changed entities in active chunks. Diagnostics should consume counters and sampled summaries, not request a deep simulation snapshot every 100 ms.

## Settled architecture and extension rules

### Design principles

1. Keep authority simple. One deterministic simulation owns gameplay truth.
2. Separate authoritative commands from derived guidance and presentation.
3. Scale work with changed or visible data, not total world content.
4. Prefer explicit, typed boundaries over a generic plug-in framework or full ECS.
5. Preserve a playable build after every future refactor.
6. Make ownership discoverable from paths, names, and one architecture map.
7. Make performance budgets and invalidation rules executable tests.

### Settled module shape

    src/wayfinders/
      config/
        prototypeConfig
      core/
        GameSimulation
        SimulationClock
      world/
        manifest/
        analysis/
        spatial/
        WorldGrid
        WorldGenerator
      navigation/
        MovementSystem
        NavigationTopologyCache
        BucketedCostSearch
      exploration/
        ForwardGuidance
        ReturnPathSystem
      features/
        fishing/
      rendering/
        WayfindersScene
        activation/
        overlays and marker renderers
      diagnostics/
        counters, traces and read models

This is the current ownership map, not an in-progress folder migration. Add a feature package when it gives a product concept a clear public contract; leave stable shared domain services in their existing layer. Move code only as an atomic behavior-preserving refactor with a contract and tests.

### Core responsibilities

GameSimulation is the explicit composition root. It owns the configured world, WorldManifest, indexes, feature systems, command ordering, and public gameplay read models. New feature behavior should enter through a narrow feature API rather than another wrapper around the complete simulation.

prototypeConfig is the validated live tuning store for this prototype. GameSimulation receives a config object explicitly and does not replace it during regeneration. Tests use `makeConfig` or a tiny domain fixture so configuration changes remain isolated. If immutable per-session configuration becomes a product requirement, introduce it as one complete change rather than retaining parallel mutable and immutable APIs.

WorldGrid owns compact logical cells and explicit chunk APIs:

- peek never creates;
- ensure is restricted to construction/loading paths;
- activation is a presentation/resource concept;
- revisions identify topology, knowledge, content, and presentation-affecting changes;
- typed arrays or similarly compact storage are preferred for dense tile fields.

WorldManifest owns durable deterministic descriptors. WorldAnalysisIndex owns immutable derived world facts. WorldSpatialIndex owns fast location and proximity lookup. These three concepts should not collapse into a single mutable world object.

Feature modules own their state, commands, selectors, mutation outputs, and presentation adapter. Cross-feature orchestration belongs in GameSimulation and is ordered explicitly. A feature should not reach into another feature's private state.

Presentation controllers translate read models and revision events into Phaser objects. WayfindersScene remains the Phaser lifecycle boundary but becomes thinner. It should not rediscover domain rules or scan every entity to determine what changed.

### Mutation and invalidation contract

Feature commands return small typed mutation results, while the composition root publishes narrow revision counters for shared derived state. Useful effects include:

- changed tile/chunk/entity IDs;
- old and new ship tile;
- knowledgeRevisionChanged;
- topologyRevisionChanged;
- resourceRevisionChanged;
- feature-specific events.

Consumers subscribe to the narrow revision/event they need. Avoid a universal event bus with untyped strings. Avoid deep equality or full snapshots as an invalidation mechanism.

### Settled ownership map

| Concern | Settled owner | Extension rule |
| --- | --- | --- |
| Cross-feature command ordering | GameSimulation | Add a narrow feature API; do not add a second composition facade |
| Phaser lifecycle | WayfindersScene | Delegate cohesive presentation concerns without duplicating simulation authority |
| Prototype tuning | prototypeConfig plus explicit config arguments | Mutate through validated tooling; use isolated config values in tests |
| Logical cells | WorldGrid | Use explicit non-creating reads outside construction/loading paths |
| Deterministic generation identity | WorldManifest pipeline | Version durable manifest contracts, not every internal type |
| Shared world facts | WorldAnalysisIndex | Add reusable analysis once rather than a feature-owned full scan |
| Nearby descriptors | WorldSpatialIndex and WorldDescriptorRegistry | Query candidates locally, then apply exact feature rules |
| Derived reachable-area advice | ForwardGuidance and ForwardRangeSystem | Schedule cooperatively; keep authority synchronous elsewhere |
| Terrain, overlays and markers | ActiveChunkSet-owned presentation | All resource lifetime follows the same bounded active delta |

## Architecture milestones

### AM-0 — Establish a trustworthy baseline

Status: implemented in `5e01ffd`.

Goal: know whether changes improve the game and whether failures belong to the change.

Deliverables:

- Add a benchmark harness outside gameplay tests for ordinary frames, tile-entry frames, construction phases, generation phases, active chunks, texture count, and memory estimates.
- Record JSON results with config, seed, build mode, machine label, commit, and percentile data.
- Add a deterministic large-world fixture set for P0, P1, and P2.
- Make tests compile under a strict test TypeScript configuration.
- Split quick and full commands without changing behavioral coverage yet.
- Document subsystem ownership, startup order, and approved dependency direction in a short architecture map.
- Obtain three consecutive full-suite runs on a quiet, fixed snapshot.

Exit criteria:

- Zero TypeScript diagnostics in test sources.
- Quick feedback lane completes in under 15 seconds on the reference development machine.
- Three consecutive full runs have identical results.
- The profiler can attribute a tile-entry update by subsystem without editing production files.
- P0/P1/P2 fixtures name all non-default settings explicitly and never mutate global configuration.

### AM-1 — Remove the sailing hitch

Status: implemented in `0796763` and `bbe5c8a`.

Goal: make ship response feel immediate without changing gameplay reachability.

Deliverables:

- Add a revisioned static-edge/topology classification cache.
- Separate MovementAuthority, ReturnQuery, and ForwardGuidance contracts.
- Reduce forward-search allocation/post-processing and evaluate a bucketed cost search.
- Add reachability equivalence tests against the existing implementation over fixed seeds and randomized small grids.
- Add a tile-entry performance test to the performance lane.
- After the CPU budget is met, tune camera rounding/follow and evaluate a single bounded shoreline slide for glancing collisions.

Exit criteria:

- Ordinary and tile-entry movement produce the same authoritative result as the reference implementation.
- Tile-entry main-thread work has p95 below 4 ms in P0 and P1 fixtures.
- Sailing frame time is p95 below 16.7 ms, p99 below 33 ms, with no recurring frame above 50 ms in a five-minute voyage soak on the reference machine.
- First visible response to steering input is below 75 ms.
- No fixed-step time is silently dropped during the soak.

Decision gate:

If cached ForwardGuidance still exceeds 4 ms p95, introduce a versioned incremental job or worker. Do not add worker complexity before this measurement.

### AM-2 — Create agent-friendly ownership boundaries

Status: implemented in `17c3f10` and consolidated in `3080c2d`.

Goal: reduce the number of files and implicit dependencies an AI agent must understand for a feature change.

Deliverables:

- Keep GameSimulation as the one explicit composition and command/read-model boundary.
- Pass configuration explicitly to extracted systems; use isolated `makeConfig` fixtures in tests.
- Define feature folder conventions: contracts, state/system, commands, selectors, renderer/presentation adapter, and tests.
- Extract one representative vertical slice, preferably fishing or surveys, and use it to refine the convention.
- Add import-boundary checks preventing presentation-to-private-domain and cross-feature-private imports.
- Replace stringly invalidation with typed mutation results/revisions.
- Remove extraction scaffolding that has no production caller once the stable boundary is known.

Exit criteria:

- A typical feature behavior change has one obvious owning folder and no need to edit GameSimulation plus WayfindersScene unless orchestration truly changes.
- A new feature can be registered in one explicit composition location.
- Focused feature tests do not instantiate Phaser or the complete generated world.
- Runtime systems receive configuration explicitly; validated developer tooling owns live prototype tuning.
- Architecture/import checks fail with a clear ownership message.

### AM-3 — Make work proportional to local change

Status: implemented in `61e27de`.

Goal: support hundreds of descriptors without scanning all of them per frame or interaction.

Deliverables:

- Add WorldSpatialIndex and chunk membership to static descriptors.
- Add changed-entity, changed-chunk, and revision outputs.
- Convert interaction queries to bounded nearby queries.
- Update ribbons, markers, overlays, and diagnostics from revisions rather than full snapshots/scans.
- Add counters for queried entities, changed entities, active markers, and diagnostics time.

Exit criteria:

- A stationary idle frame performs no work proportional to total island/feature count.
- Interaction-query cost remains bounded in a 500-descriptor stress fixture.
- Presentation work in P2 is within 10 percent of P0 when the active viewport content is equivalent, excluding a separately reported navigation cost.
- Diagnostics stay below their stated budget and do not allocate a deep world snapshot on their refresh interval.

### AM-4 — Build a deterministic high-density world pipeline

Status: implemented and acceptance-tested in `582671c`.

Goal: reliably generate and analyze a P2 world with hundreds of islands.

Deliverables:

- Define versioned WorldManifest and stable ID rules.
- Replace pairwise island-placement checks with a deterministic spatial hash or equivalent local-neighbor index.
- Add explicit density, island-size, archipelago, and minimum-channel profiles.
- Bound placement attempts and emit actionable failure diagnostics.
- Build WorldAnalysisIndex once and route feature placement through it.
- Separate manifest generation, logical rasterization, analysis, and feature seeding into timed phases.
- Allow the first playable region to initialize before nonessential presentation assets finish.

Exit criteria:

- Across at least 100 fixed P2 seeds, the normal profile produces at least 300 islands and satisfies connectivity/channel invariants.
- The 500-island stress profile either succeeds within documented constraints or fails immediately with a deterministic capacity explanation; it never degrades into an unbounded search.
- Same seed, generator version, and settings produce byte-equivalent manifest facts.
- Adding a feature does not add another full-grid coastline/connectivity scan.
- Generation phase budgets are recorded and regression-tested outside the quick lane.

Implementation evidence:

- `WorldGenerator.plan`, `rasterize`, and `analyze` separate stable manifest facts, logical tiles, and one reusable analysis build. GameSimulation records `manifest-generation`, `logical-rasterization`, `world-analysis`, and `feature-seeding` independently.
- `WorldManifestV1` has stable IDs, generator/settings identity, validation, canonical JSON, parsing, and byte-equivalent replay tests.
- `IslandPlacementIndex` replaces pairwise placement scans with deterministic local buckets. Bounded failures carry seed, candidate limits, rejection counts, and index diagnostics.
- Production P0/P1/P2/P2-500 profiles state density, island-size, archipelago, channel, and attempt policies in one source shared by tests and benchmarks.
- The scheduled performance lane rasterized and connectivity-checked 100 fixed P2 seeds with 300 islands each, plus the 500-island stress profile: 106 tests passed in 26.95 seconds (24.80 seconds test work) on the local audit machine.
- A same-machine one-sample P2 comparison reduced construction from 5,550 ms to 1,190 ms and feature seeding from 3,594 ms to 442 ms. The split phases measured 29.5 ms manifest planning, 442.0 ms rasterization, and 212.8 ms analysis. Trend runs, not this single sample, remain the regression authority.

### AM-5 — Activate presentation by chunk

Status: implemented and acceptance-tested in `91a24ce`.

Goal: make renderer and asset memory follow the viewport, not total world area.

Deliverables:

- Introduce ActiveChunkSet with a visible region and prefetch ring.
- Activate/deactivate terrain, knowledge/risk overlays, markers, and island art through that set.
- Pool cheap display objects and give every expensive resource an explicit bounded owner.
- Add texture/decoded-asset budgets and eviction telemetry.
- Add low-detail placeholders and deterministic load priority.
- Test seams and overlay continuity at chunk boundaries and during rapid camera movement.

Exit criteria:

- With a five-by-five active budget, terrain/overlay/marker object counts plateau rather than grow while crossing the world.
- Off-screen chunk textures and unique island resources are released or remain within a documented cache cap.
- A coast-to-coast P2 voyage has stable memory after warm-up.
- No visible missing seams, stale overlays, or marker duplication occurs during activation churn.

Implementation evidence:

- One camera-derived ActiveChunkSet owns a visible region, one-chunk prefetch ring, deterministic priority, deferred-placeholder demand, and a hard 25-chunk cap.
- WorldRenderer iterates active chunk bounds only, destroys chunk graphics/authored art on deactivation, and reports active objects, visited tiles, activations, releases, and peaks.
- Knowledge and risk overlays release Phaser sprites and canvas textures immediately. At the cap they retain at most 25 knowledge plus 50 risk textures, with decoded backing-store estimates and allocation/release telemetry.
- Wreck, dossier, survey, and fishing renderers use a shared chunk-indexed view pool with exact identity, bounded inactive pooling, and duplicate prevention. Current shared pilot textures remain scene-owned; a unique-asset cache will be added only when a real consumer and decoded-resource budget exist.
- Focused activation, renderer, overlay, seam, and lifetime suites passed 32 tests; the scheduled coast-to-coast P2 resource model also passed and peaked at 25 active chunks with zero deferred visible chunks.
- The P2 benchmark models 75 active overlay textures and 9.22 MB of canvas backing stores at the cap, rather than 432 textures and 53.12 MB for all 144 logical chunks. GPU/framework overhead remains separately unmeasured.

### AM-6 — Add hierarchy or workers only where evidence requires them

Status: implemented and acceptance-tested in `094f388`; the single production path was finalized in `c86c1de`. The decision gate selected a cooperative, cancellable ForwardGuidance task; hierarchy and workers remain deferred.

Goal: retain architectural simplicity while providing an escape hatch for measured P2 costs.

Candidates:

- hierarchical water-region routing plus exact local refinement;
- worker-based ForwardGuidance;
- worker-based manifest generation/analysis;
- background asset decoding;
- region-level coarse visibility.

Each candidate requires a benchmark showing that AM-1 through AM-5 cannot meet a named budget. Results must carry revisions, be cancellable/coalesced, and be discarded when stale. Authoritative command ordering stays on the simulation thread.

Decision:

- The pre-AM-6 quiet P2 run measured ForwardGuidance at 12.61 ms p95, above the 4 ms main-thread decision budget. A retained 100-request paired run after implementation still measured the exact synchronous oracle at 4.44 ms p95, confirming the gate independently of the earlier sample.
- Keep the exact bucketed search and make its cleanup, queue traversal, candidate construction, comparison, and frontier construction resumable. One bounded task slice runs per frame and builds into one of two inactive result buffers; publication is atomic.
- GameSimulation owns request coalescing and validates request ID, monotonic world epoch, collision, knowledge, visibility, origin, and provision revisions before every slice and publication. Heading does not cancel work; the sparse frontier is clipped to the latest heading at publication so continuous steering cannot starve the task.
- Do not introduce a worker. Keeping a worker synchronized would add world/topology/knowledge transfer protocols and would still require cooperative cancellation. Do not introduce hierarchical routing because exact total compute is already small once it is distributed safely.
- Provision travel costs are validated to at most four decimal places so every accepted configuration has an exact bounded integer scale. Invalid tuning is rejected transactionally instead of silently selecting a one-shot task path.

Exit criteria:

- The selected optimization meets its budget.
- Equivalence/property tests prove that the optimized execution boundary does not change authoritative results.
- Cancellation, coalescing, stale revision rejection, and buffer reuse are deterministic.
- Production has one cooperative scheduling path; the deterministic synchronous query remains the bootstrap and equivalence oracle.

Implementation evidence:

- Benchmark command: `npm run benchmark:architecture -- --profile=P2 --samples=25 --guidance-samples=100 --construction-samples=1 --warmup-crossings=5 --guidance-warmups=20` on the audit machine.
- P2 synchronous oracle: p50 2.80 ms, p95 4.44 ms, p99 4.75 ms. Cooperative main-thread slices: 149 samples, p50 2.67 ms, p95 3.17 ms, p99 3.29 ms; the named 4 ms p95 budget passed. Request CPU p95 was 5.20 ms, distributed across at most three slices in the measured set (two slices p95).
- In the same report, ordinary update p95 was 0.16 ms and synchronous tile-entry p95 was 1.29 ms. No stale result or cancellation occurred in the undisturbed performance sample.
- The scheduled guidance-budget test runs 20 warmups plus 100 P2 requests, compares the cooperative result to the exact synchronous oracle, gates slice p95 below 4 ms, and guards against starvation. Fixed-world tests cover 64 randomized worlds at four slice sizes, exact costs/masks/order, obsolete-task cancellation, atomic publication, visibility-only invalidation, same-seed regeneration epochs, continuous steering, invalid-cost rejection, and 200-request two-buffer reuse.
- The isolated scheduled performance command passed all 6 files and 111 tests in 69.23 seconds, including the 100-seed/500-island generation gates, P0/P1 navigation latency, active-chunk lifetime, and the P2 AM-6 sample. The command pins one worker because concurrent CPU benchmarks produce invalid timing data.
- This local harness does not claim Phaser/GPU frame percentiles, a five-minute real-time voyage soak, or browser Worker behavior. No worker was added. Those remain reference-machine/browser acceptance rather than reasons to complicate the domain architecture now.

### AM-7 — Add persistence after the world model stabilizes

Do not lock in a save format during the preceding extraction. When persistence becomes a product milestone, save generator version, seed, normalized config, stable manifest identifiers, and sparse player/world deltas. Add migration fixtures for every released format. Until then, version only the internal manifest contracts needed for deterministic tests.

## Test architecture audit

### Are all current tests necessary?

No. The suite contains valuable behavioral protection, but its present shape is heavier and slower than an early-stage game needs. The answer is not a mass deletion: several tests guard difficult deterministic behavior that will be essential during future refactors and large-world feature work. Retain tests by risk, consolidate repeated lifecycle matrices, replace implementation-coupled assertions, and keep expensive seed/world sweeps out of the default feedback loop.

High-value tests to retain or strengthen include:

- deterministic island topology and connectivity invariants in tests/islands.test.ts;
- sparse navigation/Dijkstra behavior in tests/config-world-movement.test.ts;
- range-overlay and reachability behavior;
- hybrid collision and connectivity-cache behavior;
- expedition mutation-scope behavior;
- file/API transaction-safety tests;
- deterministic generation and stable-ID properties;
- new equivalence and performance tests for navigation and chunk activation.

Tests that should be consolidated or replaced include:

- repeated, near-identical lifecycle matrices across dossier, site, fishing, and wreck features;
- source-text assertions such as those in tests/asset-app-mode.test.ts, which verify spelling/placement in implementation rather than runtime contracts;
- renderer tests that reach into private fields and construct broad Phaser mock graphs;
- tests that build a complete GameSimulation when a pure feature contract is sufficient;
- large seed sweeps in the default command;
- version assertions for internal structures that are not persisted or externally consumed.

There are currently 67 direct GameSimulation constructions in tests. Many protect cross-feature voyage behavior and remain useful, but new focused feature tests should prefer `makeConfig`, hand-authored WorldGrid/manifest fixtures, or the feature's public constructor. Complete simulation construction belongs in integration-style tests; adding another full-session wrapper would only move the same cost and ownership ambiguity.

### Current reliability findings

The lane split is now implemented in `vitest.config.ts` and exposed through named package scripts. `npm test` is the curated agent loop; `test:contract`, `test:integration`, `test:io`, `test:all`, and `test:perf` make broader ownership explicit. Every current test file belongs to exactly one correctness or performance lane.

The test compiler is part of the full gate. With the concurrently deleted `assets-src/gr3/reviews.json` restored transiently from HEAD, both source and test typechecks pass cleanly; the fixture was removed again after verification. The repository-asset-dependent suites live in the I/O lane, so unrelated asset work cannot block domain-only feedback while the full gate still detects the missing artifact.

After consolidation, the quick lane passed 11 files and 41 tests in 3.72 seconds of Vitest time. The final combined quick/contract/integration/I/O gate passed 74 files and 481 tests in 57.83 seconds. The isolated performance lane passed 6 files and 111 tests in 43.27 seconds. These are development-machine observations, not portable limits.

### Implemented lanes

| Lane | Purpose | Contents | Target |
| --- | --- | --- | ---: |
| quick | Agent inner loop and pre-edit confidence | pure unit, small contract, schema, import-boundary tests | under 15 s |
| integration | Feature wiring and representative GameSimulation flows | tiny fixed manifests, feature interaction, selected rendering adapters | under 30 s |
| io | Filesystem, API, package, and asset transactions | isolated temp directories and explicit asset fixtures | run when relevant and in CI |
| performance | Regression budgets and seed sweeps | P0/P1/P2 benchmarks, voyage soak, generation sweeps, memory counters | scheduled/CI, not default |
| e2e | Small number of player journeys | boot, sail, discover, interact, return | CI or release gate |

Tags or projects should make the lane visible in the test name/config. A failed performance budget must report configuration, seed, phase, median, p95/p99, and reference threshold.

### Test design rules for fast AI development

1. Mirror source ownership. A feature's unit/contract tests live next to or predictably parallel to its owning module.
2. Default to the smallest fixture: a hand-authored 8 by 8 or 16 by 16 manifest, not procedural P0.
3. Construct GameSimulation only for tests that cross feature boundaries; otherwise use the smallest domain fixture or public feature constructor.
4. Put deterministic random/property seeds in the failure message and allow one-command replay.
5. Test public commands, selectors, read models, and emitted revisions. Do not inspect private renderer fields.
6. Maintain a small set of golden world manifests. Do not make every test regenerate the world.
7. Use contract suites sparingly for truly shared behavior, such as discoverable feature lifecycle. Do not build a generic feature framework merely to reduce test lines.
8. Keep exact visual layout in screenshot/golden tests only when it is intentional product behavior; otherwise test presentation inputs and object lifetime.
9. Require strict TypeScript compilation for test code.
10. Quarantine no test silently. Flaky or slow tests move to a named lane with an owner and reason.

### Suggested fixture hierarchy

- tileFixture: a few cells and explicit collision/topology facts;
- navigationFixture: a small graph with known costs/knowledge;
- featureFixture: one island and one or two feature definitions;
- sessionFixture: a tiny WorldManifest with explicit stable IDs;
- prototypeFixture: current P0 seed/config for integration;
- scaleFixture: P1/P2 manifests and seed sets for performance only.

This reduces setup time and makes failures legible to agents. A test should state which fixture tier it needs; construction of a higher tier is a review signal.

## Performance budgets and observability

Budgets should be checked on a named reference machine and compared with trend data, not assumed universal:

| Metric | Initial budget |
| --- | ---: |
| Ordinary simulation update p95 | below 1 ms |
| Tile-entry synchronous work p95 | below 4 ms |
| P2 ForwardGuidance main-thread slice p95 | below 4 ms |
| P2 ForwardGuidance publication | measured separately; scheduled no-starvation ceiling 24 frames |
| Sailing frame p95 / p99 | below 16.7 ms / 33 ms |
| Recurring long frames | none above 50 ms in five-minute soak |
| Visible steering response | below 75 ms |
| Quick test lane | below 15 s |
| Integration lane | below 30 s |
| Idle work versus entity count | no total-world scan |
| Active presentation resources | plateau at configured active-chunk cap |
| P2 normal generation | deterministic, bounded, profiled by phase |

Add counters rather than general-purpose tracing first:

- simulation step and subsystem duration;
- forward nodes, edges, cache hit rate, result revision, stale-result count;
- active/created/destroyed chunks and display objects;
- texture count and estimated bytes;
- nearby-query candidates;
- generation attempts and rejection reason;
- snapshot/read-model construction time and allocation count.

Counters should be readable from diagnostics and benchmark tests without forcing production systems to import a logging framework.

## Maintainability rules for AI-agent development

The codebase should make the answer to “where does this change belong?” obvious.

- Every directory has a short ownership note listing commands, state, selectors, events/revisions, and forbidden dependencies.
- Game rules live in domain modules; Phaser types stop at presentation adapters.
- Runtime configuration is explicit; live prototype mutation is confined to the validated developer-tuning API.
- Public module contracts are small and named by product concepts.
- Generated IDs and ordering are deterministic.
- One composition file shows runtime ordering and feature registration.
- A feature change should normally touch its feature folder, its tests, and at most one registration point.
- Do not retain milestone-only adapters. Long-lived version compatibility must name the external data contract it protects.
- Large files are split by ownership, not by arbitrary line count.
- Architecture decisions with cross-cutting consequences get a short decision record.
- Benchmarks and tiny fixtures are discoverable from the repository's main development instructions.

Avoid a full ECS, generic dependency-injection container, universal message bus, or elaborate plug-in SDK at this stage. Those abstractions make local ownership harder for agents unless the game has demonstrated runtime composition needs that justify them.

## Completed delivery order

1. AM-0 froze the baseline and introduced named fixtures, lanes, typechecking, tracing, and architecture checks.
2. AM-1 cached static topology and separated movement authority, return queries, and derived guidance.
3. AM-2 established GameSimulation as the explicit composition boundary, added typed mutation/revision rules, enforced feature ownership, and extracted a reference fishing slice.
4. AM-3 made interaction, diagnostics, read models, and presentation revision-driven and spatial.
5. AM-4 introduced the versioned manifest, bounded placement, shared analysis, and high-density profiles.
6. AM-5 tied presentation and resource lifetime to one bounded active-chunk authority.
7. AM-6 re-profiled P2 and sliced only the measured derived-guidance miss; it did not add hierarchy or workers.

AM-0 through AM-6 now form the implemented large-world foundation. Product work can build on these seams; AM-7 persistence remains a separately authorized future milestone, and real-browser voyage/frame acceptance remains a release/reference-machine check.

### Post-milestone consolidation

The 2026-07-15 consolidation removed scaffolding that existed only to keep old and new milestone paths alive together:

- `3080c2d` removed the unused GameSession/SessionBuilder/SessionConfig wrapper stack, duplicate fishing adapters and state, duplicate feature-catalog tracing, dead topology/cache helpers, renderer viewport shims, overlay loaded-world fallbacks, a test-only resource cache, profile aliases, and future-only manifest payloads.
- `c86c1de` made cooperative ForwardGuidance the sole production scheduler, removed the deferred/synchronous option and status flag, rejected unsupported travel-cost precision, refreshed exact cost units after live tuning, and renamed milestone-labelled performance tests around the behavior they protect.
- `94e50da` completed the internal reference-image type rename so the removed island-only alias has no remaining caller.
- `3dbaef7` removed the unused synchronous `ForwardGuidance.recalculate` contract, its dead reuse bookkeeping, and the in-place mask-identity test that existed only for that obsolete hot path. Benchmarks now use the retained exact `calculate` oracle.
- ActiveChunkSet deltas are now the only presentation-activation input. GameSimulation is the only gameplay composition root. Fishing has one public feature API. Forward guidance has one runtime scheduling path. No compatibility facade or transition flag remains from AM-0 through AM-6.

Transition-only tests were removed with their owners rather than retained as permanent coverage:

- `game-session.test.ts`, `session-config.test.ts`, and `TestSessionBuilder.ts` were deleted with the unused session wrapper stack.
- Reference-counted cache and old viewport-helper cases were deleted from `presentation-lifetime.test.ts`; that file now covers only the production-used `ChunkActivatedViewPool`.
- Renderer and overlay tests now activate through explicit ActiveChunkSet deltas. `viewport-chunk-region.test.ts` remains because `WayfindersScene` uses that camera-to-region adapter in production.
- The synchronous-guidance compatibility-default test and arbitrary-cost fallback test were removed. Remaining synchronous calculations are bootstrap or exact equivalence oracles for the sole cooperative runtime, not a second scheduler.

This cleanup deliberately did not remove the authored-asset V1 collision fallback. That is a documented external package contract for metadata omission, not milestone migration scaffolding.

## Risks and explicit decisions

| Decision | Recommendation | Reason |
| --- | --- | --- |
| Full authoritative world streaming now | Defer | P2 logical cell count is modest; complexity is not yet justified |
| Floating origin | Defer | A 384 by 384 world at 32 pixels per tile is not large enough to require it |
| Full ECS rewrite | Reject for current roadmap | Migration risk and agent cognitive cost exceed demonstrated benefit |
| Worker for all navigation | Defer after AM-6 measurement | Cooperative exact guidance meets the main-thread slice budget without a world-synchronization protocol |
| Async return affordability | Reject | Gameplay commands require an exact current answer |
| Version every internal type | Reject | Version manifest/persistence/external contracts only |
| Delete most tests | Reject | Consolidate by risk and move slow coverage to appropriate lanes |
| Keep all render resources resident | Reject for P2 | Memory and retained command work scale with total area |

## Evidence index

Key locations reviewed:

- src/main.ts: eager simulation construction before Phaser startup;
- src/wayfinders/config/prototypeConfig.ts: dimensions, movement rates, fixed-step settings, validated live developer tuning, and exact guidance-cost precision;
- src/wayfinders/core/GameSimulation.ts: tile-change recalculation, feature orchestration, snapshots, and return-dependent survey rules;
- src/wayfinders/exploration/ForwardGuidance.ts and ForwardRangeSystem.ts: revisioned cooperative task contract, exact search, inactive result buffers, atomic publication, and invalid-cost rejection;
- src/wayfinders/navigation/BucketedCostSearch.ts: resumable bounded integer-cost queue used by both synchronous and cooperative execution;
- src/wayfinders/navigation/GridGraph.ts: revision-aware cached edge traversal paths;
- src/wayfinders/navigation/MovementSystem.ts: swept movement and collision response;
- src/wayfinders/navigation/CollisionGeometry.ts: local collision queries;
- src/wayfinders/world/WorldGrid.ts: chunk storage and implicit creation behavior;
- src/wayfinders/world/WorldGenerator.ts and IslandGenerator.ts: eager generation, placement, and connectivity;
- src/wayfinders/rendering/WorldRenderer.ts: whole-world terrain preparation;
- knowledge/risk overlay renderers: all-loaded-chunk texture construction;
- src/wayfinders/rendering/WayfindersScene.ts: camera follow, broad presentation synchronization, and diagnostics;
- island dossier, survey site, fishing shoal, and wreck systems: repeated analysis and global interaction scans;
- package.json, vitest.config.ts, tsconfig files, and tests/README.md: explicit quick, contract, integration, I/O, and scheduled performance ownership;
- tests/forward-guidance-task.test.ts, tests/forward-guidance.test.ts, tests/performance/forward-guidance-am6.test.ts, and scripts/architecture-benchmark.ts: exact equivalence, revision/cancellation behavior, buffer plateau, and paired P2 evidence.

## Definition of architectural success

The architecture is ready for the larger game when a P2 session with at least 300 islands:

- starts through bounded, observable phases;
- sails without periodic tile-entry hitches;
- performs idle and interaction work based on nearby/changed content;
- holds presentation memory near the active-chunk budget during a coast-to-coast voyage;
- is deterministic from seed and generator version;
- lets an agent locate a feature's authority, tests, and presentation adapter without reading the full simulation or scene;
- provides a sub-15-second trustworthy inner test loop plus explicit integration and performance gates.

That outcome does not require replacing the prototype wholesale. It requires turning its implicit boundaries—chunks, feature systems, navigation queries, and scene synchronization—into explicit contracts in the order above.
