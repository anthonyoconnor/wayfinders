# Wayfinders implementation status

This is the starting point for a new development session.

## Accepted baseline

The current implementation is the accepted starting point. It includes
developer tooling, home waters, exploration knowledge, provision-aware risk
and return, expedition inheritance, deterministic island dossiers,
cross-session persistence, versioned navigator succession, four-voyage
navigator tenures with exact-dock-committed achievements in a permanent Great
Hall chronicle, the shared required generation-handover view, returned
identity/fate reports for runtime navigator wrecks, provision-funded surveying,
exact-island fog reveal, extensible survey sites and the performance foundation.

Do not reimplement the baseline or restore the obsolete source namespace.
Future work is organized into `GP-*` gameplay and `GR-*` graphics tracks in
`Wayfinders_Roadmap.md`. The authorized `GP-0.1` through `GP-3.3` work is
complete and accepted. `GP-4.1` is the next proposed gameplay milestone; it is
not authorized by this status document.

## Run and verify

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/` in a WebGL-capable browser.
To run concurrent instances, give each one a distinct port, for example
`npm.cmd run dev -- 5174`, then open `http://127.0.0.1:5174/`.

Run the complete automated pipeline with:

```powershell
npm.cmd run check
```

Current verification baseline:

- TypeScript typecheck passes.
- 262 automated tests pass across 28 files. The suite includes deterministic
  island-dossier and survey-site catalog/lifecycle coverage, exact-island fog
  reveal, simulation integration, lineage/Great Hall and exact-version
  persistence coverage.
- The production Vite build passes.
- Existing browser acceptance covers fishing return,
  returned-lead upgrade,
  autosave reload, manual checkpoint restore, exact ship/camera restoration,
  the home-linked fishing-ground cue, wreck-hold reload, generation
  advancement, save clearing, four-voyage automatic succession,
  runtime-wreck survey/reporting and a clean warning/error console. The shared
  Great Hall model and exact-dock access policy are automated; an interactive
  pass over its focused handover and optional browsing modes remains
  outstanding. GP-3.2/GP-3.3 dossier and survey-site behavior is covered by
  automated tests. GP-3.3 browser acceptance confirms all six findable-target
  developer moves, the three matching service-anchor interactions, Survey-only
  site prompting, visible placeholder art, live unsuppressed input with the
  drawer open and a clean warning/error console.
- The Phaser bundle-size warning remains informational.

## Current playable foundation

### World and navigation

- The default world is a deterministic `96 × 96` navigation grid divided into
  `32 × 32` chunks.
- Home island, harbour, exact return dock, Supported water and eight non-home
  islands are generated from a seed.
- Non-home islands have stable IDs and cover High Island, Low Cay, Atoll and
  Rocky Skerry kinds across small, medium and large sizes.
- Terrain owns movement and sight blocking. Rendering never defines gameplay
  collision.
- Placement preserves margins and navigation channels, keeps the eastbound
  dock corridor open, and validates access to all four world edges.

### Exploration knowledge

- Knowledge states are Unknown, Personal and Supported.
- Current sight shows terrain in full colour but does not change its movement
  cost.
- While sailing forward, visible water at and ahead of the ship remains
  Unknown. Broad strips around navigation tiles the ship has actually left
  become expedition-stamped Personal knowledge.
- Visible blocking landmarks are remembered immediately because they cannot
  discount a traversable route.
- Developer teleport converts the destination sight disc to
  expedition-stamped Personal knowledge without revealing a connecting line.
  Developer sight-radius tuning refreshes the disc with the same rule.
- Successful exact-dock return converts only the active expedition's Personal
  tiles to Supported. It also closes only configured-size, fully
  Supported-bounded Unknown pinholes.

### Provisions and voyage guidance

- Provisions are countable physical bundles with fractional distance use.
- Travel costs are configured independently for Supported, Personal and
  Unknown knowledge; defaults are `0`, `0.5` and `1` bundle-unit per tile.
- Remaining range uses `bundles - provisionAccumulator`.
- Forward guidance is a thin segmented contour at the true maximum reachable
  Unknown-cost band, clipped to the ship's heading cone.
- Return guidance is one minimum-provision-cost route to Supported water plus
  small passable padding. Yellow, orange and red appear only on that corridor.
