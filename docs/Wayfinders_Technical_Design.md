# Wayfinders technical design

This document owns current implemented runtime and gameplay contracts. It is
written as present truth: delivery history belongs in
`Wayfinders_Roadmap_Archive.md`, code ownership in `ARCHITECTURE_MAP.md`, and
future scope in `Wayfinders_Roadmap.md`.

## 1. Foundation

Wayfinders is a browser exploration prototype about leaving safe water,
building knowledge through travel, deciding when to return, and passing a
stronger chart to later navigators. Its finite long-term objective is to
rediscover and return the configured catalog of idol locations lost when the
world split into islands. The idols themselves are not recovered.

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
| Gameplay topology | wrap west/east and north/south |
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

Every world has an explicit `WorldTopology`. Generated gameplay worlds wrap on
both axes. Authored collision canvases, isolated sea trials, and other named
asset contexts remain explicitly bounded. There is no runtime finite/toroidal
game-mode choice.

Authoritative tile indices and stored world positions are canonical: tile
coordinates are inside `[0, width) x [0, height)` and pixel coordinates are
inside the matching half-open pixel rectangle. Lifted coordinates identify a
physical traversal or presentation image and may lie outside that rectangle by
whole world spans. `WorldTopology` owns canonicalization, minimum-image
displacement and distance, direction-tagged cardinal steps, wrapped bounds
decomposition, and periodic chunk-image enumeration. Exact half-span
displacements retain their signed direction; one-cell wrapped axes do not add
self-edges, while opposite directions on a two-cell axis remain distinct.

Integer `(tileX, tileY)` coordinates drive terrain, knowledge, cost, and route
queries. Continuous pixels drive movement and rendering. A canonical tile
centre is:

```text
worldX = tileX * tileSize + tileSize / 2
worldY = tileY * tileSize + tileSize / 2
```

`WorldGrid` stores authoritative chunks eagerly. Chunk typed arrays hold
terrain, knowledge, visibility, movement and sight blocking, expedition stamps,
island IDs, and resource IDs. Sparse sets and counters provide known-water,
visibility, expedition, and return-root indices without ordinary full-world
scans. Reads and writes require canonical coordinates; systems cross a seam
through `WorldTopology` before touching storage.

Generation has three explicit stages:

1. **Plan** creates a schema-2 `WorldManifestV2` with stable settings identity,
   explicit topology, home geometry, deterministic namespaces, stable water
   regions, and one lifted footprint plus its exact one-to-four canonical
   pieces for each island. A footprint must be strictly smaller than each
   wrapped world span. Ribbon regions carry an explicit whole-world tile image
   offset for intentional winding.
2. **Rasterize** paints each authoritative tile at most once per descriptor and
   validates periodic navigation, minimum channels, atoll entrances, and the
   global-ocean contract.
3. **Analyze** performs one row-major capture into an immutable
   `WorldAnalysisIndex` for periodic passability, components, coastline runs,
   islands, and bounded candidate queries.

The seed and generation settings produce the home island and exact dock,
Supported-water boundary, base terrain, a clear finite eastbound departure
corridor, non-home islands, and one global ocean. The dock component must be
uniquely largest, contain independent horizontal and vertical lifted winding
cycles, and contain every atoll lagoon centre. A seam edge by itself is not a
winding cycle. Feature catalogs additionally require mandatory service and
approach anchors to belong to that component.

Island centres may occupy the complete canonical domain. Home clearance,
inter-island channels, and placement conflict use minimum-image distance. The
starter exclusion ends one half-world east of the dock and does not
circumnavigate. Procedural and authored footprints rasterize from island-local
lifted geometry through periodic pieces, so seam crossing does not split shape,
collision, or identity. Island placement is spatially indexed, deterministic,
and attempt-bounded. The configured island count is a maximum: a profile with
no legal position after its bounded random attempts and complete fallback scan
is omitted, and planning continues with later profiles.

