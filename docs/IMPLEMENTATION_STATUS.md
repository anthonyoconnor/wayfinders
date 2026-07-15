# Wayfinders implementation status

Last verified: 2026-07-14.

This is the operational handoff for a new development session. It records what
is running, the latest verification baseline and the gaps that matter before
new work starts. It intentionally does not repeat feature specifications,
architecture rules or completed milestone evidence.

## Current state

- The accepted gameplay baseline runs through `GP-4.1`.
- The accepted graphics/tooling baseline runs through `GR-2.5`.
- No later gameplay milestone is authorized.
- `GR-2.1` through `GR-2.5` are accepted. The workbench includes a
  browsable 23-entry asset library, retained per-asset drafts, `8`/`32`-pixel
  brushes and validated direct package saves. The user verified the saved home
  collision in gameplay. `GR-2.6` is skipped for now rather than blocking asset
  production on an unnecessary broader acceptance exercise.
- `GR-3.1` through `GR-3.4` are authorized as an ordered prototype batch. The
  focus is rapid source preparation, library preview, reviewed collision drafts
  and selected in-game testing—not a general art, animation or generation tool.
- `GR-3.1` is implemented: a strict version-1 recipe manifest covers all three
  current runtime package families plus five selected island variations. Runtime
  bindings preserve accepted collision, while new islands begin as blank
  editable `32`/`8`-pixel collision drafts.
- `GR-3.2` is implemented: `assets:prepare` performs deterministic
  border-connected matte cleanup, trim/pad and contain scaling for the five
  selected islands. It writes transparent `480 x 480` candidates, `192`-pixel
  thumbnails, blank hybrid collision drafts and fingerprinted reports. A second
  unchanged run is a complete timestamp-preserving cache hit, and `assets:check`
  rejects stale output.
- Gameplay-session saving is intentionally absent. Every launch or browser
  refresh starts a fresh voyage. Development-only asset package saves are a
  separate authoring operation and do not persist gameplay state.

The playable baseline includes deterministic sailing and islands, fog and
inherited water knowledge, provision-aware voyages, exact-dock settlement,
navigator succession and Great Hall history, provision-funded island/site
surveys, three hidden idol locations in the default world, final completion
choices, authored home/boat/pilot-shoal presentation and developer diagnostics,
plus a separate shared-runtime asset viewer, candidate intake workbench and
deterministic catalog/preparation pipeline. The runtime also supports sparse
8-pixel collision masks within the 32-pixel navigation grid, swept fine
collision, clearance-tested route edges and registered authored/developer
collision profiles. The viewer enumerates all nine profiles, edits the three
finite package-backed collision shapes, browses 20 reference islands, validates
exact cross-package ship clearance and directly saves revision/fingerprint-
protected collision-only candidates through authoritative repository intake.

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

Latest committed verification baseline:

- Asset catalog, PNG/frame, texture-limit, generated-code, thumbnail and report
  consistency checks pass before compilation.
- TypeScript typecheck passes.
- 367 automated tests pass across 46 files.
- The production Vite build passes.
- Browser acceptance covers the accepted fishing, return, wreck, succession,
  survey-site, idol completion, continued-world and new-game flows with a clean
  warning/error console.
- The Phaser bundle-size warning is informational.

## Known operational gaps

- An interactive pass over the Great Hall's focused handover and optional
  browsing modes remains outstanding; their shared read model and exact-dock
  access policy have automated coverage.
- The broad formal WebGL/performance matrix once proposed for `GR-2.6` is
  deferred. Existing automated collision budgets remain in the normal gate.
- Representative mid-range mobile rendering/performance validation remains
  outstanding.
- Touch-first sailing is not implemented.
- Fishing boats, trade vessels, numerical fishing output and an authoritative
  tribe economy are not implemented.
- Broad automatic runtime asset replacement remains deferred while the
  authorized GR-3 prototype proves a practical review and testing loop.

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
