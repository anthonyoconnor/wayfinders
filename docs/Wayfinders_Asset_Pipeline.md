# Wayfinders authored-asset pipeline

This document owns the current source, preparation, island availability,
general-family review/promotion, and repository-transaction contracts. The operator sequence is in
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

The CLD-1 atmosphere sheet is a presentation-only runtime package outside the
collision-authoring catalog. `src/wayfinders/assets/packages/cloud-atmosphere.json`
owns its stable identity, four `627 x 627` frame layout, variant names, opaque
pixel bounds, and bounded paired cloud/shadow presentation metadata. Its
retained source and provenance live under
`assets-src/cld1/clouds`; the prepared RGBA sheet lives under
`public/assets/cld1/clouds`. `scripts/cloud-asset-check.mjs`, included in
`assets:check`, validates source/runtime dimensions, frame count, unique variant
coverage, RGBA format, per-frame opaque bounds, and the presence of both
transparent and visible pixels.
The asset has no collision, gameplay binding, asset-library workspace, intake,
or repository-authoring path.

## Asset library and candidate types

The `?mode=assets` library uses the same catalog, texture loader, Phaser
factories, and collision descriptors as the game. Its clean baseline contains
the home island, player boat, and fishing shoal runtime packages. Uploaded PNGs
add prepared production candidates without creating a second simulation.

**Add PNG** starts guided intake for a new local image. In the Islands
workspace, family, layer role, solid collision semantics, and runtime category
are fixed island defaults rather than operator fields. The form reads the PNG's
native canvas immediately, derives the editable asset name from the filename,
and defaults to keeping its dimensions. When manual dimensions are enabled, an
aspect-ratio lock updates width or height from the other value using the source
PNG ratio. A solid candidate whose
native canvas is not
divisible by `32` receives an explicit warning and a one-action transparent-pad
option to the next aligned canvas. Manual output dimensions remain available
when the operator intentionally wants a different canvas. The form otherwise
records only non-inferable recipe fields. General-family controls remain in the
Ship and Fishing shoal production surfaces.
Existing recipe names and stable IDs are checked immediately and block
submission; the serialized repository transaction repeats both checks before
creating one stable source recipe and pending candidate. Progress, field errors,
retry, cancellation, and refresh recovery remain in the library.

In asset-library mode, the library and workbench are permanent left and right
columns. The Phaser preview owns only the centre column, so camera zoom and pan
cannot render underneath either authoring surface.

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

Imported islands use the focused Islands workbench. The selected left-library
record alone drives the preview and exposes only name, current availability,
the isolated ship trial, `8`/`32`-pixel collision editing, and **Save changes**.
One save writes the editable name, exact complete live mask, and durable
`availableInGame` value through the serialized transaction. Candidate
fingerprints remain private transaction details. Review, promotion, and runtime
binding do not apply to islands. General pending candidates in the other
workspaces retain their structured production workbench.

## Production recipe and availability lifecycles

`assets-src/gr3/production-recipes.json` is the authoritative recipe manifest.
A recipe records stable identity, family, provenance, layer preparation, and
collision semantics. Island recipes also carry the only user-facing lifecycle
state, `availableInGame`; other families may carry an existing runtime test
binding.

The island lifecycle is:

```text
imported and unavailable
    ↓ edit name or exact mask, and save as often as needed
available in game ↔ unavailable in game
```

Enabling availability validates the current PNG, recipe, prepared output, and
saved mask inside one rollback-safe transaction. Failure preserves the prior
unavailable state. Disabling availability does not delete any source or derived
artifact. The resulting immutable game catalog is sorted by stable ID and is
read only during world creation. Island review and promotion operations reject
island IDs.

The focused Islands workbench exposes **Delete imported island** only for a
selected imported island. After confirmation, the operation verifies the
current fingerprint and atomically removes the recipe, generated index and
review records, source PNG, semantic mask, and prepared candidate directory.
A stale browser cannot delete a newer candidate, and any failure restores both
records and files. The built-in home island cannot be deleted.

