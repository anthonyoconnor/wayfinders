# Wayfinders authored-asset direction

Status: active. `GR-1.1` through `GR-1.4` are implemented and accepted.
`GR-2.1` through `GR-2.3` are authorized as an ordered tooling batch.

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
