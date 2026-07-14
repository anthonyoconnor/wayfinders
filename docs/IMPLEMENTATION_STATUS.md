# Wayfinders implementation status

This is the starting point for a new development session.

## Accepted baseline

The current implementation is the accepted starting point. It includes
developer tooling, home waters, exploration knowledge, provision-aware risk
and return, expedition inheritance, deterministic discoveries, cross-session
persistence, versioned navigator succession, four-voyage navigator tenures
with exact-dock-committed achievements in a permanent Great Hall chronicle,
the shared required generation-handover view, returned identity/fate reports
for runtime navigator wrecks and the performance foundation.

Do not reimplement the baseline or restore the obsolete source namespace.
Future work is organized into `GP-*` gameplay and `GR-*` graphics tracks in
`Wayfinders_Roadmap.md`. The authorized `GP-0.1` through `GP-2.3` work is
complete and accepted. Implementation is paused before `GP-3.1`, which is not
currently authorized.

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
- 220 automated tests pass across 24 files.
- The production Vite build passes.
- Existing browser acceptance covers discovery and fishing return,
  returned-lead upgrade,
  autosave reload, manual checkpoint restore, exact ship/camera restoration,
  the home-linked fishing-ground cue, wreck-hold reload, generation
  advancement, save clearing, four-voyage automatic succession,
  runtime-wreck survey/reporting and a clean warning/error console. The shared
  Great Hall model and exact-dock access policy are automated; an interactive
  pass over its focused handover and optional browsing modes remains
  outstanding.
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
- The fourth successful return commits its knowledge and discoveries before
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
  voyage lists its Supported-route counts, named discoveries, recorded fishing
  leads, returned fishing surveys and returned navigator-wreck identities. A
  safe voyage with no such result explicitly says that no new findings were
  returned. An early death lists those earlier committed voyages and the
  numbered voyage on which the navigator was lost at sea, without crediting any
  provisional result from the fatal expedition. Sailing remains suppressed
  until dismissal. The unacknowledged handover and its voyage records are
  authoritative, survive save/reload and reopen unchanged after refresh.
- Earlier Supported routes, returned discoveries and runtime wrecks survive a
  later failure.

### Discoveries, fishing signs and persistence

- Every non-home island has deterministic discovery content keyed by its
  stable island ID: a name, type, descriptive reward and optional
  settlement/resource data.
- A discovery is created only from current sight during an active expedition.
  It is provisional until exact-dock return and is lost with a failed
  expedition.
- Runtime player wrecks and generated historic-wreck discoveries are separate
  record types and presentations.
- A later generation first sights a runtime player wreck as unidentified.
  **Survey wreck** spends the existing one-per-voyage survey case and gives the
  active expedition a provisional identity/fate report for the navigator lost
  there. Only exact-dock return permanently reports that association to the
  tribe and lineage. If the surveying navigator wrecks, the provisional report
  is discarded and the discovered wreck can be surveyed again. Revisit, repeat
  input, dock, wreck and current-version reload are idempotent.
- Four sparse fishing shoals are derived deterministically from the world seed
  in a separate content namespace. Current-sight clues create provisional
  sightings without revealing hidden quality or mutating terrain, islands,
  discovery identity or fog knowledge. An unsurveyed exact-dock return commits
  an inherited inactive lead; surveying that lead on a later expedition creates
  a provisional upgrade, and a wreck discards only the upgrade. Exact-dock
  return commits a terminal returned survey with stable quality. Returned
  surveys remain idempotent through revisit, repeat input, dock, wreck,
  autosave and checkpoint reload and are the sole later-activation eligible
  lifecycle state. Actual activation eligibility is derived only when the
  returned survey's exact service anchor has a cardinal, passable Supported
  connection to the exact home-return tile.
- A temporary proximity ribbon presents clue text, the current one-case
  allocation and explicit Survey / Leave buttons. `F` surveys, `Escape` leaves,
  and ordinary pointer/contextual-touch activation uses the same authoritative
  commands. Surveying reveals deterministic quality, spends the case, survives
  reload and intentionally replenishes only on the next dock or respawn
  allocation; unused cases never stack.
