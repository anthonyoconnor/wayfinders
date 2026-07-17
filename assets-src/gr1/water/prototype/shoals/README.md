# Water prototype fishing shoals

These sprites are branch-only visual studies for WTR-1.4 and WTR-1.5. They are
loaded directly by the Water asset workspace and are not registered with the
runtime asset catalog or game simulation.

## Visual contract

The existing `public/assets/gr1/images/fishing-shoal.png` is the style and scale
authority. A fishing ground is visible through abstract water-colour changes,
broken glints, ripples, and surface breaks. Individual fish must not be visible
at the player's native scale.

The three variants match the existing gameplay quality vocabulary:

| Transparent 96 x 64 sprite | Strength | Player-scale read |
| --- | --- | --- |
| `shoal-lean.png` | Lean | Sparse glints and one faint surface break |
| `shoal-steady.png` | Steady | Regular ripples and moderate disturbance |
| `shoal-rich.png` | Rich | Bright broken churn and strong surface activity |

Water type changes placement and surrounding colour, not the implied species.
The same strength cue can therefore sit in deep, coastal, lagoon, reef,
current, rough, or brackish water without introducing visible fish.

## Animation contract

WTR-1.5 animates only the surface read: restrained shimmer, tiny water-relative
drift, and strength-scaled expanding ripple fragments. The sprites do not swim,
turn, or travel as illustrated schools. The shared Water-workspace pause control
stops their motion with the rest of the prototype.

## Generation provenance

Generation mode: built-in image generation, `stylized-concept`, one image per
strength. Both the authored source and the 96 x 64 runtime shoal were supplied
as style and scale references. Each prompt requested blue/cyan/white top-down
pixel-art water disturbance on a perfectly flat `#ff00ff` chroma-key backdrop,
with density increasing from lean to steady to rich. Every prompt explicitly
forbade visible fish bodies, silhouettes, eyes, fins, tails, seabirds, icons,
text, water rectangles, logos, and watermarks.

The generated chroma-key sources are retained in `source-keyed/`. Final sprites
were processed with the image-generation skill's chroma-key removal helper,
cropped, and nearest-neighbor fitted to transparent 96 x 64 PNG canvases.
