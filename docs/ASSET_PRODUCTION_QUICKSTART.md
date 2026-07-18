# Asset production quickstart

This is the current lightweight workflow for importing and finishing an island
in the focused Islands workspace. Ships and Fishing shoals still use their
general production tools. This is intentionally a prototype workflow, not a
general art or atlas tool.

Before generating or importing player-facing artwork, use
`Wayfinders_Art_Style_Guide.md` for visual direction and target-size review.
This quickstart continues to own the repository operation, not the look.

## Regenerate the shipped audio set

The final audio renderer is deterministic and uses the repository's Node.js
runtime; it needs no DAW, plug-in, Python package, or downloaded input. From the
repository root, run:

```powershell
npm.cmd run audio:generate
npm.cmd run audio:check
```

`audio:generate` rewrites all eleven WAVs under `public/assets/audio/v1` at the
paths already named by `public/assets/audio/audio-catalog.json`. It aborts before
rendering if that exact catalog path set has changed. It does not edit the
catalog or runtime loader. Run `git diff --stat` after generation, then use the
play-only Audio workspace at `?mode=assets&workspace=audio` to audition every
file. Finish with the full read-only gate:

```powershell
npm.cmd run assets:check
```

Future agents can change the fixed compositions, seeds, synthesis voices, or
normalization targets in `scripts/generate-audio-assets.mjs`, regenerate, and
audition the complete results. Preserve each stable ID's semantic purpose and
loop flag. A new ID, category, path, or loop behavior is a catalog/runtime
contract change, not a routine regeneration. The browser workspace remains
play-only; there is no interactive audio editor or mixer.

## Normal workflow

1. Start the prototype and open the library:

   ```powershell
   npm.cmd run dev
   ```

   Open `http://127.0.0.1:5173/?mode=assets&workspace=islands`.
2. Choose **Add PNG**. The form reads the PNG canvas immediately and keeps
   **Keep original PNG dimensions** selected by default. Enter the island name
   and stable ID. Island family, base layer, and solid collision defaults are
   automatic and are not additional form choices. Name and stable-ID conflicts are shown
   immediately and block preparation; no identity-confirmation checkbox is
   required. If a solid canvas is not divisible by `32`,
   use the offered transparent-padding action; turn off keep-original only when
   you deliberately want another output canvas.
3. Choose **Import island**. A failed or cancelled import keeps no partial
   source or island output and can be retried. When preparation completes, the
   imported island is selected automatically and starts unavailable in game.
4. Edit the island name if needed, then paint or erase the automatically seeded
   collision mask with the `8`/`32`-pixel brushes. Use undo, redo, reset, and fit
   as needed. Choose **Save changes** once to persist both the properties and
   complete collision mask.
5. Choose **View with ship**. The
   disposable trial contains only open water, the player boat, and this
   candidate's actual prepared layers and saved collision. Use the reset
   positions and grid/
   collision overlays, then return to the island. Saving and reopening the trial
   picks up the current mask.
6. Toggle **Available in game**, then choose **Save changes**. Enabling performs
   the same exact recipe, prepared-output, and collision validation; a failure
   leaves the island unavailable and reports what to correct. Disabling the
   toggle preserves the island and removes it only from subsequently created
   worlds. A subsequently created world uses the imported PNG at the exact
   placement of its saved collision canvas, uses each available island at most
   once, and fills any shortfall with procedural islands. The built-in home
   island is always available.
7. Run the read-only repository gate after an authoring session:

   ```powershell
   npm.cmd run assets:check
   ```

   The gate validates source, prepared image, recipe, and saved collision
   consistency without changing the repository.

## Optional command-line preparation

The guided library flow is normal. For scripting or deliberate batch rebuilds,
put each source under `assets-src` with a `*-source.png` name, add or reuse its
recipe in `assets-src/gr3/production-recipes.json`, then run:

```powershell
npm.cmd run assets:prepare -- --id <recipe-id>
```

Use `--family island` for a family or omit the selector for the whole batch.
A broken job is reported without preventing remaining recipes from being
attempted; unchanged jobs are cache hits.

## Optional command-line review

The general Ship and Fishing shoal workspaces retain the review surface. For
scripting, read the current
`jobKey` from `assets-src/gr3/generated/production-index.json` and record the
same exact decision through the CLI:

```powershell
$id = "<recipe-id>"
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
  "availableInGame": false
}
```

The generated `32`/`8` shoreline draft is visible and editable. Use the isolated
sea trial to test the island's prepared layers and saved collision. Marking it
available adds that stable ID and exact saved mask to subsequent deterministic
world creation; it never replaces the built-in home island.

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