- Schema-versioned saves persist the authoritative ship, provisions,
  expedition/generation state, navigator lineage, completed-voyage counts and
  exact-dock-committed per-voyage achievement summaries, knowledge and stamps,
  runtime wrecks, pending wreck holds and unacknowledged generation handovers,
  provisional/returned wreck identity reports, provisional/returned
  discoveries and provisional/returned fishing records. Save schema V9
  requires the exact current V4 lineage, generation-handover V1 contract and
  current wreck shape; non-current records are not migrated.
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
- Discovery sightings remain on screen for five seconds.
- Exact-dock return with any notable committed finding (discovery, fishing
  report or wreck identity) coalesces achievements, route and replenishment
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
  Returns one through three update it without forcing it open. The same
  navigator entry becomes the required, non-dismissible handover mode at
  succession. GR-3.4 may polish this presentation without changing the shared
  read model or authoritative voyage records.
- Discovered, unreported runtime wrecks use an unidentified marker and a
  contextual **Survey wreck / Leave** action. The aboard result names the lost
  navigator provisionally; exact-dock return makes the report permanent.
- Developer tools provide compact generation, navigator, voyage, lifecycle and
  wreck-report diagnostics; exact-dock return; island, fishing-sign and
  earlier-generation wreck inspection; water-tile teleport; provision/wreck
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
7. Runtime player wrecks remain distinct from generated discovery content.
8. Explicit regeneration resets the world; browser reload restores it.
9. Gameplay uses semantic terrain/content data. Production art must not become
   a second collision or navigation authority.
10. Normal sailing work stays local, sparse, cached or version driven.
    Generation may scale with world area because it is off the movement loop.
11. Production renderers must preserve viewport culling, incremental chunk
    invalidation and pooled/batched entity presentation.

## Known limits

- Gameplay track: the accepted `GP-1` fishing loop still uses one separate
  survey case and an explicit **Leave** action. Proposed `GP-3.1` replaces that
  interaction with provision-funded, sail-away-to-defer surveying; it is not
  implemented yet. Returned fishing knowledge and the Great Hall records remain
  authoritative, while numerical fishing output and tribe economics are no
  longer part of the approved GP-3 direction.
- Gameplay track: navigator identity, succession and the four-voyage tenure
  are authoritative, and the permanent Great Hall chronicle is implemented.
  Island sightings currently reveal their complete generated discovery without
  a paid dossier survey, and there is no general survey-site catalog. Proposed
  `GP-3.2` folds the one-per-island discovery into its single dossier and
  retires the legacy island `HistoricWreck` / `FishingGround` target categories
  before `GP-3.3` adds non-duplicating sites. Runtime wreck identity/fate
  surveying and reporting are implemented; physical idol recovery and its
  minimal aboard/loss contract remain `GP-4.2` work.
- Gameplay track: autosave and a stable manual checkpoint exist, but a final
  player-facing saved-game model has not been chosen.
- `GP-3`: there are no fishing boats, trade vessels or
  Supported-route traffic.
- `GR-*`: production art, the asset resolver, asset tooling,
  environmental audio and production polish are not implemented.
- Default and doubled-world save/range probes pass the performance hardening
  baseline. Touch-first sailing is not implemented, and representative
  mid-range mobile rendering/performance validation remains outstanding.

## Paused checkpoint

`GP-2.3` is accepted. Implementation is paused before `GP-3.1`, which has no
active authorization.

The completed milestones are:

1. `GP-0.1` — accepted: exact-version validation, incompatible-record deletion
   and current-version round trips;
2. `GP-0.2` — accepted: versioned GP-1 integration boundaries;
3. `GP-1.1` — accepted: deterministic fishing-shoal definitions and clues;
4. `GP-1.2` — accepted historical baseline: the one-case Survey / Leave action
   and interaction cue, explicitly superseded by proposed `GP-3.1`;
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

The next proposed gameplay milestone is `GP-3.1`, provision-funded surveying.
It removes the separate survey case and **Leave** command, makes sighting and
sailing away free, and charges the shared provision supply only when a survey
is performed. It requires renewed authorization and remains untouched.

The graphics track remains deferred until `GP-3.3` accepts stable island and
generic survey-site identities/read models. Fishing, trade and other routine
world-activity vessels are presentation work rather than GP-3 authoritative
economy state, unless that gate is explicitly reapproved.

See `Wayfinders_Technical_Design.md` for the current implementation model,
`Wayfinders_Roadmap.md` for proposed scope and sequencing,
`Wayfinders_Economy_Design.md` for gameplay direction, and
`Wayfinders_Asset_Pipeline.md` for the deferred graphics direction.
