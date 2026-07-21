# Wayfinders operational status

Status: current development handoff, updated 2026-07-21.

The asset workflow through GR-4.4, the graphical Great Hall through GR-5.3,
and gameplay through GP-6.6 are implemented. GP-5.1 replaces the filled return
corridor with the chunk-indexed Voyage Sense thread. GP-5.2 carries its four
risk colours into a graphics-only cargo partition for exact fractional return
cost, depleted supply, and prompt-bound survey cost. Focused contracts cover
fractional partitions, shortfalls, safe and unknown returns, and projected
post-survey risk. Browser acceptance at normal gameplay zoom verified the
unlabelled rack, fractional return allocation, two-bundle survey glow, hidden
exact status, and no warning or error output.

`GR-6.1` removes the floating Home caption and all persistent non-home island
dossier names and marker graphics without changing island sighting, survey, or
other discovery presentation. The focused renderer contract, both typechecks,
`check:quick`, integration lane, and production bundle pass. The full contract
lane is otherwise green but reaches an unrelated in-progress production-island
asset fixture whose recipe count currently differs from its expected count
(`28` versus `29`). The product owner accepted the resulting presentation on
2026-07-20, closing the milestone.

`MAP-1.0` through `MAP-1.4` are implemented in the current worktree. The Maps
workspace can create, duplicate, edit, validate, save, reopen, and launch exact
checked-in initial-world definitions. The repository contains one current
`wayfinders-playtest` head; explicit game startup loads its retained fingerprint
before scene creation, and authored restart/new-game actions rebuild fresh state
from that same source. Procedural startup remains
the default. Focused codec, compiler, fishing, editor-draft, preview,
navigation-guard, browser-client, repository service/API/checker, launch,
source-loader, and simulation tests are present. The focused authored-map
performance file and the full aggregate source gate are green, including asset
and map repository validation, both typechecks, architecture, quick, contract,
integration, repository-I/O, and production-bundle coverage. Responsive
live-browser and product-owner playtest results have not yet been recorded and
must not be inferred from the automated implementation evidence.

Forward reach remains available as an on-demand player overlay, but its normal
hidden state now suspends the derived scheduler entirely. Showing it starts a
current revisioned request, keeps stale contours hidden until publication, and
hiding it cancels active work without affecting synchronous return authority.
The Great Hall fixture and preview also normalize handover focus to the
departing navigator immediately before the successor.

GP-6 focused topology, manifest, periodic generation, navigation, visibility,
knowledge, feature, full-lap simulation, activation, water, overlay, cloud,
marker, and lifted-view contracts pass. Source and test typechecks, architecture
validation, quick, contract, integration, repository-I/O, focused performance,
and presentation verification pass. The read-only asset gate and production
bundle also pass. A clean serial closeout sample met every approved GP-6 budget;
the archive owns its durable measurements. Live game and Water-workspace
acceptance covered all four seams and corners, responsive layout, Great Hall,
sound enable/mute wiring, and a clean browser console.

The audio layer is complete and accepted through `AUD-5`. Game and asset-library
modes share one validated stored-audio catalog; game mode has explicit enable, mute,
master/category controls, bounded voice ownership, diagnostics, and silent
fallback. The asset library has a play-only Audio workspace over the same
eleven final WAVs. A deterministic Node.js renderer can regenerate that complete
set at the stable paths without changing catalog or runtime code. Automated
checks cover that retained renderer. After product-owner audition, the ambience
category default was halved to `0.275` and both ambience files were rebuilt as
longer, irregular low-pass water textures without pitched or fixed-grid pulses.
Current inspection reports `8.409 MiB` stored audio; ocean measures `0.055` RMS
with a `0.2152` peak and wake measures `0.060` RMS with a `0.1938` peak before
catalog and mixer gains. The asset gate passes.

All eight navigator-achievement kinds now use one checked-in animated sprite
sheet in both the Great Hall and a dedicated read-only Icons workspace. The
workspace presents every animation together with pause/play and review-speed
controls. Desktop, responsive, lifecycle, shared-renderer, reduced-motion, and
console-clean browser acceptance pass after a second visual refinement round.

The explicit Enable sound activation now resumes Web Audio directly and
completes unlock without requiring the player to leave and refocus the game;
focused regression coverage starts a discovery cue immediately afterward. The
product owner confirmed immediate unlock and live discovery/survey cue playback.
Game mode reconciles a persistent ocean bed and a smoothed,
speed-controlled wake from current presentation state without world queries.
It also batches typed discovery, survey, idol, exact-return, wreck, and accepted
UI sources into at most one priority- and cooldown-bounded cue per synchronous
transaction. High-rate and developer-only state remains silent. Game mode also
selects home-harbor or open-water music from current visible
presentation state, crossfades two stable loops, and ducks them behind return,
wreck, succession, and completion. Mixer, controller, ambience, cue and music
policies/controllers, controls, preview, workspace, and composition checks
pass. The product owner accepted keyboard activation, stored-media playback,
mute and level controls, repeated ambience and music loops, gameplay cues,
crossfades, lifecycle ducking, teardown and restart, and the rebuilt ambience
on 2026-07-20, closing the audio track.

