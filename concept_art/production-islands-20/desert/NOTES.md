# Desert production-island art notes

Generated with OpenAI's built-in image generation tool. The checked-in
`public/assets/gr1/images/home-island.png` was supplied only as the rendering,
world-scale pixel-density, and terrain-readability reference. It was not an
edit target and none of its geography was copied.

The four concept boards intentionally retain both alternatives. Each production
source derives from the selected side only. Sources are square `1254 x 1254`
RGB PNGs for the repository's connected-border `island-composite` preparation;
the listed dimensions are the intended prepared canvases for guided intake.

## Shared concept-board prompt

```text
Use case: stylized-concept
Asset type: game environment concept board for an authored island-composite
Input images: Image 1 is a rendering-style and world-scale pixel-density
reference only; do not copy its geography or ecology.
Primary request: create one clean landscape concept board containing exactly
two clearly distinct side-by-side alternatives. Both alternatives show one
complete island and its complete authored coastal-water apron, fully visible
and uncropped.
Scene/backdrop: quiet dark navy-to-deep-teal ocean around each island, with
enough separation that both designs read independently.
Style/medium: top-down orthographic world-scale hand-painted pixel art; match
the reference's crisp clustered pixels, decisive value groups,
dense-but-readable detail, small high-contrast built silhouettes when
inhabited, and terrain-readable edges, while using the requested desert ecology.
Composition/framing: landscape board, two equal side-by-side designs, straight
orthographic top-down view, no perspective horizon; each complete island is
centered in its half with generous surrounding sea and comparable apparent
scale.
Coastal water system: bake an irregular terrain-driven water apron into each
concept. Open-ocean/windward rock gets a narrow shelf, faster falloff,
scattered rocks, and fragmented broken surf. Sheltered bays, lee shores, sand
spits, and lagoons get broad calm pale-aqua/turquoise shallows, sinuous
channels, sediment fans, sand tongues, and sparse reef heads. Water transitions
through textured intermediate teal toward deep-water RGB approximately
[8,48,68] near the outer extent. Do not make a uniform halo, concentric water
bands, or continuous foam ring.
Constraints: exactly two alternatives; complete uncropped island plus water
apron in each half; no text, letters, numerals, labels, captions, legends,
arrows, UI, HUD, panels, frames, logos, signatures, or watermarks.
Avoid: smooth digital painting, photorealism, isometric perspective, blurry
anti-aliased detail, radial glow, hard color bands, checkerboards, tile seams,
generic fantasy ornament, identifiable cultural motifs, or copied home-island
geography.
```

## Shared production-source prompt

```text
Use case: stylized-concept
Asset type: production source PNG for a top-down game island-composite
Input images: Image 1 is the island's concept board; use only the selected side
as the geography and design target. Image 2 is a world-scale pixel-art rendering
and pixel-density reference only.
Primary request: render one standalone production-ready island-composite
derived from the selected concept. Preserve its recognizable silhouette,
geology, ecology, habitation state, and exposed-versus-sheltered shore
hierarchy; simplify tiny clutter only where needed for runtime readability.
Scene/backdrop: the island and its baked irregular coastal-water apron float on
a flat solid magenta chroma-key matte.
Style/medium: crisp top-down orthographic hand-painted world-scale pixel art,
clustered pixels and decisive value groups, matching the reference's apparent
pixel density and terrain readability while using the requested desert ecology.
Composition/framing: square canvas; exactly one centered complete
island-composite; straight orthographic top-down view; generous even padding;
the complete outer water apron is fully visible and does not touch the canvas
boundary; leave an ample continuous magenta border on every side.
Coastal water: exposed coasts get a narrow dark shelf, close deep water,
scattered rocks, and fragmented surf. Sheltered or lee coasts get broad calm
pale-aqua/turquoise shelves with sand tongues, sinuous channels, sediment
features, and sparse reef or rock heads. Transition irregularly through
textured intermediate teal toward deep-water RGB [8,48,68] at the apron's
outside edge. No uniform halo, continuous foam ring, or concentric bands.
Matte contract: the exterior background connected to every canvas edge must be
a single visually flat uniform #ff00ff matte with no shadow, texture, noise,
gradient, vignette, glow, reflection, wave, haze, or lighting variation. Do not
use #ff00ff or near-magenta hues in the subject.
Constraints: exactly one island and one complete baked water apron; fully
visible and uncropped; no second alternative; no text, letters, numerals,
labels, UI, HUD, frame, logo, signature, or watermark.
Avoid: extra islands, panel layout, isometric perspective, horizon, blur,
photorealism, radial glow, tile seams, black or transparent background, or cast
shadow on the matte.
```