- Knowledge-grey and risk overlays are suppressed inside current sight without
  changing the underlying knowledge or cost.

### Expedition inheritance

- An expedition begins when normal movement leaves Supported water.
- Supported water away from home does not finish an expedition or replenish
  provisions.
- Only the exact home dock commits an active expedition and replenishes the
  current ship. Docking without an active expedition also replenishes.
- Successful returns one through three keep the same navigator and generation.
  The fourth commits normally at the dock and then completes the navigator's
  tenure, immediately creating one successor.
- Exhausting provisions outside Supported water immediately reverts the failed
  expedition's Personal knowledge and creates a wreck that persists across
  reloads and later voyages until explicit world regeneration.
- Each navigator has a stable versioned ID and an `active`, `completed` or
  `lost` lifecycle record. Fatal wreck and completed-tenure transitions share
  one deterministic succession contract while remaining distinct reasons.
- Only a successful active-expedition return to the exact home dock completes
  one of the navigator's four numbered voyages. Idle time, travel time,
  distance, reload, replenishment and docking without an active expedition do
  not consume a voyage.
- The fourth successful return commits its knowledge and returned findings
  before
  completing the tenure and creating exactly one successor. There is no
  retirement decision, final fifth voyage or sailing lock.
- A wreck during any voyage kills the navigator early. The tribe's wait to
  determine that they will not return and its mourning are compressed into the
  wreck-to-successor transition: it is immediate in world progression for the
  player apart from the existing presentation hold, while narrative time has
  passed.
- The lost ship remains visible and uncontrollable for four seconds. The
  outgoing navigator is already recorded as lost during that hold; completion
  then respawns a supplied ship at the dock and creates exactly one successor.
  Reloading during the hold resumes the same persisted succession key.
- Every fourth-return or fatal-wreck succession presents the required focused
  handover mode of the shared Great Hall, derived from the committed outgoing
  navigator. Each safely returned
  voyage lists its Supported-route counts, named island leads and dossier
  findings, recorded fishing leads, returned fishing surveys and returned
  navigator-wreck identities. A
  safe voyage with no such result explicitly says that no new findings were
  returned. An early death lists those earlier committed voyages and the
  numbered voyage on which the navigator was lost at sea, without crediting any
  provisional result from the fatal expedition. Sailing remains suppressed
  until dismissal. The unacknowledged handover and its voyage records are
  authoritative, survive save/reload and reopen unchanged after refresh.
- Earlier Supported routes, returned island leads/dossiers and runtime wrecks
  survive a later failure.

### Island dossiers, survey sites, fishing signs and persistence

- Island-dossier content V1 derives exactly one immutable definition from each
  non-home island's stable numeric ID. It includes a deterministic unique name,
  exact generated footprint, every passable dock-reachable coastal approach
  within 1.5 tile widths, one canonical developer/presentation approach and one
  hidden descriptive result. Current themes are community, useful materials,
  anchorage, reef passage and weather watchpoint.
- Current sight during an active expedition creates one free provisional
  `sighted` record and reveals the island's name but not its hidden result. An
  unsurveyed exact-dock return commits one inherited `lead`. From any valid
  approach, the shared Survey-only transaction may spend provisions to create a
  provisional `surveyed` record, including when upgrading an earlier returned
  lead. Exact-dock return commits one returned `dossier`; wreck rollback removes
  only the failed expedition's provisional sighting or survey.
- A provisional or returned dossier reveals every fogged tile whose generated
  `islandId` exactly matches that island. It reveals no surrounding water or
  other island and does not mutate KnowledgeState, expedition stamps, Supported
  topology, route credit, travel cost or generated terrain. A failed provisional
  survey removes that reveal; a returned dossier keeps it permanently.
- The legacy `DiscoverySystem`, discovery save fragment and generated
  `HistoricWreck` / `FishingGround` island-discovery categories are removed.
  Runtime player wrecks remain a separate record and presentation.
- Survey-site content V1 derives exactly one directly sightable site of each
  initial type—historic wreck, coastal ruin and tidal cave—from the world seed.
  Every site has a stable typed ID, clue tile, passable dock-reachable service
  anchor, hidden deterministic result and developer placeholder presentation.
  Sites are independent of island dossiers: dossiers neither spawn nor unlock
  them, and historic sites cannot be mistaken for a navigator's runtime wreck.
