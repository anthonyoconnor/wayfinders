# Wayfinders implementation status

Last verified: 2026-07-14.

This is the operational handoff for a new development session. It records what
is running, the latest verification baseline and the gaps that matter before
new work starts. It intentionally does not repeat feature specifications,
architecture rules or completed milestone evidence.

## Current state

- The accepted gameplay baseline runs through `GP-4.1`.
- The accepted graphics baseline runs through `GR-1.4`.
- No later gameplay milestone is authorized.
- `GR-2.1` through `GR-2.3` are authorized as an ordered graphics-tooling batch
  and are in progress; no `GR-3` scope is authorized.
- Saving is intentionally absent. Every launch or browser refresh starts a
  fresh session. Saving may return only in an explicitly authorized named
  milestone whose scope includes it.

The playable baseline includes deterministic sailing and islands, fog and
inherited water knowledge, provision-aware voyages, exact-dock settlement,
navigator succession and Great Hall history, provision-funded island/site
surveys, three hidden idol locations in the default world, final completion
choices, authored home/boat/pilot-shoal presentation and developer diagnostics.

## Run and verify

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/` in a WebGL-capable browser. For a concurrent
instance, use a distinct port such as `npm.cmd run dev -- 5174`.

Run the complete automated gate with:

```powershell
npm.cmd run check
```

Latest accepted verification baseline:

- TypeScript typecheck passes.
- 264 automated tests pass across 32 files.
- The production Vite build passes.
- Browser acceptance covers the accepted fishing, return, wreck, succession,
  survey-site, idol completion, continued-world and new-game flows with a clean
  warning/error console.
- The Phaser bundle-size warning is informational.

## Known operational gaps

- An interactive pass over the Great Hall's focused handover and optional
  browsing modes remains outstanding; their shared read model and exact-dock
  access policy have automated coverage.
- Representative mid-range mobile rendering/performance validation remains
  outstanding.
- Touch-first sailing is not implemented.
- Fishing boats, trade vessels, numerical fishing output and an authoritative
  tribe economy are not implemented.
- Broader production asset tooling and replacement remain deferred to `GR-2`
  and later replanning.

## Document ownership

- `Wayfinders_Roadmap.md` owns only upcoming scope, sequencing and authorization
  state.
- `Wayfinders_Roadmap_Archive.md` owns completed milestone scope and acceptance
  evidence.
- `Wayfinders_Technical_Design.md` owns the implemented architecture and
  gameplay contracts.
- `Wayfinders_Economy_Design.md` owns gameplay direction beyond the implemented
  baseline.
- `Wayfinders_Asset_Pipeline.md` owns the deferred graphics-production
  direction.

Update this document only when the runnable baseline, verification result or a
known operational gap changes.
