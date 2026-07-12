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
- Unknown cells behind the moving ship become expedition-stamped Personal knowledge; visible water at and ahead of the ship remains Unknown until it falls behind.
- Every crossed navigation-tile centre is observed, preventing gaps during fast or diagonal movement.
- Near-black Unknown fog, grey Personal water and full-colour current visibility.
- Bilinear, noise-softened transitions rendered from reusable chunk-updated mask data.
- Debug sight-ring toggle is tied to the same radius used by the simulation.
- Browser-readable knowledge/visibility counts for deterministic play checks.

Verification: TypeScript check, 23 unit tests, production build, and an in-browser voyage from Supported into Unknown water pass. The browser voyage produced 166 Personal tiles while current sight remained bounded to 81 tiles.

## Milestone 3 — Risk

Status: complete — stop here for user playtesting

- Physical, countable provision bundles in an on-board cargo rack; no visible numerical resource bar.
- Distance-based charging captured before the corresponding observation update.
- Configured Supported / Personal / Unknown costs of 0 / 0.5 / 1 bundle-units per tile.
- Cost-limited forward Dijkstra mask showing only reachable Unknown water.
- Known-water, multi-source return Dijkstra with comfortable, warning, critical and impossible margins.
- Reusable WebGL-rendered forward and return textures with dotted, diagonal and crosshatched accessibility treatments.
- World legend uses words and patterns without exposing resource arithmetic.
- Current sight remains full colour; return risk appears only on Personal water behind the ship.
- Empty cargo stops propulsion outside Supported water and leaves developer recovery available.
- Re-entering Supported water gives a brief safe-passage cue without applying Milestone 4 progression.

Verification: TypeScript check, 33 unit tests, production build, dependency audit and browser playtesting pass. Browser voyages verified bundle consumption, shrinking forward reach, all return-risk states, zero-bundle stranding and a viable return to Supported water. The final natural fixed-step voyage spent 5.25 bundle-units on the outward frontier leg and about 2.74 on its Personal-water retrace.

Development is intentionally paused at the Milestone 3 review gate. Milestones 4 and 5 have not been started.

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
12. **Provision budget correction.** The technical document prints `bundles + (1 - accumulator)` for overlay reach, which grants a nonexistent extra bundle when the accumulator is zero. The implementation uses `bundles - accumulator`, so physical cargo and overlay distance agree exactly. Tests lock this decision.
13. **Zero-bundle consequence.** A ship with empty cargo can turn but cannot propel itself outside Supported water. The sandbox's add-bundle, teleport and regenerate controls prevent this playtest consequence from blocking iteration.
14. **Physical cargo presentation.** Each bundle is a countable crate in a screen-space “Provisions Aboard” rack, following the supplied overlay concept. A hidden live text equivalent exists for accessibility; normal visual play has no number.
15. **Risk accessibility.** Comfortable return is neutral, warning uses sparse diagonals, critical uses denser diagonals and impossible return uses a red crosshatch. Current sight is excluded so the colours read as a trail behind the ship rather than a tint over the immediate sailing area.
16. **Unknown-terrain privacy.** Forward search treats still-Unknown blockers as ordinary Unknown water. Once observed, actual terrain and collision apply. The overlay therefore cannot reveal hidden islands or reefs.
17. **Return feedback boundary.** Re-entering Supported water gives a temporary “Safe Passage” cue, but Personal knowledge is not converted and nothing is saved. This improves the Milestone 3 review experience without implementing Milestone 4 legacy.
18. **Dependency advisory.** Runtime dependencies audit clean. Vitest was patched from 3.2.4 to 3.2.7 to remove a development-server advisory before handoff.
19. **Outward/return asymmetry.** The supplied concept requires the current forward range to cost full bundles and the trail home to cost half. Current sight therefore reveals terrain visually, while broad perpendicular strips centred on navigation tiles the ship has actually left commit passable water to Personal knowledge. The occupied and forward water remains Unknown while advancing, making an outward leg cost twice its Personal retrace without turns pre-charting untouched sea. Visible blocking landmarks are remembered immediately because they cannot discount travel. Stationary developer teleport still reveals its full sight disc for inspection. This intentionally refines the technical document's broader visible-to-Personal rule to preserve its own full-cost-out/half-cost-back requirement.