- All three types use one descriptor-driven lifecycle. Current sight creates a
  free provisional `sighted` record; the shared two-bundle Survey transaction
  creates `surveyed`; exact-dock return commits either a `lead` or `report`; and
  wreck rollback removes only the active expedition's provisional site work.
  Adding another non-idol descriptor requires no new command, reducer or save
  fragment.
- A later generation first sights a runtime player wreck as unidentified.
  **Survey wreck** spends the displayed shared provision cost and gives the
  active expedition a provisional identity/fate report for the navigator lost
  there. Only exact-dock return permanently reports that association to the
  tribe and lineage. If the surveying navigator wrecks, the provisional report
  is discarded and the discovered wreck can be surveyed again. Revisit, repeat
  input, dock, wreck and current-version reload are idempotent.
- Four sparse fishing shoals are derived deterministically from the world seed
  in a separate content namespace. Current-sight clues create provisional
  sightings without revealing hidden quality or mutating terrain, islands,
  island-dossier identity or fog knowledge. An unsurveyed exact-dock return
  commits
  an inherited inactive lead; surveying that lead on a later expedition creates
  a provisional upgrade, and a wreck discards only the upgrade. Exact-dock
  return commits a terminal returned survey with stable quality. Returned
  surveys remain idempotent through revisit, repeat input, dock, wreck,
  autosave and checkpoint reload and are the sole later-activation eligible
  lifecycle state. Actual activation eligibility is derived only when the
  returned survey's exact service anchor has a cardinal, passable Supported
  connection to the exact home-return tile.
- A temporary non-modal proximity ribbon presents clue text, the provision
  cost, remaining usable supply and projected known-return margin. `F`, the
  Survey button and ordinary pointer/contextual-touch activation use the same
  authoritative command. Sailing remains live and leaving range defers for
  free. A successful survey spends provisions atomically, refreshes risk
  guidance immediately and remains provisional until dock; multiple surveys
  are allowed while supplies remain.
- Schema-versioned saves persist the authoritative ship, provisions,
  expedition/generation state, navigator lineage, completed-voyage counts and
  exact-dock-committed per-voyage achievement summaries, knowledge and stamps,
  runtime wrecks, pending wreck holds and unacknowledged generation handovers,
  provisional/returned wreck identity reports, provisional/returned
  island-dossier, survey-site and fishing records. Save schema V12 requires
  island-dossier content V1, survey-site content V1, exact lineage V6 with
  voyage records V3, generation-handover V1 and the current wreck shape;
  non-current records are deleted rather than migrated. Dossier/site
  definitions, placement/service data and hidden results regenerate from seed
  and stable identity and are not serialized.
  Fishing connectivity and its path are derived after load, never serialized.
- Base terrain and island descriptors regenerate from the saved seed and world
  configuration. Visibility, forward range and return paths rebuild on load.
- Reload uses a rolling IndexedDB autosave. **Save checkpoint** and
  **Load checkpoint** use a separate stable manual record. Loading a checkpoint
  restores the exact ship position, snaps the camera there and makes that state
  the new autosave baseline.
- Explicit world regeneration remains a deliberate fresh-world reset.
- Schema, generator, content and serialized-format versions are exact equality
  guards. Any malformed, older or newer autosave/checkpoint is deleted. A
  rejected autosave starts a fresh world; a rejected checkpoint becomes
  unavailable without replacing the running world. Development saves are never
  migrated or preserved across incompatible versions.

### Presentation and tools

- Current visuals are functional developer art.
- Island sightings announce the named provisional lead without revealing the
  dossier result. Developer markers distinguish sighted/returned leads from
  provisional/returned dossiers; surveying presents the deterministic finding.
- Survey sites use type-specific developer placeholder markers and clues while
  sharing the same Survey-only prompt. Their hidden result appears only after a
  successful survey and remains provisional until return.
- Exact-dock return with any notable committed finding (island lead or dossier,
  fishing report or wreck identity) coalesces achievements, route and replenishment
  information into one five-second cue. A return with route growth only uses
  a 3.5-second cue; lifecycle text never overlaps itself.
- A connected returned fishing survey shows an unmistakable double-diamond,
  cardinal-ray developer beacon and home-linked label. Disconnected returned
  surveys retain their ordinary returned mark.
