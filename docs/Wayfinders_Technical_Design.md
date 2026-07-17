# Wayfinders technical design

This document owns current implemented runtime and gameplay contracts. It is
written as present truth: delivery history belongs in
`Wayfinders_Roadmap_Archive.md`, code ownership in `ARCHITECTURE_MAP.md`, and
future scope in `Wayfinders_Roadmap.md`.

## 1. Foundation

Wayfinders is a browser exploration prototype about leaving safe water,
building knowledge through travel, deciding when to return, and passing a
stronger chart to later navigators. The finite world goal is to rediscover and
return the locations of idols lost when the world split into islands. The idols
themselves are not recovered.

The implementation follows these rules:

1. Authoritative gameplay state is independent of Phaser objects.
2. World generation, navigation, knowledge, and feature behavior are
   deterministic and headless-testable.
3. Current sight may reveal presentation without discounting Unknown travel.
4. Only exact-home-dock return commits an expedition.
5. Rendered pixels and animation never become gameplay authority.
6. Stable logical identity and rebuildable derived data preserve future design
   options without creating current compatibility obligations.
7. Normal sailing work is local, sparse, cached, revision-driven, or bounded by
   the active presentation window.

Gameplay-session persistence is not a runtime capability. A launch or refresh
constructs a fresh `GameSimulation`; there is no game save schema, browser game
store, autosave, checkpoint, migration, or restoration path. Repository writes
performed by local asset tools are asset authoring, not gameplay saving.

## 2. Runtime composition

`GameSimulation` is the headless gameplay composition root. It owns generated
world state, movement, knowledge, provisions, expedition lifecycle, lineage,
discoveries, and derived guidance. It exposes commands, read models, revisions,
and typed events without depending on Phaser.

`WayfindersScene` owns Phaser lifecycle. It converts input to simulation
commands, advances the fixed-step clock and cooperative derived work, adapts
read models into presentation controllers, follows the ship, and owns
screen-space UI. It never mutates authoritative arrays directly.

Feature systems own feature rules and state. `GameSimulation` owns explicit
composition and atomic cross-feature ordering. A small typed event bus notifies
presentation after authoritative changes; events are not a second mutation
path. Current module ownership and import direction are defined in
`ARCHITECTURE_MAP.md`.

## 3. Configuration, timing, and scale profiles

`prototypeConfig` is one validated live tuning store. Complete patches validate
before mutation. Test helpers create isolated values; world-profile helpers
supply benchmark and scale-fixture configurations. World-shape changes take
effect through explicit regeneration.

Default prototype values:

| Setting | Value |
| --- | ---: |
| World | `96 x 96` navigation tiles |
| Navigation tile | `32` world pixels |
| Art lattice | `16` world pixels |
| Chunk | `32 x 32` navigation tiles |
| Current-sight radius | `5` tiles |
| Starting provisions | `12` bundles |
| Survey cost | `2` bundles |
| Supported / Personal / Unknown travel cost | `0 / 0.1 / 0.2` per tile |
| Fixed simulation rate | `30` updates per second |
| Wreck presentation | `4` simulation seconds |
| Non-home islands | Up to `8` |

Named generation and performance profiles keep scale assumptions shared by
production, tests, and benchmarks:

| Profile | World | Islands | Purpose |
| --- | ---: | ---: | --- |
| `P0` | `96 x 96` | `8` | playable prototype |
| `P1` | `192 x 192` | `32` | four-times-area integration |
| `P2` | `384 x 384` | `300` | four-times-width-and-height target |
| `P2-500` | `384 x 384` | `500` | bounded placement stress |

The fixed-step clock caps unusually large frame deltas. When a wreck hold ends,
it drops buffered substeps so held input cannot move the replacement ship on the
same rendered frame.

## 4. World model and generation

Integer `(tileX, tileY)` coordinates drive terrain, knowledge, cost, and route
queries. Continuous pixels drive movement and rendering. A tile centre is:

```text
worldX = tileX * tileSize + tileSize / 2
worldY = tileY * tileSize + tileSize / 2
```

`WorldGrid` stores authoritative chunks eagerly. Chunk typed arrays hold
terrain, knowledge, visibility, movement and sight blocking, expedition stamps,
island IDs, and resource IDs. Sparse sets and counters provide known-water,
visibility, expedition, and return-root indices without ordinary full-world
scans.

Generation has three explicit stages:

1. **Plan** creates a versioned `WorldManifest` with stable settings identity,
   home geometry, bounded island descriptors, and deterministic namespaces.
2. **Rasterize** paints authoritative tiles and validates navigation,
   dock/open-edge connectivity, channels, and atoll entrances.
3. **Analyze** performs one row-major capture into an immutable
   `WorldAnalysisIndex` for passability, components, coastline runs, islands,
   and bounded candidate queries.

