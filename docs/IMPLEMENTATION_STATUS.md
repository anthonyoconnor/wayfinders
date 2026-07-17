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

The audio layer is implemented through `AUD-2`. Game and asset-library modes
share one validated stored-audio catalog; game mode has explicit enable, mute,
master/category controls, bounded voice ownership, diagnostics, and silent
fallback. The asset library has a play-only Audio workspace over the same
stored files. Game mode reconciles a persistent ocean bed and a smoothed,
speed-controlled wake from current presentation state without world queries.
Catalog/WAV, mixer, controller, ambience state/controller, controls, preview,
workspace, and composition checks pass. Live keyboard/media and audible-loop
browser acceptance is still pending because the in-app browser connection did
not initialize during this handoff.

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
2,000 serial samples on 2026-07-16. The implemented regression contract is
owned by the technical design. Architecture validation, source and test
typechecks, the quick and integration lanes, focused GP-5.2 and audio contracts,
audio repository-I/O checks, GP-5.2 browser acceptance, and the production
bundle passed. Audio browser acceptance remains pending. The aggregate
`npm.cmd run check` reaches and passes `audio:check` but remains blocked at
asset validation because `promotion-summary.json` is stale. The combined
correctness run retains asset-only fixture drift that expects the former
three-package empty-source baseline while the current workspace contains
additional island sources, candidates, and recipes. A cross-process collision
test that timed out under parallel lane contention passes in isolation. Those
authored-asset artifacts and expectations are outside GP-5.2 and the audio
layer, and remain untouched.

This file records only volatile operational facts. Implemented behavior belongs
in `Wayfinders_Technical_Design.md`, ownership in `ARCHITECTURE_MAP.md`, future
scope in `Wayfinders_Roadmap.md`, and completed evidence in
`Wayfinders_Roadmap_Archive.md`.

## Runnable surfaces

- The default browser route starts a fresh playable voyage.
- `?mode=assets` opens URL-addressable Islands, Ships, Fishing shoals, Great
  Hall, and Audio workspaces. Islands use a focused import, properties,
  availability-status, sea-trial, collision-mask, and single-save workflow.
  Ships and Fishing shoals retain general asset inspection and production
  controls. Great Hall is a view-only host for the validated V1 fixture and the
  same bounded renderer used by the game, with a one-to-twenty navigator-count
  selector. Audio is a play-only stored-file browser with no edit or repository
  operation.
- Game mode exposes a **Sound** panel with explicit enable, mute, master, music,
  ambience, sound-effect, and interface levels. Ocean and speed-controlled wake
  ambience start after enable. Automatic gameplay cues and music-state
  selection are not yet bound.
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
  direction reversal, loop seams, console-clean teardown, and restart.
- The layered water system is proposed but is not registered or loaded by the
  game.
- End-to-end browser departure responsiveness has not been remeasured after the
  current guidance and active-chunk architecture settled. Automated subsystem
  budgets do not by themselves close the original user-reported sluggishness.
