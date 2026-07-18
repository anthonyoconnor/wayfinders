# Wayfinders continuous-world milestone proposal

This document owns the detailed design and acceptance criteria for the `GP-6`
continuous-world proposal. `Wayfinders_Roadmap.md` owns its planning and
authorization state. This proposal changes no implemented behavior:
`Wayfinders_Technical_Design.md` continues to describe the current bounded game
world until implementation begins. Each authorized gate must update its
current-state documentation in the same coherent change as the contract; those
updates are not deferred to `GP-6.6`.

## Outcome

Replace the generated game's hard rectangular boundary with one continuous,
two-axis wrapping world that:

- lets the ship cross west/east, north/south, and corner seams without stopping,
  teleporting visually, or losing physical travel;
- treats opposite edges as ordinary neighbours for collision, navigation,
  visibility, knowledge, generation, spatial queries, and feature rules;
- allows generated and authored island footprints to cross a seam without
  cropping, duplicated identity, or broken collision;
- keeps one finite, canonical logical world for deterministic storage, indices,
  revisions, events, and diagnostics;
- presents the nearest periodic image of that world through the existing
  chunk-bounded rendering lifetime; and
- preserves current gameplay rules, deterministic ordering, named scale
  profiles, and normal-sailing performance budgets.

The player-facing result is globe-like circumnavigation over the existing
top-down map. Wrapping both axes is mathematically a **torus**, not a spherical
projection. `GP-6` does not add poles, latitude distortion, curved rendering,
or an infinite procedural world.

## Product and topology decisions

The following decisions are part of this proposal and do not remain open gates:

| Context | Topology | Contract |
| --- | --- | --- |
| Generated gameplay world | wraps on both axes | west/east and north/south are periodic neighbours |
| Water asset workspace | toroidal generated facts in a bounded inspection viewport | it uses the real `WorldGenerator` and `GeneratedWaterLayout` and must expose seam facts without becoming a gameplay scene |
| Isolated asset sea trial | bounded | the trial keeps its safe reset boundary and does not become a gameplay world |
| Asset collision validation and local authored grids | bounded | outside the authored canvas remains outside the artifact |

Topology is explicit at construction and in generated-world identity. It is not
inferred from dimensions, exposed as a live tuning control, or offered as two
gameplay modes. A shared axis-explicit contract may represent the two named
topology forms, but production `GameSimulation` always receives the two-axis
wrapping form after `GP-6`.

The wrapping contract must support non-square worlds, partial edge chunks, and
dimensions that are not exact multiples of the chunk size. It must not tighten
the current general `WorldGrid` dimension contract merely to simplify
presentation.

The opening starter lane remains finite. It is the lifted eastbound corridor
from the dock through `floor(widthTiles / 2)` tile-centre steps, using the
existing configured half-width; an exact antipodal endpoint uses the eastward
image. The exclusion stops there and never becomes a circumnavigating band.

The generated **global ocean component** is the unique largest exact traversable
water component containing the home dock. In the lifted graph it must contain a
closed traversable cycle with net image offset `(±worldWidth, 0)` and another
with `(0, ±worldHeight)`, proving independent non-contractible
circumnavigation on both axes; merely touching or crossing one seam edge is not
sufficient. It also contains every atoll lagoon centre plus every mandatory
island/service approach anchor defined at the applicable generation stage.
Other passable components are allowed only where the current design already
permits enclosed water, and no required service or completion host may be
placed in them.

## Evidence and current constraints

The finite boundary is currently distributed rather than owned by one seam:

- `WorldGrid` validates only canonical in-bounds cells, and several neighbour
  caches clip their work at coordinate zero and the last row or column.
- `CollisionGeometry` treats every out-of-bounds broad-phase cell as solid,
  while `MovementSystem` drops out-of-bounds entered tiles and can retain a
  non-canonical final pixel position.
- `GridGraph`, supported connectivity, forward guidance, return guidance, and
  `WorldAnalysisIndex` omit cardinal neighbours across the rectangle edge.
