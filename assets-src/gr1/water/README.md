# Wayfinders water milestone asset pack

Status: retained authoring source. This directory is deliberately not registered
in the live asset catalog; WTR-2 materialized its validated runtime handoff under
`public/assets/gr1/water` and its production contract under
`src/wayfinders/assets/packages/water.json`.

This pack turns four generated style masters into deterministic, grid-ready
water source sheets. The runtime-sized art uses
`32 x 32` frames and respects the internal `16 x 16` art subdivision. The 8 px
shore collision lattice is not used as an art grid.

## Review first

- `runtime/water-contact-sheet.png` is a 4-by-2 style board. Reading left to
  right, then top to bottom: abyss, deep, coastal, lagoon, reef, current, rough,
  and brackish.
- `water-package.json` is source-package metadata for preparation and review.
- `SOURCE_PROVENANCE.md` records the built-in image-generation prompt set and
  reference roles.

## Runtime-sized files

| File | Size | Purpose |
| --- | ---: | --- |
| `water-tiles.png` | 288 x 1152 | Eight frames across, four variants per water profile down |
| `water-static.png` | 144 x 288 | One reduced-motion/static frame for four variants of every profile |
| `water-depth-transitions.png` | 1692 x 144 | 47 gated eight-neighbor masks across and four phases down |
| `water-overlays.png` | 288 x 144 | Alpha clips for glints, caustics, currents, and whitecaps |
| `build-report.json` | n/a | Deterministic dimensions and SHA-256 output hashes |

The base sheet contains animated frames so it can support visual tests and rare
profile-wide motion. The intended first implementation freezes base water from
`water-static.png` and animates only sparse overlay cells. That keeps motion
restrained and avoids updating every ocean tile.

## Frame addressing

For `water-tiles.png`:

```text
sourceX = 2 + frame * 36
sourceY = 2 + (profileIndex * 4 + variant) * 36
```

For `water-depth-transitions.png`, canonicalize the eight-neighbor bit mask with
the corner rule in `water-package.json`, find it in `maskLookup`, then use:

```text
sourceX = 2 + maskIndex * 36
sourceY = 2 + phase * 36
```

Variant choice, orientation, and phase must come from a stable presentation
hash. They must never consume the terrain-generation random stream.

Every sheet uses a 2 px outer margin and 4 px spacing. Those pixels duplicate
the nearest frame edge, preventing adjacent-frame bleed under the game's
fractional zoom and antialiasing. The loader must pass `margin: 2` and
`spacing: 4` in addition to the frame dimensions.

## Rebuild

From the repository root:

```powershell
node assets-src/gr1/water/build-water-package.mjs
node assets-src/gr1/water/validate-water-package.mjs
```

The builder and validator use only Node built-ins. The four checked-in source masters are
normalized, non-interlaced 8-bit RGBA PNGs; this avoids filter incompatibilities
when the repository's minimal PNG tooling reads generated source art. Rebuilding
does not touch `public`, `dist`, source code, or any existing milestone file.

## Integration boundary

Do not copy these files into `dist`; Vite owns that directory. The milestone
implementation must first add a validated water package contract and catalog
entry, then publish accepted runtime files under `public/assets/...` through the
asset pipeline.

Authored island composites own their shoreline and shallow-to-deep transition.
This package supplies only generic ocean tiles, directional transitions, and
sparse surface overlays beneath and beyond those composites; it has no
home-specific runtime sprite.
