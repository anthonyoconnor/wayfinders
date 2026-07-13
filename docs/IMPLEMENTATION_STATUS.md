# Wayfinders implementation status

This file is the continuation point for prototype work. The project is intentionally paused after Milestone 3.1 for the revised review gate in `Wayfinders_Prototype_Milestones.md`.

## Milestone 0 — Developer Sandbox

Status: complete

- Browser application scaffold: Phaser 3.90, TypeScript, Vite and Vitest.
- Deterministic seeded world generation and a live, mutable prototype configuration.
- Developer tools for water-tile teleportation by coordinate or click.
- Runtime provision add/remove controls.
- Live controls for sight, provisions, movement costs, speed, risk thresholds, overlay opacity and fog presentation.
- Toggles for navigation grid, line of sight, forward range and return viability.
- Regeneration from the currently entered seed without a restart.
- Browser automation surface exposed as `window.__WAYFINDERS__`.

Verification: TypeScript check, 20 unit tests and a production Vite build pass.

## Milestone 1 — Home Waters

Status: complete

- Recognisable seeded home island with coastline, huts, harbour flag, dock and labelled home.
- Visually distinct Supported water surrounding the home. The fog edge alone
  communicates its boundary; no decorative boundary buoys or marker dots are rendered.
- Continuous WASD/arrow-key ship movement with a readable heading and wake.
- Terrain-authoritative island, rock and reef collision.
- Smooth follow camera with wheel or Q/E zoom and bounded world view.
- Developer-art ocean, shallow water, reefs and wave marks.
- DOM state markers on the game host for browser-driven verification.

Verification: TypeScript check, 21 unit tests, production build and an in-browser sailing/control check pass.

## Milestone 2 — Exploration

Status: complete

- Circular, blocker-aware current line of sight using the live configured radius.
- Unknown cells behind the moving ship become expedition-stamped Personal knowledge; visible water at and ahead of the ship remains Unknown until it falls behind.
- Every crossed navigation-tile centre is observed, preventing gaps during fast or diagonal movement.
- Near-black Unknown fog, grey Personal water and full-colour current visibility.
- Bilinear, noise-softened transitions rendered from reusable chunk-updated mask data.
- Debug sight-ring toggle is tied to the same radius used by the simulation.
- Browser-readable knowledge/visibility counts for deterministic play checks.

Verification: TypeScript check, 23 unit tests, production build, and an in-browser voyage from Supported into Unknown water pass. The browser voyage produced 166 Personal tiles while current sight remained bounded to 81 tiles.

## Milestone 3 — Risk, Return and Inheritance

Status: complete — stop here for user playtesting

- Physical, countable provision bundles in an on-board cargo rack; no visible numerical resource bar.
- Distance-based charging captured before the corresponding observation update.
- Configured Supported / Personal / Unknown costs of 0 / 0.5 / 1 bundle-units per tile.
- Cost-limited forward Dijkstra with a thin presentation frontier containing
  only reachable Unknown cells in the outermost Unknown-cost band at the true
  maximum-reach limit and inside a 120-degree heading cone.
- Targeted multi-source return Dijkstra reconstructing one minimum-cost route
  from the ship to the first Supported water.
- Reusable chunk-sized WebGL forward and return textures with dotted, diagonal and crosshatched accessibility treatments.
- World legend uses words and patterns without exposing resource arithmetic.
- Return risk uses one state across the route and its one-tile passable
  Personal/current-sight padding; unrelated Personal branches remain grey.
- The default configuration generates eight non-home islands with stable IDs and descriptors.
- High Island, Low Cay, Atoll and Rocky Skerry kinds are represented across small, medium and large sizes.
- Placement uses separate deterministic namespaces for descriptor profile, placement, shape and terrain.
- Configured minimum channels, home exclusion and world margins keep islands separated from home and one another.
- A fully clear eastbound corridor remains open from the home dock, and a passable-water flood validates access from the dock to all four world edges.
- Atolls receive a deterministic cardinal channel, and lagoon centres must pass the same open-ocean reachability check.
- Unknown fog interiors are fully opaque so island terrain and decoration cannot silhouette before reveal.
- Island kinds use distinct generated developer-art palettes and terrain marks only.
- Milestone 3 islands carry no names, rewards, settlements, resource records or generic discovery records.
- Developer tools provide **Inspect next island**, which cycles stable descriptor order and teleports to a passable inspection point.
- An expedition starts when the ship leaves Supported water and remains active when crossing Supported water away from home.
- Successful return resolves only on entering the exact generated home dock.
- Successful return converts only Personal tiles stamped for the current expedition to Supported, clears those stamps, replenishes configured starting bundles, clears fractional provision use and keeps the same generation.
- After a successful commit, one knowledge-only pass fills fully
  Supported-bounded, non-edge, 8-connected Unknown pockets of at most
  `world.maxEnclosedUnknownTiles` tiles (two by default; zero disables it).
  Wreck/revert never runs this cleanup.