- visibility clips its disc and sight lines; knowledge-pocket cleanup treats a
  component reaching an edge as open rather than enclosed.
- generation reserves an empty edge margin, paints only inside the rectangle,
  and validates open ocean by requiring the dock component to reach all four
  edges.
- `WaterLayoutPlanner` clips protected-water neighbours and transition masks at
  the rectangle, and its seeded ellipses/ribbons use planar containment.
  `WaterRenderer` owns two canonical canvas-texture planes and images per active
  chunk; only visible surface planes animate. `WaterPreviewScene` uses the same
  generated facts but also derives preview-local shore/distance facts planarly.
- the manifest has no topology identity and represents every island with one
  non-wrapping axis-aligned bounds record.
- spatial index, feature-range, interaction, and visible-candidate queries use
  planar bounds and distances. A seam-spanning set can therefore become an
  almost-world-sized query.
- the Phaser camera is bounded; viewport activation clips to one rectangle;
  ship interpolation and route geometry use raw canonical positions.
- terrain, authored art, fog, risk, Voyage Sense, clouds, markers, and
  diagnostics currently assume one visible image of each canonical chunk.

The conversion must preserve these current architectural constraints:

- `world` owns logical topology, coordinate conversion, generation, analysis,
  manifests, and spatial indexing without importing Phaser.
- `navigation` owns authoritative collision and traversal over the world
  topology.
- exploration and feature systems consume the public topology and indexed
  candidates but retain their exact state, range, sight, and approach checks.
- `GameSimulation` remains the composition and deterministic event-ordering
  seam.
- `WayfindersScene` remains the sole presentation-lifetime owner and continues
  to use one `ActiveChunkSet` policy.
- `GeneratedWaterLayout` remains renderer-neutral presentation data derived
  after world analysis, and `WaterRenderer` remains the production water owner.
- normal sailing remains local, sparse, cached, revision-driven, cooperative,
  or bounded by active presentation resources.

When implementation changes these truths, the owning current document changes
with it: the technical design for runtime behavior and budgets, the architecture
map for actual public seams or dependency direction, the asset/water design for
current production-water contracts, and `IMPLEMENTATION_STATUS.md` for volatile
verification. Only completed outcome and acceptance evidence wait for the
roadmap archive.

## Coordinate and identity contract

### Canonical and lifted coordinates

Authoritative tiles, indices, descriptors, and stored pixel positions use the
same half-open canonical ranges as today:

```text
0 <= tileX < widthTiles
0 <= tileY < heightTiles
0 <= worldX < widthTiles * tileSize
0 <= worldY < heightTiles * tileSize
```

Canonical storage reads and writes do not silently modulo their inputs: they
either reject non-canonical coordinates or retain an explicitly named bounded-
context sentinel. Callers cross a gameplay seam through the topology API. This
keeps accidental out-of-range access detectable.

Movement and presentation may use **lifted coordinates**: a canonical position
plus whole-world image offsets. Lifted coordinates express the short physical
motion through a seam and let the camera follow continuously. They never become
tile identity, feature identity, collision ownership, or persistence state.

For a canonical scalar displacement, the minimum image is the raw displacement
when its magnitude is at most half the span; otherwise one span is added or
subtracted to choose the shorter image. An exact half-span tie retains the sign
of the raw canonical displacement. Graph searches additionally preserve their
declared stable neighbour order. Movement follows its actual lifted direction;
it never replaces player motion with a shortest-path displacement after the
fact.

### Required topology operations

One public, renderer-neutral world seam must own:

- tile and pixel normalization for negative values, exact-span values, and
  values beyond one circumference;
- canonical tile/index conversion;
- signed minimum-image displacement and squared distance;
- stable direction-tagged cardinal and eight-neighbour steps, plus separate
  unique canonical-neighbour/query enumeration;
- decomposition of a wrapped interval or bounds query into canonical pieces;
- canonical chunk identity and periodic image offsets; and
- deduplication and deterministic ordering when multiple images map to the same
  canonical tile, chunk, or entity.

