# CLD-1 cloud source provenance

- Runtime asset: `public/assets/cld1/clouds/cloud-sheet.png`
- Source image: `assets-src/cld1/clouds/cloud-sheet-original.png`
- Package: `src/wayfinders/assets/packages/cloud-atmosphere.json`
- Created: 2026-07-16
- Refreshed: 2026-07-18 from the supplied in-game cloud reference
- Generator path: built-in OpenAI image generation, followed by the installed
  imagegen skill's chroma-key removal helper.
- Source asset ID: `generated.cloud-atmosphere.source.v2`
- Runtime revision: `5`

The refresh used the supplied island-and-ocean screenshot as its visual-style
reference and the prior sheet as its layout target. The prompt requested four
fuller, strongly dimensional top-down pixel-art cumulus formations in the exact
two-by-two grid: a long broken cluster, compact uneven cluster, split trailing
cluster, and shallow crescent bank. It specified warm ivory upper-left
highlights, pale blue midtones, cool blue-gray undersides, detached puffs, crisp
pixel steps, generous frame padding, and a uniform `#ff00ff` background. It
prohibited baked cast shadows, text, terrain, ocean, UI, and other scene
elements because the runtime pairs each frame with its own shadow sprite.

Chroma removal sampled the border and used a soft matte with despill. One
detached component crossing the internal frame boundary was removed before the
source and runtime sheets were finalized; no runtime frame touches or crosses a
sheet boundary.

The runtime RGBA sheet is `1254 x 1254`, divided into four `627 x 627` frames.
The source is retained for provenance only and never loads at runtime.