- Entering the exact dock without an active expedition also replenishes supplies without changing expedition or generation state.
- Natural supply exhaustion outside Supported water begins an immediate wreck transition; exact-dock return takes precedence if both occur on the same movement step.
- Wreck onset reverts only failed-expedition Personal knowledge, preserves earlier Supported routes, records and displays the wreck at the loss location, freezes input and holds the old generation there for four seconds.
- Wreck completion then clears the loss-site visibility, respawns a fully supplied ship at the dock and advances the generation exactly once.
- Successful returns never advance the generation.
- Supported routes, wreck records and generation state persist through later expeditions and wrecks in the current generated runtime.
- Regeneration or browser reload resets runtime routes, wrecks and generation; save/load and cross-session persistence remain Milestone 4.

Verification: the full `npm.cmd run check` pipeline passes TypeScript, 66
automated tests across eight files and the production Vite build; the
dependency audit reports zero vulnerabilities. Automated
island checks cover same-seed descriptor and terrain equality, different-seed
variation, the default eight-island/four-kind/three-size inventory, painted
footprint bounds, margins, home clearance, eleven-tile channels, the eastbound
safe lane, authoritative collision and sight flags, hidden-terrain range
privacy, navigable atoll lagoons, representative regression seeds and explicit
validation failure for impossible placement envelopes.
The generator's four-edge flood validation runs for every generated world.
Automated wreck checks cover the 3.999/4.000-second boundary, old-generation
authority during the hold, input and developer-control suppression, event
order, exactly-once advancement, large-delta overshoot, regeneration
cancellation and fixed-step buffer clearing.

In-app browser playtesting confirmed fully concealed islands at the default
dock, all four distinct developer-art kinds through **Inspect next island**,
the `8 / 4 / 3` island/kind/size inventory for seeds 13371 and 13372, a changed
scatter for the alternate seed, restoration of seed 13371 at the dock, and no
browser console warnings or errors. The earlier exact-dock return, route
conversion, replenishment, wreck rollback, respawn and wreck-discovery voyage
also remains covered by the automated suite. A new forced-wreck browser check
confirmed a visible generation-one wreck and countdown at the loss site with
zero cargo and suppressed input; after four seconds the same diagnostics
switched atomically to generation two, the exact dock, twelve bundles and no
pending wreck. The camera centred on the replacement ship and the browser
console remained clean.

## Milestone 3 review result — 2026-07-12

Build reviewed: commit `4454a40` in the local WebGL development build, using
the default configuration and seeds 13371 and 13372.

Desktop browser acceptance result: **Passed**.

- Seed 13371 reported eight islands, four kinds and three size bands. Cycling
  **Inspect next island** visited all eight from passable inspection points and
  included Rocky Skerry, High Island, Atoll and Low Cay descriptors. Repeating
  seed 13371 produced the same ordered inspection results; seed 13372 produced
  a different repeatable scatter while retaining the `8 / 4 / 3` inventory.
- Opaque Unknown fog concealed terrain outside current sight. Revealed island
  terrain, the physical cargo rack and the patterned voyage overlays were all
  visibly present with distinct developer-art treatments.
- A browser-driven expedition created 79 Personal tiles. Entering Supported
  water away from home left the expedition active and did not replenish the
  ship. Entering the exact dock converted those 79 tiles to Supported, restored
  cargo from eleven to twelve bundles, recorded one successful return and kept
  generation one.
- With no active expedition, leaving the dock in Supported water with eleven
  bundles and re-entering the exact dock restored twelve bundles without
  changing expedition, return or generation state.