Non-home island manifests record stable numeric identity, source kind, and—when
authored—the stable asset ID. Planning receives a validated catalog snapshot
sorted by stable asset ID, selects authored islands deterministically without
replacement, uses each selected asset at most once, and creates procedural
islands only for the configured shortfall. Catalog traversal order cannot
change selection. Authored canvas and collision bounds retain periodic home,
starter-lane, and navigable-channel clearances.

Authored island rasterization installs the saved `32`/`8` solid mask as
collision authority, retains enclosed water, and derives a narrow deterministic
non-uniform shallow shelf from that mask. The passable shelf may continue for
up to two cells beyond a cropped art edge without extending island identity;
transparent canvas cells beyond the shelf remain the ocean that existed before
placement. Neither terrain nor island identity expands to the rectangular art
bounds. Rendered pixels are not sampled. Procedural islands retain
stable kind, size, centre, radii, rotation, shape seed, and bounds. Placement,
shape, terrain, dossier content, and visual content use separate deterministic
namespaces. High Island, Low Cay, Atoll, and Rocky Skerry remain procedural
kinds; atolls receive a navigable passage.

`WorldAnalysisIndex` uses periodic cardinal/eight-neighbour topology for
components, coastlines, service anchors, and split bounds. Coordinate zero is
not a coastline or openness fact.

`WorldSpatialIndex` provides deterministic closed-bounds point, region, radius,
nearby, and chunk queries over canonical buckets. Descriptors supply one lifted
bounds rectangle; the index validates and decomposes it into periodic pieces,
deduplicates by stable ID before exact filtering, and orders nearby results by
minimum-image distance then ID. `WorldDescriptorRegistry` adapts heterogeneous
descriptors at composition. Feature systems use indexed candidates but retain
exact periodic state, range, sight, and approach checks.

## 5. Movement and collision

The ship has continuous position, heading, speed, and a current navigation tile.
Keyboard input supplies turning and forward/reverse thrust. Movement sweeps the
authored hull along a lifted continuous segment, maps broad- and fine-phase
collision cells to canonical storage through `WorldTopology`, and stops before
the first solid primitive. The final ship position and tile remain canonical.
Every physical tile-centre entry is emitted once in order, including repeated
seam crossings in one accepted move.

`MovementResult` carries the accepted `liftedDisplacement`, the whole-world
pixel `worldImageOffset` relating the lifted and canonical endpoints, ordered
canonical `enteredTiles`, and short `TravelSegment` records. Segment endpoints
stay lifted while each segment's cost/knowledge tile is canonical. Provision,
visibility, camera, wake, and presentation consumers use that published
physical result instead of reconstructing direction from canonical endpoints.

The `32 x 32` navigation grid remains terrain and route authority. A sparse
collision override can replace a coarse cell with a `4 x 4` grid of `8 x 8`
subcells. An override may be mixed, fully open, or fully solid. Without an
override, the cell follows its declared coarse open/solid terrain contract.

The authored vessel package declares a centred box hull. Startup rejects
package/config disagreement and creates an authoritative movement view, so live
speed tuning cannot replace the hull implicitly.

Swept collision uses intersected coarse cells as a broad phase and at most 16
fine primitives per overridden cell as a narrow phase. A wrapped coordinate
edge is ordinary water unless canonical collision blocks it; synthetic walls
exist only in explicitly bounded contexts. `GridGraph` caches direction-tagged
cardinal edge classification by collision revision after applying the same
centre-to-centre swept-hull clearance test. Each edge retains its destination
image offset, and its reverse edge is symmetric. Manual sailing, return paths,
forward range, service connectivity, and generation validation therefore share
one traversal predicate. Unknown blockers are filtered only for predictive
forward guidance so hidden islands are not revealed.

Deep and shallow ocean are passable. Reef, rock, and land block movement; rock
and land also block sight. Runtime PNG pixels are never sampled for collision.

## 6. Visibility, knowledge, and provisions

