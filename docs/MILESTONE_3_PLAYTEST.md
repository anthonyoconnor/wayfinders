# Milestone 3.1 Risk-overlay readability playtest handoff

Wayfinders is paused at the revised Risk, Return and Inheritance review gate.
This build contains Milestones 0–3.1 only and uses developer art throughout.

## Run locally

From the project directory in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/` in a WebGL-capable desktop browser. Stop the server with `Ctrl+C`.

For the production build instead:

```powershell
npm.cmd run build
npm.cmd run preview
```

Then open `http://127.0.0.1:4173/`.

## Controls

- W / Up Arrow: sail forward
- S / Down Arrow: reverse
- A / D or Left / Right Arrow: turn
- Mouse wheel or Q / E: zoom
- Developer tools: open the top-right drawer

The developer drawer can teleport to any navigable water tile, add or remove
bundles, force a wreck outside Supported water, regenerate the current seed,
toggle every overlay, change gameplay values live, and use **Inspect next
island** to cycle through stable island descriptor order from passable
inspection points. Removing the final bundle directly creates a recoverable
developer zero-cargo state; use **Force wreck** to exercise failure
presentation without sailing until natural consumption reaches zero. Forced
and natural wrecks use the same four-second transition. **Return route
padding** tunes the Milestone 3.1 return presentation without changing
movement costs. The forward frontier has no focus-depth control: its position
comes directly from current provisions and configured travel costs. **Forward
cone half-angle** controls how much of that limit is shown ahead of the ship;
the default is 60 degrees on each side of its heading.

## Scattered-island inspection

1. Note the current seed, then click **Inspect next island** eight times.
2. Confirm that the diagnostic log cycles stable IDs and reports High Island (`high-island`), Low Cay (`low-cay`), Atoll (`atoll`) and Rocky Skerry (`rocky-skerry`) kinds across small, medium and large sizes.
3. Compare the functional silhouettes: high land, narrow low cay, reef-ring atoll and rock-dominant skerry should be distinguishable without production art.
4. Confirm each inspection viewpoint is passable water within or immediately beside the island footprint.
5. Regenerate the same seed and repeat the cycle. Descriptor order, IDs, kinds, sizes and island forms should be unchanged.
6. Regenerate a different seed. IDs and guaranteed kind/size coverage remain stable while the new seed produces its own repeatable positions, dimensions, rotations and forms.
7. Regenerate the intended playtest seed before beginning the natural voyage below.

## Suggested first voyage

1. Leave the east-facing home dock and sail due east through the lighter Supported water. The cargo rack should not change, and the complete eastbound corridor should remain unobstructed.
2. Cross the Supported boundary into the dark ocean. The current sight disc stays in full colour while a broad grey Personal corridor remains behind.
3. Confirm every tile inside current sight looks like unmodified Supported
   presentation: no grey Personal treatment and no yellow, orange or red route
   colour. Cargo must still charge Unknown/Personal cost according to the
   underlying knowledge state.
4. Before an island enters current sight, confirm that fully opaque Unknown fog shows no land, rock, reef or decorative silhouette.
5. Continue until a non-home island emerges from fog. Its revealed terrain should use authoritative collision and line-of-sight blocking.
6. Navigate around it and confirm that open channels remain available rather than the ocean becoming sealed.
7. Read the thin dotted neutral line as the true maximum-reach frontier. It
   should appear at the furthest reachable Unknown-cost band immediately,
   rather than growing outward from current sight, and must not reveal hidden
   islands. It should appear only in the cone ahead of the ship, not behind it.
   During equal-cost Unknown travel it should normally stay anchored
   to the same world cells: each step moves the ship closer by the same cost it
   spends from the provision budget.
8. Find the single padded route from the current-sight boundary back to the first Supported water. Unrelated Personal branches remain grey rather than receiving yellow, orange or red blocks.
9. Confirm the whole visible portion of that route has one coherent state: pale/strong yellow while the return is clear or narrowing, orange when critical, and red crosshatch when the minimum-cost known return exceeds current cargo. The entire route outside current sight must change together as cargo changes.
10. Turn back along the indicated route. Retracing Personal water is cheaper than the outward Unknown leg.
11. Cross into Supported water away from home. The expedition should remain active and supplies should not replenish yet.
12. Enter the exact home dock. Only this tile completes the expedition.
13. Confirm that the expedition's Personal corridor becomes Supported, the return route clears, the cargo rack replenishes to the configured starting bundles, and the same generation continues.
14. Depart again along the inherited route. Supported travel should cost nothing and permit a farther voyage.

## Milestone 3.1 overlay frontier check

1. Create a broad or branching Personal area using normal sailing or developer teleport, then return the ship to its connected main trail.
2. Toggle off Forward exploration range. Confirm return colour appears only on one shortest route and its configured padding, not across every Personal tile.
3. Remove bundles one at a time. Confirm the route geometry remains stable while the whole corridor changes together through yellow, orange and red states.
4. Add a bundle back. Confirm the last state transition reverses immediately.
5. Toggle off Return viability and enable Forward exploration range. Note the
   frontier's world cells against a visible landmark, then sail through one or
   more equal-cost Unknown tiles. With no other cost or knowledge change, the
   frontier should normally remain on the same world cells instead of following
   the ship.