- A forced wreck at tile `4,4` immediately changed 79 failed Personal tiles
  back to Unknown, preserved all 662 pre-existing Supported tiles, showed one
  wreck,
  set cargo to zero and suppressed input while generation one remained at the
  loss site. Completion produced a fully supplied generation-two ship at the
  exact dock with one retained wreck and no pending transition.
- Revisiting `4,4` in generation two emitted `Found wreck 1 from generation 1`.
  Regeneration then reset the build to generation one, expedition one, zero
  returns, zero failures, zero wrecks, zero Personal tiles and twelve bundles
  at the dock.
- The browser console contained no warnings or errors. Natural movement,
  natural final-bundle exhaustion, exact-dock precedence and fixed-step timing
  remain covered by the automated suite.

Engineering disposition: **ready for human playtest**. No objective blocker was
found in the default desktop-browser configuration. This result does not
validate the technical design's mobile performance target and does not assert
that sailing is enjoyable, that the overlays are intuitively clear, or that
wreck pacing and repeated expeditions feel satisfying to a player.

Human playtest status: the performance rework was accepted as noticeably
better. The next playtest reported that map-wide coloured risk blocks were
confusing and requested the Milestone 3.1 overlay rework recorded below.
Product-owner gate decision: **pending**.
Do not start production art or roadmap Milestones 4–5 until the tester repeats
the playtest on the remediated build and the product owner records **Proceed**
or another **Rework** decision here.

## Milestone 3 performance remediation — 2026-07-12

Status: **complete — ready for repeat human playtesting**.

The first human playtest reported that the ship became sluggish after the
scattered islands were added. The cause was cumulative world-wide work in the
render, overlay, diagnostics and search paths rather than the configured ship
speed. The remediation keeps normal sailing local or sparse:

- static world art is split into camera-culled chunk graphics over one ocean
  rectangle;
- knowledge, forward-range and return-risk masks use reusable chunk textures
  with sparse dirty-chunk uploads and cross-chunk edge invalidation;
- snapshots and browser diagnostics read maintained counts instead of scanning
  the map and DOM writes are throttled to meaningful revisions or 10 Hz;
- visibility clears only the previous sight set, expedition return/wreck
  resolves only the owning expedition's indices, and return boundaries derive
  from Personal-water neighbours;
- Dijkstra reuses cost, parent, visited, settled-node and numeric heap buffers,
  then post-processes sparse forward candidates or one reconstructed return
  corridor;
- provision-only range/risk changes update cached cost groups or the existing
  corridor without a new path search;
- supported-water painting and island flood validation are bounded or
  early-exiting generation-only work.

Doubling both dimensions from `96 x 96` to `192 x 192` quadruples logical tiles
from 9,216 to 36,864. A warmed deterministic simulation probe produced these
conservative timings (the slower observation from two final runs is shown):

| Probe | Before, 96 x 96 | Final, 96 x 96 | Before, 192 x 192 | Final, 192 x 192 |
| --- | ---: | ---: | ---: | ---: |
| Moving fixed update, mean | 4.745 ms | 0.162 ms | 18.384 ms | 0.157 ms |
| Moving fixed update, p95 | 11.417 ms | 1.577 ms | 39.854 ms | 1.643 ms |
| Snapshot, median | 7.55 ms | 0.0045 ms | 35.69 ms | 0.0009 ms |
| Developer teleport, median | 11.63 ms | 1.519 ms | 44.32 ms | 1.340 ms |

The final fixed-update p95 is well below the 16.67 ms render-frame interval at
both sizes. Generation remains intentionally area-scaled and off the movement
loop. Browser checks loaded both sizes, teleported into far chunks, exercised
range changes, showed continuous fog/overlay rendering, preserved the
four-second wreck transition and reported no console warnings or errors.
These desktop and local-simulation results do **not** replace the outstanding
mid-range mobile-device validation.

Final verification on this workstation:

- TypeScript typecheck: 2.9 seconds wall time;
- system/unit tests: 77/77 across nine files, 2.00 seconds reported by Vitest
  in the clean pipeline (4.1 seconds standalone command wall time);
- production build: 11.7 seconds command wall time, including 8.45 seconds in
  Vite;
