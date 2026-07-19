# Tropical production-island selections

All eight retained artifacts were generated with OpenAI's built-in image-generation path. `public/assets/gr1/images/home-island.png` was used only as the approved world-scale rendering reference. Each production source was generated from the selected side of its own concept board.

The generated sources initially carried a visually subtle color-managed variation across the magenta field. A background-only built-in image-generation retry was made for Sunweave Lagoon, but exact digital color remained outside model fidelity. The final four files therefore received deterministic matte normalization with the repository PNG decoder, connected-border classifier (`matteColor: [255, 0, 255]`, `innerTolerance: 48`, `outerTolerance: 104`), and PNG encoder. Only exterior matte pixels connected to the canvas border were replaced with fully opaque `[255, 0, 255]`; island and apron pixels were preserved. All final sources are `1254 x 1254` RGBA PNGs whose complete outer pixel border is exactly `#ff00ff`.

## Sunweave Lagoon

- Habitation: inhabited
- Later runtime target: `640 x 576`
- Selected concept: left
- Selection reason: the left option has the strongest broad-oval lagoon read at navigation scale, a coherent southern inner-shore village, a clear practical dock, and the clearest contrast between exposed outer reef and calm inner shelf. Its compact opening and large quiet lagoon also leave an obvious collision silhouette.
- Concept board: `concept_art/production-islands-20/tropical/sunweave-lagoon-concept-board.png`
- Final production source: `assets-src/gr3/intake/production-island-tropical-sunweave-lagoon-source.png`

### Production-source prompt

```text
Use case: stylized-concept
Asset type: production source PNG for a Wayfinders island-composite, later prepared to a 640 x 576 runtime canvas
Input images: Image 1 is the concept board; use ONLY the LEFT Sunweave Lagoon alternative as the geographic and composition reference and ignore the right alternative. Image 2 is the approved world-scale pixel-art style reference; match its richness and apparent pixel density without copying its geography.
Primary request: Create exactly ONE single centered complete inhabited tropical island-composite, Sunweave Lagoon, on a square 1:1 canvas. Preserve the selected left concept's broad broken oval lagoon silhouette: forested oval rim, broad calm central lagoon, offset eastern opening, warm village concentrated on the southern inner shore, pale paths, and one practical wooden dock entering sheltered lagoon water.
Scene/backdrop: a perfectly flat solid #ff00ff matte surrounding the complete island and its authored water apron.
Style/medium: exceptionally rich hand-painted top-down orthographic world-scale pixel art; crisp clustered pixels, decisive silhouettes, dense but readable vegetation and built detail, warm timber/fiber/ochre highlights against cool tropical shadows, matching Image 2.
Composition/framing: true top-down orthographic, no horizon and no perspective camera. One island-composite only, centered and fully visible. Keep the oval geography slightly wider than tall for the later 640 x 576 target. Include the entire authored water apron with generous breathing room. Leave an ample, visibly thick, uniform #ff00ff border on EVERY side; no subject pixel may touch or approach the canvas edge.
Water apron: Bake a terrain-driven irregular water system into the island-composite. Outer exposed reef has narrow dark shelves, broken surf and rock fingers; inner lagoon has broad calm pale-aqua shelves, sinuous turquoise channels, reef heads, sand tongues and pockets. Gradually blend through textured intermediate water to a dark deep-ocean teal close to RGB [8,48,68] along the irregular OUTER fringe of the apron. The apron silhouette must be organic and asymmetric, not a circle, rectangle, halo, or uniform coastline dilation.
Matte invariants: the entire border/background outside the apron must be EXACTLY one perfectly uniform flat solid #ff00ff color. No shadows, glow, gradient, texture, noise, dithering, reflections, water, floor plane, antialias haze, or lighting variation on the matte. Create a crisp hard boundary between the irregular deep-teal apron fringe and the magenta matte. Do not use #ff00ff or magenta anywhere inside the island, water, buildings, vegetation, surf, rocks, or subject edges.
Habitation: clearly inhabited with a compact dignified warm timber-and-woven-fiber village, rust/ochre roofs, rope-and-shell details, worn pale paths and one lagoon dock. No generic fantasy towers and no cultural pastiche.
Constraints: exactly one island-composite; no second island, alternate panel, inset, thumbnail, frame, panel divider, title, words, letters, numbers, labels, typography, UI, HUD, icon, logo, signature, watermark, cast shadow, clipping, radial glow, concentric rings, square tile seams, photographic blur, or transparent/checkerboard background.
```