The seed and generation settings produce the home island and exact dock,
Supported-water boundary, base terrain, a clear departure corridor, non-home
islands, and passable ocean connected to every world edge. Island placement is
spatially indexed, deterministic, and attempt-bounded. The configured island
count is a maximum: a profile with no legal position after its bounded random
attempts and complete fallback scan is omitted, and planning continues with
later profiles.

Non-home island manifests record stable numeric identity, source kind, and—when
authored—the stable asset ID. Planning receives a validated catalog snapshot
sorted by stable asset ID, selects authored islands deterministically without
replacement, uses each selected asset at most once, and creates procedural
islands only for the configured shortfall. Catalog traversal order cannot
change selection. Authored canvas and collision bounds retain edge, home,
starter-lane, and navigable-channel clearances.

Authored island rasterization installs the complete saved `32`/`8` mask as
collision authority; rendered pixels are not sampled. Procedural islands retain
stable kind, size, centre, radii, rotation, shape seed, and bounds. Placement,
shape, terrain, dossier content, and visual content use separate deterministic
namespaces. High Island, Low Cay, Atoll, and Rocky Skerry remain procedural
kinds; atolls receive a navigable passage.

`WorldSpatialIndex` provides deterministic closed-bounds point, region, radius,
nearby, and chunk queries. `WorldDescriptorRegistry` adapts heterogeneous
descriptors at composition. Feature systems use indexed candidates but retain
exact state, range, sight, and approach checks.

## 5. Movement and collision

The ship has continuous position, heading, speed, and a current navigation tile.
Keyboard input supplies turning and forward/reverse thrust. Movement sweeps the
authored hull along the continuous segment, stops before the first solid
primitive, and emits crossed tile centres in order.

The `32 x 32` navigation grid remains terrain and route authority. A sparse
collision override can replace a coarse cell with a `4 x 4` grid of `8 x 8`
subcells. An override may be mixed, fully open, or fully solid. Without an
override, the cell follows its declared coarse open/solid terrain contract.

The authored vessel package declares a centred box hull. Startup rejects
package/config disagreement and creates an authoritative movement view, so live
speed tuning cannot replace the hull implicitly.

Swept collision uses intersected coarse cells as a broad phase and at most 16
fine primitives per overridden cell as a narrow phase. `GridGraph` caches
cardinal edge classification by collision revision after applying the same
centre-to-centre swept-hull clearance test. Manual sailing, return paths,
forward range, service connectivity, and generation validation therefore share
one traversal predicate. Unknown blockers are filtered only for predictive
forward guidance so hidden islands are not revealed.

Deep and shallow ocean are passable. Reef, rock, and land block movement; rock
and land also block sight. Runtime PNG pixels are never sampled for collision.

## 6. Visibility, knowledge, and provisions

Current visibility is a Euclidean disc with line traversal against sight
blockers. Blocking tiles remain visible and obscure tiles behind them. Movement
evaluates sight at every crossed tile centre; the final disc becomes
`visibleNow`, while the union supports trail creation without high-speed gaps.

Normal sight does not immediately convert visible Unknown water to Personal:

- water at and ahead of the ship stays Unknown;
- leaving a tile centre stamps a broad perpendicular Personal trail owned by
  the active expedition;
- visible blocked landmarks may become Personal immediately; and
- Personal and Supported knowledge never downgrade through sight.

Developer teleport deliberately reveals the destination sight disc for
inspection but never creates a connecting trail. Full-colour presentation in
current sight does not change knowledge or travel cost.

The ship stores whole provision bundles plus a fractional travel accumulator:

```text
available = provisions - provisionAccumulator
```

Movement prepares charges from crossed segments before visibility or knowledge
updates. Entering water that was Unknown at segment start therefore pays the
Unknown rate even when that move reveals it. Replenishment clears the
accumulator.

## 7. Forward and return guidance

`ForwardRangeSystem` performs an exact cost-limited search from the ship using
the current available provisions. Predictive search treats unseen blockers as
Unknown water so the overlay cannot expose hidden terrain. The logical mask and
candidate list contain every reachable Unknown cell. Separate presentation
outputs retain only the outermost Unknown-cost band, clip that sparse frontier
to a heading-centred cone, and draw contour edges rather than filled tiles.

Forward guidance is derived, not movement authority. `GameSimulation` is its
only scheduler and publisher:

- a request captures world epoch, collision, knowledge and visibility
  revisions, origin, and provision budget;
- repeated invalidations coalesce and cancel obsolete work;
- the exact search advances cooperatively with a default `3 ms` wall-clock
  target and `32,768` work-unit safety cap per slice;
- stale or cancelled tasks never publish;
- a complete result swaps atomically from an inactive reusable buffer; and
- heading changes reclip current sparse candidates without restarting an
  otherwise current search.

