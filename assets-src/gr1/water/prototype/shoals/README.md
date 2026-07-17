# Water prototype fishing shoals

These sprites are branch-only visual studies for WTR-1.4 and WTR-1.5. They are
loaded directly by the Water asset workspace and are not registered with the
runtime asset catalog or game simulation.

## Sprite set

| Transparent sprite | Intended water | Visual direction |
| --- | --- | --- |
| `abyss-lantern.png` | Abyss | Bioluminescent lanternfish crescent |
| `deep-mackerel.png` | Deep | Flowing blue-mackerel teardrop |
| `coastal-sardine.png` | Coastal | Compact sardine bait ball |
| `lagoon-fry.png` | Lagoon | Loose turquoise-and-gold fry clusters |
| `reef-butterfly.png` | Reef | Broken-ring butterflyfish school |
| `current-needle.png` | Current | Two fast needlefish ribbons |
| `rough-bonito.png` | Rough | Staggered bonito wedge with spray |
| `brackish-mullet.png` | Brackish | Olive mullet fan with stragglers |

## Generation provenance

Generation mode: `stylized-concept`, one image per sprite. Every prompt asked
for a top-down pixel-art fishing-shoal game sprite for the Wayfinders Water
asset viewer, a perfectly flat `#ff00ff` chroma-key backdrop, crisp handcrafted
pixel art, a nautical adventure aesthetic, generous padding, readability at
roughly 96 pixels, and no text, logo, watermark, or surrounding water patch.
The individual prompt subjects and formations are the eight directions listed
above.

The original generated chroma-key outputs are retained in `source-keyed/`.
Final sprites were processed with the image-generation skill's chroma-key
removal helper, cropped, and nearest-neighbor fitted to transparent 256 x 256
PNG canvases.