The source also received this single targeted built-in edit before deterministic matte normalization:

```text
Change ONLY the magenta matte outside the existing irregular deep-teal water apron. Replace every background/matte pixel outside the apron with one mathematically uniform pure digital #ff00ff color, RGB exactly 255,0,255. Keep the entire Sunweave Lagoon island-composite, its water apron, silhouette, scale, position, pixel art, structures, colors, details and crisp edge unchanged. No color-management tint, illumination, tonal variation, gradient, vignette, texture, noise, grain, dithering, shadow, glow, haze, reflection, floor plane or antialias wash on the matte. Preserve the square canvas, breathing room, and single centered composite; add no text, UI, logo, watermark, second island, new object, transparency, checkerboard, restyling, geometry change, or subject change.
```

## Mangrove Forks

- Habitation: inhabited
- Later runtime target: `576 x 640`
- Selected concept: left
- Selection reason: the left option reads immediately as a fan delta with one upland source and three major distributaries. The stilt settlement bridges the central channels without obscuring their navigation read, while long mangrove fingers and sediment bars give collision refinement a specific, non-circular land silhouette.
- Concept board: `concept_art/production-islands-20/tropical/mangrove-forks-concept-board.png`
- Final production source: `assets-src/gr3/intake/production-island-tropical-mangrove-forks-source.png`

### Production-source prompt

```text
Use case: stylized-concept
Asset type: production source PNG for a Wayfinders island-composite, later prepared to a 576 x 640 runtime canvas
Input images: Image 1 is the concept board; use ONLY the LEFT Mangrove Forks alternative as the geographic and composition reference and ignore the right alternative. Image 2 is the approved world-scale pixel-art style reference; match its richness and apparent pixel density without copying its geography.
Primary request: Create exactly ONE single centered complete inhabited tropical island-composite, Mangrove Forks, on a square 1:1 canvas. Preserve the selected left concept's bold fan-shaped delta silhouette: one forested upland head, a trunk river dividing into three legible main distributaries, branching mangrove peninsulas and sandy sediment fingers, a warm timber stilt settlement spanning the central channels, and one practical river dock.
Scene/backdrop: a perfectly flat solid #ff00ff matte surrounding the complete island and authored water apron.
Style/medium: exceptionally rich hand-painted top-down orthographic world-scale pixel art; crisp clustered pixels, decisive silhouettes, dense but readable mangrove, river, vegetation and built detail, warm timber/fiber/ochre highlights against cool jade and teal shadows, matching Image 2.
Composition/framing: true top-down orthographic, no horizon and no perspective camera. One coherent island-composite only, centered and fully visible. Keep the delta geography slightly taller than wide for the later 576 x 640 target. Include the entire authored water apron with generous breathing room. Leave an ample, visibly thick, uniform #ff00ff border on EVERY side; no subject pixel may touch or approach the canvas edge.
Water apron: Bake a terrain-driven irregular water system into the island-composite. The rocky upland head has narrow shelves and broken surf. Rivers flow through muted olive-jade channels to luminous turquoise shoals, wide calm branching sediment flats, sandbars, mangrove pockets and patch reefs with almost no continuous foam. Gradually blend through textured intermediate water to a dark deep-ocean teal close to RGB [8,48,68] along the irregular OUTER fringe. The apron silhouette follows the fan and branching geology, never a circle, rectangle, halo, or uniform coastline dilation.
Matte invariants: the entire border/background outside the apron must be EXACTLY one perfectly uniform flat solid #ff00ff color. No shadows, glow, gradient, texture, noise, dithering, reflections, water, floor plane, antialias haze, or lighting variation on the matte. Create a crisp hard boundary between the irregular deep-teal apron fringe and the magenta matte. Do not use #ff00ff or magenta anywhere inside the island, rivers, water, structures, vegetation, surf, rocks, or subject edges.
Habitation: clearly inhabited with a compact dignified warm timber-and-woven-fiber stilt settlement, rust/ochre roofs, raised walkways, rope-and-shell details and one river dock. Keep the three distributaries navigationally legible. No generic fantasy towers and no cultural pastiche.
Constraints: exactly one island-composite; no second island, alternate panel, inset, thumbnail, frame, panel divider, title, words, letters, numbers, labels, typography, UI, HUD, icon, logo, signature, watermark, cast shadow, clipping, radial glow, concentric rings, square tile seams, photographic blur, or transparent/checkerboard background.
```

