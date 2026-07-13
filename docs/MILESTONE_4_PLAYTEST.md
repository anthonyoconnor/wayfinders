# Milestone 4 discovery and persistence playtest handoff

Wayfinders is paused after the Milestone 4 engineering pass. Milestones 0–3.1
are complete and should not be reimplemented. This build intentionally uses
developer art; production assets begin in Milestone 5.

## Run locally

From the project directory in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/` in a WebGL-capable desktop browser. Stop the
server with `Ctrl+C`.

For a production build:

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

The developer drawer contains **Inspect next island**, teleport, cargo/wreck
controls, and **Save checkpoint**, **Load checkpoint**, and **Clear saves**. It also reports
provisional/returned discovery counts and browser-save status.

## Suggested playtest

1. Start from a clean chart. Use **Clear saves** and reload if a prior session
   is present.
2. Sail into Unknown water or use **Inspect next island**. Confirm a named
   developer chart pin appears with a provisional reward and the discovery
   count becomes `1 provisional`.
3. Enter Supported water away from home. Confirm the record remains
   provisional and supplies are not replenished.
4. Return to the exact home dock. On the default seed the developer teleport
   coordinate is `53, 48`. Confirm the pin becomes returned, the route becomes
   Supported, provisions replenish, and the same generation continues.
5. Wait until the drawer reports `Browser autosave: saved`, then reload the page.
   Confirm the returned discovery, Supported route, counters and ship state
   remain.
6. Begin another expedition, sight a different island, and force or suffer a
   wreck. Confirm that expedition's provisional record disappears while the
   earlier returned record remains. The four-second wreck presentation and
   next-generation respawn should behave exactly as in Milestone 3.
7. Reload once more. Confirm the new generation, runtime wreck, earlier
   Supported route and returned discovery survive.
8. Exercise **Save checkpoint** and **Load checkpoint**. Move elsewhere after
   saving; loading must restore the ship and camera to the checkpoint tile and
   report those coordinates. The stable manual checkpoint is separate from the
   rolling reload autosave. **Clear saves** removes both records without
   resetting the running simulation; reloading after clear starts a fresh
   generation-one chart.
9. Check that normal sailing and the risk/visibility overlays still feel as
   responsive and readable as the accepted Milestone 3.1 build.

## Questions for the player

- Do named discoveries create a clear reason to investigate islands?
- Is the difference between provisional and safely returned discoveries clear?
- Does exact-dock commitment feel rewarding?
- Is it understandable that wrecking loses only unreturned discoveries and
  preserves inherited routes, wrecks and returned records?
- Does reload feel seamless, including during or after the wreck transition?
- Are the developer pins readable enough for mechanics testing before the
  Milestone 5 art pass?
- Do any save/load controls or automatic saves feel surprising?

## Acceptance target

Milestone 4 can be accepted when a player can create a returned discovery and
Supported route, create a later-generation wreck, reload, and find all three
inherited states intact without confusion or a material performance regression.

## Intentional limits

- Discovery rewards, settlements and resources are records and presentation,
  not yet an economy or simulation effect.
- Fishing/trade vessels, route traffic, environmental polish and production
  assets belong to Milestone 5.
- Explicit world regeneration is still a deliberate fresh-world reset.
- Saves are local to the current browser profile and origin.
