# Prosperity traffic concept studies

Status: `PRS-2.0` reference studies, generated and reviewed on 2026-07-19.

These PNGs compare small noninteractive fishing and trade craft in the current
Wayfinders visual language. They are reference art only. The game and asset
workspaces must never load them, sample them for rules, or treat their pictured
routes, people, islands, shoals, cargo, banners, or settlement details as
content authority.

The source prompts and generation provenance are recorded in `PROMPTS.md`.

## Directions

### A — Quiet outriggers

`concept-a-quiet-outriggers.png`

- Fishing: low open skiff, one light outrigger, net and basket clusters, no
  sail.
- Trade: broader cargo canoe, one light outrigger, compact cream wind panel,
  restrained bundled cargo.
- Strengths: the two jobs separate cleanly in silhouette; both remain below the
  player sail in scale and contrast; the shapes translate directly into a few
  crisp Phaser Graphics primitives; the narrow hulls keep open water quiet.
- Weaknesses: some generated detail and sail emblems are too ornate for runtime
  scale and must be omitted.

### B — Twin-hull utility craft

`concept-b-twin-hull-utility.png`

- Fishing: joined twin-hull working platform and square net frame.
- Trade: low rectangular cargo carrier across two hulls.
- Strengths: extremely clear geometric job language and stable top-down
  silhouettes.
- Weaknesses: broad beams consume too much screen area, make three vessels feel
  like a fleet, and compete with docks and the player craft in the busy case.

### C — Minimal crescent boats

`concept-c-minimal-crescents.png`

- Fishing: tiny open crescent skiff with a net basket.
- Trade: broader covered crescent cargo boat.
- Strengths: quietest overall composition and simplest possible fishing
  silhouette.
- Weaknesses: the trade canopy becomes visually heavy at small scale, while the
  two single-hull profiles are less distinct from one another and from ordinary
  decorative boats. The generated study also added labels despite the prompt;
  those are concept-sheet annotation only.

## Selected direction

Direction **A — Quiet outriggers** is selected for implementation.

It gives fishing and trade different silhouettes without using large decks or
high visual mass. The low unsailed fishing skiff reads as local work; the
slightly broader compact-sailed trader reads as connection and cargo. Both can
remain materially smaller and quieter than the existing 64-pixel player craft,
and one shared outrigger/timber vocabulary makes them feel related without
making them interchangeable.

The runtime interpretation is intentionally simpler than the concept:

- no emblem, banner, crew portrait, cultural glyph, or ornamental prow;
- generic dark timber hulls and lashings;
- fishing uses one muted turquoise net/basket cluster and no sail;
- trade uses a low shell-cream triangular wind panel and two ochre cargo
  bundles;
- fishing hull length is about `0.55` of the player source footprint and trade
  length about `0.62`;
- wakes are short, broken, low-alpha lines rather than foam trails; and
- reduced motion holds a safe-route pose with no wake.

These choices preserve the art-style guide's crisp high-angle language and
material warmth while satisfying the milestone's player-dominance and density
contracts.

## Review notes

The three sheets were inspected for:

- fishing/trade/player distinction at the pictured target scale;
- silhouette and grayscale separation;
- a static no-wake pose;
- one intentionally busy three-NPC patch;
- negative space around home, shoal, and community-island contexts; and
- practical translation into code-native directional graphics.

The studies are composition evidence, not exact spritesheets. Image generation
is not pixel-exact, and all runtime geometry, scale, colour, depth, opacity,
motion, caps, and safe-route behavior remain owned by checked-in code and its
tests.
