# Water source-art provenance

The four masters were generated with the built-in `image_gen` tool, using the
listed project images only as style/scale references. No island file was edited.
The selected PNGs were then normalized to non-interlaced 8-bit RGBA without
restyling, and the deterministic local builder created all runtime-sized sheets.

## Deep ocean master

References:

- `dist/assets/gr1/images/home-island.png`: final home-island style and scale
- `assets-src/gr1/island-examples/island-08-horseshoe-port-inhabited.png`:
  inhabited-island harbor/deep-water style

Prompt:

```text
Use case: stylized-concept
Asset type: seamless tileable game texture master for a top-down ocean map
Input images: Image 1 is the final home-island style and scale reference; Image 2 is an inhabited island style reference with a deep harbor.
Primary request: create a square uninterrupted deep-ocean water surface matching the references' warm, hand-painted pixel-art game style.
Scene/backdrop: water fills the entire canvas edge to edge.
Subject: dark tropical deep ocean with small broken horizontal wavelets, sparse muted turquoise glints, and subtle low-frequency mottling.
Style/medium: detailed 2D pixel-art texture viewed straight down; crisp clustered pixels and restrained painterly dithering; match the references' detail density.
Composition/framing: orthographic top-down, uniform material texture, no horizon, no central focal feature, designed to repeat in all directions.
Color palette: navy and blue-teal centered near #082f40, #12536a, and #1b6f82, with very sparse soft #8bd0cf glints.
Constraints: seamless/tileable opposite edges; even lighting; water only; no land, sand, rocks, coral, boats, fish, wakes, borders, grid lines, text, logos, or watermark; no transparency; avoid long continuous lines that would reveal repetition.
```

## Shallow coastal master

References:

- `dist/assets/gr1/images/home-island.png`: final runtime detail
- `assets-src/gr1/island-examples/island-01-crescent-cay-uninhabited.png`:
  sandy shoreline
- `assets-src/gr1/island-examples/island-08-horseshoe-port-inhabited.png`:
  harbor and lagoon water

Prompt:

```text
Use case: stylized-concept
Asset type: seamless tileable game texture master for a top-down ocean map
Input images: Image 1 is the final home-island style and exact runtime-detail reference; Image 2 is a sandy crescent-island shoreline reference; Image 3 is a harbor and lagoon water reference.
Primary request: create a square uninterrupted shallow tropical coastal-water surface matching the references.
Scene/backdrop: shallow water fills the entire canvas edge to edge.
Subject: clear pale turquoise shelf water over warm sand, with tiny broken cream foam flecks, subtle pale caustic ripples, and sparse soft submerged-sand mottling.
Style/medium: detailed 2D pixel-art texture viewed straight down; crisp clustered pixels and restrained hand-painted dithering; match the references' detail density.
Composition/framing: orthographic top-down, uniform material texture, no shoreline silhouette or central focal feature, designed to repeat in all directions.
Color palette: turquoise and seafoam around #4aa1a0, #63b8b0, #70c0a0, and #a0d0a0, warmed subtly by sand below; cream accents must remain sparse.
Constraints: seamless/tileable opposite edges; even lighting; water only; no land, exposed sand, rocks, coral heads, plants, boats, fish, wakes, borders, grid lines, text, logos, or watermark; no transparency; avoid long continuous foam lines.
```

## Reef-lagoon master

References:

- `dist/assets/gr1/images/home-island.png`: final style and scale
- `assets-src/gr1/island-examples/island-14-maze-marsh-uninhabited.png`:
  mangrove-marsh water
- `assets-src/gr1/island-examples/island-08-horseshoe-port-inhabited.png`:
  harbor/lagoon water

Prompt:

```text
Use case: stylized-concept
Asset type: seamless tileable game texture master for a top-down ocean map
Input images: Image 1 is the final home-island style and scale reference; Image 2 is a mangrove-marsh island reference; Image 3 is a harbor/lagoon reference.
Primary request: create a square uninterrupted tropical reef-lagoon water surface matching the references.
Scene/backdrop: water fills the entire canvas edge to edge.
Subject: medium teal lagoon water with subtle irregular submerged reef shadows, muted olive and blue-green coral silhouettes below the surface, tiny broken glints, and gentle caustic texture; navigationally readable but not visually busy.
Style/medium: detailed 2D pixel-art texture viewed straight down; crisp clustered pixels, hand-painted texture, restrained contrast; match the references.
Composition/framing: orthographic top-down, uniform scatter with no single focal object, seamless repeat in all directions.
Color palette: teal #2d858b and #3b9696, deeper pockets near #12536a, submerged muted reef tones near #79c8a4 and #91b59b.
Constraints: seamless/tileable opposite edges; even lighting; fully opaque water texture; no land, exposed beach, large rocks, trees, birds, boats, fish, borders, grid lines, text, logos, or watermark; no obvious repeating large coral objects.
```

## Directional-current master

References:

- `dist/assets/gr1/images/home-island.png`: final style and scale
- generated deep-ocean master above: material continuity

Prompt:

```text
Use case: stylized-concept
Asset type: seamless tileable directional-current game texture master for a top-down ocean map
Input images: Image 1 is the final home-island style and scale reference; Image 2 is the newly generated deep-ocean material reference.
Primary request: create a square uninterrupted open-ocean current lane matching the references.
Scene/backdrop: ocean water fills the entire canvas edge to edge.
Subject: medium-dark blue-teal water with multiple restrained broken current ribbons flowing west-to-east, small staggered pale wave dashes, sparse low whitecaps, and subtle darker troughs; direction must read without becoming a giant stripe.
Style/medium: detailed 2D pixel-art texture viewed straight down; crisp clustered pixels and restrained hand-painted dithering; match reference detail density.
Composition/framing: orthographic top-down, distributed flow bands, no central focal feature; designed to repeat in all directions and to rotate for north/south/east/west variants.
Color palette: #0b4052, #12536a, #1b6f82, #2d858b, with sparse #8bd0cf accents.
Constraints: seamless/tileable opposite edges; even lighting; fully opaque water only; no land, sand, rocks, coral, boats, fish, large wakes, borders, grid lines, text, logos, or watermark; avoid a single continuous line crossing the entire canvas.
```