6. Turn in place. Confirm the visible arc rotates with the ship while the
   logical maximum range does not crawl outward. The arc should end cleanly
   without lines running back toward the ship.
7. Confirm the cue is a thin pale segmented contour with transparent tile
   interiors, not a band of filled grey squares.
8. Change **Forward cone half-angle** and confirm a narrower/wider forward arc
   appears immediately. At 180 degrees the full limit is eligible.
9. Add or remove a bundle and confirm the frontier moves immediately to the new
   true maximum-reach band. The line should contain only reachable Unknown
   cells whose minimum cost is within one configured Unknown-tile cost of the
   current budget.
10. Sail across a 32-tile chunk boundary and turn. Confirm old path/frontier
   pixels clear and no seam, duplicated band or stranded colour block remains.

## Successful-return pocket cleanup check

1. During an expedition, leave a one- or two-tile Unknown black pocket fully
   enclosed in all eight directions by the current Personal route. Confirm the
   pocket remains Unknown before returning.
2. Enter the exact home dock. After the Personal route becomes Supported,
   confirm the enclosed pocket also becomes Supported.
3. Confirm that an Unknown component remains unchanged if it is larger than
   `world.maxEnclosedUnknownTiles` (two by default), touches a world edge, or
   has any non-Unknown boundary tile that is not Supported.
4. Repeat with a failed expedition. Wreck rollback must not fill or otherwise
   reclassify any Unknown pocket.
5. For the configuration-disable check, set
   `world.maxEnclosedUnknownTiles` to `0`, regenerate, complete a successful
   return around an eligible pocket and confirm it stays Unknown.

## Dock replenishment check

With no active expedition, remove at least one bundle using Developer tools,
sail away from the dock while remaining in Supported water, and re-enter the
exact dock. The cargo rack should replenish without starting an expedition or
advancing the generation.

## Wreck test

1. Begin another expedition and intentionally continue until the last bundle is consumed outside Supported water.
2. Confirm that wreck presentation begins immediately at the loss site: the ship becomes a visible wreck, the camera remains there and controls no longer move it.
3. Confirm that the failed expedition's Personal trail returns to Unknown while Supported routes earned by earlier successful returns remain.
4. For approximately four seconds, confirm that no replacement ship appears and the generation does not advance. The status line counts down the remaining hold.
5. Confirm that one wreck marker remains at the loss location throughout the hold.
6. At the end of four seconds, confirm that the generation advances exactly once and a new ship appears at the exact home dock with configured starting bundles.
7. Sail back toward the loss location in the later generation and confirm that the wreck marker becomes discoverable when it enters current line of sight.

If the last bundle is consumed on the same movement step that enters the exact
home dock, successful return must take precedence and no wreck should be
created.

Routes, wrecks and generation state persist only for the current generated
runtime in Milestone 3. Regenerating the world or reloading the browser resets
them.

## Review questions

- Is sailing enjoyable?
- Does leaving home create anticipation?
- Is exploring into the unknown satisfying?
- Is it clear when to turn back without a numerical resource display?
- Does one padded shortest-return corridor communicate the route home without colouring unrelated Personal water?
- Does the whole return corridor changing colour together make provision risk understandable?
- Does the thin maximum-reach frontier communicate the real exploration limit
  without covering too much of the play area?
- Does the forward cone remove irrelevant behind-the-ship information while
  remaining wide enough to support route choice?
- Does the segmented contour read as a limit line rather than filled tiles?
- Does the frontier normally remain anchored to the world during equal-cost
  Unknown travel, instead of crawling along with the ship?
- Does returning to the exact home dock feel rewarding?
- Is it clear that only the exact home dock completes an expedition?
- Does converting the Personal route to Supported make the next voyage meaningfully stronger?
- Does successful-return cleanup remove tiny black pockets without erasing
  larger or incompletely Supported-bounded Unknown areas?
- Does dock replenishment make repeated voyages flow naturally?
- Does the four-second wreck presentation make the loss clear without feeling too slow?
- Is it clear that the failed Personal trail was lost while earlier Supported routes survived?
- Does finding an earlier generation's wreck reinforce the inheritance theme?
- Is it clear that safe return continues the same generation while only wreck advances it?
- Do High Islands, Low Cays, Atolls and Rocky Skerries read as distinct developer-art terrain compositions?
- Are small, medium and large islands visibly different?
- Do the scattered islands create interesting route choices without closing the ocean?
- Does opaque Unknown fog fully conceal island terrain and decoration before reveal?
- Does **Inspect next island** make deterministic world inspection efficient without becoming normal player UI?
- Would repeated expeditions remain engaging?

Choose **Proceed** or **Rework** after this review. Do not start production art or Milestones 4–5 until that decision is made.

## Intentionally not implemented

- Generic discoveries and progression beyond runtime wreck markers
- Island names, rewards, settlements, resources and generic discovery records
- Save/load and cross-session persistence
- Named navigators, aging, traits and family-line simulation
- NPC traffic
- Production-quality island sprites, biome art and broader environmental polish

Generic discoveries and cross-session persistence belong to Milestone 4.
Living-world systems and production presentation belong to Milestone 5 and
later development.