`ForwardRangeSystem` owns the resumable exact task and two reusable inactive
result buffers. `BucketedCostSearch` owns resumable queue mechanics. Initial
world setup and explicit regeneration synchronously seed a complete guidance
result; ordinary post-initialization refreshes publish only through cooperative
tasks.

Return guidance remains synchronous authority. `ReturnPathSystem` finds one
minimum-provision route from the ship to reachable Supported water. It may cross
Unknown water only inside current sight and otherwise follows Personal water.
The ordered route is presentation input for the **Voyage Sense thread**. A
bounded padded corridor remains available to diagnostics but is not rendered.
Presentation rounds cardinal turns within the traversable route-tile envelope
and indexes the resulting sparse segments by chunk; it never recalculates the
route or becomes navigation authority. One faint soft-edged thread applies a
single risk colour to the whole route from the remaining provision margin:
green, yellow, orange, then red as supply falls. The thread is absent when the
ship is already in Supported water or no eligible known route exists.

The screen-space cargo rack consumes one renderer-neutral partition of physical
bundles rather than recalculating gameplay rules. Natural bundle material is
uncommitted supply; a contiguous spend-end overlay uses the thread's current
green, yellow, orange, or red state for the exact shortest-known-return cost;
and the already-spent travel fraction remains visible as depleted material.
Fractional costs occupy fractional bundle widths. While an authoritative survey
prompt is present, its quoted cost occupies the spend end in sea-glass cyan with a
restrained breathing outline, the return allocation moves before it, and the
return colour is classified from the projected post-survey margin. Reduced
motion keeps the same survey outline static. The rack has no visible labels or
numbers. A visually hidden live status owns exact usable, return, survey,
uncommitted, safe/unknown, and shortfall text without announcing animation
frames.

## 8. Expedition, wreck, and lineage lifecycle

An expedition begins when ordinary movement crosses from Supported to
non-Supported water. Reaching Supported water away from home does not settle it.

Exact-home-dock return is one ordered transaction:

1. place the ship at the dock centre;
2. commit expedition-owned Personal water to Supported;
3. close only bounded tiny enclosed Unknown pockets;
4. commit all expedition-owned feature leads, surveys, wreck reports, and idol
   findings;
5. close the expedition and advance its ID;
6. append one immutable voyage achievement record and create one successor when
   the fourth voyage completes; and
7. replenish provisions, clear fractional use, and publish settlement events.

Docking without an active expedition replenishes only supplies.

Natural exhaustion outside Supported water and the developer wreck command use
one failure path. It records a persistent wreck at the exact pose, rolls back
the active expedition's Personal water and provisional findings, marks the
navigator lost, holds the empty ship for four simulation seconds, then creates
one supplied successor at the home dock. Final-bundle docking success takes
precedence over wreck creation.

Each navigator can complete at most four safe voyages. The lineage stores
active, completed, and lost navigators plus immutable per-voyage result IDs.
Tenure and wreck succession are deterministic and idempotent. Every succession
creates an in-session handover gate; sailing remains suppressed until it is
acknowledged.

`GreatHallChronicle` is a rebuilt read model over authoritative lineage and
returned world records. It owns no mutable gameplay facts. The Hall is
optionally browsable only at the exact home dock, and succession uses a focused
non-dismissible mode. A fatal voyage exposes no provisional achievements; a
later returned wreck survey may link identity and fate to the lost navigator.

The graphical Hall consumes a validated JSON-compatible presentation contract
V1. A pure adapter maps each chronicle navigator to one of twenty fixed portrait
files, its lifecycle and known wreck fate, exactly four voyage positions, and
achievement symbols with every exact returned label retained. One shared
semantic HTML renderer serves the game dialog and asset workspace. It renders
only the selected twelve-generation era, selected memorial, four voyage bands,
and one exact-label detail surface; era navigation never creates hidden portrait
controls for the complete lineage. Presentation portraits, paging, symbols, and
fixture data never become gameplay identity or authority. Completion still
takes priority over a pending handover, and host-owned dismissal and action
callbacks preserve the existing movement and lifecycle gates.

## 9. Discoverable content and completion

Fishing shoals, island dossiers, and survey sites share the same durable
branching rule: sighting is free and provisional, surveying spends provisions,
exact-dock return commits the lead or report, and wreck rolls back only the
current expedition's records. Stable IDs make revisits, ordering, lineage
credit, and presentation deterministic.

Every non-home island has one immutable dossier definition with stable island
identity, exact footprint, dock-reachable coastal approaches, a deterministic
name, and a hidden descriptive result. Surveying an island derives full-island
fog reveal from its exact island ID; it does not mutate water knowledge, route
cost, or Supported topology.

