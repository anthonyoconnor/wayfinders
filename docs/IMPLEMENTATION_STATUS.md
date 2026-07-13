# Wayfinders implementation status

This is the starting point for a new development session.

## Accepted baseline

The current implementation is the accepted starting point. It includes
developer tooling, home waters, exploration knowledge, provision-aware risk
and return, expedition inheritance, deterministic discoveries, cross-session
persistence and the performance foundation.

Do not reimplement the baseline or restore the obsolete source namespace.
Future work is organized into `GP-*` gameplay and `GR-*` graphics tracks in
`Wayfinders_Roadmap.md`. The authorized `GP-0.1` through `GP-2.1` work is
complete and accepted. The active authorization continues without pauses
through `GP-2.2`, `GP-2.3` and `GP-3.1`.

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
- 182 automated tests pass across 20 files.
- The production Vite build passes.
- Browser tests cover discovery and fishing return, returned-lead upgrade,
  autosave reload, manual checkpoint restore, exact ship/camera restoration,
  the home-linked fishing-ground cue, wreck-hold reload, generation
  advancement, save clearing, and a clean console.
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
- Successful return keeps the same generation.
- Exhausting provisions outside Supported water immediately reverts the failed
  expedition's Personal knowledge and creates a wreck that persists across
  reloads and later voyages until explicit world regeneration.
- Each navigator has a stable versioned ID and an `active`, `retired` or `lost`
  lifecycle record. Wreck and retirement share one deterministic succession
  contract while remaining distinct reasons.
- The lost ship remains visible and uncontrollable for four seconds. The
  outgoing navigator is already recorded as lost during that hold; completion
  then respawns a supplied ship at the dock and creates exactly one successor.
  Reloading during the hold resumes the same persisted succession key.
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
  expedition/generation state, knowledge and stamps, runtime wrecks, pending
  wreck holds, provisional/returned discoveries and provisional/returned
  fishing records. Fishing connectivity and its path are derived after load,
  never serialized.
- Base terrain and island descriptors regenerate from the saved seed and world
  configuration. Visibility, forward range and return paths rebuild on load.
- Reload uses a rolling IndexedDB autosave. **Save checkpoint** and
  **Load checkpoint** use a separate stable manual record. Loading a checkpoint
  restores the exact ship position, snaps the camera there and makes that state
  the new autosave baseline.
- Explicit world regeneration remains a deliberate fresh-world reset.
- Invalid current-schema autosaves recover to a fresh world. Unsupported newer
  schemas are preserved with autosave disabled rather than overwritten.

### Presentation and tools

- Current visuals are functional developer art.
- Discovery sightings remain on screen for five seconds.
- Exact-dock return with discoveries coalesces discovery, route and
  replenishment information into one five-second cue. A return without a
  discovery uses a 3.5-second route/replenishment cue; lifecycle text never
  overlaps itself.
- A connected returned fishing survey shows an unmistakable double-diamond,
  cardinal-ray developer beacon and home-linked label. Disconnected returned
  surveys retain their ordinary returned mark.
- Developer tools provide seed regeneration, island inspection, water-tile
  teleport, provision/wreck controls, overlay toggles, live configuration,
  autosave status and checkpoint controls.
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
   save compatibility boundaries.
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

- Gameplay track: discovery rewards, settlements and resources are records
  only. The complete `GP-1` fishing survey loop ends at a derived connected
  returned-ground cue; authoritative fishing activation/output, tribe
  economics, explorer aging, lineage achievements and idols are not yet
  implemented.
- Gameplay track: navigator identity and succession are authoritative, but
  voyage-based aging, safe retirement and lineage achievements remain in the
  active GP-2.2/GP-2.3 batch.
- Gameplay track: autosave and a stable manual checkpoint exist, but a final
  player-facing saved-game model has not been chosen.
- `GP-3`: there are no fishing boats, trade vessels or
  Supported-route traffic.
- `GR-*`: production art, the asset resolver, asset tooling,
  environmental audio and production polish are not implemented.
- Default and doubled-world save/range probes pass the performance hardening
  baseline. Touch-first sailing is not implemented, and representative
  mid-range mobile rendering/performance validation remains outstanding.

## Authorized continuation

`GP-2.1` is accepted. The current user-authorized batch continues directly
through `GP-2.2`, `GP-2.3` and `GP-3.1`; there is no permission pause between
those milestones.

The completed batch is:

1. `GP-0.1` — accepted: baseline-save fixtures and an explicit migration chain;
2. `GP-0.2` — accepted: versioned GP-1 integration boundaries;
3. `GP-1.1` — accepted: deterministic fishing-shoal definitions and clues;
4. `GP-1.2` — accepted: the one-case Survey / Leave action and interaction cue;
5. `GP-1.3` — accepted: exact-dock returned leads/surveys and wreck rollback;
6. `GP-1.4` — accepted: derived Supported-water home-connection proof and cue.
7. `GP-2.1` — accepted: stable navigator identity and idempotent succession.

The next in-progress gameplay milestone is `GP-2.2`, voyage-event aging and
safe retirement, followed by `GP-2.3` and `GP-3.1` under the same authorization.

The first product acceptance target is the complete `GP-1` survey loop. The
graphics track remains deferred until `GP-3.2` is accepted, proving the
survey-to-active-fishing and visible tribe-benefit loop with developer
graphics, unless that gate is explicitly reapproved.

See `Wayfinders_Technical_Design.md` for the current implementation model,
`Wayfinders_Roadmap.md` for proposed scope and sequencing,
`Wayfinders_Economy_Design.md` for gameplay direction, and
`Wayfinders_Asset_Pipeline.md` for the deferred graphics direction.