Current visibility is a periodic Euclidean disc with nearest-image line
traversal against sight blockers. Blocking tiles remain visible and obscure
tiles behind them. Movement evaluates sight at every published lifted crossed
centre; the final disc becomes `visibleNow`, while the deduplicated canonical
union supports trail creation without high-speed or seam gaps.

Normal sight does not immediately convert visible Unknown water to Personal:

- water at and ahead of the ship stays Unknown;
- leaving a tile centre stamps a broad perpendicular Personal trail owned by
  the active expedition and split periodically into canonical tiles;
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
updates. It consumes each segment's canonical tile and physical length, so
entering water that was Unknown at segment start pays the Unknown rate even
when that move reveals it. Replenishment clears the accumulator. Tiny Unknown
pocket cleanup uses periodic connectivity and the existing size bound;
coordinate zero is not an escape boundary, and a seam-spanning component is one
component.

## 7. Forward and return guidance

`ForwardRangeSystem` performs an exact cost-limited search from the ship using
the current available provisions. Predictive search treats unseen blockers as
Unknown water so the overlay cannot expose hidden terrain. The logical mask and
candidate list contain every reachable Unknown cell. Separate presentation
outputs retain only the outermost Unknown-cost band, clip that sparse frontier
to a heading-centred minimum-image cone, and draw periodic contour edges rather
than filled tiles.

Forward guidance is derived, not movement authority. `GameSimulation` is its
only scheduler and publisher:

- a request captures world epoch, collision, knowledge and visibility
  revisions, origin, and provision budget;
- repeated invalidations coalesce and cancel obsolete work;
- the exact search advances cooperatively with a default `3 ms` wall-clock
  target and `49,152` work-unit safety cap per slice;
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
Supported/Personal boundary roots and connectivity are periodic. The ordered
canonical route includes direction-preserving `pathEdges` with local and
cumulative image offsets and lifted endpoints. It is presentation input for the
**Voyage Sense thread**. A bounded padded corridor remains available to
diagnostics but is not rendered. Presentation rounds cardinal turns within the
traversable route-tile envelope, splits geometry into short image-local pieces,
and indexes canonical copies by chunk; it never recalculates the route or
becomes navigation authority. One faint soft-edged thread applies a single risk
colour to the whole route from the remaining provision margin: green, yellow,
orange, then red as supply falls. The thread is absent when the ship is already
in Supported water or no eligible known route exists.

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
non-Supported water, including across a canonical seam. Reaching Supported
water away from home does not settle it.

Exact-home-dock return is one ordered transaction:

1. place the ship at the dock centre;
2. commit expedition-owned Personal water to Supported;
3. close only tiny periodically enclosed Unknown pockets within the configured
   size bound;
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
credit, and presentation deterministic. Catalog placement, sight, range,
approach, service-anchor, home exclusion, and inter-feature separation use
minimum-image distance and periodic spatial queries. Coordinate-zero seams do
not create an empty feature band.

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
the exact canonical home-dock return that reaches the configured idol-location
total enters `awaiting-choice`, after ordinary settlement and lineage credit.
Movement and lifecycle interactions are suppressed until the player chooses. **Continue**
preserves the completed world and prevents another ending. **Start new game**
uses a distinct deterministic seed and constructs a fresh world and lineage.
If the final return also completes a fourth voyage, completion presentation has
priority and the committed handover waits underneath it.

## 10. Rendering and authored assets

The game uses Phaser WebGL. Authoritative simulation poses stay canonical;
`WayfindersScene` owns a `LiftedViewAnchor` that advances from each accepted
movement's lifted displacement and wrap offset. The ship and unbounded camera
interpolate along the short lifted segment. Teleports relocate to the nearest
image, world/session replacement resets the anchor, and long-running view
coordinates rebase by whole world spans without changing canonical state.
Pointer and developer-tool coordinates normalize through `WorldTopology` before
candidate selection or mutation.