Width- or height-one worlds produce no graph self-traversal. On a width- or
height-two axis, opposite directions may reach the same canonical neighbour but
remain distinct physical edges and collision-cache slots. Unique query,
visibility, candidate, and mutation results deduplicate the canonical endpoint.
Query radii, viewports, and synthetic test worlds that cover more than one image
likewise deduplicate authoritative results without erasing directional travel.

### Wrapped geometry and durable identity

A seam-crossing entity remains one entity. The manifest and spatial contracts
must represent its canonical centre and complete periodic footprint without
inflating it into a near-world-sized planar box. A wrapped rectangular
footprint may decompose into at most four canonical pieces. All pieces retain
one stable descriptor ID, one feature state, and one authoritative collision
footprint.

The four-piece bound requires each generated collision/art footprint to be
strictly smaller than one world span on each axis. Generation and manifest
validation reject an oversized footprint rather than inventing self-overlap,
multi-image collision, or ambiguous authored-art semantics. Bounded authoring
can still inspect an oversized local artifact; it simply cannot place it in a
smaller gameplay world.

Periodic water-region geometry is durable and intentional. Ellipses retain a
canonical centre and local radii. A ribbon retains a canonical anchor plus a
signed lifted displacement or explicit winding/image offset; canonical
endpoints are never automatically replaced by their minimum-image connection.
The current long interior `0.04 * width` to `0.96 * width` ribbon therefore
remains long unless a later authored region explicitly chooses to cross a seam.

The world manifest receives a coordinated schema-version bump from
`WorldManifestV1` to `WorldManifestV2`, the generation fingerprint records
topology, and the generator version changes. The new schema also carries
wrapped footprints and lifted/winding water geometry. Existing callers and
fixtures change together; no silent reinterpretation of `WorldManifestV1`,
finite-world compatibility facade, dual gameplay path, or save migration is
required.

## Implementation sequence

### GP-6.1 — Topology contract, identity, and baselines

Establish the one shared vocabulary before changing subsystem behaviour.

Tasks:

1. Record the existing `P0`, `P1`, and `P2` generation, navigation, forward-
   guidance, spatial-query, generated-water, and active-presentation baselines,
   plus the `P2-500` generation/placement stress baseline, using the current
   named profiles and counters. Generated-water evidence
   includes deterministic hashes/counts, region coverage, two canonical texture
   planes per active chunk, static prefetched surfaces, visible-only discrete
   redraws, reduced motion, phase continuity, partial-chunk tile counts, and
   home-shore lifetime.
2. Approve numeric `GP-6` regression limits for generation time/attempts, local
   seam-query buckets/candidates, repeated-wrap authoritative work, water redraw
   work, frame/resource plateaus, and browser-visible seam demand. A measurement
   without a pass/fail threshold does not close this gate.
3. Add the explicit bounded and two-axis wrapping topology contexts at the
   `world` public seam. Generated gameplay worlds select wrapping; asset trials,
   authored local grids, and collision validation select bounded behaviour. The
   Water workspace consumes the same toroidal generated facts through its
   bounded inspection viewport.
4. Implement canonicalization, minimum-image displacement, direction-tagged
   periodic steps, unique query neighbours, wrapped-bounds decomposition, and
   periodic image-offset helpers.
5. Add topology and intentional water-region lift/winding to generated identity,
   the settings fingerprint, a bumped manifest schema/codec, and deterministic
   serialization. Reject a manifest whose topology and geometry disagree.
6. Update tiny-world fixtures deliberately: tests of unrelated bounded artifact
   behaviour opt into bounded topology, while gameplay topology fixtures assert
   periodic semantics.

Exit gate:

- property tests cover negative and over-range coordinates, exact spans, both
  axes, all corners, non-square worlds, half-circumference ties, partial chunks,
  and one- and two-cell dimensions;
- normalization is idempotent, tile/index conversion remains a bijection over
  canonical cells, directional edges are symmetric and stable, and unique
  query results are duplicate-free without collapsing width-two edge slots;
