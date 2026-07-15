# Wayfinders authored-asset direction

Status: active. `GR-1.1` through `GR-1.4` are implemented and accepted.
`GR-2.1` through `GR-2.5` are implemented; their interactive browser acceptance
remains outstanding. Pilot collision reauthoring in `GR-2.6`, plus the
production workflow in `GR-3.1` through `GR-3.4`, remains planned but not
authorized.

Saving is not part of the active baseline. Any save-related language in this
reference is a future compatibility consideration, not authorization to add
persistence.

## Goal

Generate and prepare production assets before importing them into the game.
When Wayfinders starts, it loads complete authored asset packages and places
them within the procedurally generated world.

Procedural generation continues to decide where whole assets belong. It does
not construct islands at runtime by selecting and joining suitable terrain
squares. A whole island can be generated as one source composition and then cut
into fixed runtime slices for grid alignment, fog, culling or texture limits.
Those slices are never rearranged into another shape.

The first implementation is deliberately small: one home island, the player
boat and one fishing-shoal representation, followed by a focused animated-boat
pass. This pilot tests the contract and runtime path before any larger renderer,
world-generator or tooling commitment.

## Source-art boundary

Concept art and generated source compositions are inputs to asset preparation,
not files loaded by the game. In particular, the images under
`concept_art/example assets` are examples only and must not be copied, cropped
or adapted directly into runtime assets.

Pilot assets must be newly generated for the current `32`-pixel navigation grid
and prepared before import. Preparation may include transparent-background
cleanup, scaling, slicing, heading frames and hand-reviewed metadata.

## Authored asset packages

Each runtime package has a stable semantic ID, one or more derived images and
validated metadata. Filenames are package implementation details and do not
appear in gameplay or renderer call sites.

The pilot contract covers:

- `home.island.primary`: grid width and height, placement origin, render slices,
  per-cell terrain and collision, shallow water, harbour, dock and home-return
  anchors;
- `player.boat.primary`: origin, scale, visual bounds, heading behavior and any
  animation frames; and
- `shoal.fishing.primary`: visual footprint, placement origin, passability,
  service anchor and read-model presentation behavior.

Rendered pixels are never sampled to determine gameplay. For authored islands,
the reviewed grid metadata is the logical shape authority that is stamped into
the world at the procedural placement anchor. Metadata and art are therefore
reviewed together, while collision and interaction remain inspectable without
reading the texture.

An incompatible change to an asset's grid shape, origin or semantic meaning
requires a new contract version or semantic ID. A visual-only revision may keep
the same ID when it remains aligned with the accepted metadata.

## Placement model

The runtime treats each authored island as one indivisible layout:

1. World generation selects a whole asset package and a legal placement anchor.
2. The package's authored metadata is translated onto the navigation grid.
3. Terrain, collision and service anchors are stamped from that metadata.
4. The package's image or fixed slices are drawn at their declared offsets.
5. Fog, knowledge, risk, routes, labels and interactions remain separate
   runtime layers.

The pilot applies this model only to the home island at the existing central
home placement. Non-home islands retain their current implementation until a
later milestone is planned and authorized.

The player boat continues to use the simulation's continuous position and
heading. The shoal continues to use its existing deterministic catalog position
and lifecycle. Their authored packages replace presentation, not movement,
discovery or survey authority.

## Minimal runtime loading

`GR-1.2` adds only what the three-asset pilot requires:

- a typed catalog from semantic ID to runtime image and metadata files;
- Phaser preload integration before renderers are constructed;
- metadata validation and clear load failures; and
- the existing developer graphics as a usable fallback.

The pilot does not require a general asset resolver, visual lifecycle states,
variant selection, hot swapping, a generated manifest, atlas automation or a
workshop. Those abstractions should not be introduced until repeated work shows
that they solve a real problem.

The accepted implementation preloads three JSON packages and four prepared PNG
textures, validates the metadata and its image references, and exposes only
successfully loaded packages by semantic ID. Package failures are isolated and
reported while the renderer can continue with developer graphics.

## GR-1 pilot sequence

1. `GR-1.1` defines and tests the authored asset and grid-metadata contracts.
2. `GR-1.2` loads and validates the three packages at game startup.
3. `GR-1.3` generates and integrates the home island, player boat and one
   deterministically selected fishing shoal, then verifies gameplay and
   performance in the running game.
4. `GR-1.4` completes the boat with correct all-heading presentation, restrained
   motion and a speed-responsive animated wake.

The accepted three-asset proof stamps the home package's complete fixed cell
map at the procedural home center, draws its one authored image without
assembling terrain tiles, binds the boat image to the existing interpolated
ship pose, and gives only the ordinal-zero fishing shoal the authored cue. The
shoal remains passable and visible only through its existing read model.

The accepted final boat pass uses its rotation-safe source for continuous
all-heading presentation, adds only a restrained metadata-timed scale pulse,
and renders the separate wake below the ship. Wake direction follows signed
travel, intensity follows speed, and stopped/hidden/reset ships show no wake.

The four minors are ordered. Each one must meet its acceptance gate before the
next changes shared world-generation or rendering code.

## GR-2 tooling

GR-2 follows the complete GR-1 pilot and addresses its demonstrated preparation
and review needs. Its viewer uses the same Phaser camera, package metadata and
shared presentation factories as the game. Its intake workflow generates
portable candidate bundles, edits metadata and validates grid/frame alignment
without inventing separate placement rules. A repository command, rather than
the browser, owns tracked-file materialization and catalog changes.

Deterministic catalog generation, thumbnails and batch validation are justified
by repeated manual metadata/image wiring. Atlas packing remains deferred until
runtime measurements demonstrate a need.

### Tooling workflow

