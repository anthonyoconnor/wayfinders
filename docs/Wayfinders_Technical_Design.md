# Wayfinders technical design

This document describes the accepted implementation baseline. The roadmap
contains proposed future sequencing; this document contains current runtime
behavior and constraints.

Saving is intentionally absent. Every launch or refresh creates a fresh
session, and the runtime has no save schema, browser store, autosave, checkpoint
or restoration path. Saving may be added only by an explicitly authorized
milestone that names it as in scope; a future design starts from the gameplay
model that exists then rather than reviving the removed implementation.

## 1. Design goals

Wayfinders is a browser exploration prototype about leaving safe water,
building knowledge through travel, deciding when to return, and passing a
stronger chart to later voyages and generations. Its finite world goal is to
rediscover the locations of idols lost when the world split into islands and
return that knowledge home; the idols themselves are never recovered.

The implementation follows these rules:

1. Gameplay state is authoritative outside Phaser presentation objects.
2. World generation, navigation and knowledge behavior are deterministic and
   testable without a browser.
3. Current sight may reveal visuals without discounting the cost of Unknown
   travel.
4. Only exact-dock return commits an expedition.
5. Rendering never becomes a second gameplay-data source.
6. Stable logical identity and authoritative state boundaries preserve the
   option to design saving later without imposing current save obligations.
7. Normal sailing work remains local, sparse or cached.

## 2. Runtime architecture

The application lives under `src/wayfinders` and is split into these domains:

```text
config/       live prototype configuration and validation
core/         simulation owner, lifecycle events and fixed-step clock
world/        chunked grid, tile data and deterministic generation
navigation/   continuous ship movement and grid traversal
exploration/  sight, knowledge, provisions, risk paths and island dossiers
rendering/    Phaser world, ship, fog, overlays, markers and developer UI
```

`GameSimulation` owns the generated world, ship, expedition lifecycle,
knowledge, provisions, wrecks, island dossiers and derived risk results. It has
no Phaser dependency.

The Phaser scene adapter:

- converts keyboard movement and optional developer pointer commands into
  simulation operations;
- advances the fixed-step clock;
- synchronizes renderers from simulation state;
- owns camera behavior and screen-space UI;
- connects developer controls;
- never writes gameplay arrays directly.

The obsolete source namespace and scene identity have been removed. All new
roadmap modules must use the Wayfinders namespace.

A typed event bus communicates lifecycle changes to presentation adapters.

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
island-dossier content use separate deterministic namespaces so changing names
or descriptive/visual content cannot move an island.

The implemented island kinds are High Island, Low Cay, Atoll and Rocky Skerry.
Atolls receive a deterministic navigable passage. Placement enforces margins,
home clearance and minimum channels before the open-ocean flood validation.

Base island descriptors contain geometry and terrain identity only. Mutable
island-dossier state is stored separately and references the stable island ID.

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
knowledge or travel cost. Sight still drives island sighting and wreck detection
and the documented blocked-landmark and developer-tool knowledge rules. Movement
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
4. Commit provisional island-dossier and fishing records owned by that expedition.
5. Replenish provisions and clear fractional use.
6. Record one completed voyage for the current navigator and advance the
   expedition ID.
7. Keep the same navigator and generation after voyages one through three. On
   voyage four, complete the navigator's tenure and create exactly one
   successor after every expedition result has committed.

Docking without an active expedition replenishes supplies but does not change
generation or completed-voyage counts.

### Failure and wreck

Natural exhaustion outside Supported water and the developer force-wreck tool
use the same failure path:

1. Record a runtime wreck at the exact ship position and heading.
2. Revert the active expedition's Personal tiles to Unknown.
3. Remove that expedition's provisional island-dossier and fishing records without
   increasing the navigator's completed-voyage count.
4. Record the navigator as lost and begin one in-session wreck succession.
5. Freeze the empty ship at the loss site for four simulation seconds.
6. Clear loss-site visibility at completion.
7. Spawn a supplied ship and exactly one successor at the home dock, then
   advance expedition ID and generation once.