WTR-2.0 through WTR-2.6 are implemented. The world manifest carries stable water
regions and generation resolves a deterministic canonical chunk-addressable,
periodic water layout without changing gameplay terrain. The active-chunk
`WaterRenderer` owns cached canonical base/surface textures, shared periodic
image aliases, visible-owner discrete animation, directional
deep-to-coastal transitions, coastal underpainting beneath transparent island
edges, current/rough accents, reduced motion, and revision-matched authored
composite/apron water ownership. Fishing grounds use neutral hidden-quality presentation and lean,
steady, or rich surveyed cues with no visible fish. The Water workspace uses the
real generator and runtime assets with seed, zoom, overlay, pause, and comparison
controls, and still omits the production-tooling sidebar. Asset validation,
both typechecks, quick, contract, and I/O lanes, the production bundle, and live
game and workspace browser checks pass.

`PRS-1` through `PRS-2.4` are implemented. Exact-dock settlement now maintains
the hidden weighted Prosperity ledger, and one shared Supported-connectivity
authority publishes safe routes for returned surveyed fishing shoals and
returned community dossiers. The fixed-pool presentation uses the selected
Quiet outriggers direction, endpoint-only service rotation, restrained density,
fixed family opacity independent of player proximity, periodic projection,
shoreline occlusion, and a static reduced-motion mode. Independent default-hidden
turquoise fishing and ochre trade route diagnostics reuse the published safe
paths, and the Ship Traffic asset workspace previews both runtime craft through
their shared factory. Focused score, route, integration, scheduler, renderer,
seam, and performance checks pass with both typechecks and architecture
validation. Browser acceptance exercised separate fishing lead/survey returns
and the Great Hall, then inspected the actual production fishing and trade
graphics in a representative renderer scene with no warning or error output.

The product owner accepted the GR-5.2 approval preview and authorized its
shared-renderer game integration. Focused contract and
repository-I/O verification covers native-dimension intake and padding,
deterministic `8`-pixel centered-circle collision seeding independent of painted
pixels, manual Asset Tools refinement, atomic island availability, exact-mask
round trips, duplicate identity rejection, rollback, and isolated-trial
authority.
World-generation coverage verifies deterministic authored selection without
replacement, manifest provenance, exact collision rasterization, and
procedural shortfall. Presentation coverage verifies revision-matched texture
loading, exact collision-bounds alignment, coherent fallback, and active-chunk
creation and destruction. Browser smoke acceptance covers the game, zoom input,
and the simplified Islands workspace without warning or error output.
The twenty-generation presentation-fixture baseline measured `0.193 ms` p95 over
2,000 serial samples on 2026-07-16. The implemented regression contract is owned
by the technical design. Architecture validation, source and test typechecks,
the quick, contract, integration, and repository-I/O lanes, focused GP-5.2,
audio, and water contracts, audio repository-I/O checks, the water and complete
read-only asset gates, and the production bundle pass. Audio browser acceptance
is complete as described above. The former clean-repository fixture drift was
corrected during WTR-2 and is no longer an open blocker.

This file records only volatile operational facts. Implemented behavior belongs
in `Wayfinders_Technical_Design.md`, ownership in `ARCHITECTURE_MAP.md`, future
scope in `Wayfinders_Roadmap.md`, and completed evidence in
`Wayfinders_Roadmap_Archive.md`.

## Runnable surfaces

- The default browser route starts a fresh procedural voyage. Supplying exactly
  one cataloged `map` and retained `mapFingerprint` starts a fresh authored-map
  voyage; an invalid explicit source blocks startup and offers a procedural
  action.
- `?mode=assets` opens URL-addressable Maps, Islands, Ships, Ship Traffic,
  Fishing shoals, Water, Clouds, Icons, Great Hall, and Audio workspaces.
  Islands use a focused import, properties,
  availability-status, sea-trial, collision-mask, and single-save workflow.
  Ships and Fishing shoals retain general asset inspection and production
  controls. Water is a read-only production inspection surface over the same
  generated layouts and runtime assets as the game, with seed, profile, zoom,
  overlay, pause, and comparison controls and no Production tooling sidebar.
  Icons is a read-only simultaneous animation-review surface for the eight
  navigator-achievement kinds, with synchronized pause and playback-speed
  controls over the same sheet used in the Great Hall.
  Great Hall is a view-only host for the validated V1 fixture and the
  same bounded renderer used by the game, with a one-to-twenty navigator-count
  selector. Audio is a play-only stored-file browser with no edit or repository
  operation. Maps is the checked-in initial-world editor with compact semantic
  preview, compiler diagnostics, guarded save, and exact-fingerprint playtest
  handoff.