- wrapped interval/bounds pieces cover exactly the requested canonical set and
  never return the same canonical cell or entity twice;
- same input identity serializes byte-for-byte identically and topology changes
  the manifest and settings identity;
- the baseline record contains approved numeric regression limits for every
  new periodic-work and resource category named above; and
- architecture checks and source/test typechecks pass without a user-facing
  finite/toroidal gameplay switch.

### GP-6.2 — Seam-crossing movement, collision, and navigation

Make physical travel and graph authority periodic over tiny explicit worlds
before changing world placement. This gate does not wire the periodic graph
into `WorldGenerator` or production composition; `GP-6.3` performs that atomic
handoff after generation's edge-based acceptance is replaced. There is no
supported intermediate runtime mode.

Tasks:

1. Split a movement sweep at every crossed world seam, collision-test the
   appropriate canonical images, and publish canonical final state plus the
   short lifted travel segments needed by consumers.
2. Expose the accepted lifted displacement or stable wrap/image offset through
   a renderer-neutral `GameSimulation` movement/read-model seam. Presentation
   must not have to infer physical direction from two canonical poses.
3. Preserve heading, signed speed, physical distance, entered-tile order, and
   collision epsilon across west/east, north/south, and corner crossings.
4. Make coarse and fine collision test opposite-edge geometry instead of a
   synthetic world wall. Keep the bounded policy for asset contexts.
5. Add direction-preserving periodic cardinal edges to `GridGraph` and its
   static topology cache. Manual movement and centre-to-centre graph traversal
   must continue to share the same exact hull-clearance predicate, including
   distinct width-two direction slots.
6. Make Supported/Personal boundary maintenance and supported connectivity
   periodic, then move forward range, return paths, and their cancellation/
   publication contracts onto the periodic graph. Heading cones use minimum-
   image vectors without revealing hidden blockers. Path reconstruction retains
   each direction-tagged edge or lifted image offset; canonical index sequences
   alone cannot represent which width-two edge or seam winding was selected.
7. Publish canonical-tile and short physical segment data for provision,
   visibility, knowledge, and presentation consumers; their gameplay migration
   closes in `GP-6.4`.

Exit gate:

- open-water travel crosses every seam in both directions and crosses every
  corner without collision, speed reset, lost distance, or out-of-range state;
- fixed-step partitions of the same motion produce equivalent canonical pose,
  lifted displacement, physical distance, entered tiles, and movement event
  order;
- every physical tile-centre entry is emitted once in order for the supported
  fixed-step movement envelope, with no lost or spurious duplicate crossing;
- a coarse or fine blocker on the opposite edge stops the hull before contact,
  and every graph seam edge agrees with an exact movement replay;
- seam edge cache invalidation follows collision revision and forward tasks
  remain cancellable, stale-safe, and equivalent to synchronous completion;
  and
- minimum-cost forward and return results may cross a seam, retain deterministic
  ties, do not expose Unknown collision, and consume a periodic Supported/
  Personal boundary index; width-two and seam fixtures retain the exact selected
  direction/winding for later presentation.

### GP-6.3 — Periodic generation, analysis, and spatial indexing

Remove the generator's privileged boundary and allow content to occupy the
complete continuous world.

Tasks:

1. Sample island centres over the entire canonical domain. Remove the world-
   edge rejection; retire or rename `edgeMargin` so it cannot survive as a
   hidden empty seam band.
2. Apply home clearance, starter-lane clearance, inter-island separation, and
   minimum navigable channels with periodic distances and footprints. The
   starter exclusion uses the exact finite lifted half-world corridor defined
   above and permits placement beyond its endpoint.
3. Rasterize complete procedural and authored footprints modulo the world.
   Derive shape noise in island-local coordinates so crossing a seam does not
   split the shape, collision mask, or deterministic art identity. Reject any
   footprint that is not strictly smaller than the applicable world span.