The scene converts its lifted camera rectangle to closed tile bounds and
updates one `ActiveChunkSet`. Each `ActiveChunkEntry` has a `viewKey`, canonical
chunk owner, whole-world pixel `imageOffset`, visible/prefetch band, and stable
priority. The active set enumerates periodic images directly, handles partial
final chunks at the exact world span, prioritizes visible demand, adds one
prefetch ring when capacity allows, and enforces a hard `25`-image-entry budget.
Multiple entries may reference one canonical chunk. Deactivation runs before
activation; visible deferred images use the lifted ocean placeholder.

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

Terrain, authored-island art, knowledge/risk masks, Voyage Sense, cloud/shadow
pairs, and marker pools consume the same periodic active-chunk delta. Logical
records, revisions, dirty state, and canvas textures remain canonical; image
views carry the entry's offset and may share one owner. Inactive aliases are
destroyed or returned to bounded pools, and non-creating world reads prevent
the renderer from expanding authoritative storage. Shared package and
available-island textures, the player-boat visual, and one four-frame cloud
sheet remain scene-owned. The ocean backdrop is resized around the lifted
viewport and provides the deterministic placeholder if visible demand exceeds
the active budget.

Knowledge and risk overlays maintain their fixed texture resources per
referenced canonical chunk, invalidate periodic neighbours, and attach
translated image sprites.
Voyage Sense consumes lifted path edges, divides long geometry into short local
pieces, and stores canonical chunk copies for alias rendering. Static terrain,
feature markers, diagnostic bounds, prompts, and picking use the same canonical
owner plus image-view split. Stable frames allocate no new texture.

Each imported island resolves the stable asset ID recorded in its manifest
descriptor, positions visible prepared layers at the lifted collision-bounds
origin, and scales them to the exact saved grid canvas. Periodic footprint
intersection activates a view even when the island's canonical centre chunk is
outside the viewport. One descriptor, feature state, and texture set back all
views; view identity includes the whole-world offset. A single
`island-composite` layer may contain both land and its baked water
transition and renders in the `4.x` land stack. Layered assets may instead use a
`water-apron` at depth `1.7`, ordinary land planes at `4.x`, and a
`shore-effect` at `4.75`. A complete imported presentation contains either an
ordinary land plane or an `island-composite`; water-apron-only and
shore-effect-only entries keep the coherent developer fallback. A missing
texture or catalog-revision disagreement uses that same complete fallback
instead of a partial imported visual. Camera zoom changes no placement
calculation.

Cloud atmosphere is an independent presentation layer. Its validated package
owns a fixed four-slot catalog aligned exactly with the four atlas frames. Each
non-deleted slot has a stable ID, display name, and durable `activeInGame`
state. Seeded frame selection keeps its original preferred slot when active;
an inactive or deleted preference scans forward through fixed slot order. Thus
availability changes only the eligible visual, never position, motion, fog,
frequency, opacity, scale, tint, reflection, or shadow behavior. With no active
slots, the layer creates no descriptors or sprite pairs.

Each candidate owns a
paired shadow at depth `51` and cloud at depth `52`, above map art, knowledge,
the ship, feature markers, and Voyage Sense guidance but below diagnostics,
prompts, and UI. The shadow reuses the candidate silhouette and reflection with
a dark navy tint, a `56 x 42`-pixel southeast offset, a `0.68` opacity
multiplier, and a broad `1.08 x 0.58` scale; the separation and flattened
silhouette establish height immediately. It moves in lockstep with the cloud
and can cross sea, terrain, or the ship. Cloud sprites use four fuller, top-lit
pixel-art cumulus formations with detached puffs and sample a seeded near-white
ivory-to-cool-blue palette across the existing `0.22` through `0.50` scale
range. Their `0.88` through `0.98` opacity range preserves the source art's
dimensional highlights and blue-gray undersides over the ocean.