- complete sequential `npm.cmd run check` pipeline: 18.1 seconds wall time;
- active browser validation: approximately 65 seconds across default and
  doubled dimensions, far-chunk/overlay checks and the four-second wreck hold.

The browser check is an in-app functional smoke pass rather than a separately
installed browser-test runner. Its console contained no warnings or errors.

Critical decision: no Web Worker was added. Sparse main-thread work is now
inside the current budget, while a worker would add state-transfer and
determinism complexity without evidence that it is needed. Milestone 3.1
overlay playtesting is the next action; Milestones 4–5 remain out of scope.

## Milestone 3.1 overlay readability rework — 2026-07-12

Status: **complete — ready for user playtesting**.

The second human playtest found the broad return-risk field confusing because
yellow, orange and red blocks covered much of the explored play area. The
revised presentation separates calculation from display:

- the complete forward-reach calculation remains available to simulation and
  diagnostics, while presentation contains only reachable Unknown cells in
  the outermost Unknown-cost band `(budget - unknownCost, budget]`;
- the resulting thin frontier is at the true maximum-reach limit immediately
  and normally remains anchored to the same world cells while equal-cost
  Unknown travel reduces path cost and provisions together;
- the visible frontier is clipped to a heading-centred cone with a default
  60-degree half-angle. Turning rotates the visible arc by reclipping the
  sparse terminal band without rerunning Dijkstra;
- only pale segmented outward contour edges are drawn. Frontier tiles have no
  filled overlay, and the cone ends do not receive artificial radial walls;
- return search accepts passable current-sight water as the connection from
  the ship to its Personal trail, stops when the ship's minimum cost is final
  and reconstructs one route to the first Supported boundary;
- a cardinal breadth-first expansion adds one configurable passable tile of
  padding around that route without crossing blocked terrain, unseen Unknown
  water or Supported water;
- every route and padding tile receives the same ship-level state: pale or
  strong yellow, orange, or red. Unrelated Personal branches keep only their
  normal grey knowledge treatment;
- return calculation remains continuous through current sight, but current
  sight suppresses Personal-grey, forward and return-risk presentation so
  visible tiles use the same unmodified world rendering as Supported water;
- previous and current sparse forward/corridor candidates are diffed so turns,
  route changes and chunk crossings clear stale pixels.
- after Personal-to-Supported commit, one knowledge-only pass fills an
  8-connected Unknown component only when it is fully Supported-bounded,
  touches no world edge and contains no more than
  `world.maxEnclosedUnknownTiles` tiles (two by default; zero disables it);
- cleanup is seeded from the just-committed route, runs only once after success,
  does not inspect terrain or resources and never runs during wreck/revert.

Developer tools expose **Forward cone half-angle** and **Return route
padding**. Forward depth has no control because its location follows the
provision budget and configured travel costs. Normal play still contains no
numerical route or resource HUD.

Final verification:

- the clean `npm.cmd run check` pipeline passed TypeScript, 104 tests across ten
  files and the production build in 34.7 seconds wall time;
- Vitest reported 4.39 seconds for the full suite and Vite built in 15.47
  seconds. The existing Phaser bundle-size advisory remains informational;
- the eight focused cleanup tests cover one/two-tile fills, larger and
  diagonal components, world edges, non-Supported boundaries, zero-disable,
  exact indices/counts/stamps and absence of cleanup on revert;
- the forward regression keeps the frontier on the same world tile while the
  ship advances through three equal-cost Unknown positions and spends the
  matching provisions; incremental masks also match fresh calculations;
- cone regressions confirm the default 60-degree half-angle excludes side and
  opposite arcs, turning rotates presentation without changing cached logical
  masks/costs, presentation-only range expansion still invalidates stale
  pixels, and 1/60/180-degree configuration bounds are enforced;
- renderer regressions confirm thin-only pixels, outward-edge selection, no
  cone-end walls, globally continuous chunk-seam phase, sparse seam
  invalidation, skipped logical scans during heading-only changes and
  current-sight suppression;
- browser seed 13371 rendered a thin maximum-range frontier and a 16-tile
  logical padded return corridor around a six-tile minimum-cost route. Its
  logical state became impossible when provisions fell below the 2.5-bundle
  return cost, while the currently visible part remained untinted;