4. Make atoll passages, authored collision masks, landmark/resource placement,
   and island bounds use the wrapped-footprint contract. Each canonical tile is
   written at most once per descriptor.
5. Replace "dock reaches all four edges" with the exact global-ocean contract
   above: the dock component is uniquely largest, passes a lifted-graph cycle
   oracle for independent horizontal and vertical winding, contains every atoll
   lagoon centre and mandatory service/approach anchor, and leaves only
   currently permitted enclosed-water components outside it. A seam edge alone
   cannot satisfy the oracle. Only after this replacement does the integration
   branch's `WorldGenerator` compose the periodic graph accepted in `GP-6.2`.
6. Make `WorldAnalysisIndex` use periodic neighbours for components and
   coastlines. Remove edge-touch facts that no longer describe openness and
   prevent false coastline at coordinate zero.
7. Make water-region containment, protected-shallow classification, and
   transition collars/masks use periodic neighbours and the manifest's explicit
   lift/winding. Keep `GeneratedWaterLayout` arrays, variants, phases, and
   `chunk()` snapshots canonical and chunk-addressable; presentation image
   offsets do not enter generated facts.
8. Update `WaterPreviewScene` to derive shore/distance facts periodically while
   retaining its bounded fit/1:1 inspection viewport. Its overlays and animation
   must make both sides of each seam inspectable from the shared generated
   layout.
9. Make `WorldSpatialIndex`, `WorldDescriptorRegistry`, and bounded analysis
   queries split periodic regions, index wrapped descriptor pieces, deduplicate
   stable IDs, and preserve nearest-first and row/ID tie ordering.

Exit gate:

- fixed seam fixtures cover every procedural island kind plus an authored
  island across each axis and a corner, with coherent terrain, fine collision,
  island identity, coastline, approach, and presentation footprint facts;
- opposite-edge placement conflicts are rejected by the same clearance rule as
  centre-world conflicts, with no special empty seam strip;
- starter-lane fixtures reject an intersecting island through the declared
  eastbound endpoint, permit it immediately beyond that endpoint, and prove the
  exclusion does not circumnavigate;
- open-ocean, component, coastline, atoll, and service-anchor oracles use the
  periodic graph, satisfy the unique-largest and independent lifted-cycle
  global-ocean contract, and report no coordinate-edge artifact;
- generated-water regions, deep/coastal transitions, protected shallows, and
  overlays join at seams and replay deterministically from manifest identity;
  the migrated long interior ribbon retains its intended coverage, while an
  explicit lifted seam ribbon follows its declared winding;
- the Water workspace's fit, 1:1, overlay, pause, animation, partial-chunk, and
  seam-inspection views consume the same canonical generated facts as the game;
- point, bounds, radius, nearby, visible-set, and chunk queries match a brute-
  force periodic oracle, return each entity once, and examine bounded local
  buckets for local seam queries;
- manifest round trips preserve seam-crossing footprints, water-region
  lift/winding, and stable IDs; and
- `P0`, `P1`, `P2`, and `P2-500` seed/density sweeps remain deterministic and
  attempt-bounded under the periodic clearance contract and pass the numeric
  generation, water-layout, and seam-query limits approved in `GP-6.1`.

### GP-6.4 — Wrapped sight, knowledge, features, and expeditions

Move every gameplay consumer from planar subtraction or clipped bounds to the
shared topology.

Tasks:

1. Wrap visibility discs and line of sight through the nearest image. Blocking
   tiles remain visible, hide tiles behind them, and appear once in the result.
2. Carry crossed-centre visibility and Personal trails through seams without a
   world-wide strip.
3. Redefine tiny Unknown-pocket cleanup by periodic enclosure and the existing
   size bound. Coordinate zero is not an escape; a component spanning a seam is
   one component.
4. Make provision preparation consume the canonical tile and short physical
   segments published in `GP-6.2`, preserving pre-observation knowledge and
   frame-rate-independent charge without a planar midpoint recomputation.
