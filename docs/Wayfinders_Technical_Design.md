# Wayfinders technical design

This document describes the accepted implementation baseline. The roadmap
contains proposed future sequencing; this document contains current runtime
behavior and constraints.

## 1. Design goals

Wayfinders is a browser exploration prototype about leaving safe water,
building knowledge through travel, deciding when to return, and passing a
stronger chart to later voyages and generations.

The implementation follows these rules:

1. Gameplay state is authoritative outside Phaser presentation objects.
2. World generation, navigation and knowledge behavior are deterministic and
   testable without a browser; persistence is schema-versioned and validated.
3. Current sight may reveal visuals without discounting the cost of Unknown
   travel.
4. Only exact-dock return commits an expedition.
5. Rendering never becomes a second gameplay-data source.
6. Saves contain authoritative mutable state, not derived search/render data.
7. Normal sailing work remains local, sparse or cached.

## 2. Runtime architecture

The application lives under `src/wayfinders` and is split into these domains:

```text
config/       live prototype configuration and validation
core/         simulation owner, lifecycle events and fixed-step clock
world/        chunked grid, tile data and deterministic generation
navigation/   continuous ship movement and grid traversal
exploration/  sight, knowledge, provisions, risk paths and discoveries
persistence/  save schema validation and IndexedDB storage
rendering/    Phaser world, ship, fog, overlays, markers and developer UI
```

`GameSimulation` owns the generated world, ship, expedition lifecycle,
knowledge, provisions, wrecks, discoveries and derived risk results. It has no
Phaser dependency.

The Phaser scene adapter:

- converts keyboard movement and optional developer pointer commands into
  simulation operations;
- advances the fixed-step clock;
- synchronizes renderers from simulation state;
- owns camera behavior and screen-space UI;
- connects browser persistence and developer controls;
- never writes gameplay arrays directly.

The obsolete source namespace and scene identity have been removed. All new
roadmap modules must use the Wayfinders namespace.

A typed event bus communicates lifecycle changes to presentation and
persistence adapters.

## 3. Configuration and timing

One validated configuration object contains world, navigation, island,
provision, risk, overlay, movement and simulation values. Developer controls
may change supported live-tuning values; invalid complete configurations are
rejected before mutation.

Important defaults:

- world: `96 × 96` navigation tiles;
- chunk: `32 × 32` navigation tiles;
- navigation tile: `32` world pixels;
- current-sight radius: `5` tiles;
- starting provisions: `12` bundles;
- fixed simulation rate: `30` updates per second;
- wreck presentation: `4` simulation seconds;
- non-home islands: `8`.

The clock caps unusually large frame deltas. When a wreck hold completes it
drops buffered fixed substeps so held input cannot move the newly spawned ship
on the same frame.

## 4. Coordinates and world data

### Navigation coordinates

Integer `(tileX, tileY)` coordinates drive knowledge, terrain, cost and
pathfinding.

### World coordinates

Continuous pixel coordinates drive ship motion and rendering. The centre of a
navigation tile is:

```text
worldX = tileX × tileSize + tileSize / 2
worldY = tileY × tileSize + tileSize / 2
```

### Chunk storage

`WorldGrid` owns `WorldChunk` instances. Each chunk uses typed arrays for:

- terrain;
- knowledge;
- current visibility;
- movement blocking;
- sight blocking;
- expedition stamps;
- island IDs;
- resource IDs.

The bounded prototype world is generated eagerly and its chunks remain loaded.
Static render objects are camera culled; mutable overlay textures update only
for dirty chunks and affected neighbors.

Maintained sets, counters and the sparse Supported/Personal boundary provide
Personal, Supported, visible and return-root indices without scanning the full
world during normal updates.

## 5. Deterministic world generation

The seed and generation-affecting configuration produce:

- home island and harbour;
- exact return dock;
- noisy Supported-water boundary;
- deterministic base terrain;
- eight non-home island descriptors and painted terrain;
- a clear dock departure corridor;
- passable open ocean connected to all four world edges.

Non-home island descriptors have stable numeric IDs plus kind, size, centre,
radii, rotation, shape seed and bounds. Placement, profile, shape, terrain and
discovery content use separate deterministic namespaces so changing names or
visual content cannot move an island.

The implemented island kinds are High Island, Low Cay, Atoll and Rocky Skerry.
Atolls receive a deterministic navigable passage. Placement enforces margins,
home clearance and minimum channels before the open-ocean flood validation.

Base island descriptors contain geometry and terrain identity only. Mutable
discovery state is stored separately and references the stable island ID.