- Game mode exposes a **Sound** panel with explicit enable, mute, master, music,
  ambience, sound-effect, and interface levels. Ocean and speed-controlled wake
  ambience, automatic gameplay/UI cues, and home-harbor/open-water music start
  after enable.
- An imported island can launch a disposable open-water sea trial from its
  library record and return directly to that same record.
- Gameplay-session saving is absent; refresh starts a new session from the
  selected procedural or immutable authored source.
- Repository asset authoring is local development tooling and is independent of
  gameplay persistence.

Use `npm.cmd run dev -- --host 127.0.0.1 --port 5173` and open
`http://127.0.0.1:5173/`. The asset operator flow is in
`ASSET_PRODUCTION_QUICKSTART.md`.

## Verification state

Reproduce the recorded source gates with:

```powershell
npm.cmd run check
npm.cmd run test:perf
```

Exact test counts are intentionally not recorded here because project and file
assignment change frequently. `vitest.config.ts` is the source of truth for lane
membership; `tests/README.md` explains lane selection.

The pre-MAP source baseline was recorded on the currently loaded development
machine before authored-source changes:

| Profile | Construction p95 | World generation p95 | Tile entry p95 | Guidance slice p95 | Loaded / active / texture resources | Heap delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `P0` | `505.5147 ms` | `396.5938 ms` | `2.8755 ms` | `3.1365 ms` | `9 / 9 / 27` | `10,610,808` bytes |
| `P1` | `1005.8768 ms` | `796.7826 ms` | `2.1325 ms` | `3.1018 ms` | `36 / 25 / 75` | `31,774,656` bytes |

These loaded-machine `P0`/`P1` generation values already exceeded the existing
`350 ms`/`600 ms` generation limits before MAP implementation, consistent with
the timing variance below. They distinguish inherited noise from authored-map
work but do not replace the approved generation budgets.

The final focused MAP performance run passed its four MAP-specific tests as
part of the complete serial performance lane. The normal fixture
used the `192 x 192` P1 world with `32` repeated-asset islands and no shoals;
the dense-valid fixture used `96` repeated-asset islands and `96` valid shoals.
Each timing phase used three samples, feature seeding produced six trace
samples, stable runtime used `500` updates, and preview queries used `1,000`
samples:

| Fixture | Parse p95 | Compile p95 | Construction p95 | Restart p95 | Feature seeding p95 | Stable frame p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | `0.3668 ms` | `177.4781 ms` | `395.2264 ms` | `259.1130 ms` | `15.9021 ms` | `0.0426 ms` |
| Dense valid | `4.2961 ms` | `332.6571 ms` | `256.0005 ms` | `349.2557 ms` | `12.2552 ms` | `0.0538 ms` |

| Fixture | Committed editor rebuild p95 | Preview-index rebuild p95 | Preview query p95 |
| --- | ---: | ---: | ---: |
| Normal | `293.6483 ms` | `0.4874 ms` | `0.0101 ms` |
| Dense valid | `245.5340 ms` | `1.8447 ms` | `0.0056 ms` |

All measurements are below the authored-map budgets owned by the technical
design. They do not replace responsive browser resource-plateau acceptance.

The final GP-6 live pass sailed and teleported through the west/east,
north/south, and corner joins; exercised the game, Great Hall, and Water
workspace at normal and `900 x 650` responsive viewports; and found no browser
warning or error output. That pass exposed an opaque base-water sampling cross
where four world images met. The renderer now presents an exact inner frame
from a one-pixel extruded gutter, and the same corner/zoom retest removed the
cross without adding canonical textures or alias redraws.

Two later full serial reruns on the currently loaded development machine showed
system-wide timing variance after the clean acceptance sample. The latest
world-generation p95 values were `441.1298 ms`, `667.4999 ms`, and
`2304.6252 ms` for `P0`, `P1`, and `P2`; the first two exceed their approved
`350 ms` and `600 ms` limits while `P2`, tile entry, cooperative guidance,
active-image ownership, and resource bounds still pass. The generation code is
identical to the clean accepted sample, so this is retained as an operational
trend check rather than a gameplay blocker.

## Open operational gaps

- Complete responsive live-browser acceptance for Maps create/open/edit/save/
  reopen/playtest, dirty tab/history/page guards, explicit-source refresh and
  restart, procedural escape, workspace teardown, accessibility, resource
  plateau, and console output; record product-owner playtest acceptance. The
  current attempts confirmed the local app and map catalog return HTTP `200`,
  but the browser-control backend exposed no available browser; this is an
  environment blocker rather than a reported application failure.
- End-to-end browser departure responsiveness has not been remeasured after the
  hidden-guidance suspension and frame-allocation cleanup. Automated subsystem
  budgets do not by themselves close the original user-reported sluggishness.
- Repeat the serial generation trend on a quiet machine before using the latest
  loaded-machine `P0`/`P1` p95 samples as a performance baseline.