Timer overshoot is discarded. Successful return on a final-bundle docking step
takes precedence over wreck creation.

Runtime wrecks remain hidden by fog after respawn until a later generation sees
them. Their `discovered` state then persists independently of knowledge loss,
but the sighting is an unidentified wreck and does not expose the associated
lost navigator. Every runtime wreck retains a stable association with the
navigator who died there. Island dossiers contain no historic-wreck target;
GP-3.3 owns independently generated historic-wreck sites with no lineage
navigator.

During a later active expedition, an unidentified runtime wreck in interaction
range can be deliberately surveyed through the shared provision-funded survey
transaction. The action spends the displayed provisions and creates an
expedition-owned provisional identity/fate report. The surveying crew can
identify whose wreck it is, but
the tribe and permanent lineage do not receive the report until exact-home-dock
return. Successful return commits the report once to the wreck and correct lost
navigator. A fatal surveying expedition discards its provisional report while
leaving the wreck discovered, unidentified and available to survey again.
Repeated input, revisit and dock cannot duplicate either the survey cost or
returned report within a session. This baseline report does not salvage cargo, restore
Personal chart knowledge, commit the lost expedition's provisional findings
or apply an economy reward. Multiple surveys may be made in one journey while
the shared supply remains. Runtime navigator wrecks are not eligible idol
hosts, and there is no physical idol recovery or cargo system.

### Navigator tenure and transition time

A lineage voyage is one active expedition successfully committed at the exact
home dock. Every navigator can complete at most four. The authoritative lineage
stores `completedVoyages` and one immutable committed-result record for each
safe voyage on every `active`, `completed` or `lost` navigator, and uses
deterministic `tenure` and `wreck` succession keys. Each voyage record is keyed
by its navigator, ordinal and expedition and contains the Supported-route and
enclosed-Unknown counts plus canonical island-lead, island-dossier,
fishing-lead, fishing-survey and runtime-wreck IDs. Presentation resolves those
stable IDs to island names/dossier findings, fishing qualities and
lost-navigator identities from their authoritative records. Lineage contract V6
validates sorted, unique island IDs, transition provenance and idempotent credit.
There is no age, retirement choice or fifth-voyage state.

GP-2.2 owns the four-journey tenure, death, succession and required handover
gate. Authoritative tenure completion or wreck succession commits exactly once
before its presentation can affect play. Every generation boundary then creates
an in-session, unacknowledged handover. The simulation suppresses sailing until
the handover is acknowledged; browser reload deliberately starts a fresh
session. A completed tenure lists voyages one through four
with the achievements committed at each exact-dock return. An early loss lists
the preceding safe-return records and the next numbered voyage as **Lost at
sea**, explicitly crediting nothing from that fatal expedition.

GP-2.3 presents that GP-2.2 gate as the bounded, non-dismissible focused mode of
the permanent Great Hall chronicle. The same chronicle supplies optional home
browsing and lineage totals rather than maintaining a separate succession
summary.

`GreatHallChronicle` V4 is a versioned ephemeral read model, not save authority.
It derives structured achievement keys, active / completed / lost navigator
entries, distinct island-lead/dossier and survey-site lead/report achievements
and totals, distinguished idol-location achievements, lineage totals and
returned wreck-fate links from the authoritative lineage and returned world
records. Its idol source contains the configured total and returned locations
only; it never receives an undiscovered host. The player-facing
record remains permanent because those source records persist; the derived view
is rebuilt rather than saved independently. The optional home mode is available
only through **Go ashore · Great Hall** at the exact home dock; there is no
at-sea Great Hall access. It defaults to the active navigator, labels that
navigator **In progress** and can browse every generation. Ordinary returns
update the chronicle but do not force it open. Return presentation may set a
session-only Great Hall update cue, but that cue resets with the session. A lost
navigator exposes no wreck identity until a later exact-dock-returned survey
links the confirmation to the lost record and preserves credit on the reporting
voyage. No archive copy, aggregate counter, update cue or viewed-state flag is
serialized.

