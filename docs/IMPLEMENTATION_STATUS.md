# Wayfinders operational status

Status: current development handoff, verified 2026-07-16.

The asset workflow through GR-4.1 is implemented. Focused contract and
repository-I/O verification covers native-dimension intake and padding,
deterministic shoreline seeding, structured candidate save/validation/review/
promotion, fingerprint invalidation, rollback, and isolated-trial authority.
Run the aggregate source gates below against the current tree. Serial
performance verification remains recorded through commit `0ea2d7a`; this local
asset work does not change gameplay frame work or performance budgets.

This file records only volatile operational facts. Implemented behavior belongs
in `Wayfinders_Technical_Design.md`, ownership in `ARCHITECTURE_MAP.md`, future
scope in `Wayfinders_Roadmap.md`, and completed evidence in
`Wayfinders_Roadmap_Archive.md`.

## Runnable surfaces

- The default browser route starts a fresh playable voyage.
- `?mode=assets` opens URL-addressable Islands, Ships, and Fishing shoals
  workspaces. Islands use a focused import, properties, availability-status,
  sea-trial, collision-mask, and single-save workflow. The other workspaces
  retain the general asset inspection and production controls.
- An island candidate can launch a disposable open-water sea trial from its
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

- The layered water system is proposed but is not registered or loaded by the
  game.
- Desktop keyboard and pointer input are the validated target. Touch-first
  sailing and representative mobile performance remain unimplemented.
- Interactive WebGL acceptance remains appropriate for presentation, asset-tool
  usability, and browser frame-time changes even when automated gates pass.
- End-to-end browser departure responsiveness has not been remeasured after the
  current guidance and active-chunk architecture settled. Automated subsystem
  budgets do not by themselves close the original user-reported sluggishness.
