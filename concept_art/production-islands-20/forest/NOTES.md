# Temperate forest island art tranche

This log records the retained concept board, selected alternative, production
source, and generation prompt for each forest island. Runtime import dimensions
are planning targets; the production art sources remain square chroma-key
canvases for the authored-island intake workflow.

All eight images were generated with the built-in image-generation tool. Every
prompt used `public/assets/gr1/images/home-island.png` as a style and world-scale
pixel-density reference, not as an edit target. Each production prompt also used
its retained concept board as the geography reference. After generation, the
background-like magenta pixels and a 24-pixel outer safety band were normalized
to exact `#ff00ff`. Each production source is `1254 x 1254`, has an all-`#ff00ff`
outermost pixel border, and was visually re-inspected after cleanup to confirm
that the retained island and authored water-apron silhouettes remain intact.

## Shared board prompt contract

```text
Use case: stylized-concept
Asset type: Wayfinders game environment concept decision board
Input images: Image 1 is a style and world-scale pixel-density reference only;
do not copy its tropical geography.
Scene/backdrop: quiet dark navy-to-deep-teal open sea surrounding each complete
island, with ample water separation between alternatives.
Style/medium: top-down orthographic hand-painted pixel art matching Image 1's
crisp clustered world-scale pixels, dense-but-readable detail, decisive value
groups, organic broken contours, and warm highlights against cool shadows;
temperate forest materials and vegetation; no tropical jungle.
Composition/framing: landscape comparison board split into two equal side-by-
side alternatives by open sea; exactly one full island per half, neither island
cropped, no frames or labels.
Water/coast: irregular terrain-driven authored shallows; broader calm shelves at
sheltered shores and narrower shelves with fragmented surf at exposed shores;
never a uniform halo.
Constraints: exactly two alternatives; no labels, letters, numbers, text, title,
caption, icons, UI, HUD, panels, frames, logos, watermark, compass, map legend,
selection marks, magenta, perspective tilt, photographic blur, square tile seams,
or elements touching the outer canvas edge.
```

## Shared production prompt contract

```text
Use case: stylized-concept
Asset type: production-authored island-composite source for the Wayfinders game
Input images: Image 1 is the approved concept board and supplies only the selected
side's geography. Image 2 is the authoritative world-scale pixel-density and
finish reference.
Scene/backdrop: a perfectly flat, perfectly uniform solid #ff00ff chroma-key
matte across the entire background and all four outer borders.
Style/medium: exact top-down orthographic hand-painted pixel-art game asset;
crisp clustered Wayfinders world-scale pixels matching Image 2, decisive value
grouping, organic broken contours, temperate forest materials, no tropical palms.
Composition/framing: square 1:1 canvas; exactly one complete island centered;
generous #ff00ff padding on every side; nothing cropped or touching an edge; no
second island, comparison panel, or separate props.
Water/coast: a complete asymmetric terrain-driven shallow-water apron; broad calm
aqua-to-teal shelves at sheltered shores and narrow shelves with underwater rock
fingers and fragmented surf at exposed shores. The outermost painted fringe is
dark deep-ocean teal approaching RGB [8,48,68], with an organic broken silhouette
before the magenta matte.
Critical matte constraints: one exact unbroken flat #ff00ff color with no shadow,
glow, vignette, gradient, texture, noise, waves, reflection, floor plane, haze, or
lighting variation; no #ff00ff inside the subject.
Constraints: no text, letters, numbers, labels, title, logo, watermark, UI, HUD,
frame, compass, map legend, perspective tilt, photographic blur, antialiased
illustration look, square tile seams, rectangular ocean patch, or elements touching
the canvas edge.
```

## Cedar Crown

- Occupancy and planned runtime footprint: inhabited; `640 x 576`.
- Concept board: `concept_art/production-islands-20/forest/cedar-crown-concept-board.png`.
- Selected alternative: right.
- Selection reason: the asymmetric crown, central granite spine, readable river,
  and protected southern cove establish a stronger focal hierarchy and more
  convincing settlement-to-harbor relationship.
- Production source: `assets-src/gr3/intake/production-island-forest-cedar-crown-source.png`.
- Matte inspection: non-key bounds `167,82..1222,1137`; outer border fully keyed.

Concept-specific prompt:

```text
Create exactly two clearly different side-by-side alternatives for an inhabited
temperate-forest island named Cedar Crown. Both are broad crown-shaped conifer
islands with a small timber village, warm worn footpaths, and a sheltered wooden
dock. Left: three rounded forested headlands around a protected eastern harbor.
Right: a wider asymmetric crown with a central rocky highland, a narrow river,
and a sheltered southern cove. Use cedar, fir, pine, moss, fern, granite, muted
ochre soil, weathered timber, rope, and restrained rust-red roof accents.
```

Production-specific prompt:

```text
Reproduce only the right-hand Cedar Crown geography as one refined production
asset: a broad asymmetric crown-shaped landmass, several forested headlands, a
high central granite-and-cedar spine, a narrow river descending through small
falls into a protected southern cove, a modest timber village in connected
clearings, warm worn footpaths, and one sheltered rope-and-timber dock. Keep the
geography recognizable from the concept. The sheltered southern cove receives
the broad calm shelf and clear dock water; exposed northern and western granite
shores receive narrow shelves, underwater rock fingers, and fragmented surf.
The intended trimmed footprint is about 640 x 576; the source remains square.
```

## Mosswater Reach

- Occupancy and planned runtime footprint: inhabited; `576 x 448`.
- Concept board: `concept_art/production-islands-20/forest/mosswater-reach-concept-board.png`.
- Selected alternative: left.
- Selection reason: the low elongated silhouette and braided river-to-estuary
  sequence make the river-cut identity immediate, while the compact village
  remains secondary to the wetland geography.