- reducing the budget below the cost of reaching Unknown water cleared the
  previous frontier without stale pixels. A successful dock return committed
  90 Personal tiles, ran the cleanup pass, cleared the return corridor and
  replenished all 12 bundles;
- the final cone browser check showed 18 presented terminal cells at a
  30-degree half-angle, 33 at the default 60 degrees and 130 at 180 degrees.
  The segmented arc rotated with the ship and kept transparent tile interiors;
- current-sight browser verification kept all 81 visible tiles in unmodified
  world colour while the logical return state was impossible/red. Focused tests
  confirm return tint restores after sight moves and visible Unknown water
  still charges full Unknown cost;
- the final browser console contained no warnings or errors.

Milestone 3.1 now returns to human playtesting at the existing review gate.

### Reusable Milestone 3 regression checks

For every candidate build at this gate:

1. Run `npm.cmd run check` and record the passing test/file counts and build result.
2. Confirm seed 13371 reports `8 / 4 / 3`, same-seed regeneration is identical,
   an alternate seed changes the scatter and the intended seed restores cleanly.
3. Confirm an expedition remains active in remote Supported water, then verify
   only exact-dock return converts its Personal route, replenishes cargo and
   preserves the generation.
4. Confirm exact-dock entry without an active expedition replenishes cargo
   without changing expedition, return or generation state.
5. Confirm wreck onset rolls back only failed Personal knowledge, preserves
   earlier Supported routes, shows one loss-site marker and suppresses input for
   four seconds; completion must advance once and supply the exact-dock ship.
6. Confirm a later generation can discover the wreck and regeneration resets
   routes, wrecks, counters and generation.
7. Confirm the browser console remains free of warnings and errors.
8. Confirm return colours occupy only one padded minimum-cost route, change as
   a single state with cargo, and clear stale pixels. Confirm forward
   presentation contains only the outermost reachable Unknown-cost band, sits
   at the true maximum range and normally remains world-anchored during
   equal-cost Unknown travel. Confirm it is clipped to the configured cone
   ahead of the ship and rendered as a thin segmented outward contour.
9. Confirm a successful commit fills only non-edge, fully Supported-bounded,
   8-connected Unknown pockets no larger than
   `world.maxEnclosedUnknownTiles`; confirm zero disables cleanup and
   wreck/revert never fills a pocket.
10. Confirm current sight suppresses Personal-grey and forward/return risk
    overlays, then confirm the underlying Unknown/Personal travel cost and
    knowledge state are unchanged and presentation returns after sight moves.

Development is intentionally paused at the revised Milestone 3 review gate.
Generic discoveries, save/load, cross-session persistence and Milestone 5
living-world work have not been started.

## Decisions to review at Milestone 3

