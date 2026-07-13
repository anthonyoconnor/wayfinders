# Wayfinders prototype milestones

## Current position

Milestones 0 through 4 are complete and accepted. The project has a solid
playable foundation, and Milestone 5 is the next development milestone.

Developer art was intentional through Milestone 4. Production asset work begins
in Milestone 5 and must preserve the proven gameplay and save boundaries.

## Completed foundation

### Milestone 0 — Developer sandbox

Status: complete.

Delivered deterministic regeneration, navigation-safe teleport, provision and
wreck controls, live gameplay tuning, overlay toggles, diagnostics and browser
automation hooks.

Success condition met: mechanics can be changed and inspected without
restarting the application.

### Milestone 1 — Home waters

Status: complete.

Delivered the home island, harbour, exact return dock, Supported water,
continuous ship movement, camera, ocean presentation and terrain-authoritative
collision.

Success condition met: every voyage begins from a recognizable, navigable home.

### Milestone 2 — Exploration

Status: complete.

Delivered blocker-aware current sight, opaque Unknown fog, expedition-stamped
Personal knowledge and the grey remembered trail.

Implemented knowledge rule: current sight reveals terrain visually, but
passable water at and ahead of the ship stays Unknown until the ship leaves its
navigation centre behind. This preserves full-cost outward travel and a
lower-cost Personal retrace.

Success condition met: crossing the frontier creates readable, consequential
exploration knowledge without revealing hidden terrain.

### Milestone 3 — Risk, return and inheritance

Status: complete and accepted.

Delivered physical provision bundles, knowledge-dependent movement costs,
forward and return guidance, eight deterministic non-home islands, exact-dock
expedition commitment, Supported-route growth, dock replenishment, failed-route
rollback, persistent runtime wrecks, a four-second wreck presentation and
generation advancement only after failure.

Success condition met: the player can weigh continuing against returning,
successful routes strengthen later voyages, and failure preserves earlier
inheritance while advancing the generation.

### Milestone 3.1 — Overlay readability

Status: complete and accepted.

Delivered a heading-clipped, thin maximum-forward-reach contour and one padded
minimum-provision-cost return corridor. Risk colour is restricted to that
corridor, current sight stays visually clean, and tiny enclosed Unknown
pinholes are closed only on successful return.

Success condition met: voyage guidance communicates risk without covering the
map in unrelated coloured blocks.

### Milestone 4 — Discoveries and persistence

Status: complete and accepted.

Delivered deterministic named island discoveries, provisional-to-returned
commitment, failure loss, persistent Supported routes, runtime wrecks,
generation state, pending wreck holds, ship state and discovery records.

Reload uses a rolling autosave. A separate manual checkpoint reliably restores
the saved ship and camera position. Base terrain regenerates from the saved
seed; visibility and path calculations rebuild instead of being serialized.

Success condition met: the inherited world survives browser sessions and
discoveries provide additional expedition goals.

## Next milestone

### Milestone 5 — Living world and production presentation

Status: not started.

Goal: make the growth of Supported knowledge visible and replace developer art
without changing the proven exploration loop.

Planned scope:

- semantic production asset IDs and an asset resolver;
- incremental production art for the player ship, home waters and islands;
- fishing boats and trade vessels;
- traffic restricted to Supported routes;
- environmental audio and visual polish;
- representative mobile performance and input validation.

Success criteria:

- Supported waters feel active and prosperous while Unknown waters remain
  isolated and mysterious.
- Production assets preserve terrain authority, stable island/discovery IDs,
  save compatibility and overlay readability.
- NPC traffic never enters Personal or Unknown water in its first version.
- The default desktop performance baseline remains intact and representative
  mobile hardware is validated.

## Prototype completion criteria

The prototype is ready for deeper game systems when:

- sailing remains enjoyable over repeated voyages;
- exploration into Unknown water is satisfying;
- players naturally understand the continue-or-return decision;
- exact-dock return and Supported-route growth feel rewarding;
- discoveries and a living Supported world motivate new expeditions;
- failure, inheritance and generation change are clear;
- production presentation strengthens rather than obscures gameplay;
- performance is acceptable on the intended desktop and mobile targets.

Deeper systems such as named navigators, aging, traits, family lines, trading,
settlement growth, reputation and a full economy remain outside the current
prototype scope.