- Voyage progress is presented as a bounded **Voyage n of 4** navigator cue.
  The obsolete retirement-choice ribbon and age HUD are absent.
- The permanent Great Hall is optionally opened only from the exact home dock
  through **Go ashore · Great Hall**. It browses active, completed and lost
  navigators, their exact-dock-committed journeys and derived lineage totals.
  Great Hall read model V3 derives distinct island-lead/dossier and survey-site
  lead/report achievement rows and totals from lineage V6 voyage records V3;
  it is rebuilt rather than saved.
  Returns one through three update it without forcing it open. The same
  navigator entry becomes the required, non-dismissible handover mode at
  succession. GR-3.4 may polish this presentation without changing the shared
  read model or authoritative voyage records.
- Discovered, unreported runtime wrecks use an unidentified marker and a
  contextual **Survey wreck** action. The aboard result names the lost
  navigator provisionally; exact-dock return makes the report permanent.
- Developer tools provide compact generation, navigator, voyage, lifecycle and
  wreck-report diagnostics; exact-dock return; next-island-dossier, fishing-sign
  and earlier-generation wreck inspection; dedicated moves to the historic-
  wreck, coastal-ruin and tidal-cave service anchors; water-tile teleport;
  provision/wreck
  controls; synchronized overlay toggles; session-only configuration; bounded
  event logging; autosave status and checkpoint controls. Lifecycle-mutating
  controls are disabled during wreck and generation-handover presentations,
  while persistence controls remain available for transition reload testing.
  The drawer is non-modal: sailing continues while it remains open, and a
  focused numeric tuning field keeps WASD live while reserving arrow keys for
  native number editing.
- Browser diagnostics are exposed through canvas data attributes and the
  developer automation API, including rolling frame percentiles, long-frame
  counts, dropped simulation time and save-serialization timing.

### Performance foundation

- Runtime modules now live under `src/wayfinders`; obsolete internal namespace
  and scene names are removed before subsequent gameplay and presentation
  expansion.
- The deterministic simulation remains at 30 updates per second while the ship
  and camera target interpolate at render rate.
- Save dirtiness is independent from presentation dirtiness. Canonical
  knowledge runs are cached by knowledge version, normal autosaves are spaced
  to three seconds, and lifecycle/checkpoint saves remain immediate.
- Forward and return calculations retain their world-sized buffers. Return
  roots use an incrementally maintained Supported/Personal boundary instead of
  scanning all Personal water.
- Knowledge, risk and persistent-marker presentation is viewport culled or
  version driven. Successful return repaints only knowledge-changed water
  chunks instead of rebuilding the complete static world.
- Supported connectivity caches one deterministic flood by a dedicated
  topology revision; Personal knowledge, visibility and ordinary frames do not
  rebuild it.
- Browser backdrop blurs were removed from always-on overlays to avoid
  recompositing the WebGL canvas.

## Architecture constraints that remain in force

1. The headless simulation owns authoritative gameplay state. Phaser presents
   it and forwards input; renderers do not mutate world rules.
2. The deterministic seed, generation configuration and stable island IDs are
   exact save-acceptance boundaries; incompatible changes bump a version and
   invalidate prior records.
3. Current sight is a visual reveal, not a knowledge-cost discount. Personal
   water is created behind actual travel to preserve full-cost outward and
   half-cost retrace behavior.
4. Exact-dock return is the only success/commit boundary.
5. A wreck resolves rollback immediately, presentation after four seconds, and
   generation advancement exactly once.
6. Base generated terrain is not serialized. Only authoritative mutable state
   belongs in saves; derived search and rendering data must rebuild.
7. Runtime player wrecks remain distinct from island dossiers and future
   generated historic-wreck sites.
8. Explicit regeneration resets the world; browser reload restores it.
9. Gameplay uses semantic terrain/content data. Production art must not become
   a second collision or navigation authority.
10. Normal sailing work stays local, sparse, cached or version driven.
    Generation may scale with world area because it is off the movement loop.
11. Production renderers must preserve viewport culling, incremental chunk
    invalidation and pooled/batched entity presentation.

## Known limits

