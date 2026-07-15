# Wayfinders water milestone asset pack

Status: proposal assets only. This directory is deliberately not registered in
the live asset catalog and does not change the current renderer, terrain,
collision, or milestone documents.

This pack turns four generated style masters into deterministic, grid-ready
water sheets for the proposed water-system milestone. The runtime-sized art uses
`32 x 32` frames and respects the internal `16 x 16` art subdivision. The 8 px
shore collision lattice is not used as an art grid.

## Review first

- `runtime/water-home-island-preview.png` shows the deep-to-shallow handoff under
  the current `480 x 480` home-island image.
- `runtime/water-contact-sheet.png` is a 4-by-2 style board. Reading left to
  right, then top to bottom: abyss, deep, coastal, lagoon, reef, current, rough,
  and brackish.
- `water-package.json` is the proposed loader/animation contract.
- `SOURCE_PROVENANCE.md` records the built-in image-generation prompt set and
  reference roles.

## Runtime-sized files

| File | Size | Purpose |
| --- | ---: | --- |
| `water-tiles.png` | 256 x 1024 | Eight frames across, four variants per water profile down |
| `water-static.png` | 128 x 256 | One reduced-motion/static frame for four variants of every profile |
| `water-depth-transitions.png` | 1504 x 128 | 47 gated eight-neighbor masks across and four phases down |
| `water-overlays.png` | 256 x 128 | Alpha clips for glints, caustics, currents, and whitecaps |
| `water-home-shore-overlay.png` | 3840 x 480 | Eight 480 px frames aligned exactly to `home.island.primary` |
| `build-report.json` | n/a | Deterministic dimensions and SHA-256 output hashes |

The base sheet contains animated frames so it can support visual tests and rare
profile-wide motion. The intended first implementation freezes base water from
`water-static.png` and animates only sparse overlay cells and the home-aligned
shore clip. That keeps motion restrained and avoids updating every ocean tile.

## Frame addressing

For `water-tiles.png`:

```text
sourceX = frame * 32
sourceY = (profileIndex * 4 + variant) * 32
```

For `water-depth-transitions.png`, canonicalize the eight-neighbor bit mask with
the corner rule in `water-package.json`, find it in `maskLookup`, then use:

```text
sourceX = maskIndex * 32
sourceY = phase * 32
```

Variant choice, orientation, and phase must come from a stable presentation
hash. They must never consume the terrain-generation random stream.

## Rebuild

From the repository root:

```powershell
node assets-src/gr1/water/build-water-package.mjs
```

The builder uses only Node built-ins. The four checked-in source masters are
normalized, non-interlaced 8-bit RGBA PNGs; this avoids filter incompatibilities
when the repository's minimal PNG tooling reads generated source art. Rebuilding
does not touch `public`, `dist`, source code, or any existing milestone file.

## Integration boundary

Do not copy these files into `dist`; Vite owns that directory. The milestone
implementation must first add a validated water package contract and catalog
entry, then publish accepted runtime files under `public/assets/...` through the
asset pipeline.

The authored home island already contains an organic turquoise shore fringe,
foam, harbor water, and a transparent exterior. Water must continue under those
transparent pixels. Generic grid foam stays below the composition; only
`water-home-shore-overlay.png`, positioned at the same top-left and scale as the
home island, may render above it.