1. Open `?mode=assets`, choose a fixed semantic-ID template and edit metadata.
2. Bind exact PNG inputs or load the current catalog PNGs.
3. Validate and preview through the shared runtime presentation path.
4. Export one `.candidate.json` bundle for review.
5. Run `npm.cmd run assets:intake -- <bundle> --replace` to revalidate PNG
   headers and pixels, materialize the tracked source record, package metadata
   and runtime images, then regenerate the shared catalog.
6. Run `npm.cmd run check`; stale catalog code, thumbnails or the deterministic
   asset report fail before the normal type/test/build gate.

Candidate intake remains limited to `home.island.primary`,
`player.boat.primary` and `shoal.fishing.primary`. The browser never writes the
repository directly, and the command never replaces an accepted semantic ID
without the explicit `--replace` flag. Each runtime PNG must be non-interlaced
8-bit RGB or RGBA and no larger than `4096 x 4096`.

## Hybrid collision foundation and authoring

Implemented `GR-2.4` retains the `32`-pixel navigation grid and adds optional
`8`-pixel collision subcells only to mixed shoreline or object cells. One
navigation cell therefore contains a `4 x 4` collision patch when refinement is
needed. Fully open and fully blocked cells keep the existing compact coarse
form. Implemented `GR-2.5` adds package-profile editing on top of that contract;
accepted home-mask refinement remains planned in `GR-2.6`.

The fine mask is reviewed metadata, never a texture sampled by the game. Offline
preparation may suggest a mask from alpha or segmentation, but suggestions are
candidate data until explicitly accepted. Passable objects use an explicit
empty solid mask. Navigation edges are clearance-tested against the fine mask so
coarse routes cannot promise a passage rejected by continuous ship collision.

The asset viewer now lists all nine registered runtime categories: home island,
generated island, player ship, wreck, fishing shoal, survey site, survey
service, island approach and home dock. Only the three finite package-backed
profiles are authorable in `GR-2.5`: the home hybrid grid, centred player box
and explicit-empty fishing shoal. Generated-island policy and the five
developer/dynamic profiles remain inspectable and read-only until `GR-2.6` or a
later runtime-authority milestone gives their geometry an authoritative
consumer.

The implemented workflow is:

1. Overlay `32`-pixel navigation cells, optional `8`-pixel collision subcells,
   art or developer previews, origins, bounds, anchors, raw solids and the
   effective ship-clearance probe.
2. Paint, erase, flood-fill or rectangularly select home subcells; edit the
   constrained centred player box; explicitly confirm the passable shoal; and
   use deterministic undo/redo and zoom/pan.
3. Run the shared exact validator before export and intake. Required anchors,
   dock-to-edge connectivity and derived cardinal navigation edges use the
   runtime swept-hull geometry rather than a second approximation.
4. Export or import a collision-only candidate containing no PNG data. Its base
   runtime revision and deterministic collision fingerprint reject stale edits;
   replace and reset-to-coarse are explicit operations.
5. Run `npm.cmd run assets:intake -- <collision-candidate.json> --replace` to
   update collision metadata and increment the package revision once without
   replacing runtime images or catalog image bindings.
6. For a full visual candidate, omit `collisionIntent` or use `preserve` to keep
   accepted collision metadata. Only explicit `replace` or `reset-to-coarse`
   changes it.

This is not a general raster editor. It edits semantic collision metadata while
source and runtime PNGs remain separate, unchanged artifacts. Interactive
WebGL usability and performance acceptance for the editor remain outstanding;
the implemented automated gates do not claim that browser result.

## Planned production workflow

`GR-3.1` through `GR-3.4` extend the proven pilot tooling in four gates:

1. A versioned recipe manifest records semantic identity, provenance, source
   hashes, target geometry, style constraints, collision/interaction layers,
   transforms and output bindings.
2. Provider-neutral source jobs feed deterministic local preparation for
   cleanup, trim/pad, scale, slicing, frames, sheets and thumbnails. Incremental
   caching and resumable batches must not weaken validation.
3. The workbench compares variants, art diffs and mask diffs; records review
   decisions; and promotes only explicit accepted bundles through repository
   intake.
4. Batch orchestration regenerates catalogs, reports and review queues, rejects
   stale/unreviewed outputs and proves numeric throughput and runtime budgets on
   a representative authorized batch.

Source generation may be nondeterministic, but its inputs and resulting source
hash are recorded. All derived outputs after source acceptance must be
reproducible. Runtime generation, silent mask replacement and automatic catalog
promotion remain prohibited.

## Runtime separation

Keep changing or stateful content separate from static base art:

- the player boat and future vessels;
- people, smoke, flags, foam and waves;
- runtime navigator wrecks;
- dossier, survey-site and shoal state cues;
- fog, knowledge, route and risk overlays; and
- labels, interaction prompts and developer diagnostics.

The home island may include fixed terrain, buildings and dock art whose layout
is captured by its metadata. It must not bake dynamic voyage or discovery state
into the base image.

## Performance and acceptance

- Load the three pilot packages at boot and report startup time and texture
  memory.
- Preserve current camera culling; split a large authored composition only when
  required for culling, fog or texture limits.
- Confirm normal-zoom readability under fog, Personal grey, route and risk
  overlays.
- Confirm the home dock is reachable and exact-dock return still works.
- Confirm the boat remains aligned during turning, sailing, docking, teleport
  and reset presentation.
- Confirm every boat heading has the correct bow direction and stable origin,
  and that its wake responds to movement without persisting at rest.
- Confirm the authored shoal stays passable, reveals no hidden state and retains
  its complete sight/survey/return/wreck behavior.
- Run the clean typecheck, test and build gate plus the approved numeric startup,
  memory, draw-call and frame-time budgets before considering broader asset
  work.
