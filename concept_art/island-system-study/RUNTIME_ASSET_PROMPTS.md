# Authored island runtime-source prompts

Generated with OpenAI's built-in image generation tool. The supplied team
art-direction screenshot was the shared style reference; the matching concept
study was also supplied for Crescent Cay, Lightning Ridge, River Delta, and Star
Atoll. These prompts create art sources, not collision masks.

## Shared runtime prompt

Create a single square 1:1 top-down orthographic pixel-art island game asset on
a perfectly flat solid `#ff00ff` chroma-key background. Match the reference's
rich hand-painted pixel art, crisp clustered pixels, warm highlights, cool
shadows, dark navy-to-deep-teal ocean, directional wavelets, sparse broken
whitecaps, irregular turquoise bathymetry, fragmented surf, warm sand, dense
tropical vegetation, readable paths, and detailed small structures. Show the
entire island plus a generous authored water apron. The water transition must be
asymmetric and terrain-driven: exposed shores have narrow shelves and rough
broken surf; sheltered shores have broad calm shallows, channels, reef heads,
bars, and pockets. The outer fringe must already be dark deep-ocean teal and
break into an irregular dithered silhouette so it can fade into transparency and
join the moving game sea without a rectangular or circular edge. No uniform
coast-following halo, concentric rings, abrupt color bands, radial glow, square
tile seams, UI, text, labels, border, shadow outside the asset, or elements
touching the canvas edge. Keep at least a slim clean chroma-key margin on every
side.

## Home Island

Use the team art-direction screenshot as the geographic and stylistic target.
Create the lush inhabited home island with a warm central village, winding pale
paths, dense jungle, a rocky waterfall and pool toward the northwest, sandy
beaches, and the large east-facing wooden dock and sheltered cove. Surround it
with a broad but irregular reef shelf: darker and tighter on exposed coasts,
wider around the eastern cove and southern sand tongues, with broken foam,
submerged rocks, reef patches, and gradual aqua-to-teal depth changes. Preserve
clear navigable water at the dock.

Runtime destinations:

- `assets-src/gr1/home-island-source.png`
- `public/assets/gr1/images/home-island.png`

## Crescent Cay

Create a compact crescent-shaped tropical cay around a sheltered inner lagoon.
The northwest exterior is wind-battered with a narrow dark shelf, rock fingers,
and broken surf. The inner crescent has broad pale-aqua water, sinuous turquoise
channels, patch reefs, a small fishing hamlet, and a modest lagoon jetty. Make
the outer and inner coasts visibly different while keeping one coherent apron.

Runtime source:
`assets-src/gr3/intake/production-island-island-01-crescent-cay-uninhabited-source.png`

## Lightning Ridge

Create a long jagged northwest-to-southeast island dominated by a dark cliff
spine, dense jungle gullies, waterfalls, and a tiny protected eastern cove with
a modest jetty. Deep water and energetic fragmented surf press close against the
exposed western cliffs. A broad irregular luminous shelf, coral patches, and
calmer water bulge far out on the lee side. Avoid bilateral symmetry.

Runtime source:
`assets-src/gr3/intake/production-island-island-lightning-ridge-uninhabited-source.png`

## River Delta

Create a larger inhabited delta island with two lush upland arms, terraced
fields, waterfalls, braided blue rivers, a warm village, bridges, a riverside
dock, and a wide southern fan of mangrove islets and sandy channels. The rocky
northern coasts have narrow shelves and broken surf; the southern delta has
broad calm luminous flats, branching sediment shoals, reef patches, and almost
no continuous foam. Keep the branching water geography readable after
downscaling.

Runtime source:
`assets-src/gr3/intake/production-island-river-delta-inhabited-source.png`

## Star Atoll

Create an irregular five-armed coral atoll made of palm-covered sandy islets
around a luminous central lagoon. Connect arms with shallow reef flats while
leaving deep navigable passes. Use discontinuous surf on exposed outer reef,
calm aqua channels inside, dark coral heads, sand tongues, and strong negative
water spaces between the arms. No village; only minimal weathered navigation
details.

Runtime source:
`assets-src/gr3/intake/production-island-island-star-atoll-uninhabited-source.png`

## Conversion and preparation

The generated solid-magenta background was converted to soft transparency with
the image-generation skill's `remove_chroma_key.py` helper using automatic border
keying, a soft matte, despill, transparent threshold 12, and opaque threshold
220. Production preparation then trims connected transparency, contains the art
inside its existing runtime canvas, and guarantees a fully transparent outer
pixel border. For an imported `island-composite`, intake automatically applies
an inward fade of approximately one eleventh of the shorter canvas dimension
(`round(min(width, height) / 11)`, clamped to `4..128` pixels). Fade-band RGB
converges on the measured default deep-water median `[8, 48, 68]` while alpha
falls inward with squared coverage, so transparent-edge filtering joins the
painted apron to the real game sea instead of exposing a coloured halo.

The selected runtime recipes retain live-reviewed overrides where the painted
deep-water apron is narrower than the canvas-derived default: Crescent Cay and
Star Atoll use `64` pixels, while Lightning Ridge and River Delta use `96`
pixels. These values are presentation-only and do not alter island placement or
the independently authored collision shape.

Home uses the same edge-colour convergence but remains a retained package rather
than a normal imported candidate. Its converted `1254 x 1254` source received a
manual `112`-pixel inward preparation before the identical bytes were placed at
the two Home runtime destinations above.

Preparation also creates the editable `8`-pixel centered-circle collision draft.
The collision shape is intentionally independent from painted water and must be
refined manually in Asset Tools where the island silhouette requires it.
