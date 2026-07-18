# Wayfinders operational status

Status: current development handoff, verified 2026-07-17.

The asset workflow through GR-4.4, the graphical Great Hall through GR-5.3,
and gameplay through GP-5.2 are implemented. GP-5.1 replaces the filled return
corridor with the chunk-indexed Voyage Sense thread. GP-5.2 carries its four
risk colours into a graphics-only cargo partition for exact fractional return
cost, depleted supply, and prompt-bound survey cost. Focused contracts cover
fractional partitions, shortfalls, safe and unknown returns, and projected
post-survey risk. Browser acceptance at normal gameplay zoom verified the
unlabelled rack, fractional return allocation, two-bundle survey glow, hidden
exact status, and no warning or error output.

The audio layer is implemented through `AUD-5`. Game and asset-library modes
share one validated stored-audio catalog; game mode has explicit enable, mute,
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
pass. Live keyboard activation, stored-media playback, repeated ambience loops,
crossfades, and ducking acceptance remain pending
because the in-app browser connection did not initialize during this handoff;
the rebuilt ambience also awaits product-owner audition.

WTR-2.0 through WTR-2.6 are implemented. The world manifest carries stable water
regions and generation resolves a deterministic chunk-addressable water layout
without changing gameplay terrain. The active-chunk `WaterRenderer` owns cached
base and surface textures, visible-only discrete animation, directional
deep-to-coastal transitions, coastal underpainting beneath transparent island
edges, current/rough accents, reduced motion, and the aligned home-shore
overlay. Fishing grounds use neutral hidden-quality presentation and lean,
steady, or rich surveyed cues with no visible fish. The Water workspace uses the
real generator and runtime assets with seed, zoom, overlay, pause, and comparison
controls, and still omits the production-tooling sidebar. Asset validation,
both typechecks, quick, contract, and I/O lanes, the production bundle, and live
game and workspace browser checks pass.

The product owner accepted the GR-5.2 approval preview and authorized its
shared-renderer game integration. Focused contract and
repository-I/O verification covers native-dimension intake and padding,
deterministic shoreline seeding, atomic island availability, exact-mask round
trips, duplicate identity rejection, rollback, and isolated-trial authority.
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
read-only asset gates, and the production bundle pass. Remaining audio browser
acceptance is described above. The former clean-repository fixture drift was
corrected during WTR-2 and is no longer an open blocker.

This file records only volatile operational facts. Implemented behavior belongs
in `Wayfinders_Technical_Design.md`, ownership in `ARCHITECTURE_MAP.md`, future
scope in `Wayfinders_Roadmap.md`, and completed evidence in
`Wayfinders_Roadmap_Archive.md`.

## Runnable surfaces

- The default browser route starts a fresh playable voyage.
- `?mode=assets` opens URL-addressable Islands, Ships, Fishing shoals, Water,
  Great Hall, and Audio workspaces. Islands use a focused import, properties,
  availability-status, sea-trial, collision-mask, and single-save workflow.
  Ships and Fishing shoals retain general asset inspection and production
  controls. Water is a read-only production inspection surface over the same
  generated layouts and runtime assets as the game, with seed, profile, zoom,
  overlay, pause, and comparison controls and no Production tooling sidebar.
  Great Hall is a view-only host for the validated V1 fixture and the
  same bounded renderer used by the game, with a one-to-twenty navigator-count
  selector. Audio is a play-only stored-file browser with no edit or repository
  operation.
- Game mode exposes a **Sound** panel with explicit enable, mute, master, music,
  ambience, sound-effect, and interface levels. Ocean and speed-controlled wake
  ambience, automatic gameplay/UI cues, and home-harbor/open-water music start
  after enable.
- An imported island can launch a disposable open-water sea trial from its
  library record and return directly to that same record.
- Gameplay-session saving is absent; refresh starts a new session.
- Repository asset authoring is local development tooling and is independent of
  gameplay persistence.

Use `npm.cmd run dev` and open `http://127.0.0.1:5173/`. The asset operator flow
is in `ASSET_PRODUCTION_QUICKSTART.md`.

## Verification state

Reproduce the recorded source gates with:

```powershell
npm.cmd run check
npm.cmd run test:perf
```

Exact test counts are intentionally not recorded here because project and file
assignment change frequently. `vitest.config.ts` is the source of truth for lane
membership; `tests/README.md` explains lane selection.

## Open operational gaps

- Complete live audio browser acceptance for keyboard focus, stored-file media
  decode/audition, mute and level controls, silence at rest, smoothed wake,
  direction reversal, loop seams, cue coalescing, supplementary muted feedback,
  music crossfades and lifecycle ducking, console-clean teardown, and restart.
- End-to-end browser departure responsiveness has not been remeasured after the
  current guidance and active-chunk architecture settled. Automated subsystem
  budgets do not by themselves close the original user-reported sluggishness.
