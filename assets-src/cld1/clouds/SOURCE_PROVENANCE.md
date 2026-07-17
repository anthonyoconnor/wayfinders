# CLD-1 cloud source provenance

- Runtime asset: `public/assets/cld1/clouds/cloud-sheet.png`
- Source image: `assets-src/cld1/clouds/cloud-sheet-original.png`
- Package: `src/wayfinders/assets/packages/cloud-atmosphere.json`
- Created: 2026-07-16
- Generator path: built-in OpenAI image generation, followed by the installed
  imagegen skill's chroma-key removal helper.
- Runtime revision: `1`

The source prompt requested four isolated top-down pixel-art cloud formations
in an exact two-by-two grid on a uniform `#ff00ff` background: a long broken
wisp, compact uneven cluster, split trailing wisps, and shallow crescent bank.
It constrained the cloud palette to pale off-white and blue-gray, prohibited
text, shadows, weather, terrain, and perspective, and required generous cell
padding. Chroma removal sampled the border and used a soft matte with despill.

The runtime RGBA sheet is `1254 x 1254`, divided into four `627 x 627` frames.
The source is retained for provenance only and never loads at runtime.
