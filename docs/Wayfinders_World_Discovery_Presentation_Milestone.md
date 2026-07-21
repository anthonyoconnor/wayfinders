# Wayfinders Home and island de-labelling milestone

Status: `GR-6.1` implementation complete; live browser acceptance pending.
Planning and authorization status belong only in `Wayfinders_Roadmap.md`.

## Product intent

The persistent `HOME ISLAND` caption and the names and marker graphics floating
beside non-home islands are absent. The island art itself is the complete
persistent world presentation.

This milestone does not replace other discovery presentation. Fishing shoals,
survey sites, navigator wrecks, discovery notices, the survey ribbon, and the
current-voyage achievement strip remain unchanged.

## Current scoped presentation

| Subject | Remove | Retain |
| --- | --- | --- |
| Home | Floating `HOME ISLAND` caption | Authored inhabited island, harbour, dock, Home action, and Great Hall access |
| Non-home island | Chart icon, letter badge, generated name, state/finding caption, and lifecycle ring | Island art, sighting and survey notices, survey ribbon, generated name and dossier data, fog reveal, and Great Hall records |

## Impact and authority boundary

Removing these presentation objects does not change island sighting.

- `VisibilitySystem` still computes current sight.
- `IslandDossierSystem` still sights a non-home island when its island ID enters
  the visible tile set.
- The scene no longer creates or synchronizes persistent island marker views;
  the same sighted and surveyed records remain available to their contextual
  and historical consumers.
- Generated names, dossier results, achievements, interaction range, survey
  cost, island fog reveal, return, and wreck rollback remain authoritative and
  unchanged.

The Home caption is also presentation-only. Removing it does not change the
Home landmark, exact dock, replenishment, return settlement, Great Hall access,
music state, or navigation.

The player-facing risk is visual recognition rather than simulation behavior.
Home must remain distinguishable through its inhabited island, harbour, and
dock, while non-home islands remain visible through their landform and current
sight. The existing contextual survey ribbon continues to communicate when an
island survey is available, so this milestone does not add a replacement
approach marker or interaction language.

Presentation resource counts and renderer tests reflect removal of the Home
Phaser text object and island dossier marker objects. Active-chunk
bounds, periodic aliasing, fog filtering, and stable-frame allocation contracts
remain.

## GR-6.1 — Home and island de-labelling

### Implemented scope

- Removed the `HOME ISLAND` Phaser text object and its resource accounting from
  `WorldRenderer`.
- Removed the chart glyph, letter badge, generated name, state/finding label,
  lifecycle ring, and their persistent world renderer.
- Removed obsolete label and badge formatting code and tests that protected
  those presentation objects.
- Preserved generated island names and dossier findings in feature contracts,
  events, notices, the survey ribbon, accessible detail, lineage, and the Great
  Hall.
- Preserved all existing fishing-shoal, survey-site, navigator-wreck, discovery
  notice, survey-ribbon, and current-voyage presentation.

### Acceptance

- The default sailing world contains no `HOME ISLAND` caption and no persistent
  non-home island name, dossier caption, chart icon, letter badge, or lifecycle
  ring.
- Same-seed travel produces identical island sighting events, provisional and
  returned records, survey eligibility, provision charges, dossier results,
  island fog reveal, voyage achievements, wreck rollback, lineage, and
  completion results.
- Home remains visually identifiable and the exact dock remains usable at
  normal and map-review zoom without adding a replacement label or marker.
- Non-home islands remain visible through their world art, and the existing
  survey ribbon remains available at every valid nearby survey approach.
- Wrapped island images and active-chunk activation create no duplicate or
  stale presentation objects.
- Renderer telemetry, teardown, object-count, and resource-plateau assertions
  reflect the lower object baseline.
- `check:quick`, source and test typechecks, the focused renderer tests, and live
  browser verification pass.

Automated acceptance is complete: the focused renderer contract, source and
test typechecks, `check:quick`, integration lane, and production bundle pass.
The full contract lane reaches the unrelated in-progress production-island
recipe fixture and reports its existing `29`-versus-`28` recipe-count drift.
Live browser verification remains pending because the current in-app browser
session rejected the local development URL.

## Non-goals

- changing current-sight radius, blockers, or island sighting;
- changing island names, dossier content, survey range, cost, or lifecycle;
- adding replacement Home, island, coast, or approach art;
- removing or revising fishing-shoal presentation;
- removing or revising survey-site or navigator-wreck presentation;
- changing discovery notices, the survey ribbon, or current-voyage icons;
- changing Great Hall symbols or records; or
- using island pixels as gameplay authority.