- Production source: `assets-src/gr3/intake/production-island-forest-mosswater-reach-source.png`.
- Matte inspection: non-key bounds `24,212..1229,899`; outer border fully keyed.

Concept-specific prompt:

```text
Create exactly two clearly different side-by-side alternatives for an inhabited
temperate-forest island named Mosswater Reach. Both are elongated, irregular
mixed-forest islands visibly cut by fresh water, with a modest waterside timber
settlement and one rope-and-timber pier. Left: a long west-to-east island with a
braided central river widening into a reed-and-moss estuary and sheltered east
harbor. Right: a diagonal hooked island with an S-curving river, small upland lake,
alder wetlands, and a protected inner bend used by the village and pier. Use
spruce, cedar, alder, maple, moss, fern, reeds, granite, muted ochre banks,
weathered timber, rope, and restrained rust-red roofs.
```

Production-specific prompt:

```text
Reproduce only the left-hand Mosswater Reach geography as one refined production
asset: a long irregular west-to-east island, a rocky forested western upland
feeding a readable braided river, mossy channel islands and alder-reed wetlands,
a broad sheltered eastern estuary, a modest waterside timber settlement, warm
worn footpaths, and one narrow rope-and-timber pier. Keep habitation compact and
secondary to the river. Give the estuary broad calm aqua-to-teal flats, sediment
tongues, and submerged channels; give the rocky western end a narrow shelf,
underwater granite fingers, and fragmented surf. The intended trimmed footprint
is about 576 x 448; the source remains square.
```

## Splitpine Wilds

- Occupancy and planned runtime footprint: uninhabited; `512 x 512`.
- Concept board: `concept_art/production-islands-20/forest/splitpine-wilds-concept-board.png`.
- Selected alternative: right.
- Selection reason: the high tarn-and-cliff lobe and lower fallen-timber forest
  create a strong two-part identity, while the S-shaped wet saddle remains clear
  in a square footprint.
- Production source: `assets-src/gr3/intake/production-island-forest-splitpine-wilds-source.png`.
- Matte inspection: non-key bounds `116,48..1229,1137`; outer border fully keyed.

Concept-specific prompt:

```text
Create exactly two clearly different side-by-side alternatives for an uninhabited
temperate-forest island named Splitpine Wilds. Both have two strongly readable
forested lobes joined only by a low narrow mossy saddle. Left: an east-west pair
with a rugged granite-and-old-pine western lobe and lower fern-and-bog eastern
lobe, joined by a curved neck around a tiny sheltered pocket. Right: a diagonal
pair with a high conifer lobe, tarn, and broken cliffs, plus a lower mixed-forest
lobe with fallen logs and fern clearings, joined by an S-shaped wet saddle. Use
spruce, pine, cedar, alder, moss, fern, lichen, granite, peat, and muted ochre soil.
No habitation, dock, path, boat, crop, fence, or ruin.
```

Production-specific prompt:

```text
Reproduce only the right-hand Splitpine Wilds geography as one refined production
asset: two unmistakable diagonal lobes joined only by a low narrow S-shaped mossy
wet saddle. The higher northern lobe has broken granite cliffs, old conifers, a
small cold tarn, and a short waterfall. The lower southeastern lobe is rounder
and lower, with dense mixed forest, fern clearings, moss, fallen old-growth trunks,
and small peat pools. Keep the saddle visually fragile, with sheltered water
pockets on both sides. The saddle receives broader calm aqua-to-teal pockets;
exposed outer granite coasts receive narrow shelves, underwater rock fingers,
and fragmented surf. No habitation or built details. Intended trimmed footprint:
512 x 512; source remains square.
```

## Ferncoil Isle

- Occupancy and planned runtime footprint: uninhabited; `448 x 512`.
- Concept board: `concept_art/production-islands-20/forest/ferncoil-isle-concept-board.png`.
- Selected alternative: right.
- Selection reason: the nested curl is unmistakable in silhouette, and its old
  cedars, nurse logs, and fern-floor clearings distinguish it from the other
  temperate-forest islands.
- Production source: `assets-src/gr3/intake/production-island-forest-ferncoil-isle-source.png`.
- Matte inspection: non-key bounds `185,42..1169,1229`; outer border fully keyed.

Concept-specific prompt:

```text
Create exactly two clearly different side-by-side alternatives for an uninhabited
temperate-forest island named Ferncoil Isle. Both have a strong curled or spiral-
bay silhouette and dense ferns and old growth. Left: a clockwise comma-shaped
granite island whose long forested hook wraps a deep round bay, with a waterfall
at the bay head. Right: a taller unfurling-fern silhouette with a curled inner
peninsula, two nested coves linked by a narrow pass, enormous old cedars, nurse
logs, fern glades, and mossy boulders. Use ancient cedar, hemlock, spruce, maple,
giant fern, moss, lichen, nurse logs, granite, and muted ochre soil. No habitation,
dock, path, boat, crop, fence, or ruin.
```

Production-specific prompt:

```text
Reproduce only the right-hand Ferncoil Isle geography as one refined production
asset: a tall asymmetric landform resembling an unfurling fern frond, with a
strong inward-curled peninsula, near-spiral inner bay, smaller nested cove linked
by a narrow water pass, high old-growth cedar and hemlock on the outer arc, giant
nurse logs, mossy granite boulders, and dense fern glades on the inner curl. Keep
the coiled negative space immediately legible. Give the spiral bay and nested cove
broad calm jade and aqua shelves, submerged boulders, and quiet deep channels;
give the exposed outer granite arc a narrow shelf, underwater rock fingers, and
fragmented surf. No habitation or built details. Intended trimmed footprint:
448 x 512; source remains square.
```
