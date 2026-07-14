# Wayfinders browser prototype

Wayfinders is a playable Phaser and TypeScript exploration prototype. The
current implementation is the accepted gameplay and performance baseline: it
provides a stable base for sailing, charting water, managing provisions,
returning discoveries, inheriting Supported knowledge across generations and
finding the lost locations of the world's idols across generations.

The current build includes:

- deterministic chunked worlds with varied islands;
- exact-tile dock departures and successful returns;
- outward and return provision costs with route-focused risk guidance;
- Unknown, Personal and Supported water knowledge states;
- four-second wreck presentation, persistent wreck sites and generational respawning;
- provision-funded island/site surveys with provisional, returned and lost
  knowledge states;
- three deterministic hidden idol locations in the default world, distinguished
  Great Hall credit and continue-or-new-game completion; and
- a fresh game session on every launch or browser refresh.

The runtime also includes interpolated ship presentation, viewport-culled
chunk overlays, incremental return-route rendering and
frame-time diagnostics so gameplay, living-world and presentation work can
extend the foundation without replacing it.

Developer graphics remain intentional throughout the gameplay roadmap.
Production asset infrastructure, tooling and art replacement are a separate
graphics track. Its start gate is accepted `GP-3.3`, which freezes the stable
island and generic survey-site identities/read models. `GR-1.1` through
`GR-1.3` are accepted; `GR-1.4` is the active authorized authored-asset milestone.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`. Use WASD or the arrow keys to sail, the mouse wheel or Q/E to zoom, and the on-screen developer tools to inspect deterministic islands, fishing signs and navigator wrecks, return through the exact dock flow, or reset the world from a seed.

To run another instance on a different port, pass the port after `--`:

```powershell
npm.cmd run dev -- 5174
```

Then open `http://127.0.0.1:5174/`. An explicitly requested port will not silently fall back to another port if it is already occupied.

Saving is intentionally absent during active development. Reloading starts a
fresh session. Saving must not be reintroduced unless an explicitly authorized
milestone names it as in scope.

## Verify

```powershell
npm.cmd run check
```

The clean verification pipeline runs type checking, the automated test suite and the production build.

## Project documentation

- [Implementation status](docs/IMPLEMENTATION_STATUS.md) is the starting point for a new development session.
- [Technical design](docs/Wayfinders_Technical_Design.md) describes the implemented architecture and gameplay rules.
- [Development roadmap](docs/Wayfinders_Roadmap.md) treats the current build as the accepted baseline and proposes major gameplay and graphics milestones.
- [Economy and legacy design](docs/Wayfinders_Economy_Design.md) describes surveying, tribe support, inheritance and the idol completion goal.
- [Asset pipeline](docs/Wayfinders_Asset_Pipeline.md) records the deferred production-graphics direction.
