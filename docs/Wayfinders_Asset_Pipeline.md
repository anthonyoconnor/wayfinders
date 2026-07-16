# Wayfinders authored-asset pipeline

This document owns the current source, preparation, review, promotion, and
repository-transaction contracts. The operator sequence is in
`ASSET_PRODUCTION_QUICKSTART.md`; runtime rendering and collision behavior are
in `Wayfinders_Technical_Design.md`; future workflow scope is in
`Wayfinders_Roadmap.md`.

## Authority boundary

- `assets-src` contains source art, recipes, review data, and generated
  development artifacts.
- Prepared runtime files are generated outputs; they are never edited by hand.
- Runtime packages describe semantic identity, frame layout, origins, layers,
  animation, and collision metadata.
- Gameplay placement, terrain, interaction, and knowledge remain simulation
  authority. Asset pixels are never sampled for runtime collision.
- A production candidate may preserve or replace a visual binding without
  silently replacing accepted collision or gameplay metadata.

## Runtime packages

Package contract V1 supports:

- stable lowercase semantic IDs and explicit revisions;
- one or more bounded image slices with exact dimensions and frame layouts;
- origins, logical footprints, layer order, and animation descriptors;
- optional semantic collision metadata; and
- deterministic catalog generation and validation.

Home-island packages use sparse hybrid-grid collision: `32`-pixel navigation
cells may contain `8`-pixel overrides. The player vessel uses a declared box
hull. Fishing shoals use an explicit empty/passable profile. Other registered
runtime categories are inspectable but remain read-only until a future change
explicitly grants them authored collision authority.

Omitting fine collision metadata is a supported V1 contract: the package uses
its declared coarse terrain behavior. This is a current external data contract,
not a migration adapter.

## Asset library and candidate types

The `?mode=assets` library uses the same catalog, texture loader, Phaser
factories, and collision descriptors as the game. It can browse runtime
packages, source references, and prepared production candidates without
creating a second simulation.

Every source reference exposes guided import, and **Add PNG** starts the same
flow for a new local image. The form records only the non-inferable recipe
fields and keeps family defaults visible. A confirmed intake creates one stable
source recipe and pending candidate through a serialized local job; progress,
field errors, retry, cancellation, and refresh recovery remain in the library.

Full visual candidates carry metadata and PNG bindings for explicit repository
intake and may preserve, replace, or reset collision. Collision-only candidates
carry a target ID, base package revision, base collision fingerprint, and only
an explicit replace or reset-to-coarse intent.
The local development server exposes only the narrow validated write operations
needed by the workbench; the browser receives no general filesystem authority.

Direct collision saves are serialized with other intake operations, reject
stale revisions and fingerprints, and commit package metadata plus review data
through rollback-safe sibling-file transactions. Collision-only changes do not
rewrite PNGs or image bindings.

## Production recipe lifecycle

`assets-src/gr3/production-recipes.json` is the authoritative recipe manifest.
A recipe records stable identity, family, provenance, layer preparation,
collision draft semantics, and any existing runtime test binding.

The lifecycle is:

```text
source + recipe
    ↓ deterministic preparation
pending candidate + fingerprint + report
    ↓ exact-fingerprint review
approved or rejected
    ↓ promotion of approved current output
public runtime handoff + lineage report
```

Preparation is isolated per job. Identical inputs may reuse a cache entry;
changed source, recipe, prepared output, thumbnail, or collision draft changes
the fingerprint and invalidates review. A failed job cannot leave another job
partially updated.

Guided intake copies the selected reference or uploaded PNG under
`assets-src/gr3/intake`, appends its validated recipe, and runs deterministic
preparation inside the repository-wide intake lock. Identity conflicts are
reported instead of overwriting an existing recipe, source, or candidate.
Failure and cancellation restore the manifest and generated index and remove
new partial output.

Promotion publishes only current approved candidates. The promotion summary and
production index record source hashes, candidate fingerprints, public layer
URLs, review state, and preserved runtime bindings. Validation rejects stale
reviews, mismatched hashes, orphaned public output, and unreviewed promotion.

## Command ownership

| Command | Responsibility |
| --- | --- |
| `npm.cmd run assets:check` | Read-only validation of packages, recipes, generated artifacts, reviews, and promotion output |
| `npm.cmd run assets:build` | Regenerate package catalog, thumbnails, and reports after deliberate package/source changes |
| `npm.cmd run assets:intake -- <candidate> [--replace]` | Revalidate and materialize a portable visual or collision candidate |
| `npm.cmd run assets:prepare -- [--id <id> \| --family <family>]` | Prepare one job, one family, or the production batch |
| `npm.cmd run assets:review -- <approve\|reject> <id> <fingerprint>` | Record an exact-candidate review decision for scripting |
| `npm.cmd run assets:promote -- [--id <id>]` | Publish approved current production output |

Use the narrow command for the intended mutation. Do not run intake, prepare,
review, or promotion as generic verification. `assets:check` is the read-only
gate and is included in `npm.cmd run check`.

## Determinism and safety

- Validate PNG headers and decoded pixels, exact dimensions, frame layouts,
  non-interlaced 8-bit RGB/RGBA data, safe filenames, and the `4096 x 4096`
  per-texture limit.
- Keep catalog order, generated JSON, thumbnails, reports, and fingerprints
  deterministic.
- Keep source provenance and source-to-runtime lineage complete.
- Load large references and thumbnails on demand in the library.
- Treat source art and recipes as inputs; never repair a stale generated file
  directly.
- Keep atlas packing absent until texture or draw-call evidence justifies its
  continuing cost.

Generated collision seeding, complete pending-candidate authoring, UI-native
promotion, and isolated sea trials are not current capabilities. Their proposed
scope and authorization state live only in `Wayfinders_Roadmap.md`.