The final returned idol location opens the same Great Hall in a dedicated
completion mode after exact-dock voyage settlement and credit. **Continue
exploring** preserves the completed world and lineage, permanently changes its
completion state so the ending cannot retrigger, and returns to ordinary play;
normal exact-home-dock Hall browsing remains available. **Start new game**
regenerates the session with a distinct effective seed and resets world,
lineage and idol progress. When the final return also completes voyage four,
the completion mode is shown first and the already committed handover remains
pending underneath it; continuing opens that handover, while starting a new
game discards it with the old world.

Narratively, that boundary represents elapsed world time: the tribe can act on
returned findings, or determine that a lost navigator will not return, mourn
them and nominate a successor. Future presentation may show derived world
changes there or enrich the handover with a fuller ceremony or mourning scene.
Any future authoritative settlement system requires separate approval and is
not implied by the boundary. Neither wall-clock waiting nor handover display
time advances authoritative gameplay; the pending handover itself remains
authoritative input-gating state until acknowledgement.

## 11. Island dossiers and survey sites

`generateIslandDossierCatalog` derives exactly one immutable content V1
definition for every non-home island from the seed, regenerated world and stable
island ID. A definition contains the existing island identity/kind/size, a
deterministic unique name, every exact-island-ID footprint tile, every passable
dock-reachable coastal approach within 1.5 tile widths, one canonical
developer/presentation approach and one hidden descriptive dossier result.
Current themes are community, resource, anchorage, reef passage and weather
watchpoint. Definitions and hidden results are regenerated, not serialized.

`IslandDossierSystem` owns the mutable branch. Final current sight during an
active expedition creates one free `sighted` record and exposes the name, never
the result. From any valid coastal approach, the shared provision-funded survey
transaction atomically upgrades that sighting—or an earlier returned lead—to
`surveyed`. Exact-dock return commits `sighted` as a returned `lead` and
`surveyed` as a returned `dossier`; wreck rollback removes only records owned by
the failed expedition and preserves earlier returned leads/dossiers. Records
carry expedition and generation provenance, and repeat sight, survey or return
cannot duplicate state or achievement credit within a session.

A provisional `surveyed` or returned `dossier` state supplies a sorted set of
revealed island IDs to the knowledge overlay. The renderer omits fog only from
tiles whose generated `islandId` exactly matches that set. It does not write
`KnowledgeState`, expedition stamps, terrain, Supported topology, route credit
or travel costs, and rollback restores fog for a failed provisional survey.

The legacy `DiscoverySystem`, discovery events/save fragment and its generated
`HistoricWreck` / `FishingGround` island outcomes are removed. GP-1 fishing
shoals remain authoritative fishing targets. Island dossier findings are descriptive Great Hall knowledge and
do not create settlement or economy authority.

`generateSurveySiteCatalog` content V1 derives exactly one historic wreck, one
coastal ruin and one tidal cave from the seed. Every definition has a current
typed ID, directly sightable clue tile, passable dock-reachable service anchor,
hidden deterministic result and developer presentation descriptor. Placement,
clues, results and presentation are descriptor data; the generic catalog and
`SurveySiteSystem` accept a synthetic later non-idol type without a new command,
reducer or persistence fragment. Sites are independent of island dossiers and
runtime navigator wrecks.

All initial types share one state branch: current sight creates provisional
`sighted`; the configured two-bundle provision transaction upgrades it—or a
returned lead—to `surveyed`; exact-dock return commits `lead` or `report`; wreck rollback removes
only the active expedition's provisional records. Stable IDs and expedition /
generation provenance make observation, survey and return idempotent within a
session.

### Idol-location catalog and derived lifecycle

`generateIdolLocationCatalog` creates immutable contract/content V1 definitions
after island dossiers and GP-3.3 survey sites exist. The world configuration
supplies a positive integer `idolCount`, defaulting to three. Generation rejects
a count larger than the eligible host set rather than reducing it. Candidate
hosts are canonicalized before seeded ranking, so the same world seed, count
and content version produce the same selection regardless of source-array
order, with at most one idol per host.