- Gameplay track: `GP-3.1` has replaced the accepted historical `GP-1` survey
  case and **Leave** action with a shared configurable two-bundle provision
  cost. The prompt is Survey-only and non-modal, sailing away is free, multiple
  surveys are allowed while supplies remain, and fishing-ground and navigator-
  wreck results still commit only at the exact dock or roll back on wreck.
  Returned fishing knowledge and Great Hall records remain authoritative;
  numerical fishing output and tribe economics are outside GP-3.
- Gameplay track: navigator identity, succession and the four-voyage tenure
  are authoritative, and the permanent Great Hall chronicle is implemented.
  `GP-3.2` now gives each non-home island one free named lead and one
  provision-funded deterministic dossier with exact-island fog reveal. Accepted
  `GP-3.3` adds one independently generated historic-wreck, coastal-ruin and
  tidal-cave site through one extensible lifecycle. Runtime wreck identity/fate
  surveying and reporting are implemented; idols remain proposed GP-4 work.
- Gameplay track: autosave and a stable manual checkpoint exist, but a final
  player-facing saved-game model has not been chosen.
- `GP-3`: there are no fishing boats, trade vessels or
  Supported-route traffic.
- `GR-*`: production art, the asset resolver, asset tooling,
  environmental audio and production polish are not implemented.
- Default and doubled-world save/range probes pass the performance hardening
  baseline. Touch-first sailing is not implemented, and representative
  mid-range mobile rendering/performance validation remains outstanding.

## Active checkpoint

`GP-3.3` is accepted. `GP-4.1`, the deterministic idol catalog, is the next
proposed gameplay milestone and awaits authorization.

The completed milestones are:

1. `GP-0.1` — accepted: exact-version validation, incompatible-record deletion
   and current-version round trips;
2. `GP-0.2` — accepted: versioned GP-1 integration boundaries;
3. `GP-1.1` — accepted: deterministic fishing-shoal definitions and clues;
4. `GP-1.2` — accepted historical baseline: the one-case Survey / Leave action
   and interaction cue, explicitly superseded by accepted `GP-3.1`;
5. `GP-1.3` — accepted: exact-dock returned leads/surveys and wreck rollback;
6. `GP-1.4` — accepted: derived Supported-water home-connection proof and cue;
7. `GP-2.1` — accepted: stable navigator identity and idempotent succession;
8. `GP-2.2` — accepted: four exact-return voyages, automatic tenure
   succession, fatal-wreck early succession, per-safe-voyage committed
   achievement summaries and exact-dock-committed runtime-wreck identity/fate
   reports;
9. `GP-2.3` — accepted: one shared Great Hall chronicle read model, required
   focused succession handover, optional exact-home-dock browsing, active /
   completed / lost navigator history, derived lineage totals and returned
   wreck-fate confirmation.
10. `GP-3.1` — accepted: a shared provision-funded Survey-only transaction,
    multiple surveys per journey, projected return impact, exact-dock commit,
    wreck rollback and no separate survey allocation.
11. `GP-3.2` — accepted: one deterministic dossier per non-home island, free
    provisional/returned leads, provision-funded coastal surveying,
    exact-island-ID fog reveal, exact-dock commit/wreck rollback, lineage V5 and
    Great Hall V2 island achievement credit, and exact save schema V11.
12. `GP-3.3` — accepted: exactly one seed-derived historic wreck, coastal ruin
    and tidal cave; one descriptor-extensible lead/report lifecycle; shared
    provision-funded surveying; exact-dock commit/wreck rollback; lineage V6
    voyage records V3; Great Hall V3 credit; save schema V12/content V1;
    developer placeholder art and per-type service-anchor debug controls.

The next proposed gameplay milestone is `GP-4.1`, the finite deterministic idol
catalog and clue layer. No GP-4 implementation is authorized yet.

The `GR-1` graphics start gate is now open because GP-3.3 accepted stable island
and generic survey-site identities/read models, but no graphics milestone is
authorized. Fishing, trade and other routine world-activity vessels remain
presentation work rather than authoritative economy state.

See `Wayfinders_Technical_Design.md` for the current implementation model,
`Wayfinders_Roadmap.md` for proposed scope and sequencing,
`Wayfinders_Economy_Design.md` for gameplay direction, and
`Wayfinders_Asset_Pipeline.md` for the deferred graphics direction.