## Moonhook Cay

- Habitation: uninhabited
- Later runtime target: `448 x 384`
- Selected concept: left
- Selection reason: the left option is the cleanest slim crescent at small scale, with a rough rock-backed outer arc, broad calm inner shelf, and a single tapered sand hook. It contains no human-made detail and provides a simple but non-circular collision target.
- Concept board: `concept_art/production-islands-20/tropical/moonhook-cay-concept-board.png`
- Final production source: `assets-src/gr3/intake/production-island-tropical-moonhook-cay-source.png`

### Production-source prompt

```text
Use case: stylized-concept
Asset type: production source PNG for a Wayfinders island-composite, later prepared to a 448 x 384 runtime canvas
Input images: Image 1 is the concept board; use ONLY the LEFT Moonhook Cay alternative as the geographic and composition reference and ignore the right alternative. Image 2 is the approved world-scale pixel-art style reference; match its richness and apparent pixel density without copying its geography.
Primary request: Create exactly ONE single centered complete uninhabited tropical island-composite, Moonhook Cay, on a square 1:1 canvas. Preserve the selected left concept's slim clockwise crescent silhouette: one long narrow forested hook around a broad calm inner shelf, blunt rocky outer horn, tapering pale sand-tongue tip and a narrow eastern opening. It must remain entirely natural and unmistakably uninhabited.
Scene/backdrop: a perfectly flat solid #ff00ff matte surrounding the complete island and authored water apron.
Style/medium: exceptionally rich hand-painted top-down orthographic world-scale pixel art; crisp clustered pixels, decisive silhouette, dense but readable foliage, palms, rocks, sand and coral detail, warm highlights against cool tropical shadows, matching Image 2.
Composition/framing: true top-down orthographic, no horizon and no perspective camera. One island-composite only, centered and fully visible. Keep the crescent geography clearly wider than tall for the later 448 x 384 target. Include the entire authored water apron with generous breathing room. Leave an ample, visibly thick, uniform #ff00ff border on EVERY side; no subject pixel may touch or approach the canvas edge.
Water apron: Bake a terrain-driven irregular water system into the island-composite. The exposed outside of the crescent has a narrow dark shelf, rock fingers and fragmented surf. The sheltered inside has a broad calm pale-aqua shelf with sinuous turquoise depth channels, dark coral heads, sand tongues and gentle irregular pockets. Gradually blend through textured intermediate water to a dark deep-ocean teal close to RGB [8,48,68] along the irregular OUTER fringe. The apron must emphasize the hook and protected inner shelf, never a circle, rectangle, halo, or uniform coastline dilation.
Matte invariants: the entire border/background outside the apron must be EXACTLY one perfectly uniform flat solid #ff00ff color. No shadows, glow, gradient, texture, noise, dithering, reflections, water, floor plane, antialias haze, or lighting variation on the matte. Create a crisp hard boundary between the irregular deep-teal apron fringe and the magenta matte. Do not use #ff00ff or magenta anywhere inside the island, water, vegetation, surf, sand, coral, rocks, or subject edges.
Habitation invariant: absolutely no buildings, roofs, huts, docks, piers, boats, paths, fences, lanterns, beacons, ruins, tools, cultivated plots, smoke, people, or other human-made objects.
Constraints: exactly one island-composite; no second island, alternate panel, inset, thumbnail, frame, panel divider, title, words, letters, numbers, labels, typography, UI, HUD, icon, logo, signature, watermark, cast shadow, clipping, radial glow, concentric rings, square tile seams, photographic blur, or transparent/checkerboard background.
```