The eligible set is every non-home island dossier plus the seed-derived
historic-wreck, coastal-ruin and tidal-cave sites. Fishing shoals and runtime
navigator wrecks are excluded. The catalog overlays stable host IDs and does
not mutate terrain, island identity, survey placement or fixed-update work.
Only development authority may inspect the full mapping.

Idol progress owns no second mutable survey reducer. A successful ordinary host
survey is provisional idol-location knowledge exactly when its host is in the
catalog. A wreck rolls it back with that host's `surveyed` record. Exact-dock
return commits it with the host's dossier or report, and returned leads do not
count. Public progress derives provisional and returned locations from those
authoritative host states. There is no idol-specific command, remote clue,
physical object, cargo, recovery state, loss site, currency, power or upgrade.

The lineage voyage record already identifies returned island dossiers and site
reports. Great Hall V4 joins those stable host IDs to returned idol definitions
to derive a unique `idol-location` achievement for the exact navigator and
voyage without extending mutable lineage storage. The Hall exposes returned
progress against the configured total while keeping undiscovered hosts hidden.

The simulation completion state is `in-progress`, `awaiting-choice` or
`continued`. Only the exact-dock return that raises returned idol locations to
the configured total changes it to `awaiting-choice` and emits completion after
normal return, credit, replenishment and any tenure transition have committed.
While the choice is active, movement and lifecycle-mutating interactions are
suppressed. Continuing changes the state once to `continued`; no later return
can emit completion again. Starting a new game uses a deterministic uint32 seed
advance that is guaranteed to differ in effective seed space, then performs the
ordinary fresh-world reset.

## 12. Saving policy

Saving is not an active runtime capability. The application always constructs a
new `GameSimulation` and browser refresh discards the current session. There
are no persistence modules, serialized game schemas, browser save records,
manual checkpoints, game-level restoration paths or save-specific acceptance tests.

Current features must not introduce save fragments, storage adapters,
compatibility work or reload guarantees. Keep gameplay authority outside
presentation, retain stable logical identities and rebuild derived data so a
future explicitly authorized saving milestone can design a new version-one
format without inheriting obsolete contracts.

Reintroduction requires a named milestone whose authorized scope explicitly
includes saving. Technical readiness, lost playtest progress or an adjacent
feature may motivate proposing that milestone, but do not authorize
implementation.

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
  island-dossier markers and survey-site markers are separate, viewport-culled,
  version-driven renderers above world and fog layers.
- The cargo rack and lifecycle cues are screen-space presentation.

Island sightings announce a named lead while keeping the dossier result hidden.
Surveying an idol host adds an unmistakable provisional idol-location cue to
the ordinary host finding without revealing any other host. Exact-dock return
with any notable committed finding (island lead/dossier, idol location,
survey-site lead/report, fishing report or wreck identity)
combines achievements, Supported-route growth and replenishment into one
five-second message. A return with route growth only uses a 3.5-second cue.
Only one lifecycle cue may exist at a time.

The fourth safe return replaces the ordinary cue after all voyage results
commit, except that final-idol completion has first presentation priority. A
wreck hold identifies the navigator as lost, states that their wreck
remains and compresses the tribe's mourning and elapsed time. Either path then
opens the required focused handover mode of the Great Hall. Each safe-voyage row
  mirrors the dock report with route-support counts, island leads/dossiers,
  survey-site leads/reports, fishing leads and survey qualities, and returned wreck identities; a safe voyage with
none says that no new findings were returned. A fatal-voyage row reports **Lost
at sea** and states that no findings from that journey were returned; it never
exposes provisional achievements. The rows are derived from the committed
outgoing lineage record, the view does not create the successor or settle
economy state, and sailing input remains suppressed until acknowledgement.
Outside succession, **Go ashore · Great Hall** opens the dismissible browsing
mode only at the exact home dock; it is never part of the sailing HUD. GR-3.4
may polish this transition without changing the authoritative records. The
ordinary shell status and return overlays expose **Voyage n of 4** so the
bounded tenure is legible without a retirement decision control.

