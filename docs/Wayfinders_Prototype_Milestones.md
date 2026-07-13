# Wayfinders Prototype Milestones

## Purpose

This roadmap breaks the prototype into playable milestones. Each milestone ends with a complete vertical slice that can be played and evaluated before moving on. The objective is to prove the exploration loop first, with additional systems only added once the previous milestone is enjoyable.

## Asset Strategy

For **Milestones 0–4**, use **developer art** only.

Developer art should be functional rather than attractive. Its purpose is to validate mechanics, readability, and game feel before significant time is invested in asset production.

Examples include:

- Simple ocean tiles
- Basic home island
- Placeholder ship
- Simple dock
- Placeholder reefs and rocks
- Simple scattered-island silhouettes, palettes and terrain compositions
- Temporary overlays and effects

Only enough art should be created to clearly communicate the exploration mechanics.

Production-quality assets should **not** be created during these milestones.

Beginning with **Milestone 5**, replace developer art incrementally with
production-quality assets. The project owner explicitly kept Milestone 4 on
functional developer presentation so discovery and persistence behaviour can
be evaluated before the asset pass.

---


This roadmap breaks the prototype into playable milestones. Each
milestone ends with a complete vertical slice that can be played and
evaluated before moving on. The objective is to prove the exploration
loop first, with additional systems only added once the previous
milestone is enjoyable.

------------------------------------------------------------------------

# Milestone 0 --- Developer Sandbox

## Goal

Enable rapid iteration on the exploration mechanics.

## Features

-   Teleport the ship to any tile.
-   Add or remove provision bundles.
-   Toggle:
    -   Navigation grid
    -   Current line of sight
    -   Forward exploration range
    -   Return viability overlay
-   Regenerate the world from the current seed.
-   Live prototype configuration panel for gameplay values.

## Success Criteria

The developer can place the ship anywhere, modify gameplay parameters
while the game is running, and immediately observe the effects without
restarting the game.

------------------------------------------------------------------------

# Milestone 1 --- Home Waters

## Goal

Create a believable home that the player wants to leave and return to.

## Features

-   Home island
-   Harbour and dock
-   Supported water surrounding the home island
-   Ship movement
-   Camera
-   Ocean rendering
-   Island collision

## Success Criteria

The player begins every voyage from a recognisable home island and can
freely sail within supported waters.

------------------------------------------------------------------------

# Milestone 2 --- Exploration

## Goal

Crossing into the unknown feels meaningful.

## Features

-   Fog of war
-   Current line of sight
-   Unknown water
-   Personal knowledge
-   Broad personal exploration corridor
-   Smooth grey transition between known and unknown

## Success Criteria

Leaving supported water naturally creates a broad trail of personal
knowledge while the surrounding unknown remains hidden.

------------------------------------------------------------------------

# Milestone 3 --- Risk, Return and Inheritance

## Goal

Distance creates meaningful decisions, and expedition outcomes determine
what survives into later voyages and generations.

## Features

-   Physical provision bundles
-   Different movement costs for Supported, Personal and Unknown water
-   Forward exploration range overlay
-   Return viability overlay
-   A default of eight deterministic non-home islands with stable IDs and
    descriptors
-   High Island, Low Cay, Atoll and Rocky Skerry island kinds
-   Small, medium and large island sizes
-   Minimum channels, home exclusion, world margins, a fully open eastbound
    corridor and four-edge open-ocean validation
-   Fully opaque Unknown fog which prevents unrevealed islands from
    silhouetting through
-   Functional developer-art presentation only; islands have no names,
    rewards, settlements, resource records or generic discovery records
-   Expedition begins when the ship leaves Supported water
-   Successful expedition return only at the exact home dock
-   Current expedition-stamped Personal knowledge becomes Supported water
    on successful return
-   Consequential, runtime-persistent route creation for later voyages in the
    current generated runtime
-   Provision replenishment to the configured starting bundle count after a
    successful return
-   Provision replenishment when the ship enters the home dock without an
    active expedition
-   Immediate wreck onset when provisions are exhausted outside Supported
    water, followed by a four-second uncontrollable presentation at the loss
    site
-   Failed-expedition Personal knowledge returns to Unknown while previously
    Supported knowledge survives
-   A wreck remains in the world as a discoverable marker for later
    generations