Each referenced canonical chunk defaults to six deterministic candidate slots
distributed by a stable low-discrepancy sequence; increasing frequency adds
positions without moving existing slots. Slots cycle through all four authored silhouettes. The
home-centre chunk reserves the first three at fixed offsets around the home
island, guaranteeing the default opening composition without adding another
resource class, then fills any remaining frequency with ordinary slots. The world seed,
chunk, and candidate slot choose scale, horizontal reflection, opacity, drift
amplitude, drift period, direction, colour, position, and phase. The three
opening slots deliberately use white, pale-blue, and coolest tones together with
small, middle, and large scales. Candidate creation, motion, phase, and route
progress are independent of fog. Each existing pair continues moving while
hidden and is never rebuilt merely because knowledge or live sight changes.

Each active chunk image may display an offset view of those canonical
candidates without duplicating descriptor or fog authority. Presentation
visibility follows the knowledge overlay's current clear coverage.
The renderer checks the pair's current padded cloud-and-shadow footprint, not
its complete route: every covered tile must be Supported, currently visible, or
belong to an exactly revealed island. The footprint samples canonical wrapped
tiles, so Unknown or occluded Personal fog hides the pair without a false wall
at a coordinate seam and without changing its motion.
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
fishing-shoal cues, water sheets, and presentation-only four-frame cloud sheet. Available
imported islands use their prepared PNG layers; procedural fallback and other
content use intentional developer presentation.
The game and `?mode=assets` library share package validation, texture loading,
presentation factories, and collision descriptors. The asset route supplies
preview coordinates only; it does not create another gameplay simulation.

World generation runs `WaterLayoutPlanner` after authoritative terrain
rasterization and `WorldAnalysisIndex` construction. The manifest records the
water-layout version, catalog fingerprint, and stable coherent ellipse/ribbon
regions. Ellipses use minimum-image containment; ribbons apply their explicit
lift/winding before distance tests. Protected shallows, collars, masks, and
neighbour classification use periodic topology. `GeneratedWaterLayout` exposes
canonical chunk-addressable base IDs, overlay masks, directional transition
masks, variants, and phases; presentation offsets never enter these facts. The
checked-in depth atlas is used only on a deep host tile facing coastal water; it
is never applied symmetrically or reused for unrelated profile pairs. A one-tile deep host collar
keeps contextual far-water regions from bypassing that island blend. Reef is
selected only from `TerrainType.Reef`; coastal and protected lagoon water are
derived from shallow terrain and island context, and coastal water also underpaints blocked island
cells so transparent shoreline pixels never reveal the ocean backdrop. Deep is
the ocean fallback. Abyss, current,
and rough regions are deterministic presentation facts. Brackish remains
catalogued but is not placed without a future authoritative context. None of
these presentation facts mutate terrain, collision, navigation, resources,
knowledge, provisions, islands, or feature outcomes.

`WaterRenderer` consumes the scene-owned `ActiveChunkDelta`. Each referenced
canonical chunk owns one cached base canvas texture and one surface canvas
texture. Every periodic `ActiveChunkEntry` creates translated base/surface image
objects that share those textures. Prefetched owners remain static, each
visible canonical surface advances at most once on a discrete presentation
frame, and additional aliases cause no redraw. The base texture exposes its
exact chunk-sized frame one pixel inside an opaque extruded gutter so linear
sampling cannot reveal a backdrop join between periodic images; the animated
surface texture remains exact-sized. The surface plane composes directional
depth transitions, glints, currents, and rough-water/whitecap accents. A lifted
ocean rectangle covers deferred gaps.

When the authored-home package and every referenced texture loaded, an explicit
`render.plane: island-composite` lets its footprint and one-tile collar present
ordinary chunk water as deep and suppress its coarse directional transition and
coastal caustic beneath the home composite. A `land` Home plane retains
generated water; authoritative terrain and generated layout facts do not
change. The same suppression applies to an imported island's canvas and
one-tile collar
only when the complete presentation catalog matches the world revision,
contains authored land or an `island-composite`, and contains either an
`island-composite` or `water-apron` plane. Missing, incomplete, stale, and
land-only presentations do not claim water, and procedural islands always
retain generated water.
Knowledge, fog, risk, and route renderers remain later layers and do not feed
water classification.