Survey-site content is registry-driven. The generator deterministically places
up to the configured historic-wreck, coastal-ruin, and tidal-cave sites with one
shared lifecycle and type-specific clue/result data. A site type with no eligible
reachable location in a partial island plan is omitted. These historic wrecks
are independent of runtime navigator wrecks.

Runtime navigator wrecks become persistent unidentified markers when sighted.
Surveying one creates an expedition-owned identity/fate report. Return commits
the report exactly once to both the wreck and lost navigator; failure discards
the report but leaves the wreck discoverable and surveyable.

A hidden idol-location catalog selects unique eligible hosts from island
dossiers and survey sites. Fishing shoals and runtime navigator wrecks are not
eligible. Surveying a host reveals its special location provisionally; the host
survey owns return and rollback. Undiscovered hosts never enter presentation or
the Great Hall read model.

The completion state is `in-progress`, `awaiting-choice`, or `continued`. Only
the exact-dock return that reaches the configured idol-location total enters
`awaiting-choice`, after ordinary settlement and lineage credit. Movement and
lifecycle interactions are suppressed until the player chooses. **Continue**
preserves the completed world and prevents another ending. **Start new game**
uses a distinct deterministic seed and constructs a fresh world and lineage.
If the final return also completes a fourth voyage, completion presentation has
priority and the committed handover waits underneath it.

## 10. Rendering and authored assets

The game uses Phaser WebGL. `WayfindersScene` derives one closed viewport chunk
region and updates one `ActiveChunkSet`. The active set prioritizes visible
chunks, adds a prefetch ring when capacity allows, and enforces a hard five-by-
five (`25`) chunk resource budget. Deactivation runs before activation.

### Audio foundation, sailing ambience, and discrete cues

Game and asset-library startup fetch and strictly validate
`/assets/audio/audio-catalog.json` once before scene composition. Isolated asset
trials do not fetch it. A fetch, schema, or catalog-validation failure becomes
an explicit unavailable result: game simulation and semantic UI still start,
and the affected sound surface reports the failure in place.

With a valid catalog, game mode queues every catalog WAV during
`WayfindersScene.preload()`. `GameAudioController` then owns a Phaser playback
port, all sound instances it creates, and a renderer-neutral `AudioMixer`.
Playback begins disabled behind an explicit **Enable sound** action. That exact
activation resumes a suspended Web Audio context, reconciles a stale initial
Phaser focus flag, and completes enablement without requiring a blur/focus
cycle; the HTML5 fallback retains its pre-armed touch unlock. A cue attempted
while disabled, locked,
suspended, unavailable, or destroyed is rejected immediately and is never
queued for replay. On blur/suspension, owned one-shots are discarded while
Phaser pauses retained loops; focus only reconciles those current loops.

Mixer state is in memory only. Initial master gain is `0.80`; initial category
gains are music `0.42`, ambience `0.275`, sound effects `0.75`, and interface
`0.60`. Effective instance gain is master by category by catalog base gain by
transition gain, with every control clamped to `[0, 1]`. Category voice limits
are respectively `2`, `3`, `8`, and `2`, with a hard total limit of `15`.
At a limit, an incoming voice may deterministically replace the oldest lowest-
priority equal-or-lower-priority voice; otherwise it is rejected. Stable mixer
updates preserve revision and snapshot identity.

The game-only DOM surface exposes keyboard-accessible enable, master mute,
master level, and all four category levels with exact percentage output. It has
no persistence or gameplay-save seam. Bounded diagnostics expose lock,
suspension, gain, active/peak voice, loop, rejection, unavailable-asset, and
playback-error state through `window.__WAYFINDERS__.audio()`. Scene shutdown
destroys the controls, listeners, owned sounds, playback adapter, and mixer
voice ledger idempotently without destroying Phaser's global Sound Manager.

After sound is enabled, game mode owns two non-positional ambience loops. The
ocean bed remains present with transition gain `1`. The wake target is the
absolute current rendered ship speed divided by configured full ship speed,
clamped to `[0, 1]`; reversing direction therefore never restarts it. Wake
hysteresis engages at normalized speed `0.04` and disengages below `0.015`.
Exact dock, wreck-presentation, and generation-handover gates force its target
to zero. Wake attack uses `0.35` seconds, release uses `0.55` seconds, gain
updates use epsilon `0.001`, and any single update advances at most `0.25`
seconds. The wake voice starts only after engagement and is destroyed after its
release reaches silence. Together the ocean and wake use at most two of the
ambience category's three voices.

The pure ambience state consumes no world object, tile, obstacle, island,
knowledge, route, or feature query. `WayfindersScene` supplies only its current
ship render-pose speed, configured full speed, exact-dock state, and existing
wreck and handover presentation gates through one reused input object. A stable
settled update preserves snapshot identity and performs no playback operation.
Unlock reconciles the loops to current motion; mute and category changes reuse
the mixer gain path; blur retains Phaser-paused loops and focus does not restart
them. Bounded diagnostics expose target/current gains, active ambience voices,
peak count, starts, and wake stops. Scene shutdown destroys the ambience
controller before the general audio controller.

