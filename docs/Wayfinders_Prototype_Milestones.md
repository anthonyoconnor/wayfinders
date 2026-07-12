# Wayfinders Prototype Milestones

## Purpose

This roadmap breaks the prototype into playable milestones. Each milestone ends with a complete vertical slice that can be played and evaluated before moving on. The objective is to prove the exploration loop first, with additional systems only added once the previous milestone is enjoyable.

## Asset Strategy

For **Milestones 0–3**, use **developer art** only.

Developer art should be functional rather than attractive. Its purpose is to validate mechanics, readability, and game feel before significant time is invested in asset production.

Examples include:

- Simple ocean tiles
- Basic home island
- Placeholder ship
- Simple dock
- Placeholder reefs and rocks
- Temporary overlays and effects

Only enough art should be created to clearly communicate the exploration mechanics.

Production-quality assets should **not** be created during these milestones.

Beginning with **Milestone 4**, replace developer art incrementally with production-quality assets only after the exploration loop has been proven.

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

# Milestone 3 --- Risk

## Goal

Distance creates meaningful decisions.

## Features

-   Physical provision bundles
-   Different movement costs for Supported, Personal and Unknown water
-   Forward exploration range overlay
-   Return viability overlay

## Success Criteria

The player can decide whether to continue exploring or return home using
only information presented in the world, without numerical UI.

------------------------------------------------------------------------

# Milestone 4 --- Legacy

## Goal

Returning safely permanently changes the world.

## Features

-   Successful expedition return
-   Personal knowledge becomes Supported water
-   Permanent route creation
-   Discoveries
-   Save and load

## Success Criteria

Every successful expedition permanently expands the known world and
makes future expeditions easier.

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

At this point the project is ready to move on to long-term mechanics
such as generations, trading, settlement growth, reputation, and a
living economy.


---

# Prototype Review Gate

At the completion of **Milestone 3 (Risk)**, development pauses for an explicit project review.

The purpose of this review is to determine whether the core exploration loop is compelling enough to justify further investment.

## Questions to Answer

- Is sailing enjoyable?
- Does leaving home create anticipation?
- Is exploring into the unknown satisfying?
- Does the player naturally understand when to turn back?
- Do the overlays communicate enough information without requiring numerical UI?
- Does returning home feel rewarding?
- Would repeated expeditions remain engaging?

## Decision

A deliberate decision must be made before continuing:

### Proceed

Continue with Milestones 4 and 5, begin replacing developer art with production-quality assets, and expand the game with permanent discoveries and a living world.

### Rework

Revise the exploration mechanics, balancing, or presentation, then repeat Milestone 3 until the core loop is proven.

No significant investment in production assets should occur until the project has passed this review gate.