-   After the four-second wreck presentation, a fully provisioned ship
    respawns at the home dock and advances the generation; successful return
    does not advance the generation

## Success Criteria

The player can decide whether to continue exploring or return home using
only information presented in the world, without numerical UI.

Under the default configuration, regenerating the same seed reproduces the
same eight island IDs, kinds, sizes, centres, dimensions, rotations, shape
seeds and bounds. The default set contains all four island kinds and all three
size bands. Island placement preserves configured channels and margins, leaves the complete
eastbound route from the home dock unobstructed, and keeps passable ocean
connected from the dock to all four world edges.

Unrevealed island terrain remains completely hidden behind opaque Unknown fog.
After reveal, island land, rocks and reefs use the normal authoritative
movement- and sight-blocking rules without exposing names, rewards or M4
discovery state.

A successful expedition ends only at the exact home dock. Only Personal
tiles stamped for that expedition become Supported, their stamps are
cleared, provisions are replenished, and the same generation can depart
again along the new route.

Entering the home dock without an active expedition also replenishes the
configured starting bundles without changing expedition or generation state.

Exhausting provisions outside Supported water immediately begins a wreck
transition. The failed expedition's Personal knowledge is lost, earlier
Supported routes remain, and the wreck is shown at the loss site for four
seconds while controls are disabled. Only after that presentation does a fully
provisioned new ship begin at the home dock with the generation advanced by
one. The wreck remains discoverable by a later generation.

Routes, wrecks and generation state persist for the current generated runtime.
Regenerating the world or reloading the browser resets them; cross-session
persistence belongs to Milestone 4.

------------------------------------------------------------------------

# Milestone 3.1 --- Overlay Readability Rework

## Goal

Make the continue-or-return decision readable without covering the explored
play area in competing blocks of risk colour.

## Features

- Preserve the complete provision-aware forward calculation, but present only
  reachable Unknown cells in its outermost Unknown-cost band. For provision
  budget `B` and configured Unknown cost `U`, the displayed frontier is
  `B - U < minimumCost <= B`; `U` must be positive because free Unknown travel
  has no finite provision frontier. This puts the cue at the true maximum reach immediately. While sailing
  through equal-cost Unknown water, spending `U` and moving `U` closer should
  normally leave the same frontier anchored to the world.
- Present only the portion inside a heading-centred cone with a configurable
  60-degree half-angle by default. Turning reclips the terminal band without
  rerunning the full cost search.
- Render pale segmented outward contour edges only: do not fill frontier tiles
  and do not close cone ends with radial walls.
- Identify one deterministic minimum-provision-cost route from the ship to the
  first reachable Supported water tile.
- Present return risk only on that route and a configurable one-tile passable
  corridor on either side.
- Use one risk state for the whole route: yellow-family for a clear/cautionary
  return, orange for a critical return and red when the known route exceeds
  the remaining provision budget.
- Keep unseen Unknown water, blocked terrain, unrelated Personal branches and
  Supported water outside the coloured return corridor.
- Suppress knowledge-grey and all risk overlays inside current sight. Visible
  tiles use unmodified world colour like Supported water, while their actual
  knowledge state and movement cost remain unchanged.
- After a successful Personal-to-Supported commit, run one knowledge-only pass
  that fills fully Supported-bounded, non-edge, 8-connected Unknown pockets no
  larger than `world.maxEnclosedUnknownTiles`. The default maximum is two;
  zero disables cleanup. Do not inspect terrain or resources, and never run
  this pass when a wreck reverts an expedition.
- Expose return-route padding in Developer tools for playtest tuning without
  adding a numerical player HUD.

## Success Criteria

At any point in a connected expedition, the player sees one continuous padded
route from the current-sight boundary toward Supported water rather than colours across the full
Personal region. The route changes colour as one unit when provisions cross a
risk threshold. Forward reach appears as a thin frontier at the true
maximum-reach limit and normally stays world-anchored during equal-cost Unknown
travel. Only the configured forward-heading cone is visible, and its segmented
line has transparent tile interiors. Moving the ship or changing the budget clears obsolete frontier and
route pixels without chunk seams or hidden-terrain disclosure.
Current sight contains no grey or risk tint even where the logical return route
passes through it; leaving sight restores the correct Personal/risk treatment.
Exact-dock success closes only eligible tiny Supported-bounded knowledge pockets; larger,
edge-connected or incompletely bounded Unknown regions remain Unknown, and a
wreck never closes a pocket.

