# Asset production quickstart

This is the lightweight GR-3 workflow for getting a source image into the asset
library, reviewing it, trying it in the game and publishing an approved visual.
It is intentionally a prototype workflow, not a general art or atlas tool.

## Normal workflow

1. Put the selected PNG anywhere under `assets-src` and name it
   `*-source.png`. Keep generated or AI output here; do not copy it directly
   into `public`.
2. Add one recipe to `assets-src/gr3/production-recipes.json`. Reuse a current
   recipe when possible and give the asset a stable ID.
3. Prepare one candidate:

   ```powershell
   npm.cmd run assets:prepare -- --id production.island.small-fishing-cay
   ```

   Use `--family island` for a family or omit the selector for the whole batch.
   A broken job is reported without preventing the remaining recipes from being
   attempted. Unchanged jobs are cache hits.
4. Start the prototype and open the library:

   ```powershell
   npm.cmd run dev
   ```

   Open `http://127.0.0.1:5173/?mode=assets`, select the candidate in the left
   browser, compare its source/prepared layers and collision overlay, then choose
   **Approve for testing** or **Reject**. The review is tied to the exact
   candidate fingerprint.
5. For an approved candidate with a pilot runtime binding, choose **Test in
   game**, or open:

   ```text
   http://127.0.0.1:5173/?testAsset=production.island.small-fishing-cay
   ```

   This is a visual test. The bound home island, player boat or fishing shoal
   keeps its already accepted collision, anchors and gameplay metadata.
6. Publish the reviewed visual handoff:

   ```powershell
   npm.cmd run assets:promote -- --id production.island.small-fishing-cay
   npm.cmd run assets:check
   ```

   Approved images and thumbnails are written under
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

## Example: another island variation

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
  "collision": { "mode": "blank-draft", "tileSize": 32, "subcellSize": 8 },
  "runtimeBinding": {
    "assetId": "home.island.primary",
    "collisionIntent": "preserve"
  }
}
```

The blank `32`/`8` collision draft is visible for review, but it is never
silently substituted for the accepted home collision. The binding makes this
variation immediately testable in the home-island slot. Creating a distinct
world island with its own final mask and placement remains an explicit runtime
package/world-data change.

## Example: passable fishing shoal variation

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

Run the same prepare, library review, in-game test and promotion commands with
the shoal recipe ID. Survey sites and other world finds can already be prepared
and previewed with the `world-feature` or `environment` families; they need a
deliberate runtime binding/package before they can be promoted or tested in a
game slot.