`AudioCuePolicy` is a renderer-neutral, stateful cooldown policy over typed cue
sources. `GameAudioCueController` subscribes directly to the simulation's
existing `GameEvents`, collects all synchronous sources until the next
microtask, and plays at most the highest-priority eligible intention. Direct
accepted UI actions enter that same batch. It never subscribes high-rate tile,
provision, knowledge, or return-state events; missed one-shots while audio is
disabled, unavailable, or suspended are discarded rather than replayed.

The implemented cue families and fixed bounds are:

| Family | Sources | Asset | Priority | Cooldown | Voice rule |
| --- | --- | --- | ---: | ---: | --- |
| UI confirm | accepted confirm actions | `ui.confirm` | `300` | `120 ms` | one; replace oldest |
| UI cancel | accepted cancel actions | `ui.cancel` | `310` | `120 ms` | one; replace oldest |
| UI toggle | accepted toggle actions | `ui.toggle` | `200` | `120 ms` | one; replace oldest |
| Discovery | island, survey-site, shoal sightings | `sfx.discovery` | `400` | `650 ms` | one; replace oldest |
| Wreck discovery | first wreck sighting | `sfx.discovery` | `410` | `650 ms` | one discovery voice; replace oldest |
| Survey | island, survey-site, shoal surveys | `sfx.survey-complete` | `600` | `250 ms` | two; reject excess |
| Wreck survey | completed wreck survey | `sfx.survey-complete` | `610` | `250 ms` | two survey voices; reject excess |
| Idol discovery | idol location discovered | `sfx.discovery` | `900` | `500 ms` | one; replaces ordinary survey or discovery |
| Dock return | expedition returned | `sfx.dock-return` | `800` | `500 ms` | one; replace oldest |
| Dock replenishment | dock replenishment without return | `sfx.dock-return` | `790` | `500 ms` | one dock-return voice; replace oldest |
| Wreck | ship wrecked | `sfx.wreck` | `1000` | `1000 ms` | one; replace oldest |

Stable source order breaks equal-priority ties. Oldest replacement is ordered
by start time and then voice ID. An idol-discovery batch suppresses its ordinary
survey/discovery and UI confirmations; an expedition return suppresses the
same-transaction dock replenishment; `expeditionFailed` and returned-record
events have no second cue. A teleport is a batch barrier against incidental
discovery sounds, while world regeneration is not subscribed. Recent cue
decisions, active/peak cue count, processed/played/suppressed/rejected counts,
and dropped bounded-source count are exposed with the other browser audio
diagnostics. Scene teardown unsubscribes the cue adapter and stops its owned
voices before destroying the general audio controller.

`MusicState` selects `home-harbor` at the exact dock, in current Supported
water, during home interaction, or while no expedition is active; an active
expedition outside Supported water selects `open-water`. It consumes only
current presentation-safe state. The state gains crossfade linearly over `1.5`
seconds, with delta clamped to `0.25` seconds, and preserve snapshot identity
when settled. Reversing a transition continues from the current gains.

`GameMusicController` owns stable `music:home-harbor` and `music:open-water`
voices bound to the two catalog music IDs. It starts only a non-zero layer,
never exceeds the music category's two voices, stops a fully faded outgoing
layer, and reconciles the current state only after audio enable or focus return.
Exact return, wreck, succession, and completion request duck holds of `0.8`,
`1.0`, `1.25`, and `1.5` seconds respectively. Completion outranks succession,
which outranks wreck, return, and no duck. Wreck, handover, and completion
presentation gates retain their matching duck until the gate ends. Duck attack
is `0.12` seconds to gain `0.28`; release is `0.75` seconds. Continue, Start New
Game, and handover dismissal release their transient modal hold and reconcile
the resulting current state.

Bounded diagnostics expose selected state, state/output gains, duck reason and
timer, active/peak voices, starts, stops, crossfades, and per-reason triggers.
Scene shutdown unsubscribes lifecycle events and stops both stable music voices
before the general audio controller. The final eleven-file music, ambience,
sound-effect, and UI set remains auditionable through the play-only Audio
workspace. The stored artifact, deterministic regeneration, and replacement
contract is owned by `Wayfinders_Asset_Pipeline.md`.

Chunk-local terrain, authored home-island objects, imported authored-island
layers, knowledge/risk textures, cloud/shadow pairs, and marker pools all consume
the same active-chunk delta. Inactive presentation resources are destroyed or
returned to bounded pools; non-creating world reads prevent the renderer from
expanding authoritative storage. Shared package and available-island textures,
the player-boat visual, and one four-frame cloud sheet remain scene-owned. The
ocean backdrop is the deterministic placeholder if visible demand exceeds the
active budget.