5. Apply periodic home exclusion, separation, range, sight, approach, and
   service tests to fishing shoals, island dossiers, survey sites, historic and
   runtime wrecks, and idol-location hosts. Required service and completion-host
   eligibility stays inside the named global ocean component. Retire
   `FishingShoalCatalog`'s finite world-edge exclusion rather than preserving a
   four-tile content-sparse seam; no feature catalog keeps an edge margin unless
   it is redefined as a named local periodic clearance.
6. Split core visible-candidate and interaction queries at seams and corners.
   Candidate collection and command-time revalidation use the same periodic
   exact distance and stable ordering.
7. Preserve expedition start, exact canonical home docking, settlement,
   provision replenishment/exhaustion, wreck pose, succession, completion, and
   developer teleport semantics across a seam.

Exit gate:

- sight and occlusion fixtures pass across both axes and corners, including
  opposite-edge blockers and no duplicate visible/observed indices;
- trail, provision, expedition, docking, wreck, return, and rollback journeys
  have the same result at a seam as an equivalent centre-world journey;
- pocket cleanup neither leaks through a former edge nor closes a seam-spanning
  component that exceeds or fails the existing enclosure contract;
- each discoverable type preserves its applicable sight, prompt, survey,
  return, and revisit lifecycle across a seam with exactly one prompt, mutation,
  event, and lineage credit where that lifecycle produces them;
- shoal and site placement fixtures cover coordinate-zero seams without a
  legacy empty feature band and preserve periodic home/inter-feature separation;
  and
- normal interaction and visible-candidate work remains spatially bounded and
  never turns a small seam query into a total-world scan.

### GP-6.5 — Continuous camera and chunk-bounded presentation

Present the periodic world as continuous while keeping simulation ownership
canonical and renderer resources bounded.

Tasks:

1. Introduce a scene-owned lifted view anchor that maps canonical simulation
   poses to their nearest periodic image. It consumes the accepted lifted
   displacement/wrap offset exposed by `GameSimulation` in `GP-6.2`; it does
   not infer direction from canonical endpoints. Remove the gameplay camera's
   hard world bounds and rebase lifted coordinates by whole spans when needed.
2. Interpolate the ship and camera along the short lifted movement segment.
   Wrapping must not lerp across the full canonical map or restart ship/wake
   animation or sailing ambience.
3. Extend the existing viewport-to-`ActiveChunkSet` path to request periodic
   image entries. Each entry identifies a canonical chunk plus an image offset;
   the scene does not add a second activation policy.
4. Keep revisions, dirty state, texture ownership, feature state, and read-model
   queries canonical. Multiple visible images may reference one logical chunk
   or entity without duplicating authority or events.
5. Keep one base and one surface canvas texture per active **canonical** water
   chunk. Periodic water image aliases share those textures; each visible
   canonical surface redraws at most once per frame, prefetched surfaces remain
   static, and aliases do not multiply animation work. Apply the same image
   contract to the home-shore overlay, terrain, knowledge and risk masks,
   Voyage Sense, clouds and shadows, fishing, survey and wreck markers, debug
   bounds, prompts, pointer conversion, and developer tools.
6. Activate authored home/imported-island art by periodic footprint
   intersection, not only the canonical centre/owner chunk. Give each visible
   image a view identity while retaining one descriptor, one state record, and
   canonical texture ownership; adapt one-view-per-record pools where needed.
7. Rebase or resize `WorldRenderer`'s deferred-gap ocean backdrop so unmet
   periodic chunk demand cannot reveal a blank outside its former finite
   rectangle.
8. Split route and contour geometry into short image-local pieces. Fog padding,
   coastline neighbours, cloud footprints, and picking sample canonical wrapped
   tiles instead of treating an image boundary as outside the world.

Exit gate:

- sailing through all four seams and all four corner directions at minimum,
  default, and maximum zoom shows no stop, camera snap, blank strip, false fog
  wall, false coastline, long cross-map route, or missing/duplicated marker;
- reverse movement immediately after wrapping remains visually and
  authoritatively continuous;
