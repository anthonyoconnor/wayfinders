# Wayfinders operational status

Status: current development handoff, verified 2026-07-15.

The GR-3.5 working tree passed asset validation, source and test typechecks,
architecture, quick, contract, integration and repository-I/O lanes, and the
production bundle on 2026-07-15. The bundle lane required its normal filesystem
access after the managed sandbox denied Vite config loading. Serial performance
verification remains recorded through commit `0ea2d7a`; GR-3.5 does not change
runtime frame work or performance budgets.

This file records only volatile operational facts. Implemented behavior belongs
in `Wayfinders_Technical_Design.md`, ownership in `ARCHITECTURE_MAP.md`, future
scope in `Wayfinders_Roadmap.md`, and completed evidence in
`Wayfinders_Roadmap_Archive.md`.

## Runnable surfaces

- The default browser route starts a fresh playable voyage.
- `?mode=assets` opens the asset library, candidate review, runtime package
  inspection, guided reference/local-PNG intake, and supported collision
  authoring.
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

- Production-asset promotion still requires a command-line step; guided intake
  and preparation are UI-native. Complete pending-candidate controls and
  UI-native promotion remain in the current roadmap.
- Pending island candidates do not yet have a complete collision-edit and
  isolated-sea-trial loop.
- The layered water system is proposed but is not registered or loaded by the
  game.
- Desktop keyboard and pointer input are the validated target. Touch-first
  sailing and representative mobile performance remain unimplemented.
- Interactive WebGL acceptance remains appropriate for presentation, asset-tool
  usability, and browser frame-time changes even when automated gates pass.
- End-to-end browser departure responsiveness has not been remeasured after the
  current guidance and active-chunk architecture settled. Automated subsystem
  budgets do not by themselves close the original user-reported sluggishness.