Knowledge and Voyage Sense overlays update only dirty chunks and required neighbours.
Static terrain, feature markers, and authored island objects are constructed
only for active chunks. Each imported island resolves the stable asset ID
recorded in its manifest descriptor, positions visible prepared layers at the
descriptor's collision-bounds origin, and scales them to the exact saved grid
canvas. The island centre chunk owns those layers without per-update world
scans or duplicate placement state. Retained chunks create no duplicate image;
deactivation destroys every layer. A missing texture or catalog-revision
disagreement uses the complete procedural developer presentation instead of a
partial imported visual. Camera zoom changes no placement calculation. The ship
interpolates between fixed simulation steps. No texture is allocated per frame.

Cloud atmosphere is an independent presentation layer. Each candidate owns a
paired shadow at depth `51` and cloud at depth `52`, above map art, knowledge,
the ship, feature markers, and Voyage Sense guidance but below diagnostics,
prompts, and UI. The shadow reuses the candidate silhouette and reflection with
a dark tint, pronounced southeast offset, reduced opacity, and flattened
vertical scale; the increased separation establishes height immediately. It
moves in lockstep with the cloud and can cross sea, terrain, or the ship.
Cloud sprites sample a seeded four-tone white-to-storm-blue palette and a wider
`0.22` through `0.50` scale range. Their `0.34` through `0.52` opacity range
keeps silhouettes readable while preserving a `0.55` package ceiling.

Each active chunk defaults to six deterministic candidate slots distributed by
a stable low-discrepancy sequence; increasing frequency adds positions without
moving existing slots. Slots cycle through all four authored silhouettes. The
home-centre chunk reserves the first three at fixed offsets around the home
island, guaranteeing the default opening composition without adding another
resource class, then fills any remaining frequency with ordinary slots. The world seed,
chunk, and candidate slot choose scale, horizontal reflection, opacity, drift
amplitude, drift period, direction, colour, position, and phase. The three
opening slots deliberately use light, middle, and darkest tones together with
small, middle, and large scales. Candidate creation, motion, phase, and route
progress are independent of fog. Each existing pair continues moving while
hidden and is never rebuilt merely because knowledge or live sight changes.

Presentation visibility follows the knowledge overlay's current clear coverage.
The renderer checks the pair's current padded cloud-and-shadow footprint, not
its complete route: every covered tile must be Supported, currently visible, or
belong to an exactly revealed island. Unknown or occluded Personal fog,
filtered fog edges, and world bounds hide the pair without changing its motion.
The check is invalidated by knowledge, live-visibility, exact-island reveal, or
world identity changes and when motion crosses a tile boundary. This lets the
ship's sight naturally uncover a cloud already moving beyond the fog. Ship
proximity itself never hides or rebuilds the pair, so the offset shadow can pass
continuously across the ship wherever the fog is clear.

Cloud drift uses rendering time and never simulation time. Ordinary seeded
routes last `120` through `180` seconds; the three opening routes last `100`
through `140` seconds with a smaller travel range. Motion is continuous and
directional across the route rather than a small orbit. Each route uses the
first and last ten percent for smooth opacity easing, becoming transparent
before its position wraps. Newly eligible ordinary pairs also fade in over `4`
seconds, while opening pairs begin partially faded in so they are readable on
the first rendered frame. Reduced-motion preference freezes every candidate at
its seeded position and opacity. The layer owns its paired sprites,
deterministic descriptors, enabled state, and resource counters, but shares the
scene's active-chunk lifetime. Disabling clouds destroys only cloud-owned pairs
and turns stable sync into a bounded no-op; re-enabling reconstructs the current
active candidates without invalidating terrain, water, fog, risk, markers, UI,
or authoritative revisions. The debug menu's session-only **Cloud frequency
(per chunk)** value accepts zero through twelve; changing it immediately and
deterministically rebuilds cloud-owned pairs. Browser diagnostics expose the
same value and command.

The runtime authored packages provide the home island, animated player boat,
fishing-shoal cue, and presentation-only four-frame cloud sheet. Available
imported islands use their prepared PNG layers; procedural fallback and other
content use intentional developer presentation.
The game and `?mode=assets` library share package validation, texture loading,
presentation factories, and collision descriptors. The asset route supplies
preview coordinates only; it does not create another gameplay simulation.

Validated package collision metadata feeds the runtime collision descriptors;
rendered pixels do not. Package schema, editable profile categories, source
preparation, review, promotion, and repository transactions are documented in
`Wayfinders_Asset_Pipeline.md`.