Fishing-ground presentation uses the fog-filtered read model. Hidden-quality
states always use the neutral steady surface cue; surveyed states may select
lean, steady, or rich. Animation is restrained alpha/scale shimmer on active
views only, with a frozen reduced-motion pose.

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
shoals**, **Water**, **Clouds**, **Icons**, **Great Hall**, and **Audio** tabs. Production workspaces use
permanent left-library, centre-preview, and right-workbench regions. Water is the focused
production inspection surface: it reads the versioned water package and the
same `WorldGenerator`/`GeneratedWaterLayout` facts as the game, offers seed,
profile, overlay, pause, fit, and 1:1 controls, and displays the lean, steady,
and rich 96 x 64 fishing-ground cues without visible fish. Its inspection
camera remains bounded by design while its derived shore/distance facts are
periodic, so fit and 1:1 views can inspect both sides of each world seam from
the same canonical layout. It omits the general
production-tooling sidebar and cannot mutate gameplay or asset authority. The
active workspace is URL-addressable and follows
browser history; accessible arrow-key navigation uses roving focus. A typed
registry partitions library catalog entries and collision profiles, while a
scene factory mounts a library scene, the Water inspection scene, the Clouds
catalog scene, the Icons
animation-review scene, the isolated Great Hall approval scene, or the play-only
stored-audio scene. Workspace
shutdown aborts its DOM listeners and Phaser bindings before the next workspace
mounts. Where present, the left and right columns scroll independently, and the
Phaser preview is sized to the centre column so it cannot render behind those
controls. Existing recipe names and stable IDs are
checked in the form and again under the repository lock; conflicts block
intake without a separate confirmation step. Validated family defaults and
identity become one source recipe and one pending candidate through the
constrained development-server API. Imported-island preparation creates a
deterministic, editable `8`-pixel centered-circle seed covering half the shorter
prepared-canvas dimension. It deliberately ignores image pixels so a baked
water apron remains navigable, and retains its method and refinement warning
with the draft. Passable families remain explicitly empty, and no generated
draft becomes runtime authority automatically.

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
the image, seeds the centered-circle mask, and selects the resulting unavailable
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

The Clouds workspace is a focused presentation-asset surface outside the
collision catalog. Its left column lists every non-deleted fixed frame with an
Active or Inactive badge. The centre renders the complete atmosphere over a
real seeded `96 x 96` generated world through the same deterministic
per-chunk descriptor and route functions used by `CloudLayerRenderer`; shadows
and clouds retain runtime draw order, frame selection, tint, scale, opacity,
reflection, and motion. Every chunk, including the starting chunk, uses the
same seeded candidate slots without exclusions or landmark-relative placement.
Preview-only world seed, `1x` through `24x` speed, route guides, reroll, and
pause controls alter no package or gameplay state.

The right workbench owns one live, validated package draft. It exposes the
default three-through-twelve candidates per chunk, chunk density, cloud opacity
and scale ranges, drift distance and duration, appearance and route-edge fades,
and the paired shadow's offset, scale, and opacity. Ordered pairs remain ordered as
their sliders cross. Every accepted input immediately rebuilds only the preview
descriptors over the existing generated world. **Reset settings** restores the
checked-in presentation in memory. Atlas geometry, tint palettes, layer depths,
fog-clear padding, runtime debug frequency, terrain, and gameplay remain outside
this authoring contract.

**Save changes** posts the complete normalized settings draft together with the
selected frame's **Active in game** state, package runtime revision, and stable
variant ID. The server re-reads and validates the package under the shared
repository lock, rejects stale requests, preserves every non-editable field,
increments the revision once if either availability or settings changed, and
atomically persists the package before the workspace reloads. A total no-op is
byte-identical and does not advance the revision. Guarded deletion replaces only
the selected catalog slot with `null`; inert atlas pixels and opaque bounds stay
checked in so every surviving frame ID and seeded preference remains stable.
All slots may be inactive or deleted, yielding an empty runtime cloud layer.
Git is the recovery path.

