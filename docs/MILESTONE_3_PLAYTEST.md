# Milestone 3 playtest handoff

Wayfinders is paused at the Risk review gate. This build contains Milestones 0–3 only and uses developer art throughout.

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

The developer drawer can teleport to any navigable water tile, add or remove bundles, regenerate the current seed, toggle every overlay and change gameplay values live.

## Suggested first voyage

1. Leave the east-facing home dock and sail through the lighter Supported water. The cargo rack should not change.
2. Cross the Supported boundary into the dark ocean. The current sight disc stays in full colour while a broad grey Personal corridor remains behind.
3. Read the dotted neutral area as reachable Unknown water. It shrinks as bundles leave the cargo rack.
4. Read the Personal trail: neutral is comfortable, yellow/orange is narrowing, and red crosshatch has no known return with current cargo.
5. Turn back while a route remains. Retracing Personal water is cheaper than the outward Unknown leg.
6. Re-enter Supported water and look for the brief Safe Passage cue.

If you intentionally continue into red and empty the rack, the ship becomes stranded. Use Developer tools to add a bundle, teleport, or regenerate the seed.

## Review questions

- Is sailing enjoyable?
- Does leaving home create anticipation?
- Is exploring into the unknown satisfying?
- Is it clear when to turn back without a numerical resource display?
- Do the dotted, coloured and patterned overlays communicate enough?
- Does returning to Supported water feel rewarding?
- Would repeated expeditions remain engaging?

Choose **Proceed** or **Rework** after this review. Do not start production art or Milestones 4–5 until that decision is made.

## Intentionally not implemented

- Converting returned Personal knowledge into permanent Supported routes
- Expedition success/failure resolution
- Discoveries and progression
- Save/load
- NPC traffic
- Production art and environmental polish

Those belong to Milestones 4 and 5.