The asset library provides guided local-PNG intake. It reads the
PNG canvas dimensions as soon as the source is selected and keeps them as the
default output dimensions. When a solid asset is not aligned to the `32`-pixel
navigation grid, the form warns before submission and offers transparent canvas
padding to the next aligned size; it does not require the operator to calculate
the dimensions or stretch the source.

The asset-library route provides persistent **Islands**, **Ships**, **Fishing
shoals**, **Water**, **Great Hall**, and **Audio** tabs. Production workspaces use permanent
left-library, centre-preview, and right-workbench regions. Water is a branch-only
WTR-1.0 through WTR-1.5 feedback prototype: its isolated scene reads prepared
static and overlay sheets plus preview-only island and shoal images directly.
It shows labelled tile variants and repeat checks, then composes a 96x96 world
with smoothly masked treatment handoffs, island-alpha-derived shoreline depth,
wind and wave accents, locally varied shoreline waves, and lean, steady, and
rich animated fishing-ground cues. Those cues reuse the existing runtime
shoal's 96 x 64 abstraction: broken glints, water-colour noise, and ripples with
no individually readable fish. The study redraws from a fitted overview through
native 32-pixel game-tile scale while retaining the inspected map centre. One
pause control stops the scene-local water, shoreline, and shoal animation, and
workspace shutdown cancels that frame lifecycle. It omits the production-tooling
sidebar so the preview uses the available width, and owns no gameplay catalog,
package, promotion, general animation, island-generation, or runtime-renderer
authority. The active workspace is URL-addressable and follows
browser history; accessible arrow-key navigation uses roving focus. A typed
registry partitions library catalog entries and collision profiles, while a
scene factory mounts a library scene, the animated Water preview, the isolated
Great Hall approval scene, or the play-only stored-audio scene. Workspace
shutdown aborts its DOM listeners, cancels its preview-local animation frame,
and removes its Phaser bindings before the next workspace mounts. Where present,
the left and right columns scroll independently, and the Phaser preview is sized
to the centre column so it cannot render behind those controls. Existing recipe
names and stable IDs are
checked in the form and again under the repository lock; conflicts block
intake without a separate confirmation step. Validated family defaults and
identity become one source recipe and one pending candidate through the
constrained development-server API. Island preparation creates a deterministic,
editable `8`-pixel shoreline
seed from prepared alpha and retains its method and uncertainty warnings with
the draft. Passable families remain explicitly empty, and no generated draft
becomes runtime authority automatically.

The Islands workspace replaces the general production surface with one focused
workbench. Left-library selection alone chooses the preview and editor. The
right side exposes the island name, current availability state, **View with
ship**, fit, paint, erase, `8`/`32`-pixel brush size, undo, redo, reset, and one
**Save changes** operation. Imported islands also expose a destructive
**Delete imported island** operation behind an explicit confirmation; the
built-in home island never does. It does not expose runtime profiles, dimensions,
layer composition, animation, validation, fingerprints, review, promotion, or
portable-package controls. Import fixes the family and collision semantics to
island defaults, derives the initial name from the filename, reads the PNG
canvas, offers aspect-locked manual sizing and grid padding when needed, prepares
the image, seeds the shoreline mask, and selects the resulting unavailable
island. Saving an imported island commits its editable name, complete mask, and
one durable `availableInGame` boolean through a rollback-safe repository
operation. Enabling availability validates current prepared art and the exact
mask before commit; failure leaves the island unavailable with an actionable
error. Disabling it preserves source art, prepared output, properties,
collision, and sea-trial access while removing the island from future world
catalogs. Confirmed deletion removes the imported island's recipe, generated
index and review records, source PNG, semantic mask, and prepared directory in
one rollback-safe operation guarded by the current candidate fingerprint.
Names and stable IDs remain unique. The built-in home island keeps
its direct collision save and is always available.

Island review, approval, promotion, and runtime binding are not lifecycle
paths. Ships and Fishing shoals retain the general package and candidate tools;
their save, validation, review, and promotion operations continue to use the
narrow serialized repository seams until a dedicated workspace milestone
replaces them.

The Great Hall workspace is a view-only fixture host. Its navigator-count and
scenario controls derive one-through-twenty variations in memory from a checked-
in, boundary-validated V1 JSON fixture. The fixture and live game adapter feed
the same semantic renderer. Portrait and symbol files are read directly from
`public/assets/gr5/great-hall`; no runtime generation, promotion, file write, or
gameplay persistence path exists. The workspace never constructs
`GameSimulation` or reads live lineage. The fixed structural ceiling is twelve
portrait controls, four selected voyage bands, and one exact-label detail
surface; the twenty-generation fixture-build p95 budget remains `5 ms`.