## 6. Movement and collision

The ship has continuous world position, heading and speed plus its current
navigation tile.

WASD and arrow keys provide turning and forward/reverse thrust. Movement traces
every navigation tile crossed by the continuous line segment, stops before the
first blocked tile and emits entered-tile information in order.

Terrain is authoritative:

- deep and shallow ocean are passable;
- reef, rock and land are blocked;
- rock and land block sight;
- render layers are never sampled for collision.

Provision charging is prepared from the movement segments before visibility
or knowledge updates. Entering water that was Unknown at the start of the
segment therefore pays Unknown cost even if the movement reveals it.

## 7. Visibility and knowledge

### Current sight

Visibility uses a Euclidean-radius disc and line traversal against sight
blockers. A blocking tile remains visible; tiles behind it do not.

For a movement update, visibility is evaluated at every crossed navigation
centre. The final centre becomes `visibleNow`; the union of crossed-centre
observations is available for trail creation. This prevents holes during fast
or diagonal travel.

### Implemented knowledge rule

Normal sailing does **not** convert every currently visible Unknown water tile
to Personal immediately.

- Passable water at and ahead of the current ship position remains Unknown.
- When the ship leaves a navigation centre, a broad perpendicular strip around
  that departed centre becomes expedition-stamped Personal knowledge.
- Visible blocked landmarks may become Personal immediately because they are
  not traversable and cannot discount an outward route.
- Existing Personal and Supported knowledge never downgrade through sight.

This produces the intended asymmetry: outward travel through current sight
costs the full Unknown rate, while the route behind the ship can be retraced at
the lower Personal rate.

Developer teleport is intentionally different: it converts Unknown tiles in
the complete destination sight disc to expedition-stamped Personal knowledge
for inspection, but never reveals a connecting line between origin and
destination. Developer sight-radius tuning refreshes the current disc with the
same full-disc knowledge rule.

### Visual treatment

- Unknown outside current sight is near-black and hides terrain/content.
- Personal outside current sight is grey remembered water.
- Supported is full colour.
- Anything in current sight uses full world colour regardless of its underlying
  knowledge state.

Rendering a tile in full colour inside current sight does not itself change its
knowledge or travel cost. Sight still drives discovery and wreck detection and
the documented blocked-landmark and developer-tool knowledge rules. Movement
cost and return calculations always use the authoritative Unknown, Personal or
Supported value.

## 8. Provisions

The ship stores an integer number of physical bundles and a fractional travel
accumulator.

Default cost per navigation tile:

```text
Supported = 0
Personal  = 0.5
Unknown   = 1
```

Available provision units are:

```text
budget = ship.provisions - ship.provisionAccumulator
```

The accumulator represents the already-used fraction of the next physical
bundle. It is cleared when the ship replenishes.

The visible cargo rack represents whole bundles. Numerical values remain in
developer diagnostics rather than normal player UI.

## 9. Forward and return guidance

### Forward reach

`ForwardRangeSystem` runs a cost-limited Dijkstra search from the ship with the
current provision budget. Still-Unknown blockers are treated as Unknown water
for prediction so hidden terrain cannot be inferred from the overlay.

The full logical result is cached. Presentation includes only reachable
Unknown cells in the outermost Unknown-cost band:

```text
budget - unknownCost < minimumCost <= budget
```

That terminal band is clipped to a heading-centred cone. Turning reclips the
cached candidates without rerunning the logical search. Rendering draws only
segmented outward contour edges; tile interiors and artificial cone-end walls
remain transparent.

### Return route

`ReturnPathSystem` finds one minimum-provision-cost route from the ship to the
first reachable Supported tile. The connection may cross passable Unknown
water only while it is in current sight, then follows known Personal water.

`ReturnPathSystem` adds configurable cardinal passable padding around that
route without crossing unseen Unknown, blocked or Supported tiles. The
renderer draws the resulting corridor and does not colour unrelated Personal
branches.

One risk level applies to the whole corridor according to remaining margin:

- comfortable/clear: pale or stronger yellow;
- critical: orange;
- selected known route exceeds available provisions: red crosshatch.

When no known route exists, there is no corridor to draw.

All risk and Personal-grey presentation is suppressed inside current sight.

## 10. Expedition lifecycle

An expedition starts when normal movement crosses from Supported into
non-Supported water. It remains active if the ship later reaches Supported
water away from home.

### Successful return

Only the generated home return dock resolves success:

1. Teleport the ship to the exact dock centre.
2. Commit Personal tiles carrying the active expedition stamp to Supported.
3. Run one bounded knowledge-only cleanup for tiny enclosed Unknown pockets.
4. Commit provisional discoveries owned by that expedition.
5. Replenish provisions and clear fractional use.
6. Advance the expedition ID while keeping the same generation.

Docking without an active expedition replenishes supplies but does not change
generation or return counts.

### Failure and wreck

Natural exhaustion outside Supported water and the developer force-wreck tool
use the same failure path:

1. Record a runtime wreck at the exact ship position and heading.
2. Revert the active expedition's Personal tiles to Unknown.
3. Remove that expedition's provisional discoveries.
4. Freeze the empty ship at the loss site for four simulation seconds.
5. Clear loss-site visibility at completion.
6. Spawn a supplied ship at the home dock.
7. Advance expedition ID and generation exactly once.

Timer overshoot is discarded. Successful return on a final-bundle docking step
takes precedence over wreck creation.

Runtime wrecks remain hidden by fog after respawn until a later generation sees
them. Their `discovered` state then persists independently of knowledge loss.

## 11. Discoveries

`DiscoverySystem` derives one content definition for every non-home island from
the seed and stable island ID. Definitions include:

- numeric discovery and island identity;
- type;
- generated name;
- reward ID, label and description;
- optional settlement or resource metadata.

Detection reads only the final current-sight set during an active expedition.
Crossed-but-no-longer-visible observations cannot create a discovery.

Records are expedition-owned and provisional until exact-dock return. A wreck
deletes only the failed expedition's provisional records. Returned records
remain through later voyages and generations.

Generated historic-wreck discoveries are content records. They are never added
to the runtime player-wreck collection and use a distinct marker.

Current discovery rewards are descriptive records only. Economy, settlement,
survey and activation effects are absent from the baseline and require an
approved gameplay minor plus save migration.

## 12. Persistence

### Save boundary

Schema version 1 stores:

- save and world-generator versions;
- seed and generation-affecting configuration;
- ship position, heading, provisions and accumulator;
- expedition ID, active state, generation and counters;
- optional pending wreck hold;
- all non-Unknown knowledge as canonical run-length encoded state/stamp runs;
- runtime wrecks and discovered flags;
- provisional and returned discovery records;
- an empty reserved terrain-patch list.

The save does not contain base terrain, generated island descriptors,
visibility, range masks, return paths, renderer state or caches.

Restore validates structure before mutating the running simulation, regenerates
the deterministic base world, applies authoritative mutable state, rebuilds
knowledge indices, recalculates visibility and paths, and restores the exact
ship position.

### Browser storage

IndexedDB contains two atomic records:

- `autosave`: rolling reload state;
- `checkpoint`: stable manual state written only by **Save checkpoint**.

Autosave uses a dedicated authoritative `saveRevision`, is normally spaced to
three seconds during continuous play, requested immediately at lifecycle
boundaries, and flushed best-effort when the page hides. Knowledge runs are
cached by world identity and knowledge version, so ship-only saves do not scan
the world. Startup
hydrates autosave before Phaser starts, avoiding a default-world flash or
accidental overwrite.

**Load checkpoint** waits for an in-flight autosave, restores the checkpoint,
snaps the smoothed camera to the restored ship and writes that state as the new
autosave baseline. **Clear saves** removes both records without mutating the
currently running simulation.

Malformed current-schema autosaves are cleared and recover to a fresh world.
Unsupported newer schema/generator versions are preserved with autosave
disabled. Unexpected load failures also preserve stored data. Storage failure
does not prevent unsaved play.

Explicit seed regeneration is not load; it intentionally resets runtime
inheritance and writes a new autosave after state changes.

## 13. Rendering

The game uses WebGL through Phaser.

- Static ocean and terrain use generated Phaser Graphics grouped into
  camera-culled world chunks.
- Knowledge and risk overlays use reusable, viewport-culled chunk-sized
  CanvasTextures.
- Knowledge, visibility and sparse risk candidate changes invalidate only
  affected chunks and required neighbors.
- Successful return redraws only water/wave layers in knowledge-changed chunks;
  it does not destroy and rebuild the static world.
- No texture is allocated per simulation frame.
- The ship is interpolated between deterministic fixed steps. Runtime wrecks
  and discoveries are separate, viewport-culled, version-driven renderers above
  world and fog layers.
- The cargo rack and lifecycle cues are screen-space presentation.