- authored art and collision stay aligned when their footprint or nearest image
  crosses one or two seams, including when the canonical centre/owner chunk is
  outside the viewport;
- pointer and developer interactions target the canonical entity shown under
  the nearest image;
- activation/deactivation, scene restart, regeneration, and cloud enable/
  frequency changes leak no aliases or textures;
- a focused `WaterRenderer` contract verifies two canonical texture planes per
  active canonical chunk, shared offset sprites, visible-only single redraw,
  static prefetch, reduced motion, phase continuity, partial chunks, home-shore
  alias lifetime, and stable teardown;
- the rebased deferred-gap ocean backdrop covers all visible unmet demand; and
- active presentation image entries retain the hard `25`-chunk cap and existing
  deterministic placeholder behaviour when visible demand exceeds it, while
  canonical water texture counts and redraw work pass the numeric limits
  approved in `GP-6.1`.

### GP-6.6 — Circumnavigation integration, performance, and closeout

Close the track only after the complete game, not isolated seam fixtures, is
equivalent and stable.

Tasks:

1. Add deterministic full-lap journeys in every cardinal direction and
   diagonal corner-crossing journeys through `GameSimulation`.
2. Exercise discovery, survey, exact-dock return, wreck/rollback, succession,
   completion, regeneration, and Start New Game with seam crossings in the
   journey.
3. Compare fixed-step partitions and replay/regeneration outputs for identical
   canonical state, provisions, knowledge, feature records, route results,
   events, and diagnostics.
4. Run named-profile generation, navigation, forward-guidance, spatial-index,
   active-presentation, and repeated-wrap performance coverage against the
   `GP-6.1` baselines.
5. Perform browser acceptance across every seam and corner with representative
   zoom, resize, reverse, modal, audio-enabled, and developer-tool states, plus
   Water workspace fit/1:1/overlay/pause and seam inspection.
6. Remove finite-edge clamps, synthetic gameplay boundary blockers, obsolete
   edge facts, transition-only adapters, temporary diagnostics, and any partial
   dual path.
7. Audit that every earlier gate updated its owning current-state documents in
   the same coherent change. Run a repository-wide Markdown consistency pass,
   including the topology-affected contracts in the technical design,
   architecture map, and `Wayfinders_Water_System_Milestone.md`; record final
   volatile verification in `IMPLEMENTATION_STATUS.md`, then archive only the
   completed milestone outcome and evidence.

Exit gate:

- all focused topology, world, navigation, exploration, feature, core, and
  rendering contracts pass;
- source and test typechecks, architecture checks, quick, contract,
  integration, repository I/O, production build, and relevant browser
  acceptance pass;
- serial performance coverage preserves the current `P0`/`P1` authoritative
  tile-entry p95 below `4 ms`, the `P2` forward slice p95 below `4 ms` and p95
  drain within `24` slices, deterministic placement bounds, bounded spatial
  candidates, and the `25` active-chunk cap, and passes every numeric generation,
  seam-query, water-redraw, repeated-wrap, frame, and resource limit approved
  in `GP-6.1`;
- normal sailing and repeated laps add no work proportional to total world or
  island count and reach a stable presentation-resource plateau; and
- repository-wide searches find no remaining game-world rule that treats
  coordinate zero or the last row/column as a hard boundary, except the named
  bounded asset contexts.

## Dependency and authorization order

```mermaid
flowchart LR
    B["Current bounded gameplay world"] --> G61["GP-6.1 topology contract"]
    G61 --> G62["GP-6.2 movement and navigation"]
    G62 --> G63["GP-6.3 generation and spatial world"]
    G63 --> G64["GP-6.4 gameplay integration"]
    G64 --> G65["GP-6.5 continuous presentation"]
    G65 --> G66["GP-6.6 acceptance and closeout"]
```