Island review, approval, promotion, and runtime binding are not lifecycle
paths. Ships and Fishing shoals retain the general package and candidate tools;
their save, validation, review, and promotion operations continue to use the
narrow serialized repository seams until a dedicated workspace milestone
replaces them.

The Icons workspace is a view-only host for the closed ten-kind achievement
presentation vocabulary. One exhaustive typed catalog owns stable row order,
short accessible names, visual descriptions, frame geometry, and deterministic
time-to-frame selection. Every loop is visible together; preview-only controls
pause the set or select half, normal, or double speed. The gallery and the
shared Great Hall renderer consume the same checked-in sheet through CSS frame
stepping, while reduced-motion presentation freezes the first frame. Animation
never selects an achievement or changes its exact returned label. The sheet's
artifact and read-only validation contract live in
`Wayfinders_Asset_Pipeline.md`.

The Great Hall workspace is a view-only fixture host. Its navigator-count and
scenario controls derive one-through-twenty variations in memory from a checked-
in, boundary-validated V1 JSON fixture. The fixture and live game adapter feed
the same semantic renderer. Portrait and backdrop files are read directly from
`public/assets/gr5/great-hall`, and shared achievement animation is read from
`public/assets/gr5/achievement-icons`; no runtime generation, promotion, file
write, or gameplay persistence path exists. The workspace never constructs
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
- interaction and marker queries split only the local periodic buckets and
  deduplicate candidates before exact filtering;
- forward guidance is cooperative, cancellable, and atomically published;
- return rendering follows one sparse, chunk-indexed Voyage Sense thread;
- clouds retain six cloud/shadow descriptors per referenced canonical chunk by
  default and at most twelve under live debug tuning, compute one bounded
  current footprint per descriptor, and give active images only translated
  views;
- overlays update dirty canonical chunks only and aliases add no redraw; and
- diagnostics are sampled and capped.

Current automated budgets are:

- `P0` and `P1` authoritative tile-entry work: p95 below `4 ms`;
- `P2` cooperative forward-guidance slice: p95 below `4 ms`, with p95 no more
  than 24 slices per request;
- complete generation p95: `P0 <= 350 ms`, `P1 <= 600 ms`, and
  `P2 <= 3,500 ms` under the named serial benchmark;
- `P2-500`: complete generation at or below `7.5 s`, with each island limited
  to its configured random attempts plus the declared finite row-major fallback
  scan, returning a deterministic plan of up to 500 islands;
- the reference sub-chunk seam-radius query: no more than four canonical
  buckets and sixteen candidate descriptors examined;
- presentation: no more than 25 active periodic image entries, including
  aliases of the same canonical chunk;
- water: exactly two canvas textures per referenced canonical chunk, at most one
  surface redraw per visible canonical owner per presentation frame, and zero
  redraws attributable to aliases; and
- repeated laps: per-step authoritative, query, resource, texture, and redraw
  work reaches a stable plateau independent of lap count.

The named generation acceptance also retains deterministic `P2` 300-island
seed sweeps, exact manifest replay, periodic channel/global-ocean validation,
and bounded placement diagnostics.

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

Automated tests cover deterministic periodic generation, seam/corner movement,
collision/topology, sight and knowledge, guidance equivalence and scheduling,
expedition and feature lifecycles, lineage, completion, rendering invalidation/
resource bounds, asset contracts, and repository transactions. Full cardinal
circumnavigations and diagonal corner journeys compare fixed-step partitions,
canonical state, provisions, knowledge, route edge provenance, events, and
diagnostics; same-seed regeneration must replay identically. Exact counts are
intentionally not part of this contract.

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
