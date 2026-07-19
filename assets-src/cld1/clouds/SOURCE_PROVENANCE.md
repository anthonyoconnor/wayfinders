# CLD-1 cloud source provenance

- Runtime asset: `public/assets/cld1/clouds/cloud-sheet.png`
- Retained source sheet: `assets-src/cld1/clouds/cloud-sheet-original.png`
- Generated keyed sources: `assets-src/cld1/clouds/generated-variants/raw`
- Normalized transparent additions: `assets-src/cld1/clouds/generated-variants/frames`
- Package: `src/wayfinders/assets/packages/cloud-atmosphere.json`
- Refreshed: 2026-07-18
- Generator path: built-in OpenAI image generation, followed by the installed
  imagegen skill's chroma-key removal helper and deterministic nearest-neighbor
  frame preparation.
- Source asset ID: `generated.cloud-atmosphere.source.v3`
- Runtime revision: `8`

The runtime RGBA sheet and retained RGB source sheet are both `2508 x 3762`.
They contain twenty-four row-major `627 x 627` fixed slots in a `4 x 6` grid.
The four previously approved formations retain frame IDs `0` through `3`; their
pixels were copied unchanged into the first row. The twenty additions occupy
frames `4` through `23`. All twenty-four package variants are active in game.

Each addition was produced by its own built-in image-generation call using the
prior checked-in cloud sheet as a style-only reference. The shared prompt
specified one centered, asymmetrical, high-oblique/top-down pixel-art cumulus
formation; crisp stepped clusters; a decisive small-scale silhouette; warm
shell-ivory upper-left highlights; pale-blue midtones; cool blue-gray
undersides; generous edge padding; and a visually flat magenta chroma-key
backdrop. It prohibited baked shadows, background scenes, terrain, ocean,
ships, UI, text, logos, watermarks, grids, fuzzy airbrush, and edge touching.
Each formation had to remain legible after horizontal reflection and at the
runtime's minimum scale.

The variant-specific prompt briefs were:

| Frame | Stable ID | Formation brief |
| ---: | --- | --- |
| 4 | `twin-crowned-cluster` | Two unequal crowns joined by a low saddle around a broad cleft. |
| 5 | `notched-broad-bank` | A broad oval bank with one deep side bite and one outboard puff. |
| 6 | `tapered-wedge-bank` | A blunt heavy head tapering into one pointed diagonal train. |
| 7 | `three-tower-shelf` | A low shelf supporting three separated uprisings of unequal height. |
| 8 | `bow-tie-bank` | Two unequal broad lobes meeting at a narrow waist with deep concavities. |
| 9 | `forked-drift` | A dense stem splitting into two unequal tapered arms with a clear Y opening. |
| 10 | `three-finger-fan` | A compact root opening into three distinct organic fingers. |
| 11 | `crooked-crossbank` | A long diagonal spine crossed off-centre by a shorter unequal bank. |
| 12 | `hook-and-beads` | A thick J-shaped hook followed by three substantial nearby puffs. |
| 13 | `serpentine-ribbon` | One shallow continuous S bank alternating thick and pinched sections. |
| 14 | `open-ring-bank` | A thick irregular oval around a large opening with one broad gap. |
| 15 | `double-window-bank` | One dense bank pierced by two unequal, clearly separate sky windows. |
| 16 | `triangular-hollow-bank` | Three asymmetric scalene banks around a large triangular opening. |
| 17 | `braided-channel-bank` | Two curved banks enclosing a long open channel and meeting at one end. |
| 18 | `curled-three-arm-cluster` | Three unequal curved arms turning around an off-centre opening. |
| 19 | `stepped-trio` | Three separate compact masses descending diagonally in large/medium/small order. |
| 20 | `paired-islands` | One large mass and one smaller partner across a broad channel with two bridge puffs. |
| 21 | `parallel-broken-bands` | Two staggered parallel strips with different breaks and endpoints. |
| 22 | `arc-scatter` | Four unequal cloud islands arranged on an asymmetric shallow arc. |
| 23 | `staggered-front` | Four joined unequal bulges forming an irregular stair-step front. |

The selected tapered-wedge and bow-tie sources received targeted retries to
remove excess detached puffs. The triangular-hollow source received two shape
retries and one precise geometry edit so its three banks form an asymmetric
scalene opening rather than a regular symbol. No other generated output needed
content correction.

The generated keyed sources are `1254 x 1254` RGB PNGs. Each was reduced to
`627 x 627` with nearest-neighbor sampling before background removal. Chroma
removal sampled the border and used soft matte, thresholds `12` and `220`, and
despill. The prepared transparent frames preserve those exact normalized
results. The retained source sheet composites the prepared frames over exact
`#ff00ff`; the runtime sheet composites the same frames over transparency.
Every frame has transparent corners, visible pixels, and an opaque envelope
strictly inside its fixed cell.