1. **Reuse boundary.** The older Ship Game Prototype was used as an architectural and version reference only. Its click-to-sail polygon navigation and production presentation were not copied because Wayfinders requires a WASD square-grid prototype and developer art.
2. **Teleport safety.** “Any tile” is implemented as any navigable water tile. Land, reef and rock remain blocked so teleporting cannot leave the simulation in an invalid state.
3. **Developer UI.** Numerical tuning is confined to the developer drawer. It is not part of the normal play presentation and therefore does not undermine the Milestone 3 no-numerical-player-UI test.
4. **Live starting provisions.** Changing “starting bundles” also changes the current sandbox cargo immediately. This makes the tuning control observable without requiring regeneration.
5. **Milestone 0 overlays.** Before their final Milestone 3 grid calculations are connected, the forward and return toggles display provisional range rings. They are development hooks, not the final risk presentation.
6. **Home presentation.** The home, dock, vessel and ocean are drawn with generated Phaser vector shapes. This deliberately follows the developer-art restriction and avoids committing to production silhouettes or an isometric projection before the exploration loop is reviewed.
7. **Camera input.** Wheel and Q/E share a clamped zoom range; the camera always follows the authoritative ship position. Free camera panning was omitted because it made it easier to lose the ship without helping the Milestone 0–3 loop.
8. **Visibility shape.** Line of sight is a Euclidean circle on the square grid. Land and rock block cells behind them but remain visible themselves. This matches the five-tile technical radius while giving the exploration trail a broader, softer silhouette than a Manhattan diamond.
9. **Teleport knowledge.** Developer teleport reveals only the destination sight disc; it does not create a false Personal corridor between origin and destination.
10. **Fog masks.** Each chunk owns one reusable, padded low-resolution mask texture that Phaser samples bilinearly. Changed chunks invalidate neighbouring padding, and adjacent quads overlap by one world pixel to prevent camera-scale seams. This keeps texture dimensions independent of world size; a custom production shader remains unnecessary for developer art at this review gate.
11. **Expedition ownership.** Normal movement starts an expedition on leaving Supported water. Only Personal tiles carrying that expedition's ID can be committed or reverted, and resolution clears those stamps to zero. Crossing Supported water away from home does not resolve the expedition.
12. **Provision budget correction.** The technical document prints `bundles + (1 - accumulator)` for overlay reach, which grants a nonexistent extra bundle when the accumulator is zero. The implementation uses `bundles - accumulator`, so physical cargo and overlay distance agree exactly. Tests lock this decision.
13. **Wreck consequence.** Natural travel consumption crossing from a positive bundle count to zero outside Supported water begins one immediate wreck transition. The failed stamped Personal route returns to Unknown, earlier Supported routes survive and a wreck record is left at the loss position. Direct developer provision removal does not itself trigger a wreck.
14. **Physical cargo presentation.** Each bundle is a countable crate in a screen-space “Provisions Aboard” rack, following the supplied overlay concept. A hidden live text equivalent exists for accessibility; normal visual play has no number.
15. **Risk accessibility.** Milestone 3.1 uses a pale-yellow unpatterned
    comfortable route, stronger yellow with sparse diagonals for warning,
    orange with denser diagonals for critical and red crosshatch for impossible.
    Only one padded minimum-cost route receives those colours.
16. **Unknown-terrain privacy.** Forward search treats still-Unknown blockers as ordinary Unknown water. Once observed, actual terrain and collision apply. The overlay therefore cannot reveal hidden islands or reefs.
17. **Exact-dock resolution and replenishment.** Only entering the generated home dock successfully returns an active expedition. It converts matching stamped Personal water to Supported, clears stamps and fractional provision use, restores configured starting bundles and keeps the same generation. Entering the dock without an active expedition also replenishes. If the final bundle is consumed on the docking step, success takes precedence over wreck.
18. **Dependency advisory.** Runtime dependencies audit clean. Vitest was patched from 3.2.4 to 3.2.7 to remove a development-server advisory before handoff.
19. **Outward/return asymmetry.** The supplied concept requires the current forward range to cost full bundles and the trail home to cost half. Current sight therefore reveals terrain visually, while broad perpendicular strips centred on navigation tiles the ship has actually left commit passable water to Personal knowledge. The occupied and forward water remains Unknown while advancing, making an outward leg cost twice its Personal retrace without turns pre-charting untouched sea. Visible blocking landmarks are remembered immediately because they cannot discount travel. Stationary developer teleport still reveals its full sight disc for inspection. This intentionally refines the technical document's broader visible-to-Personal rule to preserve its own full-cost-out/half-cost-back requirement.
20. **Runtime persistence boundary.** Successful routes, wreck records and generation state persist through later voyages and wrecks in the current generated runtime. Regeneration or browser reload resets them. Save/load and cross-session persistence remain Milestone 4 features.
21. **Generation model.** Expedition ID and generation are separate. Every resolved expedition advances its expedition ID, but only wreck advances the generation. A successful return replenishes the current navigator and allows the same generation to sail again.
22. **Wreck discovery boundary.** A runtime wreck is an immutable marker hidden by Unknown fog until a later generation sees it. Once discovered, the marker remains identified for later runtime voyages even when it leaves current sight or a later expedition fails; discovering it does not restore failed knowledge. Generic discovery types, returned-discovery progression and cross-session discovery persistence remain Milestone 4.
23. **Island scope boundary.** The eight default non-home islands are Milestone 3 base terrain and navigation content, not generic discoveries. High Island, Low Cay, Atoll and Rocky Skerry kinds and their size bands affect descriptor shape, terrain composition, collision, sight blocking and developer-art presentation only. Names, rewards, settlements, resources and `DiscoveryRecord` state remain Milestone 4.
24. **Deterministic island identity.** A seed and configuration produce stable descriptor IDs, kinds, sizes, centres, radii, rotations, shape seeds and bounds. Profile, placement, shape and terrain sampling use separate deterministic namespaces, allowing later discovery systems to use another namespace without moving or repainting the reviewed island world.
25. **Placement and navigability.** The default generator places eight islands using configured home clearance, six-tile world margins, eleven-tile minimum channels and bounded placement attempts with deterministic fallback. A two-tile half-width eastbound corridor remains completely clear from the home dock; atolls receive a cardinally connected lagoon passage; and a final flood check requires passable water from the dock to reach all four world edges and every atoll centre.
26. **Island presentation and concealment.** Each kind uses a distinct generated developer-art palette and minimal terrain marks. Unknown interiors remain fully opaque so island silhouettes cannot leak before reveal. This is functional exploration content, not production island art or Milestone 4 environmental polish.
27. **Wreck-transition pacing.** Wreck onset and route rollback occur immediately, but generation advancement and dock respawn wait for four simulation seconds. During the hold, current sight remains frozen on a visible wreck marker, the camera stays at the loss site, movement, teleport, cargo editing, live gameplay tuning and repeated forced wrecks are suppressed, and the old generation remains authoritative. Explicit world regeneration remains available as a deterministic cancellation/reset. Completion atomically clears loss-site visibility, advances generation and expedition ID once, creates the fully supplied dock ship, recalculates overlays and discards held-input overshoot.
28. **Performance scaling.** Normal sailing is kept independent of total world area wherever practical: camera-culled static chunk graphics replace world-wide render command submission; fog and risk uploads are chunk-local; visibility, knowledge, expedition and diagnostic counts use sparse indices or counters; and path searches reuse typed buffers and process settled/known candidates. Doubling both dimensions quadruples generation data, so generation remains area-scaled and off the movement loop. A Web Worker was not added because the optimized `192 x 192` simulation remains within the frame budget; mobile-device validation is still outstanding.
29. **Milestone 3.1 route semantics.** "Shortest" means minimum configured
    provision cost, not fewest geometric tiles. The route begins at the ship,
    may use passable Unknown cells only while they are in current sight, and
    ends at the first Supported tile. Supported water itself is not coloured.
    With no connected known/currently-visible route, no false corridor is
    drawn; the diagnostic state remains impossible.