## Saffron Haven

- State: inhabited.
- Intended prepared canvas: `640 x 512`.
- Concept board:
  `concept_art/production-islands-20/desert/saffron-haven-concept-board.png`.
- Selected production source:
  `assets-src/gr3/intake/production-island-desert-saffron-haven-source.png`.
- Selected side: left.
- Selection reason: the single monumental stepped mesa creates the strongest
  desert landmark and a clearer hierarchy from spring to settlement to
  south-facing oasis harbor. The right twin-mesa option was readable but less
  distinctive at world scale.
- Concept-specific prompt:

```text
Saffron Haven is an inhabited broad ochre island dominated by warm sandstone
mesa geology, pale sand, sparse dry scrub, and one sheltered oasis harbor.
Include a compact dignified settlement made from warm timber, rope, weathered
sailcloth, ochre stone, footpaths, and a modest working dock. LEFT: one broad
stepped mesa with a deep south-facing oasis cove, terraced settlement below the
mesa, and a winding inland spring. RIGHT: an asymmetric twin-mesa island with
an east-facing crescent harbor, clustered dockside settlement, scattered
wind-carved pillars, and a narrow saddle between mesas. Use warm sunlit
sandstone and sailcloth against cool teal water. Avoid lush tropical jungle or
snow.
```

- Production-specific prompt:

```text
Use only the LEFT concept. Render a broad irregular ochre island with one
monumental stepped sandstone mesa, a spring descending toward a sheltered
south-facing oasis harbor, and a compact warm timber/rope/weathered-sailcloth
settlement below the mesa with a modest dock. Preserve the selected concept's
single-mesa silhouette and inhabited oasis hierarchy. Use narrow darker shelves
and fragmented broken surf on exposed rocky sides; use broader calm
pale-aqua/turquoise shallows, sediment fans, sand tongues, and sparse reef
heads around the harbor. Keep the ecology fully arid and do not add another
island or alternative.
```

## Copperwind Port

- State: inhabited.
- Intended prepared canvas: `576 x 448`.
- Concept board:
  `concept_art/production-islands-20/desert/copperwind-port-concept-board.png`.
- Selected production source:
  `assets-src/gr3/intake/production-island-desert-copperwind-port-source.png`.
- Selected side: left.
- Selection reason: the thin cliff-backed crescent is immediately legible,
  cleanly separates dangerous outer water from the navigable port shelf, and
  makes the salt terraces read as a working coastal landscape.
- Concept-specific prompt:

```text
Copperwind Port is an inhabited crescent desert-coast island of copper-red and
rust-orange cliffs, pale sand, white and rose salt terraces, sparse gray-green
scrub, and a compact port of warm timber, rope, weathered sailcloth, ochre
stone, and one practical dock. LEFT: a narrow crescent whose tall copper cliffs
face the exposed northwest ocean while its concave southeast side holds broad
tiered salt pans and a protected inner port. RIGHT: a thicker broken crescent or
boomerang with a dramatic hooked southern horn, a small harbor notch, salt
terraces stepping down from an inland copper ridge, and a tightly clustered
port. Use sunlit copper geology and pale salt against cool teal water. Avoid
lush jungle, snow, or lava.
```

- Production-specific prompt:

```text
Use only the LEFT concept. Render a narrow asymmetric crescent island with a
tall continuous copper-red cliff spine along the exposed convex northwest
coast, pale sand and white/rose salt terraces on the sheltered inner coast,
sparse dry scrub, and a compact warm timber/rope/sailcloth port with one
practical dock. Preserve the thin crescent silhouette, cliff exposure, working
salt terraces, and compact harbor hierarchy. Deep teal presses close to the
convex cliffs with rock stacks and fragmented energetic surf; broad calm
turquoise shallows, salt sediment, sinuous channels, sand tongues, and sparse
reef heads occupy the crescent's inside.
```

## Glass Dune Isle

- State: uninhabited.
- Intended prepared canvas: `512 x 384`.
- Concept board:
  `concept_art/production-islands-20/desert/glass-dune-isle-concept-board.png`.
- Selected production source:
  `assets-src/gr3/intake/production-island-desert-glass-dune-isle-source.png`.