Availability projects two revision-matched read-only snapshots from the same
prepared records. World generation receives only stable identity, saved grid
dimensions, and exact collision. Presentation receives prepared visible-layer
URLs, canvas dimensions, opacity/blend metadata, and immutable texture keys.
The renderer resolves the stable asset ID recorded by world planning and aligns
the PNG canvas to the same bounds; neither snapshot samples pixels for gameplay
authority. A missing or stale presentation snapshot falls back to the complete
developer island visual.

For Ships, Fishing shoals, and other general families, the lifecycle remains:

```text
source + recipe
    ↓ deterministic preparation
pending candidate + fingerprint + report + editable collision draft
    ↓ structured save and affected-output preparation, repeat as needed
current pending candidate with a new fingerprint
    ↓ exact-fingerprint review
approved or rejected
    ↓ promotion of approved current output
public runtime handoff + lineage report
```

Preparation is isolated per job. Identical inputs may reuse a cache entry;
changed source, recipe, or authored mask input changes the fingerprint. For
general families this invalidates review. A modified or missing prepared output, thumbnail, or
generated collision draft makes the derived output stale without changing the
input fingerprint. A failed job cannot leave another job partially updated.

Guided intake copies the uploaded PNG under
`assets-src/gr3/intake`, appends its validated recipe, and runs deterministic
preparation inside the repository-wide intake lock. Duplicate names and stable
IDs are reported instead of overwriting an existing recipe, source, or candidate.
Failure and cancellation restore the manifest and generated index and remove
new partial output.

For island recipes, preparation derives a best-effort shoreline seed from the
prepared alpha at `8`-pixel subcell resolution inside the `32`-pixel navigation
grid. Connected opaque geometry retains fine projections and concavities;
isolated low-coverage noise is ignored. The draft records a deterministic
method ID and warnings for blank, disconnected, edge-touching, or unusually
broad geometry. This is an editable seed and cannot make the island available
until its exact saved mask validates. Passable families continue to produce explicit
empty collision.

For an imported island, **Save changes** validates the name and complete
collision draft against the current repository record, writes recipe and
semantic mask data, and prepares only that island under the shared lock. For
general candidates, **Save candidate** validates structured settings and the
complete collision
draft against the current fingerprint, writes recipe and semantic mask data,
and prepares only the affected candidate under the shared repository lock. The
operation is rollback-safe. A successful save must issue a different
fingerprint and reproduce the authored collision exactly. Island saves also
persist availability and remove any obsolete island review record. General
candidate saves invalidate prior review so the refreshed candidate is pending.

Promotion publishes only current approved non-island candidates. The promotion summary
and production index record source hashes, candidate fingerprints, public
layer URLs, review state, and preserved runtime bindings. The UI invokes the
same exact-fingerprint promotion seam as the scripting command. Validation
rejects stale reviews, mismatched hashes, orphaned public output, and unreviewed
promotion.

Imported islands with a current prepared record can be opened in the isolated
sea trial regardless of availability. The trial loads the island's
actual prepared layers and exact saved hybrid collision into a disposable open-
water world with the authored player boat. It provides hull-safe reset points,
navigation and collision overlays, visible fingerprint, dimensions, origin,
and collision revision, and a direct return to the same library record. The
trial does not create `GameSimulation`, save trial state, change availability,
or alter world content.

## Command ownership

| Command | Responsibility |
| --- | --- |
| `npm.cmd run assets:check` | Read-only validation of packages, recipes, generated artifacts, reviews, and promotion output |
| `npm.cmd run assets:build` | Regenerate package catalog, thumbnails, and reports after deliberate package/source changes |
| `npm.cmd run assets:intake -- <candidate> [--replace]` | Revalidate and materialize a portable visual or collision candidate |
| `npm.cmd run assets:prepare -- [--id <id> \| --family <family>]` | Prepare one job, one family, or the production batch |
| `npm.cmd run assets:review -- <approve\|reject> <id> <fingerprint>` | Record an exact non-island candidate review decision for scripting |
| `npm.cmd run assets:promote -- [--id <id>]` | Publish approved current non-island production output for scripting or batch operation |

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
- Treat generated collision as an editable seed and require an exact current
  fingerprint for authoring and trial launch. Review and promotion remain
  additional exact-fingerprint gates only for non-island families.
- Keep atlas packing absent until texture or draw-call evidence justifies its
  continuing cost.
