# Wayfinders implementation status

This file is the continuation point for prototype work. The project is intentionally paused after Milestone 3 for the review gate in `Wayfinders_Prototype_Milestones.md`.

## Milestone 0 — Developer Sandbox

Status: complete

- Browser application scaffold: Phaser 3.90, TypeScript, Vite and Vitest.
- Deterministic seeded world generation and a live, mutable prototype configuration.
- Developer tools for water-tile teleportation by coordinate or click.
- Runtime provision add/remove controls.
- Live controls for sight, provisions, movement costs, speed, risk thresholds, overlay opacity and fog presentation.
- Toggles for navigation grid, line of sight, forward range and return viability.
- Regeneration from the currently entered seed without a restart.
- Browser automation surface exposed as `window.__WAYFINDERS__`.

Verification: TypeScript check, 20 unit tests and a production Vite build pass.

## Milestone 1 — Home Waters

Status: complete

- Recognisable seeded home island with coastline, huts, harbour flag, dock and labelled home.
- Visually distinct supported water surrounding the home, including boundary buoys.
- Continuous WASD/arrow-key ship movement with a readable heading and wake.
- Terrain-authoritative island, rock and reef collision.
- Smooth follow camera with wheel or Q/E zoom and bounded world view.
- Developer-art ocean, shallow water, reefs and wave marks.
- DOM state markers on the game host for browser-driven verification.

Verification: TypeScript check, 21 unit tests, production build and an in-browser sailing/control check pass.

## Milestone 2 — Exploration

Status: complete

- Circular, blocker-aware current line of sight using the live configured radius.
- Unknown cells observed during the current voyage become expedition-stamped Personal knowledge.
- Every crossed navigation-tile centre is observed, preventing gaps during fast or diagonal movement.
- Near-black Unknown fog, grey Personal water and full-colour current visibility.
- Bilinear, noise-softened transitions rendered from reusable chunk-updated mask data.
- Debug sight-ring toggle is tied to the same radius used by the simulation.
- Browser-readable knowledge/visibility counts for deterministic play checks.

Verification: TypeScript check, 23 unit tests, production build, and an in-browser voyage from Supported into Unknown water pass. The browser voyage produced 166 Personal tiles while current sight remained bounded to 81 tiles.

## Milestone 3 — Risk

Status: pending

## Decisions to review at Milestone 3

1. **Reuse boundary.** The older Ship Game Prototype was used as an architectural and version reference only. Its click-to-sail polygon navigation and production presentation were not copied because Wayfinders requires a WASD square-grid prototype and developer art.
2. **Teleport safety.** “Any tile” is implemented as any navigable water tile. Land, reef and rock remain blocked so teleporting cannot leave the simulation in an invalid state.
3. **Developer UI.** Numerical tuning is confined to the developer drawer. It is not part of the normal play presentation and therefore does not undermine the Milestone 3 no-numerical-player-UI test.
4. **Live starting provisions.** Changing “starting bundles” also changes the current sandbox cargo immediately. This makes the tuning control observable without requiring regeneration.
5. **Milestone 0 overlays.** Before their final Milestone 3 grid calculations are connected, the forward and return toggles display provisional range rings. They are development hooks, not the final risk presentation.
6. **Home presentation.** The home, dock, vessel and ocean are drawn with generated Phaser vector shapes. This deliberately follows the developer-art restriction and avoids committing to production silhouettes or an isometric projection before the exploration loop is reviewed.
7. **Camera input.** Wheel and Q/E share a clamped zoom range; the camera always follows the authoritative ship position. Free camera panning was omitted because it made it easier to lose the ship without helping the Milestone 0–3 loop.
8. **Visibility shape.** Line of sight is a Euclidean circle on the square grid. Land and rock block cells behind them but remain visible themselves. This matches the five-tile technical radius while giving the exploration trail a broader, softer silhouette than a Manhattan diamond.
9. **Teleport knowledge.** Developer teleport reveals only the destination sight disc; it does not create a false Personal corridor between origin and destination.
10. **Fog masks.** Changed chunks are composited into one reusable low-resolution world mask, then bilinearly sampled by Phaser's WebGL renderer. The single display quad avoids camera-scale seams while retaining chunk-scoped data updates. A custom production shader remains unnecessary for developer art at this review gate.
11. **Voyage scope.** Personal knowledge uses one current expedition stamp and lasts until regeneration. Safe-return conversion and failure rollback are deliberately not implemented because they are Milestone 4 features.