Milestone 3.1 passed its repeat playtest and closes the Milestone 3 review gate.
Milestone 4 is implemented and awaiting its user playtest; Milestone 5 remains
deferred.

------------------------------------------------------------------------

# Milestone 4 --- Discoveries and Persistence

Status: **implemented — ready for user playtesting**.

## Goal

The inheritance loop proven in Milestone 3 survives reloads and gains
meaningful discoveries.

## Features

-   Discoveries
-   Island names, rewards, settlements, resources and returned discovery
    records
-   Save and load
-   Cross-session persistence for Supported routes, wrecks, generation state
    and returned discoveries

## Success Criteria

Reloading a saved game preserves the routes, wrecks, generation state and
returned discoveries created by earlier play, while discoveries provide new
reasons to undertake expeditions.

Implementation note: the build uses deterministic named island discoveries,
developer chart pins and text rewards. Production discovery and island assets
are intentionally deferred to Milestone 5.

------------------------------------------------------------------------

# Milestone 5 --- Living World

## Goal

The growth of knowledge becomes visible.

## Features

-   Fishing boats
-   Trade vessels
-   Traffic along supported routes
-   Environmental polish

## Success Criteria

Supported waters feel active and prosperous, while unexplored waters
remain isolated and mysterious.

------------------------------------------------------------------------

# Prototype Complete

The prototype is considered complete when:

-   Sailing is enjoyable.
-   Exploration into the unknown is satisfying.
-   The player naturally weighs risk versus reward.
-   Returning home permanently expands the known world.
-   The world visibly evolves because of successful expeditions.
-   The complete loop is enjoyable enough to justify building larger
    game systems on top of it.

At this point the project is ready to move on to deeper generational mechanics
such as named navigators, aging, traits and family lines, as well as trading,
settlement growth, reputation, and a living economy.


---

# Prototype Review Gate

At the completion of **Milestone 3 (Risk, Return and Inheritance)**,
development pauses for an explicit project review.

The purpose of this review is to determine whether the complete runtime loop
is compelling enough to justify further investment:

Depart -> explore -> judge risk -> return or wreck -> resolve knowledge ->
show the loss -> replenish or respawn -> continue with the same or next
generation.

## Questions to Answer

- Is sailing enjoyable?
- Does leaving home create anticipation?
- Is exploring into the unknown satisfying?
- Does the player naturally understand when to turn back?
- Do the overlays communicate enough information without requiring numerical UI?
- Does one padded minimum-cost return route read more clearly than a field of
  coloured Personal-water blocks?
- Does the thin maximum-reach frontier make the exploration limit clear
  without dominating the play area, and does it normally stay world-anchored
  during equal-cost Unknown travel?
- Does restricting the segmented line to the forward heading cone remove
  irrelevant opposite-side information without hiding useful choices?
- Does returning home feel rewarding?
- Does converting a returned Personal route to Supported water make the next voyage meaningfully stronger?
- Does successful-return cleanup remove distracting one- or two-tile black
  pockets without filling larger, edge-connected or incompletely bounded
  Unknown regions?
- Does replenishment at the home dock make repeated voyages flow naturally?
- Does the immediate wreck onset and four-second loss presentation feel clear,
  fair and appropriately paced?
- Is it clear that failed Personal knowledge was lost while earlier Supported routes survived?
- Does discovering an earlier generation's wreck reinforce the inheritance theme?
- Is it clear that safe return continues the same generation while only wreck advances it?
- Do the four island kinds and three size bands read clearly in developer art?
- Do scattered islands create interesting route choices without closing the ocean?
- Does opaque Unknown fog prevent island silhouettes or terrain from leaking before reveal?
- Do islands feel worth investigating even though names, rewards and settlements are intentionally deferred?
- Would repeated expeditions remain engaging?

## Decision

A deliberate decision must be made before continuing:

### Proceed

Continue with Milestones 4 and 5, add discoveries and cross-session
persistence, begin replacing developer art with production-quality assets,
and expand the game into a living world.

### Rework

Revise the exploration mechanics, balancing, or presentation, then repeat Milestone 3 until the core loop is proven.

No significant investment in production assets should occur until the project has passed this review gate.
