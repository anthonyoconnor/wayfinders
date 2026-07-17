# Wayfinders operational status

Status: current development handoff, verified 2026-07-16.

The asset workflow through GR-4.4 and the graphical Great Hall through GR-5.3
are implemented. The product owner accepted the GR-5.2 approval preview and
authorized its shared-renderer game integration. Focused contract and
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
owned by the technical design. The aggregate source gates and serial
performance lane below pass against this current handoff tree, including
world-density, island-placement, and Great Hall fixture coverage. The aggregate
`npm.cmd run check` command remains blocked before those lanes because the GR-2
generated asset catalog inherited from current `main` is stale.

This file records only volatile operational facts. Implemented behavior belongs
in `Wayfinders_Technical_Design.md`, ownership in `ARCHITECTURE_MAP.md`, future
scope in `Wayfinders_Roadmap.md`, and completed evidence in
`Wayfinders_Roadmap_Archive.md`.

## Runnable surfaces

- The default browser route starts a fresh playable voyage.
- `?mode=assets` opens URL-addressable Islands, Ships, Fishing shoals, and Great
  Hall workspaces. Islands use a focused import, properties,
  availability-status, sea-trial, collision-mask, and single-save workflow.
  Ships and Fishing shoals retain general asset inspection and production
  controls. Great Hall is a view-only host for the validated V1 fixture and the
  same bounded renderer used by the game, with a one-to-twenty navigator-count
  selector.
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

- The layered water system is proposed but is not registered or loaded by the
  game.
- End-to-end browser departure responsiveness has not been remeasured after the
  current guidance and active-chunk architecture settled. Automated subsystem
  budgets do not by themselves close the original user-reported sluggishness.