30. **Milestone 3.1 frontier semantics.** Full forward reach remains the
    logical result, but presentation includes only reachable Unknown cells in
    the outermost Unknown-cost band `(budget - unknownCost, budget]`. Unknown
    cost must be positive because free Unknown travel has no finite provision
    frontier. This is the actual maximum-reach limit immediately and normally
    stays world-anchored while equal-cost Unknown movement spends provisions.
    The former forward-focus setting and developer control were removed.
    Return padding remains one configurable cardinal step so it cannot jump
    across blockers.
31. **Successful-return pocket cleanup.** Cleanup runs once, after matching
    Personal tiles commit to Supported, and is seeded only from that committed
    route. It considers knowledge topology only: an 8-connected Unknown
    component must be fully bounded by Supported knowledge, must not touch a
    world edge and must contain at most `world.maxEnclosedUnknownTiles` tiles
    (two by default; zero disables cleanup). Filled tiles become Supported with
    no expedition stamp. Terrain, collision, resources and hidden island data
    are never inspected, and wreck/revert never invokes the pass.
32. **Heading cone and contour rendering.** The full logical cost result stays
    cached, but only the terminal cost band inside a heading-centred cone is
    presented. The default half-angle is 60 degrees (120 degrees total).
    Turning reclips that sparse band without rerunning Dijkstra; sailing
    straight retains the world-anchored limit. Rendering draws globally phased
    pale segments only on outward edges where adjacent logical reach ends, so
    tiles are not filled, chunk seams remain continuous and cone cut edges do
    not become radial walls.
33. **Current-sight presentation.** Anything currently visible uses the same
    unmodified world rendering as Supported water: Unknown fog, Personal-grey,
    forward contour and return-risk colour are all suppressed. This is visual
    only. The underlying tile remains Unknown or Personal, route calculations
    still cross visible water and movement charges its actual knowledge cost.
    When sight moves away, Personal-grey and any applicable route risk return.
