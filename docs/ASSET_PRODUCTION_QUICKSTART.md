# Asset production quickstart

This is the current lightweight workflow for getting a source image into the
asset library, finishing its candidate, sea-trialing its exact collision, and
publishing an approved visual. It is intentionally a prototype workflow, not a
general art or atlas tool.

## Normal workflow

1. Start the prototype and open the library:

   ```powershell
   npm.cmd run dev
   ```

   Open `http://127.0.0.1:5173/?mode=assets`.
2. Select any source reference and choose **Import and prepare**, or choose
   **Add PNG** for a new local image. The form reads the PNG canvas immediately
   and keeps **Keep original PNG dimensions** selected by default. Review the
   inferred family, asset name, stable ID, layer role, collision semantics, and
   optional runtime/test category. Name and stable-ID conflicts are shown
   immediately and block preparation; no identity-confirmation checkbox is
   required. If a solid canvas is not divisible by `32`,
   use the offered transparent-padding action; turn off keep-original only when
   you deliberately want another output canvas.
3. Choose **Prepare pending candidate**. The library reports validation,
   repository-write and preparation phases. A failed or cancelled job keeps no
   partial source, recipe or candidate output and can be retried from the same
   form. When preparation completes, choose **Open pending candidate** to reload
   the durable library record.
4. Compare source and prepared layers, inspect the seed method and warnings, and
   finish the candidate in its structured editor. Adjust supported settings and
   layer visibility/opacity, then paint or erase the `8`/`32`-pixel collision
   draft as needed. Choose **Save candidate** before reviewing or trialing edits.
   Save prepares the affected output, issues a new fingerprint, and returns the
   candidate to pending review.
5. Choose **Validate current** and, for an island, **Trial candidate**. The
   disposable trial contains only open water, the player boat, and this
   candidate's actual prepared layers and saved collision. Use the reset
   positions and grid/
   collision overlays, then **Return to candidate**. A pending candidate may be
   trialed; saving and relaunching picks up the new fingerprint and mask.
6. Choose **Approve current** or **Reject current**. Review is tied to the exact
   current fingerprint. Once a valid candidate is approved, choose
   **Promote approved** in the same workbench. Stale or invalid candidates cannot be
   approved or published; an exact-current candidate may still be rejected.
7. Run the read-only repository gate after a publishing session:

   ```powershell
   npm.cmd run assets:check
   ```

   Promoted images and thumbnails are written under
   `public/assets/gr3/production`. The deterministic
   `production-assets.json` records source hashes, candidate fingerprint,
   public layer URLs and the preserved runtime-collision binding. Pending and
   rejected candidates are not published. The readiness/review queue is written
   to `assets-src/gr3/generated/promotion-summary.json`.

Changing a recipe or source creates a new candidate fingerprint and requires a
new review. Modifying a prepared image, thumbnail or collision draft makes the
derived output gate stale; run preparation again before promotion. Re-review
whenever the resulting fingerprint changes. `assets:check` rejects stale
reviews, output hashes and orphaned public production files.

## Optional command-line preparation

The guided library flow is normal. For scripting or deliberate batch rebuilds,
put each source under `assets-src` with a `*-source.png` name, add or reuse its
recipe in `assets-src/gr3/production-recipes.json`, then run:

```powershell
npm.cmd run assets:prepare -- --id production.island.small-fishing-cay
```

Use `--family island` for a family or omit the selector for the whole batch.
A broken job is reported without preventing remaining recipes from being
attempted; unchanged jobs are cache hits.

## Optional command-line review

The asset library is the normal review surface. For scripting, read the current
`jobKey` from `assets-src/gr3/generated/production-index.json` and record the
same exact decision through the CLI:

```powershell
$id = "production.island.small-fishing-cay"
$entry = (Get-Content assets-src/gr3/generated/production-index.json | ConvertFrom-Json).entries |
  Where-Object id -eq $id
npm.cmd run assets:review -- approve $id $entry.jobKey
npm.cmd run assets:promote -- --id $id
```

Use `reject` instead of `approve` to keep the candidate out of public output.

## Advanced manual recipe: another island variation

Add the source PNG, then add a recipe shaped like this (names and paths are
examples):

```json
{
  "id": "production.island.mangrove-harbour",
  "name": "Mangrove Harbour",
  "family": "island",
  "lifecycle": "source",
  "collection": "Island production sources",
  "sortOrder": 60,
  "tags": ["island", "mangrove", "harbour", "source"],
  "provenance": {
    "kind": "selected-source",
    "sourceFile": "assets-src/gr1/island-mangrove-harbour-source.png"
  },
  "layers": [
    {
      "id": "base",
      "name": "Base island",
      "role": "base",
      "sourceFile": "assets-src/gr1/island-mangrove-harbour-source.png",
      "defaultVisible": true,
      "opacity": 1,
      "blendMode": "normal",
      "preparation": {
        "mode": "connected-border",
        "targetWidth": 480,
        "targetHeight": 480,
        "thumbnailMaximum": 192,
        "matteColor": [255, 0, 255],
        "innerTolerance": 48,
        "outerTolerance": 104,
        "trimAlphaThreshold": 8,
        "padding": 8
      }
    }
  ],
  "animations": [],
  "collision": { "mode": "shoreline-seed", "tileSize": 32, "subcellSize": 8 },
  "runtimeBinding": {
    "assetId": "home.island.primary",
    "collisionIntent": "preserve"
  }
}
```

The generated `32`/`8` shoreline draft is visible and editable, but it is never
silently substituted for the accepted home collision. The binding records the
intended runtime handoff; it does not enable a full-game candidate override.
Use the isolated sea trial to test the candidate's own prepared layers and
saved collision. Creating a distinct world island with its own final mask and
placement remains an explicit runtime package/world-data change.

## Advanced manual recipe: passable fishing shoal variation

Shoals are explicitly passable. A minimal visual variation can use the same
connected-border preparation but must declare an empty collision profile:

```json
{
  "id": "production.shoal.silver-current",
  "name": "Silver Current Shoal",
  "family": "shoal",
  "lifecycle": "source",
  "collection": "Shoal production sources",
  "sortOrder": 10,
  "tags": ["shoal", "fishing", "source"],
  "provenance": {
    "kind": "selected-source",
    "sourceFile": "assets-src/gr1/shoal-silver-current-source.png"
  },
  "layers": [
    {
      "id": "base",
      "name": "Shoal",
      "role": "base",
      "sourceFile": "assets-src/gr1/shoal-silver-current-source.png",
      "defaultVisible": true,
      "opacity": 1,
      "blendMode": "normal",
      "preparation": {
        "mode": "connected-border",
        "targetWidth": 96,
        "targetHeight": 64,
        "thumbnailMaximum": 192,
        "matteColor": [255, 0, 255],
        "innerTolerance": 48,
        "outerTolerance": 104,
        "trimAlphaThreshold": 8,
        "padding": 4
      }
    }
  ],
  "animations": [],
  "collision": { "mode": "empty", "reason": "Fishing shoals are passable" },
  "runtimeBinding": {
    "assetId": "shoal.fishing.primary",
    "collisionIntent": "preserve"
  }
}
```

Run the same preparation, structured review, and promotion flow with the shoal
recipe ID. Survey sites and other world finds can already be prepared and
previewed with the `world-feature` or `environment` families; they need a
deliberate runtime binding/package before promotion or runtime integration. The
isolated sea trial is for solid island candidates with a saved hybrid collision
draft.
