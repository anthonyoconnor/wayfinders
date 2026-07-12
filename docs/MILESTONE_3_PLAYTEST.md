# Milestone 3 Risk, Return and Inheritance playtest handoff

Wayfinders is paused at the Risk, Return and Inheritance review gate. This
build contains Milestones 0–3 only and uses developer art throughout.

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
and natural wrecks use the same four-second transition.

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
3. Before an island enters current sight, confirm that fully opaque Unknown fog shows no land, rock, reef or decorative silhouette.
4. Continue until a non-home island emerges from fog. Its revealed terrain should use authoritative collision and line-of-sight blocking.
5. Navigate around it and confirm that open channels remain available rather than the ocean becoming sealed.
6. Read the dotted neutral area as reachable Unknown water. It shrinks as bundles leave the cargo rack without revealing other hidden islands.
7. Read the Personal trail: neutral is comfortable, yellow/orange is narrowing, and red crosshatch has no known return with current cargo.
8. Turn back while a route remains. Retracing Personal water is cheaper than the outward Unknown leg.
9. Cross into Supported water away from home. The expedition should remain active and supplies should not replenish yet.
10. Enter the exact home dock. Only this tile completes the expedition.
11. Confirm that the expedition's Personal corridor becomes Supported, its grey risk treatment clears, the cargo rack replenishes to the configured starting bundles, and the same generation continues.
12. Depart again along the inherited route. Supported travel should cost nothing and permit a farther voyage.

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
- Do the dotted, coloured and patterned overlays communicate enough?
- Does returning to the exact home dock feel rewarding?
- Is it clear that only the exact home dock completes an expedition?
- Does converting the Personal route to Supported make the next voyage meaningfully stronger?
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
