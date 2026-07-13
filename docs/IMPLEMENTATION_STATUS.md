# Wayfinders implementation status

This is the starting point for a new development session.

## Continuation point

Milestones 0 through 4 are complete. The current foundation includes
developer tooling, home waters, exploration knowledge, provision-aware risk
and return, expedition inheritance, deterministic discoveries, and
cross-session persistence.

The Milestone 4 baseline is commit `60e8892`. Do not reimplement completed
milestones. The next product scope is Milestone 5: production asset integration
and a living world on Supported routes.

## Run and verify

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/` in a WebGL-capable browser.

Run the complete automated pipeline with:

```powershell
npm.cmd run check
```

Current verification baseline:

- TypeScript typecheck passes.
- 119 automated tests pass across 13 files.
- The production Vite build passes.
- Browser tests cover discovery return, autosave reload, manual checkpoint
  restore, exact ship/camera restoration, wreck-hold reload, generation
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
- The lost ship remains visible and uncontrollable for four seconds. Completion
  then respawns a supplied ship at the dock and advances the generation once.
- Earlier Supported routes, returned discoveries and runtime wrecks survive a
  later failure.

### Discoveries and persistence

- Every non-home island has deterministic discovery content keyed by its
  stable island ID: a name, type, descriptive reward and optional
  settlement/resource data.
- A discovery is created only from current sight during an active expedition.
  It is provisional until exact-dock return and is lost with a failed
  expedition.
- Runtime player wrecks and generated historic-wreck discoveries are separate
  record types and presentations.
- Schema-versioned saves persist the authoritative ship, provisions,
  expedition/generation state, knowledge and stamps, runtime wrecks, pending
  wreck holds, and provisional/returned discoveries.
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
- Developer tools provide seed regeneration, island inspection, water-tile
  teleport, provision/wreck controls, overlay toggles, live configuration,
  autosave status and checkpoint controls.
- Browser diagnostics are exposed through canvas data attributes and the
  developer automation API.

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
10. Normal sailing work stays local or sparse. Generation may scale with world
    area because it is off the movement loop.

## Known limits

- Production art and the asset resolver are not implemented.
- Discovery rewards, settlements and resources are records only; they do not
  yet drive an economy or simulation.
- There are no fishing boats, trade vessels or Supported-route traffic.
- Environmental audio and production polish are not implemented.
- Desktop performance is verified at the default and doubled world sizes;
  mid-range mobile-device validation remains outstanding.

## Next actions — Milestone 5

1. Define the first production asset contracts and semantic IDs for the player
   ship, home waters and one representative island set.
2. Add an asset resolver without changing gameplay terrain, navigation,
   discoveries or save identity.
3. Replace developer visuals incrementally and review them in the running game.
4. Add fishing boats, trade vessels and simple traffic restricted to Supported
   routes.
5. Add environmental polish and validate performance on representative mobile
   hardware.

See `Wayfinders_Technical_Design.md` for the current implementation model,
`Wayfinders_Prototype_Milestones.md` for scope, and
`Wayfinders_Asset_Pipeline.md` for the Milestone 5 asset direction.
