# Winter island concept selections

All boards and selected sources were generated with OpenAI's built-in image
generation tool. `public/assets/gr1/images/home-island.png` was supplied only as
the world-scale rendering, pixel-density, overhead-light, coastal-handoff, and
craft-language reference. The concepts do not define collision; exact semantic
collision is authored separately in the Islands workflow.

## Shared concept-board prompt

Create two clearly different, side-by-side, strict top-down orthographic
Wayfinders pixel-art alternatives for the named winter island. Show each
complete island with generous deep navy-to-teal sea, clustered readable pixels,
irregular exposure-driven shallows, and no labels, text, UI, logos, watermark,
or perspective horizon. Inhabited briefs use restrained timber, rope, woven
sailcloth, and amber warmth; uninhabited briefs contain no buildings, docks,
paths, fires, ruins, monuments, people, or boats.

## Shared selected-source prompt

Use only the recorded side of the concept board and retain its recognizable
geography. Render one centered, complete island-composite on a square canvas,
including the full authored shallow-water, ice, rock, and fragmented-surf
apron. Bring the outer water toward deep-water RGB `[8, 48, 68]`, end it well
inside the canvas, and place it against a flat magenta connected-border matte.
Keep the strict top-down world-scale pixel treatment and omit all text, UI,
logos, watermarks, extra islands, and panel framing.

## Selections

| Island | Habitation | Selected | Selection reason | Target canvas |
| --- | --- | --- | --- | --- |
| Frostharbor | Inhabited | Right | The narrow inlet and sheltered harbor basin read more clearly at game scale, while the asymmetric shield silhouette differs strongly from the other winter islands. | `640 x 576` |
| Emberhearth Isle | Inhabited | Right | The geothermal river creates a legible top-to-bottom focal route and a distinctive elongated footprint without turning the springs into spectacle. | `576 x 512` |
| Whitefang Skerry | Uninhabited | Left | The long fang ridge has the strongest silhouette and preserves a severe, sparse, unmistakably wild coast. | `384 x 576` |
| Blueglass Atoll | Uninhabited | Left | The broken ring of islets and multiple passes provides the clearest atoll identity and the most varied collision topology. | `512 x 512` |

## Retained artifacts

- `frostharbor-concept-board.png` ->
  `assets-src/gr3/intake/production-island-winter-frostharbor-source.png`
- `emberhearth-isle-concept-board.png` ->
  `assets-src/gr3/intake/production-island-winter-emberhearth-isle-source.png`
- `whitefang-skerry-concept-board.png` ->
  `assets-src/gr3/intake/production-island-winter-whitefang-skerry-source.png`
- `blueglass-atoll-concept-board.png` ->
  `assets-src/gr3/intake/production-island-winter-blueglass-atoll-source.png`