- Selected side: right.
- Selection reason: the tapered spear silhouette, cross-island obsidian seam,
  and paired lee-side sand spits are distinctive and navigationally memorable,
  while remaining unmistakably natural and uninhabited.
- Concept-specific prompt:

```text
Glass Dune Isle is an uninhabited long asymmetric desert barrier island of pale
wind-rippled sand, low dune ridges, sparse gray-green scrub, natural debris, and
dark obsidian/glassy rock outcrops. LEFT: a long slender S-curve with a bulbous
dune field, narrow neck, black rock ribs on the windward side, and a sheltered
lee lagoon pocket. RIGHT: a long tapered windswept spear or boomerang with
offset parallel dune ridges, a broken chain of glossy black outcrops crossing
its middle, a blunt storm-cut end, and two broad lee-side sand spits. Absolutely
no buildings, docks, boats, people, roads, ruins, or habitation. Avoid palms,
lava, or glowing fantasy crystals.
```

- Production-specific prompt:

```text
Use only the RIGHT concept. Render a long tapered asymmetric windswept
spear/boomerang barrier island with pale sand, offset parallel dune ridges,
sparse gray-green scrub, a broken cross-island chain of dark glossy obsidian
outcrops, a blunt storm-cut end, and two broad hooked lee-side sand spits.
Orient the long island diagonally. Windward dune and obsidian coasts receive a
narrow dark shelf, close deep water, black rocks, and fragmented surf; the two
lee hooks receive broad calm pale-aqua/turquoise shelves, sand tongues, sinuous
channels, and sparse submerged obsidian heads. The island must remain entirely
natural and uninhabited.
```

## Scorpion Mesa

- State: uninhabited.
- Intended prepared canvas: `448 x 512`.
- Concept board:
  `concept_art/production-islands-20/desert/scorpion-mesa-concept-board.png`.
- Selected production source:
  `assets-src/gr3/intake/production-island-desert-scorpion-mesa-source.png`.
- Selected side: left.
- Selection reason: the compact central mesa and curled ridge read as plausible
  erosion first and a scorpion second. Its hook encloses a generous lee-water
  pocket; the right option was too close to a literal animal outline.
- Concept-specific prompt:

```text
Scorpion Mesa is an uninhabited ochre sandstone island whose natural geography
suggests a hooked scorpion without becoming a literal creature. LEFT: a compact
high central mesa body, two low asymmetric sandy fore-promontories, and a long
narrow segmented sandstone tail curling into a dramatic hook around a small
lee-water pocket. RIGHT: a lower elongated mesa ridge with one broad claw-like
headland, a narrow arcing tail peninsula ending in an uplifted rock knob, and
eroded gullies across the body. Keep both geologically plausible. Use a very
narrow dark windward shelf and broad calm lee shallows. No buildings, roads,
docks, boats, people, ruins, literal eyes, or monster anatomy.
```

- Production-specific prompt:

```text
Use only the LEFT concept. Render a compact high central stepped sandstone
mesa, two low asymmetric wind-carved fore-promontories, and a long narrow
segmented sandstone ridge/peninsula curling into a dramatic hook around a broad
sheltered lee-water pocket. Preserve the iconic but geologically plausible
hooked silhouette, mesa strata, sparse dry scrub, and boulders. The exposed
windward cliff side receives a very narrow dark shelf, close deep water, rock
stacks, diagonal wavelets, and fragmented surf. Inside and below the hook,
create a broad calm irregular pale-aqua/turquoise shelf with sand tongues,
sheltered pockets, sinuous channels, and sparse reef or rock heads. Keep the
island entirely natural and uninhabited, never a literal creature.
```

## Inspection record

- Every concept board contains two complete, visually distinct alternatives
  with no labels, text, UI, borders, logos, or watermarks.
- Every retained production source contains exactly one complete centered
  island-composite, an authored deep-water apron, and ample continuous magenta
  matte on all four sides.
- Saffron Haven and Copperwind Port visibly communicate habitation through
  compact warm coastal construction and docks. Glass Dune Isle and Scorpion
  Mesa contain no habitation.
- Exposed and sheltered coasts use visibly different bathymetry and surf rather
  than fixed-width outlines.
- A targeted matte-only Saffron retry was inspected but not retained because it
  introduced greater chroma drift than the selected source; the retained source
  is the stronger connected-border input.