The six gates form one coordinated topology conversion. They should be
authorized as an ordered batch and integrated dependency-first; an intermediate
gate is not a separately supported finite/toroidal gameplay mode. `GP-6.1`
through `GP-6.5` are acceptance checkpoints on one integration branch, not
individually landing releases: that branch may compose the periodic generator
at `GP-6.3`, but the gameplay baseline is not merged or declared supported until
the gameplay and presentation gates through `GP-6.5` pass. No feature flag or
long-lived dual production path is retained. Production water is already
implemented through `WTR-2.6`, so its layout, transition, active-chunk rendering,
animation, and resource contracts are required `GP-6` consumers rather than
deferred work or a new water milestone.

## Test assignment

- Put small topology, collision-edge, graph-edge, and active-chunk contracts in
  the quick lane when they protect the shared high-frequency seam.
- Put ordinary generation, visibility, knowledge, spatial-index, feature, and
  generated-water and renderer-adapter fixtures in the contract lane.
- Put full-lap `GameSimulation` journeys and cross-feature settlement/wreck
  scenarios in the integration lane.
- Keep seed/density sweeps, timing distributions, candidate bounds, resource
  plateaus, and soaks in the serial performance lane.
- Keep live camera, zoom, input, audible-loop continuity, and visual seam review
  in browser acceptance rather than the default automated lanes.

Tiny tests must choose topology deliberately. A one-row or one-column fixture
that is testing provisions or a feature rule should not accidentally gain new
graph connectivity unless the test is specifically exercising the periodic
contract.

## Risks and mitigations

| Risk | Required mitigation |
| --- | --- |
| A canonical wrap looks like a full-map jump | retain the lifted physical segment for interpolation, camera follow, provisions, visibility, and route presentation |
| Split queries duplicate state or events | deduplicate by canonical tile/entity ID before exact filtering and mutation; retain stable tie ordering |
| An island is cropped or collides with itself at a seam | use one local footprint with periodic raster pieces and canonical write deduplication; reject footprints at least one world span wide/high |
| Edge removal creates false coastlines or disconnected validation | derive analysis and generation acceptance from periodic neighbours and exact graph connectivity |
| Tiny dimensions create self-loops or collapse distinct edges | exclude width-one graph self-traversal, preserve direction-tagged width-two edges, and deduplicate only canonical query/mutation results |
| Visual aliases multiply resources | keep logical ownership canonical, count image entries against the one active-set cap, and destroy aliases on the existing delta |
| Production water changes region intent or multiplies redraws | preserve explicit ribbon lift/winding and canonical layout chunks in `GP-6.3`; share each canonical chunk's two textures across `WaterRenderer` image aliases in `GP-6.5` |
| Centre-owned authored art disappears near a seam | activate image views by periodic footprint intersection while retaining one canonical descriptor and texture owner |

## Out of scope

`GP-6` does not add:

- a spherical projection, poles, latitude-dependent distance, curved horizon,
  globe renderer, or 3D world;
- an infinite or streaming procedural world;
- a new world size, tile size, chunk size, island count, sight radius, hull,
  travel cost, provision rule, or expedition rule;
- authoritative ocean-current gameplay, weather, new water art/profiles, or
  other new terrain/gameplay meaning;
- gameplay saving, manifest migration for saved sessions, or a finite-world
  compatibility mode; or
- toroidal behaviour in asset authoring canvases, collision validation, or the
  isolated sea trial.

## Definition of done

`GP-6` is complete only when:

1. generated gameplay identity explicitly selects two-axis wrapping and all
   authoritative coordinates remain canonical;
2. movement, collision, graph traversal, sight, knowledge, costs, routes,
   generation, analysis, spatial queries, features, and lifecycle rules agree
   on the same periodic topology;
3. seam-crossing content retains one stable logical identity and exact
   collision/interaction behaviour;
4. camera and every world-space presentation layer use the nearest periodic
   image without visual discontinuity or duplicate authority;
5. deterministic full-lap and corner journeys, named-profile budgets, resource
   bounds, full automated verification, and browser acceptance pass; and
6. current-state docs are updated with each implemented gate, and archived
   completion evidence is added only after the full acceptance result exists.