The final Great Hall shows the completed lineage and credits before its two
choices. Continuing closes completion, then opens any pending fourth-voyage
handover before sailing resumes; later home visits can browse the same completed
Hall normally. Starting a new game clears all pending old-world presentation
before regenerating, so no stale return or handover can appear in the new world.

A discovered but unreported runtime wreck uses an unidentified marker and a
contextual **Survey wreck** action. Surveying exposes the navigator's
identity only as aboard, provisional knowledge. Exact-dock commitment changes
the persistent presentation to a returned fate report. GP-3.3 historic-wreck
sites use a separate identity and never claim a lineage link.
The contextual prompt has no authoritative Leave command or separate survey
allocation: it stays non-modal, sailing out of range defers the opportunity,
and surveying spends a displayed provision cost.

The camera follows the interpolated ship smoothly during play. World
regeneration is a discontinuity, so the camera snaps to the authoritative ship
before smoothing resumes.

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
navigatorTenureCompleted
shipWrecked
generationAdvanced
wreckDiscovered
wreckSurveyed
wreckSurveysReturned
wreckSurveysLost
expeditionFailed
islandSighted
islandDossierSurveyed
islandDossiersReturned
islandDossiersLost
surveySiteSighted
surveySiteSurveyed
surveySitesReturned
surveySitesLost
idolLocationDiscovered
idolLocationsReturned
idolLocationsLost
fishingShoalSighted
fishingShoalSurveyed
fishingShoalsReturned
fishingShoalsLost
gameCompleted
completedWorldContinued
worldRegenerated
gameLoaded
```

`expeditionReturned` identifies the navigator, completed voyage number,
remaining voyage allowance and whether the tenure completed.
`navigatorTenureCompleted` identifies the outgoing and successor navigators.
`generationAdvanced.reason` is either `tenure` or `wreck`.
`idolLocationDiscovered` is provisional and names only the surveyed location;
`idolLocationsReturned` and `idolLocationsLost` mirror the host survey's dock
or wreck boundary. `gameCompleted` is emitted only for the first final-location
return, after normal settlement, and `completedWorldContinued` records the
one-way choice to keep exploring that completed world.

Developer UI capabilities:

- regenerate from a seed;
- inspect island dossiers at deterministic coastal approaches in stable ID
  order;
- move to the service anchor for each initial survey-site type;
- teleport by water-tile coordinate or click;
- add/remove bundles and force a wreck;
- toggle navigation grid, current sight, forward reach and return viability;
- tune supported live configuration values.

The developer drawer is non-modal and does not pause sailing merely by being
open. WASD remains available while a numeric tuning field has focus; arrow keys
remain native to that field until focus returns to the canvas or another
non-editing control. Lifecycle holds still suppress navigation.

The browser automation interface exposes snapshot, teleport, provision,
wreck, regeneration, overlay and performance operations. Canvas data attributes
provide stable diagnostic values for browser checks, including frame
percentiles, long frames and deliberately dropped simulation time.

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
- island-dossier/wreck reconciliation is version driven;
- diagnostics are capped rather than updated on every fixed step.

World generation, placement and open-ocean validation scale with world area but
run only at generation/restore time. Desktop probes at doubled world dimensions
remain within the fixed-update budget. Representative mid-range mobile testing
is still required; no Web Worker is justified without new profiling evidence.

## 16. Testing and platform state

The automated suite covers configuration, deterministic generation, movement,
visibility, knowledge asymmetry, provisions, forward/return calculations,
overlay invalidation, island navigation, expedition success/failure,
four-journey tenure and succession, Great Hall chronicle derivation and
 exact-home-dock access, Unknown pocket cleanup, island dossiers and exact-island
 fog reveal, extensible survey-site generation/lifecycle, runtime-wreck survey
 commit/rollback and idempotence, deterministic idol-location selection,
 provisional/wreck/exact-dock idol integration, Great Hall V4 credit,
 completion choices, frame telemetry and ship interpolation. The current test
 count is recorded in `IMPLEMENTATION_STATUS.md`; typecheck, the automated suite
 and the production build pass. Browser verification also covers the three typed service-anchor
developer moves, the Survey-only site prompt, placeholder presentation and
unsuppressed sailing input while developer tools remain open.

Browser verification targets WebGL startup, controls, island/fishing cues,
combined return presentation, fourth-return automatic succession, fatal-wreck mourning
and succession, focused Great Hall handover entries, exact-home-dock browsing,
unidentified wreck survey and exact-dock reporting, pending handover and wreck
flows, special idol discovery/return cues, final Great Hall ordering, continued
completed-world play, later Hall browsing, distinct-seed new game, live sailing
and speed tuning with the developer drawer open, and console health.

Desktop keyboard/pointer play is the validated target. Responsive resize is
implemented. Touch-first sailing is not implemented and requires a separately
approved gameplay/platform input minor. Contextual actions receive input checks
with their gameplay minor; representative mobile rendering, loading and
performance validation belongs to later graphics/platform hardening.

## 17. Baseline extension and exact-version boundary

The accepted baseline includes fishing surveys, navigator lineage, GP-2.2's
four-journey tenure, death, succession and required handover gate, and GP-2.3's
shared permanent Great Hall chronicle with focused handover presentation,
exact-home-dock browsing and derived lineage totals. It also includes returned
identity/fate reports for runtime navigator wrecks and GP-3.1's shared
provision-funded survey transaction. It now also includes GP-3.2's returned
island leads/dossiers and exact-island fog reveal. GP-3.3 adds exactly one
historic wreck, coastal ruin and tidal cave through a descriptor-extensible
lifecycle, with lineage V6 voyage records V3 and Great Hall V3 credit. The
accepted GP-4.1 overlay adds the hidden finite idol-location catalog,
survey-owned provisional/return/wreck behavior, Great Hall V4 credit and
one-shot completion with continue/new-game choices. The forward roadmap may
add an explicitly authorized saving milestone, production assets and
environmental polish. It no longer places tribe economics, loadouts,
generic cargo or automatic trade in GP-3. Those remaining roadmap items are
proposed extensions, not implemented baseline behavior.

For accepted GP-3.2, a surveyed island's full-map reveal is a presentation
derivation from its provisional or returned dossier record. The fog renderer
excludes exactly the tiles whose generated `islandId` matches that record; it
does not mutate `KnowledgeState`, expedition stamps, travel cost, Supported
topology or route-achievement counts. A dock-reachable passable water tile is a
valid approach when the Euclidean distance between its center and the center of
at least one tile carrying that exact island ID is at most 1.5 tile widths. Any
accessible coast can serve a small or large island. GP-3.3 ships only
historic-wreck, coastal-ruin and tidal-cave sites. They share the same
provision-spend and return/rollback lifecycle behind stable typed site IDs;
their placement, clue and descriptive-result catalogs remain data driven so
later site types do not require new interaction semantics. These sites are
independently seed-derived and directly sighted; island dossiers do not spawn
or unlock nested site leads.

GP-4.1 selects idol hosts only from those island dossiers and three GP-3.3
sites. It uses the hosts' existing stable IDs and states rather than changing
their generators. Fishing shoals and runtime navigator wrecks remain excluded.
The default catalog count is three, every configured count is positive and no
world may request more idols than eligible hosts. Continuing completion retains
all returned records and normal Hall access without another ending; starting a
new game is the only completion choice that resets the world and lineage.

Gameplay extensions must define deterministic identity and event ordering while
keeping authoritative state separate from derived presentation. They have no
save-shape, persistence-ownership or reload-compatibility obligation.

No roadmap work may change these foundation contracts without an explicit
design decision:

- deterministic world and stable island/dossier IDs;
- terrain-authoritative movement and sight;
- outward/current-sight knowledge asymmetry;
- exact-dock commitment;
- provision and return-cost semantics;
- four-second wreck lifecycle;
- hidden idol-host authority derived from eligible survey hosts only; and
- one-shot per-world completion with exact-dock credit before presentation.

Central integration files are serialized merge gates. New pure systems,
renderers and tests may be developed in parallel against frozen contracts, but
one integration owner must wire simulation lifecycle, events and scene input at
each acceptance gate.