The first approval composition uses one fixed empty Hall-interior image beneath
all interactive content. The selected navigator and four pictorial voyage bands
occupy the left mounting area; the right wall always presents twelve compact
portrait positions, using covered placeholders for generations not yet present
in that era. Lineage totals and their counting cord are intentionally omitted
from this review version. The twenty existing portrait files remain unchanged.
The default twentieth-generation memorial distributes all ten achievement
symbols across three dense returned voyages so the main Hall view exercises
multi-achievement bands; its fourth voyage remains awaiting.
Portraits and voyage bands carry no visible generation or voyage numerals in
the Hall composition. Their complete generation and voyage positions remain in
accessible names and in the review workbench. Voyage bands use the existing
player-boat pictogram rather than a CSS shorthand, and lost portraits use frame
patina without a line crossing the portrait art.

An imported island can enter a disposable sea trial regardless of availability.
The trial contains only open water, the authored player boat, and the candidate's
actual prepared layers on a centred origin. Its isolated `WorldGrid` applies
the exact saved `32`/`8` collision draft, exposes safe boat resets and grid and
collision overlays, and returns directly to the same library record. It never
constructs `GameSimulation`, persists trial state, or changes the runtime world
catalog. Repository authoring and the trial are not
gameplay saving.

## 11. Developer and event interfaces

`GameEventMap` in `src/wayfinders/core/GameEvents.ts` is the source of truth for
typed lifecycle events. Event payloads contain stable IDs and committed results
needed by adapters; listeners cannot mutate simulation state through the bus.

The developer UI can regenerate by seed, inspect island approaches, move to
survey anchors, teleport to water, adjust provisions, force a wreck, toggle
navigation/visibility/guidance diagnostics, independently enable or disable
cloud atmosphere, and tune supported configuration. The checked-by-default
cloud switch is session-only and scene-owned; it is not a simulation debug or
configuration value. Opening the drawer does not pause sailing. Lifecycle gates
still suppress input.

`window.__WAYFINDERS__` exposes bounded snapshot, command, overlay, resource,
and performance diagnostics for browser automation. Its cloud command and
paired cloud/shadow telemetry report and mutate presentation state only. These
interfaces report
authoritative or sampled state; they do not become gameplay ownership seams.

## 12. Performance contracts

Normal sailing avoids work proportional to total world or island count:

- visibility clears only the previous visible set;
- knowledge and expedition work uses maintained sparse sets;
- collision visits the swept coarse AABB and cached cardinal topology;
- interaction and marker queries start from spatially local candidates;
- forward guidance is cooperative, cancellable, and atomically published;
- return rendering follows one sparse, chunk-indexed Voyage Sense thread;
- clouds retain six cloud/shadow pairs per active chunk by default and at most
  twelve under live debug tuning, compute one bounded current footprint per
  pair, and rescan fog tiles only when overlay coverage changes or motion
  crosses a tile boundary;
- overlays update dirty active chunks only; and
- diagnostics are sampled and capped.

Current automated budgets are:

- `P0` and `P1` authoritative tile-entry work: p95 below `4 ms`;
- `P2` cooperative forward-guidance slice: p95 below `4 ms`, with p95 no more
  than 24 slices per request;
- presentation resources: no more than 25 active chunks;
- `P2`: deterministic 300-island plan/rasterization over 100 fixed seeds; and
- `P2-500`: placement terminates within declared random and fallback attempt
  bounds, returning a deterministic plan of up to 500 islands.

World planning, rasterization, and analysis may scale with total area because
they run at explicit generation time. Normal frames may not. A worker or route
hierarchy requires a new attributed budget miss and exact-equivalence,
cancellation, and stale-publication coverage.

## 13. Testing and platform boundary

Test project assignment is defined in `vitest.config.ts`; lane purpose and
fixture policy are in `tests/README.md`. Unit and contract tests use tiny
headless worlds. Integration tests construct `GameSimulation` only for
cross-subsystem journeys. Filesystem transactions and generated artifacts use
the I/O lane; scale sweeps and timing budgets use the serial performance lane.

Automated tests cover deterministic generation, collision/topology, knowledge,
guidance equivalence and scheduling, expedition and feature lifecycles, lineage,
completion, rendering invalidation/resource bounds, asset contracts, and
repository transactions. Exact counts are intentionally not part of this
contract.

Desktop keyboard and pointer play is the validated platform target. Responsive
resize exists.

## 14. Extension constraints

New gameplay must preserve deterministic identity, explicit event ordering,
authoritative-versus-derived state, exact-dock commitment, provision semantics,
four-second wreck settlement, four-voyage tenure, and one-shot per-world
completion unless an explicit design decision changes the relevant contract.

New features should live in an owning feature package and reach composition and
presentation through public commands, selectors, mutation results, or adapters.
Do not add a second world scan, active-chunk policy, renderer authority,
forward-guidance scheduler, or general event mutation path.

Gameplay extensions have no save-shape, reload, migration, or compatibility
obligation. Persistence requires its own authorized design based on the current
state model.