Discovery-sighted messages remain for five seconds. Exact-dock return with one
or more committed discoveries combines discovery commitment, Supported-route
growth and replenishment into one five-second message. A return without a
discovery uses a 3.5-second route/replenishment cue. Only one lifecycle cue may
exist at a time.

The camera follows the interpolated ship smoothly during play. World regeneration and
checkpoint restore are discontinuities, so the camera snaps to the
authoritative ship before smoothing resumes.

Current developer art communicates terrain and mechanics only and remains
intentional throughout gameplay validation. Future production assets must
retain the same navigation, identity and depth contracts.

## 14. Events and developer interfaces

Implemented simulation events:

```text
shipEnteredTile
shipTeleported
knowledgeChanged
provisionConsumed
provisionsChanged
shipReplenished
returnStateChanged
expeditionStarted
expeditionReturned
shipWrecked
generationAdvanced
wreckDiscovered
expeditionFailed
discoveryFound
discoveriesReturned
discoveriesLost
worldRegenerated
gameLoaded
```

Developer UI capabilities:

- regenerate from a seed;
- inspect generated islands in stable ID order;
- teleport by water-tile coordinate or click;
- add/remove bundles and force a wreck;
- save/load a manual checkpoint and clear browser saves;
- toggle navigation grid, current sight, forward reach and return viability;
- tune supported live configuration values.

The browser automation interface exposes snapshot, teleport, provision,
wreck, regeneration, overlay, checkpoint and performance operations. Canvas
data attributes provide stable diagnostic values for browser checks, including
frame percentiles, long frames, deliberately dropped simulation time and save
serialization duration.

## 15. Performance constraints

Targets remain 60 rendered frames per second and 30 fixed simulation updates
per second on intended hardware.

The current implementation avoids full-world work during normal sailing:

- visibility clears only the previous visible set;
- knowledge state uses maintained sparse sets and counts;
- return roots use an incrementally maintained sparse boundary;
- expedition commit/revert touches only owned indices;
- Dijkstra systems reuse typed buffers, result masks and numeric heaps;
- provision-only changes reclassify cached results where possible;
- unchanged knowledge reuses cached canonical save runs;
- return rendering processes one sparse route/corridor;
- overlay uploads are dirty-chunk local;
- static and overlay render chunks are camera culled;
- discovery/wreck reconciliation is version driven;
- diagnostics are capped rather than updated on every fixed step.

World generation, placement and open-ocean validation scale with world area but
run only at generation/restore time. Desktop probes at doubled world dimensions
remain within the fixed-update budget. Representative mid-range mobile testing
is still required; no Web Worker is justified without new profiling evidence.

## 16. Testing and platform state

The automated suite covers configuration, deterministic generation, movement,
visibility, knowledge asymmetry, provisions, forward/return calculations,
overlay invalidation, island navigation, expedition success/failure, Unknown
pocket cleanup, discoveries, save validation, persistence round trips, save
dirtiness, cached encoding, frame telemetry and ship interpolation.

Browser verification covers WebGL startup, controls, discovery cues, combined
return presentation, rolling reload, stable manual checkpoints, exact
ship/camera restoration, pending wreck reload, save clearing and console health.

Desktop keyboard/pointer play is the validated target. Responsive resize is
implemented. Touch-first sailing is not implemented and requires a separately
approved gameplay/platform input minor. Contextual actions receive input checks
with their gameplay minor; representative mobile rendering, loading and
performance validation belongs to later graphics/platform hardening.

## 17. Baseline extension and compatibility boundary

The forward roadmap may add opportunity surveying, tribe economics, navigator
aging, lineage records, idols, save/load experience, Supported-route activity,
production assets and environmental polish. These are proposed extensions, not
implemented baseline behavior.

Presentation-only extensions may preserve the current save shape when they add
no authoritative state. Gameplay extensions must define deterministic identity,
event ordering, persistence ownership, migration and recovery behavior before
integration.

No roadmap work may change these foundation contracts without an explicit
design decision and, where authoritative state is affected, a save migration:

- deterministic world and stable island/discovery IDs;
- terrain-authoritative movement and sight;
- outward/current-sight knowledge asymmetry;
- exact-dock commitment;
- provision and return-cost semantics;
- four-second wreck lifecycle;
- authoritative save boundary;
- rolling autosave and stable checkpoint behavior.

Central integration files are serialized merge gates. New pure systems,
renderers and tests may be developed in parallel against frozen contracts, but
one integration owner must wire simulation lifecycle, events, save migration,
scene input and autosave behavior at each acceptance gate.