## Three-Fin Atoll

- Habitation: uninhabited
- Later runtime target: `512 x 512`
- Selected concept: left
- Selection reason: the left option preserves three unmistakable triangular fins and two visually explicit deep-water passes. Its central lagoon, large negative water spaces, and asymmetric outer platform stay readable without buildings or navigation props.
- Concept board: `concept_art/production-islands-20/tropical/three-fin-atoll-concept-board.png`
- Final production source: `assets-src/gr3/intake/production-island-tropical-three-fin-atoll-source.png`

### Production-source prompt

```text
Use case: stylized-concept
Asset type: production source PNG for a Wayfinders island-composite, later prepared to a 512 x 512 runtime canvas
Input images: Image 1 is the concept board; use ONLY the LEFT Three-Fin Atoll alternative as the geographic and composition reference and ignore the right alternative. Image 2 is the approved world-scale pixel-art style reference; match its richness and apparent pixel density without copying its geography.
Primary request: Create exactly ONE single centered complete uninhabited tropical ATOLL-composite, Three-Fin Atoll, on a square 1:1 canvas. Preserve the selected left concept's coherent skewed three-blade silhouette: exactly three prominent palm-covered triangular sandy reef fins/islets around one luminous central lagoon, visually joined by shallow reef flats, with exactly two clear deep-water navigable passes through the reef platform. It must remain entirely natural and unmistakably uninhabited.
Scene/backdrop: a perfectly flat solid #ff00ff matte surrounding the complete atoll and authored water apron.
Style/medium: exceptionally rich hand-painted top-down orthographic world-scale pixel art; crisp clustered pixels, decisive silhouette, dense but readable palms, sand, coral heads and reef detail, warm highlights against cool tropical shadows, matching Image 2.
Composition/framing: true top-down orthographic, no horizon and no perspective camera. One coherent atoll-composite only, centered and fully visible; the three main land fins are constituent parts of this single atoll, not separate alternative islands. Include the entire authored water apron with generous breathing room. Leave an ample, visibly thick, uniform #ff00ff border on EVERY side; no subject pixel may touch or approach the canvas edge.
Water apron: Bake a terrain-driven irregular water system into the atoll-composite. Deep water presses inward through exactly two clearly readable passes. Exposed outer reef segments have fragmented ivory surf over irregular shelves; the central lagoon is calm pale aqua with turquoise channels, dark coral heads, sand tongues and gradual depth pockets. Surf is discontinuous and exposure-driven. Gradually blend through textured intermediate water to a dark deep-ocean teal close to RGB [8,48,68] along the irregular OUTER fringe. Preserve strong negative-water spaces between the three fins. The apron must follow the skewed three-fin platform, never a circle, rectangle, halo, or uniform coast dilation.
Matte invariants: the entire border/background outside the apron must be EXACTLY one perfectly uniform flat solid #ff00ff color. No shadows, glow, gradient, texture, noise, dithering, reflections, water, floor plane, antialias haze, or lighting variation on the matte. Create a crisp hard boundary between the irregular deep-teal apron fringe and the magenta matte. Do not use #ff00ff or magenta anywhere inside the atoll, water, vegetation, surf, sand, coral, rocks, or subject edges.
Habitation invariant: absolutely no buildings, roofs, huts, docks, piers, boats, paths, fences, lanterns, beacons, ruins, tools, cultivated plots, smoke, people, or other human-made objects.
Constraints: exactly one atoll-composite with exactly three main land fins and exactly two navigable passes; no alternate panel, inset, thumbnail, frame, divider, title, words, letters, numbers, labels, typography, UI, HUD, icon, logo, signature, watermark, cast shadow, clipping, radial glow, concentric rings, square tile seams, photographic blur, or transparent/checkerboard background.
```

## Inspection result

All four concept boards contain two complete, distinct, side-by-side alternatives with authored water aprons and no text or UI. All four final production sources were re-opened with the image viewer after normalization and pass the tranche-level visual checks: correct top-down view, one centered complete composite, unclipped apron, correct habitation, strong silhouette, no text/UI/watermark, deep-teal outer water, and an exact flat magenta border ready for connected-border intake.
