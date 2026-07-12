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
toggle every overlay and change gameplay values live. Removing the final
bundle directly creates a recoverable developer zero-cargo state; use **Force
wreck** to exercise failure presentation without sailing until natural
consumption reaches zero.

## Suggested first voyage

1. Leave the east-facing home dock and sail through the lighter Supported water. The cargo rack should not change.
2. Cross the Supported boundary into the dark ocean. The current sight disc stays in full colour while a broad grey Personal corridor remains behind.
3. Read the dotted neutral area as reachable Unknown water. It shrinks as bundles leave the cargo rack.
4. Read the Personal trail: neutral is comfortable, yellow/orange is narrowing, and red crosshatch has no known return with current cargo.
5. Turn back while a route remains. Retracing Personal water is cheaper than the outward Unknown leg.
6. Cross into Supported water away from home. The expedition should remain active and supplies should not replenish yet.
7. Enter the exact home dock. Only this tile completes the expedition.
8. Confirm that the expedition's Personal corridor becomes Supported, its grey risk treatment clears, the cargo rack replenishes to the configured starting bundles, and the same generation continues.
9. Depart again along the inherited route. Supported travel should cost nothing and permit a farther voyage.

## Dock replenishment check

With no active expedition, remove at least one bundle using Developer tools,
sail away from the dock while remaining in Supported water, and re-enter the
exact dock. The cargo rack should replenish without starting an expedition or
advancing the generation.

## Wreck test

1. Begin another expedition and intentionally continue until the last bundle is consumed outside Supported water.
2. Confirm that the wreck resolves immediately rather than leaving a stranded controllable ship.
3. Confirm that the failed expedition's Personal trail returns to Unknown while Supported routes earned by earlier successful returns remain.
4. Confirm that one wreck marker remains at the loss location.
5. Confirm that a new ship appears at the exact home dock with configured starting bundles and the generation advances by one.
6. Sail back toward the loss location in the later generation and confirm that the wreck marker becomes discoverable when it enters current line of sight.

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
- Is a wreck immediate, understandable and fair?
- Is it clear that the failed Personal trail was lost while earlier Supported routes survived?
- Does finding an earlier generation's wreck reinforce the inheritance theme?
- Is it clear that safe return continues the same generation while only wreck advances it?
- Would repeated expeditions remain engaging?

Choose **Proceed** or **Rework** after this review. Do not start production art or Milestones 4–5 until that decision is made.

## Intentionally not implemented

- Generic discoveries and progression beyond runtime wreck markers
- Save/load and cross-session persistence
- Named navigators, aging, traits and family-line simulation
- NPC traffic
- Production art and environmental polish

Generic discoveries and cross-session persistence belong to Milestone 4.
Living-world systems and production presentation belong to Milestone 5 and
later development.
